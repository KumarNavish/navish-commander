#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {executeJournaledJob} from './journal.mjs';
import {runChannelAgent} from './channel-agent.mjs';
import {boundResultEnvelope} from './result-envelope.mjs';
import {acquireBridgeLock} from '../runtime/app/src/control-lock.mjs';
import {closeStateTransactions} from '../runtime/app/src/state-lock.mjs';
import catalog from './catalog.json' with {type:'json'};

// Dying silently is the one failure the operator cannot diagnose. Record it,
// then exit so launchd restarts a clean process rather than continuing on
// unknown state; the disk journal still owns whatever was in flight.
for(const event of ['unhandledRejection','uncaughtException'])
  process.on(event,e=>{try{console.error(JSON.stringify({event,code:e?.message??String(e)}));}catch{}process.exit(1);});
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!/^https:\/\/[^/]+$/.test(config.origin)||!config.agentToken||!path.isAbsolute(config.stateDir)||!path.isAbsolute(config.server))throw Error('INVALID_AGENT_CONFIG');
fs.mkdirSync(config.stateDir,{recursive:true,mode:0o700});
const release=acquireBridgeLock({stateRoot:config.stateDir});
const inflight=new Map();let stopping=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// A slow start, or a stdio child that dies later, must not end the agent and
// must not leave it holding the channel open against a server it can no longer
// reach. Reconnect instead, single-flight so concurrent jobs never race up
// competing servers against the same state directory.
let client=null,connecting=null;
async function openLocalServer(){
  for(let delay=1000;;delay=Math.min(delay*2,60000)){
    const c=new Client({name:'navish-private-connector-agent',version:'1.0.0'});
    const t=new StdioClientTransport({command:process.execPath,args:[config.server],env:process.env,stderr:'pipe'});
    t.stderr?.resume();
    try{await c.connect(t,{timeout:120000});c.onclose=()=>{if(client===c)client=null;};return c;}
    catch(e){
      console.error(JSON.stringify({event:'local-server-unavailable',code:e.message,retryInMs:delay}));
      try{await c.close();}catch{}
      if(stopping)throw e;
      await sleep(delay);
    }
  }
}
function localServer(){
  if(client)return Promise.resolve(client);
  connecting??=openLocalServer().then(c=>{client=c;connecting=null;return c;},e=>{connecting=null;throw e;});
  return connecting;
}
await localServer();
async function request(endpoint,data){
  const r=await fetch(config.origin+endpoint,{method:data?'POST':'GET',headers:{authorization:'Bearer '+config.agentToken,...(data?{'content-type':'application/json'}:{})},
    ...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('RELAY_HTTP_'+r.status);
  return r.json();
}
const executeJob=(job,upload=result=>request('/agent/result',boundResultEnvelope(result,262144)))=>{
  const tool=catalog.tools.find(t=>t.name===job.name);
  if(!tool)throw Error('UNKNOWN_JOB_TOOL');
  // Recovery semantics come from the installed catalog, never a relay flag.
  return executeJournaledJob({job:{...job,mutating:tool.annotations?.readOnlyHint!==true},stateDir:config.stateDir,
    call:async(name,args)=>(await localServer()).callTool({name,arguments:args},undefined,{timeout:120000}),upload});
};
const stop=()=>{stopping=true;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
let heartbeat=0,backoff=1000;
try{
  if(config.channelOrigin)await runChannelAgent({origin:config.channelOrigin,token:config.agentToken,executeJob,stopped:()=>stopping});
  else while(!stopping){
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
}finally{try{await client?.close();}catch{}release();closeStateTransactions();}
