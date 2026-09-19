import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decryptRequest, encryptResult, PROTOCOL } from './control-crypto.mjs';
import { ensureDir, nowIso, readJson, run, writeJson, isSafeId } from './util.mjs';
import { sync, publishFile } from './control-git.mjs';

function receiptPath(paths,id){return path.join(paths.receiptsDir,`${id}.json`)}
function loadReceipt(paths,id){const p=receiptPath(paths,id);return fs.existsSync(p)?readJson(p):null}
function saveReceipt(paths,value){writeJson(receiptPath(paths,value.commandId),value,0o600)}
function outputLimit(s,n=256*1024){s=String(s??'');if(Buffer.byteLength(s,'utf8')<=n)return{text:s,truncated:false};return{text:Buffer.from(s).subarray(0,n).toString('utf8'),truncated:true}}

function validatePayload(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('payload must be object');
  const{targetDevice,tool,args={},timeoutMs=120000}=payload;
  if(!isSafeId(targetDevice)||!isSafeId(tool))throw new Error('invalid targetDevice/tool');
  if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('args must be object');
  if(!Number.isFinite(timeoutMs)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>3600000)throw new Error('timeoutMs must be an integer between 1 and 3600000');
  return{...payload,args,timeoutMs};
}

export function executeNavish(payload,commandId,navishBin='navish'){
  payload=validatePayload(payload);
  const{targetDevice,tool,args={}}=payload;
  const augmented={...args};
  if(!('navishCallId'in augmented))augmented.navishCallId=commandId;
  const r=run(navishBin,['call',targetDevice,tool,JSON.stringify(augmented),'--call-id',commandId,'--timeout-ms',String(payload.timeoutMs),'--compact','--json'],{timeoutMs:payload.timeoutMs||120000,maxBuffer:4*1024*1024});
  return{exitCode:r.code,signal:r.signal,error:r.error,stdout:outputLimit(r.stdout),stderr:outputLimit(r.stderr)};
}
function resultMeta(env){return{protocol:PROTOCOL,commandId:env.commandId,controllerId:env.controllerId,createdAt:env.createdAt,expiresAt:env.expiresAt}}

const TERMINAL_STATES=new Set(['completed','failed','expired','uncertain','blocked']);

/** Validate the actual core receipt, not just its subprocess exit code.
 * start_process may correctly complete its *start* operation while the child is
 * running; therefore only the outer core receipt is classified here.
 */
export function classifyExecution(result, commandId) {
  if (!result || typeof result !== 'object') return {state:'uncertain',reason:'CORE_RESULT_MISSING'};
  if (result.exitCode == null && /ENOENT|not found/i.test(result.error || '')) return {state:'failed',reason:'CORE_NOT_DISPATCHED'};
  if (result.error || result.signal || result.exitCode == null) return {state:'uncertain',reason:'CORE_PROCESS_OUTCOME_UNKNOWN'};
  if (result.stdout?.truncated === true) return {state:'uncertain',reason:'CORE_RECEIPT_TRUNCATED'};
  let receipt;
  try { receipt=JSON.parse(result.stdout?.text); } catch { return {state:'uncertain',reason:'CORE_RECEIPT_INVALID'}; }
  if (!receipt || Array.isArray(receipt) || receipt.callId !== commandId || !TERMINAL_STATES.has(receipt.state)) return {state:'uncertain',reason:'CORE_RECEIPT_ID_OR_STATE_INVALID'};
  const expectedCode=receipt.state==='completed'?0:receipt.state==='failed'?2:3;
  if (result.exitCode !== expectedCode) return {state:'uncertain',reason:'CORE_RECEIPT_EXIT_CONFLICT'};
  return {state:receipt.state,coreState:receipt.state};
}
function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function requestFingerprint(envelope) {return crypto.createHash('sha256').update(canonical(envelope)).digest('hex');}

export function processCommand({config,paths,envelope,executor=executeNavish,navishBin='navish',publish=true}){
  if(envelope?.protocol!==PROTOCOL||envelope?.controllerId!==config.controllerId)return{skipped:true,reason:'not-for-controller'};
  if(!isSafeId(envelope.commandId))return{skipped:true,reason:'invalid-command-id'};
  // Authenticate before changing receipts or considering a cached plaintext result.
  let payload;
  try{payload=decryptRequest({devicePrivateKeyPem:fs.readFileSync(paths.privateKeyFile,'utf8'),envelope})}catch{return{skipped:true,reason:'REQUEST_AUTHENTICATION_FAILED'}}
  const fingerprint=requestFingerprint(envelope), responsePublicKeyPem=envelope.crypto.ephemeralPublicKeyPem;
  const existing=loadReceipt(paths,envelope.commandId);
  if(existing){
    if(!existing.requestFingerprint)return{skipped:true,reason:'LEGACY_RECEIPT_RECONCILIATION_REQUIRED'};
    if(existing.requestFingerprint!==fingerprint)return{skipped:true,reason:'COMMAND_ID_CONFLICT'};
    if(TERMINAL_STATES.has(existing.state)){
      if(existing.publishedAt)return{skipped:true,reason:'already-terminal-published',receipt:existing};
      return{terminal:existing,replayedTerminal:true,responsePublicKeyPem};
    }
    if(existing.state==='running'){
      const uncertain={...existing,state:'uncertain',finishedAt:nowIso(),reason:'bridge restarted while effect was running; no automatic replay'};
      saveReceipt(paths,uncertain);return{terminal:uncertain,responsePublicKeyPem};
    }
  }
  const common={commandId:envelope.commandId,requestFingerprint:fingerprint};
  const exp=Date.parse(envelope.expiresAt),now=Date.now();
  if(!Number.isFinite(exp)||exp<now){const expired={...common,state:'expired',finishedAt:nowIso()};saveReceipt(paths,expired);return{terminal:expired,responsePublicKeyPem}}
  try{payload=validatePayload(payload)}catch{const failed={...common,state:'failed',finishedAt:nowIso(),reason:'INVALID_PAYLOAD'};saveReceipt(paths,failed);return{terminal:failed,responsePublicKeyPem}}
  const admitted={...common,state:'admitted',admittedAt:nowIso(),targetDevice:payload.targetDevice,tool:payload.tool};saveReceipt(paths,admitted);
  const running={...admitted,state:'running',startedAt:nowIso()};saveReceipt(paths,running);
  let execResult,outcome;
  try{execResult=executor(payload,envelope.commandId,navishBin);outcome=classifyExecution(execResult,envelope.commandId)}
  catch{execResult={exitCode:null,error:'CORE_EXECUTION_EXCEPTION'};outcome={state:'uncertain',reason:'CORE_EXECUTION_EXCEPTION'}}
  const terminal={...running,...outcome,finishedAt:nowIso(),result:execResult};saveReceipt(paths,terminal);
  return{terminal,responsePublicKeyPem};
}

export function publishTerminal({config,paths,envelope,terminal,responsePublicKeyPem,assumeFresh=false}){
  const encrypted=encryptResult({responsePublicKeyPem,payload:terminal,meta:resultMeta(envelope)});
  const rel=`results/${config.controllerId}/${envelope.commandId}.json`;
  publishFile({repoDir:paths.repoDir,branch:config.branch,relativePath:rel,assumeFresh,content:`${JSON.stringify(encrypted,null,2)}\n`,message:`result ${config.controllerId}/${envelope.commandId}`});
  return rel;
}

export function bridgeOnce({config,paths,executor=executeNavish,navishBin=config.navishBin||'navish'}){
  ensureDir(paths.receiptsDir);sync(paths.repoDir,config.branch);
  const dir=path.join(paths.repoDir,'commands',config.controllerId);
  if(!fs.existsSync(dir))return{processed:0,skipped:0,results:[]};
  const files=fs.readdirSync(dir).filter(x=>x.endsWith('.json')).sort();
  let processed=0,skipped=0;const results=[];
  for(const f of files){
    const fileId=f.slice(0,-5);
    if(isSafeId(fileId)){
      const fileRel=`results/${config.controllerId}/${fileId}.json`;
      if(fs.existsSync(path.join(paths.repoDir,fileRel))){
        const existing=loadReceipt(paths,fileId);
        if(existing&&TERMINAL_STATES.has(existing.state)){
          if(!existing.publishedAt)saveReceipt(paths,{...existing,publishedAt:nowIso(),resultPath:fileRel,publishReconciled:true});
        }else if(!existing){
          saveReceipt(paths,{commandId:fileId,state:'uncertain',finishedAt:nowIso(),reason:'remote result exists but local receipt is missing; refusing replay',publishedAt:nowIso(),resultPath:fileRel,remoteTerminalObserved:true});
        }else{
          saveReceipt(paths,{...existing,state:'uncertain',finishedAt:nowIso(),reason:'remote result exists while local receipt is nonterminal; refusing replay',publishedAt:nowIso(),resultPath:fileRel,remoteTerminalObserved:true});
        }
        skipped++;continue;
      }
    }
    let env;try{env=readJson(path.join(dir,f))}catch{skipped++;continue}
    if(env?.protocol===PROTOCOL&&env?.controllerId===config.controllerId&&isSafeId(env?.commandId)){
      const rel=`results/${config.controllerId}/${env.commandId}.json`;
      if(fs.existsSync(path.join(paths.repoDir,rel))){
        const existing=loadReceipt(paths,env.commandId);
        if(existing&&TERMINAL_STATES.has(existing.state)){
          if(!existing.publishedAt)saveReceipt(paths,{...existing,publishedAt:nowIso(),resultPath:rel,publishReconciled:true});
        }else if(!existing){
          saveReceipt(paths,{commandId:env.commandId,state:'uncertain',finishedAt:nowIso(),reason:'remote result exists but local receipt is missing; refusing replay',publishedAt:nowIso(),resultPath:rel,remoteTerminalObserved:true});
        }else{
          saveReceipt(paths,{...existing,state:'uncertain',finishedAt:nowIso(),reason:'remote result exists while local receipt is nonterminal; refusing replay',publishedAt:nowIso(),resultPath:rel,remoteTerminalObserved:true});
        }
        skipped++;continue;
      }
    }
    const out=processCommand({config,paths,envelope:env,executor,navishBin});
    if(out.terminal){
      let responseKey=out.responsePublicKeyPem;
      if(!responseKey){try{decryptRequest({devicePrivateKeyPem:fs.readFileSync(paths.privateKeyFile,'utf8'),envelope:env});responseKey=env.crypto.ephemeralPublicKeyPem}catch{}}
      if(responseKey&&!out.terminal.publishedAt){
        const rel=`results/${config.controllerId}/${env.commandId}.json`;
        if(fs.existsSync(path.join(paths.repoDir,rel))){saveReceipt(paths,{...out.terminal,publishedAt:nowIso(),resultPath:rel,publishReconciled:true})}
        else{publishTerminal({config,paths,envelope:env,terminal:out.terminal,responsePublicKeyPem:responseKey,assumeFresh:true});const published={...out.terminal,publishedAt:nowIso(),resultPath:rel};saveReceipt(paths,published);results.push(rel)}
      }
      processed++;
    }else skipped++;
  }
  return{processed,skipped,results};
}
