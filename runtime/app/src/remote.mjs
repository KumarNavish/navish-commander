import { run, shellQuote } from './util.mjs';
import { loadDevices, saveDevices } from './config.mjs';

export function pairAdd({name,sshSpec,navishPath='~/.local/bin/navish'},P){
  if(!/^[A-Za-z0-9._-]{1,100}$/.test(name||'')) throw new Error('invalid device name');
  if(!sshSpec) throw new Error('ssh target required');
  const probe=run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10',sshSpec,'true'],{timeoutMs:15000});
  if(probe.code!==0) throw new Error(`SSH verification failed: ${probe.stderr||probe.stdout||probe.error}`);
  const d=loadDevices(P); d.devices[name]={name,ssh:sshSpec,navishPath,addedAt:new Date().toISOString()}; saveDevices(d,P); return d.devices[name];
}
export function pairRemove(name,P){const d=loadDevices(P); const existed=!!d.devices[name]; delete d.devices[name]; saveDevices(d,P); return {name,removed:existed};}
export function listDevices(P){const d=loadDevices(P); return [{id:'local',type:'local',online:true},...Object.values(d.devices).map(x=>({id:x.name,type:'ssh',ssh:x.ssh,online:null}))];}
export function remoteOutcome(r,{device,callId}){
  const uncertain=(code,reason)=>({callId,targetDevice:device,state:'uncertain',code,reason,
    safeToRetry:false,reconcileCallId:callId,result:null,exitCode:r.code,signal:r.signal||null});
  // ssh may exit 255 when spawnSync times out. Exit status alone cannot tell
  // whether the remote command ran, and a lost reply is not a failed action.
  if(r.error||r.signal||r.code===null)return uncertain('REMOTE_TRANSPORT_UNCERTAIN',r.error||'Remote transport ended without a verified receipt');
  let receipt;try{receipt=JSON.parse(r.stdout)}catch{return uncertain('REMOTE_RECEIPT_UNAVAILABLE','Remote command returned no valid receipt; inspect the same call ID before another mutation')}
  if(!receipt||receipt.callId!==callId||!['accepted','running','completed','failed','expired','uncertain'].includes(receipt.state))
    return uncertain('REMOTE_RECEIPT_IDENTITY_INVALID','Remote receipt identity or state did not match the submitted call');
  if(r.code!==0&&receipt.state==='completed')return uncertain('REMOTE_RECEIPT_CONFLICT','Remote completion receipt conflicts with the transport exit status');
  return {...receipt,targetDevice:device};
}
export function remoteCall({device,tool,args,callId,resources=[],timeoutMs=120000},P){
  const d=loadDevices(P).devices[device]; if(!d) throw new Error(`unknown device: ${device}`);
  const payload=Buffer.from(JSON.stringify(args||{}),'utf8').toString('base64');
  const res=Buffer.from(JSON.stringify(resources||[]),'utf8').toString('base64');
  const remote=`${d.navishPath||'~/.local/bin/navish'} call local ${shellQuote(tool)} --args-b64 ${shellQuote(payload)} --resources-b64 ${shellQuote(res)} --call-id ${shellQuote(callId)} --json`;
  const r=run('ssh',['-o','BatchMode=yes',d.ssh,remote],{timeoutMs:Number(timeoutMs),maxBuffer:16*1024*1024});
  return remoteOutcome(r,{device,callId});
}
