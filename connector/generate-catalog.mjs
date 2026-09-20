import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=fs.mkdtempSync(path.join(os.tmpdir(),'navish-catalog-'));
const client=new Client({name:'catalog-build',version:'1.0.0'});
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(dir,'../src/server.mjs')],
    env:{...process.env,NAVISH_CONFIG_DIR:root+'/config',NAVISH_STATE_DIR:root+'/state',NAVISH_DATA_DIR:root+'/data'},stderr:'pipe'}));
  const tools=await client.listTools();
  const version=JSON.parse(fs.readFileSync(path.resolve(dir,'../package.json'))).version;
  fs.writeFileSync(path.join(dir,'catalog.json'),JSON.stringify({version,...tools},null,2)+'\n');
  console.log(JSON.stringify({version,tools:tools.tools.length}));
}finally{await client.close();fs.rmSync(root,{recursive:true,force:true});}
