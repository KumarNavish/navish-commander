import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {paths,ensureBase} from '../runtime/app/src/config.mjs';
import {beginCall,loadReceipt,saveReceipt,recoverRunningReceipts} from '../runtime/app/src/receipts.mjs';

test('terminal replacement leaves admission evidence intact until recovery',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'navish-receipt-link-')),P=ensureBase(paths({HOME:home}));
  const r=beginCall({callId:'atomic',intent:{tool:'fixture'},resources:[],mutating:true},P).receipt;
  const active=path.join(P.stateRoot,'active-calls/atomic.json');
  saveReceipt({...r,state:'completed',result:{verified:true}},P);
  // Models a crash between terminal publication and active-record removal.
  assert.equal(JSON.parse(fs.readFileSync(active)).state,'running');
  assert.equal(loadReceipt('atomic',P).state,'completed');
  recoverRunningReceipts(P,{force:true});
  assert.equal(fs.existsSync(active),false);
  assert.equal(beginCall({callId:'atomic',intent:{tool:'fixture'},resources:[],mutating:true},P).replay,true);
});
