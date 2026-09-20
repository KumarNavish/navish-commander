// The Mac only opens outbound TLS connections. Tokens travel in upgrade
// headers, never query strings. The disk journal remains the execution owner.
export async function runChannelAgent({origin,token,executeJob,stopped,WebSocketImpl=WebSocket,log=console.error}) {
  if(!/^https:\/\/[^/]+$/.test(origin)||!token||token.length<40)throw Error('INVALID_CHANNEL_CONFIG');
  const inflight=new Map(),acks=new Map();let socket,backoff=1000;
  const upload=({id,fingerprint,response})=>new Promise((resolve,reject)=>{
    if(socket?.readyState!==1){reject(Error('CHANNEL_DISCONNECTED'));return;}
    const timer=setTimeout(()=>{acks.delete(id);reject(Error('CHANNEL_ACK_TIMEOUT'));socket?.close();},10000);
    acks.set(id,{resolve:()=>{clearTimeout(timer);acks.delete(id);resolve();},reject:e=>{clearTimeout(timer);acks.delete(id);reject(e);}});
    try{socket.send(JSON.stringify({type:'result',id,fingerprint,response}));}
    catch(e){acks.get(id)?.reject(e);socket.close();}
  });
  while(!stopped()){
    try{
      await new Promise((resolve,reject)=>{
        const ws=new WebSocketImpl(origin.replace(/^https:/,'wss:')+'/agent',['navish-agent','token.'+token]);socket=ws;
        let lastSeen=Date.now(),lastPing=0,opened=false,settled=false;
        const settle=()=>{
          if(settled)return;settled=true;clearInterval(timer);
          if(socket===ws)socket=undefined;
          for(const ack of [...acks.values()])ack.reject(Error('CHANNEL_DISCONNECTED'));
          opened||stopped()?resolve():reject(Error('CHANNEL_CONNECT_FAILED'));
        };
        const disconnect=()=>{settle();try{ws.close();}catch{}};
        const timer=setInterval(()=>{
          if(stopped()){if(!inflight.size)disconnect();return;}
          if(ws.readyState>=2){settle();return;}
          if(Date.now()-lastSeen>150000){disconnect();return;}
          if(ws.readyState===1&&Date.now()-lastPing>=30000){lastPing=Date.now();ws.send(JSON.stringify({type:'ping'}));}
        },1000);
        ws.addEventListener('open',()=>{if(settled){try{ws.close();}catch{}return;}opened=true;lastSeen=Date.now();ws.send(JSON.stringify({type:'ready'}));});
        ws.addEventListener('message',event=>{
          if(settled)return;
          lastSeen=Date.now();let b;
          try{b=JSON.parse(event.data);}catch{ws.close();return;}
          if(b.type==='ready'){backoff=1000;return;}
          if(b.type==='ack'){acks.get(b.id)?.resolve();return;}
          if(b.type!=='job'||stopped()||inflight.has(b.job?.id))return;
          if(inflight.size>=4){ws.close();return;}
          const job=b.job;
          const p=Promise.resolve().then(()=>executeJob(job,upload))
            .catch(e=>{log(JSON.stringify({event:'job-not-acknowledged',id:job.id,code:e.message}));disconnect();})
            .finally(()=>{inflight.delete(job.id);if(stopped()&&!inflight.size)disconnect();});
          inflight.set(job.id,p);
        });
        // Older Node versions can omit close after an error, or emit error
        // synchronously from close(). Settle once before asking the socket to close.
        ws.addEventListener('error',disconnect,{once:true});
        ws.addEventListener('close',settle,{once:true});
      });
    }catch(e){log(JSON.stringify({event:'channel-unavailable',code:e.message,retryInMs:backoff}));}
    if(!stopped()){await new Promise(r=>setTimeout(r,backoff));backoff=Math.min(backoff*2,60000);}
  }
  await Promise.allSettled(inflight.values());
}
