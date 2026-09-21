import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const server=path.resolve(process.env.NAVISH_MCP_SERVER||'src/server.mjs');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function lab(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-parity-')),cwd=path.join(root,'work');fs.mkdirSync(cwd);
  const env={...process.env,NAVISH_CONFIG_DIR:root+'/config',NAVISH_STATE_DIR:root+'/state',NAVISH_DATA_DIR:root+'/data'};
  let client;
  const connect=async()=>{client=new Client({name:'rdc-core-regression',version:'1'});const transport=new StdioClientTransport({command:process.execPath,args:[server],env,stderr:'pipe'});transport.stderr?.resume();await client.connect(transport);};
  await connect();
  return {root,cwd,env,call:async(name,args={})=>{const r=await client.callTool({name:'commander_'+name,arguments:{device:'local',...args}});return r.structuredContent??JSON.parse(r.content[0].text);},
    restart:async()=>{await client.close();await connect();},close:async()=>{await client.close();fs.rmSync(root,{recursive:true,force:true});}};
}
async function until(fn,predicate){for(let i=0;i<160;i++){const r=await fn();if(predicate(r))return r;await sleep(25);}throw Error('operation did not settle');}

test('chat file workflow: inspect, edit once, reject stale or ambiguous edits, move and read multiple files',async()=>{
  const l=await lab();try{
    const dir=l.cwd+'/src',file=dir+'/example.js';
    assert.equal((await l.call('create_directory',{callId:'mkdir',path:dir})).state,'completed');
    await l.call('write_file',{callId:'write',path:file,content:'const a = 1;\r\nconst b = 1;\r\n'});fs.chmodSync(file,0o751);
    const metadata=(await l.call('get_file_info',{path:file})).result;assert.equal(metadata.mode,0o751);assert.equal(metadata.lineCount,2);
    const ambiguity=await l.call('edit_block',{callId:'ambiguous',file_path:file,old_string:'1',new_string:'2'});
    assert.equal(ambiguity.state,'failed');assert.match(ambiguity.reason,/found 2/);
    const intent={callId:'edit-once',file_path:file,old_string:'const a = 1;',new_string:'const a = 2;',expectedSha256:metadata.sha256};
    assert.equal((await l.call('edit_block',intent)).result.replacements,1);
    await l.restart();assert.equal((await l.call('edit_block',intent)).state,'completed');
    assert.equal(fs.readFileSync(file,'utf8'),'const a = 2;\r\nconst b = 1;\r\n');assert.equal(fs.statSync(file).mode&0o777,0o751);
    const stale=await l.call('edit_block',{...intent,callId:'stale-edit',old_string:'const b = 1;'});assert.match(stale.reason,/SOURCE_CHANGED/);
    const listing=(await l.call('list_directory',{path:l.cwd,depth:2,maxEntries:1})).result;assert.equal(listing.entries.length,1);assert.equal(listing.truncated,true);
    const moved=dir+'/renamed.js';assert.equal((await l.call('move_file',{callId:'move',source:file,destination:moved})).state,'completed');
    const reads=(await l.call('read_multiple_files',{paths:[moved,file]})).result.files;
    assert.match(reads[0].content,/a = 2/);assert.match(reads[1].error,/ENOENT/);
    const config=(await l.call('get_config')).result;assert.equal(config.version,JSON.parse(fs.readFileSync(path.join(path.dirname(server),'../package.json'))).version);
    assert.ok((await l.call('get_recent_tool_calls')).result.calls.length>0);
  }finally{await l.close();}
});

test('chat search workflow: exact content, context, filtering, durable pagination and bounded results',async()=>{
  const l=await lab();try{
    fs.writeFileSync(l.cwd+'/a.js','before\nneedle A\nafter\n');fs.writeFileSync(l.cwd+'/b.js','needle B\n');
    fs.writeFileSync(l.cwd+'/.hidden.js','needle hidden\n');fs.writeFileSync(l.cwd+'/skip.txt','needle skipped\n');
    fs.symlinkSync(l.cwd+'/skip.txt',l.cwd+'/symlink.js');
    const intent={callId:'search-start',sessionId:'content',path:l.cwd,pattern:'needle',searchType:'content',filePattern:'*.js',literalSearch:true,contextLines:1};
    assert.equal((await l.call('start_search',intent)).state,'completed');
    await l.restart();
    const done=await until(()=>l.call('get_more_search_results',{sessionId:'content',length:1}),r=>r.result?.state==='completed');
    assert.equal(done.result.totalResults,2);assert.equal(done.result.results[0].line,2);assert.deepEqual(done.result.results[0].before,['before']);assert.deepEqual(done.result.results[0].after,['after']);
    const next=(await l.call('get_more_search_results',{sessionId:'content',offset:done.result.nextOffset})).result;
    assert.match(next.results[0].text,/needle B/);assert.equal(next.hasMore,false);
    const tail=(await l.call('get_more_search_results',{sessionId:'content',offset:-1})).result;assert.equal(tail.results.length,1);assert.match(tail.results[0].text,/needle B/);
    await l.call('start_search',{...intent,callId:'search-recover'});
    assert.equal(fs.readdirSync(l.env.NAVISH_STATE_DIR+'/sessions').length,1);
    const conflict=await l.call('start_search',{...intent,callId:'search-conflict',pattern:'changed'});assert.match(conflict.reason,/SEARCH_INTENT_CONFLICT/);
    const list=(await l.call('list_searches')).result.searches;assert.equal(list[0].sessionId,'content');
    await l.call('start_search',{callId:'files',sessionId:'files',path:l.cwd,pattern:'.js',literalSearch:true,includeHidden:true,maxResults:1});
    const cap=await until(()=>l.call('get_more_search_results',{sessionId:'files'}),r=>r.result?.state==='completed');
    assert.equal(cap.result.totalResults,1);assert.equal(cap.result.truncated,true);
  }finally{await l.close();}
});

test('search timeout and cancellation stop only owned scans and retain partial-result records',async()=>{
  const l=await lab();try{
    fs.writeFileSync(l.cwd+'/slow.txt','a'.repeat(2000)+'!');
    await l.call('start_search',{callId:'timeout',sessionId:'timeout',path:l.cwd,pattern:'(a+)+$',searchType:'content',timeout_ms:100});
    const timed=await until(()=>l.call('get_more_search_results',{sessionId:'timeout'}),r=>r.result?.state==='timed_out');assert.equal(timed.result.truncated,true);
    await l.call('start_search',{callId:'cancel',sessionId:'cancel',path:l.cwd,pattern:'(a+)+$',searchType:'content',timeout_ms:10000});
    const stopped=await l.call('stop_search',{callId:'stop',sessionId:'cancel'});assert.equal(stopped.result.state,'cancelled');
    await l.restart();assert.equal((await l.call('get_more_search_results',{sessionId:'cancel'})).result.state,'cancelled');
  }finally{await l.close();}
});

test('chat interactive process workflow: reconnect, exactly-once input and owned termination',async()=>{
  const l=await lab();try{
    const script="const fs=require('fs');require('readline').createInterface({input:process.stdin}).on('line',x=>{fs.appendFileSync('inputs',x+'\\n');console.log('received:'+x)});";
    await l.call('start_process',{callId:'repl',sessionId:'repl',cwd:l.cwd,transport:'pipe',command:quote(process.execPath)+' -e '+quote(script)});
    const input={callId:'input-once',sessionId:'repl',input:'hello',wait_ms:200};
    const response=await l.call('interact_with_process',input);assert.equal(response.result.ok,true);
    await l.restart();await l.call('interact_with_process',input);
    assert.equal(fs.readFileSync(l.cwd+'/inputs','utf8'),'hello\n');
    const sessions=(await l.call('list_sessions')).result.sessions;assert.equal(sessions[0].sessionId,'repl');assert.equal('command' in sessions[0],false);assert.equal('env' in sessions[0],false);
    const out=(await l.call('process_output',{sessionId:'repl'})).result;assert.match(out.output,/received:hello/);
    const stop=await l.call('force_terminate',{callId:'stop-repl',sessionId:'repl'});assert.equal(stop.result.terminated,true);assert.notEqual(stop.result.state,'running');
    assert.equal((await l.call('list_processes')).state,'completed');
  }finally{await l.close();}
});
