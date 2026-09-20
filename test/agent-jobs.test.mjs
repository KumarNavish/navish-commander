import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {jobEnvironment} from '../runtime/app/src/agent-jobs.mjs';

const server=path.resolve(process.env.NAVISH_MCP_SERVER||'src/server.mjs');
function lab(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-jobs-')),repository=path.join(root,'repo');fs.mkdirSync(repository);
  const git=args=>{const r=spawnSync('git',args,{cwd:repository,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
  git(['init','-q']);git(['config','user.email','fixture@example.invalid']);git(['config','user.name','Fixture']);
  fs.writeFileSync(path.join(repository,'README.md'),'base\n');git(['add','.']);git(['commit','-qm','fixture']);
  const fake=path.join(root,'codex');fs.copyFileSync('test/fixtures/codex-job.mjs',fake);fs.chmodSync(fake,0o700);
  return {root,repository,git,env:{...process.env,NAVISH_CONFIG_DIR:root+'/config',NAVISH_STATE_DIR:root+'/state',NAVISH_DATA_DIR:root+'/data',NAVISH_CODEX_EXECUTABLE:fake,
    OPENAI_API_KEY:'forbidden-fixture-key',CODEX_API_KEY:'forbidden-fixture-key'}};
}
async function connect(lab){
  const client=new Client({name:'job-fixture',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[server],env:lab.env,stderr:'pipe'});transport.stderr?.resume();
  await client.connect(transport);
  return {client,call:async(name,args)=>{const r=await client.callTool({name,arguments:args});return r.structuredContent??JSON.parse(r.content[0].text);}};
}
const check={name:'actual file content',argv:[process.execPath,'-e',"if(require('fs').readFileSync('result.txt','utf8')!=='implemented\\n')process.exit(2)"]};
const start=(l,goal='Implement the requested file')=>({device:'local',callId:'start-job',jobId:'job',repository:l.repository,goal,checks:[check]});
async function terminal(c){
  const end=Date.now()+15000;
  while(Date.now()<end){const r=await c.call('commander_job_status',{device:'local',jobId:'job',includePatch:true});if(['review_ready','needs_attention','uncertain','cancelled'].includes(r.operationState))return r.result;await new Promise(r=>setTimeout(r,50));}
  throw Error('job did not finish');
}
function cleanup(l){
  // Remove only worktrees belonging to this isolated test repository.
  const workspace=path.join(l.root,'data/agent-jobs/job/workspace');
  if(fs.existsSync(workspace))l.git(['worktree','remove','--force',workspace]);
  fs.rmSync(l.root,{recursive:true,force:true});
}
test('job survives MCP disconnect, verifies an actual new-file patch, and never replays',async()=>{
  const l=lab();let c=await connect(l);
  try{
    const args=start(l);const first=await c.call('commander_start_job',args);assert.equal(first.state,'completed');
    await c.client.close();c=await connect(l);
    const final=await terminal(c);assert.equal(final.state,'review_ready');assert.equal(final.checksPassed,true);assert.equal(final.goalVerified,false);
    assert.match(final.patch.output,/\+implemented/);assert.equal(final.threadId,'fixture-thread');assert.ok(final.changedFiles.includes('result.txt'));
    assert.equal(l.git(['status','--porcelain']),'');assert.equal(fs.existsSync(path.join(l.repository,'result.txt')),false);
    assert.equal(fs.readFileSync(path.join(final.workspace,'launch-count'),'utf8'),'launch\n');
    const before=fs.readdirSync(l.env.NAVISH_STATE_DIR+'/receipts').length;
    const jobs=await c.call('commander_jobs',{device:'local'});assert.equal(jobs.result.jobs[0].jobId,'job');
    await c.call('commander_job_status',{device:'local',jobId:'job'});assert.equal(fs.readdirSync(l.env.NAVISH_STATE_DIR+'/receipts').length,before);
    await c.call('commander_start_job',args);
    assert.equal((await c.call('commander_start_job',{...args,callId:'reconnect'})).result.reused,true);
    assert.match((await c.call('commander_start_job',{...args,callId:'different',goal:'different intent'})).reason,/JOB_ID_CONFLICT/);
    assert.equal(fs.readFileSync(path.join(final.workspace,'launch-count'),'utf8'),'launch\n');
    // Patch applies to a fresh base and contains the new file, not only a summary.
    const patch=path.join(l.root,'patch');fs.writeFileSync(patch,final.patch.output);l.git(['apply','--check',patch]);
    l.git(['apply',patch]);
    assert.equal(fs.readFileSync(path.join(l.repository,'result.txt'),'utf8'),'implemented\n');
    const afterIntegration=await c.call('commander_job_status',{device:'local',jobId:'job'});
    assert.equal(afterIntegration.result.integration.state,'not_observed');
    assert.equal(afterIntegration.result.integration.applied,null);
    assert.equal(afterIntegration.result.integration.published,null);
  }finally{await c.client.close();cleanup(l);}
});
for(const goal of ['BLOCKED','TURN_FAILED','NO_TERMINAL'])test(`executor ${goal} cannot become success or run follow-up checks`,async()=>{
  const l=lab(),c=await connect(l);
  try{await c.call('commander_start_job',start(l,goal));const final=await terminal(c);
    assert.equal(final.state,'needs_attention');assert.equal(final.checksPassed,false);assert.deepEqual(final.checks,[]);assert.ok(final.changedFiles.includes('result.txt'));
  }finally{await c.client.close();cleanup(l);}
});
test('failed independent check retains a reviewable patch and failure output',async()=>{
  const l=lab(),c=await connect(l);
  try{await c.call('commander_start_job',{...start(l),checks:[{name:'failure',argv:[process.execPath,'-e',"console.log('regression remains');process.exit(7)"]}]});
    const final=await terminal(c);assert.equal(final.state,'needs_attention');assert.equal(final.checks[0].exitCode,7);assert.match(final.checks[0].output,/regression remains/);assert.ok(final.patchBytes>0);
  }finally{await c.client.close();cleanup(l);}
});
test('cancellation stops the owned executor and preserves its partial patch',async()=>{
  const l=lab(),c=await connect(l);
  try{await c.call('commander_start_job',start(l,'WAIT'));
    const deadline=Date.now()+10000;
    while(!(await c.call('commander_job_status',{device:'local',jobId:'job'})).result.threadId){
      assert.ok(Date.now()<deadline,'fixture executor did not start');await new Promise(r=>setTimeout(r,50));
    }
    const requested=await c.call('commander_cancel_job',{device:'local',jobId:'job',callId:'cancel'});assert.equal(requested.result.cancellationRequested,true);
    const final=await terminal(c);assert.equal(final.state,'cancelled');assert.equal(final.checksPassed,false);assert.ok(final.changedFiles.includes('launch-count'));
  }finally{await c.client.close();cleanup(l);}
});
test('job time limit does not relaunch the partial executor',async()=>{
  const l=lab(),c=await connect(l);
  try{const args={...start(l,'WAIT'),timeoutMs:3000};await c.call('commander_start_job',args);
    const final=await terminal(c);assert.equal(final.state,'needs_attention');assert.match(final.reason,/time limit/);
    await c.call('commander_start_job',{...args,callId:'after-timeout'});assert.equal(fs.readFileSync(path.join(final.workspace,'launch-count'),'utf8'),'launch\n');
  }finally{await c.client.close();cleanup(l);}
});
test('API login cannot dispatch a job; no credential or provider fallback',async()=>{
  const l=lab();l.env.NAVISH_FIXTURE_LOGIN='api';const c=await connect(l);
  try{const result=await c.call('commander_start_job',start(l));assert.equal(result.state,'failed');assert.match(result.reason,/CHATGPT_CODEX_LOGIN_REQUIRED/);assert.equal(fs.existsSync(path.join(l.root,'state/agent-jobs/job/plan.json')),false);
  }finally{await c.client.close();cleanup(l);}
});
test('executor environment removes API/provider credentials',()=>{
  assert.deepEqual(jobEnvironment({HOME:'/home/example',PATH:'/bin',CODEX_HOME:'/codex',OPENAI_API_KEY:'x',CODEX_API_KEY:'x',AWS_PROFILE:'x',AWS_SECRET_ACCESS_KEY:'x',ANTHROPIC_AUTH_TOKEN:'x'}),{HOME:'/home/example',PATH:'/bin',CODEX_HOME:'/codex'});
});
