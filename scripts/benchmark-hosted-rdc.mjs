/** Real hosted RDC versus the installable local Commander MCP route. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {provider,serverUrl} from './rdc-auth.mjs';
import {sourceDigest,revision,pairedThroughputInterval} from './benchmark-evidence.mjs';

const deviceId=process.env.RDC_BENCH_DEVICE;
if(!deviceId)throw Error('Set RDC_BENCH_DEVICE to the explicitly selected local host device ID.');
if(!provider.tokens())throw Error('Authorize the hosted comparator with node scripts/rdc-auth.mjs first.');
const rounds=Number(process.env.BENCH_ROUNDS||20);
const transport=process.env.BENCH_TRANSPORT||'pty';
if(!['pty','pipe'].includes(transport))throw Error('BENCH_TRANSPORT must be pty or pipe');
const inline=process.env.BENCH_WAIT_POLICY==='inline';
if(!Number.isSafeInteger(rounds)||rounds<1||rounds>50)throw Error('BENCH_ROUNDS must be 1..50');
const count=4,samples=[],root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-hosted-comparison-'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const text=r=>r.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')||'';
const structured=r=>r.structuredContent??JSON.parse(text(r));
const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex');
const protocol={workers:count,rounds,commanderTransport:transport,waitPolicy:inline?'inline':'staged',work:'sleep 0.20, exact output artifact, exactly-one append effect',
  order:'alternating paired order',concurrency:'four simultaneous RDC calls or one four-worker Commander batch',
  timing:'initialized clients; launch through independently verified artifacts and client close',
  baselineInitialWaitMs:inline?1000:1,baselineCollectWaitMs:100,commanderInitialWaitMs:inline?1000:0,
  polling:'RDC concurrent per-worker polling; Commander server-side batch collection',
  metric:'RDC median elapsed / Commander median elapsed; every Commander outcome must verify',
  gate:2,planning:'deterministic MCP client; no LLM planner',faults:'none in this throughput measurement'};
const frozen={protocol,harnessSha256:sourceHash,commanderSourceSha256:sourceDigest(),gitRevision:revision()};
fs.writeFileSync(root+'/protocol.json',JSON.stringify(frozen,null,2));

async function connect(backend,dir){
  const client=new Client({name:'navish-hosted-comparison',version:'1.0.0'});
  const transport=backend==='rdc'
    ? new StreamableHTTPClientTransport(new URL(serverUrl),{authProvider:provider})
    : new StdioClientTransport({command:process.execPath,args:[path.resolve('src/server.mjs')],stderr:'pipe',env:{...process.env,
      HOME:dir,SHELL:'/bin/bash',NAVISH_CONFIG_DIR:dir+'/config',NAVISH_STATE_DIR:dir+'/state',NAVISH_DATA_DIR:dir+'/data'}});
  transport.stderr?.resume();await client.connect(transport);
  return {client,call:(name,args)=>client.callTool({name,arguments:args},undefined,{timeout:30000})};
}

// Verify the selected registered device exists. A local fixture read through RDC
// below proves this particular endpoint reaches the benchmark host.
const preflight=await connect('rdc',root);
let baselineVersion;
try{
  const devices=JSON.parse(preflight.client?text(await preflight.call('list_devices',{})):'[]');
  const selected=devices.find(d=>d.id===deviceId);
  if(!selected||selected.status!=='online')throw Error('Explicit RDC benchmark device is not online');
  baselineVersion={server:preflight.client.getServerVersion(),device:selected.capabilities?.app_version};
  const nonce=crypto.randomBytes(16).toString('hex');fs.writeFileSync(root+'/host-proof',nonce);
  const proof=await preflight.call('read_file',{deviceId,path:root+'/host-proof',offset:0,length:1});
  if(proof.isError||!text(proof).includes(nonce))throw Error('RDC target did not read this isolated host fixture');
}finally{await preflight.client.close();}

for(let round=0;round<rounds;round++)for(const backend of round%2?['rdc','navish']:['navish','rdc']){
  const dir=path.join(root,backend+'-'+round);fs.mkdirSync(dir);
  const c=await connect(backend,dir);let calls=0,verified=false,reason;
  const workers=Array.from({length:count},(_,i)=>{
    const id='worker-'+i,cwd=dir+'/'+id;fs.mkdirSync(cwd);
    return {id,role:'deterministic IO worker',cwd,...(transport==='pipe'?{transport}:{}),
      command:`printf once >> ${quote(cwd+'/effects')}; sleep 0.20; printf ${quote(id)} > ${quote(cwd+'/result')}; printf ${quote(id)}`,
      artifacts:[{path:'result',sha256:crypto.createHash('sha256').update(id).digest('hex')}]};
  });
  const began=performance.now();
  try{
    if(backend==='navish'){
      calls++;const launch=structured(await c.call('commander_start_batch',{device:'local',callId:'launch',batchId:'batch',workers,wait_ms:inline?1000:0}));
      if(launch.state!=='completed')throw Error('Commander launch was not acknowledged');
      let done=launch;
      if(!inline||launch.operationState!=='completed'){
        calls++;done=structured(await c.call('commander_collect_batch',{device:'local',batchId:'batch',wait_ms:10000}));
      }
      verified=done.operationState==='completed'&&done.result.workers.every(w=>w.exitCode===0&&w.artifacts.every(a=>a.ok));
    }else{
      const pids=await Promise.all(workers.map(async w=>{
        calls++;const r=await c.call('start_process',{deviceId,command:w.command,shell:'/bin/bash',timeout_ms:inline?1000:1});
        if(!r.isError&&text(r).includes('Process exited with code 0'))return null;
        if(!r.isError&&text(r).includes('Process completed with exit code 0'))return null;
        const pid=Number(text(r).match(/PID\s+(\d+)/)?.[1]);
        if(r.isError||!pid)throw Error('RDC launch returned no worker identity');return pid;
      }));
      const states=await Promise.all(pids.map(async pid=>{
        if(pid===null)return true;
        const deadline=performance.now()+10000;
        while(performance.now()<deadline){
          calls++;const r=await c.call('read_process_output',{deviceId,pid,timeout_ms:100,offset:0,length:100});
          const message=text(r);
          if(r.isError)return false;
          if(message.includes('Process completed with exit code 0'))return true;
          if(/Process completed with exit code [1-9]/.test(message))return false;
          await sleep(25);
        }return false;
      }));verified=states.every(Boolean);
    }
    verified=verified&&workers.every(w=>fs.existsSync(w.cwd+'/result')&&fs.readFileSync(w.cwd+'/result','utf8')===w.id&&fs.readFileSync(w.cwd+'/effects','utf8')==='once');
  }catch(e){reason=e.message;}
  finally{await c.client.close();}
  const sample={backend,round,workers:count,verified,calls,elapsedMs:Math.round((performance.now()-began)*100)/100,...(reason?{reason}:{})};
  samples.push(sample);console.log(JSON.stringify(sample));
}
const quantile=(a,q)=>{a=[...a].sort((x,y)=>x-y);const p=(a.length-1)*q,i=Math.floor(p);return a[i]+(a[Math.ceil(p)]-a[i])*(p-i);};
const summary=Object.fromEntries(['navish','rdc'].map(backend=>{
  const a=samples.filter(s=>s.backend===backend);return [backend,{rounds:a.length,verified:a.filter(s=>s.verified).length,medianMs:quantile(a.map(s=>s.elapsedMs),.5),p95Ms:quantile(a.map(s=>s.elapsedMs),.95),calls:a.reduce((n,s)=>n+s.calls,0)}];
}));
const throughputRatio=summary.rdc.medianMs/summary.navish.medianMs;
const throughputInterval=pairedThroughputInterval(samples);
const sourceUnchanged=sourceDigest()===frozen.commanderSourceSha256;
const report={schema:'navish.hosted-route-comparison/v1',runAt:new Date().toISOString(),...frozen,
  routes:{navish:'local stdio MCP',rdc:'hosted OAuth Streamable HTTP MCP to the same Mac'},
  baselineVersion,platform:process.platform,arch:process.arch,node:process.version,sourceUnchanged,summary,throughputRatio,throughputInterval,
  throughputTargetPassed:sourceUnchanged&&throughputInterval.lower>=2&&summary.navish.verified===rounds&&summary.rdc.verified===rounds,
  certification:false,limits:['Different supported transport routes; not equal network-hop cost','No Claude/ChatGPT planner or model-driven agents','No population reliability estimate','No hosted Navish connector'],samples};
const output=process.env.BENCH_REPORT||'evidence/hosted-rdc-route-comparison.json';
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:output,summary,throughputRatio,throughputTargetPassed:report.throughputTargetPassed}));
