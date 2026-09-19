import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './util.mjs';

function allowed(p, config){
  const rp=path.resolve(String(p)); const roots=config.allowedDirectories||[];
  if(!roots.length) return rp;
  const ok=roots.some(r=>{const rr=path.resolve(r); return rp===rr||rp.startsWith(rr+path.sep)});
  if(!ok) throw new Error(`path outside allowedDirectories: ${rp}`); return rp;
}
function modeOctal(st){ return Number(st.mode & 0o777); }
function isProbablyText(buf){
  const n=Math.min(buf.length,8192); let bad=0;
  for(let i=0;i<n;i++){const c=buf[i]; if(c===0) return false; if(c<9 || (c>13&&c<32)) bad++;}
  return !n || bad/n<0.01;
}
export function readFileTool(args,config){
  const p=allowed(args.path,config); const st=fs.statSync(p); if(!st.isFile()) throw new Error('not a file');
  const max=Number(args.maxBytes||config.outputLimitBytes||1048576); const fd=fs.openSync(p,'r');
  try{
    const len=Math.min(st.size,max); const b=Buffer.alloc(len); fs.readSync(fd,b,0,len,0);
    if(isProbablyText(b)){
      let txt=b.toString('utf8'); const lines=txt.split(/\r?\n/); const off=Number(args.offset||0); const length=args.length==null?lines.length:Number(args.length);
      const selected=off<0?lines.slice(Math.max(0,lines.length+off)):lines.slice(off,off+length);
      return {path:p,type:'text',content:selected.join('\n'),size:st.size,truncated:st.size>len,mode:modeOctal(st)};
    }
    return {path:p,type:'binary',base64:b.toString('base64'),size:st.size,truncated:st.size>len,mode:modeOctal(st)};
  } finally{fs.closeSync(fd)}
}
export function readMultipleFilesTool(args,config){ return {files:(args.paths||[]).map(p=>{try{return readFileTool({path:p,maxBytes:args.maxBytes},config)}catch(e){return {path:p,error:e.message}}})}; }
export function writeFileTool(args,config){
  const p=allowed(args.path,config); ensureDir(path.dirname(p)); const mode=args.mode||'rewrite';
  if(mode==='append') fs.appendFileSync(p,String(args.content??''),{encoding:'utf8'});
  else if(mode==='rewrite'){
    const tmp=`${p}.navish-tmp-${process.pid}`; fs.writeFileSync(tmp,String(args.content??''),{encoding:'utf8'}); fs.renameSync(tmp,p);
  } else throw new Error('mode must be rewrite or append');
  return {path:p,bytes:Buffer.byteLength(String(args.content??'')),mode};
}
export function createDirectoryTool(args,config){const p=allowed(args.path,config); fs.mkdirSync(p,{recursive:true}); return {path:p,created:true};}
export function moveFileTool(args,config){const s=allowed(args.source,config),d=allowed(args.destination,config); ensureDir(path.dirname(d)); fs.renameSync(s,d); return {source:s,destination:d};}
export function listDirectoryTool(args,config){
  const root=allowed(args.path,config); const depth=Math.max(1,Math.min(Number(args.depth||2),8)); const limit=Math.max(1,Math.min(Number(args.limitPerDirectory||200),2000));
  const entries=[];
  function walk(dir,level){
    const names=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
    for(const ent of names.slice(0,limit)){
      const full=path.join(dir,ent.name), rel=path.relative(root,full)||'.'; let st; try{st=fs.lstatSync(full)}catch{continue}
      entries.push({path:rel,type:ent.isDirectory()?'directory':ent.isSymbolicLink()?'symlink':'file',size:st.size,mode:modeOctal(st),mtime:st.mtime.toISOString()});
      if(ent.isDirectory()&&level<depth) walk(full,level+1);
    }
    if(names.length>limit) entries.push({path:path.relative(root,dir)||'.',type:'truncated',hidden:names.length-limit});
  }
  walk(root,1); return {root,entries};
}
export function findTextTool(args,config){
  const root=allowed(args.path,config); const pattern=String(args.pattern??''); if(!pattern) throw new Error('pattern required');
  const re=args.regex?new RegExp(pattern,args.caseSensitive?'g':'gi'):null; const max=Math.max(1,Math.min(Number(args.maxMatches||100),1000)); const matches=[];
  function scan(p){ if(matches.length>=max) return; let st; try{st=fs.statSync(p)}catch{return};
    if(st.isDirectory()){for(const n of fs.readdirSync(p)) scan(path.join(p,n)); return}
    if(!st.isFile()||st.size>Number(args.maxFileBytes||5*1024*1024)) return;
    let txt; try{txt=fs.readFileSync(p,'utf8')}catch{return}; const lines=txt.split(/\r?\n/);
    for(let i=0;i<lines.length&&matches.length<max;i++){
      const line=lines[i]; const ok=re?(()=>{re.lastIndex=0; return re.test(line)})():(args.caseSensitive?line.includes(pattern):line.toLowerCase().includes(pattern.toLowerCase()));
      if(ok) matches.push({path:path.relative(root,p),line:i+1,text:line.slice(0,2000)});
    }
  }
  scan(root); return {root,pattern,matches,truncated:matches.length>=max};
}
