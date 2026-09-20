import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cli=fileURLToPath(new URL('../runtime/app/bin/navish.mjs',import.meta.url));
function lab(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-job-cli-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(name,value)=>{
    const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value)+'\n');
  };
  for(const dir of ['state/sessions','state/control-receipts','data/control'])fs.mkdirSync(path.join(root,dir),{recursive:true});
  write('config/config.json',{version:1,allowedDirectories:[],browserCommand:null,outputLimitBytes:1048576});
  write('config/devices.json',{version:1,devices:{}});
  write('state/uncertain-resources.json',{version:1,resources:{}});
  // Existing uncertainty and receipts are evidence, even on read failures.
  write('state/receipts/retained.json',{callId:'retained',state:'uncertain',mutating:true});
  const env={PATH:path.dirname(process.execPath),TMPDIR:root,
    NAVISH_CONFIG_DIR:path.join(root,'config'),NAVISH_STATE_DIR:path.join(root,'state'),NAVISH_DATA_DIR:path.join(root,'data'),
    NAVISH_CODEX_EXECUTABLE:path.join(root,'codex-must-not-run')};
  function run(args,exitCode=0){
    const r=spawnSync(process.execPath,[cli,...args],{cwd:root,env,encoding:'utf8',timeout:10000});
    assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status,exitCode,r.stderr||r.stdout);
    return r;
  }
  function observe(args,exitCode=0){
    const r=JSON.parse(run(args,exitCode).stdout);
    assert.equal(r.observation,true);assert.equal(r.receiptPersisted,false);assert.equal(r.auditRecorded,true);
    assert.equal(r.state,exitCode===0?'completed':'failed');assert.equal('callId' in r,false);
    return r;
  }
  function job(id,{createdAt='2026-09-20T12:00:00.000Z',state='review_ready',patch,processState='completed',...status}={}){
    const dir='state/agent-jobs/'+id,sessionId='job-'+id;
    write(dir+'/plan.json',{version:1,jobId:id,repository:path.join(root,'repo'),workspace:path.join(root,'data/agent-jobs',id,'workspace'),
      baseCommit:'a'.repeat(40),createdAt,sessionId,owner:{pid:-1},goal:'Synthetic job; never execute',checks:[]});
    write(dir+'/status.json',{state,...status});
    write('state/sessions/'+sessionId+'/meta.json',{sessionId,state:processState,...(processState==='running'?{pid:process.pid}:{exitCode:0})});
    if(patch!==undefined)write(dir+'/changes.patch',patch);
    return dir;
  }
  // Include file bytes and directories so a launch, cancellation, receipt or
  // checkout cannot hide behind an otherwise successful observation response.
  function snapshot(){
    const entries=[];
    function walk(dir){for(const name of fs.readdirSync(path.join(root,dir)).sort()){
      const relative=path.join(dir,name);if(relative===path.join('state','audit.jsonl'))continue;
      if(fs.statSync(path.join(root,relative)).isDirectory()){entries.push([relative,'directory']);walk(relative);}
      else entries.push([relative,fs.readFileSync(path.join(root,relative)).toString('base64')]);
    }}
    walk('');return entries;
  }
  function unchanged(before){
    assert.deepEqual(snapshot(),before);
    const audit=path.join(root,'state/audit.jsonl');
    if(fs.existsSync(audit))for(const event of fs.readFileSync(audit,'utf8').trim().split('\n').map(JSON.parse)){
      assert.equal(event.event,'observation-finished');assert.ok(['agent_job_list','agent_job_status'].includes(event.tool));
    }
  }
  return {root,write,run,observe,job,snapshot,unchanged};
}

test('empty listing and unknown IDs are repeatable observations without job submission',t=>{
  const l=lab(t),before=l.snapshot();
  for(let i=0;i<2;i++){
    assert.deepEqual(l.observe(['jobs']).result,{state:'completed',jobs:[]});
    assert.deepEqual(l.observe(['job','missing','--patch']).result,{jobId:'missing',state:'unsubmitted',retrySafe:false});
  }
  l.unchanged(before);
});

test('jobs lists newest first with default, explicit and maximum limits',t=>{
  const l=lab(t);
  for(let i=0;i<55;i++)l.job('job-'+i,{createdAt:new Date(Date.UTC(2026,8,20,0,i)).toISOString()});
  const before=l.snapshot();
  for(const limit of [undefined,1,3,50]){
    const jobs=l.observe(limit===undefined?['jobs']:['jobs','--limit',String(limit)]).result.jobs;
    assert.deepEqual(jobs.map(j=>j.jobId),Array.from({length:limit??10},(_,i)=>'job-'+(54-i)));
    assert.ok(jobs.every(j=>j.state==='review_ready'&&j.retrySafe===false&&!('patch' in j)));
  }
  l.unchanged(before);
  l.job('newest',{createdAt:'2026-09-21T00:00:00.000Z'});
  const updated=l.snapshot();
  assert.equal(l.observe(['jobs','--limit','1']).result.jobs[0].jobId,'newest');
  l.unchanged(updated);
});

test('status reads fresh lifecycle evidence and preserves job outcomes independently of CLI success',t=>{
  const l=lab(t);
  for(const state of ['launching','running','review_ready','needs_attention','cancelled','uncertain']){
    const dir=l.job('status',{state,processState:state==='running'?'running':state==='launching'?'launching':'completed',
      reason:'Retained evidence',checks:[{name:'synthetic check',exitCode:7}]});
    l.write(dir+'/executor.log','Retained executor output\n');
    const before=l.snapshot(),r=l.observe(['job','status']).result;
    assert.equal(r.jobId,'status');assert.equal(r.state,state);assert.equal(r.reason,'Retained evidence');
    assert.equal(r.baseCommit,'a'.repeat(40));assert.equal(r.workspace,path.join(l.root,'data/agent-jobs/status/workspace'));
    assert.deepEqual(r.checks,[{name:'synthetic check',exitCode:7}]);
    assert.equal(r.retrySafe,false);assert.equal(r.goalVerified,false);assert.equal('patch' in r,false);
    l.unchanged(before);
  }
});

test('patch reads are opt-in and bounded with continuation metadata',t=>{
  const l=lab(t),patch='diff --git a/file b/file\n'+'+synthetic change\n'.repeat(3000);
  l.job('large',{patch});l.job('small',{patch:'small patch\n'});l.job('no-patch');
  l.job('running',{state:'running',processState:'running',patch:'unfinished patch'});
  const before=l.snapshot();
  assert.equal('patch' in l.observe(['job','large']).result,false);
  for(let i=0;i<2;i++)assert.deepEqual(l.observe(['job','large','--patch']).result.patch,{
    output:patch.slice(0,16384),offset:0,nextOffset:16384,totalBytes:Buffer.byteLength(patch),truncated:true,
  });
  assert.deepEqual(l.observe(['job','small','--patch']).result.patch,{output:'small patch\n',offset:0,nextOffset:12,totalBytes:12,truncated:false});
  assert.deepEqual(l.observe(['job','no-patch','--patch']).result.patch,{output:'',offset:0,nextOffset:0,totalBytes:0,truncated:false});
  assert.equal('patch' in l.observe(['job','running','--patch']).result,false);
  l.unchanged(before);
});

test('missing terminal evidence stays uncertain without rewriting or replaying launch claims',t=>{
  const l=lab(t),dir=l.job('lost',{state:'running',patch:'partial changes\n'});
  fs.rmSync(path.join(l.root,'state/sessions/job-lost/meta.json'));
  l.write('state/sessions/job-lost/launch.json',{sessionId:'job-lost',owner:{pid:-1},state:'launching'});
  const before=l.snapshot();
  for(let i=0;i<2;i++){
    const status=l.observe(['job','lost','--patch']).result;
    assert.equal(status.state,'uncertain');assert.equal(status.retrySafe,false);
    assert.match(status.reason,/will not relaunch/);assert.equal(status.patch.output,'partial changes\n');
    assert.equal(l.observe(['jobs']).result.jobs[0].state,'uncertain');
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(l.root,dir,'status.json'))).state,'running');
  l.unchanged(before);
});

test('invalid limits, IDs, flags and extra arguments fail before observation',t=>{
  const l=lab(t),before=l.snapshot();
  const invalid=[
    ['jobs','--limit'],...['','0','-1','51','1.5','1e1','0x10','NaN','Infinity','2junk',' 2','9007199254740993'].map(n=>['jobs','--limit',n]),
    ['jobs','--limit','2','--limit','3'],['jobs','--limit=2'],['jobs','--patch'],['jobs','--unknown'],['jobs','extra'],
    ['job'],['job',''],['job','--patch'],['job','--unknown'],['job','id','--unknown'],['job','id','extra'],
    ['job','id','--patch','--patch'],['job','id','--limit','2'],['job','../escape'],['job','.'],['job','..'],['job','a'.repeat(101)],
  ];
  for(const args of invalid){
    const r=l.run(args,1);assert.equal(r.stdout,'');assert.match(r.stderr,/Navish Commander: /);
  }
  assert.equal(fs.existsSync(path.join(l.root,'state/audit.jsonl')),false);
  l.unchanged(before);
});

test('damaged durable records report observation failure and retain all evidence',t=>{
  const l=lab(t),dir=l.job('damaged');l.write(dir+'/status.json','{incomplete JSON');
  const before=l.snapshot();
  for(const args of [['jobs'],['job','damaged'],['job','damaged','--patch']]){
    const r=l.observe(args,2);assert.equal(r.result,null);assert.equal(typeof r.reason,'string');assert.ok(r.reason);
  }
  l.unchanged(before);
});

test('help and existing read commands retain their interfaces',t=>{
  const l=lab(t),help=l.run(['--help']).stdout;
  for(const usage of ['navish jobs [--limit N]','navish job JOB_ID [--patch]','navish call <device> <tool>',
    'navish devices','navish tools','navish pair add','navish pair remove','navish reconcile','navish config get',
    'navish config set','navish doctor','navish selftest','navish github-control'])assert.ok(help.includes(usage),usage);
  assert.ok(JSON.parse(l.run(['tools']).stdout).tools.includes('agent_job_status'));
  assert.ok(Array.isArray(JSON.parse(l.run(['devices']).stdout).devices));
  assert.equal(JSON.parse(l.run(['config','get']).stdout).version,1);
  l.write('read-me.txt','existing command\n');
  const receipt=JSON.parse(l.run(['call','local','read_file',JSON.stringify({path:path.join(l.root,'read-me.txt')}),'--call-id','legacy-read','--compact','--json']).stdout);
  assert.equal(receipt.state,'completed');assert.equal(receipt.callId,'legacy-read');assert.equal(receipt.mutating,false);
  assert.equal(receipt.result.content,'existing command\n');
});
