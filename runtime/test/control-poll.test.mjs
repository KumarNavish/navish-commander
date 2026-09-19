import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../app/src/util.mjs';
import { ensureControlClone,remoteHead,localHead,sync } from '../app/src/control-git.mjs';
function must(r){assert.equal(r.code,0,r.stderr||r.stdout||r.error);return r}
test('remoteHead detects a new control commit without mutating the local checkout',()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'navish-poll-'));
  const bare=path.join(d,'remote.git'),work=path.join(d,'work'),ctl=path.join(d,'ctl');
  must(run('git',['init','--bare',bare]));must(run('git',['clone',bare,work]));
  must(run('git',['-C',work,'config','user.name','t']));must(run('git',['-C',work,'config','user.email','t@x']));
  must(run('git',['-C',work,'switch','--orphan','control']));fs.writeFileSync(path.join(work,'x'),'1');
  must(run('git',['-C',work,'add','x']));must(run('git',['-C',work,'commit','-m','one']));must(run('git',['-C',work,'push','origin','control']));
  ensureControlClone({repo:bare,branch:'control',repoDir:ctl});const a=remoteHead(ctl,'control');assert.equal(a,localHead(ctl));
  fs.writeFileSync(path.join(work,'x'),'2');must(run('git',['-C',work,'add','x']));must(run('git',['-C',work,'commit','-m','two']));must(run('git',['-C',work,'push','origin','control']));
  const b=remoteHead(ctl,'control');assert.notEqual(b,a);assert.equal(localHead(ctl),a);sync(ctl,'control');assert.equal(localHead(ctl),b);
});
test('remote polling is bounded when a remote is unreachable',()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'navish-poll-bad-'));must(run('git',['init',d]));must(run('git',['-C',d,'remote','add','origin','https://127.0.0.1:1/nope.git']));
  const started=Date.now();assert.throws(()=>remoteHead(d,'control'));assert.ok(Date.now()-started<12000);
});
