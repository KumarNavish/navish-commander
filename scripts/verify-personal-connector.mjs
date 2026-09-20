/** Recompute recorded gates and bind them to this checkout; no live requests. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {connectorDigest} from '../connector/source-digest.mjs';
import {sourceDigest,pairedThroughputInterval} from './benchmark-evidence.mjs';
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file));
const median=values=>{const a=[...values].sort((x,y)=>x-y);return(a[(a.length-1)>>1]+a[a.length>>1])/2;};
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-9,label);
const t=read('evidence/personal-interactive-inline.json'),d=read('evidence/personal-interactive-delivery.json');
for(const r of [t,d]){
  assert.equal(r.connectorSourceSha256,connectorDigest(),'connector source');
  assert.equal(r.commanderSourceSha256,sourceDigest(),'runtime source');
  assert.equal(r.sourceUnchanged,true,'source remained frozen');
  assert.match(r.installedSourceSha256,/^[a-f0-9]{64}$/);
}
assert.equal(t.harnessSha256,sha('scripts/benchmark-personal-connector.mjs'));
assert.equal(d.harnessSha256,sha('scripts/benchmark-personal-delivery.mjs'));
assert.equal(t.protocol.rounds,20);assert.equal(t.protocol.workers,4);
assert.equal(t.samples.length,40);assert.ok(t.samples.every(s=>s.verified&&s.workers===4&&Number.isFinite(s.elapsedMs)&&s.elapsedMs>0));
assert.equal(new Set(t.samples.map(s=>s.backend+':'+s.round)).size,40);
for(const backend of ['navish','rdc']){
  const samples=t.samples.filter(s=>s.backend===backend);assert.equal(samples.length,20);
  assert.deepEqual(samples.map(s=>s.round).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i));
  near(t.summary[backend].medianMs,median(samples.map(s=>s.elapsedMs)),backend+' median');
  assert.equal(t.summary[backend].verified,20);
}
const ratio=t.summary.rdc.medianMs/t.summary.navish.medianMs,interval=pairedThroughputInterval(t.samples);
near(ratio,t.throughputRatio,'throughput ratio');near(interval.lower,t.throughputInterval.lower,'interval lower');near(interval.upper,t.throughputInterval.upper,'interval upper');
assert.ok(interval.lower>=2);assert.equal(t.throughputTargetPassed,true);
assert.equal(t.deploymentProfile.processType,'Interactive');assert.equal(t.deploymentProfile.legacyTimers,true);
assert.equal(d.protocol.repetitionsPerScenario,10);assert.equal(d.samples.length,60);
assert.equal(new Set(d.samples.map(s=>s.backend+':'+s.scenario+':'+s.round)).size,60);
const failures={};
for(const backend of ['navish','rdc']){
  const samples=d.samples.filter(s=>s.backend===backend);assert.equal(samples.length,30);
  failures[backend]=samples.filter(s=>!s.verified).length;
  assert.equal(d.summary[backend].failedOrUnresolved,failures[backend]);
  for(const scenario of ['normal','duplicate-delivery','client-reconnect']){
    const group=samples.filter(s=>s.scenario===scenario);assert.equal(group.length,10);
    assert.deepEqual(group.map(s=>s.round).sort((a,b)=>a-b),Array.from({length:10},(_,i)=>i));
    assert.ok(group.every(s=>s.duplicatedMessages===(scenario==='duplicate-delivery'?1:0)));
    assert.equal(d.summary[backend].byScenario[scenario].failures,group.filter(s=>!s.verified).length);
  }
}
assert.equal(failures.navish,0);assert.ok(failures.rdc>0);
const reduction=1-failures.navish/failures.rdc;near(reduction,d.relativeFailureReduction,'failure reduction');
assert.ok(reduction>=.5);assert.equal(d.controlledTargetPassed,true);
const acceptance=read('evidence/personal-connector-0.1.0-acceptance.json');
assert.equal(acceptance.connector.sourceSha256,connectorDigest());
assert.equal(acceptance.runtimeSourceSha256,sourceDigest());
assert.equal(acceptance.installedSourceSha256,t.installedSourceSha256);
assert.equal(acceptance.throughputTargetPassed,true);assert.equal(acceptance.controlledFailureReductionTargetPassed,true);
const chat=acceptance.chatRead;
assert.equal(chat.passed,true);assert.equal(chat.promptDisclosedExpectedValue,false);
assert.deepEqual(chat.toolCalls.map(c=>c.name),['commander_devices','commander_read_file']);
assert.ok(chat.toolCalls.every(c=>c.toolOutput.state==='completed'));
const readCall=chat.toolCalls[1];assert.equal(readCall.toolInput.device,'local');
assert.equal(crypto.createHash('sha256').update(readCall.toolOutput.result.content.trimEnd()+'\n').digest('hex'),chat.fixtureSha256);
assert.equal(acceptance.fullUnattendedChatCertification,false);
assert.equal(acceptance.independentCertification,false);assert.equal(acceptance.publicDirectoryApproval,false);
console.log(JSON.stringify({recordedExecutionGates:'passed',connectorSourceSha256:connectorDigest(),runtimeSourceSha256:sourceDigest(),
  throughputRatio:ratio,paired95PercentInterval:interval,controlledFailures:failures,
  scope:'Defined deterministic execution and delivery workloads; no fresh network test, model productivity claim, independent certification or ChatGPT directory approval'},null,2));
