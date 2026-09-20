import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const server=path.resolve(process.env.NAVISH_MCP_SERVER||'src/server.mjs');
const cli=path.resolve(path.dirname(server),'../runtime/app/bin/navish.mjs');
function lab(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-retained-jobs-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const marker=path.join(root,'model-was-invoked'),fake=path.join(root,'codex');
  fs.writeFileSync(fake,'#!/bin/sh\nprintf invoked > "'+marker+'"\n',{mode:0o700});
  const env={...process.env,NAVISH_CONFIG_DIR:root+'/config',NAVISH_STATE_DIR:root+'/state',NAVISH_DATA_DIR:root+'/data',NAVISH_CODEX_EXECUTABLE:fake,PATH:root+path.delimiter+process.env.PATH};
  const write=(file,value)=>{file=path.join(root,file);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
  function retained(state='review_ready'){
    write('state/agent-jobs/old/plan.json',{jobId:'old',repository:root+'/repo',baseCommit:'a'.repeat(40),workspace:root+'/workspace',createdAt:'2026-09-20T00:00:00Z',sessionId:'job-old',owner:{pid:-1}});
    write('state/agent-jobs/old/status.json',{state,checksPassed:true,changedFiles:['README.md']});
    write('state/agent-jobs/old/changes.patch','retained patch\n');
    write('state/sessions/job-old/meta.json',{sessionId:'job-old',state:state==='running'?'running':'completed',...(state==='running'?{pid:process.pid}:{exitCode:0})});
  }
  return {root,env,write,retained,marker};
}
async function connect(t,l){
  const client=new Client({name:'retained-job-test',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[server],env:l.env,stderr:'pipe'});transport.stderr?.resume();await client.connect(transport);
  t.after(()=>client.close());return client;
}
test('MCP exposes direct execution and retained records but no model-job launch',async t=>{
  const l=lab(t),c=await connect(t,l),names=(await c.listTools()).tools.map(x=>x.name);
  assert.ok(names.includes('commander_start_process'));assert.ok(names.includes('commander_start_batch'));assert.ok(names.includes('commander_jobs'));
  assert.ok(!names.includes('commander_start_job'));
  const r=await c.callTool({name:'commander_start_job',arguments:{device:'local',callId:'stale',jobId:'new'}});
  assert.equal(r.isError,true);assert.match(JSON.stringify(r),/not found|unknown tool/i);assert.equal(fs.existsSync(l.marker),false);
  assert.equal(fs.existsSync(path.join(l.root,'state/agent-jobs/new/plan.json')),false);
});
test('stale runtime job-start requests fail without model discovery or dispatch',t=>{
  const l=lab(t);const r=spawnSync(process.execPath,[cli,'call','local','agent_job_start','{}','--call-id','stale','--json'],{env:l.env,encoding:'utf8',timeout:10000});
  assert.equal(r.status,2,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.state,'failed');assert.match(result.reason,/CODEX_EXECUTION_REMOVED/);
  assert.equal(fs.existsSync(l.marker),false);assert.equal(fs.existsSync(path.join(l.root,'data/agent-jobs')),false);
});
test('retained job results and patches remain available after removing the executor',async t=>{
  const l=lab(t);l.retained();const c=await connect(t,l);
  const status=(await c.callTool({name:'commander_job_status',arguments:{device:'local',jobId:'old',includePatch:true}})).structuredContent.result;
  assert.equal(status.state,'review_ready');assert.equal(status.patch.output,'retained patch\n');assert.equal(status.integration.applied,null);
  const list=(await c.callTool({name:'commander_jobs',arguments:{device:'local'}})).structuredContent.result;
  assert.equal(list.jobs[0].jobId,'old');assert.equal(fs.existsSync(l.marker),false);
});
test('cancellation can still request stopping a retained job without launching a model',async t=>{
  const l=lab(t);l.retained('running');const c=await connect(t,l);
  const r=(await c.callTool({name:'commander_cancel_job',arguments:{device:'local',jobId:'old',callId:'cancel-old'}})).structuredContent;
  assert.equal(r.result.cancellationRequested,true);assert.ok(fs.existsSync(path.join(l.root,'state/agent-jobs/old/cancel.json')));assert.equal(fs.existsSync(l.marker),false);
});
