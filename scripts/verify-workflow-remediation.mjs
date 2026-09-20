#!/usr/bin/env node
// Verify recorded outcomes, not execute tasks or turn failures into acceptance.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {sourceDigest} from './benchmark-evidence.mjs';
import {connectorDigest} from '../connector/source-digest.mjs';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const r=JSON.parse(fs.readFileSync(process.argv[2]||'evidence/workflow-remediation-20260920.json','utf8'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const count=xs=>xs.reduce((a,x)=>(a[x]=(a[x]||0)+1,a),{});
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const equal=(a,b)=>canonical(a)===canonical(b);
function subset(a,e){
 if(e&&typeof e==='object'&&!Array.isArray(e)){assert.ok(a&&typeof a==='object');for(const [k,v] of Object.entries(e))subset(a[k],v);}
 else assert.deepEqual(a,e);
}
function objects(text){
 const values=[];
 for(let start=0;start<text.length;start++){
  if(text[start]!=='{')continue;
  let depth=0,quoted=false,escaped=false;
  for(let end=start;end<text.length;end++){
   const ch=text[end];
   if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
   if(ch==='"')quoted=true;
   else if(ch==='{')depth++;
   else if(ch==='}'&&--depth===0){try{values.push(JSON.parse(text.slice(start,end+1)));}catch{}break;}
  }
 }
 return values;
}
assert.equal(r.schema,'navish.workflow-remediation/v1');
assert.equal(r.protocols.continuation.sourceCommit,'f0d9d50a4352c6d48a6ac3855d14e64db3e10827');
assert.equal(r.protocols.continuation.connectorSha256,'cf060ded9e13d2ae14c5e3e7488e78962088daef8d0c3395c82732086deb48cb');
assert.equal(r.continuationDeployment.installedConnectorSha256,r.protocols.continuation.connectorSha256);
assert.equal(r.continuationDeployment.installedRuntimeSha256,r.protocols.continuation.runtimeSha256);
assert.equal(r.protocols.confirmation.connectorSha256,connectorDigest());
assert.equal(r.protocols.confirmation.runtimeSha256,sourceDigest());
assert.equal(r.deployment.connectorSourceSha256,connectorDigest());
assert.equal(r.deployment.installedRuntimeSourceSha256,sourceDigest());
assert.equal(r.deployment.status.online,true);assert.equal(r.deployment.status.pending,0);
for(const x of [r.deployment.front,r.deployment.channel,r.deployment.status])assert.equal(x.connector.sourceSha256,connectorDigest());
const definitions=Object.entries(r.protocols).flatMap(([phase,p])=>p.cases.map(c=>({phase,c})));
assert.equal(new Set(r.records.map(x=>x.case.id)).size,definitions.length);
assert.deepEqual(r.records.map(x=>x.case.id),definitions.map(x=>x.c.id));
for(const [index,x] of r.records.entries()){
 assert.equal(x.phase,definitions[index].phase);assert.deepEqual(x.case,definitions[index].c);
 assert.equal(x.submission.promptMatched,true);assert.equal(x.completion.promptMatched,true);
 assert.equal(x.submission.mode.power,'3');assert.deepEqual(x.submission.mode.selected,['Latest']);
 assert.ok(Date.parse(x.submission.at)>Date.parse(r.protocols[x.phase].frozenAt));
 assert.ok(Date.parse(x.completion.at)>=Date.parse(x.submission.at));
 assert.equal(x.completion.supervisorApprovalClicks,0);assert.equal(x.completion.correctivePrompts,0);
 assert.equal(x.calls.length,x.score.toolCalls);
 for(const [name,digest] of Object.entries(x.case.inputHashes||{})){
  if(x.case.family==='code_repair'&&name===r.oracles[x.case.id].module)continue;
  assert.equal(x.host.fileHashes[name],digest,x.case.id+' input '+name);
 }
 for(const [name,text] of Object.entries(x.outputs))assert.equal(hash(text),x.host.fileHashes[name]);
 for(const [i,c] of x.calls.entries()){
  // The export omits the connector label on some calls. Preserve that null;
  // attribution must still pass the independent journal/receipt checks below.
  assert.ok(c.connector==='Navish Commander'||c.connector===null);
  assert.ok(c.name.startsWith('commander_'));
  if(c.toolInput.device!==undefined)assert.equal(c.toolInput.device,'local');
  if(c.toolInput.path!==undefined)assert.ok(c.toolInput.path.startsWith(x.case.taskRoot+'/'));
  if(c.toolInput.cwd!==undefined)assert.ok(c.toolInput.cwd===x.case.taskRoot||c.toolInput.cwd.startsWith(x.case.taskRoot+'/'));
  const o=x.host.journalObservations[i];assert.equal(o.callIndex,i);assert.equal(o.toolName,c.name);
  const receipt=(x.receiptObservations||[]).find(v=>v.callIndex===i);
  const rejection=(x.preDispatchRejections||[]).find(v=>v.callIndex===i);
  assert.ok(o.matches.length||receipt||rejection,c.name+' lacks host evidence');
  if(receipt){assert.equal(receipt.matchesExport,true);assert.deepEqual(receipt.result,c.toolOutput);}
  if(rejection){
   assert.deepEqual(rejection.result,c.toolOutput);
   assert.equal(c.toolOutput.code,'CALL_ID_CONFLICT');assert.equal(c.toolOutput.dispatched,false);
   assert.equal(rejection.operationId,hash('mutation:'+c.toolInput.callId));
   assert.equal(rejection.attemptedFingerprint,o.fingerprint);
   assert.notEqual(rejection.originalFingerprint,rejection.attemptedFingerprint);
   assert.ok(x.host.journalObservations.some(v=>v.fingerprint===rejection.originalFingerprint&&v.matches.some(m=>equal(m.result,rejection.originalResult))));
  }
  for(const m of o.matches)assert.equal(m.state,'finished');
  const v=c.toolOutput,n=v&&typeof v==='object'?{...v}:v;if(n&&typeof n==='object')delete n.is_error;
  const comparison=o.matches.some(m=>equal(m.result,v))?'exact':v===null?'null_ui_output':o.matches.some(m=>equal(m.result,n))?'ui_error_annotation_only':'no_exact_output_match';
  assert.deepEqual(x.outputAudit[i],{callIndex:i,comparison});
 }
 assert.deepEqual(x.score.platformBlockedCalls,x.calls.flatMap((c,i)=>typeof c.toolOutput==='string'&&c.toolOutput.includes('blocked by OpenAI')?[i]:[]));
 if(x.score.status==='passed'){
  assert.deepEqual(x.score.failures,[]);
  const family=x.case.family,e=r.oracles[x.case.id];
  if(['reconciliation','data_analysis'].includes(family))subset(JSON.parse(x.outputs['result.json']),e);
  if(family==='code_repair'){
   assert.equal(x.independentChecks.passed,true);assert.deepEqual(x.independentChecks.failures,[]);
   assert.ok(Number.isInteger(x.independentChecks.checks)&&x.independentChecks.checks>0);
   if(x.case.id==='10-topology')assert.equal(x.independentChecks.checks,93);
   assert.ok(x.outputs['test_regression.py']);
  }
  if(family.startsWith('parallel')){
   const summary=JSON.parse(x.outputs['summary.json']);
   for(const [field,success] of [['successfulWorkers',true],['failedWorkers',false]]){
    if(Array.isArray(summary[field])){
     const names=Object.entries(e.workers).filter(([,v])=>(v.state==='completed')===success).map(([k])=>k).sort();
     assert.deepEqual([...summary[field]].sort(),names);
     summary[field]=summary[field].length;
    }
   }
   subset(summary,e);
   for(const [name,result] of Object.entries(e.workers))subset(JSON.parse(x.outputs[name+'/result.json']),result);
   assert.equal(x.host.sessions.length,4);
   assert.deepEqual(x.host.sessions.map(s=>s.record.exitCode).sort(),family==='parallel_partial_failure'?[0,0,0,2]:[0,0,0,0]);
  }
  if(x.phase==='continuation')assert.ok(x.host.sessions.some(s=>s.record.exitCode===0),'no successful execution');
  if(x.phase==='confirmation'){
   assert.equal(x.review.passed,true);
   assert.ok(objects(x.response).some(v=>{try{subset(v,e);return true;}catch{return false;}}),'confirmation answer differs from frozen oracle');
   if(x.case.sourceCase){
    const before=r.records.find(p=>p.case.id===x.case.sourceCase).host;
    assert.deepEqual(x.host.fileHashes,before.fileHashes);
    for(const field of ['receipts','sessions','batches'])assert.deepEqual(x.host[field].map(v=>v.sha256).sort(),before[field].map(v=>v.sha256).sort());
   }else{assert.equal(x.host.sessions.length,0);assert.equal(x.host.receipts.length,0);}
   assert.ok(x.calls.every(c=>['commander_devices','commander_read_file','commander_receipt','commander_connector_receipt','commander_process_output','commander_collect_batch'].includes(c.name)));
   assert.ok(x.receiptObservations.length>0,'no actual receipt recovery');
   assert.ok(x.calls.some(c=>c.toolOutput?.connectorOperation?.operationId),'no correlated response observed');
   for(const [i,c] of x.calls.entries()){
    if(c.name!=='commander_read_file')continue;
    const origin=c.toolOutput?.connectorOperation;
    assert.equal(origin?.toolName,c.name,'read response tool identity');
    assert.equal(origin?.path,c.toolInput.path,'read response target identity');
    assert.equal(origin?.requestSha256,x.host.journalObservations[i].fingerprint);
   }
  }
 }
}
for(const [phase,p] of Object.entries(r.protocols)){
 const xs=r.records.filter(x=>x.phase===phase);
 assert.equal(xs.length,p.cases.length);
 assert.deepEqual(r.totals[phase],{conversations:xs.length,exportedCalls:xs.reduce((n,x)=>n+x.calls.length,0),outcomes:count(xs.map(x=>x.score.status))});
}
const partial=r.records.find(x=>x.case.id==='09-pagination-code');
assert.equal(partial.review.falseNoChangeReport,true);
assert.ok(partial.host.receipts.some(x=>x.record.callId==='rem20-09-pagination-code-write-pages'&&x.record.state==='completed'));
assert.ok(partial.unexportedHostResults.some(x=>x.result.callId==='rem20-09-pagination-code-write-pages'));
const recovery=r.records.find(x=>x.case.id==='13-partial-effect-recovery');
assert.equal(recovery.review.partialEffectAccuratelyReported,true);
assert.ok(objects(recovery.response).some(v=>{try{subset(v,{originalWriteState:'completed',originalWriteBytes:499,changedFiles:['pages.py'],regressionTestPresent:false,testsExecuted:false,mutationReplayed:false});return true;}catch{return false;}}));
console.log(JSON.stringify({recordIntegrity:'passed',totals:r.totals,connectorSourceSha256:connectorDigest(),certification:'not_established'},null,2));
