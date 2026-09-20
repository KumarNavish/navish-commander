import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
const root=process.cwd(),dist=path.join(root,'dist'),stage=path.join(dist,'navish-commander');
fs.mkdirSync(dist,{recursive:true});
if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true});
fs.mkdirSync(stage);
for(const name of ['src','runtime/app','skills','.claude-plugin','.mcp.json','plugin.json','manifest.json','package.json','package-lock.json','LICENSE','README.md','docs','evidence']){
  const dst=path.join(stage,name);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.cpSync(name,dst,{recursive:true});
}
const run=(cmd,args,cwd=root)=>{const r=spawnSync(cmd,args,{cwd,stdio:'inherit'});if(r.status!==0)throw Error(cmd+' failed: '+r.status);};
run('npm',['ci','--omit=dev','--ignore-scripts','--no-fund'],stage);
const cli=path.join(root,'node_modules/.bin/mcpb');
// MCPB excludes lockfiles by default. Retain the authored locks so a downloaded
// archive can be compared directly with the release checkout.
fs.writeFileSync(path.join(stage,'.mcpbignore'),'!package-lock.json\n!runtime/app/package-lock.json\n');
run(cli,['validate',path.join(stage,'manifest.json')]);
const version=JSON.parse(fs.readFileSync('package.json')).version;
const bundle=path.join(dist,`navish-commander-${version}.mcpb`);
run(cli,['pack',stage,bundle]);
fs.copyFileSync(bundle,bundle.replace(/\.mcpb$/,'.zip'));
const files=[bundle,bundle.replace(/\.mcpb$/,'.zip')];
fs.writeFileSync(path.join(dist,'SHA256SUMS.txt'),files.map(p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')+'  '+path.basename(p)).join('\n')+'\n');
console.log('Release files: '+files.join(', '));
