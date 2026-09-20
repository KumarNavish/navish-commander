#!/usr/bin/env node
// Deterministic test adapter. No authentication, model invocation or network.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);
if(Object.keys(process.env).some(k=>k.endsWith('API_KEY')))process.exit(91);
if(args.includes('login')){console.log(process.env.NAVISH_FIXTURE_LOGIN==='api'?'Logged in using an API key':'Logged in using ChatGPT');process.exit(0);}
const externalDisabled=args.some(a=>a.startsWith('mcp_servers={')&&a.includes('"external-fixture"={command="/usr/bin/false",enabled=false}'));
if(args.includes('mcp')){console.log(JSON.stringify([{name:'external-fixture',transport:{type:'stdio'},enabled:!externalDisabled}]));process.exit(0);}
if(args.includes('sandbox')){
  if(!args.includes('--include-managed-config')||!args.includes('--permission-profile')||args[args.indexOf('--permission-profile')+1]!==':workspace')process.exit(92);
  const command=args.slice(args.indexOf('--')+1);
  const r=spawnSync(command[0],command.slice(1),{stdio:'inherit'});process.exit(r.status??93);
}
if(!args.includes('exec')||!externalDisabled||!args.includes('sandbox_mode="workspace-write"'))process.exit(94);
if(args.some(x=>/bypass|ignore-rules|ignore-user-config/.test(x)))process.exit(95);
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
const emit=event=>console.log(JSON.stringify(event));
emit({type:'thread.started',thread_id:'fixture-thread'});
fs.appendFileSync('launch-count','launch\n');
if(prompt.includes('WAIT'))await new Promise(r=>setTimeout(r,30000));
fs.writeFileSync('result.txt','implemented\n');
emit({type:'item.completed',item:{type:'command_execution',exit_code:0}});
if(prompt.includes('NO_TERMINAL'))process.exit(0);
if(prompt.includes('TURN_FAILED'))emit({type:'turn.failed'});
const report={outcome:prompt.includes('BLOCKED')?'needs_attention':'completed',summary:'Changed result.txt',remaining:prompt.includes('BLOCKED')?['Denied operation']:[]};
fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(report));
emit({type:'turn.completed',usage:{input_tokens:0,output_tokens:0}});
