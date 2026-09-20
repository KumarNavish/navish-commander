import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const server=path.resolve(process.env.NAVISH_MCP_SERVER||'src/server.mjs');
function workspace(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-mcp-'));return {root,env:{...process.env,NAVISH_CONFIG_DIR:root+'/config',NAVISH_STATE_DIR:root+'/state',NAVISH_DATA_DIR:root+'/data'}};}
async function connect(lab){
  const client=new Client({name:'release-test',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[server],env:lab.env,stderr:'pipe'});
  transport.stderr?.resume();await client.connect(transport);
  return {client,call:async(name,args)=>{const r=await client.callTool({name,arguments:args});return r.structuredContent??JSON.parse(r.content[0].text);}};
}
test('MCP handshake, exact device discovery, strict schema, and replay-safe file write',async()=>{
  const lab=workspace(),c=await connect(lab);
  try {
    assert.ok((await c.call('commander_devices',{})).devices.some(d=>d.id==='local'));
    const list=await c.client.listTools();assert.equal(list.tools.length,33);
    assert.equal(list.tools.find(x=>x.name==='commander_write_file').annotations.destructiveHint,true);
    const args={device:'local',callId:'write-once',path:lab.root+'/effect',content:'once',mode:'append'};
    assert.equal((await c.call('commander_write_file',args)).state,'completed');
    assert.equal((await c.call('commander_write_file',args)).state,'completed');
    assert.equal(fs.readFileSync(args.path,'utf8'),'once');
    const conflict=await c.call('commander_write_file',{...args,content:'twice'});assert.equal(conflict.state,'failed');
    const bad=await c.client.callTool({name:'commander_start_process',arguments:{device:'local',callId:'bad',command:'false'}});
    assert.equal(bad.isError,true);
    const unsafe=await c.call('commander_browser_workflow',{device:'local',callId:'invalid-browser',sessionId:'invalid-browser',phaseId:'main',goal:'Invalid plan must not dispatch',allowedOrigins:['https://example.com'],allowedMutations:[],workflow:{steps:[{action:'open',url:'https://example.com'}],final:{url:'https://example.com'}}});
    assert.equal(unsafe.state,'failed');assert.match(unsafe.reason,/MUTATION_NOT_ALLOWED/);
  }finally{await c.client.close();fs.rmSync(lab.root,{recursive:true,force:true});}
});
test('MCP restart preserves multi-worker identities, outputs, and artifact verification',async()=>{
  const lab=workspace();let c=await connect(lab);
  const workers=['a','b','c','d'].map(id=>{
    const cwd=path.join(lab.root,id);fs.mkdirSync(cwd);
    return {id,role:'file checksum worker',transport:'pipe',cwd,command:`sleep .3; printf '${id}' > result`,artifacts:[{path:'result',sha256:crypto.createHash('sha256').update(id).digest('hex')}]};
  });
  try{
    const args={device:'local',callId:'batch-launch',batchId:'batch',workers};
    const start=await c.call('commander_start_batch',args);assert.equal(start.state,'completed');
    await c.client.close();c=await connect(lab);
    const done=await c.call('commander_collect_batch',{device:'local',batchId:'batch',wait_ms:10000});
    assert.equal(done.operationState,'completed');assert.equal(done.result.counts.completed,4);
    for(const w of done.result.workers){assert.equal(w.exitCode,0);assert.equal(w.artifacts[0].ok,true);}
    const repeated=await c.call('commander_start_batch',{...args,callId:'batch-reconnect'});
    assert.equal(repeated.result.reused,true);assert.equal(fs.readdirSync(lab.env.NAVISH_STATE_DIR+'/sessions').length,4);
  }finally{await c.client.close();fs.rmSync(lab.root,{recursive:true,force:true});}
});
test('MCP file reads page beyond the response cap and expose continuation',async()=>{
  const lab=workspace(),c=await connect(lab);
  try{
    const lines=Array.from({length:1400},(_,i)=>`${i}: ${'record '.repeat(12)}`);
    const file=lab.root+'/long.log';fs.writeFileSync(file,lines.join('\n'));
    const result=await c.call('commander_read_file',{device:'local',path:file,offset:1250,length:75,maxBytes:8192});
    assert.equal(result.state,'completed');assert.equal(result.result.content,lines.slice(1250,1325).join('\n'));
    assert.equal(result.result.truncated,false);assert.equal(result.result.nextOffset,1325);
    const tail=await c.call('commander_read_file',{device:'local',path:file,offset:1399,length:75,maxBytes:8192});
    assert.equal(tail.result.content,lines[1399]);assert.equal(tail.result.hasMore,false);
    assert.equal(tail.result.nextOffset,null);
  }finally{await c.client.close();fs.rmSync(lab.root,{recursive:true,force:true});}
});
test('MCP reports worker failure distinctly from successful observation',async()=>{
  const lab=workspace(),c=await connect(lab);
  try{
    const launch=await c.call('commander_start_process',{device:'local',callId:'failed-process',sessionId:'exit-seven',cwd:lab.root,command:'exit 7',timeout_ms:1000});
    assert.equal(launch.state,'completed');assert.equal(launch.operationState,'failed');assert.equal(launch.result.exitCode,7);
    assert.equal('command' in launch.result,false);assert.equal('env' in launch.result,false);
    const receiptsBefore=fs.readdirSync(lab.env.NAVISH_STATE_DIR+'/receipts');
    const observed=await c.call('commander_process_output',{device:'local',sessionId:'exit-seven'});
    assert.equal(observed.operationState,'failed');assert.equal(observed.result.exitCode,7);
    assert.equal(observed.observation,true);assert.equal(observed.receiptPersisted,false);
    assert.deepEqual(fs.readdirSync(lab.env.NAVISH_STATE_DIR+'/receipts'),receiptsBefore);
    const absent=await c.call('commander_process_output',{device:'local',sessionId:'never-started'});assert.equal(absent.operationState,'unsubmitted');
  }finally{await c.client.close();fs.rmSync(lab.root,{recursive:true,force:true});}
});
test('MCP cancellation exposes the terminal worker state',async()=>{
  const lab=workspace(),c=await connect(lab);
  try{
    const start=await c.call('commander_start_batch',{device:'local',callId:'start-owned',batchId:'cancel-owned',
      workers:[{id:'owned',role:'cancellation fixture',cwd:lab.root,transport:'pipe',command:'sleep 30'}]});
    assert.equal(start.operationState,'running');
    const cancelled=await c.call('commander_cancel_batch',{device:'local',callId:'cancel-owned',batchId:'cancel-owned'});
    assert.equal(cancelled.state,'completed');assert.equal(cancelled.operationState,'failed');
    assert.equal(cancelled.result.cancelled[0].terminated,true);
    assert.equal(cancelled.result.status.counts.failed,1);
  }finally{await c.client.close();fs.rmSync(lab.root,{recursive:true,force:true});}
});
