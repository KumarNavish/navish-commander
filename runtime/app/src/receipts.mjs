import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir, nowIso, readJson, writeJson, isSafeId, syncDirectory } from './util.mjs';
import { paths as getPaths, ensureBase } from './config.mjs';
import { withStateTransaction, processOwner, ownerIsLive } from './state-lock.mjs';

// Preserve the v1 intent hash byte-for-byte so old call IDs remain valid after upgrade.
function stable(x){
  if(Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if(x && typeof x==='object') return `{${Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')}}`;
  return JSON.stringify(x);
}
export function intentHash(intent){return crypto.createHash('sha256').update(stable(intent)).digest('hex')}
function checkId(id){if(!isSafeId(id))throw new Error('invalid callId');return id}
export function receiptPath(P,callId){return path.join(P.receiptsDir,`${checkId(callId)}.json`)}
const activeDir=P=>path.join(P.stateRoot,'active-calls');
const activePath=(P,id)=>path.join(activeDir(P),`${checkId(id)}.json`);
export function loadReceipt(callId,P=getPaths()){
  try{return readJson(receiptPath(P,callId))}catch(e){if(e.code==='ENOENT')return null;throw e}
}
function saveRaw(r,P){writeJson(receiptPath(P,r.callId),r,0o600);return r}
export function saveReceipt(r,P=getPaths()){ensureBase(P);return withStateTransaction(P,()=>saveRaw(r,P))}
const MUTATING=new Set(['edit_block','start_search','stop_search','set_config_value','browser_agent','write_file','create_directory','move_file','start_process','interact_with_process','force_terminate','kill_process','browser_command','pair_install','agent_batch_start','agent_batch_send','agent_batch_cancel','agentic_run','agentic_continue','agentic_cancel','agent_job_start','agent_job_cancel']);
// An unvalidated caller-supplied label must not downgrade a browser plan to a read.
export function isMutating(tool,args={}){return MUTATING.has(tool)}
export function defaultResources(tool,args={}){
  if(['agent_job_start','agent_job_cancel'].includes(tool))return ['agent-job:'+String(args.jobId??'unspecified')];
  if(['start_search','stop_search'].includes(tool))return ['search:'+String(args.sessionId??'unspecified')];
  if(tool==='set_config_value')return ['commander-config'];
  if(['write_file','create_directory','move_file','edit_block'].includes(tool)){
    return [...new Set([args.path,args.file_path,args.source,args.destination].filter(Boolean).map(p=>'fs:'+path.resolve(String(p))))];
  }
  if(['interact_with_process','force_terminate','kill_process'].includes(tool))return [`process:${args.pid??args.sessionId??'unknown'}`];
  if(['agent_batch_start','agent_batch_send','agent_batch_cancel'].includes(tool)){
    const rs=['agent-batch:'+(args.batchId??'unknown')];
    if(tool==='agent_batch_start'&&Array.isArray(args.workers))for(const w of args.workers)if(w?.cwd)rs.push('fs:'+path.resolve(String(w.cwd)));
    return rs;
  }
  if(tool==='browser_command')return ['foreground_gui'];
  if(tool==='browser_agent')return ['ego-space:'+String(args.sessionId??args.goal??'unspecified')];
  if(['agentic_run','agentic_continue','agentic_cancel'].includes(tool))return ['goal:'+String(args.sessionId??args.requestId??'unspecified')];
  return [];
}
const normalizeResources=rs=>[...new Set(rs.map(String).filter(Boolean))].sort();
export function resourceConflicts(a,b){
  if(a===b)return true;
  if(a.startsWith('fs:')&&b.startsWith('fs:')){const pa=a.slice(3),pb=b.slice(3);return pa.startsWith(pb+path.sep)||pb.startsWith(pa+path.sep)}
  return false;
}
function loadQuarantine(P){
  try{const q=readJson(P.uncertainFile);if(!q||typeof q.resources!=='object'||Array.isArray(q.resources))throw new Error('corrupt resource quarantine');return q}
  catch(e){if(e.code==='ENOENT')return {version:1,resources:{}};e.code='QUARANTINE_CORRUPT';throw e}
}
function conflictsRaw(resources,P){const q=loadQuarantine(P);return Object.entries(q.resources).filter(([key])=>resources.some(r=>resourceConflicts(r,key))).map(([resource,meta])=>({resource,...meta}))}
export function quarantinedConflicts(resources,P=getPaths()){ensureBase(P);return withStateTransaction(P,()=>conflictsRaw(resources,P))}
function quarantineRaw(resources,receipt,P){
  if(!resources?.length)return;
  const q=loadQuarantine(P);
  for(const r of normalizeResources(resources)){const old=q.resources[r];const callIds=[...new Set([...(old?.callIds||[old?.callId]).filter(Boolean),receipt.callId])];q.resources[r]={callId:receipt.callId,callIds,reason:receipt.reason||'uncertain effect',since:old?.since||nowIso()};}
  writeJson(P.uncertainFile,q,0o600);
}
export function quarantine(resources,receipt,P=getPaths()){ensureBase(P);return withStateTransaction(P,()=>quarantineRaw(resources,receipt,P))}
export function reconcileQuarantine({callId,resources=[]},P=getPaths()){
  ensureBase(P);return withStateTransaction(P,()=>{
    // Settle any interrupted terminal publication before an explicit release.
    activeRaw(P);
    const q=loadQuarantine(P);let changed=false;
    for(const [key,meta] of Object.entries(q.resources)){if(resources.some(r=>resourceConflicts(r,key))){delete q.resources[key];changed=true;continue}const ids=meta.callIds||[meta.callId];if(callId&&ids.includes(callId)){const remaining=ids.filter(x=>x!==callId);if(remaining.length)q.resources[key]={...meta,callId:remaining.at(-1),callIds:remaining};else delete q.resources[key];changed=true;}}
    if(changed)writeJson(P.uncertainFile,q,0o600);
    return changed;
  });
}
function removeActive(id,P){try{fs.unlinkSync(activePath(P,id))}catch(e){if(e.code!=='ENOENT')throw e}}
function recoverOne(r,P){
  if(r.state!=='running'){
    // A crash after the terminal receipt write but before quarantine publication
    // leaves this active record. Complete that publication before releasing it.
    if(r.state==='uncertain'&&r.mutating)quarantineRaw(r.resources||[],r,P);
    removeActive(r.callId,P);return r;
  }
  if(ownerIsLive(r.owner))return r;
  const out={...r,state:'uncertain',finishedAt:nowIso(),reason:'execution owner is no longer live; reconcile effects before any new mutation'};
  saveRaw(out,P);if(out.mutating)quarantineRaw(out.resources||[],out,P);removeActive(out.callId,P);return out;
}
function activeRaw(P){
  ensureDir(activeDir(P));const out=[];
  for(const f of fs.readdirSync(activeDir(P)).filter(x=>x.endsWith('.json'))){
    // A damaged active record is not permission to release a resource.
    const claim=readJson(path.join(activeDir(P),f));
    const r=recoverOne(loadReceipt(claim.callId,P)||claim,P);
    if(r.state==='running')out.push(r);
  }
  return out;
}
const scanned=new Set();
export function recoverRunningReceipts(P=getPaths(),{force=false}={}){
  ensureBase(P);return withStateTransaction(P,()=>{
    const before=[];
    if(force||!scanned.has(P.stateRoot)){
      ensureDir(activeDir(P));
      for(const f of fs.readdirSync(P.receiptsDir).filter(x=>x.endsWith('.json'))){
        const r=readJson(path.join(P.receiptsDir,f));
        if(r.state!=='running')continue;
        if(!fs.existsSync(activePath(P,r.callId)))writeJson(activePath(P,r.callId),r,0o600);
        if(!ownerIsLive(r.owner))before.push(r.callId);
      }
      scanned.add(P.stateRoot);
    }
    for(const f of fs.readdirSync(activeDir(P)).filter(x=>x.endsWith('.json'))){const r=readJson(path.join(activeDir(P),f));if(!ownerIsLive(r.owner)&&!before.includes(r.callId))before.push(r.callId)}
    activeRaw(P);return before;
  });
}
export function beginCall({callId,intent,resources=[],mutating=false},P=getPaths(),transactionOptions={}){
  checkId(callId);ensureBase(P);return withStateTransaction(P,()=>{
    const hash=intentHash(intent);const existing=loadReceipt(callId,P);
    if(existing){
      if(existing.intentHash!==hash)throw new Error(`callId ${callId} already belongs to a different intent`);
      // Replay does not admit an effect. Only finish this receipt's interrupted
      // ownership/quarantine publication; unrelated damaged jobs cannot erase it.
      const needsRecovery=existing.state==='running'||fs.existsSync(activePath(P,callId));
      return {replay:true,receipt:needsRecovery?recoverOne(existing,P):existing};
    }
    // New admissions still recover legacy running receipts and fail closed on
    // every damaged active owner. Do not scan those before exact-ID replay.
    if(!scanned.has(P.stateRoot))recoverRunningReceipts(P);
    const active=activeRaw(P);
    const rs=normalizeResources(resources);
    if(mutating){const hits=conflictsRaw(rs,P);if(hits.length){const e=new Error(`resource quarantined by uncertain call: ${JSON.stringify(hits)}`);e.code='RESOURCE_QUARANTINED';e.dispatched=false;throw e}}
    const blocking=active.find(r=>(r.resources||[]).some(a=>rs.some(b=>resourceConflicts(a,b))));
    if(blocking){const e=new Error(`resource busy with live call ${blocking.callId}`);e.code='RESOURCE_BUSY';e.dispatched=false;throw e}
    const r={callId,intentHash:hash,state:'running',startedAt:nowIso(),mutating,resources:rs,intent,owner:processOwner()};
    // Register ownership first. A crash between these writes is conservatively recoverable.
    writeJson(activePath(P,callId),r,0o600);
    try{
      // Both admission records have identical bytes. Reuse the already flushed
      // inode, then durably publish its receipt name. Terminal updates replace
      // the receipt atomically, leaving the original active claim intact.
      try{fs.linkSync(activePath(P,callId),receiptPath(P,callId));}
      catch(e){
        if(!['EXDEV','EPERM','ENOTSUP','EOPNOTSUPP'].includes(e.code))throw e;
        saveRaw(r,P);return {replay:false,receipt:r};
      }
      syncDirectory(P.receiptsDir);
    }catch(e){removeActive(callId,P);throw e}
    return {replay:false,receipt:r};
  },transactionOptions);
}
export function finishCall(receipt,{state,result=null,reason=null},P=getPaths(),transactionOptions={}){
  if(!['completed','failed','uncertain','abandoned'].includes(state))throw new Error('invalid terminal receipt state');
  try{return withStateTransaction(P,()=>{
    const current=loadReceipt(receipt.callId,P);
    if(!current||current.intentHash!==receipt.intentHash)throw new Error('receipt identity mismatch');
    if(current.state!=='running')return current;
    if(current.owner?.instanceId!==processOwner().instanceId)throw new Error('receipt belongs to another execution owner');
    const r={...current,state,finishedAt:nowIso(),result};if(reason)r.reason=reason;
    saveRaw(r,P);if(state==='uncertain'&&r.mutating)quarantineRaw(r.resources||[],r,P);removeActive(r.callId,P);return r;
  },transactionOptions)}catch(error){
    // The action has already returned. A metadata failure must never claim that
    // no action happened or cause its execution to run a second time.
    error.uncertain=true;error.dispatched=true;error.receiptFinalizationPending=true;
    throw error;
  }
}
