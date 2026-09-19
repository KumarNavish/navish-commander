import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {paths,ensureBase} from '../app/src/config.mjs';
import {beginCall,finishCall,loadReceipt} from '../app/src/receipts.mjs';
import {withStateTransaction} from '../app/src/state-lock.mjs';
const lockUrl=new URL('../app/src/state-lock.mjs',import.meta.url).href;
const configUrl=new URL('../app/src/config.mjs',import.meta.url).href;
const fresh=()=>{const H=fs.mkdtempSync(path.join(os.tmpdir(),'navish-metadata-cert-'));return {H,P:ensureBase(paths({HOME:H}))}};
const spec=id=>({callId:id,intent:{tool:'fixture',id},resources:['fixture:page'],mutating:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function startHolder(H,ms){
 const ready=path.join(H,'holder-'+Math.random()+'.ready'),release=ready+'.release';
 const code=`import fs from 'node:fs';import {withStateTransaction} from ${JSON.stringify(lockUrl)};import {paths} from ${JSON.stringify(configUrl)};withStateTransaction(paths({HOME:process.argv[1]}),()=>{fs.writeFileSync(process.argv[2],'locked');const cell=new Int32Array(new SharedArrayBuffer(4));if(process.argv[3]==='manual'){const until=Date.now()+15000;while(!fs.existsSync(process.argv[4])){if(Date.now()>until)throw new Error('explicit fixture release missing');Atomics.wait(cell,0,0,10)}}else Atomics.wait(cell,0,0,Number(process.argv[3]));});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code,H,ready,ms===null?'manual':String(ms),release],{stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',d=>stderr+=d);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('owned lock holder failed: '+stderr)))});
 const deadline=Date.now()+5000;
 while(!fs.existsSync(ready)){if(child.exitCode!==null)await done;if(Date.now()>=deadline){child.kill('SIGTERM');throw new Error('owned lock holder did not become ready')}await sleep(10)}
 return {done,release:()=>fs.writeFileSync(release,'release')};
}

test('completion waits through contention without repeating the effect',async()=>{
 const {H,P}=fresh(),r=beginCall(spec('completion'),P).receipt;
 const effect=path.join(H,'effects');fs.appendFileSync(effect,'effect\n');
 const {done}=await startHolder(H,1900);
 const result=finishCall(r,{state:'completed',result:{ok:true}},P);
 await done;
 assert.equal(result.state,'completed');
 assert.equal(fs.readFileSync(effect,'utf8'),'effect\n');
 assert.equal(beginCall(spec('completion'),P).replay,true);
});
test('acquisition timeout does not invoke the metadata operation',async()=>{
 const {H,P}=fresh();const holder=await startHolder(H,null);let calls=0;
 try{assert.throws(()=>withStateTransaction(P,()=>calls++,{timeoutMs:50}),e=>e.code==='STATE_BUSY'&&e.metadataAcquired===false&&e.dispatched===undefined);assert.equal(calls,0)}finally{holder.release();await holder.done}
 assert.equal(withStateTransaction(P,()=>42),42);
});
test('post-effect finalization timeout is uncertain, and only metadata is retried',async()=>{
 const {H,P}=fresh(),r=beginCall(spec('pending'),P).receipt;
 const effect=path.join(H,'effects');fs.appendFileSync(effect,'effect\n');
 const holder=await startHolder(H,null);
 try{assert.throws(()=>finishCall(r,{state:'completed',result:{ok:true}},P,{timeoutMs:50}),e=>e.code==='STATE_BUSY'&&e.uncertain===true&&e.dispatched===true&&e.receiptFinalizationPending===true);
 assert.equal(loadReceipt('pending',P).state,'running')}finally{holder.release();await holder.done}
 assert.equal(finishCall(r,{state:'completed',result:{ok:true}},P).state,'completed');
 assert.equal(fs.readFileSync(effect,'utf8'),'effect\n');
});
test('completed same-ID replay does not scan unrelated active owners',()=>{
 const {P}=fresh(),r=beginCall(spec('already-done'),P).receipt;
 finishCall(r,{state:'completed',result:{value:1}},P);
 fs.writeFileSync(path.join(P.stateRoot,'active-calls/unrelated.json'),'{broken');
 assert.deepEqual(beginCall(spec('already-done'),P).receipt.result,{value:1});
 assert.throws(()=>beginCall(spec('new-admission'),P));
});
