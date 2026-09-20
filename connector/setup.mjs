#!/usr/bin/env node
/** Generate private installation files without creating accounts or spending. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const channel=process.argv.includes('--channel');
const [origin,providedDir]=process.argv.slice(2).filter(x=>x!=='--channel');
let parsed;try{parsed=new URL(origin);}catch{throw Error('Usage: node connector/setup.mjs https://YOUR-HOST [private-config-directory] [--channel]');}
if(parsed.protocol!=='https:'||parsed.origin!==origin||parsed.username||parsed.password)throw Error('Use an HTTPS origin without a path, query, or credentials');
const dir=path.resolve(providedDir||path.join(os.homedir(),'.config/navish-chatgpt-connector'));
if(fs.existsSync(dir))throw Error('Configuration directory already exists; preserve it and rotate credentials deliberately instead');
const staging=dir+'.new-'+crypto.randomUUID();fs.mkdirSync(staging,{recursive:true,mode:0o700});
const secret=crypto.randomBytes(32).toString('hex'),password=crypto.randomBytes(32).toString('base64url'),agentToken=crypto.randomBytes(32).toString('base64url');
const write=(name,value)=>fs.writeFileSync(path.join(staging,name),value,{mode:0o600,flag:'wx'});
write('owner.json',JSON.stringify({origin,password},null,2));
write('agent.json',JSON.stringify({origin,...(channel?{channelOrigin:origin}:{}),agentToken,stateDir:path.join(os.homedir(),'.local/state/navish-chatgpt-connector'),server:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src/server.mjs')},null,2));
write('relay.env',`CONNECTOR_ORIGIN=${origin}\nCONNECTOR_SECRET=${secret}\nCONNECTOR_OWNER_PASSWORD_HASH=${crypto.createHash('sha256').update(password).digest('hex')}\nCONNECTOR_AGENT_TOKEN=${agentToken}\n`);
if(channel)write('channel-secrets.json',JSON.stringify({CONNECTOR_ORIGIN:origin,CONNECTOR_SECRET:secret,
  CONNECTOR_OWNER_PASSWORD_HASH:crypto.createHash('sha256').update(password).digest('hex'),AGENT_TOKEN:agentToken,SERVER_TOKEN:crypto.randomBytes(32).toString('hex')},null,2));
fs.renameSync(staging,dir);
console.log(JSON.stringify({configurationDirectory:dir,credentialsPrinted:false,next:channel?'Install channel-secrets.json through Wrangler on your confirmed Workers Free account, then install the Mac agent. See docs/PERSONAL_CONNECTOR.md.':'Configure the four relay variables on your confirmed free Netlify site, deploy, then install the Mac agent. See docs/PERSONAL_CONNECTOR.md.'},null,2));
