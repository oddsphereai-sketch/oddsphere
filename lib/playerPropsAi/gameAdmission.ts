import {PROPS_AI_MAX_PARTS,PROPS_AI_PART_CONCURRENCY} from './releases';

export type PropsAiGamePermit=()=>void;
export type PropsAiGameAdmission=(parts:number)=>Promise<PropsAiGamePermit>;

/** Whole-game opportunity, separate from money and per-request concurrency.
 * The caller holds the permit through all phases, receipts and finish, rechecks
 * its actual deadline after waiting, and releases in finally. No IO or claims. */
export function propsAiGameAdmission(limit=16):PropsAiGameAdmission{
 if(!Number.isInteger(limit)||limit<1||limit>16)throw Error('Invalid whole-game admission capacity');
 let active=0;
 const waiting:{weight:number;resolve:(release:PropsAiGamePermit)=>void}[]=[];
 function permit(weight:number):PropsAiGamePermit{
  active+=weight;let released=false;
  return()=>{
   if(released)return;released=true;active-=weight;
   // FIFO is deliberate: a later small game cannot starve the queued head.
   while(waiting.length&&active+waiting[0].weight<=limit){const next=waiting.shift()!;next.resolve(permit(next.weight));}
  };
 }
 return async parts=>{
  if(!Number.isInteger(parts)||parts<1||parts>PROPS_AI_MAX_PARTS)throw Error('Invalid whole-game admission part count');
  const weight=Math.min(parts,PROPS_AI_PART_CONCURRENCY);
  if(weight>limit)throw Error('Whole-game admission weight exceeds capacity');
  if(!waiting.length&&active+weight<=limit)return permit(weight);
  return new Promise<PropsAiGamePermit>(resolve=>waiting.push({weight,resolve}));
 };
}
