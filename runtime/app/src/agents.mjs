import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir, readJson, writeJson, nowIso, isSafeId, sleep } from './util.mjs';
import { withStateTransaction } from './state-lock.mjs';
import { startProcessTool, readProcessOutputTool, inspectProcessSession, interactProcessTool, terminateProcessTool } from './process.mjs';

function batchesRoot(P){const d=path.join(P.stateRoot,'agent-batches');ensureDir(d);return d}
function batchPath(P,id){return path.join(batchesRoot(P),validId(id,'batch id')+'.json')}
function stable(x){
  if(Array.isArray(x))return '['+x.map(stable).join(',')+']';
  if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
  return JSON.stringify(x);
}
function hashSpec(x){return crypto.createHash('sha256').update(stable(x)).digest('hex')}
function validId(x,label){const s=String(x||'');if(!isSafeId(s))throw new Error('invalid '+label);return s}
function bounded(value,fallback,min,max,label){const n=value==null?fallback:Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error('invalid '+label);return n}
function normalizeWorker(w){
  const id=validId(w.id,'worker id'),command=String(w.command||'').trim();
  if(!command)throw new Error('worker '+id+' command required');
  if(w.env!=null&&(typeof w.env!=='object'||Array.isArray(w.env)))throw new Error('worker env must be an object');
  const env=Object.fromEntries(Object.entries(w.env||{}).map(([k,v])=>[String(k),String(v)]));
  const normalized={id,role:String(w.role||id),command,cwd:w.cwd?path.resolve(String(w.cwd)):null,env,startTimeoutMs:bounded(w.startTimeoutMs,300,0,30000,'worker initial wait')};
  // Keep the v1 fingerprint byte-compatible when no artifact contract is supplied.
  if(w.artifacts!=null){
    if(!Array.isArray(w.artifacts)||w.artifacts.length>32)throw new Error('invalid artifact list');
    normalized.artifacts=w.artifacts.map(a=>{
      if(!a||typeof a.path!=='string'||!a.path||path.isAbsolute(a.path)||a.path.split(/[\\/]/).includes('..'))throw new Error('artifact path must be relative to worker cwd');
      if(a.sha256!=null&&!/^[a-f0-9]{64}$/.test(a.sha256))throw new Error('invalid artifact hash');
      return {path:a.path,minBytes:bounded(a.minBytes,1,0,16*1024*1024,'artifact minimum size'),...(a.sha256?{sha256:a.sha256}:{})};
    });
  }
  return normalized;
}
function loadBatch(P,id){const f=batchPath(P,id);if(!fs.existsSync(f))throw new Error('agent batch not found: '+id);return readJson(f)}
function saveBatch(P,b){writeJson(batchPath(P,b.batchId),b,0o600);return b}
function updateWorker(P,id,workerId,changes){return withStateTransaction(P,()=>{
  const b=loadBatch(P,id),index=b.workers.findIndex(w=>w.id===workerId);
  if(index<0)throw new Error('worker disappeared from batch');
  b.workers[index]={...b.workers[index],...changes};b.updatedAt=nowIso();return saveBatch(P,b);
})}
function checkArtifacts(w){
  return (w.artifacts||[]).map(a=>{
    try{
      const root=fs.realpathSync(w.resolvedCwd||w.cwd||process.cwd());
      const file=fs.realpathSync(path.join(root,a.path));
      if(!file.startsWith(root+path.sep))return {...a,ok:false,reason:'artifact outside worker directory'};
      const st=fs.statSync(file);
      if(!st.isFile()||st.size<a.minBytes)return {...a,ok:false,reason:'artifact absent, non-regular, or too small'};
      if(a.sha256&&st.size>16*1024*1024)return {...a,ok:false,reason:'artifact exceeds bounded verification limit'};
      const actual=a.sha256?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
      return {path:a.path,ok:!a.sha256||actual===a.sha256,bytes:st.size,...(actual?{sha256:actual}:{})};
    }catch{return {path:a.path,ok:false,reason:'artifact could not be observed'}}
  });
}
function workerSnapshot(w,P,tailBytes=4096){
  let observed;
  try{
    if(w.sessionId){
      observed=inspectProcessSession(w.sessionId,P);
      if(observed.pid)observed=readProcessOutputTool({sessionId:w.sessionId,offset:-tailBytes,maxBytes:tailBytes},P);
      else if(w.launchError&&observed.state==='unsubmitted')observed={...observed,state:'failed'};
    }else if(w.pid)observed=readProcessOutputTool({pid:w.pid,offset:-tailBytes,maxBytes:tailBytes},P);
    else observed={state:w.launchError?'failed':'unknown'};
    const artifacts=observed.state==='completed'?checkArtifacts(w):[];
    const state=observed.state==='completed'&&artifacts.some(a=>!a.ok)?'failed':observed.state;
    // Return task-relevant data, not environment variables or full shell commands.
    return {id:w.id,role:w.role,cwd:w.cwd||w.resolvedCwd||null,sessionId:w.sessionId||observed.sessionId||null,pid:observed.pid||w.pid||null,
      state,processState:observed.state,exitCode:observed.exitCode??null,startedAt:observed.startedAt||w.startedAt||null,
      finishedAt:observed.finishedAt??null,output:observed.output||'',outputBytes:observed.totalBytes??0,
      outputTruncated:observed.truncated??false,artifacts,...(w.launchError?{launchError:w.launchError}:{}),...(observed.reason?{reason:observed.reason}:{})};
  }catch(e){return {id:w.id,role:w.role,sessionId:w.sessionId||null,pid:w.pid||null,state:'unknown',output:'',statusError:e.code||'SESSION_OBSERVATION_FAILED'}}
}
function summarize(batch,P,tailBytes=4096,totalBytes=1048576){
  const perWorker=Math.max(1,Math.min(tailBytes,Math.floor(totalBytes/batch.workers.length)));
  const workers=batch.workers.map(w=>workerSnapshot(w,P,perWorker));
  const counts={unsubmitted:0,launching:0,running:0,completed:0,failed:0,uncertain:0,unknown:0};
  for(const w of workers)counts[Object.hasOwn(counts,w.state)?w.state:'unknown']++;
  const state=counts.uncertain||counts.unknown?'uncertain':counts.running||counts.launching?'running':counts.unsubmitted?'accepted':counts.failed?'failed':'completed';
  return {batchId:batch.batchId,state,createdAt:batch.createdAt,specHash:batch.specHash,counts,workers,
    completionLevel:state==='completed'?'workers-and-declared-artifacts':'incomplete',goalVerified:false};
}
async function collectWithWait(args,P,defaults={}){
  const wait=bounded(args.wait_ms,0,0,300000,'batch wait'),poll=bounded(args.poll_ms,100,25,2000,'batch poll');
  const tail=bounded(args.maxBytesPerWorker??args.tailBytes,defaults.tail??65536,1,4*1024*1024,'worker output limit');
  const total=bounded(args.maxTotalBytes,1048576,1,4*1024*1024,'batch output limit');
  const deadline=Date.now()+wait;let snapshot;
  for(;;){
    snapshot=summarize(loadBatch(P,args.batchId),P,1,total);
    if(!['running','accepted'].includes(snapshot.state)||Date.now()>=deadline)break;
    await sleep(Math.min(poll,deadline-Date.now()));
  }
  return {...summarize(loadBatch(P,args.batchId),P,tail,total),waitExpired:wait>0&&['running','accepted'].includes(snapshot.state)};
}

export async function agentBatchStartTool(args,P){
  const batchId=validId(args.batchId,'batch id');
  if(!Array.isArray(args.workers)||args.workers.length<1||args.workers.length>64)throw new Error('workers must contain 1 to 64 entries');
  const workers=args.workers.map(normalizeWorker);
  if(new Set(workers.map(w=>w.id)).size!==workers.length)throw new Error('worker ids must be unique');
  // Validate all observation budgets before admitting any worker launch.
  bounded(args.wait_ms,0,0,300000,'batch wait');bounded(args.poll_ms,100,25,2000,'batch poll');
  bounded(args.maxBytesPerWorker??args.tailBytes,4096,1,4*1024*1024,'worker output limit');bounded(args.maxTotalBytes,1048576,1,4*1024*1024,'batch output limit');
  const specHash=hashSpec({workers});
  const created=withStateTransaction(P,()=>{
    const file=batchPath(P,batchId);
    if(fs.existsSync(file)){
      if(readJson(file).specHash!==specHash)throw new Error('batchId already belongs to a different worker specification');
      return false;
    }
    // Every durable session identity is committed before the first process starts.
    saveBatch(P,{version:2,batchId,specHash,createdAt:nowIso(),workers:workers.map(w=>({...w,
      sessionId:'batch-'+hashSpec({batchId,specHash,workerId:w.id}).slice(0,48),resolvedCwd:w.cwd||process.cwd(),state:'unsubmitted'}))});
    return true;
  });
  if(created){
    const batch=loadBatch(P,batchId);
    await Promise.all(batch.workers.map(async w=>{
      try{
        const r=await startProcessTool({sessionId:w.sessionId,command:w.command,cwd:w.resolvedCwd,env:w.env,timeout_ms:w.startTimeoutMs},P);
        updateWorker(P,batchId,w.id,{pid:r.pid,launchState:r.state,startedAt:r.startedAt||nowIso()});
      }catch(e){updateWorker(P,batchId,w.id,{launchError:e.code||'WORKER_LAUNCH_FAILED',launchState:e.uncertain?'uncertain':'failed'})}
    }));
  }
  // Existing batches are observed, not restarted, including partial/uncertain launches.
  return {...await collectWithWait({...args,batchId},P,{tail:4096}),reused:!created};
}
export function agentBatchStatusTool(args,P){
  return summarize(loadBatch(P,args.batchId),P,bounded(args.tailBytes,4096,1,4*1024*1024,'worker output limit'),bounded(args.maxTotalBytes,1048576,1,4*1024*1024,'batch output limit'));
}
export async function agentBatchCollectTool(args,P){return collectWithWait(args,P)}
export function agentBatchListTool(args,P){
  const limit=bounded(args.limit,50,1,200,'batch list limit'),offset=bounded(args.offset,0,0,Number.MAX_SAFE_INTEGER,'batch list offset');
  const tail=bounded(args.tailBytes,512,1,65536,'worker output limit');
  const names=fs.readdirSync(batchesRoot(P)).filter(x=>x.endsWith('.json')).sort(),items=[];
  for(const file of names.slice(offset,offset+limit)){
    try{items.push(summarize(readJson(path.join(batchesRoot(P),file)),P,tail,Math.max(1,Math.floor(1048576/limit))))}
    catch{items.push({batchId:file.slice(0,-5),state:'uncertain',reason:'batch metadata could not be read'})}
  }
  return {batches:items,total:names.length,nextOffset:offset+limit<names.length?offset+limit:null};
}
export async function agentBatchSendTool(args,P){
  const b=loadBatch(P,args.batchId),id=validId(args.workerId,'worker id'),w=b.workers.find(x=>x.id===id);
  if(!w)throw new Error('worker not found');
  const snapshot=workerSnapshot(w,P,1);if(snapshot.state!=='running')throw new Error('worker is not confirmed running');
  const r=await interactProcessTool({sessionId:w.sessionId,pid:snapshot.pid,input:String(args.input??''),newline:args.newline!==false,wait_ms:Number(args.wait_ms??args.waitMs??1000),timeout_ms:Number(args.timeout_ms||5000)},P);
  return {batchId:b.batchId,workerId:id,...r};
}
export async function agentBatchCancelTool(args,P){
  const b=loadBatch(P,args.batchId),selected=args.workerId?[b.workers.find(x=>x.id===validId(args.workerId,'worker id'))]:b.workers;
  if(selected.some(x=>!x))throw new Error('worker not found');
  const cancelled=[];
  for(const w of selected){
    const s=workerSnapshot(w,P,1);
    if(s.state!=='running'){cancelled.push({workerId:w.id,state:s.state});continue}
    try{const r=await terminateProcessTool({sessionId:w.sessionId,pid:s.pid,signal:Number(args.signal||15)},P);cancelled.push({workerId:w.id,...r})}
    catch{cancelled.push({workerId:w.id,state:'uncertain'})}
  }
  return {batchId:b.batchId,cancelled,status:summarize(b,P,512)};
}
