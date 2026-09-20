/** One durable run per immutable plan. Never invoked as an automatic retry. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {git,jobEnvironment} from './agent-jobs.mjs';
import {ensureDir,readJson,writeJson} from './util.mjs';

const planFile=process.argv[2];
if(!path.isAbsolute(planFile||''))throw Error('ABSOLUTE_JOB_PLAN_REQUIRED');
const plan=readJson(planFile),dir=path.dirname(planFile),statusFile=path.join(dir,'status.json');
const log=fs.openSync(path.join(dir,'executor.jsonl'),'wx',0o600);
const startedAt=new Date().toISOString(),deadline=Date.now()+plan.timeoutMs;
let state={state:'running',phase:'preparing',startedAt,updatedAt:startedAt,commands:0,checks:[]};
let current,cancelled=false,timedOut=false,turnCompleted=false,turnFailed=false,streamInvalid=false;
const publish=change=>{state={...state,...change,updatedAt:new Date().toISOString()};writeJson(statusFile,state);};
function stop(){if(current?.pid){try{process.kill(-current.pid,'SIGTERM');}catch{}}}
process.on('SIGTERM',()=>{cancelled=true;stop();});process.on('SIGINT',()=>{cancelled=true;stop();});
function observe(event){
  if(event.type==='thread.started'&&typeof event.thread_id==='string')publish({threadId:event.thread_id});
  if(event.type==='turn.completed')turnCompleted=true;
  if(event.type==='turn.failed'||event.type==='error')turnFailed=true;
  if(event.type==='item.completed'&&event.item?.type==='command_execution')publish({commands:state.commands+1});
}
async function execute(argv,input='',events=false){
  if(Date.now()>=deadline)timedOut=true;
  if(cancelled||timedOut)return {exitCode:null,output:'',stopped:true};
  return new Promise(resolve=>{
    let output='',pending='',spawnError,killAt;
    const child=spawn(plan.executable,argv,{cwd:plan.workspace,env:jobEnvironment(),detached:true,stdio:['pipe','pipe','pipe']});
    current=child;
    child.stdin.on('error',()=>{});child.stdin.end(input);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',bytes=>{
      fs.writeSync(log,bytes);output=(output+bytes.toString('utf8')).slice(-8192);
      if(events){pending+=bytes.toString('utf8');
        for(;;){const i=pending.indexOf('\n');if(i<0)break;const line=pending.slice(0,i);pending=pending.slice(i+1);if(line.trim()){try{observe(JSON.parse(line));}catch{streamInvalid=true;}}}
        if(pending.length>1024*1024){streamInvalid=true;pending='';}
      }
    });
    child.stderr.on('data',bytes=>{fs.writeSync(log,bytes);output=(output+bytes.toString('utf8')).slice(-8192);});
    child.once('error',error=>{spawnError=error.code;});
    const timer=setInterval(()=>{
      if(fs.existsSync(path.join(dir,'cancel.json')))cancelled=true;
      if(Date.now()>=deadline)timedOut=true;
      if(cancelled||timedOut){
        if(!killAt){stop();killAt=Date.now()+5000;}
        else if(Date.now()>=killAt){try{process.kill(-child.pid,'SIGKILL');}catch{}}
      }
    },100);
    child.once('close',(code,signal)=>{clearInterval(timer);current=null;
      if(events&&pending.trim()){try{observe(JSON.parse(pending));}catch{streamInvalid=true;}}
      resolve({exitCode:code,signal,output,...(spawnError?{spawnError}:{})});
    });
  });
}
function capturePatch(){
  // Observation does not stage or change the checkout, including after denial.
  // Explicit base commit also captures any agent-created commits.
  let patch=git(plan.workspace,['diff','--no-ext-diff','--no-textconv','--binary',plan.baseCommit,'--','.']);
  const untracked=git(plan.workspace,['ls-files','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
  for(const file of untracked){
    patch+=git(plan.workspace,['diff','--no-ext-diff','--no-textconv','--no-index','--binary','--','/dev/null',file],[0,1]);
    if(Buffer.byteLength(patch)>16*1024*1024)throw Error('PATCH_TOO_LARGE');
  }
  const file=path.join(dir,'changes.patch');fs.writeFileSync(file,patch,{mode:0o600});
  const changedFiles=[...new Set([...git(plan.workspace,['diff','--no-ext-diff','--no-textconv','--name-only','-z',plan.baseCommit,'--','.']).split('\0').filter(Boolean),...untracked])];
  return {patchPath:file,patchBytes:Buffer.byteLength(patch),patchSha256:crypto.createHash('sha256').update(patch).digest('hex'),changedFiles};
}
try{
  publish({});ensureDir(path.dirname(plan.workspace));
  git(plan.repository,['worktree','add','--detach',plan.workspace,plan.baseCommit]);
  const schemaFile=path.join(dir,'final-schema.json'),finalFile=path.join(dir,'final.json');
  writeJson(schemaFile,{type:'object',additionalProperties:false,required:['outcome','summary','remaining'],properties:{outcome:{type:'string',enum:['completed','needs_attention']},summary:{type:'string'},remaining:{type:'array',items:{type:'string'}}}});
  const prompt=`Implement this authorized repository engineering task in the current isolated checkout:\n\n${plan.goal}\n\nRead and follow applicable AGENTS.md and project instructions. Work only in this checkout. Do not push, publish, deploy, send messages, spend money, change credentials or permissions, install connectors, or route around denied actions. Preserve existing evidence. No other agent work is authorized by this job. If blocked, report needs_attention with the actual remaining issue. Your completion report is a claim; Commander will run these declared checks independently after you finish: ${JSON.stringify(plan.checks)}. Do not change the checks merely to make them pass. Return the required structured report.\n`;
  publish({phase:'implementing'});
  if(fs.existsSync(path.join(dir,'cancel.json')))cancelled=true;
  const run=await execute([...plan.policy,'exec','--sandbox','workspace-write','--json','--color','never',
    '-C',plan.workspace,'--output-schema',schemaFile,'--output-last-message',finalFile,'-'],prompt,true);
  let report=null;
  try{const raw=fs.readFileSync(finalFile,'utf8');if(raw.length<=32768)report=JSON.parse(raw);}catch{}
  const reportedComplete=report?.outcome==='completed'&&typeof report.summary==='string'&&Array.isArray(report.remaining)&&report.remaining.length===0;
  // Do not execute follow-up commands when the executor itself failed or asked
  // for attention. In particular, this is not a denied-action fallback path.
  if(run.exitCode===0&&turnCompleted&&!turnFailed&&!streamInvalid&&reportedComplete&&!cancelled&&!timedOut){
    publish({phase:'verifying',agentReport:report});
    for(const check of plan.checks){
      if(cancelled||timedOut)break;
      const result=await execute([...plan.policy,'sandbox','--include-managed-config','-C',plan.workspace,'--',...check.argv]);
      publish({checks:[...state.checks,{name:check.name,argv:check.argv,exitCode:result.exitCode,output:result.output.slice(-4096),passed:result.exitCode===0}]});
    }
  }
  const artifact=capturePatch();
  const checksPassed=state.checks.length===plan.checks.length&&state.checks.every(c=>c.passed);
  publish({...artifact,agentReport:report,executorExitCode:run.exitCode,checksPassed,
    state:cancelled?'cancelled':timedOut?'needs_attention':checksPassed&&reportedComplete&&turnCompleted&&!turnFailed&&!streamInvalid?'review_ready':'needs_attention',
    phase:'finished',finishedAt:new Date().toISOString(),
    ...(timedOut?{reason:'Job time limit reached. Retained partial changes; no automatic restart.'}:{}),
    ...(!report&&!timedOut&&!cancelled?{reason:'No valid executor final report observed; inspect retained logs.'}:{})});
}catch(error){
  let artifact={};try{if(fs.existsSync(path.join(plan.workspace,'.git')))artifact=capturePatch();}catch{}
  publish({...artifact,state:'needs_attention',phase:'finished',finishedAt:new Date().toISOString(),reason:error.code||error.message,checksPassed:false});
}finally{fs.fsyncSync(log);fs.closeSync(log);}
