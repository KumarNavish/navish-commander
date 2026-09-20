#!/usr/bin/env node
// Check the published observation record, including failures. Never execute it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {sourceDigest} from './benchmark-evidence.mjs';
import {connectorDigest} from '../connector/source-digest.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const file=process.argv[2]||'evidence/chat-efficacy-extra-high-20260920.json';
const r=JSON.parse(fs.readFileSync(file,'utf8'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const equal=(a,b)=>canonical(a)===canonical(b);
const count=xs=>xs.reduce((a,x)=>(a[x]=(a[x]||0)+1,a),{});
function subset(actual,expected,key=''){
 if(Array.isArray(expected)){
  if(key==='evidenceIds'){assert.ok(Array.isArray(actual));for(const id of expected)assert.ok(actual.includes(id));}
  else assert.deepEqual(actual,expected);
 }else if(expected&&typeof expected==='object'){
  assert.ok(actual&&typeof actual==='object');for(const [k,v] of Object.entries(expected))subset(actual[k],v,k);
 }else assert.equal(actual,expected);
}
function responseObjects(s){
 // Explanatory prose can contain braces before the final JSON block.
 const last=s.lastIndexOf('}');
 for(let first=s.indexOf('{');first>=0;first=s.indexOf('{',first+1)){
  try{return JSON.parse(s.slice(first,last+1));}catch{}
 }
 throw new Error('No complete final JSON object');
}
assert.equal(r.schema,'navish.chat-efficacy-evidence/v1');
assert.equal(r.baselineProtocol.comparator,null);
assert.equal(r.baselineProtocolOriginalSha256,'1172faa176a04da331deaa2803f09b0100603ed88e45ff5827a5a25823ce8e91');
assert.equal(r.repairProtocol.runtimeSourceSha256,sourceDigest());
assert.equal(r.repairProtocol.connectorSourceSha256,connectorDigest());
assert.equal(r.repairDeployment.runtimeSourceSha256,sourceDigest());
assert.equal(r.repairDeployment.installedRuntimeSourceSha256,sourceDigest());
assert.equal(r.repairDeployment.connectorSourceSha256,connectorDigest());
assert.equal(r.repairDeployment.front.version,JSON.parse(fs.readFileSync('package.json')).version);
assert.equal(r.repairDeployment.status.online,true);
assert.equal(r.repairDeployment.status.pending,0);
for(const x of [r.repairDeployment.front,r.repairDeployment.channel,r.repairDeployment.status]){
 assert.equal(x.connector.sourceSha256,connectorDigest());
 assert.equal(x.connector.runtimeVersion,r.repairProtocol.runtimeVersion);
 assert.equal(x.connector.version,r.repairProtocol.connectorVersion);
}
const definitions=[...r.baselineProtocol.cases,...r.repairProtocol.cases];
assert.equal(new Set(r.records.map(x=>x.case.id)).size,18);
assert.deepEqual(r.records.map(x=>x.case.id),definitions.map(x=>x.id));
const readonly=new Set(['commander_devices','commander_read_file','commander_receipt','commander_connector_receipt','commander_process_output','commander_collect_batch']);
for(const [index,x] of r.records.entries()){
 assert.deepEqual(x.case,definitions[index]);
 for(const [name,digest] of Object.entries(x.case.inputHashes||{}))assert.equal(x.host.fileHashes[name],digest,x.case.id+' input '+name);
 if(!x.calls){assert.equal(x.score.status,'not_run_platform_gate');continue;}
 const mode=x.submission.mode;
 if(mode){assert.equal(mode.power,'3');assert.deepEqual(mode.selected,['Latest']);}
 else {assert.equal(x.submission.modelSelection,'Latest');assert.equal(x.submission.thinkingEffort,'Extra High');}
 const protocol=x.phase==='baseline'?r.baselineProtocol:r.repairProtocol;
 assert.ok(Date.parse(x.submission.at)>Date.parse(protocol.frozenAt));
 assert.ok(Date.parse(x.completion.at)>=Date.parse(x.submission.at));
 assert.equal(x.completion.promptMatched,true);assert.equal(x.submission.promptMatched,true);
 assert.equal(x.completion.supervisorApprovalClicks,0);assert.equal(x.completion.correctivePrompts,0);
 assert.equal(x.score.toolCalls,x.calls.length);
 assert.equal(x.host.journalObservations.length,x.calls.length);
 for(const [i,call] of x.calls.entries()){
  assert.equal(call.connector,'Navish Commander');
  const a=call.toolInput;
  if(a.device!==undefined)assert.equal(a.device,'local');
  if(a.path!==undefined)assert.ok(a.path.startsWith(x.case.taskRoot+'/'));
  if(a.cwd!==undefined)assert.ok(a.cwd===x.case.taskRoot||a.cwd.startsWith(x.case.taskRoot+'/'));
  const o=x.host.journalObservations[i];assert.equal(o.callIndex,i);assert.equal(o.toolName,call.name);
  assert.ok(o.matches.length);for(const m of o.matches)assert.equal(m.state,'finished');
  const exact=o.matches.some(m=>equal(m.result,call.toolOutput));
  const normalized=call.toolOutput&&typeof call.toolOutput==='object'?{...call.toolOutput}:call.toolOutput;
  if(normalized&&typeof normalized==='object')delete normalized.is_error;
  const comparison=exact?'exact':call.toolOutput===null?'null_ui_output':o.matches.some(m=>equal(m.result,normalized))?'ui_error_annotation_only':'mismatched_ui_output';
  assert.deepEqual(x.outputAudit[i],{callIndex:i,comparison});
 }
 assert.equal(x.score.hostMatchedCalls,x.calls.length);
 const denied=x.calls.flatMap((c,i)=>typeof c.toolOutput==='string'&&c.toolOutput.includes('blocked by OpenAI')?[i]:[]);
 assert.deepEqual(x.score.platformBlockedCalls,denied);
 assert.deepEqual(x.score.uiNullOutputs,x.calls.flatMap((c,i)=>c.toolOutput===null?[i]:[]));
 if(x.score.status==='passed'){
  assert.deepEqual(x.score.failures,[]);
  if(x.case.family!=='fresh_chat_recovery')subset(responseObjects(x.response),r.oracles[x.case.id]);
  else {assert.equal(x.review.passed,true);assert.equal(x.review.actualWorkRecovered,false);}
 }
 if(x.phase==='repair_confirmation'){
  for(const c of x.calls)assert.ok(readonly.has(c.name));
  assert.equal(x.host.receipts.length,0);assert.equal(x.host.sessions.length,0);
  for(const [name,contents] of Object.entries(r.repairInputs[x.case.id]))assert.equal(hash(contents),x.case.inputHashes[name]);
 }
}
function totals(xs){
 const executed=xs.filter(x=>x.calls);
 return {assigned:xs.length,conversations:executed.length,exportedCalls:executed.reduce((n,x)=>n+x.calls.length,0),
  hostMatchedCallFingerprints:executed.reduce((n,x)=>n+x.score.hostMatchedCalls,0),outcomes:count(xs.map(x=>x.score.status)),
  outputComparisons:count(executed.flatMap(x=>x.outputAudit.map(o=>o.comparison))),
  unexportedHostResults:executed.reduce((n,x)=>n+(x.unexportedHostResults?.length||0),0),
  reportedUncorroboratedDenials:executed.filter(x=>x.review?.reportedPlatformDenial&&!x.review.observedPlatformDenial).length,
  exportedPlatformDenials:executed.reduce((n,x)=>n+x.score.platformBlockedCalls.length,0),
  supervisorApprovalClicks:executed.reduce((n,x)=>n+x.completion.supervisorApprovalClicks,0),correctivePrompts:executed.reduce((n,x)=>n+x.completion.correctivePrompts,0)};
}
assert.deepEqual(totals(r.records.filter(x=>x.phase==='baseline')),r.baselineTotals);
assert.deepEqual(totals(r.records.filter(x=>x.phase==='repair_confirmation')),r.repairTotals);
assert.equal(r.baselineTotals.conversations,10);assert.equal(r.baselineTotals.exportedCalls,95);
assert.equal(r.baselineTotals.reportedUncorroboratedDenials,3);
assert.equal(r.baselineTotals.outcomes.not_run_platform_gate,6);
const batch=r.records.find(x=>x.case.id==='16-recover-batch');
assert.equal(batch.unexportedHostResults.length,1);
assert.equal(batch.unexportedHostResults[0].result.reason,'agent batch not found: ce20-11-parallel-batch');
const repaired=r.records.find(x=>x.case.id==='17-reader-repair');
const lines=r.repairInputs['17-reader-repair']['archive.log'].split(/\r?\n/),coverage=new Set();
for(const o of repaired.host.journalObservations){
 for(const m of o.matches){
  const p=m.result?.result;
  if(!p?.path?.endsWith('/archive.log'))continue;
  const actual=p.content.split(/\r?\n/),complete=p.returnedLines-(p.partialLastLine?1:0);
  for(let i=0;i<complete;i++){assert.equal(actual[i],lines[p.offset+i]);coverage.add(p.offset+i);}
 }
}
for(let i=0;i<1300;i++)assert.ok(coverage.has(i),'missing observed line '+(i+1));
assert.ok([...coverage].includes(1276));
const tail=r.records.find(x=>x.case.id==='18-unicode-tail');
assert.ok(tail.host.journalObservations.some(o=>o.matches.some(m=>{
 const p=m.result?.result;
 return p?.path?.endsWith('/unicode.log')&&r.oracles['18-unicode-tail'].lastRecords.every(s=>p.content.includes(s))&&!p.content.includes('\uFFFD')&&!p.truncated;
})));
if(process.argv[3]){
 for(const c of r.baselineProtocol.cases)for(const [name,digest] of Object.entries(c.inputHashes||{}))
  assert.equal(hash(fs.readFileSync(path.join(process.argv[3],'work',c.id,name))),digest);
}
console.log(JSON.stringify({recordIntegrity:'passed',runtimeSourceSha256:sourceDigest(),baseline:r.baselineTotals,repair:r.repairTotals,
 certification:'not_established',scope:'Record consistency and source binding; no live calls or benchmark rerun.'},null,2));
