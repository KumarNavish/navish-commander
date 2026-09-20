import fs from 'node:fs';
import {connectorDigest} from './source-digest.mjs';
const release=JSON.parse(fs.readFileSync(new URL('./release.json',import.meta.url)));
const build={...release,sourceSha256:connectorDigest()};
fs.writeFileSync(new URL('./build.json',import.meta.url),JSON.stringify(build,null,2)+'\n');
console.log(JSON.stringify(build));
