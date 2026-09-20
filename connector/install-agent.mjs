#!/usr/bin/env node
/** Pin the current source and install this connector's own macOS LaunchAgent. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {connectorDigest} from './source-digest.mjs';
if(process.platform!=='darwin')throw Error('For other systems, run node connector/agent.mjs CONFIG under your own process manager');
const configPath=path.resolve(process.argv[2]||path.join(os.homedir(),'.config/navish-chatgpt-connector/agent.json'));
const config=JSON.parse(fs.readFileSync(configPath));
if(!path.isAbsolute(config.stateDir)||!config.agentToken||!/^https:\/\/[^/]+$/.test(config.origin))throw Error('Invalid private agent configuration');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sources=['src','runtime/app','connector','package.json','package-lock.json'];
const h=crypto.createHash('sha256');
function hash(p){if(fs.statSync(p).isDirectory()){for(const n of fs.readdirSync(p).sort())hash(path.join(p,n));}else h.update(path.relative(root,p)).update(fs.readFileSync(p));}
for(const n of sources)hash(path.join(root,n));
const sourceSha256=h.digest('hex'),base=path.join(os.homedir(),'.local/share/navish-chatgpt-connector'),release=path.join(base,'releases',sourceSha256.slice(0,16));
if(!fs.existsSync(path.join(root,'node_modules/@modelcontextprotocol/sdk/package.json')))throw Error('Run npm ci --ignore-scripts first');
const label='io.navish.commander.personal-connector',domain='gui/'+process.getuid();
const active=spawnSync('launchctl',['print',domain+'/'+label],{encoding:'utf8'});
if(active.status===0)throw Error('Connector agent is already loaded. Reconcile its in-flight jobs and boot out this exact LaunchAgent before updating; installation does not kill running work');
if(!fs.existsSync(release)){
  const temp=release+'.new-'+process.pid;fs.mkdirSync(temp,{recursive:true,mode:0o700});
  for(const n of [...sources,'node_modules']){fs.mkdirSync(path.dirname(path.join(temp,n)),{recursive:true});fs.cpSync(path.join(root,n),path.join(temp,n),{recursive:true});}
  fs.renameSync(temp,release);
}
config.server=path.join(release,'src/server.mjs');
fs.writeFileSync(configPath,JSON.stringify(config,null,2),{mode:0o600});fs.chmodSync(configPath,0o600);
fs.mkdirSync(config.stateDir,{recursive:true,mode:0o700});
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const agentPath=path.join(os.homedir(),'Library/LaunchAgents',label+'.plist');
fs.mkdirSync(path.dirname(agentPath),{recursive:true});
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[process.execPath,path.join(release,'connector/agent.mjs'),configPath].map(v=>'<string>'+xml(v)+'</string>').join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>WorkingDirectory</key><string>${xml(release)}</string><key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(os.homedir())}</string><key>PATH</key><string>${xml(process.env.PATH)}</string></dict><key>StandardOutPath</key><string>${xml(path.join(config.stateDir,'stdout.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(config.stateDir,'stderr.log'))}</string></dict></plist>`;
fs.writeFileSync(agentPath,plist,{mode:0o600});fs.chmodSync(agentPath,0o600);
const r=spawnSync('launchctl',['bootstrap',domain,agentPath],{encoding:'utf8'});if(r.status!==0)throw Error('launchctl bootstrap failed: '+r.stderr.trim());
const manifest={installedAt:new Date().toISOString(),sourceSha256,connectorSourceSha256:connectorDigest(),release,configPath,agentPath};
fs.writeFileSync(path.join(base,'installation.json'),JSON.stringify(manifest,null,2),{mode:0o600});
console.log(JSON.stringify({installed:true,release,sourceSha256,label},null,2));
