import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {Worker,isMainThread,workerData,parentPort} from 'node:worker_threads';
import {readJson,writeJson} from './util.mjs';

if(isMainThread){
  const dir=process.argv[2],request=readJson(path.join(dir,'request.json'));
  const worker=new Worker(new URL(import.meta.url),{workerData:{dir,request}});
  let settled=false;
  const finish=summary=>{if(settled)return;settled=true;clearTimeout(timer);writeJson(path.join(dir,'summary.json'),{...summary,finishedAt:new Date().toISOString()},0o600);};
  // A regex, filesystem call, or huge line cannot prevent the supervisor from
  // enforcing the time budget. Partial results remain readable after timeout.
  const timer=setTimeout(async()=>{await worker.terminate();finish({state:'timed_out',truncated:true});},request.timeout_ms);
  worker.on('message',finish);
  worker.on('error',e=>finish({state:'failed',reason:e.message}));
  worker.on('exit',code=>{if(!settled&&code===0)finish({state:'failed',reason:'search exited without a summary'});});
}else{
  const {dir,request:q}=workerData;
  const fd=fs.openSync(path.join(dir,'results.jsonl'),'wx',0o600);
  let count=0,bytes=0,scannedFiles=0,skippedFiles=0,truncated=false;
  const regex=q.literalSearch?null:new RegExp(q.pattern,q.ignoreCase?'i':'');
  const match=text=>regex?regex.test(text):(q.ignoreCase?text.toLowerCase().includes(q.pattern.toLowerCase()):text.includes(q.pattern));
  function glob(pattern){return new RegExp('^'+pattern.split('').map(c=>c==='*'?'.*':c==='?'?'.':'\\^$+?.()|{}[]'.includes(c)?'\\'+c:c).join('')+'$',q.ignoreCase?'i':'');}
  const filters=q.filePattern?q.filePattern.split('|').map(glob):null;
  const emit=row=>{
    const text=JSON.stringify(row)+'\n',size=Buffer.byteLength(text);
    if(count>=q.maxResults||bytes+size>16*1024*1024){truncated=true;return false;}
    fs.writeSync(fd,text);bytes+=size;count++;return true;
  };
  async function scan(file){
    if(truncated)return;
    let st;try{st=await fs.promises.lstat(file);}catch{skippedFiles++;return;}
    // Do not follow directory or file symlinks outside the selected tree.
    if(st.isSymbolicLink())return;
    if(st.isDirectory()){
      let entries;try{entries=await fs.promises.readdir(file,{withFileTypes:true});}catch{skippedFiles++;return;}
      for(const ent of entries.sort((a,b)=>a.name.localeCompare(b.name))){
        if(!q.includeHidden&&ent.name.startsWith('.'))continue;
        await scan(path.join(file,ent.name));if(truncated)break;
      }return;
    }
    if(!st.isFile()||(filters&&!filters.some(re=>re.test(path.basename(file)))))return;
    scannedFiles++;
    if(q.searchType==='files'){if(match(path.relative(q.path,file)||path.basename(file)))emit({path:file});return;}
    if(st.size>16*1024*1024){skippedFiles++;return;}
    let probe;
    try{const handle=await fs.promises.open(file,'r');try{probe=Buffer.alloc(Math.min(st.size,8192));await handle.read(probe,0,probe.length,0);}finally{await handle.close();}}
    catch{skippedFiles++;return;}
    if(probe.includes(0)){skippedFiles++;return;}
    const stream=fs.createReadStream(file,{encoding:'utf8'}),lines=readline.createInterface({input:stream,crlfDelay:Infinity});
    let lineNumber=0,before=[],pending=[];
    try{for await(const raw of lines){
      lineNumber++;const line=raw.slice(0,2000);
      for(const row of pending)row.after.push(line);
      while(pending.length&&pending[0].after.length>=q.contextLines){if(!emit(pending.shift()))break;}
      if(truncated)break;
      if(match(raw)){
        const row={path:file,line:lineNumber,text:line,before:[...before],after:[],lineTruncated:raw.length>line.length};
        if(q.contextLines)pending.push(row);else emit(row);
      }
      before.push(line);if(before.length>q.contextLines)before.shift();
      if(truncated)break;
    }
    for(const row of pending){if(!emit(row))break;}}
    catch{skippedFiles++;}
    finally{lines.close();stream.destroy();}
  }
  try{await scan(q.path);fs.fsyncSync(fd);parentPort.postMessage({state:'completed',totalResults:count,scannedFiles,skippedFiles,truncated});}
  finally{fs.closeSync(fd);}
}
