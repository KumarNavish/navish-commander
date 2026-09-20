import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {intentHash} from './receipts.mjs';
import {withStateTransaction,processOwner,ownerIsLive} from './state-lock.mjs';
import {ensureDir,isSafeId,readJson,writeJson} from './util.mjs';
import {startProcessTool,inspectProcessSession,readOutputWindow} from './process.mjs';

export const terminalJobStates=new Set(['review_ready','needs_attention','cancelled','uncertain']);
function fail(code){throw Object.assign(Error(code),{code,dispatched:false});}
export function jobDirectory(P,jobId){
  if(!isSafeId(jobId)||jobId.length>100)fail('INVALID_JOB_ID');
  return path.join(P.stateRoot,'agent-jobs',jobId);
}
export function jobEnvironment(env=process.env){
  const clean={...env};
  // Only the already signed-in ChatGPT subscription is supported. No fallback
  // to API billing, alternate model providers, or inherited GUI service pipes.
  for(const name of Object.keys(clean))if(/(?:API_KEY|ACCESS_KEY|SECRET_ACCESS_KEY)$/.test(name)||/^(CODEX_APP_TOOLS_PIPE_PATH|SKY_SERVICE_SOCKET|AWS_|ANTHROPIC_|AZURE_OPENAI_)/.test(name))delete clean[name];
  return clean;
}
export function git(cwd,args,accepted=[0]){
  const r=spawnSync('git',['-c','core.fsmonitor=false',...args],{cwd,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
  if(r.error||!accepted.includes(r.status))fail('JOB_GIT_OPERATION_FAILED');
  return r.stdout;
}
function codexExecutable(){
  const explicit=process.env.NAVISH_CODEX_EXECUTABLE||process.env.CODEX_CLI_PATH;
  const candidates=explicit?[explicit]:['/Applications/ChatGPT.app/Contents/Resources/codex',...String(process.env.PATH||'').split(path.delimiter).map(p=>path.join(p,'codex'))];
  for(const candidate of candidates){try{fs.accessSync(candidate,fs.constants.X_OK);return fs.realpathSync(candidate);}catch{}}
  fail('CODEX_NOT_INSTALLED');
}
export function executorPolicy(executable,cwd){
  const env=jobEnvironment();
  const policy=['-c','forced_login_method="chatgpt"','-c','model_provider="openai"','-c','approval_policy="never"',
    '-c','sandbox_mode="workspace-write"','-c','sandbox_workspace_write.network_access=false','-c','sandbox_workspace_write.writable_roots=[]',
    '-c','features.apps=false','-c','features.browser_use=false','-c','features.computer_use=false',
    '-c','features.multi_agent=false','-c','web_search="disabled"','-c','model_reasoning_effort="xhigh"'];
  const invoke=args=>spawnSync(executable,[...policy,...args],{cwd,env,encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
  const login=invoke(['login','status']);
  if(login.status!==0||!/^Logged in using ChatGPT\s*$/m.test(login.stdout+login.stderr))fail('CHATGPT_CODEX_LOGIN_REQUIRED');
  const list=invoke(['mcp','list','--json']);
  let servers;try{servers=JSON.parse(list.stdout);}catch{fail('CODEX_TOOL_POLICY_UNAVAILABLE');}
  if(list.status!==0||!Array.isArray(servers))fail('CODEX_TOOL_POLICY_UNAVAILABLE');
  // Disable external connectors for this bounded repository executor. Keep
  // normal config, AGENTS.md, hooks and managed requirements in force.
  const disabled=servers.map(server=>{
    if(typeof server.name!=='string'||!['stdio','streamable_http'].includes(server.transport?.type))fail('CODEX_TOOL_POLICY_UNAVAILABLE');
    // Plugin-provided entries need a complete transport during CLI bootstrap.
    // Use inert values of the original transport kind so inherited config does
    // not merge an HTTP URL into a stdio definition. No credentials are copied.
    const transport=server.transport.type==='stdio'?'command="/usr/bin/false"':'url="https://example.invalid/mcp"';
    return `${JSON.stringify(server.name)}={${transport},enabled=false}`;
  });
  policy.push('-c','mcp_servers={'+disabled.join(',')+'}');
  const effective=invoke(['mcp','list','--json']);
  try{const list=JSON.parse(effective.stdout);if(effective.status!==0||!Array.isArray(list)||list.some(s=>s.enabled!==false))fail('CODEX_EXTERNAL_TOOLS_NOT_DISABLED');}
  catch{fail('CODEX_EXTERNAL_TOOLS_NOT_DISABLED');}
  return policy;
}
function normalize(args){
  jobDirectory({stateRoot:'/'},args.jobId);
  if(typeof args.repository!=='string'||!path.isAbsolute(args.repository))fail('ABSOLUTE_REPOSITORY_REQUIRED');
  const repository=fs.realpathSync(args.repository);
  if(git(repository,['rev-parse','--show-toplevel']).trim()!==repository)fail('REPOSITORY_ROOT_REQUIRED');
  if(typeof args.goal!=='string'||!args.goal.trim()||args.goal.length>16000)fail('INVALID_JOB_GOAL');
  const checks=args.checks??[];
  if(!Array.isArray(checks)||checks.length<1||checks.length>8)fail('JOB_CHECKS_REQUIRED');
  for(const check of checks){
    if(typeof check.name!=='string'||!check.name||check.name.length>120||!Array.isArray(check.argv)||!check.argv.length||check.argv.length>32||check.argv.some(x=>typeof x!=='string'||x.length>4096)||!check.argv[0])fail('INVALID_JOB_CHECK');
  }
  const timeoutMs=args.timeoutMs??900000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>3600000)fail('INVALID_JOB_TIMEOUT');
  return {jobId:args.jobId,repository,goal:args.goal,checks:checks.map(c=>({name:c.name,argv:c.argv})),timeoutMs};
}
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export async function startJobTool(args,P){
  const spec=normalize(args),dir=jobDirectory(P,spec.jobId),planFile=path.join(dir,'plan.json');
  const specHash=intentHash(spec);
  // Existing IDs are reconciled before login, branch changes, or any launch.
  if(fs.existsSync(planFile)){
    if(readJson(planFile).specHash!==specHash)fail('JOB_ID_CONFLICT');
    return {...jobStatusTool({jobId:spec.jobId},P),reused:true};
  }
  const executable=codexExecutable(),policy=executorPolicy(executable,spec.repository);
  const baseCommit=git(spec.repository,['rev-parse','HEAD']).trim();
  const workspace=path.join(P.dataRoot,'agent-jobs',spec.jobId,'workspace');
  const claimed=withStateTransaction(P,()=>{
    if(fs.existsSync(planFile)){if(readJson(planFile).specHash!==specHash)fail('JOB_ID_CONFLICT');return false;}
    ensureDir(dir);
    writeJson(planFile,{version:1,...spec,specHash,baseCommit,workspace,executable,policy,
      createdAt:new Date().toISOString(),owner:processOwner(),sessionId:'job-'+spec.jobId});
    return true;
  });
  if(claimed){
    const runner=path.join(path.dirname(fileURLToPath(import.meta.url)),'agent-job-runner.mjs');
    // Only fixed executable and private plan paths enter the shell, never goal
    // text, check arguments, source filenames or model-generated content.
    await startProcessTool({sessionId:'job-'+spec.jobId,transport:'pipe',cwd:spec.repository,
      command:[process.execPath,runner,planFile].map(quote).join(' '),timeout_ms:0},P);
  }
  return {...jobStatusTool({jobId:spec.jobId},P),reused:!claimed};
}
export function jobStatusTool(args,P){
  const dir=jobDirectory(P,args.jobId),file=path.join(dir,'plan.json');
  if(!fs.existsSync(file))return {jobId:args.jobId,state:'unsubmitted',retrySafe:false};
  const plan=readJson(file),stateFile=path.join(dir,'status.json');
  let state=fs.existsSync(stateFile)?readJson(stateFile):{state:'launching'};
  const processState=inspectProcessSession(plan.sessionId,P);
  if(!terminalJobStates.has(state.state)&&
    (['unknown','uncertain','failed','completed'].includes(processState.state)||processState.state==='unsubmitted'&&!ownerIsLive(plan.owner)))
    state={...state,state:'uncertain',reason:'Executor terminal record not observed; inspect retained workspace and logs. This job will not relaunch.'};
  const view={jobId:plan.jobId,repository:plan.repository,baseCommit:plan.baseCommit,workspace:plan.workspace,
    createdAt:plan.createdAt,...state,processState:processState.state,retrySafe:false,goalVerified:false};
  if(args.includePatch&&terminalJobStates.has(state.state))view.patch=readOutputWindow(path.join(dir,'changes.patch'),args.patchOffset??0,args.maxPatchBytes??16384);
  return view;
}
export function listJobsTool(args,P){
  const dir=path.join(P.stateRoot,'agent-jobs');
  if(!fs.existsSync(dir))return {state:'completed',jobs:[]};
  const limit=Math.max(1,Math.min(50,args.limit??10));
  const jobs=fs.readdirSync(dir).filter(id=>isSafeId(id)&&fs.existsSync(path.join(dir,id,'plan.json')))
    .map(jobId=>jobStatusTool({jobId},P)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit);
  return {state:'completed',jobs};
}
export function cancelJobTool(args,P){
  const state=jobStatusTool(args,P);
  if(state.state==='unsubmitted'||terminalJobStates.has(state.state))return state;
  writeJson(path.join(jobDirectory(P,args.jobId),'cancel.json'),{requestedAt:new Date().toISOString()});
  return {...state,cancellationRequested:true};
}
