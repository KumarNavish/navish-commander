import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { paths as getPaths, ensureBase, loadConfig, loadDevices, saveConfig } from './config.mjs';
import { beginCall, finishCall, defaultResources, isMutating, reconcileQuarantine, loadReceipt } from './receipts.mjs';
import { readFileTool,readMultipleFilesTool,writeFileTool,createDirectoryTool,moveFileTool,listDirectoryTool,findTextTool } from './files.mjs';
import { startProcessTool,readProcessOutputTool,interactProcessTool,terminateProcessTool,listSessionsTool,listProcessesTool,killProcessTool } from './process.mjs';
import { agentBatchStartTool,agentBatchStatusTool,agentBatchCollectTool,agentBatchSendTool,agentBatchCancelTool,agentBatchListTool } from './agents.mjs';
import {startJobTool,jobStatusTool,listJobsTool,cancelJobTool} from './agent-jobs.mjs';
import { browserCommandTool,browserStatus } from './browser.mjs';
import { EgoBridge,EgoError } from './ego-bridge.mjs';
import { runBrowserJob,browserJobStatus } from './browser-jobs.mjs';
import { listDevices,remoteCall,pairAdd,pairRemove } from './remote.mjs';
import { nowIso, randomId, writeJson, sleep } from './util.mjs';
import { performance } from 'node:perf_hooks';

export const VERSION='1.6.0-rc.1';
export const TOOL_NAMES=['get_config','set_config_value','read_file','read_multiple_files','write_file','create_directory','list_directory','move_file','find_text','start_process','read_process_output','interact_with_process','force_terminate','list_sessions','list_processes','kill_process','browser_agent','browser_agent_health','browser_command','get_usage_stats','get_recent_tool_calls','agent_batch_start','agent_batch_status','agent_batch_collect','agent_batch_send','agent_batch_cancel','agent_batch_list','agent_job_start','agent_job_status','agent_job_list','agent_job_cancel'];

function audit(P,event){fs.appendFileSync(P.auditLog,JSON.stringify({at:nowIso(),...event})+'\n',{mode:0o600});}
function recentCalls(P,max=50){try{return fs.readFileSync(P.auditLog,'utf8').trim().split(/\n/).filter(Boolean).slice(-max).map(x=>JSON.parse(x))}catch{return []}}
function usage(P){const events=recentCalls(P,100000);const byTool={};for(const e of events){if(e.tool)byTool[e.tool]=(byTool[e.tool]||0)+1}return {calls:events.filter(e=>e.event==='call-finished').length,byTool};}

async function executeLocal(tool,args,ctx){const {P,config}=ctx; switch(tool){
  case 'get_config': return {version:VERSION,hostname:os.hostname(),platform:process.platform,arch:process.arch,node:process.version,config,devices:listDevices(P),browser:browserStatus(config),browserAgent:{defaultBackend:'ego-lite',executableAvailable:new EgoBridge().available},paths:{configRoot:P.configRoot,stateRoot:P.stateRoot,dataRoot:P.dataRoot}};
  case 'set_config_value': {const allowed=['allowedDirectories','browserCommand','outputLimitBytes']; if(!allowed.includes(args.key)) throw new Error(`unsupported config key: ${args.key}`); const c={...config,[args.key]:args.value}; saveConfig(c,P); return {key:args.key,value:args.value};}
  case 'read_file': return readFileTool(args,config);
  case 'read_multiple_files': return readMultipleFilesTool(args,config);
  case 'write_file': return writeFileTool(args,config);
  case 'create_directory': return createDirectoryTool(args,config);
  case 'list_directory': return listDirectoryTool(args,config);
  case 'move_file': return moveFileTool(args,config);
  case 'find_text': return findTextTool(args,config);
  case 'start_process': return await startProcessTool(args,P);
  case 'read_process_output': return readProcessOutputTool(args,P);
  case 'interact_with_process': return await interactProcessTool(args,P);
  case 'force_terminate': return await terminateProcessTool(args,P);
  case 'list_sessions': return listSessionsTool(args,P);
  case 'list_processes': return listProcessesTool();
  case 'kill_process': return killProcessTool(args);
  case 'browser_command': return browserCommandTool(args,config);
  case 'browser_agent_health': return {...await new EgoBridge().health(),nativeFallback:browserStatus(config),durableSessions:browserJobStatus(P,args)};
  case 'browser_agent': {
    if(args.workflow||args.steps)return runBrowserJob(args,P);
    if(!((typeof args.goal==='string'&&args.goal.trim()&&args.goal.length<=200)||(Number.isInteger(args.goal)&&args.goal>0))||typeof args.script!=='string'||!args.script.trim()||args.script.length>65536)throw new EgoError('INVALID_BROWSER_AGENT_ARGUMENTS');
    const timeout=Number(args.timeout_ms??60000);if(!Number.isInteger(timeout)||timeout<1000||timeout>300000)throw new EgoError('INVALID_BROWSER_TIMEOUT');
    const result=await new EgoBridge().run({...args,timeout_ms:timeout});
    // A script finishing is not the requested application-level outcome. The
    // recovered script interface must explicitly return its observed verification.
    if(result.result?.ok!==true||result.result?.verified!==true)throw new EgoError('BROWSER_POSTCONDITION_NOT_VERIFIED',{dispatched:true,uncertain:true});
    return {...result,verified:true,verification:'caller-specified application postcondition',backendRequested:'ego-lite',backendChosen:'ego-lite',fallbackReason:null};
  }
  case 'agent_batch_start': return await agentBatchStartTool(args,P);
  case 'agent_batch_status': return agentBatchStatusTool(args,P);
  case 'agent_batch_collect': return agentBatchCollectTool(args,P);
  case 'agent_batch_send': return await agentBatchSendTool(args,P);
  case 'agent_batch_cancel': return await agentBatchCancelTool(args,P);
  case 'agent_batch_list': return agentBatchListTool(args,P);
  case 'agent_job_start': return startJobTool(args,P);
  case 'agent_job_status': return jobStatusTool(args,P);
  case 'agent_job_list': return listJobsTool(args,P);
  case 'agent_job_cancel': return cancelJobTool(args,P);
  case 'get_recent_tool_calls': return {calls:recentCalls(P,Number(args.maxResults||50))};
  case 'get_usage_stats': return usage(P);
  default: throw new Error(`unknown tool: ${tool}`);
}}

export async function callTool({target='local',tool,args={},callId=randomId('call'),resources=[],timeoutMs=120000},P=getPaths()){
  ensureBase(P);
  if(target!=='local') return remoteCall({device:target,tool,args,callId,resources,timeoutMs},P);
  const config=loadConfig(P); const rs=[...defaultResources(tool,args),...(resources||[])]; const mutating=isMutating(tool,args);
  const intent={target,tool,args,resources:rs}; let start;
  const admissionDeadline=performance.now()+Math.max(0,Math.min(300000,Number(timeoutMs)||0));
  for(;;){
    try{
      const metadataBudget=Math.min(5000,Math.max(0,Math.floor(admissionDeadline-performance.now())));
      start=beginCall({callId,intent,resources:rs,mutating},P,{timeoutMs:metadataBudget});break;
    }catch(e){
      if(['RESOURCE_BUSY','STATE_BUSY'].includes(e.code)&&performance.now()<admissionDeadline){await sleep(Math.min(50,Math.max(1,admissionDeadline-performance.now())));continue}
      return {callId,state:'failed',reason:e.message,code:e.code||null,dispatched:false,result:null};
    }
  }
  if(start.replay) return start.receipt;
  let auditRecorded=true;
  const record=event=>{try{audit(P,event)}catch{auditRecorded=false}};
  record({event:'call-started',callId,tool,resources:rs});
  let outcome;
  // This catch handles execution only. It must never consume a receipt-storage
  // error and turn a completed effect into a failed effect (or execute it again).
  try{outcome={state:'completed',result:await executeLocal(tool,args,{P,config,timeoutMs})}}
  catch(e){
    const uncertain=mutating && (e.uncertain===true || e.mayHaveLateEffects===true || e.executionStopped===false || (e.dispatched!==false&&/timeout|socket|EIO|ECONN|closed|unknown/i.test(String(e.message))));
    outcome={state:uncertain?'uncertain':'failed',result:null,reason:e.message};
  }
  let receipt;
  try{receipt=finishCall(start.receipt,outcome,P)}
  catch(e){
    // A running claim blocks reuse; a partially written terminal receipt may
    // also exist. Recovery settles the authoritative record. Do not claim
    // either that terminal persistence succeeded or that it never happened.
    receipt={callId,intentHash:start.receipt.intentHash,state:'uncertain',startedAt:start.receipt.startedAt,
      mutating,resources:rs,result:null,reason:'Action returned, but terminal receipt finalization was not confirmed; reconcile before any new mutation',
      code:'RECEIPT_FINALIZATION_PENDING',metadataCode:e.code||null,dispatched:true,
      uncertain:true,receiptFinalizationPending:true,receiptPersisted:null};
  }
  record({event:receipt.receiptFinalizationPending?'call-finalization-pending':'call-finished',callId,tool,state:receipt.state});
  return auditRecorded?receipt:{...receipt,auditRecorded:false};
}

// These MCP observations have no caller-supplied intent ID or external effect.
// They must see current state, not create/replay a durable mutation receipt.
// Keep an explicit small allowlist: being absent from MUTATING is insufficient.
const REPEATABLE_OBSERVATIONS=new Set(['read_file','read_process_output','agent_batch_collect','agent_job_status','agent_job_list']);
export async function observeLocalTool({tool,args={}},P=getPaths()){
  if(!REPEATABLE_OBSERVATIONS.has(tool))throw Object.assign(new Error('tool requires durable call admission'),{code:'OBSERVATION_TOOL_NOT_ALLOWED'});
  const startedAt=nowIso();
  let outcome;
  try{outcome={state:'completed',result:await executeLocal(tool,args,{P,config:loadConfig(P)})};}
  catch(e){outcome={state:'failed',result:null,reason:e.message,code:e.code||null};}
  let auditRecorded=true;
  try{audit(P,{event:'observation-finished',tool,state:outcome.state});}catch{auditRecorded=false;}
  return {...outcome,startedAt,finishedAt:nowIso(),observation:true,receiptPersisted:false,auditRecorded};
}

export function reconcile({callId,resources=[]},P=getPaths()){const changed=reconcileQuarantine({callId,resources},P);return {changed,receipt:callId?loadReceipt(callId,P):null};}
export function pairAddCommand(opts,P=getPaths()){ensureBase(P);return pairAdd(opts,P)}
export function pairRemoveCommand(name,P=getPaths()){ensureBase(P);return pairRemove(name,P)}
export function devicesCommand(P=getPaths()){ensureBase(P);return listDevices(P)}
