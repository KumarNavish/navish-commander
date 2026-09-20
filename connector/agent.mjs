#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {executeJournaledJob} from './journal.mjs';
import {acquireBridgeLock} from '../runtime/app/src/control-lock.mjs';
import {closeStateTransactions} from '../runtime/app/src/state-lock.mjs';
import catalog from './catalog.json' with {type:'json'};

const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!/^https:\/\/[^/]+$/.test(config.origin)||!config.agentToken||!path.isAbsolute(config.stateDir)||!path.isAbsolute(config.server))throw Error('INVALID_AGENT_CONFIG');
fs.mkdirSync(config.stateDir,{recursive:true,mode:0o700});
const release=acquireBridgeLock({stateRoot:config.stateDir});
const client=new Client({name:'navish-private-connector-agent',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[config.server],env:process.env,stderr:'pipe'});
transport.stderr?.resume();
await client.connect(transport);
const inflight=new Map();let stopping=false;
async function request(endpoint,data){
  const r=await fetch(config.origin+endpoint,{method:data?'POST':'GET',headers:{authorization:'Bearer '+config.agentToken,...(data?{'content-type':'application/json'}:{})},
    ...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('RELAY_HTTP_'+r.status);
  return r.json();
}
const executeJob=job=>{
  const tool=catalog.tools.find(t=>t.name===job.name);
  if(!tool)throw Error('UNKNOWN_JOB_TOOL');
  // Recovery semantics come from the installed catalog, never a relay flag.
  return executeJournaledJob({job:{...job,mutating:tool.annotations?.readOnlyHint!==true},stateDir:config.stateDir,
    call:(name,args)=>client.callTool({name,arguments:args},undefined,{timeout:120000}),upload:result=>request('/agent/result',result)});
};
const stop=()=>{stopping=true;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
let heartbeat=0,backoff=1000;
try{
  while(!stopping){
    try{
      if(Date.now()-heartbeat>60000){await request('/agent/heartbeat',{});heartbeat=Date.now();}
      if(inflight.size>=4){await Promise.race(inflight.values());continue;}
      const {jobs}=await request('/agent/poll');
      for(const job of jobs??[]){
        if(inflight.has(job.id)||inflight.size>=4)continue;
        const p=executeJob(job).catch(e=>console.error(JSON.stringify({event:'job-not-acknowledged',id:job.id,code:e.message}))).finally(()=>inflight.delete(job.id));
        inflight.set(job.id,p);
      }
      backoff=1000;
      // An already-running pending job must not create a tight network loop.
      if(jobs?.length)await new Promise(r=>setTimeout(r,500));
    }catch(e){console.error(JSON.stringify({event:'relay-unavailable',code:e.message,retryInMs:backoff}));await new Promise(r=>setTimeout(r,backoff));backoff=Math.min(backoff*2,60000);}
  }
  await Promise.allSettled(inflight.values());
}finally{await client.close();release();closeStateTransactions();}
