import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const connectorFiles=['connector/handler.mjs','connector/auth.mjs','connector/queue.mjs','connector/journal.mjs','connector/poll-handler.mjs','connector/agent.mjs','connector/catalog.json','connector/release.json','connector/functions/commander.mts','netlify/edge-functions/poll.ts','netlify.toml','connector/channel-client.mjs','connector/channel-agent.mjs','connector/netlify-handler.mjs','connector/channel/worker.mjs','connector/channel/wrangler.jsonc','netlify/edge-functions/mcp.ts'];
export function connectorDigest(root=new URL('../',import.meta.url)){
  const h=crypto.createHash('sha256');
  for(const file of [...connectorFiles,'connector/install-agent.mjs'])h.update(file).update(fs.readFileSync(new URL(file,root)));
  return h.digest('hex');
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(connectorDigest());
