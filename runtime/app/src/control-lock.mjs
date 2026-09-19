import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir } from './util.mjs';
import { processOwner,ownerIsLive,withStateTransaction } from './state-lock.mjs';

export function bridgeLockPath(paths) { return path.join(paths.stateRoot,'bridge.lock'); }
function readLock(file){
  try{
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink())return {unsafe:true};
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!value||!Number.isSafeInteger(value.pid)||value.pid<=0)return {unsafe:true};
    return {value,ino:stat.ino,dev:stat.dev};
  }catch(error){return error.code==='ENOENT'?null:{unsafe:true};}
}
export function inspectBridgeLock(paths){
  const file=bridgeLockPath(paths),lock=readLock(file);
  if(!lock)return {held:false,file};
  // A malformed/partially written legacy lock is not proof that its owner died.
  if(lock.unsafe)return {held:true,file,uncertain:true,malformed:true,stale:false};
  const alive=ownerIsLive(lock.value);
  return {held:alive,file,pid:lock.value.pid,startedAt:lock.value.startedAt||null,stale:!alive};
}
function fail(code){const e=new Error(code);e.code=code;e.dispatched=false;return e;}
function syncDirectory(directory){const fd=fs.openSync(directory,'r');try{try{fs.fsyncSync(fd)}catch(e){if(!['EINVAL','ENOTSUP','EBADF'].includes(e.code))throw e}}finally{fs.closeSync(fd)}}
export function acquireBridgeLock(paths){
  ensureDir(paths.stateRoot);
  const file=bridgeLockPath(paths),owner={...processOwner(),lockToken:crypto.randomUUID()};
  withStateTransaction(paths,()=>{
    const old=readLock(file);
    if(old?.unsafe)throw fail('BRIDGE_LOCK_UNCERTAIN');
    if(old&&ownerIsLive(old.value))throw fail('BRIDGE_ALREADY_RUNNING');
    if(old){
      const current=fs.lstatSync(file);
      if(current.ino!==old.ino||current.dev!==old.dev)throw fail('BRIDGE_LOCK_CHANGED');
      fs.unlinkSync(file);
    }
    const temp=file+'.prepared-'+owner.lockToken;
    try{
      const fd=fs.openSync(temp,'wx',0o600);
      try{fs.writeFileSync(fd,JSON.stringify(owner)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
      // link is atomic and refuses an existing destination, including legacy writers.
      try{fs.linkSync(temp,file)}catch(e){if(e.code==='EEXIST')throw fail('BRIDGE_ALREADY_RUNNING');throw e}
      syncDirectory(paths.stateRoot);
    }finally{try{fs.unlinkSync(temp)}catch(e){if(e.code!=='ENOENT')throw e}}
  });
  let released=false;
  return ()=>{
    if(released)return;
    withStateTransaction(paths,()=>{
      const current=readLock(file);
      if(current?.value?.lockToken===owner.lockToken){fs.unlinkSync(file);syncDirectory(paths.stateRoot)}
    });
    released=true;
  };
}
