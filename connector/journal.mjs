import fs from 'node:fs';
import path from 'node:path';
import {canonical,toolResult} from './queue.mjs';
import {sha} from './auth.mjs';

function save(file,value){
  const tmp=file+'.tmp-'+process.pid;
  const fd=fs.openSync(tmp,'w',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,file);
  const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function correlate(job,response){
  let value=response?.structuredContent;
  if(!value){try{value=JSON.parse(response.content.find(c=>c.type==='text').text);}catch{}}
  if(!value||typeof value!=='object'||Array.isArray(value))
    return toolResult({state:'uncertain',code:'MCP_RESULT_NOT_STRUCTURED',operationId:job.id,retrySafe:false},true);
  // Persist the request identity with the result before upload. A client can
  // detect a misplaced output and recover this exact operation without replay.
  // Never echo command bodies, file contents, environment or owner metadata.
  const connectorOperation={operationId:job.id,toolName:job.name,requestSha256:job.fingerprint};
  for(const key of ['device','path','callId','sessionId','batchId'])
    if(typeof job.args[key]==='string')connectorOperation[key]=job.args[key];
  const correlated={...value,connectorOperation};
  return {...response,...toolResult(correlated,response.isError===true),
    content:[{type:'text',text:JSON.stringify(correlated)},...(response.content??[]).filter(c=>c.type!=='text')]};
}
export async function executeJournaledJob({job,stateDir,call,upload,now=()=>Date.now()}){
  if(!/^[a-f0-9]{64}$/.test(job.id??'')||sha(canonical({name:job.name,args:job.args}))!==job.fingerprint||
    !Number.isSafeInteger(job.expiresAt)||typeof job.mutating!=='boolean'||
    (job.mutating&&(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(job.args?.callId??'')||job.id!==sha('mutation:'+job.args.callId))))throw Error('INVALID_JOB');
  const file=path.join(stateDir,job.id+'.json');
  let record=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  if(record&&record.fingerprint!==job.fingerprint)throw Error('JOURNAL_CONFLICT');
  if(!record?.response){
    let response;
    if(record?.state==='running'&&job.mutating){
      const r=await call('commander_receipt',{callId:job.args.callId});
      const v=r.structuredContent??JSON.parse(r.content[0].text);
      response=toolResult({...v,recoveredAfterAgentRestart:true,operationId:job.id,
        message:'Recovered the original receipt without replay. Observe the original worker/batch or verify the artifact before further mutation.'},v.state!=='completed');
    }else if(now()>job.expiresAt){
      response=toolResult({state:'expired',code:'NOT_DISPATCHED',dispatched:false,operationId:job.id,retrySafe:false},true);
    }else{
      save(file,{id:job.id,fingerprint:job.fingerprint,state:'running',startedAt:now()});
      try{response=await call(job.name,job.args);}
      catch{response=toolResult({state:'uncertain',operationId:job.id,callId:job.args.callId??null,code:'MCP_RESPONSE_NOT_OBSERVED',retrySafe:false},true);}
    }
    response=correlate(job,response);
    record={id:job.id,fingerprint:job.fingerprint,state:'finished',response};save(file,record);
  }
  await upload({id:job.id,fingerprint:job.fingerprint,response:record.response});
  return record.response;
}
