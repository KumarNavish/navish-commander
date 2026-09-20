import {getStore} from '@netlify/blobs';
import {createHandler} from '../handler.mjs';
import catalog from '../catalog.json';
import buildInfo from '../build.json';

export default async (req:Request) => {
  const env=(name:string)=>Netlify.env.get(name);
  if(!['CONNECTOR_ORIGIN','CONNECTOR_SECRET','CONNECTOR_OWNER_PASSWORD_HASH','CONNECTOR_AGENT_TOKEN'].every(k=>env(k)))
    return Response.json({error:'CONNECTOR_NOT_CONFIGURED'},{status:503,headers:{'cache-control':'no-store'}});
  const handler=createHandler({origin:env('CONNECTOR_ORIGIN'),secret:env('CONNECTOR_SECRET'),
    ownerPasswordHash:env('CONNECTOR_OWNER_PASSWORD_HASH'),agentToken:env('CONNECTOR_AGENT_TOKEN'),
    store:getStore({name:'commander-private',consistency:'strong'}),catalog,buildInfo});
  return handler(req);
};
export const config={path:['/mcp','/health','/.well-known/oauth-protected-resource','/.well-known/oauth-authorization-server','/oauth/register','/oauth/authorize','/oauth/token','/agent/heartbeat','/agent/result']};
