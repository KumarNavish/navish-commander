import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {paths,ensureBase} from '../../app/src/config.mjs';
import {callTool} from '../../app/src/core.mjs';
import {normalizeBrowserJob,browserJobStatus} from '../../app/src/browser-jobs.mjs';
import {closeStateTransactions} from '../../app/src/state-lock.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const base='about:blank';
assert.ok(base&&process.env.NAVISH_TEST_CDP,'tests require the isolated fixture launcher');
process.env.NAVISH_EGO_COMMAND=path.join(HERE,'ego-fixture.mjs');
let sequence=0;const home=fs.mkdtempSync(path.join(os.tmpdir(),'navish-browser-jobs-')),P=paths({HOME:home});ensureBase(P);
function plan(sessionId,changes={}){return {sessionId,goal:'Check bounded browser form',allowedOrigins:[],allowedMutations:['open','fill','click'],timeout_ms:15000,
 workflow:{steps:[
  {action:'open',url:base},
  {action:'fill',selector:'#q',value:'hello',expectedUrl:base,after:{selector:'#q',value:'hello'}},
  {action:'click',selector:'#save',expectedUrl:base,after:{selector:'#result',text:'Saved hello'}},
  {action:'extract',selector:'#result',expectedUrl:base},
 ],final:{url:base,selector:'#result',text:'Saved hello'}},...changes}}
function call(args,id='browser-call-'+(++sequence)){return callTool({tool:'browser_agent',callId:id,args,timeoutMs:20000},P)}
const readStore=()=>JSON.parse(fs.readFileSync(process.env.NAVISH_TEST_SPACES,'utf8'));

test('browser workflow validation rejects implicit mutations',()=>assert.throws(()=>normalizeBrowserJob(plan('not-allowed',{allowedMutations:[]})),/MUTATION_NOT_ALLOWED/));
test('browser workflow rejects credentials and unsupported URL schemes',()=>{for(const value of ['file:///tmp/test','https://user:password@example.test/']){const p=plan('bad-url');p.workflow.steps[0].url=value;assert.throws(()=>normalizeBrowserJob(p),/BROWSER_URL/)}});
test('browser workflow rejects an empty or contradictory final condition',()=>{for(const c of [{},{selector:'#x',absent:true,text:'bad'}]){const p=plan('bad-final');p.workflow.final=c;assert.throws(()=>normalizeBrowserJob(p),/CONDITION/)}});
test('later steps default to the page\'s opened URL; an unopened page still requires expectedUrl, and mutations require a postcondition',()=>{
 const p=plan('no-url');delete p.workflow.steps[1].expectedUrl;assert.equal(normalizeBrowserJob(p).steps[1].expectedUrl,base);
 const r=plan('never-opened');r.workflow.steps[1].page='p2';delete r.workflow.steps[1].expectedUrl;assert.throws(()=>normalizeBrowserJob(r),/EXPECTED_URL_REQUIRED/);
 const q=plan('no-after');delete q.workflow.steps[2].after;assert.throws(()=>normalizeBrowserJob(q),/CONDITION/)});
test('cross-origin navigation outside the explicit allowlist is rejected',()=>{const p=plan('cross');p.allowedOrigins=['https://allowed.example/'];p.workflow.steps[0].url='https://outside.example/';assert.throws(()=>normalizeBrowserJob(p),/ORIGIN_NOT_ALLOWED/)});
test('action and time budgets are validated before execution',()=>{assert.throws(()=>normalizeBrowserJob(plan('budget',{maxActions:3})),/WORKFLOW_REQUIRED/);assert.throws(()=>normalizeBrowserJob(plan('time',{timeout_ms:Infinity})),/TIMEOUT/)});
test('one real Chromium workflow crosses the actual core and Ego process-envelope path',async()=>{
 const before=fs.existsSync(process.env.NAVISH_TEST_SPACES)?readStore().calls:0;
 const r=await call(plan('full'));
 assert.equal(r.state,'completed',r.reason);assert.equal(r.result.verified,true);assert.equal(r.result.goalVerified,true);assert.equal(r.result.backendChosen,'ego-lite');
 assert.equal(r.result.steps.length,4);assert.equal(r.result.steps[3].value.rows[0].text,'Saved hello');assert.equal(readStore().calls,before+1);
 const phases=fs.readdirSync(P.receiptsDir).filter(n=>n.startsWith('browser-step-'));assert.equal(phases.length,4);
 for(const name of phases)assert.equal(JSON.parse(fs.readFileSync(path.join(P.receiptsDir,name),'utf8')).state,'completed');
});
test('completed browser phase is reused without another CLI or click',async()=>{
 const before=readStore().calls;const r=await call(plan('full'));assert.equal(r.state,'completed',r.reason);assert.equal(r.result.reused,true);assert.equal(readStore().calls,before);
});
test('new phase reuses the same TaskSpace and persistent page state',async()=>{
 const before=browserJobStatus(P,{sessionId:'full'})[0];
 const r=await call(plan('full',{phaseId:'inspect-saved',allowedMutations:[],workflow:{steps:[{action:'extract',selector:'#click-count',expectedUrl:base}],final:{selector:'#click-count',text:'1'}}}));
 assert.equal(r.state,'completed',r.reason);assert.equal(r.result.spaceId,before.spaceId);assert.equal(r.result.steps[0].value.rows[0].text,'1');
});
test('unrelated goals receive different TaskSpaces',async()=>{
 const r=await call(plan('other'));assert.equal(r.state,'completed',r.reason);assert.notEqual(r.result.spaceId,browserJobStatus(P,{sessionId:'full'})[0].spaceId);
});
test('changed specification under the same phase is rejected without dispatch',async()=>{
 const before=readStore().calls,p=plan('full');p.workflow.steps[1].value='changed';const r=await call(p);assert.equal(r.state,'failed');assert.equal(r.reason,'BROWSER_PHASE_CONFLICT');assert.equal(readStore().calls,before);
});
test('ambiguous target is rejected and no blind retry occurs',async()=>{
 const p=plan('ambiguous');p.workflow.steps[2].selector='.duplicate';const r=await call(p);assert.equal(r.state,'uncertain');assert.match(r.reason,/AMBIGUOUS_TARGET/);
 const before=readStore().calls;const repeat=await call(p);assert.equal(repeat.state,'failed');assert.equal(repeat.code,'RESOURCE_QUARANTINED');assert.equal(readStore().calls,before);
});
test('incorrect application postcondition cannot become success',async()=>{
 const p=plan('wrong-postcondition');p.workflow.steps[2].timeout_ms=100;p.workflow.steps[2].after.text='Not the actual outcome';const r=await call(p);assert.equal(r.state,'uncertain');assert.match(r.reason,/POSTCONDITION_NOT_OBSERVED/);
});
test('current page URL is rechecked at every mutation',async()=>{
 const p=plan('stale');p.workflow.steps[1].expectedUrl='https://unexpected.example/';const r=await call(p);assert.equal(r.state,'uncertain');assert.match(r.reason,/URL_CHANGED/);
});
test('snapshots omit synthetic sensitive input values',async()=>{
 const p=plan('privacy');p.workflow.steps.push({action:'snapshot',expectedUrl:base,includeText:true});const r=await call(p);assert.equal(r.state,'completed',r.reason);assert.ok(!JSON.stringify(r.result).includes('synthetic-secret-value'));
});
test('durable browser status exposes identities but no DOM content',()=>{
 const status=browserJobStatus(P,{sessionId:'full'})[0];assert.equal(status.state,'completed');assert.ok(status.spaceId);assert.equal('steps' in status,false);
});
test('one batch call performs process, browser, file generation, and artifact verification',async()=>{
 const cwd=path.join(home,'mixed-worker');fs.mkdirSync(cwd);
 const coreUrl=new URL('../../app/src/core.mjs',import.meta.url).href;
 const configUrl=new URL('../../app/src/config.mjs',import.meta.url).href;
 const childPlan=plan('mixed-browser');
 const script=`import fs from 'node:fs';import {callTool} from ${JSON.stringify(coreUrl)};import {paths} from ${JSON.stringify(configUrl)};const receipt=await callTool({callId:'mixed-browser-call',tool:'browser_agent',args:${JSON.stringify(childPlan)}},paths({HOME:${JSON.stringify(cwd)}}));if(receipt.state!=='completed'||receipt.result.verified!==true)throw new Error('browser not verified');fs.writeFileSync('report.json',JSON.stringify({status:'verified',text:receipt.result.steps[3].value.rows[0].text,spaceId:receipt.result.spaceId}));`;
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 const r=await callTool({tool:'agent_batch_start',callId:'mixed-goal',args:{batchId:'mixed-goal',workers:[{id:'browser-reporter',role:'browser and artifact worker',cwd,command:quote(process.execPath)+' --input-type=module -e '+quote(script),artifacts:[{path:'report.json',minBytes:20}],startTimeoutMs:0}],wait_ms:15000}},P);
 assert.equal(r.state,'completed',r.reason);assert.equal(r.result.state,'completed',JSON.stringify(r.result));
 const report=JSON.parse(fs.readFileSync(path.join(cwd,'report.json'),'utf8'));assert.equal(report.status,'verified');assert.equal(report.text,'Saved hello');assert.equal(r.result.workers[0].artifacts[0].ok,true);
});

test.after(()=>{closeStateTransactions();fs.writeFileSync(path.join(HERE,'browser-test-home.json'),JSON.stringify({home,scope:'Test-only Ego API fixture with real Chromium, NOT installed Ego Lite or Mac'},null,2)+'\n')});
