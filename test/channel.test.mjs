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
import {encodeChannelMessage,decodeChannelMessage,MAX_CHANNEL_MESSAGE_BYTES} from '../connector/channel-codec.mjs';
import {boundResultEnvelope} from '../connector/result-envelope.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../connector/catalog.json',import.meta.url)));
const delay=ms=>new Promise(r=>setTimeout(r,ms));

test('oversized delivery preserves outcome and identity without rewriting the original response',()=>{
  const id=sha('large'),fingerprint=sha('intent');
  const small={id,fingerprint,response:toolResult({state:'completed'})};
  assert.equal(boundResultEnvelope(small,262144),small);
  for(const state of ['completed','failed','uncertain']){
    const response=toolResult({state,operationState:state,result:{sessionId:'large-output',exitCode:state==='failed'?7:0,output:'x'.repeat(700000)},
      connectorOperation:{operationId:id,toolName:'commander_interact_with_process',requestSha256:fingerprint,callId:'input-once',device:'local'}},state!=='completed');
    const original=JSON.stringify(response),message={type:'result',id,fingerprint,response};
    for(const limit of [262144,MAX_CHANNEL_MESSAGE_BYTES]){
      const projected=boundResultEnvelope(message,limit),value=projected.response.structuredContent;
      assert.ok(Buffer.byteLength(JSON.stringify(projected))<=limit);
      assert.equal(projected.response.isError,true);
      assert.equal(value.state,state);assert.equal(value.operationState,state);
      assert.equal(value.sessionId,'large-output');assert.equal(value.callId,'input-once');
      assert.deepEqual(value.connectorOperation,response.structuredContent.connectorOperation);
      assert.equal(value.code,'CONNECTOR_RESULT_TOO_LARGE');assert.equal(value.retrySafe,false);
      assert.equal(value.responseSha256,sha(original));assert.equal(value.result,null);
      assert.equal(JSON.stringify(response),original);
    }
  }
});

test('channel compression preserves structured results and enforces the expanded byte budget',async()=>{
  const value={type:'result',response:toolResult({state:'completed',content:'diagnostic line\n'.repeat(4000)})};
  const wire=await encodeChannelMessage(value);assert.ok(wire instanceof Uint8Array);
  assert.ok(wire.byteLength<JSON.stringify(value).length/10);
  assert.deepEqual(await decodeChannelMessage(wire),value);
  assert.deepEqual(await decodeChannelMessage(await encodeChannelMessage({type:'ready'})),{type:'ready'});
  await assert.rejects(encodeChannelMessage({text:'x'.repeat(MAX_CHANNEL_MESSAGE_BYTES)}),/TOO_LARGE/);
  await assert.rejects(decodeChannelMessage(new Uint8Array([1,2,3])));
});

test('channel client preserves operation ID on lost response and only falls back for receipt reads',async()=>{
  const calls=[],token='t'.repeat(64);let legacy=0;
  const c=createChannelClient({origin:'https://channel.example',token,catalog,legacyReceipt:async()=>{legacy++;return toolResult({state:'completed'});},
    fetchImpl:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});if(url.endsWith('/invoke'))throw Error('lost response');return Response.json(toolResult({state:'unknown'}));}});
  const r=await c.invoke('commander_write_file',{callId:'stable',content:'one'});
  assert.equal(r.structuredContent.state,'uncertain');assert.equal(r.structuredContent.operationId,sha('mutation:stable'));
  assert.equal(legacy,0);assert.equal(calls.length,1);
  await c.receipt(r.structuredContent.operationId);assert.equal(legacy,1);
});

test('a synchronous error from WebSocket close cannot re-enter the error handler',async()=>{
  let stopped=false,closes=0,calls=0;
  class ErrorSocket extends EventTarget {
    readyState=0;
    constructor(){super();queueMicrotask(()=>this.dispatchEvent(new Event('error')));}
    close(){
      closes++;stopped=true;
      // Bound the simulated recursion so a broken implementation fails cleanly.
      if(closes===1)this.dispatchEvent(new Event('error'));
      this.readyState=3;this.dispatchEvent(new Event('close'));
    }
  }
  await runChannelAgent({origin:'https://channel.example',token:'t'.repeat(64),WebSocketImpl:ErrorSocket,
    stopped:()=>stopped,executeJob:async()=>{calls++;},log:()=>{}});
  assert.equal(closes,1);assert.equal(calls,0);
});

test('an error without a close event releases the agent connection',async()=>{
  let stopped=false,socket,forcedClose=false;
  class MissingCloseSocket extends EventTarget {
    readyState=0;
    constructor(){super();socket=this;queueMicrotask(()=>this.dispatchEvent(new Event('error')));}
    close(){stopped=true;this.readyState=3;}
  }
  // This cleanup makes the old implementation terminate and fail the predicate.
  const cleanup=setTimeout(()=>{forcedClose=true;socket?.dispatchEvent(new Event('close'));},100);
  try{await runChannelAgent({origin:'https://channel.example',token:'t'.repeat(64),WebSocketImpl:MissingCloseSocket,
    stopped:()=>stopped,executeJob:async()=>assert.fail('No job should be dispatched'),log:()=>{}});
    assert.equal(forcedClose,false,'The agent must not depend on a later close event');
  }finally{clearTimeout(cleanup);}
});

test('graceful stop does not require a WebSocket close event',async()=>{
  let stopped=false,socket,forcedClose=false;
  class MissingCloseSocket extends EventTarget {
    readyState=0;
    constructor(){super();socket=this;queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));stopped=true;});}
    send(){}
    close(){this.readyState=2;}
  }
  const cleanup=setTimeout(()=>{forcedClose=true;socket?.dispatchEvent(new Event('close'));},2000);
  try{await runChannelAgent({origin:'https://channel.example',token:'t'.repeat(64),WebSocketImpl:MissingCloseSocket,
    stopped:()=>stopped,executeJob:async()=>assert.fail('No job should be dispatched'),log:()=>{}});
    assert.equal(forcedClose,false,'Shutdown must settle before a missing peer close event');
  }finally{clearTimeout(cleanup);}
});

test('real SQLite Durable Object and outbound agent reconcile duplicates, reconnect, failed workers and restart', {timeout:120000}, async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-channel-'));
  fs.mkdirSync(root+'/journal');
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
  const port=listener.address().port;await new Promise(r=>listener.close(r));
  const origin='http://127.0.0.1:'+port,serverToken=crypto.randomBytes(32).toString('hex'),agentToken=crypto.randomBytes(32).toString('hex'),ownerPassword=crypto.randomBytes(32).toString('hex');
  let worker,workerLog='',stopping=false,agent,calls=0,drop=false,phase='startup';const agentLog=[];
  const bounded=async(p,ms,label)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TEST_TIMEOUT: '+label)),ms);})]);}finally{clearTimeout(timer);}};
  const request=(url,options={})=>fetch(url,{...options,signal:AbortSignal.any([t.signal,AbortSignal.timeout(35000)])});
  async function start(){
    worker=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--local','--ip','127.0.0.1','--port',String(port),
      '--config','connector/channel/wrangler.jsonc','--persist-to',root+'/cloud','--var','SERVER_TOKEN:'+serverToken,'--var','AGENT_TOKEN:'+agentToken,
      '--var','CONNECTOR_ORIGIN:'+origin,'--var','CONNECTOR_SECRET:'+serverToken,'--var','CONNECTOR_OWNER_PASSWORD_HASH:'+sha(ownerPassword)],
      {env:{...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    worker.stdout.on('data',b=>{workerLog+=b;});worker.stderr.on('data',b=>{workerLog+=b;});
    for(let i=0;i<100;i++){try{if((await fetch(origin+'/health',{signal:AbortSignal.any([t.signal,AbortSignal.timeout(1500)])})).ok)return;}catch{}if(worker.exitCode!==null)break;await delay(100);}
    throw Error('Local Worker failed to start: '+workerLog.replaceAll(serverToken,'[token]').replaceAll(agentToken,'[token]'));
  }
  async function stop(){
    if(!worker||worker.exitCode!==null||worker.signalCode!==null)return;
    const owned=worker,closed=new Promise(r=>owned.once('exit',r));process.kill(-owned.pid,'SIGTERM');
    try{await bounded(closed,5000,'owned Wrangler stop');}
    catch(e){if(owned.exitCode===null&&owned.signalCode===null)process.kill(-owned.pid,'SIGKILL');await bounded(closed,3000,'owned Wrangler kill');throw e;}
  }
  const http=async(p,b)=>{
    const r=await request(origin+p,{method:'POST',headers:{authorization:'Bearer '+serverToken,'content-type':'application/json'},body:JSON.stringify(b)});
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
    // Authentication rejects before parsing a body. Keep these local proxy
    // probes bodyless: workerd dev-proxy early-body cancellation can break the
    // following connection. Authenticated bodies are exercised by the real SDK;
    // unauthorized bodies are covered by handler and deployed-route checks.
    const deniedInvoke=await request(origin+'/invoke',{method:'POST',headers:{connection:'close'}});
    assert.equal(deniedInvoke.status,401);await deniedInvoke.text();
    const first=job('commander_write_file',{device:'local',callId:'channel-once',path:root+'/effect',content:'once\n',mode:'append'});
    assert.equal((await http('/invoke',first)).structuredContent.code,'MAC_AGENT_OFFLINE');
    agent=runChannelAgent({origin:'https://channel.example',token:agentToken,WebSocketImpl:LocalSocket,stopped:()=>stopping,log:v=>agentLog.push(v),
      executeJob:(j,upload)=>executeJournaledJob({job:j,stateDir:root+'/journal',call:(name,args)=>{calls++;return client.callTool({name,arguments:args});},
        upload:async r=>{if(drop){drop=false;sockets.at(-1).close();throw Error('TEST_LOST_UPLOAD');}return upload(r);}})});
    for(let i=0;i<100;i++){if((await http('/status',{})).online)break;await delay(50);}
    assert.equal((await http('/status',{})).online,true);
    // Exercise the public OAuth and SDK endpoint, not just the internal queue.
    const deniedMcp=await request(origin+'/mcp',{method:'POST',headers:{connection:'close'}});
    assert.equal(deniedMcp.status,401);await deniedMcp.text();
    phase='OAuth registration';
    const registrationResponse=await request(origin+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect']})});
    const registrationBody=await registrationResponse.text();
    assert.equal(registrationResponse.status,201,'OAuth registration: '+registrationBody);
    const registration=JSON.parse(registrationBody);
    const verifier=crypto.randomBytes(40).toString('base64url'),params={client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],response_type:'code',resource:origin+'/mcp',scope:'commander',state:'fixture',code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')};
    const html=await (await request(origin+'/oauth/authorize?'+new URLSearchParams(params))).text(),context=html.match(/name="context" value="([^"]+)"/)[1];
    const consent=await request(origin+'/oauth/authorize',{method:'POST',redirect:'manual',headers:{origin},body:new URLSearchParams({context,password:ownerPassword})});assert.equal(consent.status,303);
    const grant={grant_type:'authorization_code',client_id:registration.client_id,resource:origin+'/mcp',redirect_uri:params.redirect_uri,code:new URL(consent.headers.get('location')).searchParams.get('code'),code_verifier:verifier};
    const token=await (await request(origin+'/oauth/token',{method:'POST',body:new URLSearchParams(grant)})).json();
    assert.ok(token.access_token);assert.equal((await request(origin+'/oauth/token',{method:'POST',body:new URLSearchParams(grant)})).status,400);
    const publicClient=new Client({name:'channel-public-test',version:'1'});
    await publicClient.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+token.access_token}}}));
    try{assert.equal((await publicClient.listTools()).tools.length,34);
      const empty=await publicClient.callTool({name:'commander_connector_receipt',arguments:{callId:'not-dispatched'}});assert.equal(empty.structuredContent.state,'unknown');
      const devices=await publicClient.callTool({name:'commander_devices',arguments:{}});assert.equal(devices.structuredContent.state,'completed');}
    finally{await publicClient.close();}
    calls=0;
    phase='concurrent duplicates';
    const responses=await Promise.all(Array.from({length:8},()=>http('/invoke',first)));
    assert.equal(calls,1);for(const r of responses)assert.equal(r.structuredContent.state,'completed');
    assert.equal(fs.readFileSync(first.args.path,'utf8'),'once\n');
    assert.equal((await http('/invoke',job(first.name,{...first.args,content:'changed'}))).structuredContent.code,'CALL_ID_CONFLICT');
    phase='lost acknowledgement reconnect';
    drop=true;
    const lost=job(first.name,{...first.args,callId:'channel-ack-loss',path:root+'/lost-effect'});
    const afterLoss=await http('/invoke',lost);
    assert.equal(afterLoss.structuredContent.state,'completed',JSON.stringify({agentLog,status:await http('/status',{}),receipt:await http('/receipt',{id:lost.id}),workerLog:workerLog.replaceAll(serverToken,'[token]').replaceAll(agentToken,'[token]')}));assert.equal(calls,2);
    assert.equal(fs.readFileSync(lost.args.path,'utf8'),'once\n');
    phase='compressed result';
    const large=root+'/large.txt';fs.writeFileSync(large,'complete result\n'.repeat(1000));
    const readArgs={device:'local',path:large,maxBytes:32768,length:1000};
    const readJob={id:sha('compressed-read'),name:'commander_read_file',args:readArgs,mutating:false,
      fingerprint:sha(canonical({name:'commander_read_file',args:readArgs})),createdAt:Date.now(),expiresAt:Date.now()+60000};
    const readResult=await http('/invoke',readJob);
    assert.equal(readResult.structuredContent.result.content,'complete result\n'.repeat(1000).trimEnd());
    assert.deepEqual(await http('/receipt',{id:readJob.id}),readResult);
    phase='oversized interactive result and bounded recovery';
    const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
    const script="const fs=require('fs');require('readline').createInterface({input:process.stdin}).on('line',()=>{fs.appendFileSync('large-effects','once\\n');process.stdout.write('x'.repeat(700000));});";
    await client.callTool({name:'commander_start_process',arguments:{device:'local',callId:'large-start',sessionId:'large-output',transport:'pipe',cwd:root,command:quote(process.execPath)+' -e '+quote(script)}});
    try{
      const input=job('commander_interact_with_process',{device:'local',callId:'large-input',sessionId:'large-output',input:'emit',wait_ms:500});
      const beforeInput=calls;drop=true;
      const notice=await http('/invoke',input),value=notice.structuredContent;
      assert.equal(value.code,'CONNECTOR_RESULT_TOO_LARGE');assert.equal(notice.isError,true);
      assert.equal(value.state,'completed');assert.equal(value.operationState,'running');
      assert.equal(value.sessionId,'large-output');assert.equal(value.callId,'large-input');
      assert.equal(calls,beforeInput+1);assert.equal(fs.readFileSync(root+'/large-effects','utf8'),'once\n');
      const retained=JSON.parse(fs.readFileSync(root+'/journal/'+input.id+'.json')).response;
      assert.equal(retained.structuredContent.result.output.length,700000);
      assert.equal(value.responseSha256,sha(JSON.stringify(retained)));
      assert.deepEqual(await http('/invoke',input),notice);assert.equal(calls,beforeInput+1);
      assert.deepEqual(await http('/receipt',{id:input.id}),notice);
      let output='',offset=0;
      while(offset<700000){
        const args={device:'local',sessionId:'large-output',offset,maxBytes:65536},name='commander_process_output';
        const r=await http('/invoke',{id:sha('large-read-'+offset),name,args,mutating:false,fingerprint:sha(canonical({name,args})),createdAt:Date.now(),expiresAt:Date.now()+60000});
        assert.equal(r.isError,false);const page=r.structuredContent.result;
        assert.ok(page.nextOffset>offset);output+=page.output;offset=page.nextOffset;
      }
      assert.equal(output,'x'.repeat(700000));
      assert.equal((await http('/status',{})).pending,0);
      assert.equal(fs.readFileSync(root+'/large-effects','utf8'),'once\n');
    }finally{await client.callTool({name:'commander_force_terminate',arguments:{device:'local',callId:'large-stop',sessionId:'large-output'}});}
    phase='worker batch';
    const workers=['a','b','c','d'].map(id=>{const cwd=root+'/'+id;fs.mkdirSync(cwd);return{id,role:'fixture',cwd,transport:'pipe',command:`printf '${id}' > result; ${id==='d'?'exit 7':'true'}`,artifacts:[{path:'result',sha256:sha(id)}]};});
    const batch=job('commander_start_batch',{device:'local',callId:'channel-batch',batchId:'channel-batch',workers,wait_ms:1000});
    const started=await http('/invoke',batch);assert.ok(started.structuredContent);
    const collected=await client.callTool({name:'commander_collect_batch',arguments:{device:'local',batchId:'channel-batch',wait_ms:10000}});
    assert.equal(collected.structuredContent.result.counts.failed,1);
    assert.equal(collected.structuredContent.result.counts.completed,3);
    for(const w of workers)assert.equal(fs.readFileSync(w.cwd+'/result','utf8'),w.id);
    phase='Wrangler restart';await stop();await start();
    phase='retained receipt';
    const retained=await http('/receipt',{id:first.id});assert.equal(retained.structuredContent.state,'completed');
    const before=calls;await http('/invoke',first);assert.equal(calls,before);assert.equal(fs.readFileSync(first.args.path,'utf8'),'once\n');
  }catch(e){console.error({phase,agentLog});console.error(workerLog.replaceAll(serverToken,'[token]').replaceAll(agentToken,'[token]'));throw e;}
  finally{
    stopping=true;for(const ws of sockets)ws.close();
    // Stop the owned server before waiting for the agent's close handshake.
    // A stalled emulator must fail and clean up, not keep the test runner alive.
    try{await stop();if(agent)await bounded(agent,10000,'agent shutdown');}
    finally{await bounded(client.close(),10000,'stdio shutdown');fs.rmSync(root,{recursive:true,force:true});}
  }
});
