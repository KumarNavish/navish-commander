import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createAuth,sha} from '../connector/auth.mjs';
import {createHandler} from '../connector/handler.mjs';
import {createQueue,toolResult,canonical} from '../connector/queue.mjs';
import {createPoll} from '../connector/poll-handler.mjs';
import {executeJournaledJob} from '../connector/journal.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../connector/catalog.json',import.meta.url)));
class Store {
  data=new Map();
  async get(k){return structuredClone(this.data.get(k)??null);}
  async setJSON(k,v,o={}){if(o.onlyIfNew&&this.data.has(k))return {modified:false};this.data.set(k,structuredClone(v));return {modified:true};}
  async delete(k){this.data.delete(k);}
  async list({prefix}){return {blobs:[...this.data.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))};}
}
function lab(){const store=new Store(),origin='https://commander.example',secret=crypto.randomBytes(32).toString('hex'),password=crypto.randomBytes(32).toString('hex'),agentToken=crypto.randomBytes(32).toString('hex');return {store,origin,secret,password,ownerPasswordHash:sha(password),agentToken,catalog};}
async function login(c){
  const a=createAuth(c),client=a.register({redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect'],token_endpoint_auth_method:'none'});
  const verifier=crypto.randomBytes(40).toString('base64url');
  const params={client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',resource:c.origin+'/mcp',scope:'commander',state:'state',code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')};
  const context=a.authorize(params),redirect=new URL(a.consent(context,c.password));
  const exchange={grant_type:'authorization_code',resource:params.resource,client_id:client.client_id,redirect_uri:params.redirect_uri,code:redirect.searchParams.get('code'),code_verifier:verifier};
  const token=await a.token(exchange);return {a,params,context,exchange,token,redirect};
}
test('private connector OAuth binds owner, PKCE, redirect, resource and one-time code',async()=>{
  const c=lab(),r=await login(c);
  assert.equal(r.redirect.searchParams.get('iss'),c.origin);
  assert.equal(r.a.access('Bearer '+r.token.access_token).sub,'owner');
  assert.throws(()=>r.a.authorize({...r.params,code_challenge_method:'plain'}));
  assert.throws(()=>r.a.authorize({...r.params,resource:'https://other.example/mcp'}));
  assert.throws(()=>r.a.consent(r.context,'incorrect'));
  assert.throws(()=>r.a.register({redirect_uris:['https://other.example/callback']}));
  await assert.rejects(r.a.token({...r.exchange,code_verifier:'x'.repeat(60)}));
  await assert.rejects(r.a.token(r.exchange),/CODE_ALREADY_USED/);
  const other=createAuth({...c,origin:'https://different.example'});
  assert.throws(()=>other.access('Bearer '+r.token.access_token));
  assert.equal(r.a.agent('Bearer '+c.agentToken),true);
  assert.equal(r.a.agent('Bearer incorrect'),false);
  const fresh=await r.a.token({grant_type:'refresh_token',client_id:r.params.client_id,resource:r.params.resource,refresh_token:r.token.refresh_token});
  assert.equal(r.a.access('Bearer '+fresh.access_token).aud,r.params.resource);
});
test('HTTP MCP enforces auth while supporting actual SDK initialization and catalog',async()=>{
  const c=lab(),r=await login(c),handle=createHandler({...c,waitMs:0});
  const unauthorized=await handle(new Request(c.origin+'/mcp',{method:'POST',body:'{}'}));
  assert.equal(unauthorized.status,401);assert.match(unauthorized.headers.get('www-authenticate'),/oauth-protected-resource/);
  const metadata=await handle(new Request(c.origin+'/.well-known/oauth-protected-resource'));assert.equal((await metadata.json()).resource,c.origin+'/mcp');
  const client=new Client({name:'private-relay-test',version:'1'});
  const transport=new StreamableHTTPClientTransport(new URL(c.origin+'/mcp'),{
    requestInit:{headers:{authorization:'Bearer '+r.token.access_token}},
    fetch:async(url,init)=>handle(new Request(url,init))
  });
  try{
    await client.connect(transport);
    const list=await client.listTools();assert.equal(list.tools.length,34);
    assert.equal(list.tools.find(t=>t.name==='commander_write_file').annotations.readOnlyHint,false);
    const offline=await client.callTool({name:'commander_devices',arguments:{}});
    assert.equal(offline.structuredContent.code,'MAC_AGENT_OFFLINE');assert.equal(offline.structuredContent.dispatched,false);
    await c.store.setJSON('agent/heartbeat',{at:Date.now()});
    const put=c.store.setJSON.bind(c.store);
    c.store.setJSON=async(k,v,o)=>{const result=await put(k,v,o);if(k.startsWith('pending/'))throw Error('lost queue acknowledgement');return result;};
    const lost=await client.callTool({name:'commander_write_file',arguments:{device:'local',callId:'lost-publication',path:'/tmp/fixture',content:'one'}});
    assert.equal(lost.structuredContent.state,'uncertain');
    assert.equal(lost.structuredContent.operationId,sha('mutation:lost-publication'));
    const reconciled=await client.callTool({name:'commander_connector_receipt',arguments:{callId:'lost-publication'}});
    assert.equal(reconciled.structuredContent.state,'queued');
    assert.equal(reconciled.structuredContent.operationId,lost.structuredContent.operationId);
  }finally{await client.close();}
});
test('browser consent preserves same-origin form POSTs and rejects absent or foreign origins',async()=>{
  const c=lab(),r=await login(c),handle=createHandler(c);
  const page=await handle(new Request(c.origin+'/oauth/authorize?'+new URLSearchParams(r.params)));
  assert.equal(page.status,200);
  assert.equal(page.headers.get('referrer-policy'),'same-origin');
  assert.match(page.headers.get('content-security-policy'),/form-action 'self' https:\/\/chatgpt.com;/);
  const request=origin=>new Request(c.origin+'/oauth/authorize',{method:'POST',
    headers:origin?{origin,'content-type':'application/x-www-form-urlencoded'}:{},
    body:new URLSearchParams({context:r.context,password:c.password})});
  for(const origin of [undefined,'null','https://other.example'])
    assert.equal((await handle(request(origin))).status,403);
  const accepted=await handle(request(c.origin));
  assert.equal(accepted.status,303);
  assert.equal(new URL(accepted.headers.get('location')).origin,'https://chatgpt.com');
});
test('concurrent duplicate publication shares one durable request and rejects changed intent',async()=>{
  const c=lab();await c.store.setJSON('agent/heartbeat',{at:Date.now()});
  const q=createQueue({...c,waitMs:0});
  const args={device:'local',callId:'same-write',path:'/tmp/fixture',content:'once'};
  const results=await Promise.all(Array.from({length:8},()=>q.invoke('commander_write_file',args)));
  assert.equal(new Set(results.map(r=>r.structuredContent.operationId)).size,1);
  assert.equal((await c.store.list({prefix:'pending/'})).blobs.length,1);
  await assert.rejects(q.invoke('commander_write_file',{...args,content:'different'}),/CALL_ID_CONFLICT/);
  const id=results[0].structuredContent.operationId,job=await c.store.get('requests/'+id);
  await q.complete({...job,response:toolResult({state:'completed',result:'original'})});
  await q.complete({...job,response:toolResult({state:'failed',result:'late'})});
  assert.equal((await q.receipt(id)).structuredContent.result,'original');
  assert.equal((await q.invoke('commander_write_file',args)).structuredContent.result,'original');
});
test('agent poll is authenticated and removes stale pending markers for completed work',async()=>{
  const c=lab(),poll=createPoll({...c,waitMs:0,delay:async()=>{}});
  assert.equal((await poll(new Request(c.origin+'/agent/poll'))).status,401);
  const id='a'.repeat(64);await c.store.setJSON('pending/'+id,{id});await c.store.setJSON('results/'+id,{response:toolResult({state:'completed'})});
  const r=await poll(new Request(c.origin+'/agent/poll',{headers:{authorization:'Bearer '+c.agentToken}}));
  assert.deepEqual((await r.json()).jobs,[]);assert.equal(await c.store.get('pending/'+id),null);
});
test('lost upload acknowledgement never reexecutes a journaled mutation; restart inspects receipt',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'navish-relay-journal-'));
  const args={callId:'once'},name='commander_write_file';
  const job={id:sha('mutation:once'),name,args,mutating:true,fingerprint:sha(canonical({name,args})),expiresAt:Date.now()+60000};
  let calls=0,uploads=0;
  const call=async()=>{calls++;return toolResult({state:'completed'});};
  try{
    await assert.rejects(executeJournaledJob({job:{...job,expiresAt:undefined},stateDir:dir,call,upload:async()=>{}}),/INVALID_JOB/);
    await assert.rejects(executeJournaledJob({job:{...job,id:'f'.repeat(64)},stateDir:dir,call,upload:async()=>{}}),/INVALID_JOB/);
    assert.equal(calls,0);
    await assert.rejects(executeJournaledJob({job,stateDir:dir,call,upload:async()=>{throw Error('lost acknowledgement');}}));
    await executeJournaledJob({job,stateDir:dir,call,upload:async()=>{uploads++;}});
    assert.equal(calls,1);assert.equal(uploads,1);
    fs.writeFileSync(path.join(dir,job.id+'.json'),JSON.stringify({state:'running',fingerprint:job.fingerprint}));
    const observed=[];
    const recovered=await executeJournaledJob({job,stateDir:dir,call:async(n,a)=>{observed.push({n,a});return toolResult({state:'uncertain',retrySafe:false});},upload:async()=>{}});
    assert.deepEqual(observed,[{n:'commander_receipt',a:{callId:'once'}}]);assert.equal(recovered.structuredContent.state,'uncertain');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('completed reads carry their durable operation identity through receipt recovery',async()=>{
  const c=lab(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'navish-call-origin-'));
  await c.store.setJSON('agent/heartbeat',{at:Date.now()});
  const q=createQueue({...c,waitMs:0});let calls=0;
  try{
    const args={device:'local',path:'/tmp/synthetic-a',offset:0,length:2,maxBytes:100};
    const queued=await q.invoke('commander_read_file',args),id=queued.structuredContent.operationId;
    const job=await c.store.get('requests/'+id);
    const reply=await executeJournaledJob({job,stateDir:dir,call:async()=>{calls++;return toolResult({state:'completed',result:{path:args.path,content:'observed'}});},upload:q.complete});
    assert.deepEqual(reply.structuredContent.connectorOperation,{operationId:id,toolName:'commander_read_file',requestSha256:sha(canonical({name:job.name,args})),device:'local',path:args.path});
    assert.deepEqual(JSON.parse(reply.content[0].text),reply.structuredContent);
    const recovered=await q.receipt(id);assert.deepEqual(recovered,reply);assert.equal(calls,1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,id+'.json'))).response.structuredContent.connectorOperation.operationId,id);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('concurrent completed reads retain distinct origins even when content is identical',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'navish-call-order-'));
  try{
    const jobs=['first','second'].map((x,i)=>{const args={device:'local',path:'/tmp/'+x};return {id:sha(x),name:'commander_read_file',args,mutating:false,fingerprint:sha(canonical({name:'commander_read_file',args})),expiresAt:Date.now()+60000};});
    const results=await Promise.all(jobs.map(job=>executeJournaledJob({job,stateDir:dir,call:async()=>toolResult({state:'completed',result:{content:'same'}}),upload:async()=>{}})));
    assert.deepEqual(results.map(r=>r.structuredContent.connectorOperation.path),['/tmp/first','/tmp/second']);
    assert.notEqual(results[0].structuredContent.connectorOperation.operationId,results[1].structuredContent.connectorOperation.operationId);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('correlation keeps failed outcomes and excludes command bodies and secrets',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'navish-call-failure-'));
  const args={device:'local',callId:'failed-call',sessionId:'failed-session',cwd:'/tmp/fixture',command:'PRIVATE_COMMAND_MARKER',env:{SECRET:'PRIVATE_ENV_MARKER'}};
  const name='commander_start_process',job={id:sha('mutation:'+args.callId),name,args,mutating:true,fingerprint:sha(canonical({name,args})),expiresAt:Date.now()+60000};
  try{
    const reply=await executeJournaledJob({job,stateDir:dir,call:async()=>toolResult({state:'failed',operationState:'failed',reason:'synthetic validation failure'},true),upload:async()=>{}});
    assert.equal(reply.isError,true);assert.equal(reply.structuredContent.state,'failed');
    assert.equal(reply.structuredContent.connectorOperation.sessionId,args.sessionId);
    assert.equal(reply.structuredContent.connectorOperation.callId,args.callId);
    assert.ok(!JSON.stringify(reply).includes('PRIVATE_'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('repository job identity survives response journaling without exposing its goal',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'navish-job-correlation-'));
  const args={device:'local',callId:'job-start',jobId:'engineering-job',repository:'/tmp/repository',goal:'PRIVATE_GOAL_MARKER'};
  const name='commander_start_job',job={id:sha('mutation:'+args.callId),name,args,mutating:true,fingerprint:sha(canonical({name,args})),expiresAt:Date.now()+60000};
  try{
    const reply=await executeJournaledJob({job,stateDir:dir,call:async()=>toolResult({state:'completed',operationState:'running'},false),upload:async()=>{}});
    assert.equal(reply.structuredContent.connectorOperation.jobId,args.jobId);
    assert.equal(reply.structuredContent.connectorOperation.repository,args.repository);
    assert.ok(!JSON.stringify(reply).includes('PRIVATE_GOAL_MARKER'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('relay queue to real stdio MCP preserves exact-once file effect and four worker artifacts',async()=>{
  const c=lab(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'navish-relay-e2e-'));
  const client=new Client({name:'relay-e2e',version:'1'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(process.env.NAVISH_MCP_SERVER||'src/server.mjs')],
    env:{...process.env,NAVISH_CONFIG_DIR:dir+'/config',NAVISH_STATE_DIR:dir+'/state',NAVISH_DATA_DIR:dir+'/data'},stderr:'pipe'}));
  fs.mkdirSync(dir+'/journal');await c.store.setJSON('agent/heartbeat',{at:Date.now()});
  const q=createQueue({...c,waitMs:0});
  async function invoke(name,args){
    const queued=await q.invoke(name,args),id=queued.structuredContent.operationId;
    if(!id)return queued.structuredContent;
    const job=await c.store.get('requests/'+id);
    await executeJournaledJob({job,stateDir:dir+'/journal',call:(name,args)=>client.callTool({name,arguments:args}),upload:q.complete});
    return (await q.receipt(id)).structuredContent;
  }
  try{
    const write={device:'local',callId:'e2e-write',path:dir+'/effect',content:'once',mode:'append'};
    assert.equal((await invoke('commander_write_file',write)).state,'completed');
    await invoke('commander_write_file',write);assert.equal(fs.readFileSync(write.path,'utf8'),'once');
    const workers=['a','b','c','d'].map(id=>{const cwd=dir+'/'+id;fs.mkdirSync(cwd);return{id,role:'isolated artifact worker',cwd,transport:'pipe',command:`printf '${id}' > result`,artifacts:[{path:'result',sha256:sha(id)}]};});
    await invoke('commander_start_batch',{device:'local',callId:'e2e-start',batchId:'e2e-batch',workers});
    const done=await invoke('commander_collect_batch',{device:'local',batchId:'e2e-batch',wait_ms:10000});
    assert.equal(done.operationState,'completed');assert.equal(done.result.counts.completed,4);
    for(const w of done.result.workers)assert.equal(w.artifacts[0].ok,true);
  }finally{await client.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('private setup never prints credentials and refuses an existing installation',async()=>{
  const {spawnSync}=await import('node:child_process');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-setup-')),dir=root+'/private';
  try{
    const run=()=>spawnSync(process.execPath,['connector/setup.mjs','https://commander.example',dir],{encoding:'utf8'});
    const first=run();assert.equal(first.status,0);
    const owner=JSON.parse(fs.readFileSync(dir+'/owner.json'));
    assert.equal((fs.statSync(dir+'/owner.json').mode&0o777),0o600);
    assert.equal((fs.statSync(dir).mode&0o777),0o700);
    assert.equal(first.stdout.includes(owner.password),false);
    assert.notEqual(run().status,0);
    assert.equal(JSON.parse(fs.readFileSync(dir+'/owner.json')).password,owner.password);
    const channelDir=root+'/channel',channel=spawnSync(process.execPath,['connector/setup.mjs','https://channel.example',channelDir,'--channel'],{encoding:'utf8'});
    assert.equal(channel.status,0);
    const secret=JSON.parse(fs.readFileSync(channelDir+'/channel-secrets.json')),agent=JSON.parse(fs.readFileSync(channelDir+'/agent.json'));
    assert.equal(agent.channelOrigin,'https://channel.example');assert.equal(secret.AGENT_TOKEN,agent.agentToken);
    assert.equal((fs.statSync(channelDir+'/channel-secrets.json').mode&0o777),0o600);
    assert.equal(channel.stdout.includes(secret.SERVER_TOKEN),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
