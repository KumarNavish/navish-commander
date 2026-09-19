import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, executableExists } from './util.mjs';
import { BrowserResultError, validateBrowserResult } from './browser-result.mjs';
import { redact } from './browser-dom.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const BUNDLED=path.resolve(HERE,'../bin/navish-browser.py');

function words(value){
  if(Array.isArray(value)) return value.map(String);
  const s=String(value??'').trim();
  if(!s) return [];
  const out=[]; let cur='', quote=null, escaped=false;
  for(const ch of s){
    if(escaped){cur+=ch;escaped=false;continue}
    if(ch==='\\' && quote!=="'"){escaped=true;continue}
    if(quote){if(ch===quote)quote=null;else cur+=ch;continue}
    if(ch==='"'||ch==="'"){quote=ch;continue}
    if(/\s/.test(ch)){if(cur){out.push(cur);cur=''}}else cur+=ch
  }
  if(escaped) cur+='\\';
  if(quote) throw new Error('unterminated quote in browserCommand');
  if(cur) out.push(cur);
  return out;
}

function resolveBackend(config={}){
  const configured=config.browserCommand||process.env.NAVISH_BROWSER_CMD||null;
  if(configured){
    const parts=words(configured);
    if(!parts.length) throw new Error('browserCommand is empty');
    return {parts,source:'configured'};
  }
  if(process.platform==='darwin' && fs.existsSync(BUNDLED)){
    if(executableExists(BUNDLED)) return {parts:[BUNDLED],source:'bundled'};
    if(executableExists('/usr/bin/python3')) return {parts:['/usr/bin/python3',BUNDLED],source:'bundled-python'};
    if(executableExists('python3')) return {parts:['python3',BUNDLED],source:'bundled-python'};
  }
  throw new Error('No browser backend configured. Set browserCommand or install the bundled macOS backend.');
}

function buildArgs(args={}){
  if(args.workflow || Array.isArray(args.steps)){
    const workflow=args.workflow || {steps:args.steps,window_id:args.window_id,timeout:args.timeout};
    return ['workflow','--spec-b64',Buffer.from(JSON.stringify(workflow)).toString('base64')];
  }
  if(args.status===true) return ['status'];
  if(args.snapshot===true){
    const v=['snapshot'];
    if(args.window_id!=null) v.push('--window-id',String(args.window_id));
    if(args.all===true) v.push('--all');
    return v;
  }
  if(args.argv==null) return ['status'];
  if(!Array.isArray(args.argv) || args.argv.some(x=>typeof x!=='string')) throw new Error('browser_command argv must be an array of strings');
  return args.argv;
}

function hardenedArgs(args,timeoutMs){
  if(args.argv!=null){if(!Array.isArray(args.argv)||args.argv.some(x=>typeof x!=='string'))throw new Error('INVALID_BROWSER_ARGV');return {argv:args.argv,input:undefined};}
  const workflow=args.workflow??(args.steps?{steps:args.steps}:null);
  const target=args.target??workflow?.target??(args.window_id&&args.tab_id?`${args.window_id}:${args.tab_id}`:null);
  const prefix=['--timeout-ms',String(Math.min(timeoutMs,120000))];
  if(workflow||args.snapshot){
    if(typeof target!=='string'||!/^\d+:\d+$/.test(target))throw new Error('EXPLICIT_NATIVE_TARGET_REQUIRED');
    prefix.push('--target',target);
  }
  if(workflow){
    if(!Array.isArray(workflow.steps)||workflow.steps.length<1||workflow.steps.length>32||workflow.final)throw new Error('INVALID_NATIVE_OPERATION_BATCH');
    // The hardened Python adapter validates the entire batch before any action.
    return {argv:[...prefix,'batch','-'],input:JSON.stringify(workflow.steps)};
  }
  if(args.snapshot){if(args.expectedUrl)prefix.push('--expect-url',args.expectedUrl);return {argv:[...prefix,'snapshot'],input:undefined};}
  return {argv:[...prefix,'status'],input:undefined};
}

function parseJson(text){
  const s=String(text??'').trim();
  if(!s) return null;
  try{return JSON.parse(s)}catch{return null}
}

export function browserCommandTool(args={},config={}){
  let parts,source,extra,input;
  const requested=Number(args.timeout_ms??args.timeoutMs??30000);
  const timeoutMs=Math.max(1000,Math.min(Number.isFinite(requested)?requested:30000,300000));
  try{
    ({parts,source}=resolveBackend(config));
    if(!executableExists(parts[0]))throw new Error('backend unavailable');
    const hardened=source.startsWith('bundled')||parts.some(x=>/navish-browser(?:-safe)?(?:\.py)?$/.test(x));
    if(hardened){const built=hardenedArgs(args,timeoutMs);extra=built.argv;input=built.input;}else extra=buildArgs(args);
  }catch{
    throw new BrowserResultError('BROWSER_PREFLIGHT_FAILED',{dispatched:false,uncertain:false});
  }
  const started=Date.now();
  const r=run(parts[0],[...parts.slice(1),...extra],{timeoutMs:timeoutMs+1000,maxBuffer:8*1024*1024,input});
  const durationMs=Date.now()-started;
  const parsed=parseJson(r.stdout);
  // Do not expose raw stderr/invalid output: they can contain authenticated page data.
  if(r.error)throw new BrowserResultError('BROWSER_TRANSPORT_UNCERTAIN',{exitCode:r.code});
  validateBrowserResult(parsed,{exitCode:r.code,signal:r.signal});
  const observationsOnly=args.status===true||args.snapshot===true||extra.at(-1)==='status'||extra.at(-1)==='snapshot';
  return {ok:true,backend:[parts[0]],backendArgsOmitted:parts.length>1,source,durationMs,parsed:redact(parsed),
    completionLevel:observationsOnly?'observation':'operation',goalVerified:false};
}

export function browserStatus(config={}){
  try{
    const {parts,source}=resolveBackend(config);
    return {configured:true,command:[parts[0]],commandArgsOmitted:parts.length>1,source,available:executableExists(parts[0]),bundledPath:BUNDLED};
  }catch(e){
    return {configured:false,available:false,bundledPath:BUNDLED,reason:e.message};
  }
}
