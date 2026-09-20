import crypto from 'node:crypto';
import {sha} from './auth.mjs';
import {canonical,toolResult} from './queue.mjs';

// A transport choice is explicit. A missing channel response must never cause
// automatic dispatch through a second queue. Legacy fallback only reads receipts.
export function createChannelClient({origin,token,catalog,legacyReceipt,fetchImpl=fetch}) {
  if(!/^https:\/\/[^/]+$/.test(origin)||!token||token.length<40)throw Error('INVALID_CHANNEL_CONFIG');
  const names=new Map(catalog.tools.map(t=>[t.name,t]));
  async function request(path,value) {
    const response=await fetchImpl(origin+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify(value),signal:AbortSignal.timeout(28000)});
    if(!response.ok)throw Error('CHANNEL_HTTP_'+response.status);
    return response.json();
  }
  return {
    async invoke(name,args) {
      const tool=names.get(name);if(!tool)throw Error('UNKNOWN_TOOL');
      const mutating=tool.annotations?.readOnlyHint!==true;
      if(mutating&&!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(args.callId??''))throw Error('STABLE_CALL_ID_REQUIRED');
      const id=sha(mutating?'mutation:'+args.callId:crypto.randomUUID());
      const now=Date.now(),job={id,name,args,mutating,fingerprint:sha(canonical({name,args})),createdAt:now,expiresAt:now+600000};
      try{return await request('/invoke',job);}
      catch{return toolResult({state:'uncertain',operationId:id,callId:args.callId??null,code:'CHANNEL_RESPONSE_NOT_OBSERVED',retrySafe:false},true);}
    },
    async receipt(id) {
      if(!/^[a-f0-9]{64}$/.test(id??''))throw Error('INVALID_OPERATION_ID');
      const result=await request('/receipt',{id});
      if(result.structuredContent?.state==='unknown'&&legacyReceipt)return legacyReceipt(id);
      return result;
    }
  };
}
