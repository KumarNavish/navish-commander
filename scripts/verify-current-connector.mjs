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
const t=read(process.argv[2]||'evidence/personal-0.1.3-inline.json'),d=read(process.argv[3]||'evidence/personal-0.1.3-delivery.json');
const plan=process.argv[4]?read(process.argv[4]):null;
const rounds=plan?50:20;
if(plan){
  assert.equal(plan.schema,'navish.final-heldout-confirmation/v1');
  assert.equal(plan.attempts,1);
  assert.equal(plan.connectorSourceSha256,connectorDigest());
  assert.equal(plan.commanderSourceSha256,sourceDigest());
  assert.deepEqual(plan.protocol,t.protocol,'predeclared final protocol');
  assert.ok(Date.parse(plan.frozenAt)<Date.parse(t.runAt),'plan precedes measurement');
}
for(const r of [t,d]){
  assert.equal(r.connectorSourceSha256,connectorDigest(),'connector source');
  assert.equal(r.commanderSourceSha256,sourceDigest(),'runtime source');
  assert.equal(r.sourceUnchanged,true,'source remained frozen');
  assert.match(r.installedSourceSha256,/^[a-f0-9]{64}$/);
}
assert.equal(t.harnessSha256,sha('scripts/benchmark-personal-connector.mjs'));
assert.equal(d.harnessSha256,sha('scripts/benchmark-personal-delivery.mjs'));
assert.equal(t.protocol.rounds,rounds);assert.equal(t.protocol.workers,4);
assert.equal(t.samples.length,2*rounds);assert.ok(t.samples.every(s=>s.verified&&s.workers===4&&Number.isFinite(s.elapsedMs)&&s.elapsedMs>0));
assert.equal(new Set(t.samples.map(s=>s.backend+':'+s.round)).size,2*rounds);
for(const backend of ['navish','rdc']){
  const samples=t.samples.filter(s=>s.backend===backend);assert.equal(samples.length,rounds);
  assert.deepEqual(samples.map(s=>s.round).sort((a,b)=>a-b),Array.from({length:rounds},(_,i)=>i));
  near(t.summary[backend].medianMs,median(samples.map(s=>s.elapsedMs)),backend+' median');
  assert.equal(t.summary[backend].verified,rounds);
}
const ratio=t.summary.rdc.medianMs/t.summary.navish.medianMs,interval=pairedThroughputInterval(t.samples);
near(ratio,t.throughputRatio,'throughput ratio');near(interval.lower,t.throughputInterval.lower,'interval lower');near(interval.upper,t.throughputInterval.upper,'interval upper');
const throughputGate=interval.lower>=2;assert.equal(t.throughputTargetPassed,throughputGate);
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
const reduction=failures.rdc?1-failures.navish/failures.rdc:null;
if(reduction===null)assert.equal(d.relativeFailureReduction,null);else near(reduction,d.relativeFailureReduction,'failure reduction');
const deliveryGate=reduction!==null&&reduction>=.5&&failures.navish===0;assert.equal(d.controlledTargetPassed,deliveryGate);
console.log(JSON.stringify({recordIntegrity:'passed',connectorSourceSha256:connectorDigest(),runtimeSourceSha256:sourceDigest(),throughputRatio:ratio,paired95PercentInterval:interval,throughputGate,controlledFailures:failures,deliveryGate,scope:'Defined deterministic execution and delivery workloads only; no model productivity or unattended certification claim'},null,2));
