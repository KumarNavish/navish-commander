import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export function ensureDir(p, mode=0o700){ fs.mkdirSync(p,{recursive:true,mode}); return p; }
export function nowIso(){ return new Date().toISOString(); }
export function sha256Text(s){ return crypto.createHash('sha256').update(s).digest('hex'); }
export function sha256Json(x){ return sha256Text(JSON.stringify(x,Object.keys(x||{}).sort())); }
export function randomId(prefix='id'){ return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`; }
export function isSafeId(s){ return typeof s==='string' && /^[A-Za-z0-9._-]{1,160}$/.test(s) && s !== '.' && s !== '..'; }
export function syncDirectory(directory){
  const fd=fs.openSync(directory,'r');
  try{fs.fsyncSync(fd);}catch(e){if(!['EINVAL','ENOTSUP','EBADF'].includes(e.code))throw e;}
  finally{fs.closeSync(fd);}
}
export function atomicWrite(file, data, mode=0o600){
  ensureDir(path.dirname(file));
  const tmp=`${file}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  let fd;
  try {
    fd=fs.openSync(tmp,'wx',mode); fs.writeFileSync(fd,data); fs.fsyncSync(fd); fs.closeSync(fd); fd=undefined;
    fs.renameSync(tmp,file); fs.chmodSync(file,mode);
    syncDirectory(path.dirname(file));
  } finally { if(fd!==undefined)fs.closeSync(fd); try{fs.unlinkSync(tmp)}catch(e){if(e.code!=='ENOENT')throw e} }
}
export function writeJson(file,obj,mode=0o600){ atomicWrite(file,`${JSON.stringify(obj,null,2)}\n`,mode); }
export function readJson(file){ return JSON.parse(fs.readFileSync(file,'utf8')); }
export function run(cmd,args=[],opts={}){
  const r=spawnSync(cmd,args,{encoding:'utf8',maxBuffer:opts.maxBuffer||16*1024*1024,timeout:opts.timeoutMs||0,cwd:opts.cwd,env:opts.env||process.env,input:opts.input});
  return {code:r.status,signal:r.signal,stdout:r.stdout||'',stderr:r.stderr||'',error:r.error?.message||null};
}
export function executableExists(cmd){
  if(!cmd) return false;
  if(cmd.includes(path.sep)){try{fs.accessSync(cmd,fs.constants.X_OK);return true}catch{return false}}
  return (process.env.PATH||'').split(path.delimiter).filter(Boolean).some(d=>{try{fs.accessSync(path.join(d,cmd),fs.constants.X_OK);return true}catch{return false}});
}
export function clip(s, limit=1024*1024){
  s=String(s??'');
  if(Buffer.byteLength(s)<=limit) return {text:s,truncated:false};
  const b=Buffer.from(s); return {text:b.subarray(0,limit).toString('utf8'),truncated:true};
}
export function shellQuote(s){ return `'${String(s).replaceAll("'",`'\\''`)}'`; }
export function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
