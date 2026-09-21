import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import crypto from 'node:crypto';
import { ensureDir, atomicWrite } from './util.mjs';

export function allowed(p, config){
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
  const max=Number(args.maxBytes??config.outputLimitBytes??1048576);
  const requestedOffset=Number(args.offset??0),length=args.length==null?null:Number(args.length);
  if(!Number.isSafeInteger(max)||max<1)throw new Error('maxBytes must be a positive integer');
  if(!Number.isSafeInteger(requestedOffset))throw new Error('offset must be an integer');
  if(length!==null&&(!Number.isSafeInteger(length)||length<0))throw new Error('length must be a nonnegative integer');
  const fd=fs.openSync(p,'r');
  try{
    const probe=Buffer.alloc(Math.min(st.size,8192));
    const probeBytes=fs.readSync(fd,probe,0,probe.length,0);
    if(isProbablyText(probe.subarray(0,probeBytes))){
      // Locate the requested line in the file before limiting returned bytes.
      // Scanning uses fixed-size storage, including for a very long skipped line.
      const chunk=Buffer.alloc(65536);
      function scan(target){
        let position=0,lines=0;
        if(target===0)return {position:0,lines:0};
        while(position<st.size){
          const n=fs.readSync(fd,chunk,0,Math.min(chunk.length,st.size-position),position);
          if(!n)break;
          for(let i=0;i<n;i++)if(chunk[i]===10){
            lines++;
            if(lines===target)return {position:position+i+1,lines};
          }
          position+=n;
        }
        return {position,lines,notFound:target!==null};
      }
      const offset=requestedOffset<0?Math.max(0,scan(null).lines+1+requestedOffset):requestedOffset;
      const start=scan(offset);
      if(start.notFound)return {path:p,type:'text',content:'',size:st.size,truncated:false,
        offset,returnedLines:0,nextOffset:null,hasMore:false,partialLastLine:false,mode:modeOctal(st)};
      const b=Buffer.alloc(Math.min(Math.max(0,st.size-start.position),max+1));
      const read=fs.readSync(fd,b,0,b.length,start.position);
      let bytes=Math.min(read,max);
      const atEnd=start.position+bytes>=st.size||read<b.length;
      // Do not split a CRLF separator or emit a replacement for a UTF-8 code
      // point whose remaining bytes lie beyond this response's byte budget.
      if(!atEnd&&bytes&&b[bytes-1]===13&&b[bytes]===10)bytes--;
      const decoder=new StringDecoder('utf8');
      const text=decoder.write(b.subarray(0,bytes))+(atEnd?decoder.end():'');
      const lines=text.split(/\r?\n/);
      if(!atEnd&&(!text||text.endsWith('\n')))lines.pop();
      const completeLines=atEnd?lines.length:(text.match(/\n/g)||[]).length;
      // Negative offsets historically return the whole tail, ignoring length.
      const count=requestedOffset<0?null:length;
      const selected=count===null?lines:lines.slice(0,count);
      const partialLastLine=!atEnd&&!!text&&!text.endsWith('\n')&&selected.length===lines.length;
      const hasMore=!atEnd||selected.length<lines.length;
      return {path:p,type:'text',content:selected.join('\n'),size:st.size,
        truncated:!atEnd&&(count===null||count>completeLines),offset,returnedLines:selected.length,
        nextOffset:hasMore?offset+selected.length-(partialLastLine?1:0):null,
        hasMore,partialLastLine,mode:modeOctal(st)};
    }
    const b=Buffer.alloc(Math.min(st.size,max)),len=fs.readSync(fd,b,0,b.length,0);
    return {path:p,type:'binary',base64:b.subarray(0,len).toString('base64'),size:st.size,truncated:st.size>len,mode:modeOctal(st)};
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
  const entries=[],maxEntries=Math.max(1,Math.min(Number(args.maxEntries||1000),10000));let truncated=false;
  function walk(dir,level){
    const names=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
    for(const ent of names.slice(0,limit)){
      if(entries.length>=maxEntries){truncated=true;return;}
      const full=path.join(dir,ent.name), rel=path.relative(root,full)||'.'; let st; try{st=fs.lstatSync(full)}catch{continue}
      entries.push({path:rel,type:ent.isDirectory()?'directory':ent.isSymbolicLink()?'symlink':'file',size:st.size,mode:modeOctal(st),mtime:st.mtime.toISOString()});
      if(ent.isDirectory()&&level<depth) walk(full,level+1);
    }
    if(names.length>limit){truncated=true;if(entries.length<maxEntries)entries.push({path:path.relative(root,dir)||'.',type:'truncated',hidden:names.length-limit});}
  }
  walk(root,1); return {root,entries,truncated};
}

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export async function getFileInfoTool(args,config){
  const p=allowed(args.path,config),st=fs.lstatSync(p);
  const result={path:p,type:st.isSymbolicLink()?'symlink':st.isDirectory()?'directory':'file',size:st.size,
    mode:modeOctal(st),created:st.birthtime.toISOString(),modified:st.mtime.toISOString()};
  if(!st.isFile())return result;
  // Stream metadata so a large log does not require loading its contents.
  const fd=await fs.promises.open(p,'r'),digest=crypto.createHash('sha256'),buffer=Buffer.alloc(65536);
  let newlines=0,total=0,text=true,lastByte=null;
  try{for(;;){const {bytesRead:n}=await fd.read(buffer,0,buffer.length,null);if(!n)break;
    const chunk=buffer.subarray(0,n);if(!total)text=isProbablyText(chunk);
    digest.update(chunk);for(let i=0;i<n;i++)if(chunk[i]===10)newlines++;total+=n;lastByte=chunk[n-1];
  }}finally{await fd.close();}
  // A trailing newline terminates the last line rather than starting an empty one (wc -l, RDC).
  const lineCount=total?newlines+(lastByte===10?0:1):0;
  return {...result,sha256:digest.digest('hex'),...(text?{lineCount,lastLine:lineCount-1,appendPosition:lineCount}:{})};
}

function charDiff(a,b,context=60){
  let prefix=0;while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
  let suffix=0;while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
  const before=a.slice(Math.max(0,prefix-context),prefix),after=a.slice(a.length-suffix,a.length-suffix+context);
  return `${before}{-${a.slice(prefix,a.length-suffix)}-}{+${b.slice(prefix,b.length-suffix)}+}${after}`;
}
/** Shared prefix plus suffix over the longer length: cheap, and 1 only for identical strings. */
function similarity(a,b){
  if(!a.length&&!b.length)return 1;
  let prefix=0;while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
  let suffix=0;while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
  return Math.min(1,(prefix+suffix)/Math.max(a.length,b.length));
}
/** Locate the window whose lines best match old_string after trimming, to explain a failed exact edit. */
function nearestMatch(source,old){
  if(source.length>4*1024*1024||old.length>20000)return null;
  const lines=source.split('\n'),needle=old.split('\n'),target=needle.map(s=>s.trim());
  const anchor=target.findIndex(Boolean);if(anchor<0)return null;
  let best=null;
  for(let i=0;i+needle.length<=lines.length;i++){
    if(similarity(lines[i+anchor].trim(),target[anchor])<0.6)continue;
    let score=0;for(let k=0;k<needle.length;k++)score+=similarity(lines[i+k].trim(),target[k]);
    score/=needle.length;
    if(!best||score>best.score)best={line:i+1,score,text:lines.slice(i,i+needle.length).join('\n')};
    if(score===1)break;
  }
  return best;
}

export function editBlockTool(args,config){
  const p=allowed(args.file_path,config),st=fs.lstatSync(p);
  if(!st.isFile())throw new Error('edit_block requires a regular text file');
  if(st.size>16*1024*1024)throw new Error('edit_block text file exceeds 16 MiB');
  const before=fs.readFileSync(p),beforeSha256=hash(before);
  if(args.expectedSha256&&args.expectedSha256!==beforeSha256)throw new Error('EDIT_SOURCE_CHANGED: read the current file before editing');
  if(!isProbablyText(before))throw new Error('edit_block requires text; binary document editing is not supported');
  const source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(before);
  const old=args.old_string,replacement=args.new_string,expected=args.expected_replacements??1;
  if(typeof old!=='string'||!old.length||typeof replacement!=='string'||!Number.isSafeInteger(expected)||expected<1)throw new Error('nonempty old_string, new_string, and positive expected_replacements required');
  let count=0,at=0;while((at=source.indexOf(old,at))!==-1){count++;at+=old.length;}
  if(count!==expected){
    let hint='';
    const near=count===0?nearestMatch(source,old):null;
    if(near?.score===1)hint=` Closest match at line ${near.line} differs only in whitespace or indentation; use this exact text as old_string:\n${near.text}`;
    else if(near)hint=` Closest match at line ${near.line} (${Math.round(near.score*100)}% of lines identical after trimming):\n${charDiff(old,near.text)}`;
    throw new Error(`EDIT_MATCH_COUNT: expected ${expected} exact occurrence(s), found ${count}; no file was changed.${hint}`);
  }
  const outputBytes=before.length+count*(Buffer.byteLength(replacement)-Buffer.byteLength(old));
  if(outputBytes>16*1024*1024)throw new Error('edit_block result exceeds 16 MiB; no file was changed');
  const after=Buffer.from(source.split(old).join(replacement));
  // Commander mutations share a filesystem resource lock. Also detect changes
  // from another editor during preparation before atomically replacing the file.
  if(hash(fs.readFileSync(p))!==beforeSha256)throw new Error('EDIT_SOURCE_CHANGED: no file was changed');
  atomicWrite(p,after,st.mode&0o777);
  return {path:p,replacements:count,beforeSha256,sha256:hash(after),bytes:after.length};
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
