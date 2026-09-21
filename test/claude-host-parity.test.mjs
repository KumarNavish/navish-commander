import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {plainNodeExecutable,blockedCommand,DEFAULT_BLOCKED_COMMANDS} from '../runtime/app/src/process.mjs';
import {normalizeBrowserJob} from '../runtime/app/src/browser-jobs.mjs';
import {quarantine} from '../runtime/app/src/receipts.mjs';
import {paths,ensureBase} from '../runtime/app/src/config.mjs';

const server=path.resolve(process.env.NAVISH_MCP_SERVER||'src/server.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function lab({command=process.execPath,env:extra={}}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-host-')),cwd=path.join(root,'work');fs.mkdirSync(cwd);
  const env={...process.env,NAVISH_CONFIG_DIR:root+'/config',NAVISH_STATE_DIR:root+'/state',NAVISH_DATA_DIR:root+'/data',...extra};
  let client;
  const connect=async()=>{client=new Client({name:'claude-host-parity',version:'1'});const transport=new StdioClientTransport({command,args:[server],env,stderr:'pipe'});transport.stderr?.resume();await client.connect(transport);};
  await connect();
  return {root,cwd,env,
    call:async(name,args={})=>{const r=await client.callTool({name:'commander_'+name,arguments:name==='devices'?args:{device:'local',...args}});return {...(r.structuredContent??JSON.parse(r.content[0].text)),isError:r.isError===true};},
    restart:async()=>{await client.close();await connect();},close:async()=>{await client.close();fs.rmSync(root,{recursive:true,force:true});}};
}
async function until(fn,predicate){for(let i=0;i<200;i++){const r=await fn();if(predicate(r))return r;await sleep(25);}throw Error('operation did not settle');}
/** This Node binary under an application name, as an Electron utility process reports execPath. */
function hostBinary(root){
  const dir=path.join(root,'host');fs.mkdirSync(dir);const bin=path.join(dir,'Claude');
  try{fs.linkSync(process.execPath,bin);}catch{fs.copyFileSync(process.execPath,bin);fs.chmodSync(bin,0o755);}
  return bin;
}

test('host detection, command policy parsing and browser expectedUrl defaults',()=>{
  assert.equal(plainNodeExecutable('/usr/local/bin/node',{}),true);
  assert.equal(plainNodeExecutable('/opt/homebrew/Cellar/node/26.8.2/bin/node26',{}),true);
  assert.equal(plainNodeExecutable('/Applications/Claude.app/Contents/MacOS/Claude',{}),false);
  assert.equal(plainNodeExecutable('/usr/local/bin/node',{electron:'39.0.0'}),false);
  assert.equal(blockedCommand('echo hi; env FOO=1 sudo id',DEFAULT_BLOCKED_COMMANDS),'sudo');
  assert.equal(blockedCommand('ls | /sbin/reboot',DEFAULT_BLOCKED_COMMANDS),'reboot');
  assert.equal(blockedCommand('echo sudo is a word',DEFAULT_BLOCKED_COMMANDS),null);
  assert.equal(blockedCommand('sudo id',[]),null);
  const plan=normalizeBrowserJob({sessionId:'s',phaseId:'p',goal:'read heading',allowedOrigins:['https://example.com'],allowedMutations:['open'],
    workflow:{steps:[{action:'open',url:'https://example.com/'},{action:'extract',selector:'h1'}],final:{selector:'h1',text:'Example Domain'}}});
  assert.equal(plan.steps[1].expectedUrl,'https://example.com/');
  assert.throws(()=>normalizeBrowserJob({sessionId:'s',phaseId:'p',goal:'x',allowedOrigins:['https://example.com'],allowedMutations:[],
    workflow:{steps:[{action:'extract',selector:'h1'}],final:{selector:'h1'}}}),/BROWSER_EXPECTED_URL_REQUIRED/);
});

test('Electron-style host: pipe workers and search use a real Node executable, not execPath',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-host-bin-'));
  const bin=hostBinary(root);
  const l=await lab({command:bin});
  try{
    const devices=await l.call('devices');
    assert.equal(devices.processRuntime.nodeAvailable,true);assert.notEqual(devices.processRuntime.nodeExecutable,bin);
    const started=await l.call('start_process',{callId:'pipe-host',sessionId:'pipe-host',cwd:l.cwd,transport:'pipe',command:'echo hi-from-pipe; exit 3',timeout_ms:5000});
    assert.equal(started.state,'completed');assert.equal(started.operationState,'failed');assert.equal(started.result.exitCode,3);assert.match(started.result.output,/hi-from-pipe/);
    fs.writeFileSync(l.cwd+'/needle.txt','find me\n');
    await l.call('start_search',{callId:'search-host',sessionId:'search-host',path:l.cwd,pattern:'find me',searchType:'content',literalSearch:true});
    const done=await until(()=>l.call('get_more_search_results',{sessionId:'search-host'}),r=>r.result?.state==='completed');
    assert.equal(done.result.totalResults,1);
  }finally{await l.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('an unusable NAVISH_NODE fails before any launch claim and keeps the session identity reusable',async()=>{
  const l=await lab({env:{NAVISH_NODE:'/nonexistent/node'}});
  try{
    const failed=await l.call('start_process',{callId:'pipe-nonode',sessionId:'pipe-reuse',cwd:l.cwd,transport:'pipe',command:'echo never'});
    assert.equal(failed.state,'failed');assert.match(failed.reason,/PROCESS_NODE_UNAVAILABLE/);
    assert.equal(fs.existsSync(l.env.NAVISH_STATE_DIR+'/sessions/pipe-reuse'),false);
    const search=await l.call('start_search',{callId:'search-nonode',sessionId:'search-nonode',path:l.cwd,pattern:'x'});
    assert.equal(search.state,'failed');assert.match(search.reason,/SEARCH_NODE_UNAVAILABLE/);
    delete l.env.NAVISH_NODE;await l.restart();
    const ok=await l.call('start_process',{callId:'pipe-fixed',sessionId:'pipe-reuse',cwd:l.cwd,transport:'pipe',command:'echo now',timeout_ms:5000});
    assert.equal(ok.operationState,'completed');assert.match(ok.result.output,/now/);
  }finally{await l.close();}
});

test('blocked commands are refused before any claim; the list and the default shell are configurable',async()=>{
  const l=await lab();
  try{
    assert.deepEqual((await l.call('get_config')).result.processPolicy.blockedCommands,[...DEFAULT_BLOCKED_COMMANDS]);
    const blocked=await l.call('start_process',{callId:'blocked',sessionId:'blocked',cwd:l.cwd,transport:'pipe',command:'echo ok && sudo -n true'});
    assert.equal(blocked.state,'failed');assert.match(blocked.reason,/COMMAND_BLOCKED: sudo/);
    assert.equal(fs.existsSync(l.env.NAVISH_STATE_DIR+'/sessions/blocked'),false);
    const batch=await l.call('start_batch',{callId:'blocked-batch',batchId:'blocked-batch',workers:[{id:'w',role:'r',cwd:l.cwd,transport:'pipe',command:'env FOO=1 /usr/bin/sudo id'}]});
    assert.equal(batch.state,'failed');assert.match(batch.reason,/COMMAND_BLOCKED: worker w/);
    assert.equal(fs.existsSync(l.env.NAVISH_STATE_DIR+'/agent-batches/blocked-batch.json'),false);
    assert.equal((await l.call('set_config_value',{callId:'block-echo',key:'blockedCommands',value:['echo']})).state,'completed');
    assert.match((await l.call('start_process',{callId:'echo-blocked',sessionId:'echo-blocked',cwd:l.cwd,transport:'pipe',command:'echo hi'})).reason,/COMMAND_BLOCKED: echo/);
    assert.equal((await l.call('set_config_value',{callId:'unblock',key:'blockedCommands',value:[]})).state,'completed');
    assert.equal((await l.call('start_process',{callId:'echo-ok',sessionId:'echo-ok',cwd:l.cwd,transport:'pipe',command:'echo hi',timeout_ms:5000})).operationState,'completed');
    assert.equal((await l.call('set_config_value',{callId:'bad-shell',key:'defaultShell',value:'/nonexistent/sh'})).state,'failed');
    assert.equal((await l.call('set_config_value',{callId:'sh',key:'defaultShell',value:'/bin/sh'})).state,'completed');
    assert.equal((await l.call('get_config')).result.processPolicy.defaultShell,'/bin/sh');
    const shell=await l.call('start_process',{callId:'which-shell',sessionId:'which-shell',cwd:l.cwd,transport:'pipe',command:'echo $0',timeout_ms:5000});
    assert.match(shell.result.output.trim().split('\n').at(-1),/^(\/bin\/)?sh$/);
  }finally{await l.close();}
});

test('output reads can wait for new data, sessions list newest first, and termination is not an error',async()=>{
  const l=await lab();
  try{
    const first=await l.call('start_process',{callId:'slow',sessionId:'slow',cwd:l.cwd,transport:'pipe',command:'sleep 0.4; echo late; sleep 5',timeout_ms:10});
    assert.equal(first.operationState,'running');
    const t=Date.now();
    const waited=await l.call('process_output',{sessionId:'slow',wait_ms:5000});
    assert.match(waited.result.output,/late/);assert.ok(Date.now()-t<4000,'wait returned as soon as output arrived');
    await sleep(30);
    await l.call('start_process',{callId:'quick',sessionId:'quick',cwd:l.cwd,transport:'pipe',command:'echo quick',timeout_ms:5000});
    const sessions=(await l.call('list_sessions',{limit:1})).result;
    assert.equal(sessions.total,2);assert.equal(sessions.sessions.length,1);assert.equal(sessions.sessions[0].sessionId,'quick');
    const stop=await l.call('force_terminate',{callId:'stop-slow',sessionId:'slow'});
    assert.equal(stop.isError,false);assert.equal(stop.operationState,'terminated');assert.equal(stop.result.terminated,true);
    const inline=await l.call('start_process',{callId:'inline',sessionId:'inline',cwd:l.cwd,transport:'pipe',command:'sleep 1.5; echo done',timeout_ms:4000});
    assert.equal(inline.operationState,'completed');assert.match(inline.result.output,/done/);
  }finally{await l.close();}
});

test('multi-file reads page to 64 KiB, failed edits explain the nearest text, line counts match wc, and quarantine can be reconciled',async()=>{
  const l=await lab();
  try{
    const big=l.cwd+'/big.txt';fs.writeFileSync(big,'x'.repeat(20000)+'\nend\n');
    const files=(await l.call('read_multiple_files',{paths:[big],maxBytes:65536})).result.files;
    assert.equal(files[0].truncated,false);assert.equal(files[0].content.length,20005);
    const info=(await l.call('get_file_info',{path:big})).result;assert.equal(info.lineCount,2);assert.equal(info.lastLine,1);assert.equal(info.appendPosition,2);
    const code=l.cwd+'/code.py';fs.writeFileSync(code,'def add(a, b):\n    return a - b  # BUG\n');
    const whitespace=await l.call('edit_block',{callId:'ws',file_path:code,old_string:'\treturn a - b  # BUG',new_string:'return a + b'});
    assert.equal(whitespace.state,'failed');assert.match(whitespace.reason,/differs only in whitespace or indentation/);assert.match(whitespace.reason,/    return a - b  # BUG/);
    const typo=await l.call('edit_block',{callId:'typo',file_path:code,old_string:'    return a - c  # BUG',new_string:'    return a + b'});
    assert.match(typo.reason,/Closest match at line 2/);assert.match(typo.reason,/\{-c-\}\{\+b\+\}/);
    assert.equal(fs.readFileSync(code,'utf8'),'def add(a, b):\n    return a - b  # BUG\n');
    const P=ensureBase(paths({...process.env,NAVISH_CONFIG_DIR:l.env.NAVISH_CONFIG_DIR,NAVISH_STATE_DIR:l.env.NAVISH_STATE_DIR,NAVISH_DATA_DIR:l.env.NAVISH_DATA_DIR}));
    quarantine(['fs:'+l.cwd+'/report.xlsx'],{callId:'dead-write',reason:'execution owner is no longer live'},P);
    const worker={id:'w',role:'r',cwd:l.cwd,transport:'pipe',command:'echo q'};
    const blocked=await l.call('start_batch',{callId:'blocked-by-quarantine',batchId:'q1',workers:[worker]});
    assert.equal(blocked.code,'RESOURCE_QUARANTINED');
    const released=await l.call('reconcile',{callId:'dead-write',verified:true});
    assert.equal(released.isError,false);assert.equal(released.result.changed,true);
    const ok=await l.call('start_batch',{callId:'after-reconcile',batchId:'q2',workers:[worker],wait_ms:1000});
    assert.equal(ok.state,'completed');
    const ping=await l.call('ping');assert.equal(ping.result.pong,true);
    const recent=(await l.call('get_recent_tool_calls',{includeArguments:true,maxResults:50})).result;
    assert.ok(recent.calls.length>0);assert.ok(recent.details.some(d=>d.tool==='commander_ping'));
    assert.ok(recent.details.some(d=>d.tool==='commander_reconcile'&&d.arguments.includes('dead-write')));
    assert.equal('details' in (await l.call('get_recent_tool_calls')).result,false);
  }finally{await l.close();}
});
