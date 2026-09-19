// Recovered from lineage/ego-1.0.2/src/ego-bridge.mjs. The shared Ego browser is
// never terminated; each bounded CLI invocation must finish and flush its result.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { validateBrowserResult } from './browser-result.mjs';
import { redact } from './browser-dom.mjs';

export class EgoError extends Error {
  constructor(code, {dispatched=false, uncertain=false, exitCode=null}={}) {
    super(code); Object.assign(this,{code,dispatched,uncertain,exitCode});
  }
}
export function wrapEgoScript(script,marker){
  // Ego 0.5.0.32 does not consistently transform await nested in a top-level
  // try block. Keep every await inside a real async function; no heuristic is needed.
  return `async function __navishExecute(){try{const result=await(async()=>{${script}\n})();if(!result||typeof result.ok!=="boolean")throw Object.assign(new Error("INVALID_RESULT"),{code:"INVALID_RESULT"});return result;}catch(e){return {ok:false,errorCode:/^[A-Z0-9_]+$/.test(e.code||"")?e.code:"EGO_SCRIPT_FAILED",dispatched:e.dispatched!==false,uncertain:e.uncertain===true||e.mayHaveLateEffects===true||e.executionStopped===false||(e.dispatched!==false&&e.uncertain!==false)};}} __navishExecute().then(result=>{const encoded=Buffer.from(JSON.stringify(result)).toString("base64");process.stderr.write(${JSON.stringify(marker)}+encoded+String.fromCharCode(10),()=>process.exit(result.ok?0:1));});`;
}
/** Discover the existing installation; never download, import profiles or change permissions. */
export function discoverEgoExecutable(){
  const local=path.join(os.homedir(),'.local/bin/ego-browser');
  try{fs.accessSync(local,fs.constants.X_OK);return local}catch{}
  const versions='/Applications/ego lite.app/Contents/Frameworks/ego Framework.framework/Versions';
  try{for(const name of fs.readdirSync(versions).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))){
    const candidate=path.join(versions,name,'Helpers/ego-browser');
    try{fs.accessSync(candidate,fs.constants.X_OK);return candidate}catch{}
  }}catch{}
  return local;
}
export class EgoBridge {
  constructor({executable,outputLimitBytes=262144}={}) {
    this.executable=executable||process.env.NAVISH_EGO_COMMAND||discoverEgoExecutable();
    this.outputLimitBytes=Math.max(4096,Math.min(Number(outputLimitBytes)||262144,1048576));
  }
  get available(){try{fs.accessSync(this.executable,fs.constants.X_OK);return true}catch{return false}}
  runCli(args,timeoutMs=8000,input=null){
    if(!this.available)return Promise.reject(new EgoError('EGO_UNAVAILABLE'));
    const limit=this.outputLimitBytes;
    return new Promise((resolve,reject)=>{
      const child=spawn(this.executable,args,{stdio:[input===null?'ignore':'pipe','pipe','pipe'],env:process.env});
      let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),settled=false,started=false,truncated=false,timer;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value)};
      const append=(old,data)=>{let b=Buffer.concat([old,data]);if(b.length>limit){truncated=true;b=b.subarray(b.length-limit)}return b};
      child.once('spawn',()=>{started=true});
      child.stdout.on('data',d=>{stdout=append(stdout,d)});
      child.stderr.on('data',d=>{stderr=append(stderr,d)});
      child.once('error',()=>finish(new EgoError('EGO_SPAWN_FAILED',{dispatched:started,uncertain:started})));
      child.once('close',(code,signal)=>finish(null,{code,signal,stdout:stdout.toString('utf8'),stderr:stderr.toString('utf8'),truncated}));
      timer=setTimeout(()=>{
        // Kill only the CLI process created by this invocation, never the browser.
        child.kill('SIGTERM');
        const kill=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')},1000);kill.unref();
        finish(new EgoError('EGO_TIMEOUT',{dispatched:started,uncertain:started}));
      },Math.max(1000,Math.min(Number(timeoutMs)||8000,360000)));
      if(input!==null){child.stdin.on('error',()=>{});child.stdin.end(String(input))}
    });
  }
  parseResult(r,marker){
    const lines=r.stderr.split(/\r?\n/).filter(x=>x.startsWith(marker));
    if(lines.length!==1)throw new EgoError('EGO_INVALID_RESULT',{dispatched:true,uncertain:true,exitCode:r.code});
    let value;
    try{
      const encoded=lines[0].slice(marker.length);
      if(!encoded||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error();
      const decoded=Buffer.from(encoded,'base64');
      if(decoded.toString('base64')!==encoded)throw new Error();
      value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));
    }catch{throw new EgoError('EGO_INVALID_RESULT',{dispatched:true,uncertain:true,exitCode:r.code})}
    // A truncated stream could have discarded an earlier, conflicting result marker.
    if(r.truncated)throw new EgoError('EGO_RESULT_TRUNCATED',{dispatched:true,uncertain:true,exitCode:r.code});
    try{return validateBrowserResult(value,{exitCode:r.code,signal:r.signal})}
    catch(e){throw new EgoError(e.code||'EGO_INVALID_RESULT',{dispatched:e.dispatched!==false,uncertain:e.uncertain!==false,exitCode:r.code})}
  }
  async execute(script,{timeoutMs=60000}={}){
    const marker='__NAVISH_EGO_'+crypto.randomBytes(12).toString('hex')+'__';
    const started=Date.now();const r=await this.runCli(['nodejs'],timeoutMs,wrapEgoScript(script,marker));
    return {...redact(this.parseResult(r,marker)),backend:'ego-lite',durationMs:Date.now()-started,completionLevel:'operation',goalVerified:false};
  }
  async health(){
    if(!this.available)return {available:false,backend:'ego-lite',reasonCode:'EGO_UNAVAILABLE',fallbackAllowed:true};
    try{
      const version=await this.runCli(['--version'],5000);
      if(version.code!==0)throw new EgoError('EGO_VERSION_FAILED');
      const probe=await this.execute('const xs=await listTaskSpaces();return {ok:true,spaces:xs.map(x=>({id:x.id,name:x.name,ownership:x.ownership}))};',{timeoutMs:12000});
      return {available:true,backend:'ego-lite',version:(version.stdout+version.stderr).trim().slice(0,200),taskSpaceCount:probe.spaces.length,taskSpaces:probe.spaces.filter(x=>/^navish(?:-|\s)/i.test(String(x.name||''))).slice(0,32)};
    }catch(e){return {available:false,backend:'ego-lite',reasonCode:e.code||'EGO_HEALTH_FAILED',fallbackAllowed:e.code==='EGO_UNAVAILABLE'}}
  }
  // Retains the recovered bridge interface for internal, reviewed workflows.
  // This is an internal script primitive, not an autonomous browser_agent implementation.
  async run({goal,script,timeout_ms=60000}){
    return this.execute(`const task=await taskSpace(${JSON.stringify(goal)});const page=task.page("p1");const result=await(async(task,page)=>{${script}\n})(task,page);return {ok:true,spaceId:task.spaceId,page:page.label,result};`,{timeoutMs:timeout_ms});
  }
}
