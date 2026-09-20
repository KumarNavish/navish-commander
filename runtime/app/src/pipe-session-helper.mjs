/** Detached supervisor for noninteractive workers; no dependency on the MCP caller. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import os from 'node:os';
import {writeJson,readJson,ensureDir} from './util.mjs';

const [dir,cwd,shell,...command]=process.argv.slice(2);
if(!path.isAbsolute(dir||'')||!path.isAbsolute(cwd||'')||command.length!==2||command[0]!=='-lc')throw Error('invalid supervisor arguments');
const metaFile=path.join(dir,'meta.json'),outputFile=path.join(dir,'output.log');
const controlDir=ensureDir(path.join(dir,'control')),processing=ensureDir(path.join(dir,'processing')),ackDir=ensureDir(path.join(dir,'acks'));
const output=fs.openSync(outputFile,'a',0o600);
const meta={sessionId:path.basename(dir),helperPid:process.pid,state:'launching',startedAt:new Date().toISOString(),
  command:[shell,...command],cwd,outputFile,controlDir,ackDir,transport:'pipe-file-control',inputReady:false};
const child=spawn(shell,command,{cwd,env:process.env,detached:true,stdio:['pipe','pipe','pipe']});
let terminal=false,controlBusy=false,spawnError;
function notifyObserver(){
  // Optional latency hint only, after durable publication. The session files
  // remain authoritative and the worker survives a disconnected observer.
  try{if(process.connected)process.send({type:'session-state'},()=>{});}catch{}
}
function append(bytes){
  let offset=0;
  while(offset<bytes.length)offset+=fs.writeSync(output,bytes,offset,bytes.length-offset);
}
child.stdout.on('data',append);child.stderr.on('data',append);
child.stdin.on('error',()=>{}); // A finished worker can close input before a queued control.
child.once('spawn',()=>{
  Object.assign(meta,{pid:child.pid,state:'running',inputReady:true,inputReadyAt:new Date().toISOString()});
  writeJson(metaFile,meta);
  notifyObserver();
});
child.once('error',error=>{spawnError=error.code||'SPAWN_FAILED';});
function signal(sig){
  if(!child.pid||terminal)return;
  try{process.kill(-child.pid,sig);}catch(e){if(e.code!=='ESRCH')throw e;}
}
process.on('SIGTERM',()=>signal('SIGTERM'));process.on('SIGINT',()=>signal('SIGINT'));

async function controls(){
  if(controlBusy||terminal)return;
  controlBusy=true;
  try{
    for(const name of fs.readdirSync(controlDir).filter(n=>n.endsWith('.json')).sort()){
      const claim=path.join(processing,name);
      try{fs.renameSync(path.join(controlDir,name),claim);}catch(e){if(e.code==='ENOENT')continue;throw e;}
      let response;
      try{
        const req=readJson(claim);
        if(req.action==='signal'){signal(Number(req.signal??15));response={ok:true};}
        else if(req.action==='status')response={ok:true,state:terminal?'terminal':'running',pid:child.pid};
        else if(req.action==='input'){
          if(terminal||child.stdin.destroyed||child.stdin.writableEnded)throw Error('worker input closed');
          const start=fs.fstatSync(output).size;
          const bytes=Buffer.from(String(req.input??'')+(req.newline===false?'':'\n'));
          await new Promise((resolve,reject)=>child.stdin.write(bytes,e=>e?reject(e):resolve()));
          const requested=Math.max(0,Math.min(Number(req.waitMs)||0,15000));
          if(requested)await new Promise(resolve=>setTimeout(resolve,requested));
          const available=Math.max(0,fs.statSync(outputFile).size-start);
          const result=Buffer.alloc(Math.min(1048576,available));
          const fd=fs.openSync(outputFile,'r');
          let read;
          try{read=fs.readSync(fd,result,0,result.length,start+Math.max(0,available-result.length));}finally{fs.closeSync(fd);}
          response={ok:true,written:bytes.length,output:result.subarray(0,read).toString('utf8')};
        }else response={ok:false,error:'unknown action'};
      }catch(e){response={ok:false,error:e.message};}
      writeJson(path.join(ackDir,name),response);fs.unlinkSync(claim);
    }
  }finally{controlBusy=false;}
}
const timer=setInterval(()=>{controls().catch(error=>{
  // A control failure cannot establish a terminal worker outcome.
  console.error('control observation failed: '+(error.code||error.name));
});},25);
child.once('close',(code,sig)=>{
  terminal=true;clearInterval(timer);
  // close follows both output streams closing. Flush output before advertising
  // terminal success so reconnecting clients cannot observe an incomplete log.
  fs.fsyncSync(output);fs.closeSync(output);
  const exitCode=spawnError?127:code??-(os.constants.signals[sig]||1);
  writeJson(metaFile,{...meta,pid:child.pid??null,state:exitCode===0?'completed':'failed',exitCode,
    finishedAt:new Date().toISOString(),...(spawnError?{launchError:spawnError}:{})});
  notifyObserver();
});
