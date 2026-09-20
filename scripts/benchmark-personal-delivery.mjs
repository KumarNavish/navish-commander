/** Controlled delivery faults against real MCP endpoints; not a production failure rate. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {provider,serverUrl} from './rdc-auth.mjs';
import {sourceDigest,revision} from './benchmark-evidence.mjs';
import {connectorDigest} from '../connector/source-digest.mjs';
const deviceId=process.env.RDC_BENCH_DEVICE;
if(!deviceId||!provider.tokens())throw Error('Explicit authenticated RDC_BENCH_DEVICE required');
const connectorUrl=process.env.CONNECTOR_URL,channelUrl=process.env.CONNECTOR_CHANNEL_URL;
if(!connectorUrl?.startsWith('https://')||!channelUrl?.startsWith('https://')||!process.env.CONNECTOR_OAUTH_FILE)throw Error('Explicit authenticated connector and channel URLs required');
const credential=JSON.parse(fs.readFileSync(process.env.CONNECTOR_OAUTH_FILE)),runId=crypto.randomUUID();
const connectorSourceSha256=connectorDigest();
async function matchingDeployment(){
  for(const origin of [connectorUrl,channelUrl])if((await (await fetch(new URL('/health',origin))).json()).connector?.sourceSha256!==connectorSourceSha256)return false;
  return true;
}
if(!await matchingDeployment())throw Error('Cloud deployment does not match the checkout');
const installation=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.local/share/navish-chatgpt-connector/installation.json')));
if(installation.connectorSourceSha256!==connectorSourceSha256||JSON.parse(fs.readFileSync(installation.configPath)).channelOrigin!==new URL(channelUrl).origin)throw Error('Installed channel route/source mismatch');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-delivery-comparison-'));
const repetitions=Number(process.env.BENCH_ROUNDS||10);
if(!Number.isSafeInteger(repetitions)||repetitions<1||repetitions>20)throw Error('BENCH_ROUNDS must be 1..20');
const protocol={repetitionsPerScenario:repetitions,scenarios:['normal','duplicate-delivery','client-reconnect'],
  work:'append one fixed line, then read it and independently verify exact one-effect file bytes',
  duplication:'two identical tools/call messages, including JSON-RPC id, delivered concurrently; no extra high-level mutation intent',
  reconnect:'close and recreate MCP client after acknowledged append; observe file without retry',
  model:'none; deterministic MCP client',rateScope:'fixed controlled-fault mixture, not natural prevalence',
  baseline:'native RDC tools with no additional caller-built idempotency layer',
  threshold:'at least 50% fewer failed or unresolved complete workflows; zero duplicate effects for Commander'};
const harnessSha256=crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex');
const source={commanderSourceSha256:sourceDigest(),gitRevision:revision(),connectorSourceSha256,installedSourceSha256:installation.sourceSha256};
fs.writeFileSync(root+'/protocol.json',JSON.stringify({protocol,harnessSha256,...source},null,2));
const text=r=>r.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')||'';

async function connect(backend,dir,duplicate=false){
  const client=new Client({name:'navish-delivery-comparison',version:'1.0.0'});
  const transport=backend==='rdc'?new StreamableHTTPClientTransport(new URL(serverUrl),{authProvider:provider})
    :new StreamableHTTPClientTransport(new URL(connectorUrl),{requestInit:{headers:{authorization:'Bearer '+credential.access_token}}});
  transport.stderr?.resume();
  const send=transport.send.bind(transport),pending=[];let duplicated=0;
  transport.send=(message,...rest)=>{
    if(duplicate&&message.method==='tools/call'&&['write_file','commander_write_file'].includes(message.params?.name)){
      duplicate=false;duplicated++;
      const p=Promise.all([send(message,...rest),send(structuredClone(message),...rest)]);pending.push(p);return p.then(()=>{});
    }
    return send(message,...rest);
  };
  await client.connect(transport);
  return {client,call:(name,args)=>client.callTool({name,arguments:args},undefined,{timeout:30000}),
    settled:()=>Promise.all(pending),duplicates:()=>duplicated};
}

const preflight=await connect('rdc',root);
try{
  const nonce=crypto.randomBytes(16).toString('hex');fs.writeFileSync(root+'/host-proof',nonce);
  const read=await preflight.call('read_file',{deviceId,path:root+'/host-proof',offset:0,length:1});
  if(read.isError||!text(read).includes(nonce))throw Error('Selected RDC device is not this fixture host');
}finally{await preflight.client.close();}
const samples=[];
for(const scenario of protocol.scenarios)for(let round=0;round<repetitions;round++)for(const backend of round%2?['rdc','navish']:['navish','rdc']){
  const dir=path.join(root,`${backend}-${scenario}-${round}`);fs.mkdirSync(dir);
  const file=dir+'/effect';let c=await connect(backend,dir,scenario==='duplicate-delivery');
  let verified=false,reason,duplicates=0,observedBytes=null;
  try{
    const args={path:file,content:'once\n',mode:'append'};
    await c.call(backend==='rdc'?'write_file':'commander_write_file',backend==='rdc'?{deviceId,...args}:{device:'local',callId:runId+'-'+scenario+'-'+round,...args});
    await c.settled();duplicates=c.duplicates();
    if(scenario==='client-reconnect'){await c.client.close();c=await connect(backend,dir);}
    const observed=await c.call(backend==='rdc'?'read_file':'commander_read_file',backend==='rdc'?{deviceId,path:file,offset:0,length:10}:{device:'local',path:file});
    const bytes=fs.readFileSync(file,'utf8');observedBytes=Buffer.byteLength(bytes);
    verified=!observed.isError&&text(observed).includes('once')&&bytes==='once\n';
    if(!verified)reason=bytes!=='once\n'?'one-effect predicate failed':'readback not confirmed';
  }catch(e){reason=e.message;}
  finally{await c.settled().catch(()=>{});await c.client.close();}
  const sample={backend,scenario,round,verified,duplicatedMessages:duplicates,observedBytes,...(reason?{reason}:{})};
  samples.push(sample);console.log(JSON.stringify(sample));
}
const summary=Object.fromEntries(['navish','rdc'].map(backend=>{const a=samples.filter(s=>s.backend===backend);return [backend,{workflows:a.length,failedOrUnresolved:a.filter(s=>!s.verified).length,byScenario:Object.fromEntries(protocol.scenarios.map(s=>[s,{workflows:repetitions,failures:a.filter(x=>x.scenario===s&&!x.verified).length}]))}];}));
const reduction=summary.rdc.failedOrUnresolved?1-summary.navish.failedOrUnresolved/summary.rdc.failedOrUnresolved:null;
const sourceUnchanged=sourceDigest()===source.commanderSourceSha256&&connectorDigest()===connectorSourceSha256&&await matchingDeployment();
const report={schema:'navish.controlled-delivery-comparison/v1',runAt:new Date().toISOString(),protocol,harnessSha256,...source,sourceUnchanged,
  routes:{navish:'authenticated edge MCP, SQLite Durable Object and outbound WebSocket to the same Mac',rdc:'hosted OAuth Streamable HTTP MCP to the same Mac'},summary,
  relativeFailureReduction:reduction,controlledTargetPassed:sourceUnchanged&&reduction!==null&&reduction>=.5&&summary.navish.failedOrUnresolved===0,
  productionReliabilityClaim:false,chatPlannerTested:false,samples};
const file=process.env.BENCH_REPORT||'evidence/personal-channel-controlled-delivery.json';
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:file,summary,relativeFailureReduction:reduction}));
