/** Opt-in OAuth connection to the actual hosted comparator; never read browser tokens. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {auth} from '@modelcontextprotocol/sdk/client/auth.js';

const dir=path.resolve('.bench/rdc-auth');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const file=path.join(dir,'credentials.json');
const record=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
const save=()=>{
  const temporary=file+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify(record),{mode:0o600});
  fs.renameSync(temporary,file);fs.chmodSync(file,0o600);
};
export const serverUrl='https://mcp.desktopcommander.app/mcp';
export const provider={
  get redirectUrl(){return record.redirectUrl;},
  get clientMetadata(){return {client_name:'Navish Commander acceptance benchmark',redirect_uris:[record.redirectUrl],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'};},
  state(){return record.state;},
  clientInformation(){return record.client;},
  saveClientInformation(value){record.client=value;save();},
  tokens(){return record.tokens;},
  saveTokens(value){record.tokens=value;save();},
  saveCodeVerifier(value){record.verifier=value;save();},
  codeVerifier(){return record.verifier;},
  redirectToAuthorization(url){fs.writeFileSync(path.join(dir,'authorization-url.txt'),url.href,{mode:0o600});console.log('Authorization required: open .bench/rdc-auth/authorization-url.txt in your browser.');}
};

if(process.argv[1]===fileURLToPath(import.meta.url)){
  // A loopback callback has no execution API and accepts only this flow's state.
  const listener=http.createServer(async(req,res)=>{
    const url=new URL(req.url,record.redirectUrl);
    if(req.method!=='GET'||url.pathname!=='/callback'||url.searchParams.get('state')!==record.state){res.writeHead(400);res.end('Invalid OAuth callback');return;}
    const code=url.searchParams.get('code');
    if(!code){res.writeHead(400);res.end('Authorization was not completed');return;}
    try{
      const result=await auth(provider,{serverUrl,authorizationCode:code});
      res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});
      res.end('RDC benchmark connection authorized. You may close this page.');
      console.log(JSON.stringify({oauth:result,credentials:'stored locally with mode 0600'}));
      listener.close();clearTimeout(deadline);
    }catch{res.writeHead(502);res.end('Token exchange failed. No benchmark was submitted.');console.error('Token exchange failed');listener.close();clearTimeout(deadline);process.exitCode=1;}
  });
  await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const redirectUrl=`http://127.0.0.1:${listener.address().port}/callback`;
  if(record.redirectUrl!==redirectUrl){delete record.client;delete record.tokens;}
  record.redirectUrl=redirectUrl;record.state=crypto.randomBytes(32).toString('hex');save();
  const deadline=setTimeout(()=>{console.error('Authorization timed out; no benchmark was submitted.');listener.close();process.exitCode=1;},30*60*1000);
  try{
    const result=await auth(provider,{serverUrl,scope:'mcp:tools'});
    console.log(JSON.stringify({oauth:result}));
    if(result==='AUTHORIZED'){listener.close();clearTimeout(deadline);}
  }catch(e){console.error('OAuth setup failed: '+e.name);listener.close();clearTimeout(deadline);process.exitCode=1;}
}
