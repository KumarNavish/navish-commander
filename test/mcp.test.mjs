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
    const list=await c.client.listTools();assert.equal(list.tools.length,10);
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
    return {id,role:'file checksum worker',cwd,command:`sleep .3; printf '${id}' > result`,artifacts:[{path:'result',sha256:crypto.createHash('sha256').update(id).digest('hex')}]};
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
test('MCP reports worker failure distinctly from successful observation',async()=>{
  const lab=workspace(),c=await connect(lab);
  try{
    const launch=await c.call('commander_start_process',{device:'local',callId:'failed-process',sessionId:'exit-seven',cwd:lab.root,command:'exit 7',timeout_ms:1000});
    assert.equal(launch.state,'completed');assert.equal(launch.operationState,'failed');assert.equal(launch.result.exitCode,7);
    assert.equal('command' in launch.result,false);assert.equal('env' in launch.result,false);
    const absent=await c.call('commander_process_output',{device:'local',sessionId:'never-started'});assert.equal(absent.operationState,'unsubmitted');
  }finally{await c.client.close();fs.rmSync(lab.root,{recursive:true,force:true});}
});
