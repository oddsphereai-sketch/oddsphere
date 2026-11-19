import {PROPS_AI_MAX_PARTS,PROPS_AI_PART_CONCURRENCY} from './releases';
import type {PropsAiGameAdmission,PropsAiGamePermit} from './gameAdmission';

/** One existing writer only. Counts use one unit; a prepared game reserves its
 * complete concurrent generation wave through both phases and all receipts.
 * Ready games get FIFO priority over unstarted counts, without preempting an
 * actual HTTP request or increasing the established physical concurrency cap. */
export function propsAiWorkAdmission(limit=16){
 if(!Number.isInteger(limit)||limit<1||limit>16)throw Error('Invalid review work capacity');
 let used=0;
 const games:{weight:number;resolve:(release:PropsAiGamePermit)=>void}[]=[],counts:((release:PropsAiGamePermit)=>void)[]=[];
 function permit(weight:number):PropsAiGamePermit{
  used+=weight;let released=false;
  return()=>{if(released)return;released=true;used-=weight;drain();};
 }
 function drain(){
  while(games.length&&used+games[0].weight<=limit){const next=games.shift()!;next.resolve(permit(next.weight));}
  if(games.length)return;
  while(counts.length&&used<limit)counts.shift()!(permit(1));
 }
 const game:PropsAiGameAdmission=async parts=>{
  if(!Number.isInteger(parts)||parts<1||parts>PROPS_AI_MAX_PARTS)throw Error('Invalid review work part count');
  const weight=Math.min(parts,PROPS_AI_PART_CONCURRENCY);
  if(weight>limit)throw Error('Prepared game exceeds review work capacity');
  return new Promise<PropsAiGamePermit>(resolve=>{games.push({weight,resolve});drain();});
 };
 const count=async<T>(run:()=>Promise<T>):Promise<T>=>{
  const release=await new Promise<PropsAiGamePermit>(resolve=>{counts.push(resolve);drain();});
  try{return await run();}finally{release();}
 };
 return{game,count};
}
