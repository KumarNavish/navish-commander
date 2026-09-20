import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const selected=[
  'control-crypto','control-poll','controller-hardening','metadata-contention',
  'metadata-deadline','native-wiring','remote-outcome','sender-safety','file-pagination'
].map(n=>`runtime/test/${n}.test.mjs`);
selected.push('runtime/test/runtime/runtime.test.mjs');
selected.push(...fs.readdirSync('test').filter(f=>f.endsWith('.test.mjs')).map(f=>'test/'+f));
const env={...process.env};
if(fs.existsSync('.venv/bin/python3'))env.PATH=process.cwd()+'/.venv/bin:'+env.PATH;
const result=spawnSync(process.execPath,['--test','--test-concurrency=2',...selected],{stdio:'inherit',env});
process.exitCode=result.status??1;
