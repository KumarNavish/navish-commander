/** Verify published observations, including a failed gate; makes no live requests. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {connectorDigest} from '../connector/source-digest.mjs';
import {sourceDigest} from './benchmark-evidence.mjs';
const r=JSON.parse(fs.readFileSync('evidence/chatgpt-full-access-20260920.json'));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
assert.equal(r.connectorSourceSha256,connectorDigest());
assert.equal(r.runtimeSourceSha256,sourceDigest());
assert.equal(r.permission.permission,'full_access');assert.equal(r.permission.toolResult,'updated');
const calls=r.toolCalls,blocked=calls.flatMap((c,i)=>typeof c.toolOutput==='string'&&c.toolOutput.includes('blocked by OpenAI')?[i]:[]);
assert.deepEqual(blocked,r.automatedReviewBlockedCallIndices);
assert.deepEqual(calls.flatMap((c,i)=>c.toolOutput===null?[i]:[]),r.exportLimits.nullOutputCallIndices);
const mismatched=calls.flatMap((c,i)=>c.name==='commander_process_output'&&c.toolOutput?.result?.batchId?[i]:[]);
assert.deepEqual(mismatched,r.exportLimits.mismatchedOutputCallIndices);
const observed=calls.filter((c,i)=>!blocked.includes(i)&&!mismatched.includes(i)&&c.toolOutput!==null);
const writes=observed.filter(c=>c.name==='commander_write_file'&&c.toolOutput.state==='completed');
assert.equal(writes.length,2);
assert.deepEqual(writes[0].toolInput,writes[1].toolInput);
assert.equal(writes[0].toolInput.callId,r.plan.append.callId);
assert.equal(writes[0].toolInput.content,r.plan.append.content);
assert.equal(writes[0].toolInput.device,'local');
const v=r.independentVerification;
assert.equal(v.exactAppend,true);assert.equal(v.appendSha256,sha(r.plan.append.content));
assert.equal(v.receipts.length,2);assert.ok(v.receipts.every(x=>x.state==='completed'));
assert.deepEqual(v.receipts.map(x=>x.callId).sort(),[r.plan.append.callId,r.plan.batch.callId].sort());
assert.equal(v.artifacts.length,4);assert.ok(v.artifacts.every(a=>a.matches));
for(const w of r.plan.batch.workers)assert.equal(v.artifacts.find(a=>a.id===w.id)?.sha256,w.artifacts[0].sha256);
const batch=observed.find(c=>c.name==='commander_collect_batch'&&c.toolOutput.result?.batchId===r.plan.batch.batchId&&c.toolOutput.operationState==='completed')?.toolOutput.result;
assert.ok(batch);assert.equal(batch.counts.completed,4);
for(const w of batch.workers){
 assert.equal(w.exitCode,0);assert.equal(w.state,'completed');assert.ok(w.artifacts.every(a=>a.ok));
 assert.equal(w.artifacts[0].sha256,r.plan.batch.workers.find(x=>x.id===w.id).artifacts[0].sha256);
 const meta=v.sessions.find(s=>s.sessionId===w.sessionId);assert.ok(meta);assert.equal(meta.pid,w.pid);assert.equal(meta.exitCode,0);assert.equal(meta.state,'completed');
}
const overlap=Math.min(...v.sessions.map(s=>Date.parse(s.finishedAt)))-Math.max(...v.sessions.map(s=>Date.parse(s.startedAt)));
assert.ok(overlap>0,'all four workers overlapped');
const failures=calls.filter(c=>c.name==='commander_start_process');
assert.equal(failures.length,5);assert.ok(failures.every(c=>c.toolInput.sessionId===r.plan.failure.sessionId&&c.toolInput.command==='exit 7'&&typeof c.toolOutput==='string'&&c.toolOutput.includes('blocked by OpenAI')));
assert.ok(observed.some(c=>c.name==='commander_process_output'&&c.toolInput.sessionId===r.plan.failure.sessionId&&c.toolOutput.operationState==='unsubmitted'));
assert.equal(v.sessions.some(s=>s.sessionId===r.plan.failure.sessionId),false);
assert.equal(r.expectedFailureDispatched,false);
assert.equal(r.fullUnattendedChatCertification,false);assert.equal(r.independentCertification,false);assert.equal(r.publicDirectoryApproval,false);
assert.equal(r.observedApprovalPrompts,0);assert.equal(r.supervisorApprovalClicks,0);assert.equal(r.newSpending,0);
if(r.recovery.status==='passed'){
 assert.equal(r.recovery.unchangedArtifactsAndProcesses,true);
 assert.ok(r.recovery.toolCalls.every(c=>['commander_devices','commander_read_file','commander_receipt','commander_collect_batch','commander_process_output','commander_connector_receipt'].includes(c.name)));
 const journal=r.recovery.journalObservations;
 assert.equal(journal.length,6);assert.deepEqual(journal.map(j=>j.callIndex).sort(),[0,1,2,3,4,5]);
 assert.equal(r.recovery.allSixCallFingerprintsMatchedBeforeRedaction,true);
 for(const j of journal){assert.equal(j.toolName,r.recovery.toolCalls[j.callIndex].name);assert.equal(j.state,'finished');assert.equal(j.result.state,'completed');}
 assert.equal(journal.find(j=>j.toolName==='commander_collect_batch').result.result.counts.completed,4);
 assert.equal(journal.find(j=>j.toolName==='commander_process_output').result.operationState,'unsubmitted');
 assert.equal(journal.find(j=>j.callIndex===2).result.result.content,r.plan.append.content);
 assert.equal(r.recovery.appendSha256,v.appendSha256);assert.equal(r.recovery.batchSha256,v.batchSha256);
 for(const s of v.sessions)assert.equal(r.recovery.sessionMetaSha256[s.sessionId],s.metaSha256);
}
console.log(JSON.stringify({recordVerified:true,acceptance:'blocked',permission:'full_access',toolCalls:calls.length,automatedReviewBlocks:blocked.length,exactAppend:true,verifiedWorkers:4,allWorkerOverlapMs:overlap,expectedFailureDispatched:false,recovery:r.recovery.status,fullUnattendedChatCertification:false,scope:'Recorded observations; no live test, independent certification, or approval bypass'},null,2));
