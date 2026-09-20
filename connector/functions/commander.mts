import {netlifyHandler} from '../netlify-handler.mjs';

export default async (req:Request) => {
  return netlifyHandler(req,(name:string)=>Netlify.env.get(name));
};
export const config={path:['/mcp','/health','/.well-known/oauth-protected-resource','/.well-known/oauth-authorization-server','/oauth/register','/oauth/authorize','/oauth/token','/agent/heartbeat','/agent/result']};
