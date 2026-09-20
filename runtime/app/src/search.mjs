import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {allowed} from './files.mjs';
import {ensureDir,isSafeId,readJson,writeJson,shellQuote} from './util.mjs';
import {withStateTransaction} from './state-lock.mjs';
import {startProcessTool,inspectProcessSession,terminateProcessTool} from './process.mjs';

function location(P,id){if(!isSafeId(id)||id.length>100)throw new Error('invalid search sessionId');return path.join(P.stateRoot,'searches',id);}
function record(P,id){return readJson(path.join(location(P,id),'request.json'));}
function status(P,id){
  const dir=location(P,id);record(P,id);
  let summary=null;try{summary=readJson(path.join(dir,'summary.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const process=inspectProcessSession('search-'+id,P);
  return {sessionId:id,state:summary?.state??(process.state==='completed'?'uncertain':process.state),...summary};
}
export async function startSearchTool(args,P,config){
  const dir=location(P,args.sessionId),root=allowed(args.path,config);
  const rootStat=fs.lstatSync(root);
  if(!rootStat.isFile()&&!rootStat.isDirectory())throw new Error('search path must be a regular file or directory');
  const request={sessionId:args.sessionId,path:root,pattern:args.pattern,searchType:args.searchType??'files',
    filePattern:args.filePattern??null,ignoreCase:args.ignoreCase!==false,includeHidden:args.includeHidden===true,
    literalSearch:args.literalSearch===true,contextLines:args.contextLines??2,maxResults:args.maxResults??1000,timeout_ms:args.timeout_ms??30000};
  if(typeof request.pattern!=='string'||!request.pattern||request.pattern.length>2000)throw new Error('search pattern required, at most 2000 characters');
  if(!['files','content'].includes(request.searchType))throw new Error('invalid searchType');
  for(const [key,min,max] of [['contextLines',0,10],['maxResults',1,10000],['timeout_ms',100,300000]])if(!Number.isInteger(request[key])||request[key]<min||request[key]>max)throw new Error('invalid '+key);
  if(!request.literalSearch)new RegExp(request.pattern,request.ignoreCase?'i':'');
  const intentHash=crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
  withStateTransaction(P,()=>{
    ensureDir(dir);
    const file=path.join(dir,'request.json');
    if(fs.existsSync(file)){if(readJson(file).intentHash!==intentHash)throw new Error('SEARCH_INTENT_CONFLICT');}
    else writeJson(file,{...request,intentHash},0o600);
  });
  const runner=fileURLToPath(new URL('./search-runner.mjs',import.meta.url));
  // Reuse the existing supervised, write-ahead process launcher. Reconnects
  // never create another scan or truncate already published results.
  await startProcessTool({sessionId:'search-'+args.sessionId,command:[process.execPath,runner,dir].map(shellQuote).join(' '),cwd:dir,transport:'pipe',timeout_ms:0},P);
  return getSearchResultsTool({sessionId:args.sessionId,length:20},P);
}
export function getSearchResultsTool(args,P){
  const dir=location(P,args.sessionId),current=status(P,args.sessionId);
  let text='';try{text=fs.readFileSync(path.join(dir,'results.jsonl'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  // A reader can see the writer between bytes of a record. Only expose complete
  // newline-terminated records, with stable pagination across reconnections.
  const end=text.lastIndexOf('\n'),rows=end<0?[]:text.slice(0,end).split('\n').filter(Boolean).map(x=>JSON.parse(x));
  const requested=args.offset??0,length=args.length??100;
  if(!Number.isSafeInteger(requested)||!Number.isSafeInteger(length)||length<1||length>1000)throw new Error('invalid search pagination');
  const offset=requested<0?Math.max(0,rows.length+requested):requested;
  const results=[];let bytes=0;
  for(const row of rows.slice(offset,requested<0?undefined:offset+length)){
    const size=Buffer.byteLength(JSON.stringify(row));if(bytes+size>65536)break;bytes+=size;results.push(row);
  }
  const nextOffset=offset+results.length;
  return {...current,results,totalResults:rows.length,offset,nextOffset,
    hasMore:nextOffset<rows.length||['running','launching','uncertain'].includes(current.state)};
}
export async function stopSearchTool(args,P){
  const current=status(P,args.sessionId);
  if(['completed','failed','cancelled','timed_out'].includes(current.state))return current;
  const stopped=await terminateProcessTool({sessionId:'search-'+args.sessionId},P);
  if(stopped.terminated){
    const file=path.join(location(P,args.sessionId),'summary.json');
    if(!fs.existsSync(file))writeJson(file,{state:'cancelled',finishedAt:new Date().toISOString()},0o600);
  }
  return status(P,args.sessionId);
}
export function listSearchesTool(args,P){
  const root=path.join(P.stateRoot,'searches');
  if(!fs.existsSync(root))return {searches:[]};
  return {searches:fs.readdirSync(root).filter(isSafeId).sort().slice(-(args.limit??50)).map(id=>status(P,id))};
}
