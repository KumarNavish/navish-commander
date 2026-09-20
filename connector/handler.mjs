import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createAuth,escapeHtml,SCOPE,sha} from './auth.mjs';
import {createQueue,toolResult} from './queue.mjs';

// no-referrer makes browsers send Origin: null on form POSTs. same-origin
// preserves our consent origin check without leaking OAuth URLs cross-site.
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin'};
const json=(v,status=200,extra={})=>new Response(JSON.stringify(v),{status,headers:{...headers,'content-type':'application/json',...extra}});
const callIdPattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const receiptTool={name:'commander_connector_receipt',description:'Inspect an operation after a missing or queued connector response, without dispatching again. Supply the returned operationId, or the original mutation callId if its response was lost.',
  inputSchema:{type:'object',properties:{operationId:{type:'string',pattern:'^[a-f0-9]{64}$'},callId:{type:'string',pattern:callIdPattern.source}},oneOf:[{required:['operationId']},{required:['callId']}],additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}};

export function createHandler({origin,secret,ownerPasswordHash,agentToken,store,catalog,waitMs=40000,buildInfo}) {
  const auth=createAuth({origin,secret,ownerPasswordHash,agentToken,store});
  const queue=createQueue({store,catalog,waitMs});
  const protectedTools=[...catalog.tools,receiptTool].map(t=>({...t,securitySchemes:[{type:'oauth2',scopes:[SCOPE]}],_meta:{...t._meta,securitySchemes:[{type:'oauth2',scopes:[SCOPE]}]}}));
  async function body(req,form=false) {
    const parts=[];let size=0;
    if(req.body){
      const reader=req.body.getReader();
      try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
        if(size>262144){await reader.cancel();throw Error('BODY_TOO_LARGE');}parts.push(value);}}
      finally{reader.releaseLock();}
    }
    const raw=Buffer.concat(parts).toString('utf8');
    return form?Object.fromEntries(new URLSearchParams(raw)):JSON.parse(raw||'{}');
  }
  return async function handler(req) {
    const u=new URL(req.url),p=u.pathname;
    if(u.origin!==origin)return json({error:'INVALID_HOST'},400);
    try {
      if(req.method==='GET'&&p==='/health')return json({service:'navish-commander-personal',transport:'authenticated-mcp',version:catalog.version,connector:buildInfo??null});
      if(req.method==='GET'&&p==='/.well-known/oauth-protected-resource')return json(auth.protectedMetadata);
      if(req.method==='GET'&&p==='/.well-known/oauth-authorization-server')return json(auth.metadata);
      if(req.method==='POST'&&p==='/oauth/register')return json(auth.register(await body(req)),201);
      if(req.method==='GET'&&p==='/oauth/authorize') {
        const context=auth.authorize(Object.fromEntries(u.searchParams));
        const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Navish Commander</title><style>body{font:18px system-ui;max-width:600px;margin:10vh auto;padding:24px;color:#17332d}input,button{font:inherit;padding:12px;display:block;margin:16px 0;width:90%}button{background:#17332d;color:white;border:0}</style><h1>Connect your Commander</h1><p>This private connection can read files and run authorized commands on your paired machines. Only the installation owner can connect.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="context" value="${escapeHtml(context)}"><label>Installation password<input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Connect Commander</button></form></html>`;
        // Chromium checks form-action on the 303 OAuth callback as well.
        // The authorization validator restricts redirects to ChatGPT callbacks.
        return new Response(html,{headers:{...headers,'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'"}});
      }
      if(req.method==='POST'&&p==='/oauth/authorize') {
        if(req.headers.get('origin')!==origin)return json({error:'INVALID_ORIGIN'},403);
        const b=await body(req,true);
        return new Response(null,{status:303,headers:{...headers,location:auth.consent(b.context,b.password)}});
      }
      if(req.method==='POST'&&p==='/oauth/token')return json(await auth.token(await body(req,true)));
      if(p.startsWith('/agent/')) {
        if(!auth.agent(req.headers.get('authorization')))return json({error:'UNAUTHORIZED'},401);
        if(req.method==='POST'&&p==='/agent/heartbeat') {
          await store.setJSON('agent/heartbeat',{at:Date.now(),version:catalog.version});return json({accepted:true});
        }
        if(req.method==='POST'&&p==='/agent/result')return json(await queue.complete(await body(req)));
        return json({error:'NOT_FOUND'},404);
      }
      if(p!=='/mcp')return json({error:'NOT_FOUND'},404);
      let identity;
      try{identity=auth.access(req.headers.get('authorization'));}
      catch{return json({error:'AUTHENTICATION_REQUIRED'},401,{'www-authenticate':auth.challenge});}
      const requestOrigin=req.headers.get('origin');
      if(requestOrigin&&!['https://chatgpt.com',origin].includes(requestOrigin))return json({error:'INVALID_ORIGIN'},403);
      const parsed=req.method==='POST'?await body(req):undefined;
      const server=new Server({name:'navish-commander-personal',version:catalog.version},{capabilities:{tools:{}},
        instructions:'Use Commander for authorized machine work. Discover exact devices. Keep callId, sessionId, batchId and connector operationId stable across disconnects. Queued is not completed. Inspect commander_connector_receipt after a queued or missing response. Never mint a new mutation ID after an uncertain outcome. Inspect worker exit codes and artifacts. The Mac must be online; free hosting quotas apply. This connector does not provide or pay for model APIs.'});
      server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:protectedTools}));
      server.setRequestHandler(CallToolRequestSchema,async r=>{
        const args=r.params.arguments??{},callId=args.callId;
        try{
          if(r.params.name==='commander_connector_receipt'){
            if((!!args.operationId===!!callId)||(callId&&!callIdPattern.test(callId)))throw Error('INVALID_OPERATION_ID');
            return await queue.receipt(args.operationId??sha('mutation:'+callId));
          }
          return await queue.invoke(r.params.name,args);
        }catch(e){
          if(['UNKNOWN_TOOL','STABLE_CALL_ID_REQUIRED','CALL_ID_CONFLICT','INVALID_OPERATION_ID'].includes(e.message))
            return toolResult({state:'failed',code:e.message,dispatched:false,retrySafe:false},true);
          // A store acknowledgement may be lost after queue publication. Never
          // turn that observation failure into permission to replay a mutation.
          return toolResult({state:'uncertain',code:'CONNECTOR_RESPONSE_NOT_OBSERVED',retrySafe:false,
            ...(callIdPattern.test(callId??'')?{callId,operationId:sha('mutation:'+callId)}:{})},true);
        }
      });
      const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      await server.connect(transport);
      try{return await transport.handleRequest(req,{parsedBody:parsed,authInfo:{token:'[authenticated]',clientId:identity.client_id,scopes:[SCOPE]}});}
      finally{await server.close();}
    }catch(e){return json({error:e.message==='OWNER_AUTHENTICATION_REQUIRED'?'access_denied':'invalid_request'},400);}
  };
}
