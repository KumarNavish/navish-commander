#!/usr/bin/env node
/** TEST ONLY: documented TaskSpace/Page surface over real Chromium CDP.
 * This is NOT Ego Lite and is never included as an installed product backend.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
if(process.argv[2]==='--version'){console.log('TEST-ONLY Ego-helper fixture (real Chromium)');process.exit(0)}
if(process.argv[2]!=='nodejs')process.exit(2);
const source=fs.readFileSync(0,'utf8').replace('const uncertain=touched','fixtureError(error); const uncertain=touched');
const endpoint=process.env.NAVISH_TEST_CDP,store=process.env.NAVISH_TEST_SPACES;
if(!endpoint||!store)throw new Error('test fixture requires an isolated Chromium endpoint');
const socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
let seq=0;const waiting=new Map();
socket.addEventListener('message',event=>{const r=JSON.parse(String(event.data));if(!r.id)return;const pending=waiting.get(r.id);if(!pending)return;waiting.delete(r.id);r.error?pending.reject(new Error(r.error.message)):pending.resolve(r.result)});
function rpc(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++seq;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))})}
function load(){return fs.existsSync(store)?JSON.parse(fs.readFileSync(store,'utf8')):{spaces:{},calls:0}}
function save(data){const temp=store+'.tmp-'+process.pid;fs.writeFileSync(temp,JSON.stringify(data));fs.renameSync(temp,store)}
{const state=load();state.calls++;save(state)}
const connections=new Map();
async function taskSpace(value){
  let state=load(),space;
  if(typeof value==='number'){space=state.spaces[value];if(!space)throw new Error('test Space is absent')}
  else{
    const {browserContextId}=await rpc('Target.createBrowserContext');
    const id=crypto.randomInt(1,2**30);space={spaceId:id,name:value,browserContextId,pages:{}};
    state=load();state.spaces[id]=space;save(state);
  }
  return {...space,page(label){
    async function attach(){
      const key=space.spaceId+':'+label;if(connections.has(key))return connections.get(key);
      let latest=load().spaces[space.spaceId];let targetId=latest.pages[label];
      if(!targetId){
        ({targetId}=await rpc('Target.createTarget',{url:'about:blank',browserContextId:space.browserContextId}));
        const current=load();current.spaces[space.spaceId].pages[label]=targetId;save(current);
      }
      const {sessionId}=await rpc('Target.attachToTarget',{targetId,flatten:true});
      const connection={sessionId,targetId};connections.set(key,connection);return connection;
    }
    const page={label,spaceId:space.spaceId,
      async evaluate(expression){const {sessionId}=await attach();const r=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw new Error('test page evaluation failed');return r.result.value},
      async goto(url,{timeout=5000}={}){
        if(url!=='about:blank')throw new Error('offline fixture accepts only about:blank');
        const {sessionId}=await attach();
        // No network request and no policy overrides: populate an offline test document.
        const {frameTree}=await rpc('Page.getFrameTree',{},sessionId);
        await rpc('Page.setDocumentContent',{frameId:frameTree.frame.id,html:fs.readFileSync(process.env.NAVISH_TEST_HTML,'utf8')},sessionId);
        const end=Date.now()+timeout;while(Date.now()<end){if(await page.evaluate('document.readyState!=="loading"'))return {};await new Promise(r=>setTimeout(r,15))}throw new Error('offline document did not settle');
      },
      async url(){return page.evaluate('location.href')},
    };
    return page;
  }};
}
async function listTaskSpaces(){return Object.values(load().spaces).map(s=>({id:s.spaceId,name:s.name,ownership:'agent'}))}
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const fixtureError=error=>{if(process.env.NAVISH_TEST_ERRORS)fs.appendFileSync(process.env.NAVISH_TEST_ERRORS,String(error.stack)+'\n')};
try{await new AsyncFunction('taskSpace','listTaskSpaces','fixtureError',source)(taskSpace,listTaskSpaces,fixtureError)}catch(error){console.error(error);process.exit(1)}
