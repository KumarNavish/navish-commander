/** Protocol checks only. A valid operation envelope is not proof of goal completion. */
export class BrowserResultError extends Error {
  constructor(code,{dispatched=true,uncertain=true,exitCode=null}={}){
    super(code);Object.assign(this,{code,dispatched,uncertain,exitCode});
  }
}
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const safeCode=(value,fallback)=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(value)?value:fallback;

/** Inspect known protocol containers, never arbitrary extracted rows or page data. */
function failures(value,out,depth=0){
  if(!record(value))return;
  if(depth>12)throw new BrowserResultError('BROWSER_PROTOCOL_DEPTH_EXCEEDED');
  for(const key of ['ok','dispatched','uncertain','mayHaveLateEffects','executionStopped']){
    if(Object.hasOwn(value,key)&&typeof value[key]!=='boolean')throw new BrowserResultError('BROWSER_INVALID_RESULT');
  }
  if(value.ok===false||value.uncertain===true||value.mayHaveLateEffects===true||value.executionStopped===false)out.push(value);
  if(record(value.result))failures(value.result,out,depth+1);
  for(const step of Array.isArray(value.steps)?value.steps:[]){
    if(!record(step))continue;
    failures(step,out,depth+1);
    if(record(step.value))failures(step.value,out,depth+1);
  }
}
export function validateBrowserResult(value,{exitCode=0,signal=null}={}){
  if(!record(value)||typeof value.ok!=='boolean')throw new BrowserResultError('BROWSER_INVALID_RESULT',{exitCode});
  const bad=[];failures(value,bad);
  if(exitCode!==0||signal){
    // A lost exit acknowledgement cannot be resolved by an earlier success marker.
    if(value.ok===true||!Number.isInteger(exitCode)||signal)throw new BrowserResultError('BROWSER_PROCESS_UNCERTAIN',{exitCode});
  }
  if(bad.length){
    const e=bad[0], late=bad.some(x=>x.uncertain===true||x.mayHaveLateEffects===true||x.executionStopped===false);
    const dispatched=bad.some(x=>x.dispatched!==false);
    const uncertain=late||bad.some(x=>x.dispatched!==false&&x.uncertain!==false);
    throw new BrowserResultError(safeCode(e.errorCode||e.error,'BROWSER_OPERATION_FAILED'),{dispatched:late||dispatched,uncertain,exitCode});
  }
  if(exitCode!==0)throw new BrowserResultError('BROWSER_PROCESS_FAILED',{exitCode});
  return value;
}

/** Preserve explicit uncertainty across the outer Commander receipt boundary. */
export function executionFailureState(error,mutating){
  const e=error||{};
  const unknown=e.uncertain===true||e.mayHaveLateEffects===true||e.executionStopped===false||
    (e.dispatched!==false&&/timeout|socket|EIO|ECONN|closed|unknown/i.test(String(e.message)));
  return mutating&&unknown?'uncertain':'failed';
}
