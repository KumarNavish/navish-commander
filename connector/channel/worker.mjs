import {DurableObject} from 'cloudflare:workers';
import catalog from '../catalog.json';
import build from '../build.json';
import {createHandler} from '../handler.mjs';
import {decodeChannelMessage} from '../channel-codec.mjs';

const ID=/^[a-f0-9]{64}$/,CALL=/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const PUBLIC_PATHS=new Set(['/mcp','/.well-known/oauth-protected-resource','/.well-known/oauth-authorization-server','/oauth/register','/oauth/authorize','/oauth/token']);
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const sha=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))),v=>v.toString(16).padStart(2,'0')).join('');
const result=(v,isError=false)=>({content:[{type:'text',text:JSON.stringify(v)}],structuredContent:v,isError});
const json=(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
async function authenticated(given,token){
  if(!token||token.length<40||typeof given!=='string'||given.length>200)return false;
  const a=await sha(given),b=await sha(token);let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function body(req){
  const reader=req.body?.getReader();if(!reader)return {};
  let size=0;const parts=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>262144){await reader.cancel();throw Error('BODY_TOO_LARGE');}parts.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    if(path==='/health'&&req.method==='GET')return json({service:'navish-commander-channel',connector:build});
    if(PUBLIC_PATHS.has(path)){
      if(!env.CONNECTOR_ORIGIN||!env.CONNECTOR_SECRET||!env.CONNECTOR_OWNER_PASSWORD_HASH)return json({error:'CONNECTOR_NOT_CONFIGURED'},503);
      // OAuth, SDK parsing and durable execution run inside the Durable Object.
      // The outer free-plan Worker only routes; it does not need paid CPU limits.
      return env.CHANNEL.get(env.CHANNEL.idFromName('owner'),{locationHint:'weur'}).fetch(req);
    }
    if(path==='/agent'&&req.method==='GET'&&req.headers.get('upgrade')?.toLowerCase()==='websocket'){
      const protocols=(req.headers.get('sec-websocket-protocol')??'').split(',').map(s=>s.trim());
      if(!protocols.includes('navish-agent')||!await authenticated(protocols.find(p=>p.startsWith('token.'))?.slice(6),env.AGENT_TOKEN))return json({error:'UNAUTHORIZED'},401);
    }else{
      if(!await authenticated(req.headers.get('authorization')?.replace(/^Bearer /,''),env.SERVER_TOKEN))return json({error:'UNAUTHORIZED'},401);
      if(req.method!=='POST'||!['/invoke','/receipt','/status'].includes(path))return json({error:'NOT_FOUND'},404);
    }
    return env.CHANNEL.get(env.CHANNEL.idFromName('owner'),{locationHint:'weur'}).fetch(req);
  }
};

export class CommanderChannel extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);this.waiters=new Map();
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, job TEXT NOT NULL, response TEXT, created INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS pending_jobs ON jobs(created) WHERE response IS NULL');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS auth_records (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.authStore={
      get:async key=>{const row=ctx.storage.sql.exec('SELECT value FROM auth_records WHERE key=?',key).toArray()[0];return row?JSON.parse(row.value):null;},
      setJSON:async(key,value,options={})=>{
        const sql=options.onlyIfNew?'INSERT OR IGNORE INTO auth_records(key,value) VALUES(?,?) RETURNING key':'INSERT INTO auth_records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value RETURNING key';
        return {modified:ctx.storage.sql.exec(sql,key,JSON.stringify(value)).toArray().length>0};
      }
    };
  }
  row(id){return this.ctx.storage.sql.exec('SELECT * FROM jobs WHERE id=?',id).toArray()[0];}
  agent(){return this.ctx.getWebSockets('agent').find(ws=>{const a=ws.deserializeAttachment();return a?.ready&&Date.now()-a.seen<150000;});}
  receipt(id){
    const row=this.row(id);if(row?.response)return JSON.parse(row.response);
    return result({state:row?'queued':'unknown',operationId:id,callId:row?JSON.parse(row.job).args.callId??null:null,retrySafe:false});
  }
  notify(id,response){for(const resolve of this.waiters.get(id)??[])resolve(response);this.waiters.delete(id);}
  async dispatch(){
    const ws=this.agent();if(!ws)return;
    const a=ws.deserializeAttachment();
    const rows=this.ctx.storage.sql.exec('SELECT * FROM jobs WHERE response IS NULL ORDER BY created LIMIT 32').toArray();
    for(const row of rows){
      if(a.inflight.includes(row.id))continue;
      if(a.inflight.length>=4)break;
      const job=JSON.parse(row.job);
      // Expiry is decided by the local journal: a previously executed request
      // can have a retained result even after its initial dispatch deadline.
      a.inflight.push(row.id);ws.serializeAttachment(a);
      try{ws.send(JSON.stringify({type:'job',job}));}
      catch{a.ready=false;ws.serializeAttachment(a);break;}
    }
  }
  async fetch(req){
    const path=new URL(req.url).pathname;
    if(PUBLIC_PATHS.has(path))return createHandler({origin:this.env.CONNECTOR_ORIGIN,secret:this.env.CONNECTOR_SECRET,
      ownerPasswordHash:this.env.CONNECTOR_OWNER_PASSWORD_HASH,agentToken:this.env.AGENT_TOKEN,store:this.authStore,catalog,buildInfo:build,
      queueOverride:{receipt:async id=>this.receipt(id),invoke:async(name,args)=>{
        const tool=catalog.tools.find(t=>t.name===name);if(!tool)throw Error('UNKNOWN_TOOL');
        const mutating=tool.annotations?.readOnlyHint!==true;
        if(mutating&&!CALL.test(args.callId??''))throw Error('STABLE_CALL_ID_REQUIRED');
        const id=await sha(mutating?'mutation:'+args.callId:crypto.randomUUID()),now=Date.now();
        const job={id,name,args,mutating,fingerprint:await sha(canonical({name,args})),createdAt:now,expiresAt:now+600000};
        const response=await this.fetch(new Request('https://channel.internal/invoke',{method:'POST',body:JSON.stringify(job)}));
        if(!response.ok)throw Error('CHANNEL_RESPONSE_NOT_OBSERVED');return response.json();
      }}})(req);
    if(path==='/agent'){
      for(const old of this.ctx.getWebSockets('agent')){const a=old.deserializeAttachment();old.serializeAttachment({...a,ready:false});old.close(1000,'Reconnected');}
      const [client,server]=Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server,['agent']);server.serializeAttachment({ready:false,seen:Date.now(),inflight:[]});
      return new Response(null,{status:101,webSocket:client,headers:{'sec-websocket-protocol':'navish-agent'}});
    }
    try{
      const b=await body(req);
      if(path==='/status')return json({online:!!this.agent(),pending:this.ctx.storage.sql.exec('SELECT count(*) AS n FROM jobs WHERE response IS NULL').one().n,connector:build});
      if(path==='/receipt'){if(!ID.test(b.id??''))return json({error:'INVALID_OPERATION_ID'},400);return json(this.receipt(b.id));}
      const tool=catalog.tools.find(t=>t.name===b.name),mutating=tool?.annotations?.readOnlyHint!==true;
      if(!tool||!ID.test(b.id??'')||!b.args||b.mutating!==mutating||!Number.isSafeInteger(b.expiresAt)||!Number.isSafeInteger(b.createdAt)||
        b.fingerprint!==await sha(canonical({name:b.name,args:b.args}))||
        (mutating&&(!CALL.test(b.args.callId??'')||b.id!==await sha('mutation:'+b.args.callId))))return json({error:'INVALID_JOB'},400);
      // No await between the first lookup and immutable intent admission.
      // Durable Object input/output gates commit before any network dispatch.
      let row=this.row(b.id);
      if(row&&row.fingerprint!==b.fingerprint)return json(result({state:'failed',code:'CALL_ID_CONFLICT',dispatched:false,retrySafe:false},true));
      if(row?.response)return json(JSON.parse(row.response));
      if(!row){
        if(!this.agent())return json(result({state:'blocked',code:'MAC_AGENT_OFFLINE',dispatched:false,retrySafe:false},true));
        if(b.expiresAt<Date.now()||b.expiresAt>Date.now()+660000||b.createdAt>Date.now()+60000)return json({error:'INVALID_EXPIRY'},400);
        this.ctx.storage.sql.exec('INSERT INTO jobs(id,fingerprint,job,created) VALUES(?,?,?,?)',b.id,b.fingerprint,JSON.stringify(b),Date.now());
      }
      await this.ctx.storage.sync();
      let timer,resolve;
      const pending=new Promise(r=>resolve=r);
      const set=this.waiters.get(b.id)??new Set();set.add(resolve);this.waiters.set(b.id,set);
      try{
        // Check again after the storage await: an earlier execution can finish.
        row=this.row(b.id);if(row.response)return json(JSON.parse(row.response));
        await this.dispatch();
        timer=setTimeout(()=>resolve(this.receipt(b.id)),25000);
        return json(await pending);
      }finally{clearTimeout(timer);set.delete(resolve);if(!set.size)this.waiters.delete(b.id);}
    }catch{return json({error:'CHANNEL_REQUEST_NOT_OBSERVED'},503);}
  }
  async webSocketMessage(ws,message){
    try{
      const b=await decodeChannelMessage(message),a=ws.deserializeAttachment();
      if(b.type==='ready'){a.ready=true;a.seen=Date.now();ws.serializeAttachment(a);ws.send(JSON.stringify({type:'ready'}));await this.dispatch();return;}
      if(!a.ready)throw Error('STALE_CONNECTION');
      a.seen=Date.now();ws.serializeAttachment(a);
      if(b.type==='ping'){ws.send(JSON.stringify({type:'pong'}));await this.dispatch();return;}
      if(b.type!=='result'||!ID.test(b.id??''))throw Error('INVALID_MESSAGE');
      const row=this.row(b.id);
      if(!row||row.fingerprint!==b.fingerprint||!Array.isArray(b.response?.content))throw Error('INVALID_RESULT');
      if(!row.response)this.ctx.storage.sql.exec('UPDATE jobs SET response=? WHERE id=? AND response IS NULL',JSON.stringify(b.response),b.id);
      await this.ctx.storage.sync();
      const response=JSON.parse(this.row(b.id).response);
      this.notify(b.id,response);
      const latest=ws.deserializeAttachment();latest.inflight=latest.inflight.filter(id=>id!==b.id);ws.serializeAttachment(latest);
      ws.send(JSON.stringify({type:'ack',id:b.id}));await this.dispatch();
    }catch{ws.close(1008,'Invalid or unacknowledged channel message');}
  }
  webSocketClose(ws){const a=ws.deserializeAttachment();ws.serializeAttachment({...a,ready:false});ws.close(1000,'Disconnected');}
  webSocketError(ws){this.webSocketClose(ws);ws.close(1011,'Reconnect to reconcile');}
}
