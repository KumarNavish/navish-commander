import fs from 'node:fs';
import path from 'node:path';
import {ownerIsLive} from './state-lock.mjs';
import {isSafeId,readJson,writeJson} from './util.mjs';
import {inspectProcessSession,readOutputWindow} from './process.mjs';

// Recovery only. The rc.1 model executor was removed: Chat supplies reasoning.
export const terminalJobStates=new Set(['review_ready','needs_attention','cancelled','uncertain']);
export function jobDirectory(P,jobId){
  if(!isSafeId(jobId)||jobId.length>100)throw Object.assign(Error('INVALID_JOB_ID'),{code:'INVALID_JOB_ID',dispatched:false});
  return path.join(P.stateRoot,'agent-jobs',jobId);
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
    createdAt:plan.createdAt,...state,processState:processState.state,retrySafe:false,goalVerified:false,
    integration:{state:'not_observed',applied:null,published:null,
      reason:'This job record does not track later application, merging or publication by another actor. Do not infer either that these occurred or that they did not.'}};
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
