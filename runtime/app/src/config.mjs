import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { ensureDir, readJson, writeJson } from './util.mjs';

export function paths(env=process.env){
  const home=env.HOME||os.homedir();
  const configRoot=env.NAVISH_CONFIG_DIR||path.join(home,'.config','navish-commander');
  const stateRoot=env.NAVISH_STATE_DIR||path.join(home,'.local','state','navish-commander');
  const dataRoot=env.NAVISH_DATA_DIR||path.join(home,'.local','share','navish-commander');
  return {
    home,configRoot,stateRoot,dataRoot,
    configFile:path.join(configRoot,'config.json'),
    devicesFile:path.join(configRoot,'devices.json'),
    receiptsDir:path.join(stateRoot,'receipts'),
    sessionsDir:path.join(stateRoot,'sessions'),
    auditLog:path.join(stateRoot,'audit.jsonl'),
    uncertainFile:path.join(stateRoot,'uncertain-resources.json'),
    controlConfigFile:path.join(configRoot,'github-control.json'),
    controlPrivateKey:path.join(dataRoot,'control','device-private.pem'),
    controlPublicKey:path.join(dataRoot,'control','device-public.pem'),
    controlRepoDir:path.join(dataRoot,'control','repo'),
    controlReceiptsDir:path.join(stateRoot,'control-receipts'),
    controlLockFile:path.join(stateRoot,'control.lock'),
  };
}

export function ensureBase(P=paths()){
  [P.configRoot,P.stateRoot,P.dataRoot,P.receiptsDir,P.sessionsDir,path.dirname(P.controlPrivateKey),P.controlReceiptsDir].forEach(x=>ensureDir(x));
  if(!fs.existsSync(P.configFile)) writeJson(P.configFile,{version:1,allowedDirectories:[],browserCommand:null,outputLimitBytes:1048576},0o600);
  if(!fs.existsSync(P.devicesFile)) writeJson(P.devicesFile,{version:1,devices:{}},0o600);
  if(!fs.existsSync(P.uncertainFile)) writeJson(P.uncertainFile,{version:1,resources:{}},0o600);
  return P;
}
export function loadConfig(P=paths()){ ensureBase(P); return readJson(P.configFile); }
export function loadDevices(P=paths()){ ensureBase(P); return readJson(P.devicesFile); }
export function saveDevices(d,P=paths()){ writeJson(P.devicesFile,d,0o600); }
export function saveConfig(c,P=paths()){ writeJson(P.configFile,c,0o600); }
