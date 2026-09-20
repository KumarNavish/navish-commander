import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {paths,ensureBase} from '../runtime/app/src/config.mjs';
import {startProcessTool,readProcessOutputTool,interactProcessTool,terminateProcessTool} from '../runtime/app/src/process.mjs';
import {agentBatchStartTool,agentBatchCollectTool} from '../runtime/app/src/agents.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const setup=()=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'navish-pipe-'));return {home,P:ensureBase(paths({HOME:home}))};};
async function done(sessionId,P){
  const deadline=Date.now()+5000;let current;
  do{current=readProcessOutputTool({sessionId,maxBytes:1048576},P);if(['completed','failed'].includes(current.state))return current;await pause(20);}while(Date.now()<deadline);
  throw Error('pipe worker failed to reach a terminal state');
}
test('pipe worker captures both streams, nonzero exit, and rejects changed identity',async()=>{
  const {home,P}=setup(),args={sessionId:'streams',transport:'pipe',cwd:home,command:'printf out; printf err >&2; exit 7',timeout_ms:0};
  await startProcessTool(args,P);const observed=await done(args.sessionId,P);
  assert.equal(observed.state,'failed');assert.equal(observed.exitCode,7);
  assert.match(observed.output,/out/);assert.match(observed.output,/err/);
  const repeated=await startProcessTool(args,P);assert.equal(repeated.reused,true);assert.equal(repeated.pid,observed.pid);
  await assert.rejects(startProcessTool({...args,transport:'pty'},P),{code:'PROCESS_SESSION_CONFLICT'});
});
test('pipe worker drains large output before publishing completion',async()=>{
  const {home,P}=setup();
  const command=`'${process.execPath}' -e 'process.stdout.write("x".repeat(262144));process.stderr.write("END")'`;
  await startProcessTool({sessionId:'large',transport:'pipe',cwd:home,command,timeout_ms:0},P);
  const observed=await done('large',P);
  assert.equal(observed.state,'completed');assert.equal(observed.totalBytes,262147);
  const first=readProcessOutputTool({sessionId:'large',offset:0,maxBytes:262147},P);
  assert.equal(first.output.replace('END',''),'x'.repeat(262144));
});
test('pipe input survives caller return and owned cancellation publishes failure',async()=>{
  const {home,P}=setup();
  await startProcessTool({sessionId:'input',transport:'pipe',cwd:home,command:'read answer; printf "received:%s" "$answer"; sleep 30',timeout_ms:0},P);
  const response=await interactProcessTool({sessionId:'input',input:'fixture',wait_ms:150},P);
  assert.match(response.output,/received:fixture/);
  await terminateProcessTool({sessionId:'input'},P);
  const observed=await done('input',P);assert.equal(observed.state,'failed');assert.notEqual(observed.exitCode,0);
});
test('mixed pipe and PTY batches retain exact effects on repeated launch',async()=>{
  const {home,P}=setup();
  const workers=['pipe','pty'].map(transport=>({id:transport,transport,cwd:home,command:`printf once >> ${transport}-effect`,startTimeoutMs:0}));
  await agentBatchStartTool({batchId:'mixed',workers},P);
  assert.equal((await agentBatchCollectTool({batchId:'mixed',wait_ms:5000},P)).state,'completed');
  assert.equal((await agentBatchStartTool({batchId:'mixed',workers},P)).reused,true);
  for(const transport of ['pipe','pty'])assert.equal(fs.readFileSync(path.join(home,transport+'-effect'),'utf8'),'once');
});
test('lost supervisor acknowledgement never falls back to signalling a stale PID',async()=>{
  const {home,P}=setup();
  const innocent=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  await new Promise(resolve=>innocent.once('spawn',resolve));
  try{
    const dir=path.join(P.sessionsDir,'stale');fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify({sessionId:'stale',pid:innocent.pid,state:'running',
      outputFile:home+'/absent-log',controlDir:dir+'/control',ackDir:dir+'/acks'}));
    await assert.rejects(terminateProcessTool({sessionId:'stale'},P),{code:'PROCESS_TERMINATION_UNCERTAIN',uncertain:true});
    assert.equal(innocent.exitCode,null);assert.equal(innocent.signalCode,null);
    assert.doesNotThrow(()=>process.kill(innocent.pid,0));
  }finally{const closed=new Promise(resolve=>innocent.once('close',resolve));innocent.kill();await closed;}
});
