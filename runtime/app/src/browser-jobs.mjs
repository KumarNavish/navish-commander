/** Bounded, externally specified workflows on the recovered Ego TaskSpace/Page API.
 * No model, daemon, transport, or alternate browser architecture is introduced.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {EgoBridge,EgoError} from './ego-bridge.mjs';
import {browserScript,redact} from './browser-dom.mjs';
import {ensureDir,readJson,writeJson,isSafeId,nowIso} from './util.mjs';
import {intentHash} from './receipts.mjs';
import {withStateTransaction} from './state-lock.mjs';

const MUTATIONS=new Set(['open','click','click-text','fill','select']);
const ACTIONS=new Set([...MUTATIONS,'snapshot','extract','verify','wait']);
const fail=(code,uncertain=false)=>Object.assign(new Error(code),{code,dispatched:uncertain,uncertain});
function integer(value,fallback,min,max,label){const n=value==null?fallback:Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw fail('INVALID_'+label);return n}
function text(value,label,max=12000){if(typeof value!=='string'||!value.trim()||value.length>max)throw fail('INVALID_'+label);return value}
function url(value){if(value==='about:blank')return value;try{const u=new URL(text(value,'URL',4096));if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error();return u.href}catch{throw fail('INVALID_BROWSER_URL')}}
function condition(c){
  if(!c||typeof c!=='object'||Array.isArray(c)||!Object.keys(c).length)throw fail('INVALID_BROWSER_CONDITION');
  const out={};
  for(const [key,value] of Object.entries(c)){
    if(key==='url')out.url=url(value);
    else if(['selector','text','value'].includes(key)){if(typeof value!=='string'||value.length>12000||(key==='selector'&&!value.trim()))throw fail('INVALID_BROWSER_CONDITION');out[key]=value}
    else if(key==='absent'&&typeof value==='boolean')out.absent=value;
    else throw fail('INVALID_BROWSER_CONDITION');
  }
  if((out.absent!==undefined||out.value!==undefined)&&!out.selector)throw fail('INVALID_BROWSER_CONDITION');
  if(out.absent===true&&(out.text!==undefined||out.value!==undefined))throw fail('CONTRADICTORY_BROWSER_CONDITION');
  return out;
}
export function normalizeBrowserJob(args){
  const sessionId=args.sessionId,phaseId=args.phaseId??'main';
  if(!isSafeId(sessionId)||!isSafeId(phaseId))throw fail('BROWSER_SESSION_AND_PHASE_IDS_REQUIRED');
  const goal=text(args.goal,'BROWSER_GOAL',2000);
  const timeoutMs=integer(args.timeout_ms,60000,1000,120000,'BROWSER_TIMEOUT');
  const maxActions=integer(args.maxActions,32,1,32,'BROWSER_ACTION_BUDGET');
  const workflow=args.workflow??{steps:args.steps,final:args.final};
  if(!workflow||!Array.isArray(workflow.steps)||!workflow.steps.length||workflow.steps.length>maxActions)throw fail('BOUNDED_BROWSER_WORKFLOW_REQUIRED');
  const allowed=args.allowedMutations??[];
  if(!Array.isArray(allowed)||allowed.some(x=>!MUTATIONS.has(x)))throw fail('INVALID_MUTATION_ALLOWLIST');
  const origins=args.allowedOrigins??[];
  if(!Array.isArray(origins)||origins.length>32)throw fail('INVALID_ORIGIN_ALLOWLIST');
  const allowedOrigins=[...new Set(origins.map(x=>new URL(url(x)).origin))];
  const checkUrl=u=>{if(allowedOrigins.length&&!allowedOrigins.includes(new URL(u).origin))throw fail('BROWSER_ORIGIN_NOT_ALLOWED');return u};
  const steps=workflow.steps.map((step,index)=>{
    if(!step||!ACTIONS.has(step.action))throw fail('UNSUPPORTED_BROWSER_ACTION');
    if(MUTATIONS.has(step.action)&&!allowed.includes(step.action))throw fail('BROWSER_MUTATION_NOT_ALLOWED');
    const out={id:String(index+1),action:step.action,page:step.page??'p1',timeoutMs:integer(step.timeout_ms,5000,50,30000,'BROWSER_STEP_TIMEOUT')};
    if(!/^p[1-9][0-9]{0,2}$/.test(out.page))throw fail('INVALID_BROWSER_PAGE_LABEL');
    if(step.action==='open'){out.url=checkUrl(url(step.url));out.after=condition(step.after??{url:out.url})}
    else{
      out.expectedUrl=checkUrl(url(step.expectedUrl));
      if(['click','fill','select','extract'].includes(step.action))out.selector=text(step.selector,'BROWSER_SELECTOR',2000);
      if(step.action==='click-text')out.text=text(step.text,'TARGET_TEXT',1000);
      if(['fill','select'].includes(step.action)){if(typeof step.value!=='string'||step.value.length>12000)throw fail('INVALID_BROWSER_VALUE');out.value=step.value}
      if(step.action==='extract'){out.limit=integer(step.limit,10,1,40,'EXTRACT_LIMIT');out.maxChars=integer(step.maxChars,3000,1,12000,'EXTRACT_CHARACTER_LIMIT')}
      if(step.action==='snapshot')out.includeText=step.includeText===true;
      if(['verify','wait'].includes(step.action))out.condition=condition(step.condition);
      if(MUTATIONS.has(step.action))out.after=condition(step.after);
    }
    if(out.after?.url)checkUrl(out.after.url);
    if(out.condition?.url)checkUrl(out.condition.url);
    return out;
  });
  const final=condition(workflow.final);if(final.url)checkUrl(final.url);
  const finalPage=workflow.finalPage??steps.at(-1).page;if(!/^p[1-9][0-9]{0,2}$/.test(finalPage))throw fail('INVALID_BROWSER_PAGE_LABEL');
  return {sessionId,phaseId,goal,timeoutMs,maxActions,allowedMutations:[...new Set(allowed)].sort(),allowedOrigins,steps,final,finalPage};
}
function root(P){const r=path.join(P.stateRoot,'browser-jobs');ensureDir(r);return r}
function locations(P,plan){const dir=path.join(root(P),plan.sessionId);return {dir,session:path.join(dir,'session.json'),phase:path.join(dir,plan.phaseId+'.json')}}
export function browserJobStatus(P,{sessionId,limit=20}={}){
  const names=sessionId?[sessionId]:fs.readdirSync(root(P)).sort().slice(-integer(limit,20,1,100,'BROWSER_STATUS_LIMIT'));
  return names.map(id=>{
    if(!isSafeId(id))throw fail('INVALID_BROWSER_SESSION_ID');
    try{const file=path.join(root(P),id,'session.json');const s=readJson(file);return {sessionId:id,spaceId:s.spaceId??null,name:s.name,lastPhase:s.lastPhase??null,state:s.state,updatedAt:s.updatedAt}}
    catch{return {sessionId:id,state:'unknown'}}
  });
}
export function compileBrowserJob(plan,P,files,session){
  const moduleUrls={receipts:new URL('./receipts.mjs',import.meta.url).href,util:new URL('./util.mjs',import.meta.url).href,dom:new URL('./browser-dom.mjs',import.meta.url).href};
  // Module paths are generated on the executing host, never hard-coded to the build machine.
  return `
const plan=${JSON.stringify(plan)},P=${JSON.stringify(P)},files=${JSON.stringify(files)},session=${JSON.stringify(session)};
const {beginCall,finishCall}=await import(${JSON.stringify(moduleUrls.receipts)});
const {writeJson,readJson}=await import(${JSON.stringify(moduleUrls.util)});
const {browserScript}=await import(${JSON.stringify(moduleUrls.dom)});
if(typeof taskSpace!=='function')return {ok:false,errorCode:'EGO_TASKSPACE_API_UNAVAILABLE',dispatched:false,uncertain:false};
const deadline=Date.now()+plan.timeoutMs;
const die=(code,uncertain=false)=>Object.assign(new Error(code),{code,uncertain,dispatched:uncertain});
const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw die('BROWSER_JOB_TIMEOUT',true);return ms};
let touched=false,task=null,active=null;
const record=readJson(files.phase);
try{
  task=await taskSpace(session.spaceId??session.name);touched=true;
  if(!Number.isSafeInteger(task.spaceId)||task.spaceId<=0)throw die('INVALID_TASKSPACE_ID',true);
  writeJson(files.session,{...session,spaceId:task.spaceId,lastPhase:plan.phaseId,state:'running',updatedAt:new Date().toISOString()});
  record.spaceId=task.spaceId;record.state='running';writeJson(files.phase,record);
  const evaluate=async(page,cfg)=>{
    remaining();
    if(plan.allowedOrigins.length){const actual=await page.url();if(!plan.allowedOrigins.includes(new URL(actual).origin))throw die('BROWSER_ACTUAL_ORIGIN_NOT_ALLOWED',true)}
    const r=await page.evaluate(browserScript(cfg));
    if(!r||r.ok!==true)throw die(r?.error||'INVALID_BROWSER_OBSERVATION',r?.dispatched!==false||r?.uncertain===true);
    return r;
  };
  const verify=async(page,c,ms)=>{
    const end=Date.now()+Math.min(ms,remaining());
    for(;;){const result=await evaluate(page,{action:'verify',condition:c});if(result.matched===true)return result;
      if(Date.now()>=end)throw die('BROWSER_POSTCONDITION_NOT_OBSERVED',touched);
      await new Promise(resolve=>setTimeout(resolve,Math.min(75,end-Date.now())));
    }
  };
  const outcomes=[];
  for(const step of plan.steps){
    remaining();
    const id='browser-step-'+${JSON.stringify(crypto.createHash('sha256').update(plan.sessionId+'\0'+plan.phaseId).digest('hex').slice(0,32))}+'-'+step.id;
    const isMutation=${JSON.stringify([...MUTATIONS])}.includes(step.action);
    const intent={tool:'bounded_browser_step',sessionId:plan.sessionId,phaseId:plan.phaseId,step};
    const start=beginCall({callId:id,intent,mutating:isMutation,resources:['browser-step:'+plan.sessionId+':'+plan.phaseId+':'+step.id]},P);
    if(start.replay){if(start.receipt.state!=='completed')throw die('BROWSER_STEP_REQUIRES_RECONCILIATION',true);outcomes.push(start.receipt.result);continue}
    active=start.receipt;
    const page=task.page(step.page);let value;
    if(step.action==='open'){
      touched=true;await page.goto(step.url,{timeout:Math.min(step.timeoutMs,remaining())});
      await verify(page,step.after,step.timeoutMs);value=await evaluate(page,{action:'snapshot'});
    }else if(step.action==='wait'||step.action==='verify'){
      await evaluate(page,{action:'snapshot',expectedUrl:step.expectedUrl});value=await verify(page,step.condition,step.timeoutMs);
    }else{
      // One in-page evaluation performs fresh URL/target validation and action.
      value=await evaluate(page,step);
      if(isMutation){touched=true;await verify(page,step.after,step.timeoutMs);value={action:step.action,verified:true,observation:await evaluate(page,{action:'snapshot'})}}
    }
    const outcome={id:step.id,action:step.action,page:step.page,value};
    finishCall(active,{state:'completed',result:outcome},P);active=null;outcomes.push(outcome);
    record.completedStepIds=outcomes.map(x=>x.id);record.updatedAt=new Date().toISOString();writeJson(files.phase,record);
  }
  const page=task.page(plan.finalPage);const final=await verify(page,plan.final,Math.min(5000,remaining()));
  const observation=await evaluate(page,{action:'snapshot'});
  const result={ok:true,state:'completed',verified:true,spaceId:task.spaceId,sessionId:plan.sessionId,phaseId:plan.phaseId,
    steps:outcomes,verifiedAt:new Date().toISOString(),verificationFresh:true,verification:{matched:final.matched,checks:final.checks,page:plan.finalPage,observation},backend:'ego-lite'};
  record.state='completed';record.result=result;record.updatedAt=new Date().toISOString();writeJson(files.phase,record);
  writeJson(files.session,{...session,spaceId:task.spaceId,lastPhase:plan.phaseId,state:'completed',updatedAt:record.updatedAt});
  return result;
}catch(error){
  const uncertain=touched||error.uncertain===true||error.dispatched===true;
  if(active)finishCall(active,{state:uncertain?'uncertain':'failed',reason:error.code||'BROWSER_JOB_FAILED'},P);
  record.state=uncertain?'uncertain':'failed';record.reason=error.code||'BROWSER_JOB_FAILED';record.updatedAt=new Date().toISOString();writeJson(files.phase,record);
  writeJson(files.session,{...session,spaceId:task?.spaceId??session.spaceId??null,lastPhase:plan.phaseId,state:record.state,updatedAt:record.updatedAt});
  return {ok:false,errorCode:record.reason,dispatched:touched,uncertain,sessionId:plan.sessionId,phaseId:plan.phaseId};
}
`;
}
export async function runBrowserJob(args,P){
  const plan=normalizeBrowserJob(args),files=locations(P,plan),hash=intentHash(plan);
  const bridge=new EgoBridge();
  let session,replay;
  withStateTransaction(P,()=>{
    ensureDir(files.dir);
    if(fs.existsSync(files.phase)){
      const prior=readJson(files.phase);
      if(prior.specHash!==hash)throw fail('BROWSER_PHASE_CONFLICT');
      if(prior.state==='completed'){replay=prior.result;return}
      throw fail('BROWSER_PHASE_REQUIRES_RECONCILIATION',true);
    }
    session=fs.existsSync(files.session)?readJson(files.session):{sessionId:plan.sessionId,name:'Navish '+plan.goal.split(/\s+/).slice(0,3).join(' ')+' '+crypto.createHash('sha256').update(plan.sessionId).digest('hex').slice(0,10),spaceId:null};
    if(['running','uncertain'].includes(session.state))throw fail('BROWSER_SESSION_REQUIRES_RECONCILIATION',true);
    if(!bridge.available)throw new EgoError('EGO_UNAVAILABLE');
    writeJson(files.phase,{version:1,sessionId:plan.sessionId,phaseId:plan.phaseId,specHash:hash,state:'accepted',completedStepIds:[],createdAt:nowIso()});
    writeJson(files.session,{...session,state:'running',lastPhase:plan.phaseId,updatedAt:nowIso()});
  });
  if(replay)return {...redact(replay),reused:true,verificationFresh:false,goalVerified:true,completionLevel:'recorded-declared-postconditions'};
  try{
    const result=await bridge.execute(compileBrowserJob(plan,P,files,session),{timeoutMs:plan.timeoutMs+1500});
    if(result.verified!==true||result.verification?.matched!==true)throw fail('BROWSER_POSTCONDITION_NOT_VERIFIED',true);
    return {...result,reused:false,goalVerified:true,completionLevel:'declared-postconditions',backendRequested:'ego-lite',backendChosen:'ego-lite',fallbackReason:null};
  }catch(e){
    withStateTransaction(P,()=>{
      const record=readJson(files.phase);
      // A completed local phase with a lost response remains durable; the outer
      // receipt is still uncertain until explicitly reconciled by the caller.
      if(record.state!=='completed'){
        const state=e.uncertain?'uncertain':'failed';
        writeJson(files.phase,{...record,state,reason:e.code||'BROWSER_JOB_FAILED',updatedAt:nowIso()});
        const current=readJson(files.session);writeJson(files.session,{...current,state,updatedAt:nowIso()});
      }
    });
    throw e;
  }
}
