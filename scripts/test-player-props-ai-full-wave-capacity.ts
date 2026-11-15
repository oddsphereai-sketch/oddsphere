import assert from 'node:assert/strict';
import {prepareReviewParts} from '../lib/playerPropsAi/partitions';
import {runPropsReview} from '../lib/playerPropsAi/reviewer';
import {propsAiTwoPhaseCompletionWindowMs} from '../lib/playerPropsAi/completionWindow';
import {PRODUCT_RELEASE,type GamePacket} from '../lib/playerPropsAi/evidenceContract';
import type {PropsAiJob} from '../lib/playerPropsAi/budget';
globalThis.fetch=async()=>{throw Error('Supported full-wave proof denies real network');};
async function main(){
const now='2030-11-17T14:00:00Z',start='2030-11-17T18:00:00Z',lock='2030-11-17T17:00:00Z';
const packet:GamePacket={release:PRODUCT_RELEASE,sport:'nfl',gameId:'synthetic-capacity',start,lock,cutoff:now,stage:'early',players:Array.from({length:9},(_,i)=>({id:'p'+i,name:'Synthetic '+i,team:'NE',opponent:'DET',markets:['receptions'],missing:[],evidence:[{id:'e'+i,kind:'recent_games',source:'synthetic played game',availableAt:now,value:{game:{startTime:'2030-11-10T18:00:00Z',awayTeam:'NE',homeTeam:'DET'},box:{receptions:5,receiving_yards:50}}}]})),quotes:[],sourceLimitations:[]};
const stages:number[]=[];
const parts=await prepareReviewParts(packet,{key:'synthetic',count:async p=>p.players.length===1?1000:145001,onCountStage:n=>stages.push(n)});
assert.equal(parts.length,9);assert.equal(new Set(parts.flatMap(p=>p.packet.players.map(p=>p.id))).size,9);
const job={job_key:'synthetic',game_id:packet.gameId,sport:'nfl',scheduled_start:start,lock_at:lock,game_day:'2030-11-17',stage:'early',state:'pending'} as PropsAiJob;
const realNow=Date.now,fixed=Date.parse(now);Date.now=()=>fixed;
let claims=0;const store={claim:async()=>{claims++;return{claimed:false,reason:'synthetic_stop_before_money'};}} as never;
const outcomes=[];
try{
 for(const prep of [0,108000,128430]){
  const result=await runPropsReview({packet,job,store,key:'synthetic',writerRunId:'mock',preferStronger:false,clock:()=>now,deadline:fixed+480000-prep,prepare:async()=>parts});
  outcomes.push({preparationMs:prep,remainingMs:480000-prep,reserveMs:propsAiTwoPhaseCompletionWindowMs(parts.length),result});
 }
 assert.equal(claims,3,'All supported complete preparations can reach claim, with no real claim or HTTP');
 for(const outcome of outcomes){assert.equal(outcome.reserveMs,240000);assert.equal('reason'in outcome.result&&outcome.result.reason,'synthetic_stop_before_money');}
 const preparationDeadline=480000-128430-propsAiTwoPhaseCompletionWindowMs(9)-10000;
 assert.equal(preparationDeadline,101570,'Full-wave count opportunity preserves both phases and the original count cushion');
 console.log(JSON.stringify({passed:true,parts:9,claims,completeTwoPhaseReserve:240000,countStageNineDeadlineMs:preparationDeadline,noCurrentGameCountClaim:true,noNetworkOrProviderOrPaidActivity:true}));
}finally{Date.now=realNow;}

}
main().catch(e=>{console.error(e);process.exitCode=1;});
