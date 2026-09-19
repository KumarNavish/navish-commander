import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
import {classifyExecution,processCommand,executeNavish} from '../app/src/control-bridge.mjs';
import {generateX25519KeyPair,encryptRequest,PROTOCOL} from '../app/src/control-crypto.mjs';
import {acquireBridgeLock,inspectBridgeLock} from '../app/src/control-lock.mjs';
import {closeStateTransactions} from '../app/src/state-lock.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const structured=(state,exitCode,extra={})=>({exitCode,signal:null,error:null,stdout:{text:JSON.stringify({callId:'x',state}),truncated:false},...extra});
for(const [state,code] of [['completed',0],['failed',2],['uncertain',3],['blocked',3],['expired',3]])test('transport preserves core '+state,()=>assert.equal(classifyExecution(structured(state,code),'x').state,state));
for(const [name,result] of [
 ['success exit with invalid JSON',{exitCode:0,stdout:{text:'not a receipt'}}],
 ['success exit with uncertain receipt',structured('uncertain',0)],
 ['error exit with completed receipt',structured('completed',2)],
 ['truncated receipt',structured('completed',0,{stdout:{text:'{}',truncated:true}})],
 ['wrong call ID',structured('completed',0,{stdout:{text:JSON.stringify({callId:'another',state:'completed'})}})],
 ['terminated process',structured('completed',0,{signal:'SIGTERM'})],
 ['nonterminal core receipt',structured('running',3)],
])test(name+' cannot become completion or a replayable failure',()=>assert.equal(classifyExecution(result,'x').state,'uncertain'));
test('known executable-not-found is a pre-dispatch failure',()=>assert.equal(classifyExecution({exitCode:null,error:'spawnSync command ENOENT'},'x').state,'failed'));
function lab(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-controller-test-'));fs.mkdirSync(root+'/receipts');const keys=generateX25519KeyPair();fs.writeFileSync(root+'/private.pem',keys.privateKeyPem,{mode:0o600});return {root,keys,paths:{stateRoot:root,receiptsDir:root+'/receipts',privateKeyFile:root+'/private.pem'},config:{controllerId:'test'}};}
function request(L,{id='x',content='test',expiresAt=new Date(Date.now()+60000).toISOString()}={}){return encryptRequest({devicePublicKeyPem:L.keys.publicKeyPem,payload:{targetDevice:'local',tool:'write_file',args:{path:L.root+'/effect.txt',content},timeoutMs:5000},meta:{protocol:PROTOCOL,commandId:id,controllerId:'test',createdAt:new Date().toISOString(),expiresAt}}).envelope;}
function cleanup(L){closeStateTransactions();fs.rmSync(L.root,{recursive:true,force:true});}
test('identical encrypted request reuses terminal evidence without calling executor twice',()=>{const L=lab();try{const envelope=request(L);let calls=0;const executor=()=>{calls++;return structured('completed',0)};const a=processCommand({...L,envelope,executor});const b=processCommand({...L,envelope,executor});assert.equal(a.terminal.state,'completed');assert.equal(b.replayedTerminal,true);assert.equal(calls,1)}finally{cleanup(L)}});
test('same command ID with different authenticated request is rejected',()=>{const L=lab();try{let calls=0;const executor=()=>{calls++;return structured('completed',0)};processCommand({...L,envelope:request(L),executor});const b=processCommand({...L,envelope:request(L,{content:'different'}),executor});assert.equal(b.reason,'COMMAND_ID_CONFLICT');assert.equal(b.terminal,undefined);assert.equal(calls,1)}finally{cleanup(L)}});
test('unauthenticated expired metadata cannot create an expired receipt',()=>{const L=lab();try{const envelope=request(L);envelope.expiresAt='2000-01-01T00:00:00.000Z';const b=processCommand({...L,envelope,executor:()=>{throw Error('must not dispatch')}});assert.equal(b.reason,'REQUEST_AUTHENTICATION_FAILED');assert.equal(fs.readdirSync(L.paths.receiptsDir).length,0)}finally{cleanup(L)}});
test('legacy unpublished receipt cannot be encrypted for a new response key',()=>{const L=lab();try{fs.writeFileSync(L.paths.receiptsDir+'/x.json',JSON.stringify({commandId:'x',state:'completed',result:{private:'original response'}}));const b=processCommand({...L,envelope:request(L),executor:()=>{throw Error('must not dispatch')}});assert.equal(b.reason,'LEGACY_RECEIPT_RECONCILIATION_REQUIRED');assert.equal(b.terminal,undefined)}finally{cleanup(L)}});
test('uncertain duplicate does not replay an effect',()=>{const L=lab();try{const envelope=request(L);let calls=0;const executor=()=>{calls++;fs.appendFileSync(L.root+'/effect','once\n');return structured('uncertain',3)};processCommand({...L,envelope,executor});const b=processCommand({...L,envelope,executor});assert.equal(b.terminal.state,'uncertain');assert.equal(calls,1);assert.equal(fs.readFileSync(L.root+'/effect','utf8'),'once\n')}finally{cleanup(L)}});
test('malformed singleton lock remains quarantined, not silently stolen',()=>{const L=lab();try{fs.writeFileSync(L.root+'/bridge.lock','');assert.equal(inspectBridgeLock(L.paths).uncertain,true);assert.throws(()=>acquireBridgeLock(L.paths),/BRIDGE_LOCK_UNCERTAIN/);assert.equal(fs.readFileSync(L.root+'/bridge.lock','utf8'),'')}finally{cleanup(L)}});
test('singleton lock refuses a live owner and releases only its own token',()=>{const L=lab();try{const release=acquireBridgeLock(L.paths);assert.equal(inspectBridgeLock(L.paths).held,true);assert.throws(()=>acquireBridgeLock(L.paths),/BRIDGE_ALREADY_RUNNING/);const p=L.root+'/bridge.lock',old=JSON.parse(fs.readFileSync(p));fs.writeFileSync(p,JSON.stringify({...old,lockToken:'replacement'}));release();assert.equal(JSON.parse(fs.readFileSync(p)).lockToken,'replacement')}finally{cleanup(L)}});
test('known dead legacy owner can be reclaimed',()=>{const L=lab();try{const p=spawnSync(process.execPath,['-e','console.log(process.pid)'],{encoding:'utf8'});assert.equal(p.status,0);fs.writeFileSync(L.root+'/bridge.lock',JSON.stringify({pid:Number(p.stdout.trim()),startedAt:'test'}));const release=acquireBridgeLock(L.paths);assert.equal(inspectBridgeLock(L.paths).pid,process.pid);release();assert.equal(inspectBridgeLock(L.paths).held,false)}finally{cleanup(L)}});
test('eight independent controllers have one singleton owner',async()=>{const L=lab();try{
 const mod=pathToFileURL(ROOT+'/app/src/control-lock.mjs').href;
 const code=`import fs from 'node:fs';import {acquireBridgeLock} from ${JSON.stringify(mod)};console.log('ready');while(!fs.existsSync(${JSON.stringify(L.root+'/go')}))await new Promise(r=>setTimeout(r,5));try{const release=acquireBridgeLock({stateRoot:${JSON.stringify(L.root)}});console.log('owned');await new Promise(r=>setTimeout(r,1200));release()}catch(e){console.log(e.code||e.message)}`;
 const children=Array.from({length:8},()=>{const c=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});let text='',err='';let readyResolve;const ready=new Promise(r=>readyResolve=r);c.stdout.on('data',d=>{text+=d;if(text.includes('ready'))readyResolve()});c.stderr.on('data',d=>err+=d);const done=new Promise((resolve,reject)=>{c.on('error',reject);c.on('exit',code=>code===0?resolve(text):reject(new Error(err)))});return {ready,done};});
 await Promise.all(children.map(c=>c.ready));fs.writeFileSync(L.root+'/go','start');const outputs=await Promise.all(children.map(c=>c.done));assert.equal(outputs.filter(s=>s.includes('\nowned\n')).length,1);assert.equal(outputs.filter(s=>s.includes('BRIDGE_ALREADY_RUNNING')).length,7);
}finally{cleanup(L)}});
