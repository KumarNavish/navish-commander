import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withStateTransaction, processOwner, ownerIsLive } from './state-lock.mjs';
import { ensureDir, readJson, writeJson, randomId, isSafeId, run, sleep } from './util.mjs';

let preparedPython;
export function prepareProcessRuntime(){
  if(preparedPython)return preparedPython;
  try{
    // macOS /usr/bin/python3 is a developer-tools launcher. Re-entering it for
    // every worker repeats its environment discovery, especially with a fresh
    // HOME. Resolve the selected interpreter once, preserving virtualenv paths.
    const value=JSON.parse(execFileSync(process.env.NAVISH_PYTHON||'python3',
      ['-S','-c','import json,sys; print(json.dumps({"executable":sys.executable,"version":list(sys.version_info[:3])}))'],
      {encoding:'utf8',timeout:5000,maxBuffer:4096,stdio:['ignore','pipe','ignore']}));
    if(!path.isAbsolute(value.executable)||!Array.isArray(value.version)||value.version[0]!==3||value.version[1]<9)throw Error('unsupported Python');
    fs.accessSync(value.executable,fs.constants.X_OK);
    return preparedPython={available:true,executable:value.executable,version:value.version.join('.')};
  }catch{return preparedPython={available:false,reason:'Python 3.9 or newer is required for process workers'};}
}

function sessionDir(P,id){
  if(!isSafeId(id))throw Object.assign(new Error('invalid session id'),{code:'INVALID_SESSION_ID',dispatched:false});
  return path.join(P.sessionsDir,id);
}
function meta(P,id){if(id==null)return null;const p=path.join(sessionDir(P,id),'meta.json');return fs.existsSync(p)?readJson(p):null}
function alive(pid){try{process.kill(Number(pid),0);return true}catch{return false}}
function byPid(P,pid){if(pid==null||!fs.existsSync(P.sessionsDir))return null;for(const id of fs.readdirSync(P.sessionsDir)){const m=meta(P,id);if(m&&Number(m.pid)===Number(pid))return m}return null}
function integer(value, fallback, min, max, label){
  const n=value==null?fallback:Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max)throw Object.assign(new Error('invalid '+label),{code:'INVALID_PROCESS_ARGUMENT',dispatched:false});
  return n;
}
/** Read only the requested byte window, never materialize the whole log. */
export function readOutputWindow(file, offset=-65536, maxBytes=1048576){
  offset=integer(offset,-65536,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,'output offset');
  maxBytes=integer(maxBytes,1048576,1,4*1024*1024,'output byte limit');
  if(!file||!fs.existsSync(file))return {output:'',offset:0,nextOffset:0,totalBytes:0,truncated:false};
  const fd=fs.openSync(file,'r');
  try {
    const totalBytes=fs.fstatSync(fd).size;
    const start=offset<0?Math.max(0,totalBytes+offset):Math.min(offset,totalBytes);
    const buffer=Buffer.alloc(Math.min(maxBytes,totalBytes-start));
    let count=0;
    while(count<buffer.length){const n=fs.readSync(fd,buffer,count,buffer.length-count,start+count);if(n===0)break;count+=n;}
    return {output:buffer.subarray(0,count).toString('utf8'),offset:start,nextOffset:start+count,totalBytes,truncated:start>0||start+count<totalBytes};
  } finally {fs.closeSync(fd)}
}
function tailFile(file,offset=-65536,maxBytes=1048576){return readOutputWindow(file,offset,maxBytes).output}
function stable(x){if(Array.isArray(x))return '['+x.map(stable).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';return JSON.stringify(x)}
function launchError(code,sessionId,uncertain=false){return Object.assign(new Error(code),{code,sessionId,uncertain,dispatched:uncertain});}
/** A missing observation after a launch claim is uncertain, not permission to restart. */
export function inspectProcessSession(sessionId,P){
  const found=meta(P,sessionId);
  if(found)return sessionState(found,P);
  const file=path.join(sessionDir(P,sessionId),'launch.json');
  if(!fs.existsSync(file))return {sessionId,state:'unsubmitted',dispatched:false};
  const claim=readJson(file);
  return {sessionId,state:ownerIsLive(claim.owner)?'launching':'uncertain',dispatched:true,reason:'launch claimed; session metadata not yet observed'};
}
function sessionState(m,P){
  if(!m)return null;
  if(m.state==='running'&&!alive(m.pid)){
    // The PTY helper reaps the child, drains output, then commits its exit code.
    // Re-read after the liveness check to close the publication/exit race.
    const latest=P?meta(P,m.sessionId):null;
    if(latest&&latest.state!=='running')return latest;
    if(m.helperPid&&alive(m.helperPid))return {...(latest||m),phase:'finalizing',childAlive:false};
    return {...(latest||m),state:'unknown',reason:'worker and helper no longer live without a terminal record'};
  }
  return m;
}

async function fileRequest(st,req,timeout=5000){
  const id=randomId('ctl');
  ensureDir(st.controlDir);ensureDir(st.ackDir);
  const tmp=path.join(st.controlDir,`.tmp-${id}-${process.pid}`);
  const final=path.join(st.controlDir,`${id}.json`);
  const ack=path.join(st.ackDir,`${id}.json`);
  fs.writeFileSync(tmp,JSON.stringify({...req,requestId:id})+'\n',{mode:0o600});
  fs.renameSync(tmp,final);
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    if(fs.existsSync(ack)){
      const r=readJson(ack);
      try{fs.unlinkSync(ack)}catch{}
      if(r.ok===false)throw new Error(r.error||'session control failed');
      return r;
    }
    await sleep(25);
  }
  throw new Error('session control timeout');
}

export async function startProcessTool(args,P){
  const sessionId=args.sessionId??randomId('session'),dir=sessionDir(P,sessionId);
  const command=String(args.command??'');if(!command)throw launchError('PROCESS_COMMAND_REQUIRED',sessionId);
  const wait=integer(args.timeout_ms??args.timeoutMs,300,0,30000,'initial wait');
  const shell=args.shell||process.env.SHELL||'/bin/bash';
  const cwd=path.resolve(args.cwd||process.cwd());
  if(!fs.statSync(cwd).isDirectory())throw launchError('PROCESS_CWD_NOT_DIRECTORY',sessionId);
  if(args.env!=null&&(typeof args.env!=='object'||Array.isArray(args.env)))throw launchError('INVALID_PROCESS_ENV',sessionId);
  const env=Object.fromEntries(Object.entries(args.env||{}).map(([k,v])=>[k,String(v)]));
  const transport=args.transport??'pty';
  if(!['pty','pipe'].includes(transport))throw launchError('INVALID_PROCESS_TRANSPORT',sessionId);
  const python=transport==='pty'?prepareProcessRuntime():null;
  if(python&&!python.available)throw launchError('PROCESS_PYTHON_UNAVAILABLE',sessionId);
  // Keep existing PTY fingerprints identical across upgrades.
  const specHash=crypto.createHash('sha256').update(stable({command,shell,cwd,env,...(transport==='pipe'?{transport}:{})})).digest('hex');
  const claimFile=path.join(dir,'launch.json');
  // Persist the identity BEFORE crossing the process-launch boundary. Even a
  // coordinator crash between spawn and metadata publication cannot permit replay.
  const claimed=withStateTransaction(P,()=>{
    ensureDir(dir);
    if(fs.existsSync(claimFile)){
      const existing=readJson(claimFile);
      if(existing.specHash!==specHash)throw launchError('PROCESS_SESSION_CONFLICT',sessionId);
      return false;
    }
    if(fs.existsSync(path.join(dir,'meta.json')))throw launchError('LEGACY_SESSION_ID_RESERVED',sessionId);
    writeJson(claimFile,{version:1,sessionId,specHash,owner:processOwner(),claimedAt:new Date().toISOString()});
    return true;
  });
  let helperProcess,wake;
  const observePause=ms=>new Promise(resolve=>{
    const finish=()=>{clearTimeout(timer);if(wake===finish)wake=undefined;resolve();};
    const timer=setTimeout(finish,ms);wake=finish;
  });
  try{
  if(claimed){
    if(transport==='pipe'){
      const helper=path.join(path.dirname(fileURLToPath(import.meta.url)),'pipe-session-helper.mjs');
      await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[helper,dir,cwd,shell,'-lc',command],{detached:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,...env}});
        helperProcess=child;
        child.on('message',message=>{if(message?.type==='session-state')wake?.();});
        child.on('disconnect',()=>wake?.());
        child.channel?.unref();
        child.once('error',()=>reject(launchError('PROCESS_LAUNCH_OUTCOME_UNCERTAIN',sessionId,true)));
        child.once('spawn',()=>{child.unref();resolve();});
      });
    }else{
    const helper=path.join(path.dirname(fileURLToPath(import.meta.url)),'session-helper.py');
    // The helper uses only the standard library; skip unrelated site startup hooks.
    // Await this owned launcher asynchronously so independent batch launches can
    // progress concurrently. The durable claim above still precedes dispatch.
    await new Promise((resolve,reject)=>{
      let settled=false,timer;
      const child=spawn(python.executable,['-S',helper,'--daemonize','--state-dir',dir,'--cwd',cwd,'--',shell,'-lc',command],{
        stdio:'ignore',env:{...process.env,...env}
      });
      const finish=ok=>{if(settled)return;settled=true;clearTimeout(timer);ok?resolve():reject(launchError('PROCESS_LAUNCH_OUTCOME_UNCERTAIN',sessionId,true));};
      child.once('error',()=>finish(false));
      child.once('close',code=>finish(code===0));
      timer=setTimeout(()=>{
        // Stop only this launcher. Its daemon/worker may already exist, so the
        // persistent session remains uncertain and must never be relaunched.
        child.kill('SIGTERM');finish(false);
      },5000);
    });
    }
  }
  let latest=null;
  for(let i=0;i<150;i++){latest=meta(P,sessionId);if(latest)break;await observePause(20)}
  if(!latest)throw launchError('PROCESS_LAUNCH_OUTCOME_UNCERTAIN',sessionId,true);
  const deadline=Date.now()+wait;
  while(Date.now()<deadline){latest=sessionState(meta(P,sessionId)||latest,P);if(latest.state!=='running')break;await observePause(Math.min(25,deadline-Date.now()))}
  latest=sessionState(meta(P,sessionId)||latest,P);
  return {...latest,...readOutputWindow(latest.outputFile),reused:!claimed};
  }finally{if(helperProcess?.connected)helperProcess.disconnect();}
}

export function readProcessOutputTool(args,P){
  const m=byPid(P,args.pid)||meta(P,args.sessionId);if(!m)throw new Error('session not found');
  const st=sessionState(m,P);return {...st,...readOutputWindow(st.outputFile,args.offset??-65536,args.maxBytes??1048576)};
}

async function waitInputReady(P,st,maxWait=2500){
  const deadline=Date.now()+maxWait;
  let latest=st;
  while(Date.now()<deadline){
    latest=meta(P,st.sessionId)||latest;
    if(latest.state!=='running'||latest.inputReady===true)return latest;
    await sleep(25);
  }
  return meta(P,st.sessionId)||latest;
}

export async function interactProcessTool(args,P){
  const m=byPid(P,args.pid)||meta(P,args.sessionId);if(!m)throw new Error('session not found');
  let st=sessionState(m,P);if(st.state!=='running')return {...st,output:tailFile(st.outputFile)};
  st=sessionState(await waitInputReady(P,st),P);
  if(st.state!=='running')return {...st,output:tailFile(st.outputFile)};
  if(st.inputReady!==true)throw new Error('session input readiness timeout');
  const timeout=Math.max(500,Math.min(Number(args.timeout_ms||5000),15000));
  const requested=Math.max(0,Math.min(Number(args.wait_ms??args.waitMs??1000),15000));
  const grace=requested>0?1000:0;
  const controlTimeout=Math.min(20000,Math.max(timeout,requested+grace+1000));
  const response=await fileRequest(st,{
    action:'input',
    input:String(args.input??''),
    newline:args.newline!==false,
    waitMs:requested,
    graceMs:grace
  },controlTimeout);
  const latest=sessionState(meta(P,st.sessionId)||st,P);
  return {ok:response.ok,sessionId:st.sessionId,pid:st.pid,output:String(response.output??''),state:latest.state};
}

export async function terminateProcessTool(args,P){
  const m=byPid(P,args.pid)||meta(P,args.sessionId);if(!m)throw new Error('session not found');
  const st=sessionState(m,P);if(st.state==='running'){
    try{await fileRequest(st,{action:'signal',signal:Number(args.signal||15)},2000)}
    catch{
      // A stale PID can belong to an unrelated process after helper loss. Only
      // the original supervisor may signal its owned worker/process group.
      throw Object.assign(new Error('process termination acknowledgement not observed'),{code:'PROCESS_TERMINATION_UNCERTAIN',uncertain:true,dispatched:true});
    }
  }
  const deadline=Date.now()+2000;let latest=st;
  while(Date.now()<deadline){latest=sessionState(meta(P,st.sessionId)||latest,P);if(latest.state!=='running')break;await sleep(50)}
  return {pid:st.pid,sessionId:st.sessionId,terminated:['completed','failed'].includes(latest.state),state:latest.state};
}

export function listSessionsTool(args,P){if(!fs.existsSync(P.sessionsDir))return {sessions:[]};return {sessions:fs.readdirSync(P.sessionsDir).map(id=>sessionState(meta(P,id),P)).filter(Boolean)}}
export function listProcessesTool(){const r=run('ps',['-axo','pid=,ppid=,%cpu=,%mem=,comm='],{maxBuffer:4*1024*1024});return {exitCode:r.code,output:r.stdout,error:r.stderr||r.error}}
export function killProcessTool(args){const pid=Number(args.pid);if(!Number.isInteger(pid)||pid<=0)throw new Error('invalid pid');process.kill(pid,Number(args.signal||15));return {pid,signal:Number(args.signal||15)}}
