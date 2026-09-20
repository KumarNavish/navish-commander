#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { callTool, devicesCommand, observeLocalTool } from '../runtime/app/src/core.mjs';
import { ensureBase, paths } from '../runtime/app/src/config.mjs';
import { loadReceipt, recoverRunningReceipts } from '../runtime/app/src/receipts.mjs';
import { closeStateTransactions } from '../runtime/app/src/state-lock.mjs';
import { inspectProcessSession, prepareProcessRuntime } from '../runtime/app/src/process.mjs';

const P = ensureBase(paths());
// Include dependency discovery in MCP initialization rather than repeating the
// OS interpreter launcher in each independently durable worker.
const pythonRuntime=prepareProcessRuntime();
const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const absolutePath = z.string().min(1).max(4096).startsWith('/');
const device = z.string().min(1).max(120).describe('Exact ID from commander_devices. local is this MCP server host.');
const mutation = {device, callId:id.describe('Stable ID for this intent. Reuse after a lost response; never mint a retry ID.')};
const server = new McpServer({name:'navish-commander', version:'1.6.0-rc.2'}, {
  instructions:'Execute only user-authorized work. Discover devices first. Keep callId, sessionId and batchId across reconnects. A completed tool receipt may describe a running or failed worker. Inspect operationState and verify outputs. Never clear an uncertain record or retry a mutation with a new identity. Local shell commands have the OS account permissions; this server is not a sandbox.'
});

function output(value) {
  return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,
    isError:value.state==='failed'||value.operationState==='failed'};
}
// Do not return command bodies, environment variables, or owner metadata in receipts.
export function receiptView(r) {
  if(!r) return {state:'unknown',operationState:'unknown',retrySafe:false};
  const inner=r.result;
  return {callId:r.callId,state:r.state,operationState:inner?.state??r.state,
    ...(r.code?{code:r.code}:{}),...(r.reason?{reason:r.reason}:{}),
    ...(r.startedAt?{startedAt:r.startedAt}:{}),...(r.finishedAt?{finishedAt:r.finishedAt}:{}),
    ...(r.observation?{observation:true,receiptPersisted:false}:{}),
    retrySafe:false,
    ...(inner?.sessionId?{sessionId:inner.sessionId}:{}),
    ...(inner?.batchId?{batchId:inner.batchId}:{}),...(inner?.jobId?{jobId:inner.jobId}:{})};
}
function register(name,description,schema,readOnly,handler) {
  server.registerTool(name,{description,inputSchema:z.object(schema).strict(),
    annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:readOnly,openWorldHint:true}},
  async args=>{
    try {return output(await handler(args));}
    catch(e) {return output({state:'failed',operationState:'unknown',code:e.code||'COMMANDER_ERROR',message:e.message,retrySafe:false});}
  });
}
async function execute(tool,{device:target,callId,...args}) {
  const r=target==='local'&&!callId
    ? await observeLocalTool({tool,args},P)
    : await callTool({target,tool,args,...(callId?{callId}:{})},P);
  const result=r.result;
  // Process metadata includes command/env and internal paths. Keep only the
  // useful lifecycle/output projection at the public MCP boundary.
  const processTools=['start_process','read_process_output','interact_with_process','force_terminate'];
  let payload=processTools.includes(tool)&&result?Object.fromEntries(
    ['sessionId','pid','state','exitCode','output','offset','nextOffset','totalBytes','truncated','startedAt','finishedAt','reused','reason'].filter(k=>k in result).map(k=>[k,result[k]])
  ):result;
  if(tool==='browser_agent'&&result)payload={
    state:result.state,sessionId:result.sessionId,phaseId:result.phaseId,spaceId:result.spaceId,
    verified:result.verified,verificationFresh:result.verificationFresh,verifiedAt:result.verifiedAt,
    reused:result.reused,backendChosen:result.backendChosen,
    verification:{matched:result.verification?.matched,checks:result.verification?.checks,
      url:result.verification?.observation?.url,title:result.verification?.observation?.title},
    steps:result.steps?.map(s=>({id:s.id,action:s.action,page:s.page,
      ...(s.value?.rows?{rows:s.value.rows.slice(0,4).map(row=>({...row,text:row.text?.slice(0,1000)})),extractionLimited:true}:{})})),
    observationsOmitted:true
  };
  return {...receiptView(r),result:payload};
}

register('commander_devices','Use this to discover exact paired device IDs before execution.',{},true,
  async()=>({state:'completed',devices:devicesCommand(P),platform:process.platform,
    processRuntime:{pythonAvailable:pythonRuntime.available,pythonVersion:pythonRuntime.version??null,...(pythonRuntime.reason?{reason:pythonRuntime.reason}:{})}}));
register('commander_receipt','Use this after a missing response to inspect a local call without re-executing it. A receipt is not current worker state.',{callId:id},true,async({callId})=>{
  recoverRunningReceipts(P);
  return receiptView(loadReceipt(callId,P));
});
register('commander_read_file','Use this to read a bounded file on an explicitly selected device.',
  {device,path:absolutePath,maxBytes:z.number().int().min(1).max(65536).default(16384),offset:z.number().int().default(0),length:z.number().int().min(1).max(1000).default(200)},true,
  args=>execute('read_file',args));
register('commander_write_file','Use this to write a user-authorized file. Keep the same callId for the same write intent.',
  {...mutation,path:absolutePath,content:z.string().max(65536),mode:z.enum(['rewrite','append']).default('rewrite')},false,args=>execute('write_file',args));
register('commander_start_process','Use this to start an authorized persistent local or paired-device shell worker. Keep sessionId stable; commands run with the host account permissions.',
  {...mutation,sessionId:id,command:z.string().min(1).max(32768),cwd:absolutePath,transport:z.enum(['pipe','pty']).optional(),timeout_ms:z.number().int().min(0).max(1000).default(0)},false,args=>execute('start_process',args));
register('commander_process_output','Use this to collect a known worker by its stable session ID after starting or reconnecting. Check exitCode and expected output.',
  {device,sessionId:id,offset:z.number().int().default(0),maxBytes:z.number().int().min(1).max(65536).default(8192)},true,async args=>{
    if(args.device==='local') {
      const current=inspectProcessSession(args.sessionId,P);
      if(['unsubmitted','launching','uncertain'].includes(current.state))return {state:'completed',operationState:current.state,result:current,retrySafe:false};
    }
    return execute('read_process_output',args);
  });
const artifact=z.object({path:z.string().min(1).max(4096),minBytes:z.number().int().min(0).max(16777216).optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
const worker=z.object({id,role:z.string().min(1).max(200),command:z.string().min(1).max(32768),cwd:absolutePath,
  transport:z.enum(['pipe','pty']).describe('pipe for noninteractive jobs; pty for terminal-dependent programs. Omission preserves legacy PTY behavior.').optional(),
  startTimeoutMs:z.number().int().min(0).max(1000).default(0),artifacts:z.array(artifact).max(32).optional()}).strict();
register('commander_start_batch','Use this to launch up to 16 independent authorized workers. Set each noninteractive worker transport to pipe; use pty when a terminal is required. Use separate working directories for edits, stable IDs, and artifact hashes where possible. This launches commands; it does not supply or pay for language models.',
  {...mutation,batchId:id,workers:z.array(worker).min(1).max(16),wait_ms:z.number().int().min(0).max(1000).default(0),maxTotalBytes:z.number().int().min(1).max(65536).default(16384)},false,args=>execute('agent_batch_start',args));
register('commander_collect_batch','Use this to recover or collect a batch without relaunching workers. Check all worker exits and declared artifacts.',
  {device,batchId:id,wait_ms:z.number().int().min(0).max(30000).default(0),maxBytesPerWorker:z.number().int().min(1).max(16384).default(4096),maxTotalBytes:z.number().int().min(1).max(65536).default(16384)},true,args=>execute('agent_batch_collect',args));
register('commander_cancel_batch','Use this only when the user asks to stop an owned batch or worker.',
  {...mutation,batchId:id,workerId:id.optional()},false,args=>execute('agent_batch_cancel',args));

const jobId=id.max(100);
register('commander_job_status','Inspect a retained historical rc.1 repository job without launching work. New model-backed jobs are no longer supported. Inspect state, checks and changedFiles. includePatch returns a bounded patch window; continue with patch.nextOffset. Unknown or uncertain jobs are never restarted.',
  {device:z.literal('local'),jobId,includePatch:z.boolean().default(false),patchOffset:z.number().int().min(0).default(0),maxPatchBytes:z.number().int().min(1).max(32768).default(16384)},true,args=>execute('agent_job_status',args));
register('commander_jobs','List retained historical rc.1 repository job records. Recovery only; Commander no longer supplies a model executor.',
  {device:z.literal('local'),limit:z.number().int().min(1).max(50).default(10)},true,args=>execute('agent_job_list',args));
register('commander_cancel_job','Request cancellation of an owned repository job. Partial changes are retained. Read status to observe cancellation; a request is not proof the executor stopped.',
  {...mutation,device:z.literal('local'),jobId},false,args=>execute('agent_job_cancel',args));

const condition=z.object({url:z.string().max(4096).optional(),selector:z.string().max(2000).optional(),
  text:z.string().max(12000).describe('With selector: normalized exact element text. Without selector: body substring.').optional(),
  value:z.string().max(12000).optional(),absent:z.boolean().optional()}).strict();
const step=z.object({action:z.enum(['open','click','click-text','fill','select','snapshot','extract','verify','wait']),
  page:z.string().regex(/^p[1-9][0-9]{0,2}$/).default('p1'),url:z.string().max(4096).optional(),
  expectedUrl:z.string().max(4096).optional(),selector:z.string().max(2000).optional(),text:z.string().max(1000).optional(),
  value:z.string().max(12000).optional(),after:condition.optional(),condition:condition.optional(),
  limit:z.number().int().min(1).max(40).optional(),maxChars:z.number().int().min(1).max(12000).optional(),
  includeText:z.boolean().optional(),timeout_ms:z.number().int().min(50).max(30000).optional()}).strict();
register('commander_browser_workflow','Use this for an authorized bounded Ego Lite browser workflow on the local host. Requires Ego Lite already installed. Reuse sessionId and phaseId; require an explicit final condition. Stop for user control. Never replay an uncertain phase.',
  {...mutation,device:z.literal('local'),sessionId:id,phaseId:id,goal:z.string().min(1).max(2000),
    allowedOrigins:z.array(z.string().url()).min(1).max(32),
    allowedMutations:z.array(z.enum(['open','click','click-text','fill','select'])).max(5),
    timeout_ms:z.number().int().min(1000).max(60000).default(30000),
    workflow:z.object({steps:z.array(step).min(1).max(16),final:condition,finalPage:z.string().regex(/^p[1-9][0-9]{0,2}$/).default('p1')}).strict()},
  false,args=>execute('browser_agent',args));

await server.connect(new StdioServerTransport());
process.stdin.on('end',async()=>{await server.close();closeStateTransactions();});
