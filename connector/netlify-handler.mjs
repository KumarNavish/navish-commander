import {getStore} from '@netlify/blobs';
import {createHandler} from './handler.mjs';
import {createQueue} from './queue.mjs';
import {createChannelClient} from './channel-client.mjs';
import catalog from './catalog.json' with {type:'json'};
import buildInfo from './build.json' with {type:'json'};

export function netlifyHandler(req,env){
  if(!['CONNECTOR_ORIGIN','CONNECTOR_SECRET','CONNECTOR_OWNER_PASSWORD_HASH','CONNECTOR_AGENT_TOKEN'].every(k=>env(k)))
    return Response.json({error:'CONNECTOR_NOT_CONFIGURED'},{status:503,headers:{'cache-control':'no-store'}});
  const store=getStore({name:'commander-private',consistency:'strong'});
  let queueOverride;
  if(env('CONNECTOR_CHANNEL_ORIGIN'))queueOverride=createChannelClient({origin:env('CONNECTOR_CHANNEL_ORIGIN'),token:env('CONNECTOR_CHANNEL_TOKEN'),catalog,
    legacyReceipt:createQueue({store,catalog}).receipt});
  return createHandler({origin:env('CONNECTOR_ORIGIN'),secret:env('CONNECTOR_SECRET'),
    ownerPasswordHash:env('CONNECTOR_OWNER_PASSWORD_HASH'),agentToken:env('CONNECTOR_AGENT_TOKEN'),
    store,catalog,buildInfo,queueOverride})(req);
}
