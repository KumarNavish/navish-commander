import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

export function sourceDigest(){
  const hash=crypto.createHash('sha256');
  for(const name of ['src/server.mjs',...fs.readdirSync('runtime/app/src').sort().map(n=>'runtime/app/src/'+n)]){
    if(fs.statSync(name).isFile())hash.update(name).update(fs.readFileSync(name));
  }
  return hash.digest('hex');
}
export function revision(){return execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();}
const median=a=>{a=[...a].sort((x,y)=>x-y);const k=Math.floor(a.length/2);return a.length%2?a[k]:(a[k-1]+a[k])/2;};
export function pairedThroughputInterval(samples){
  const pairs=samples.filter(s=>s.backend==='navish').map(a=>[a.elapsedMs,samples.find(b=>b.backend==='rdc'&&b.round===a.round).elapsedMs]);
  let seed=1729;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const ratios=[];
  for(let i=0;i<10000;i++){
    const chosen=Array.from({length:pairs.length},()=>pairs[Math.floor(random()*pairs.length)]);
    ratios.push(median(chosen.map(x=>x[1]))/median(chosen.map(x=>x[0])));
  }
  ratios.sort((a,b)=>a-b);
  return {method:'paired percentile bootstrap; seed 1729; 10000 resamples',level:.95,lower:ratios[250],upper:ratios[9749],
    scope:'uncertainty across these repeated workload rounds, not a future service guarantee'};
}
