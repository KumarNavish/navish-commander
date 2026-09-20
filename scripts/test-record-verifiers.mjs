import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const original=JSON.parse(fs.readFileSync('evidence/workflow-remediation-20260920.json'));
const tests=[
 ['changed deployed source',r=>r.deployment.connectorSourceSha256='0'.repeat(64)],
 ['altered saved inventory result',r=>r.records.find(x=>x.case.id==='07-inventory').outputs['result.json']+=' '],
 ['hidden partial write',r=>r.records.find(x=>x.case.id==='09-pagination-code').unexportedHostResults=[]],
 ['missing failed worker',r=>r.records.find(x=>x.case.id==='12-partial-failure').host.sessions.pop()],
 ['false test execution claim',r=>r.records.find(x=>x.case.id==='13-partial-effect-recovery').response=r.records.find(x=>x.case.id==='13-partial-effect-recovery').response.replace('"testsExecuted": false','"testsExecuted": true')],
 ['changed read target identity',r=>{const x=r.records.find(x=>x.case.id==='14-correlated-config');x.calls.find(c=>c.name==='commander_read_file').toolOutput.connectorOperation.path='$TRIAL/wrong-file';}],
 ['fabricated dispatched conflict',r=>{const x=r.records.find(x=>x.case.id==='12-partial-failure');x.calls.find(c=>c.toolOutput?.code==='CALL_ID_CONFLICT').toolOutput.dispatched=true;}],
];
const results=[],dir=fs.mkdtempSync(path.join(os.tmpdir(),'navish-record-controls-'));
try{
for(const [name,mutate] of tests){
 const r=structuredClone(original);mutate(r);assert.notEqual(JSON.stringify(r),JSON.stringify(original),name+' had no mutation');
 const file=path.join(dir,results.length+'.json');fs.writeFileSync(file,JSON.stringify(r));
 const v=spawnSync(process.execPath,['scripts/verify-workflow-remediation.mjs',file],{encoding:'utf8',timeout:15000});
 assert.ok(v.status!==null&&v.status!==0,name+' unexpectedly passed');results.push({name,rejected:true});
}
const throughput=JSON.parse(fs.readFileSync('evidence/personal-0.1.3-inline.json'));
const delivery=JSON.parse(fs.readFileSync('evidence/personal-0.1.3-delivery.json'));
for(const [name,mutate] of [
 ['false throughput pass',(a,b)=>a.throughputTargetPassed=!a.throughputTargetPassed],
 ['changed median',(a,b)=>a.summary.navish.medianMs/=2],
 ['concealed duplicate effect',(a,b)=>b.samples.find(s=>!s.verified).verified=true],
]){
 const a=structuredClone(throughput),b=structuredClone(delivery);mutate(a,b);
 const ta=path.join(dir,'throughput.json'),db=path.join(dir,'delivery.json');fs.writeFileSync(ta,JSON.stringify(a));fs.writeFileSync(db,JSON.stringify(b));
 const r=spawnSync(process.execPath,['scripts/verify-current-connector.mjs',ta,db],{encoding:'utf8',timeout:15000});
 assert.ok(r.status!==null&&r.status!==0,name+' unexpectedly passed');results.push({name,rejected:true});
}
console.log(JSON.stringify({negativeControls:results.length,results},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
