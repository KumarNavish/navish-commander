import {getStore} from '@netlify/blobs';
import {createPoll} from '../../connector/poll-handler.mjs';
export default async(req:Request)=>{
  // Short long-polls keep idle invocations below the legacy Free allowance;
  // network waits do not consume Edge CPU time. No inbound Mac port exists.
  return createPoll({agentToken:Netlify.env.get('CONNECTOR_AGENT_TOKEN'),
    store:getStore({name:'commander-private',consistency:'strong'})})(req);
};
