#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { callTool,reconcile,pairAddCommand,pairRemoveCommand,devicesCommand,VERSION,TOOL_NAMES } from '../src/core.mjs';
import { paths as getPaths,ensureBase,loadConfig,saveConfig } from '../src/config.mjs';
import { randomId,run } from '../src/util.mjs';

const argv=process.argv.slice(2); const cmd=argv.shift(); const P=ensureBase(getPaths());
function take(name,def=null){const i=argv.indexOf(name);if(i<0)return def;const v=argv[i+1];argv.splice(i,2);return v}
function has(name){const i=argv.indexOf(name);if(i<0)return false;argv.splice(i,1);return true}
function out(x){process.stdout.write(JSON.stringify(x,null,2)+'\n')}
function parseArgs(pos){const b64=take('--args-b64'); if(b64) return JSON.parse(Buffer.from(b64,'base64').toString('utf8')); const s=pos??take('--args-json','{}');return JSON.parse(s||'{}')}
function compactReceipt(r){
  if(!r||typeof r!=='object') return r;
  const keep=['callId','intentHash','state','startedAt','finishedAt','mutating','resources','result','reason','code','dispatched','uncertain','receiptFinalizationPending','receiptPersisted','metadataCode','auditRecorded'];
  const c={}; for(const k of keep) if(Object.prototype.hasOwnProperty.call(r,k)) c[k]=r[k];
  return c;
}
function help(){console.log(`Navish Commander ${VERSION}\n\nUsage:\n  navish devices\n  navish tools [device]\n  navish call <device> <tool> [args-json] [--call-id ID] [--resources-b64 BASE64] [--compact] [--json]\n  navish pair add <ssh-target> --name NAME\n  navish pair remove NAME\n  navish reconcile --call-id ID\n  navish config get\n  navish config set KEY JSON_VALUE\n  navish doctor\n  navish selftest\n  navish github-control ...\n`)}
async function main(){
  if(!cmd||cmd==='help'||cmd==='--help'){help();return 0}
  if(cmd==='devices'){out({devices:devicesCommand(P)});return 0}
  if(cmd==='tools'){out({device:argv[0]||'local',tools:TOOL_NAMES});return 0}
  if(cmd==='call'){
    const target=argv.shift(); const tool=argv.shift(); if(!target||!tool)throw new Error('call requires device and tool');
    const positional=argv[0] && !argv[0].startsWith('--') ? argv.shift() : null; const args=parseArgs(positional);
    const callId=take('--call-id')||args.navishCallId||randomId('call'); delete args.navishCallId;
    const rb64=take('--resources-b64'); const resources=rb64?JSON.parse(Buffer.from(rb64,'base64').toString('utf8')):[];
    const timeoutMs=Number(take('--timeout-ms','120000')); const compact=has('--compact'); has('--json');
    const r=await callTool({target,tool,args,callId,resources,timeoutMs},P); out(compact?compactReceipt(r):r); return r.state==='completed'?0:r.state==='failed'?2:3;
  }
  if(cmd==='pair'){
    const sub=argv.shift(); if(sub==='add'){const sshSpec=argv.shift();const name=take('--name');const navishPath=take('--navish-path','~/.local/bin/navish');out(pairAddCommand({name,sshSpec,navishPath},P));return 0}
    if(sub==='remove'){out(pairRemoveCommand(argv.shift(),P));return 0} throw new Error('pair add/remove');
  }
  if(cmd==='reconcile'){const callId=take('--call-id');const rs=take('--resources-b64');out(reconcile({callId,resources:rs?JSON.parse(Buffer.from(rs,'base64').toString('utf8')):[]},P));return 0}
  if(cmd==='config'){
    const sub=argv.shift();if(sub==='get'){out(loadConfig(P));return 0} if(sub==='set'){const key=argv.shift(),v=argv.shift();if(!key||v==null)throw new Error('config set KEY JSON_VALUE');const receipt=await callTool({tool:'set_config_value',args:{key,value:JSON.parse(v)}},P);out(receipt);return receipt.state==='completed'?0:2}throw new Error('config get/set');
  }
  if(cmd==='doctor'){
    const checks={node:(()=>{const [major,minor]=process.versions.node.split('.').map(Number);return major>22||(major===22&&minor>=16)})(),python:run('python3',['--version']).code===0,git:run('git',['--version']).code===0,ssh:run('ssh',['-V']).code===0,config:fs.existsSync(P.configFile)}; const requiredOk=checks.node&&checks.python&&checks.git&&checks.config;
    out({ok:requiredOk,version:VERSION,hostname:os.hostname(),checks,optional:{ssh:'required only for paired remote devices'},devices:devicesCommand(P)});return requiredOk?0:1;
  }
  if(cmd==='selftest'){
    const base=path.join(os.tmpdir(),`navish-selftest-${process.pid}`);const cid=randomId('selftest');
    const a=await callTool({target:'local',tool:'create_directory',args:{path:base},callId:cid+'-mkdir'},P);
    const b=await callTool({target:'local',tool:'write_file',args:{path:path.join(base,'hello.txt'),content:'navish-selftest\n'},callId:cid+'-write'},P);
    const c=await callTool({target:'local',tool:'read_file',args:{path:path.join(base,'hello.txt')},callId:cid+'-read'},P);
    const d=await callTool({target:'local',tool:'start_process',args:{command:'printf 42',timeout_ms:1500},callId:cid+'-proc'},P);
    let processResult=d.result;let processOutput=d.result?.output||''; if(!processOutput.includes('42') && d.result?.pid){await new Promise(r=>setTimeout(r,200)); const dr=await callTool({target:'local',tool:'read_process_output',args:{pid:d.result.pid,offset:-20},callId:cid+'-proc-read'},P); processResult=dr.result||processResult;processOutput=dr.result?.output||processOutput;}
    fs.rmSync(base,{recursive:true,force:true}); const ok=[a,b,c,d].every(x=>x.state==='completed')&&c.result?.content==='navish-selftest\n'&&processResult?.state==='completed'&&processResult?.exitCode===0&&processOutput==='42';out({ok,checks:{mkdir:a.state,write:b.state,read:c.state,process:d.state},processOutput});return ok?0:1;
  }
  if(cmd==='github-control'){
    const exe=path.join(path.dirname(new URL(import.meta.url).pathname),'navish-github-control.mjs');const r=run(process.execPath,[exe,...argv],{timeoutMs:0,maxBuffer:16*1024*1024});process.stdout.write(r.stdout);process.stderr.write(r.stderr);return r.code??1;
  }
  throw new Error(`unknown command: ${cmd}`);
}
main().then(c=>process.exitCode=c).catch(e=>{console.error(`Navish Commander: ${e.message}`);process.exitCode=1});
