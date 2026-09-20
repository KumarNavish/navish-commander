import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createChannelClient} from '../connector/channel-client.mjs';
import {runChannelAgent} from '../connector/channel-agent.mjs';
import {executeJournaledJob} from '../connector/journal.mjs';
import {sha} from '../connector/auth.mjs';
import {canonical,toolResult} from '../connector/queue.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../connector/catalog.json',import.meta.url)));
const delay=ms=>new Promise(r=>setTimeout(r,ms));

test('channel client preserves operation ID on lost response and only falls back for receipt reads',async()=>{
  const calls=[],token='t'.repeat(64);let legacy=0;
  const c=createChannelClient({origin:'https://channel.example',token,catalog,legacyReceipt:async()=>{legacy++;return toolResult({state:'completed'});},
    fetchImpl:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});if(url.endsWith('/invoke'))throw Error('lost response');return Response.json(toolResult({state:'unknown'}));}});
  const r=await c.invoke('commander_write_file',{callId:'stable',content:'one'});
  assert.equal(r.structuredContent.state,'uncertain');assert.equal(r.structuredContent.operationId,sha('mutation:stable'));
  assert.equal(legacy,0);assert.equal(calls.length,1);
  await c.receipt(r.structuredContent.operationId);assert.equal(legacy,1);
});

test('real SQLite Durable Object and outbound agent reconcile duplicates, reconnect, failed workers and restart', {timeout:120000}, async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-channel-'));
  fs.mkdirSync(root+'/journal');
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
  const port=listener.address().port;await new Promise(r=>listener.close(r));
  const origin='http://127.0.0.1:'+port,serverToken=crypto.randomBytes(32).toString('hex'),agentToken=crypto.randomBytes(32).toString('hex'),ownerPassword=crypto.randomBytes(32).toString('hex');
  let worker,workerLog='',stopping=false,agent,calls=0,drop=false;const agentLog=[];
  async function start(){
    worker=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--local','--ip','127.0.0.1','--port',String(port),
      '--config','connector/channel/wrangler.jsonc','--persist-to',root+'/cloud','--var','SERVER_TOKEN:'+serverToken,'--var','AGENT_TOKEN:'+agentToken,
      '--var','CONNECTOR_ORIGIN:'+origin,'--var','CONNECTOR_SECRET:'+serverToken,'--var','CONNECTOR_OWNER_PASSWORD_HASH:'+sha(ownerPassword)],
      {env:{...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    worker.stdout.on('data',b=>{workerLog+=b;});worker.stderr.on('data',b=>{workerLog+=b;});
    for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok)return;}catch{}if(worker.exitCode!==null)break;await delay(100);}
    throw Error('Local Worker failed to start: '+workerLog.replaceAll(serverToken,'[token]').replaceAll(agentToken,'[token]'));
  }
  async function stop(){if(!worker||worker.exitCode!==null)return;const closed=new Promise(r=>worker.once('exit',r));process.kill(-worker.pid,'SIGTERM');await closed;}
  const http=async(p,b)=>{
    const r=await fetch(origin+p,{method:'POST',headers:{authorization:'Bearer '+serverToken,'content-type':'application/json'},body:JSON.stringify(b)});
    assert.equal(r.status,200);return r.json();
  };
  function job(name,args){const now=Date.now();return {id:sha('mutation:'+args.callId),name,args,mutating:true,fingerprint:sha(canonical({name,args})),createdAt:now,expiresAt:now+600000};}
  const client=new Client({name:'channel-real-test',version:'1'});
  const stdio=new StdioClientTransport({command:process.execPath,args:[path.resolve(process.env.NAVISH_MCP_SERVER||'src/server.mjs')],
    env:{...process.env,NAVISH_CONFIG_DIR:root+'/config',NAVISH_STATE_DIR:root+'/state',NAVISH_DATA_DIR:root+'/data'},stderr:'pipe'});stdio.stderr?.resume();
  const sockets=[];
  class LocalSocket extends WebSocket{constructor(url,protocols){super(url.replace('wss://channel.example',origin.replace('http:','ws:')),protocols);sockets.push(this);}}
  try{
    await start();await client.connect(stdio);
    assert.equal((await fetch(origin+'/invoke',{method:'POST',body:'{}'})).status,401);
    const first=job('commander_write_file',{device:'local',callId:'channel-once',path:root+'/effect',content:'once\n',mode:'append'});
    assert.equal((await http('/invoke',first)).structuredContent.code,'MAC_AGENT_OFFLINE');
    agent=runChannelAgent({origin:'https://channel.example',token:agentToken,WebSocketImpl:LocalSocket,stopped:()=>stopping,log:v=>agentLog.push(v),
      executeJob:(j,upload)=>executeJournaledJob({job:j,stateDir:root+'/journal',call:(name,args)=>{calls++;return client.callTool({name,arguments:args});},
        upload:async r=>{if(drop){drop=false;sockets.at(-1).close();throw Error('TEST_LOST_UPLOAD');}return upload(r);}})});
    for(let i=0;i<100;i++){if((await http('/status',{})).online)break;await delay(50);}
    assert.equal((await http('/status',{})).online,true);
    // Exercise the public OAuth and SDK endpoint, not just the internal queue.
    assert.equal((await fetch(origin+'/mcp',{method:'POST',body:'{}'})).status,401);
    const registration=await (await fetch(origin+'/oauth/register',{method:'POST',body:JSON.stringify({redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect']})})).json();
    const verifier=crypto.randomBytes(40).toString('base64url'),params={client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],response_type:'code',resource:origin+'/mcp',scope:'commander',state:'fixture',code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')};
    const html=await (await fetch(origin+'/oauth/authorize?'+new URLSearchParams(params))).text(),context=html.match(/name="context" value="([^"]+)"/)[1];
    const consent=await fetch(origin+'/oauth/authorize',{method:'POST',redirect:'manual',headers:{origin},body:new URLSearchParams({context,password:ownerPassword})});assert.equal(consent.status,303);
    const grant={grant_type:'authorization_code',client_id:registration.client_id,resource:origin+'/mcp',redirect_uri:params.redirect_uri,code:new URL(consent.headers.get('location')).searchParams.get('code'),code_verifier:verifier};
    const token=await (await fetch(origin+'/oauth/token',{method:'POST',body:new URLSearchParams(grant)})).json();
    assert.ok(token.access_token);assert.equal((await fetch(origin+'/oauth/token',{method:'POST',body:new URLSearchParams(grant)})).status,400);
    const publicClient=new Client({name:'channel-public-test',version:'1'});
    await publicClient.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+token.access_token}}}));
    try{assert.equal((await publicClient.listTools()).tools.length,11);
      const empty=await publicClient.callTool({name:'commander_connector_receipt',arguments:{callId:'not-dispatched'}});assert.equal(empty.structuredContent.state,'unknown');
      const devices=await publicClient.callTool({name:'commander_devices',arguments:{}});assert.equal(devices.structuredContent.state,'completed');}
    finally{await publicClient.close();}
    calls=0;
    const responses=await Promise.all(Array.from({length:8},()=>http('/invoke',first)));
    assert.equal(calls,1);for(const r of responses)assert.equal(r.structuredContent.state,'completed');
    assert.equal(fs.readFileSync(first.args.path,'utf8'),'once\n');
    assert.equal((await http('/invoke',job(first.name,{...first.args,content:'changed'}))).structuredContent.code,'CALL_ID_CONFLICT');
    drop=true;
    const lost=job(first.name,{...first.args,callId:'channel-ack-loss',path:root+'/lost-effect'});
    const afterLoss=await http('/invoke',lost);
    assert.equal(afterLoss.structuredContent.state,'completed',JSON.stringify({agentLog,status:await http('/status',{}),receipt:await http('/receipt',{id:lost.id}),workerLog:workerLog.replaceAll(serverToken,'[token]').replaceAll(agentToken,'[token]')}));assert.equal(calls,2);
    assert.equal(fs.readFileSync(lost.args.path,'utf8'),'once\n');
    const workers=['a','b','c','d'].map(id=>{const cwd=root+'/'+id;fs.mkdirSync(cwd);return{id,role:'fixture',cwd,transport:'pipe',command:`printf '${id}' > result; ${id==='d'?'exit 7':'true'}`,artifacts:[{path:'result',sha256:sha(id)}]};});
    const batch=job('commander_start_batch',{device:'local',callId:'channel-batch',batchId:'channel-batch',workers,wait_ms:1000});
    const started=await http('/invoke',batch);assert.ok(started.structuredContent);
    const collected=await client.callTool({name:'commander_collect_batch',arguments:{device:'local',batchId:'channel-batch',wait_ms:10000}});
    assert.equal(collected.structuredContent.result.counts.failed,1);
    assert.equal(collected.structuredContent.result.counts.completed,3);
    for(const w of workers)assert.equal(fs.readFileSync(w.cwd+'/result','utf8'),w.id);
    await stop();await start();
    const retained=await http('/receipt',{id:first.id});assert.equal(retained.structuredContent.state,'completed');
    const before=calls;await http('/invoke',first);assert.equal(calls,before);assert.equal(fs.readFileSync(first.args.path,'utf8'),'once\n');
  }catch(e){console.error(workerLog.replaceAll(serverToken,'[token]').replaceAll(agentToken,'[token]'));throw e;}
  finally{
    stopping=true;for(const ws of sockets)ws.close();if(agent)await agent;
    await client.close();await stop();fs.rmSync(root,{recursive:true,force:true});
  }
});
