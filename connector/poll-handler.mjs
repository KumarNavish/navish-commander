const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
export function createPoll({agentToken,store,waitMs=5000,delay=ms=>new Promise(r=>setTimeout(r,ms))}) {
  return async req=>{
    if(!agentToken||agentToken.length<40)return new Response('Unavailable',{status:503});
    const [a,b]=await Promise.all([digest(req.headers.get('authorization')??''),digest('Bearer '+agentToken)]);
    let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
    if(diff||req.method!=='GET')return new Response('Unauthorized',{status:401});
    const until=Date.now()+waitMs;
    do {
      const listed=await store.list({prefix:'pending/'});
      const jobs=await Promise.all(listed.blobs.slice(0,16).map(async x=>{
        const id=x.key.slice('pending/'.length);
        if(!/^[a-f0-9]{64}$/.test(id))return null;
        const [done,job]=await Promise.all([
          store.get('results/'+id,{type:'json'}),
          store.get('requests/'+id,{type:'json'})]);
        if(done){await store.delete(x.key);return null;}
        return job;
      }));
      if(jobs.some(Boolean))return Response.json({jobs:jobs.filter(Boolean)},{headers:{'cache-control':'no-store'}});
      if(req.signal.aborted)break;
      await delay(200);
    }while(Date.now()<until);
    return Response.json({jobs:[]},{headers:{'cache-control':'no-store'}});
  };
}
