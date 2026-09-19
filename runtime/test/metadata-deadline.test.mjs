/** Real SQLite/process regressions. All paths are temporary owned fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {paths,ensureBase} from '../app/src/config.mjs';
import {withStateTransaction,closeStateTransactions} from '../app/src/state-lock.mjs';
import {callTool} from '../app/src/core.mjs';
import {beginCall,finishCall,loadReceipt,reconcileQuarantine,quarantinedConflicts} from '../app/src/receipts.mjs';
const lockUrl=new URL('../app/src/state-lock.mjs',import.meta.url).href;
const configUrl=new URL('../app/src/config.mjs',import.meta.url).href;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function lab(){const H=fs.mkdtempSync(path.join(os.tmpdir(),'navish-deadline-'));return {H,P:ensureBase(paths({HOME:H}))};}
function clean(L){closeStateTransactions();fs.rmSync(L.H,{recursive:true,force:true});}
async function hold(H){
 const ready=path.join(H,'ready'),release=path.join(H,'release');
 const code=`import fs from 'node:fs';import {withStateTransaction} from ${JSON.stringify(lockUrl)};import {paths} from ${JSON.stringify(configUrl)};withStateTransaction(paths({HOME:process.argv[1]}),()=>{fs.writeFileSync(process.argv[2],'held');const a=new Int32Array(new SharedArrayBuffer(4)),until=Date.now()+15000;while(!fs.existsSync(process.argv[3])){if(Date.now()>until)throw Error('release missing');Atomics.wait(a,0,0,5)}});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code,H,ready,release],{stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',x=>stderr+=x);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',c=>c===0?resolve():reject(Error(stderr)))});done.catch(()=>{});
 const deadline=performance.now()+4000;
 while(!fs.existsSync(ready)){if(child.exitCode!==null)await done;if(performance.now()>deadline){child.kill();throw Error('holder did not start')}await sleep(5)}
 return {release:async()=>{fs.writeFileSync(release,'release');await done}};
}
for(const warm of [false,true])test(`${warm?'cached':'first-use'} metadata acquisition respects its caller deadline`,async()=>{
 const L=lab();let holder;
 try{if(warm)withStateTransaction(L.P,()=>0);holder=await hold(L.H);let called=0;const start=performance.now();
 assert.throws(()=>withStateTransaction(L.P,()=>called++,{timeoutMs:50}),e=>e.code==='STATE_BUSY'&&e.metadataAcquired===false&&!('dispatched' in e));
 const elapsed=performance.now()-start;assert.equal(called,0);assert.ok(elapsed<800,`50ms metadata budget took ${elapsed}ms`);
 }finally{await holder?.release();clean(L)}
});
test('an immediate failed acquisition does not poison the next transaction',async()=>{
 const L=lab();let holder;
 try{withStateTransaction(L.P,()=>0);holder=await hold(L.H);assert.throws(()=>withStateTransaction(L.P,()=>assert.fail('must not execute'),{timeoutMs:0}),{code:'STATE_BUSY'});await holder.release();holder=null;assert.equal(withStateTransaction(L.P,()=>42,{timeoutMs:0}),42)}finally{await holder?.release();clean(L)}
});
test('invalid timeout budgets are rejected before touching metadata',()=>{
 const L=lab();try{for(const timeoutMs of [-1,1.5,NaN,Infinity,60001,'50'])assert.throws(()=>withStateTransaction(L.P,()=>assert.fail('must not run'),{timeoutMs}),RangeError);assert.equal(fs.existsSync(path.join(L.P.stateRoot,'metadata-lock.sqlite')),false)}finally{clean(L)}
});
test('database corruption is not retried or reported as ordinary contention',()=>{
 const L=lab();try{fs.writeFileSync(path.join(L.P.stateRoot,'metadata-lock.sqlite'),'not a SQLite database\n'.repeat(100));const start=performance.now();assert.throws(()=>withStateTransaction(L.P,()=>assert.fail('must not run')),(e)=>e.code==='STATE_STORAGE_ERROR'&&e.metadataAcquired===false&&e.cause.errcode===26);assert.ok(performance.now()-start<800)}finally{clean(L)}
});
test('a failing synchronous callback executes exactly once',()=>{
 const L=lab();let calls=0;const marker=Error('owned failure');try{assert.throws(()=>withStateTransaction(L.P,()=>{calls++;throw marker}),e=>e===marker);assert.equal(calls,1);assert.equal(withStateTransaction(L.P,()=>42),42)}finally{clean(L)}
});
test('async and nested async callbacks are rejected before invocation',()=>{
 const L=lab();let calls=0;try{assert.throws(()=>withStateTransaction(L.P,async()=>{calls++}),TypeError);assert.throws(()=>withStateTransaction(L.P,()=>withStateTransaction(L.P,async()=>{calls++})),TypeError);assert.equal(calls,0)}finally{clean(L)}
});
test('terminal replay preserves quarantine reconciliation and rejects changed intent',()=>{
 const L=lab(),spec={callId:'old',intent:{x:1},resources:['fixture:resource'],mutating:true};try{
 const r=beginCall(spec,L.P).receipt;finishCall(r,{state:'uncertain'},L.P);assert.equal(quarantinedConflicts(spec.resources,L.P).length,1);reconcileQuarantine({callId:'old'},L.P);assert.equal(quarantinedConflicts(spec.resources,L.P).length,0);
 assert.equal(beginCall(spec,L.P).receipt.state,'uncertain');assert.equal(quarantinedConflicts(spec.resources,L.P).length,0);assert.throws(()=>beginCall({...spec,intent:{x:2}},L.P),/different intent/);
 }finally{clean(L)}
});
test('core exact-ID replay survives unrelated damage, but new admission stays blocked',async()=>{
 const L=lab(),args={path:path.join(L.H,'effect'),content:'one\n',mode:'append'};
 try{const request={tool:'write_file',args,callId:'done'};assert.equal((await callTool(request,L.P)).state,'completed');fs.writeFileSync(path.join(L.P.stateRoot,'active-calls','unrelated.json'),'{corrupt');assert.equal((await callTool(request,L.P)).state,'completed');assert.equal(fs.readFileSync(args.path,'utf8'),'one\n');const refused=await callTool({...request,callId:'new'},L.P);assert.equal(refused.state,'failed');assert.equal(refused.dispatched,false);assert.equal(fs.readFileSync(args.path,'utf8'),'one\n')}finally{clean(L)}
});
test('core admission expiry is bounded and never dispatches a file mutation',async()=>{
 const L=lab();let holder;try{holder=await hold(L.H);const target=path.join(L.H,'must-not-exist'),start=performance.now();const r=await callTool({tool:'write_file',callId:'blocked',args:{path:target,content:'x'},timeoutMs:50},L.P);assert.equal(r.state,'failed');assert.equal(r.code,'STATE_BUSY');assert.equal(r.dispatched,false);assert.equal(fs.existsSync(target),false);assert.ok(performance.now()-start<800)}finally{await holder?.release();clean(L)}
});
test('audit failure cannot misclassify or repeat a completed file mutation',async()=>{
 const L=lab();try{fs.mkdirSync(L.P.auditLog);const args={path:path.join(L.H,'effect'),mode:'append',content:'one\n'},request={tool:'write_file',callId:'audit',args};const r=await callTool(request,L.P);assert.equal(r.state,'completed');assert.equal(r.auditRecorded,false);assert.equal(loadReceipt('audit',L.P).state,'completed');assert.equal((await callTool(request,L.P)).state,'completed');assert.equal(fs.readFileSync(args.path,'utf8'),'one\n')}finally{clean(L)}
});
