// One source for the existing native safety invariants. Ego executes the same
// audited DOM resolver inside its task-specific Page; no second selector engine.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const native=fs.readFileSync(fileURLToPath(new URL('../bin/navish-browser-safe.py',import.meta.url)),'utf8');
const match=native.match(/DOM = r'''([\s\S]*?)'''/);
if(!match)throw new Error('CANONICAL_BROWSER_DOM_MISSING');
const EXTRA=String.raw`
if (cfg.action === 'verify') {
  // Every supplied condition is a conjunction; absence must never erase a URL failure.
  const c=cfg.condition;
  if(!c||typeof c!=='object'||Array.isArray(c))return fail('INVALID_CONDITION');
  const keys=Object.keys(c),allowed=new Set(['url','selector','text','value','absent']);
  if(!keys.length||keys.some(k=>!allowed.has(k)))return fail('INVALID_CONDITION');
  if(['url','selector','text','value'].some(k=>c[k]!==undefined&&typeof c[k]!=='string'))return fail('INVALID_CONDITION');
  if(c.selector!==undefined&&!c.selector.trim())return fail('INVALID_CONDITION');
  if(c.absent!==undefined&&typeof c.absent!=='boolean')return fail('INVALID_CONDITION');
  if((c.absent!==undefined||c.value!==undefined)&&c.selector===undefined)return fail('INVALID_CONDITION');
  if(c.absent===true&&(c.text!==undefined||c.value!==undefined))return fail('CONTRADICTORY_CONDITION');
  let matched=true,checks=0;
  if(c.url!==undefined){matched=matched&&location.href===c.url;checks++}
  if(c.selector!==undefined){
    let xs;try{xs=Array.from(document.querySelectorAll(c.selector)).filter(visible)}catch{return fail('INVALID_SELECTOR')}
    // "absent" means no visible matches; it does not assert DOM detachment.
    const exists=c.absent===true?xs.length===0:xs.length===1;
    matched=matched&&exists;checks++;
    if(c.text!==undefined){matched=matched&&xs.length===1&&text(xs[0])===norm(c.text);checks++}
    if(c.value!==undefined){
      if(xs.length===1&&(xs[0].type==='password'||/password|one-time-code/i.test(xs[0].autocomplete||'')))return fail('SENSITIVE_FIELD');
      const e=xs[0];
      if(e&&!e.isContentEditable&&!['INPUT','TEXTAREA','SELECT'].includes(e.tagName))return fail('NOT_VALUE_FIELD');
      matched=matched&&xs.length===1&&(e.isContentEditable?e.textContent:e.value)===c.value;checks++;
    }
  }else if(c.text!==undefined){matched=matched&&(document.body?.innerText||'').includes(c.text);checks++}
  return {ok:true,matched:checks>0&&matched,checks};
}
if(cfg.action==='extract'||cfg.action==='read-field'){
  let xs;try{xs=Array.from(document.querySelectorAll(cfg.selector||'main')).filter(visible)}catch{return fail('INVALID_SELECTOR')}
  if(cfg.action==='read-field'){
    if(xs.length!==1)return fail(xs.length?'AMBIGUOUS_TARGET':'NOT_FOUND');
    const e=xs[0];if(e.type==='password'||/password|one-time-code/i.test(e.autocomplete||''))return fail('SENSITIVE_FIELD');
    if(!e.isContentEditable&&!['INPUT','TEXTAREA'].includes(e.tagName))return fail('NOT_EDITABLE');
    return {ok:true,content:String(e.isContentEditable?e.textContent:e.value).slice(0,12000),targetedRead:true};
  }
  const rows=xs.slice(0,Math.min(40,cfg.limit||10)).map(e=>{
    let body='';const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
    for(let n=walker.nextNode();n&&body.length<12000;n=walker.nextNode()){
      const p=n.parentElement;if(p&&visible(p)&&!p.closest('input,textarea,[contenteditable],script,style,noscript,select,[data-private]'))body+=' '+norm(n.textContent);
    }
    return {text:body.trim().slice(0,Math.min(12000,cfg.maxChars||6000)),...(e.matches('a[href]')?{href:e.href}:{})};
  });return {ok:true,url:location.href,title:document.title,rows,totalMatches:xs.length};
}
`;
function replaceOnce(source,needle,replacement){
  if(source.split(needle).length!==2)throw new Error('CANONICAL_BROWSER_DOM_ANCHOR_CHANGED');
  return source.replace(needle,replacement);
}
let body=replaceOnce(match[1],"if (cfg.action === 'snapshot')",EXTRA+"\nif (cfg.action === 'snapshot')");
body=replaceOnce(body,"if (e.isContentEditable) {\n    e.textContent = value;",`if (e.isContentEditable) {
    const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(e);selection.removeAllRanges();selection.addRange(range);
    let inserted=false;try{inserted=document.execCommand('insertText',false,value)}catch{}
    if(!inserted)e.textContent=value;`);
body=replaceOnce(body,"const value = String(cfg.value);",`if(Object.prototype.hasOwnProperty.call(cfg,'expectedValue')&&(e.isContentEditable?e.textContent:e.value)!==cfg.expectedValue)return fail('VALUE_CHANGED');
  const value = String(cfg.value);`);
body=replaceOnce(body,"if (cfg.action === 'click' || cfg.action === 'click-text')",`if(cfg.action==='select'){
  if(e.readOnly||e.getAttribute('aria-readonly')==='true')return fail('READONLY');
  if(e.tagName!=='SELECT')return fail('NOT_SELECT');
  if(!Array.from(e.options).some(o=>o.value===cfg.value&&!o.disabled))return fail('OPTION_MISSING');
  e.value=cfg.value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
  return e.value===cfg.value?{ok:true,dispatched:true,verified:true}:{ok:false,error:'VALUE_REJECTED',dispatched:true};
}
if (cfg.action === 'click' || cfg.action === 'click-text')`);
export function browserScript(cfg){
  return `(()=>{const cfg=${JSON.stringify(cfg)};try{const run=()=>{${body}\n};return run()}catch{return {ok:false,error:'DOM_ERROR',uncertain:!['verify','snapshot','wait-text','wait-selector','extract','read-field'].includes(cfg.action)}}})()`;
}
export function redact(value){
  if(typeof value==='string')return value.replace(/([?&](?:access_token|refresh_token|id_token|api_key|token|code|client_secret|session_token)=)[^&#\s]*/gi,'$1[omitted]').replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,'[secret omitted]').replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{10,}/gi,'Bearer [omitted]');
  if(Array.isArray(value))return value.map(redact);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[
    k,/^(?:password|passwd|passphrase|secret|clientsecret|apikey|authorization|proxyauthorization|cookie|setcookie|accesstoken|refreshtoken|idtoken|sessiontoken|privatekey)$/i.test(k.replace(/[-_\s]/g,''))?'[secret omitted]':redact(v)
  ]));
  return value;
}
