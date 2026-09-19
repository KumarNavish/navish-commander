#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { paths as basePaths, ensureBase } from '../src/config.mjs';
import { generateX25519KeyPair, publicKeyFromPrivate, encryptRequest, decryptResult, PROTOCOL } from '../src/control-crypto.mjs';
import { ensureDir, readJson, writeJson, randomId, nowIso, run, isSafeId, executableExists, sleep } from '../src/util.mjs';
import { ensureControlClone, publishFile, sync, remoteHead, localHead } from '../src/control-git.mjs';
import { bridgeOnce } from '../src/control-bridge.mjs';
import { VERSION } from '../src/core.mjs';
import { acquireBridgeLock, inspectBridgeLock } from '../src/control-lock.mjs';

const argv = process.argv.slice(2);
const cmd = argv.shift();
const B = ensureBase(basePaths());
const P = {
  configRoot:B.configRoot,
  stateRoot:path.dirname(B.controlLockFile),
  dataRoot:path.dirname(B.controlRepoDir),
  configFile:B.controlConfigFile,
  privateKeyFile:B.controlPrivateKey,
  publicKeyFile:B.controlPublicKey,
  repoDir:B.controlRepoDir,
  receiptsDir:B.controlReceiptsDir,
  lockFile:B.controlLockFile,
  logFile:path.join(B.stateRoot, 'github-control.log'),
  loopStatusFile:path.join(B.stateRoot, 'github-control-loop.json'),
};
function arg(name, def=null) { const i=argv.indexOf(name); return i>=0 ? argv[i+1] : def; }
function loadConfig() { if (!fs.existsSync(P.configFile)) throw new Error(`not initialized: ${P.configFile}`); return readJson(P.configFile); }
function jprint(x) { process.stdout.write(JSON.stringify(x, null, 2) + '\n'); }
function help() {
  console.log(`navish-github-control

Commands:
  init --repo <git-url> [--branch control] [--controller-id NAME]
  once
  run [--interval-ms 1250]
  doctor
  status
  prepare --device-json FILE --target DEVICE --tool TOOL --args-json JSON --out FILE --response-key FILE [--ttl-sec 900]
  decrypt --result FILE --response-key FILE
`);
}
function deviceRegistration(config) {
  return {
    protocol:PROTOCOL,
    controllerId:config.controllerId,
    publicKeyPem:fs.readFileSync(P.publicKeyFile, 'utf8'),
    hostname:os.hostname(),
    platform:process.platform,
    arch:process.arch,
    navishVersion:VERSION,
    registeredAt:nowIso(),
  };
}
function appendLog(event) {
  try {
    if (fs.existsSync(P.logFile) && fs.statSync(P.logFile).size > 5 * 1024 * 1024) {
      const old = `${P.logFile}.1`;
      try { fs.rmSync(old, { force:true }); } catch {}
      fs.renameSync(P.logFile, old);
    }
    fs.appendFileSync(P.logFile, JSON.stringify({ at:nowIso(), ...event }) + '\n', { mode:0o600 });
  } catch {}
}

function releaseBridge(release) {
  try { release(); return { released:true, releasePending:false }; }
  catch (error) {
    // Do not unlink without the ownership check and do not overwrite a command
    // outcome with housekeeping failure. A dead owner is reconciled on restart.
    const state={ released:false, releasePending:true, code:'BRIDGE_LOCK_RELEASE_PENDING', metadataCode:error.code || null };
    appendLog({ event:'lock-release-pending', ...state });
    return state;
  }
}

function lockedInvocation(operation) {
  const release=acquireBridgeLock(P);
  let result, failure;
  try { result=operation(); } catch (error) { failure=error; }
  const controllerLock=releaseBridge(release);
  if (failure) throw failure;
  // Exit 3 describes unresolved controller cleanup, not a failed job. Published
  // result paths remain available and must be read before considering retries.
  jprint({ ...result, controllerLock });
  return controllerLock.releasePending ? 3 : 0;
}

function writeExclusive(file,data,mode=0o600){
  ensureDir(path.dirname(path.resolve(file)));
  const fd=fs.openSync(file,'wx',mode);
  try{fs.writeFileSync(fd,data);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function validatePreparation({dev,target,tool,args,ttl,cid,out,key,timeoutMs}){
  if(dev?.protocol!==PROTOCOL||!isSafeId(dev?.controllerId)||!isSafeId(target)||!isSafeId(tool)||!isSafeId(cid))throw new Error('INVALID_PREPARATION_ID');
  if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('INVALID_PREPARATION_ARGUMENTS');
  if(!Number.isSafeInteger(ttl)||ttl<1||ttl>86400||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>3600000)throw new Error('INVALID_PREPARATION_BUDGET');
  if(!out||!key||path.resolve(out)===path.resolve(key))throw new Error('SEPARATE_COMMAND_AND_RESPONSE_KEY_PATHS_REQUIRED');
  if(fs.existsSync(out)||fs.existsSync(key))throw new Error('PREPARED_FILES_ALREADY_EXIST: preserve and reuse the existing envelope and key');
}

async function main() {
  if (!cmd || cmd==='help' || cmd==='--help') { help(); return 0; }

  if (cmd==='init') {
    const repo=arg('--repo');
    if (!repo) throw new Error('--repo required');
    const branch=arg('--branch', 'control');
    const controllerId=arg('--controller-id', os.hostname().replace(/[^A-Za-z0-9._-]/g, '-'));
    if (!isSafeId(controllerId)) throw new Error('invalid --controller-id');
    if (run('git', ['check-ref-format', '--branch', branch], { timeoutMs:5000 }).code!==0) throw new Error('invalid --branch');
    const navishBin=arg('--navish-bin', process.env.NAVISH_BIN || path.join(B.home, '.local', 'bin', 'navish'));
    if (!executableExists(navishBin)) throw new Error(`navish executable unavailable: ${navishBin}`);

    return lockedInvocation(() => {
    ensureDir(path.dirname(P.privateKeyFile));
    ensureDir(P.receiptsDir);
    if (!fs.existsSync(P.privateKeyFile)) {
      const kp=generateX25519KeyPair();
      fs.writeFileSync(P.privateKeyFile, kp.privateKeyPem, { mode:0o600 });
      fs.writeFileSync(P.publicKeyFile, kp.publicKeyPem, { mode:0o644 });
    } else {
      fs.chmodSync(P.privateKeyFile, 0o600);
      if (!fs.existsSync(P.publicKeyFile)) fs.writeFileSync(P.publicKeyFile, publicKeyFromPrivate(fs.readFileSync(P.privateKeyFile, 'utf8')), { mode:0o644 });
    }
    const config={
      version:2,
      repo,
      branch,
      controllerId,
      navishBin,
      intervalMs:1250,
      heartbeatMs:60000,
      initializedAt:nowIso(),
    };
    writeJson(P.configFile, config, 0o600);
    ensureControlClone({ repo, branch, repoDir:P.repoDir });
    publishFile({
      repoDir:P.repoDir,
      branch,
      relativePath:`devices/${controllerId}.json`,
      content:JSON.stringify(deviceRegistration(config), null, 2) + '\n',
      message:`register ${controllerId}`,
    });
    return { ok:true, config, devicePath:`devices/${controllerId}.json` };
    });
  }

  if (cmd==='doctor') {
    const c=loadConfig();
    const checks={
      navish:executableExists(c.navishBin),
      git:executableExists('git'),
      privateKey:fs.existsSync(P.privateKeyFile),
      publicKey:fs.existsSync(P.publicKeyFile),
      repo:fs.existsSync(path.join(P.repoDir, '.git')),
    };
    let syncOk=false;
    try { remoteHead(P.repoDir, c.branch); syncOk=true; } catch {}
    checks.remoteReadable=syncOk;
    jprint({ ok:Object.values(checks).every(Boolean), checks, controllerId:c.controllerId, repo:c.repo, branch:c.branch, lock:inspectBridgeLock(P) });
    return Object.values(checks).every(Boolean) ? 0 : 1;
  }

  if (cmd==='status') {
    const c=loadConfig();
    let loop=null;
    try { loop=readJson(P.loopStatusFile); } catch {}
    jprint({
      controllerId:c.controllerId,
      repo:c.repo,
      branch:c.branch,
      lock:inspectBridgeLock(P),
      loop,
      configFile:P.configFile,
      publicKeyFile:P.publicKeyFile,
    });
    return 0;
  }

  if (cmd==='once') {
    const c=loadConfig();
    return lockedInvocation(() => bridgeOnce({ config:c, paths:P, navishBin:c.navishBin }));
  }

  if (cmd==='run') {
    const c=loadConfig();
    if (Number(c.version || 1) < 2) {
      c.version=2;
      c.intervalMs=1250;
      c.heartbeatMs=60000;
      c.migratedAt=nowIso();
      writeJson(P.configFile,c,0o600);
    }
    const pollMs=Math.max(750, Math.min(5000, Number(arg('--interval-ms', c.intervalMs || 1250))));
    const heartbeatMs=Math.max(15000, Math.min(300000, Number(c.heartbeatMs || 60000)));
    const release=acquireBridgeLock(P);
    let stopping=false;
    const status=(extra={}) => {
      try {
        writeJson(P.loopStatusFile, {
          at:nowIso(),
          pid:process.pid,
          pollMs,
          heartbeatMs,
          ...extra,
        }, 0o600);
      } catch {}
    };
    const stop=() => {
      if (stopping) return;
      stopping=true;
      const controllerLock=releaseBridge(release);
      status({ state:'stopped', controllerLock });
      process.exit(controllerLock.releasePending ? 3 : 0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    let lastSeen=null;
    let lastFull=0;
    let lastStatusWrite=0;
    let errors=0;
    try {
      while (true) {
        try {
          const remote=remoteHead(P.repoDir, c.branch);
          const now=Date.now();
          const heartbeatDue=(now-lastFull)>=heartbeatMs;
          const changed=lastSeen===null || remote!==lastSeen;
          if (changed || heartbeatDue) {
            const reason=changed ? (lastSeen===null ? 'startup' : 'remote-change') : 'heartbeat';
            const started=Date.now();
            const r=bridgeOnce({ config:c, paths:P, navishBin:c.navishBin });
            const local=localHead(P.repoDir);
            lastSeen=local;
            lastFull=Date.now();
            errors=0;
            lastStatusWrite=lastFull;
            status({
              state:'healthy',
              reason,
              remoteHead:remote,
              localHead:local,
              lastSyncAt:nowIso(),
              syncDurationMs:lastFull-started,
              lastProcessed:r.processed,
              lastSkipped:r.skipped,
              resultCount:r.results.length,
              consecutiveErrors:0,
            });
            if (r.processed>0 || reason==='heartbeat') appendLog({ event:'sync', reason, remoteHead:remote, localHead:local, durationMs:lastFull-started, ...r });
            if (r.processed>0) { await sleep(75); continue; }
          } else if (now-lastStatusWrite>=10000) {
            status({
              state:'healthy',
              reason:'idle',
              remoteHead:remote,
              lastSyncAt:lastFull ? new Date(lastFull).toISOString() : null,
              lastProcessed:0,
              lastSkipped:0,
              resultCount:0,
              consecutiveErrors:0,
            });
            lastStatusWrite=now;
          }
          errors=0;
          await sleep(pollMs);
        } catch (e) {
          errors++;
          const wait=Math.min(30000, pollMs * 2 ** Math.min(errors, 4));
          status({ state:'degraded', error:e.message, consecutiveErrors:errors, nextRetryMs:wait });
          appendLog({ event:'error', error:e.message, consecutiveErrors:errors, nextRetryMs:wait });
          await sleep(wait);
        }
      }
    } finally { releaseBridge(release); }
  }

  if (cmd==='prepare') {
    const dev=readJson(arg('--device-json'));
    const target=arg('--target');
    const tool=arg('--tool');
    if (!target || !tool) throw new Error('--target/--tool required');
    const args=JSON.parse(arg('--args-json', '{}'));
    const ttl=Number(arg('--ttl-sec', '900'));
    const cid=arg('--command-id', randomId('cmd'));
    const out=arg('--out'),key=arg('--response-key'),timeoutMs=Number(arg('--timeout-ms','120000'));
    validatePreparation({dev,target,tool,args,ttl,cid,out,key,timeoutMs});
    const created=nowIso();
    const expiresAt=new Date(Date.now()+ttl*1000).toISOString();
    const meta={ protocol:PROTOCOL, commandId:cid, controllerId:dev.controllerId, createdAt:created, expiresAt };
    const { envelope, responsePrivateKeyPem }=encryptRequest({
      devicePublicKeyPem:dev.publicKeyPem,
      payload:{ targetDevice:target, tool, args, timeoutMs },
      meta,
    });
    // Retain the decryption key before making a command envelope available.
    // Exclusive creation never destroys a key after an ambiguous submission.
    writeExclusive(key,responsePrivateKeyPem);
    writeExclusive(out,JSON.stringify(envelope,null,2)+'\n');
    jprint({ ok:true, commandId:cid, repoRelativePath:`commands/${dev.controllerId}/${cid}.json`, commandFile:out, responseKey:key });
    return 0;
  }

  if (cmd==='decrypt') {
    const result=arg('--result');
    const key=arg('--response-key');
    if (!result || !key) throw new Error('--result/--response-key required');
    jprint(decryptResult({ responsePrivateKeyPem:fs.readFileSync(key, 'utf8'), envelope:readJson(result) }));
    return 0;
  }
  throw new Error(`unknown command: ${cmd}`);
}

main().then(c => { process.exitCode=c; }).catch(e => {
  console.error(`navish-github-control: ${e.message}`);
  process.exitCode=1;
});
