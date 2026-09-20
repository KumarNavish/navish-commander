import crypto from 'node:crypto';

export const SCOPE='commander';
export const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const b64=x=>Buffer.from(x).toString('base64url');
const equal=(a,b)=>crypto.timingSafeEqual(Buffer.from(sha(a)),Buffer.from(sha(b)));
export const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function createAuth({origin,secret,ownerPasswordHash,agentToken,store,now=()=>Date.now()}) {
  if(!secret||secret.length<40||!ownerPasswordHash||!agentToken||agentToken.length<40)throw Error('CONNECTOR_SECRETS_MISSING');
  const resource=origin+'/mcp';
  function sign(type,data,seconds) {
    const body=b64(JSON.stringify({...data,type,iss:origin,iat:Math.floor(now()/1000),exp:Math.floor(now()/1000)+seconds}));
    return body+'.'+crypto.createHmac('sha256',secret).update(body).digest('base64url');
  }
  function verify(token,type) {
    if(typeof token!=='string'||token.length>12000)throw Error('INVALID_TOKEN');
    const [body,mac,...extra]=token.split('.');
    if(extra.length||!body||!mac||!equal(mac,crypto.createHmac('sha256',secret).update(body).digest('base64url')))throw Error('INVALID_TOKEN');
    const value=JSON.parse(Buffer.from(body,'base64url').toString());
    if(value.type!==type||value.iss!==origin||!Number.isSafeInteger(value.exp)||value.exp<=now()/1000)throw Error('EXPIRED_OR_INVALID_TOKEN');
    return value;
  }
  const redirectAllowed=s=>{
    try{const u=new URL(s);return u.origin==='https://chatgpt.com'&&!u.search&&!u.hash&&
      (u.pathname==='/connector_platform_oauth_redirect'||/^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(u.pathname));}catch{return false;}
  };
  function register(body) {
    if(!Array.isArray(body.redirect_uris)||body.redirect_uris.length<1||body.redirect_uris.length>8||!body.redirect_uris.every(redirectAllowed))throw Error('INVALID_REDIRECT_URI');
    if(body.token_endpoint_auth_method&&body.token_endpoint_auth_method!=='none')throw Error('UNSUPPORTED_CLIENT_AUTH');
    return {client_id:sign('client',{redirect_uris:body.redirect_uris,nonce:crypto.randomUUID()},365*86400),
      redirect_uris:body.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
  }
  function authorize(params) {
    const client=verify(params.client_id,'client');
    if(params.response_type!=='code'||!redirectAllowed(params.redirect_uri)||!client.redirect_uris.includes(params.redirect_uri))throw Error('INVALID_AUTHORIZATION_REQUEST');
    if(params.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge??''))throw Error('PKCE_S256_REQUIRED');
    if(params.resource!==resource||params.scope!==SCOPE||typeof params.state!=='string'||params.state.length>2048)throw Error('INVALID_RESOURCE_OR_SCOPE');
    return sign('consent',{client_id:params.client_id,redirect_uri:params.redirect_uri,challenge:params.code_challenge,state:params.state,aud:resource,scope:SCOPE},300);
  }
  function consent(context,password) {
    const a=verify(context,'consent');
    if(!equal(sha(password??''),ownerPasswordHash))throw Error('OWNER_AUTHENTICATION_REQUIRED');
    const code=sign('code',{...a,nonce:crypto.randomUUID()},90);
    const url=new URL(a.redirect_uri);url.searchParams.set('code',code);url.searchParams.set('state',a.state);url.searchParams.set('iss',origin);
    return url.toString();
  }
  function issue(clientId) {
    const claims={sub:'owner',client_id:clientId,aud:resource,scope:SCOPE,nonce:crypto.randomUUID()};
    return {access_token:sign('access',claims,3600),token_type:'Bearer',expires_in:3600,scope:SCOPE,refresh_token:sign('refresh',claims,30*86400)};
  }
  async function token(params) {
    if(params.resource!==resource)throw Error('INVALID_RESOURCE');
    verify(params.client_id,'client');
    if(params.grant_type==='refresh_token') {
      const r=verify(params.refresh_token,'refresh');
      if(r.client_id!==params.client_id||r.aud!==resource||r.sub!=='owner')throw Error('INVALID_GRANT');
      return issue(params.client_id);
    }
    if(params.grant_type!=='authorization_code')throw Error('UNSUPPORTED_GRANT_TYPE');
    const a=verify(params.code,'code');
    if(a.client_id!==params.client_id||a.redirect_uri!==params.redirect_uri||a.aud!==resource||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(params.code_verifier??'')||
      !equal(crypto.createHash('sha256').update(params.code_verifier).digest('base64url'),a.challenge))throw Error('INVALID_GRANT');
    const used=await store.setJSON('used-codes/'+sha(params.code),{expiresAt:a.exp},{onlyIfNew:true});
    if(!used.modified)throw Error('CODE_ALREADY_USED');
    return issue(params.client_id);
  }
  function access(header) {
    const m=/^Bearer (\S+)$/.exec(header??'');if(!m)throw Error('AUTHENTICATION_REQUIRED');
    const a=verify(m[1],'access');
    if(a.aud!==resource||a.scope!==SCOPE||a.sub!=='owner')throw Error('INVALID_ACCESS_TOKEN');
    return a;
  }
  return {resource,register,authorize,consent,token,access,
    agent:header=>equal(header??'','Bearer '+agentToken),
    challenge:`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="${SCOPE}"`,
    protectedMetadata:{resource,authorization_servers:[origin],scopes_supported:[SCOPE],bearer_methods_supported:['header']},
    metadata:{issuer:origin,authorization_endpoint:origin+'/oauth/authorize',token_endpoint:origin+'/oauth/token',registration_endpoint:origin+'/oauth/register',
      response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],
      code_challenge_methods_supported:['S256'],scopes_supported:[SCOPE],authorization_response_iss_parameter_supported:true}};
}
