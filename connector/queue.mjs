import crypto from 'node:crypto';
import {sha} from './auth.mjs';
export const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
export const toolResult=(value,isError=false)=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError});
export function createQueue({store,catalog,now=()=>Date.now(),waitMs=40000,delay=ms=>new Promise(r=>setTimeout(r,ms))}) {
  const names=new Map(catalog.tools.map(t=>[t.name,t]));
  async function receipt(id) {
    if(!/^[a-f0-9]{64}$/.test(id))throw Error('INVALID_OPERATION_ID');
    const result=await store.get('results/'+id,{type:'json',consistency:'strong'});
    if(result)return result.response;
    const request=await store.get('requests/'+id,{type:'json',consistency:'strong'});
    return toolResult({state:request?'queued':'unknown',operationId:id,callId:request?.args?.callId??null,retrySafe:false,
      message:request?'Receipt not observed. Inspect this same operation ID; never submit a new mutation ID.':'No matching request exists.'});
  }
  async function invoke(name,args) {
    const tool=names.get(name);if(!tool)throw Error('UNKNOWN_TOOL');
    const mutating=tool.annotations?.readOnlyHint!==true;
    if(mutating&&!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(args.callId??''))throw Error('STABLE_CALL_ID_REQUIRED');
    const id=sha(mutating?'mutation:'+args.callId:crypto.randomUUID());
    const fingerprint=sha(canonical({name,args}));
    // Independent reads share one network round trip. Validate the durable
    // intent before returning a cached result, even when both already exist.
    let [request,existing,heartbeat]=await Promise.all([
      store.get('requests/'+id,{type:'json',consistency:'strong'}),
      store.get('results/'+id,{type:'json',consistency:'strong'}),
      store.get('agent/heartbeat',{type:'json',consistency:'strong'})]);
    if(!request) {
      if(!heartbeat||now()-heartbeat.at>180000)return toolResult({state:'blocked',code:'MAC_AGENT_OFFLINE',dispatched:false,retrySafe:false},true);
      const candidate={id,name,args,mutating,fingerprint,createdAt:now(),expiresAt:now()+600000};
      // Publish the immutable intent first. A failed admission must not leave
      // an orphan queue index that can starve later requests.
      const saved=await store.setJSON('requests/'+id,candidate,{onlyIfNew:true});
      request=saved.modified?candidate:await store.get('requests/'+id,{type:'json',consistency:'strong'});
    }
    if(!request||request.fingerprint!==fingerprint)throw Error('CALL_ID_CONFLICT');
    if(existing)return existing.response;
    // A publication acknowledgement can be lost. Publishing the identical
    // durable request again only restores queue visibility, never a new intent.
    await store.setJSON('pending/'+id,{id},{onlyIfNew:true});
    const until=now()+waitMs;
    while(now()<until){const r=await store.get('results/'+id,{type:'json',consistency:'strong'});if(r)return r.response;await delay(200);}
    return receipt(id);
  }
  async function complete({id,fingerprint,response}) {
    if(!/^[a-f0-9]{64}$/.test(id??''))throw Error('INVALID_OPERATION_ID');
    const request=await store.get('requests/'+id,{type:'json',consistency:'strong'});
    if(!request||request.fingerprint!==fingerprint||!response||!Array.isArray(response.content))throw Error('INVALID_RESULT');
    await store.setJSON('results/'+id,{response,finishedAt:now(),fingerprint},{onlyIfNew:true});
    await store.delete('pending/'+id);
    return {accepted:true,id};
  }
  return {invoke,receipt,complete};
}
