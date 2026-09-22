import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const agent=path.resolve(process.env.NAVISH_AGENT||'connector/agent.mjs');
const realServer=path.resolve('src/server.mjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const events=text=>text.split('\n').filter(Boolean).flatMap(l=>{try{return [JSON.parse(l)]}catch{return []}});

// The local server is started as a stdio child. A start that is slow, or fails
// the first few times, used to reject at module scope and kill the agent: the
// channel connection and any in-flight job died with it.
test('agent retries a failing local server instead of exiting, then proceeds once it starts',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-agent-resilience-'));
  const counter=path.join(root,'attempts');
  const fake=path.join(root,'flaky-server.mjs');
  fs.writeFileSync(fake,`
import fs from 'node:fs';
const n=(fs.existsSync(${JSON.stringify(counter)})?Number(fs.readFileSync(${JSON.stringify(counter)},'utf8')):0)+1;
fs.writeFileSync(${JSON.stringify(counter)},String(n));
if(n<3)process.exit(1);
await import(${JSON.stringify(realServer)});
`);
  const configPath=path.join(root,'agent.json');
  fs.writeFileSync(configPath,JSON.stringify({origin:'https://relay.invalid',agentToken:'t'.repeat(64),
    stateDir:path.join(root,'state'),server:fake}));

  const child=spawn(process.execPath,[agent,configPath],{stdio:['ignore','pipe','pipe'],
    env:{...process.env,NAVISH_CONFIG_DIR:root+'/config',NAVISH_STATE_DIR:root+'/nstate',NAVISH_DATA_DIR:root+'/data'}});
  let err='';child.stderr.on('data',d=>{err+=d});
  let exited=null;child.on('exit',code=>{exited=code});

  try{
    const attempts=()=>{try{return Number(fs.readFileSync(counter,'utf8').trim())||0}catch{return 0}};
    for(let i=0;i<80&&attempts()<3;i++)await delay(100);
    await delay(1500);

    assert.equal(exited,null,`agent exited with ${exited}; stderr:\n${err}`);
    const retries=events(err).filter(e=>e.event==='local-server-unavailable');
    assert.ok(retries.length>=2,`expected retry diagnostics, got:\n${err}`);
    assert.ok(retries[1].retryInMs>retries[0].retryInMs,'retries must back off');
    // Getting past connect is the point: it only reaches the relay once the
    // local server is up.
    assert.ok(events(err).some(e=>e.event==='relay-unavailable'),`agent never reached the relay loop:\n${err}`);
  }finally{
    child.kill('SIGKILL');
    await new Promise(r=>child.on('exit',r)).catch(()=>{});
    fs.rmSync(root,{recursive:true,force:true});
  }
});
