import test from 'node:test';
import assert from 'node:assert/strict';
import {remoteOutcome} from '../app/src/remote.mjs';

const identity={device:'research-gateway',callId:'bounded-probe'};
const transport={code:0,signal:null,error:null,stdout:'',stderr:''};
test('observed ssh timeout with exit 255 retains uncertainty and identity',()=>{
  const out=remoteOutcome({...transport,code:255,error:'spawnSync ssh ETIMEDOUT'},identity);
  assert.equal(out.state,'uncertain');assert.equal(out.callId,identity.callId);
  assert.equal(out.reconcileCallId,identity.callId);assert.equal(out.safeToRetry,false);
});
test('lost reply and remote CLI error cannot certify failure',()=>{
  for(const code of [0,1,255,null]){
    const out=remoteOutcome({...transport,code,stdout:'not a receipt'},identity);
    assert.equal(out.state,'uncertain');assert.equal(out.safeToRetry,false);
  }
});
test('a different operation receipt cannot certify completion',()=>{
  assert.equal(remoteOutcome({...transport,stdout:JSON.stringify({callId:'other',state:'completed'})},identity).code,'REMOTE_RECEIPT_IDENTITY_INVALID');
});
test('authenticated transport still requires a recognized receipt state',()=>{
  assert.equal(remoteOutcome({...transport,stdout:JSON.stringify({callId:identity.callId,state:'ok'})},identity).code,'REMOTE_RECEIPT_IDENTITY_INVALID');
});
test('a verified remote failure survives nonzero CLI exit with its reason',()=>{
  const out=remoteOutcome({...transport,code:2,stdout:JSON.stringify({callId:identity.callId,state:'failed',reason:'preflight rejected',dispatched:false})},identity);
  assert.equal(out.state,'failed');assert.equal(out.reason,'preflight rejected');assert.equal(out.dispatched,false);
});
test('completion needs a consistent exit status',()=>{
  const stdout=JSON.stringify({callId:identity.callId,state:'completed',result:{value:42}});
  assert.equal(remoteOutcome({...transport,stdout},identity).result.value,42);
  assert.equal(remoteOutcome({...transport,code:255,stdout},identity).state,'uncertain');
});
