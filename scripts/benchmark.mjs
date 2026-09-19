/** Local MCP comparison only. Does not benchmark the hosted Remote DC relay. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const baseline=path.resolve('.bench/baseline/node_modules/@wonderwhy-er/desktop-commander/dist/index.js');
if(!fs.existsSync(baseline))throw Error('Install the pinned baseline in .bench/baseline first; see docs/BENCHMARK.md');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'commander-comparison-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rounds=Number(process.env.BENCH_ROUNDS||10),count=4;
const samples=[];
function lab(backend,round) {
  const dir=path.join(root,backend+'-'+round);fs.mkdirSync(dir);
  fs.mkdirSync(dir+'/.claude-server-commander');
  fs.writeFileSync(dir+'/.claude-server-commander/config.json',JSON.stringify({telemetryEnabled:false,allowedDirectories:[dir],welcomeOnboardingEligible:false,pendingWelcomeOnboarding:false}));
  return {dir,env:{...process.env,HOME:dir,SHELL:'/bin/bash',NAVISH_CONFIG_DIR:dir+'/config',NAVISH_STATE_DIR:dir+'/state',NAVISH_DATA_DIR:dir+'/data',DESKTOP_COMMANDER_DISABLE_TELEMETRY:'1'}};
}
async function connect(backend,l) {
  const client=new Client({name:'commander-controlled-benchmark',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:backend==='navish'?[path.resolve('src/server.mjs')]:[baseline,'--no-onboarding'],env:l.env,stderr:'pipe'});
  transport.stderr?.resume();await client.connect(transport);
  return {client,call:(name,args)=>client.callTool({name,arguments:args},undefined,{timeout:15000})};
}
const structured=r=>r.structuredContent??JSON.parse(r.content[0].text);
const text=r=>r.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
async function run(backend,round,restart) {
  const l=lab(backend,round);let c=await connect(backend,l);let calls=0;
  const workers=Array.from({length:count},(_,n)=>{
    const id='worker-'+n,cwd=l.dir+'/'+id;fs.mkdirSync(cwd);
    // Identical shell and work; the marker detects accidental relaunch.
    const command=`printf once >> '${cwd}/effects'; sleep 0.20; printf '${id}' > '${cwd}/result'; printf '${id}'`;
    return {id,role:'deterministic IO worker',cwd,command,artifacts:[{path:'result',sha256:crypto.createHash('sha256').update(id).digest('hex')}]};
  });
  const start=performance.now();let verified=false,reason=null;
  try{
    if(backend==='navish') {
      calls++;const initial=structured(await c.call('commander_start_batch',{device:'local',callId:'start',batchId:'batch',workers,wait_ms:0}));
      if(initial.state!=='completed')throw Error('batch launch not acknowledged');
      if(restart){await c.client.close();c=await connect(backend,l);}
      calls++;const done=structured(await c.call('commander_collect_batch',{device:'local',batchId:'batch',wait_ms:10000}));
      verified=done.operationState==='completed'&&done.result.workers.every(w=>w.exitCode===0&&w.artifacts.every(a=>a.ok));
    }else {
      const launched=await Promise.all(workers.map(async w=>{calls++;const r=await c.call('start_process',{command:w.command,timeout_ms:1,shell:'/bin/bash'});const pid=text(r).match(/PID\s+(\d+)/)?.[1];if(!pid)throw Error('missing worker identity');return Number(pid);}));
      if(restart){await c.client.close();c=await connect(backend,l);}
      const settled=await Promise.all(launched.map(async pid=>{
        const deadline=performance.now()+10000;
        while(performance.now()<deadline){calls++;const r=await c.call('read_process_output',{pid,timeout_ms:100,offset:0,length:100});
          const message=text(r);if(r.isError)return false;
          if(message.includes('Process completed with exit code 0'))return true;
          if(/Process completed with exit code [1-9]/.test(message))return false;
          await sleep(25);
        }return false;
      }));verified=settled.every(Boolean);
    }
    // Same independent acceptance predicate on both sides, beyond transport text.
    verified=verified&&workers.every(w=>fs.existsSync(w.cwd+'/result')&&fs.readFileSync(w.cwd+'/result','utf8')===w.id&&fs.readFileSync(w.cwd+'/effects','utf8')==='once');
  }catch(e){reason=e.message;}
  finally{await c.client.close();}
  const sample={backend,round,scenario:restart?'mcp-server-reconnect':'uninterrupted',workers:count,verified,calls,elapsedMs:Math.round((performance.now()-start)*100)/100,...(reason?{reason}:{})};
  samples.push(sample);console.log(JSON.stringify(sample));
}
// Alternate order to reduce host-load/order bias. Startup excluded in both arms;
// reconnect cost included in both. No paid model calls or live user resources.
for(let round=0;round<rounds;round++)for(const backend of round%2?['desktop-commander','navish']:['navish','desktop-commander'])await run(backend,round,false);
for(let round=rounds;round<rounds+4;round++)for(const backend of round%2?['desktop-commander','navish']:['navish','desktop-commander'])await run(backend,round,true);
const median=a=>{a=[...a].sort((x,y)=>x-y);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
const summary=Object.fromEntries(['navish','desktop-commander'].map(backend=>{const all=samples.filter(s=>s.backend===backend),normal=all.filter(s=>s.scenario==='uninterrupted');return [backend,{samples:all.length,failures:all.filter(s=>!s.verified).length,normalMedianMs:median(normal.map(s=>s.elapsedMs)),normalVerified:normal.filter(s=>s.verified).length}];}));
const ratio=summary['desktop-commander'].normalMedianMs/summary.navish.normalMedianMs;
const report={schema:'navish.local-mcp-comparison/v1',runAt:new Date().toISOString(),scope:'Local stdio MCP execution; excludes hosted RDC relay, ChatGPT/Claude planning, model quality and cloud network.',platform:process.platform,arch:process.arch,node:process.version,baseline:{name:'@wonderwhy-er/desktop-commander',version:'0.2.51'},workload:{workers:count,normalRounds:rounds,reconnectRounds:4,work:'0.20s delay, deterministic output and exactly-one file effect'},summary,throughputRatio:ratio,throughputTargetPassed:ratio>=2&&summary.navish.normalVerified===rounds,remoteCertification:false,samples};
fs.mkdirSync('evidence',{recursive:true});const file=process.env.BENCH_REPORT||'evidence/local-mcp-comparison.json';fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:file,summary,throughputRatio:ratio}));
// Own finite fixture workers may finish after a disconnected baseline. Keep the
// temporary directory as diagnostic evidence; do not kill unrelated processes.
