import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {paths,ensureBase} from '../../app/src/config.mjs';
import {callTool,observeLocalTool,TOOL_NAMES} from '../../app/src/core.mjs';
import {readOutputWindow,startProcessTool,inspectProcessSession} from '../../app/src/process.mjs';
import {closeStateTransactions} from '../../app/src/state-lock.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const INVOKE=path.join(ROOT,'test/runtime/invoke.mjs');
const homes=[];let serial=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function setup(){const home=fs.mkdtempSync(path.join(os.tmpdir(),'navish-runtime-'));homes.push(home);const P=paths({HOME:home});ensureBase(P);return {home,P}}
function call(P,tool,args,callId='test-'+(++serial)){return callTool({tool,args,callId,timeoutMs:3000},P)}
function worker(id,home,extra={}){return {id,role:'deterministic test worker',cwd:home,command:`printf '${id}' > ${id}.txt`,startTimeoutMs:0,...extra}}
function requestFile(home,request){const file=path.join(home,'request-'+(++serial)+'.json');fs.writeFileSync(file,JSON.stringify(request));return file}
function child(home,request){return spawn(process.execPath,[INVOKE,ROOT,home,requestFile(home,request)],{stdio:['ignore','pipe','pipe']})}
async function result(proc){let out='',err='';proc.stdout.on('data',b=>out+=b);proc.stderr.on('data',b=>err+=b);await new Promise((resolve,reject)=>{proc.on('error',reject);proc.on('close',(code)=>code===0?resolve():reject(new Error('child exit '+code+' '+err)))});return JSON.parse(out.trim())}
async function until(predicate,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){if(predicate())return;await sleep(15)}throw new Error('condition not observed')}
function batchFile(P,id){return path.join(P.stateRoot,'agent-batches',id+'.json')}

test('full core imports both Ego tools and real execution primitives',()=>{for(const name of ['browser_agent','browser_agent_health','start_process','agent_batch_collect'])assert.ok(TOOL_NAMES.includes(name))});
test('observation API rejects mutation and unknown tools before dispatch',async()=>{
  const {home,P}=setup();
  for(const tool of ['write_file','start_process','browser_agent','future_tool']){
    await assert.rejects(observeLocalTool({tool,args:{path:path.join(home,'effect'),content:'bad'}},P),{code:'OBSERVATION_TOOL_NOT_ALLOWED'});
  }
  assert.equal(fs.existsSync(path.join(home,'effect')),false);
  assert.deepEqual(fs.readdirSync(P.receiptsDir),[]);
});
test('one call runs three real PTY workers and verifies declared artifact hashes',async()=>{
  const {home,P}=setup();const workers=['alpha','beta','gamma'].map(id=>worker(id,home,{artifacts:[{path:id+'.txt',sha256:crypto.createHash('sha256').update(id).digest('hex')}]}));
  const receipt=await call(P,'agent_batch_start',{batchId:'complete',workers,wait_ms:5000});
  assert.equal(receipt.state,'completed');assert.equal(receipt.result.state,'completed');assert.equal(receipt.result.counts.completed,3);
  for(const w of receipt.result.workers){assert.equal(w.exitCode,0);assert.equal(w.artifacts[0].ok,true);assert.ok(w.sessionId);assert.equal('env' in w,false);assert.equal('command' in w,false)}
  assert.equal(receipt.result.goalVerified,false);
});
test('same batch and spec under a new request reuse completed workers',async()=>{
  const {home,P}=setup();const args={batchId:'reuse',workers:[worker('x',home,{command:'printf x >> effects.txt'})],wait_ms:5000};
  const one=await call(P,'agent_batch_start',args),two=await call(P,'agent_batch_start',args);
  assert.equal(two.result.reused,true);assert.equal(two.result.workers[0].sessionId,one.result.workers[0].sessionId);assert.equal(fs.readFileSync(path.join(home,'effects.txt'),'utf8'),'x');
});
test('same call ID and exact request returns the same durable receipt',async()=>{
  const {home,P}=setup(),args={batchId:'receipt',workers:[worker('x',home,{command:'printf x >> effect'})],wait_ms:5000};
  const a=await call(P,'agent_batch_start',args,'exact'),b=await call(P,'agent_batch_start',args,'exact');
  assert.deepEqual(b,a);assert.equal(fs.readFileSync(path.join(home,'effect'),'utf8'),'x');
});
test('conflicting batch specification is rejected without a second effect',async()=>{
  const {home,P}=setup(),args={batchId:'conflict',workers:[worker('x',home)],wait_ms:5000};
  assert.equal((await call(P,'agent_batch_start',args)).result.state,'completed');
  const r=await call(P,'agent_batch_start',{...args,workers:[worker('x',home,{command:'printf BAD > bad'})]});
  assert.equal(r.state,'failed');assert.match(r.reason,/different worker specification/);assert.equal(fs.existsSync(path.join(home,'bad')),false);
});
test('bounded local wait returns running, not false task completion',async()=>{
  const {home,P}=setup();const r=await call(P,'agent_batch_start',{batchId:'bounded',workers:[worker('x',home,{command:'sleep .5; printf x > x.txt'})],wait_ms:25});
  assert.equal(r.result.state,'running');assert.equal(r.result.waitExpired,true);
  const done=await call(P,'agent_batch_collect',{batchId:'bounded',wait_ms:5000});assert.equal(done.result.state,'completed');
});
test('nonzero worker exit remains a failed task although observation call completes',async()=>{
  const {home,P}=setup();const r=await call(P,'agent_batch_start',{batchId:'failed',workers:[worker('x',home,{command:'printf issue; exit 7'})],wait_ms:5000});
  assert.equal(r.state,'completed');assert.equal(r.result.state,'failed');assert.equal(r.result.workers[0].exitCode,7);
});
test('one invalid launch retains its diagnostic while other workers complete once',async()=>{
  const {home,P}=setup();
  const args={batchId:'mixed-launch',workers:[
    worker('ok',home,{command:'printf once >> effects.txt'}),
    worker('bad',path.join(home,'absent-directory'))
  ],wait_ms:5000};
  const first=await call(P,'agent_batch_start',args);
  assert.equal(first.result.state,'failed');
  assert.equal(first.result.workers[0].state,'completed');
  assert.equal(first.result.workers[1].state,'failed');
  assert.ok(first.result.workers[1].launchError);
  const again=await call(P,'agent_batch_start',args);
  assert.equal(again.result.reused,true);
  assert.equal(again.result.workers[1].state,'failed');
  assert.equal(fs.readFileSync(path.join(home,'effects.txt'),'utf8'),'once');
});
test('exit zero does not satisfy a missing artifact contract',async()=>{
  const {home,P}=setup();const r=await call(P,'agent_batch_start',{batchId:'artifact',workers:[worker('x',home,{command:'true',artifacts:[{path:'missing.txt'}]})],wait_ms:5000});
  assert.equal(r.result.state,'failed');assert.equal(r.result.workers[0].processState,'completed');assert.equal(r.result.workers[0].artifacts[0].ok,false);
});
test('wrong artifact hash fails validation',async()=>{
  const {home,P}=setup();const r=await call(P,'agent_batch_start',{batchId:'hash',workers:[worker('x',home,{artifacts:[{path:'x.txt',sha256:'0'.repeat(64)}]})],wait_ms:5000});assert.equal(r.result.state,'failed');
});
test('artifact symlink outside worker cwd is not read as evidence',async()=>{
  const {home,P}=setup();const dir=path.join(home,'work');fs.mkdirSync(dir);fs.writeFileSync(path.join(home,'outside'),'private');
  const r=await call(P,'agent_batch_start',{batchId:'link',workers:[worker('x',dir,{command:'ln -s ../outside x.txt',artifacts:[{path:'x.txt'}]})],wait_ms:5000});
  assert.equal(r.result.state,'failed');assert.equal(r.result.workers[0].artifacts[0].reason,'artifact outside worker directory');
});
test('invalid budgets rejected before worker launch',async()=>{
  const {home,P}=setup();for(const wait of [-1,NaN,Infinity,300001]){
    const r=await call(P,'agent_batch_start',{batchId:'invalid'+serial,workers:[worker('x',home)],wait_ms:wait});assert.equal(r.state,'failed');
  }assert.equal(fs.readdirSync(P.sessionsDir).length,0);
});
test('unknown legacy worker stays uncertain rather than being restarted',async()=>{
  const {P}=setup();fs.mkdirSync(path.dirname(batchFile(P,'legacy')),{recursive:true});fs.writeFileSync(batchFile(P,'legacy'),JSON.stringify({version:1,batchId:'legacy',workers:[{id:'x',state:'launching'}]}));
  const r=await call(P,'agent_batch_collect',{batchId:'legacy'});assert.equal(r.result.state,'uncertain');assert.equal(r.result.counts.unknown,1);assert.equal(fs.readdirSync(P.sessionsDir).length,0);
});
test('output pagination reads the requested prefix instead of silently skipping to the tail',()=>{
  const {home}=setup(),file=path.join(home,'log');fs.writeFileSync(file,'0123456789ABCDEF');
  const r=readOutputWindow(file,3,4);assert.equal(r.output,'3456');assert.equal(r.nextOffset,7);assert.equal(readOutputWindow(file,r.nextOffset,4).output,'789A');
});
test('sparse 2 GiB log needs only a 32-byte buffer and no full-file read',()=>{
  const {home}=setup(),file=path.join(home,'large');const fd=fs.openSync(file,'w');fs.ftruncateSync(fd,2**31);fs.writeSync(fd,Buffer.from('TAIL'),0,4,2**31-4);fs.closeSync(fd);
  const original=fs.readFileSync;fs.readFileSync=function(p,...args){assert.notEqual(p,file,'must not read full process log');return original.call(this,p,...args)};
  try{const r=readOutputWindow(file,-32,32);assert.equal(r.output.slice(-4),'TAIL');assert.equal(r.totalBytes,2**31);assert.equal(Buffer.byteLength(r.output),32)}finally{fs.readFileSync=original}
});
test('malformed output limits fail closed',()=>{for(const bytes of [0,-1,NaN,Infinity,4*1024*1024+1])assert.throws(()=>readOutputWindow('/unused',0,bytes),/byte limit/)});
test('batch output collection respects a total byte budget',async()=>{
  const {home,P}=setup();const workers=['a','b'].map(id=>worker(id,home,{command:'python3 -c "print(\'x\'*12000)"'}));
  const r=await call(P,'agent_batch_start',{batchId:'output',workers,wait_ms:5000,maxTotalBytes:200,maxBytesPerWorker:10000});
  assert.equal(r.result.state,'completed');assert.ok(r.result.workers.reduce((n,w)=>n+Buffer.byteLength(w.output),0)<=200);
});
test('durable process identity prevents relaunch under a new request',async()=>{
  const {home,P}=setup(),args={sessionId:'stable-process',command:'printf x >> effect',cwd:home,timeout_ms:500};
  const a=await startProcessTool(args,P),b=await startProcessTool(args,P);assert.equal(a.state,'completed');assert.equal(b.reused,true);assert.equal(b.pid,a.pid);assert.equal(fs.readFileSync(path.join(home,'effect'),'utf8'),'x');
  await assert.rejects(startProcessTool({...args,command:'printf wrong'},P),e=>e.code==='PROCESS_SESSION_CONFLICT');
});
test('process session identity rejects invalid paths',async()=>{const {P}=setup();await assert.rejects(startProcessTool({sessionId:'../wrong',command:'true'},P),/invalid session/)});
test('launch claim without metadata remains uncertain after owner death',()=>{
  const {P}=setup(),dir=path.join(P.sessionsDir,'lost');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'launch.json'),JSON.stringify({owner:{pid:2147483647}}));
  assert.equal(inspectProcessSession('lost',P).state,'uncertain');
});
test('real workers remain discoverable after their caller process is killed',async()=>{
  const {home,P}=setup(),workers=['a','b','c'].map(id=>worker(id,home,{command:`printf started > ${id}.txt; sleep .6; printf done >> ${id}.txt`,startTimeoutMs:10000}));
  const proc=child(home,{tool:'agent_batch_start',callId:'crash-caller',args:{batchId:'crash',workers}});
  proc.stderr.resume();proc.stdout.resume();
  await until(()=>workers.every(w=>fs.existsSync(path.join(home,w.id+'.txt'))));
  const before=JSON.parse(fs.readFileSync(batchFile(P,'crash'),'utf8'));assert.ok(before.workers.every(w=>w.sessionId));
  const closed=new Promise(r=>proc.once('close',r));proc.kill('SIGKILL');await closed;
  const recovered=await result(child(home,{tool:'agent_batch_collect',callId:'reconnect',args:{batchId:'crash',wait_ms:5000}}));
  assert.equal(recovered.result.state,'completed');assert.equal(recovered.result.counts.completed,3);
  for(const w of recovered.result.workers){assert.equal(w.exitCode,0);assert.equal(fs.readFileSync(path.join(home,w.id+'.txt'),'utf8'),'starteddone')}
  const receipt=JSON.parse(fs.readFileSync(path.join(P.receiptsDir,'crash-caller.json'),'utf8'));assert.equal(receipt.state,'uncertain');
  const replay=await result(child(home,{tool:'agent_batch_start',callId:'crash-caller',args:{batchId:'crash',workers}}));assert.equal(replay.state,'uncertain');
  assert.equal(fs.readdirSync(P.sessionsDir).length,3);
});
test('independent simultaneous callers cannot duplicate a worker batch',async()=>{
  const {home}=setup(),request={tool:'agent_batch_start',callId:'simultaneous',args:{batchId:'simultaneous',workers:[worker('x',home,{command:'printf once >> effect; sleep .1'})],wait_ms:5000}};
  const receipts=await Promise.all(Array.from({length:4},()=>result(child(home,request))));
  for(const r of receipts)assert.ok(['running','completed'].includes(r.state));
  const completed=receipts.filter(r=>r.state==='completed');assert.ok(completed.length>=1);
  assert.equal(new Set(completed.map(r=>r.result.workers[0].sessionId)).size,1);assert.equal(fs.readFileSync(path.join(home,'effect'),'utf8'),'once');
});
test('durable batch list is paginated and bounded',async()=>{
  const {home,P}=setup();for(let i=0;i<3;i++)await call(P,'agent_batch_start',{batchId:'list'+i,workers:[worker('x',home)],wait_ms:5000});
  const r=await call(P,'agent_batch_list',{limit:2});assert.equal(r.result.batches.length,2);assert.equal(r.result.nextOffset,2);
});

test.after(()=>{closeStateTransactions();fs.writeFileSync(path.join(ROOT,'test-runtime-homes.json'),JSON.stringify(homes,null,2)+'\n')});
