/** Actual reviewer/shared pools under deterministic virtual time. All data/IO
 * synthetic; no provider, database, token-count endpoint or model request. */
import assert from 'node:assert/strict';
import {runPropsReview} from '../lib/playerPropsAi/reviewer';
import {propsAiGenerationPool} from '../lib/playerPropsAi/completionWindow';
import {propsAiGameAdmission} from '../lib/playerPropsAi/gameAdmission';
import {PRODUCT_RELEASE,type GamePacket,type Player} from '../lib/playerPropsAi/evidenceContract';
import {playerSubset} from '../lib/playerPropsAi/partitions';
import {readerEvidence,READER_AREAS} from '../lib/playerPropsAi/readerCoverage';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {GENERATIVE_WIRE_RELEASE,encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import {parseJointReview} from '../lib/playerPropsAi/request';
import type {PropsAiJob,PropsAiReviewStore} from '../lib/playerPropsAi/budget';
import {PROPS_AI_MAX_OUTPUT_PER_REQUEST,PROPS_AI_MAX_PARTS,PROPS_AI_PART_CONCURRENCY} from '../lib/playerPropsAi/releases';
globalThis.fetch=async()=>{throw Error('Whole-game virtual proof forbids network');};
const originalNow=Date.now,epoch=Date.parse('2030-11-17T17:36:00Z'),v=(n:number)=>Array<number>(16).fill(n);
const iso=(t:number)=>new Date(epoch+t).toISOString();
type Mode={games:number;parts:number;sourceMs:number;latencyMs:number;deadlineMs:number;gate?:boolean;knownRetry?:boolean;unknownGame?:number;receiptErrorGame?:number;claimErrorGame?:number;finishErrorGame?:number;strongCounts?:boolean};
type Event={type:string;game:number;at:number;part?:number;phase?:number;cutoff?:string};
function capturedPacket(game:number,parts:number,cutoff:number):GamePacket{
 const players:Player[]=Array.from({length:parts*5},(_,i)=>({id:`g${game}-p${i}`,name:`Synthetic Player ${i}`,team:'BUF',opponent:'MIN',markets:['receptions'],missing:[],evidence:[
  ...[4,6,8].map((receptions,j)=>({id:`g${game}-p${i}-log${j}`,kind:'recent_games' as const,source:'synthetic played stat game',availableAt:iso(0),value:{game:{startTime:`2030-11-${String(7+j).padStart(2,'0')}T18:00:00Z`,homeTeam:'BUF',awayTeam:'MIN'},box:{receptions,receiving_yards:receptions*10}}})),
  {id:`g${game}-p${i}-current-source`,kind:'availability',source:'synthetic ordinary current-source capture',availableAt:iso(cutoff),value:{status:'unknown',capturedAt:iso(cutoff)}}]}));
 return{release:PRODUCT_RELEASE,sport:'nfl',gameId:`synthetic-${game}`,start:iso(84*60000),lock:iso(24*60000),cutoff:iso(cutoff),stage:'final',players,quotes:[],sourceLimitations:[]};
}
function draft(p:GamePacket){
 const facts=readerEvidence(p),aliases=evidenceAliases(p);
 return{wireRelease:GENERATIVE_WIRE_RELEASE,players:Object.fromEntries(p.players.map(player=>[player.id,{assessment:'The supplied evidence supports a conditional forecast.',priorRead:{},coverage:Object.fromEntries(READER_AREAS.map(area=>[area,{status:facts[player.id][area].status,factIds:facts[player.id][area].facts.slice(0,1).map(f=>f.id),effect:'uncertain',observation:'The supplied context requires appropriate caution.'}])),evidenceIds:[[...aliases].find(([,id])=>id===player.evidence[0].id)![0]],gaps:[],confidence:[2],exceptions:[null],law:encodeCanonicalScenarioLaw('nfl',player,{weights:v(1),outcomes:{receptions:[4,8,...v(6).slice(2)]}})}]))};
}
async function simulation(mode:Mode,secondOrdinaryPass=false){
 let now=mode.sourceMs,active=0,peak=0,claims=0,sends=0,receipts=0,unknownReceipts=0,fallbacks=0,strongCounts=0;const inputCounts=0;
 const perGame=new Map<number,number>(),peakPerGame=new Map<number,number>(),events:Event[]=[],timers:{at:number;resolve:()=>void}[]=[];
 const jobs=new Map<number,PropsAiJob>();
 for(let i=0;i<mode.games;i++)jobs.set(i,{job_key:`props-ai|nfl|synthetic-${i}|2030-11-17|final`,sport:'nfl',game_id:`synthetic-${i}`,game_day:'2030-11-17',stage:'final',scheduled_start:iso(84*60000),lock_at:iso(24*60000),state:'pending',requested_tier:'default',model:'gpt-6-luna',parts:mode.parts} as PropsAiJob);
 Date.now=()=>epoch+now;
 function enter(game:number){active++;peak=Math.max(peak,active);const n=(perGame.get(game)??0)+1;perGame.set(game,n);peakPerGame.set(game,Math.max(peakPerGame.get(game)??0,n));assert(active<=16);assert(n<=PROPS_AI_PART_CONCURRENCY);}
 function leave(game:number){active--;perGame.set(game,perGame.get(game)!-1);}
 const sleep=(duration:number)=>new Promise<void>(resolve=>timers.push({at:now+duration,resolve}));
 async function runBatch(ids:number[],routeAt=0){
  now=routeAt+mode.sourceMs;
  const deadline=epoch+routeAt+mode.deadlineMs,globalSlot=propsAiGenerationPool(16),gameAdmission=propsAiGameAdmission(16);
  // Canonical site runtime pre-prepares all funded sources/counts before any
  // claim. Here exact valid prepared bounds are injected, never counted twice.
  const prepared=ids.map(i=>{assert.equal(jobs.get(i)!.state,'pending');const packet=capturedPacket(i,mode.parts,now),parts=Array.from({length:mode.parts},(_,n)=>({packet:playerSubset(packet,packet.players.slice(n*5,n*5+5).map(x=>x.id)),inputTokens:1000})),drafts=parts.map(part=>draft(part.packet));for(let n=0;n<parts.length;n++)parseJointReview(parts[n].packet,drafts[n]);events.push({type:'source',game:i,at:now,cutoff:packet.cutoff});return{i,packet,parts,drafts};});
  const work=prepared.map(({i,packet,parts,drafts})=>{
   const job=jobs.get(i)!,attempts=new Map<string,{phase:number;part:number}>();
   const store:PropsAiReviewStore={
    claim:async()=>{claims++;events.push({type:'claim',game:i,at:now});if(mode.claimErrorGame===i)throw Error('Synthetic claim storage failure');job.state='running';return{claimed:true,token:'synthetic',job};},
    send:async(_key,_token,phase,part)=>{assert(phase===1||phase===2);assert(part>=1&&part<=PROPS_AI_MAX_PARTS);const id=`${i}:${routeAt}:${phase}:${part}`;sends++;attempts.set(id,{phase,part});events.push({type:'send',game:i,part,phase,at:now});return{id,reserved_micro:100000,model:'gpt-6-luna',requested_tier:'default'};},
    receipt:async(_id,_token,actual)=>{receipts++;if(actual===null)unknownReceipts++;events.push({type:'receipt',game:i,at:now});if(mode.receiptErrorGame===i)throw Error('Synthetic immutable receipt failure');},
    fallback:async()=>{fallbacks++;events.push({type:'fallback',game:i,at:now});return true;},
    finish:async(_key,_token,result,error)=>{if(mode.finishErrorGame===i)throw Error('Synthetic terminal storage failure');Object.assign(job,{state:result?'completed':'failed',result,error_code:error});events.push({type:'finish',game:i,at:now});return{...job};},
   };
   const fetchImpl:typeof fetch=async(url,options)=>{
    assert.equal(String(url),'https://api.openai.com/v1/responses','No default input-token/provider request is allowed');
    const request=JSON.parse(String(options?.body));assert.equal(request.max_output_tokens,PROPS_AI_MAX_OUTPUT_PER_REQUEST);assert.equal(request.service_tier,'default');
    const ids=Object.keys(request.text.format.schema.properties.players.properties),n=parts.findIndex(part=>part.packet.players[0].id===ids[0]);assert(n>=0);
    const phase=attempts.has(`${i}:${routeAt}:2:${n+1}`)?2:1;enter(i);await sleep(mode.latencyMs);leave(i);
    return Response.json({id:`response-${i}-${routeAt}-${phase}-${n}`,model:request.model,status:mode.knownRetry&&phase===1?'incomplete':'completed',service_tier:'default',...(mode.unknownGame===i?{}:{usage:{input_tokens:1000,output_tokens:200}}),output:[{content:[{type:'output_text',text:JSON.stringify(drafts[n])}]}]});
   };
   return runPropsReview({packet,job,store,key:'synthetic',writerRunId:'synthetic',preferStronger:Boolean(mode.strongCounts),clock:()=>iso(now),deadline,generationSlot:globalSlot,...(mode.gate===false?{}:{gameAdmission}),prepare:async()=>parts,countStrong:async()=>{strongCounts++;enter(i);await sleep(1);leave(i);return 1000;},fetchImpl});
  });
  let done=false;const promise=Promise.allSettled(work).then(result=>{done=true;return result;});
  for(let guard=0;!done&&guard<2000;guard++){
   for(let flush=0;flush<100;flush++)await Promise.resolve();if(done)break;
   assert(timers.length>0,'Virtual responses must progress without real waits');
   now=Math.min(...timers.map(t=>t.at));const ready=timers.filter(t=>t.at===now);for(const timer of ready){timers.splice(timers.indexOf(timer),1);timer.resolve();}
  }
  assert(done,'Virtual reviewer must terminate');const results=await promise;
  return{completed:results.filter(r=>r.status==='fulfilled'&&r.value.status==='completed').length,failed:results.filter(r=>r.status==='fulfilled'&&r.value.status==='failed').length,skipped:results.filter(r=>r.status==='fulfilled'&&r.value.status==='skipped').length,rejected:results.filter(r=>r.status==='rejected').length};
 }
 try{
  const first=await runBatch([...jobs.keys()]),pending=[...jobs].filter(([,job])=>job.state==='pending').map(([id])=>id),closedBefore=JSON.stringify([...jobs].filter(([,job])=>job.state!=='pending'));
  const next=secondOrdinaryPass?await runBatch(pending,15*60000):null;
  if(secondOrdinaryPass)assert.equal(JSON.stringify([...jobs].filter(([id])=>!pending.includes(id))),closedBefore,'The next normal poll never resets/replays or rewrites any closed review');
  const summary={first,next,pendingBeforeNext:pending,pendingAfter:[...jobs].filter(([,job])=>job.state==='pending').map(([id])=>id),claims,sends,receipts,unknownReceipts,fallbacks,strongCounts,inputCounts,peak,peakPerGame:Math.max(...peakPerGame.values()),finishedAt:now,events};
  return summary;
 }finally{Date.now=originalNow;}
}
async function main(){
 const base={games:8,parts:8,sourceMs:120000,latencyMs:60000,deadlineMs:390000};
 const before=await simulation({...base,gate:false});assert.deepEqual(before.first,{completed:6,failed:2,skipped:0,rejected:0});assert.equal(before.claims,8);
 const fixed=await simulation(base,true);assert.deepEqual(fixed.first,{completed:6,failed:0,skipped:2,rejected:0});assert.deepEqual(fixed.pendingBeforeNext,[6,7]);assert.deepEqual(fixed.next,{completed:2,failed:0,skipped:0,rejected:0});assert.equal(fixed.pendingAfter.length,0);assert.equal(fixed.claims,8);assert.equal(fixed.sends,64);assert.equal(fixed.receipts,64);assert(fixed.finishedAt<24*60000);
 for(const id of [6,7]){const sources=fixed.events.filter(e=>e.type==='source'&&e.game===id);assert.equal(sources.length,2);assert(Date.parse(sources[1].cutoff!)>Date.parse(sources[0].cutoff!));assert(fixed.events.filter(e=>e.type==='claim'&&e.game===id).every(e=>e.at>=15*60000),'Deferred review is first claimed from fresh source on its next normal poll');}
 const fast=await simulation({...base,latencyMs:25000});assert.deepEqual(fast.first,{completed:8,failed:0,skipped:0,rejected:0});assert.equal(fast.sends,64);
 const three=await simulation({games:6,parts:3,sourceMs:350000,latencyMs:60000,deadlineMs:480000});assert.deepEqual(three.first,{completed:5,failed:0,skipped:1,rejected:0});assert.equal(three.claims,5);assert.equal(three.sends,15);assert.deepEqual(three.pendingBeforeNext,[5]);
 const retry=await simulation({games:3,parts:8,sourceMs:0,latencyMs:60000,deadlineMs:390000,knownRetry:true});assert.deepEqual(retry.first,{completed:3,failed:0,skipped:0,rejected:0});assert.equal(retry.sends,48);assert.equal(retry.fallbacks,3);assert(retry.events.find(e=>e.type==='claim'&&e.game===2)!.at>=120000,'Permit covers phase two and final receipts, not just phase-one sends');
 const unknown=await simulation({games:3,parts:8,sourceMs:0,latencyMs:60000,deadlineMs:390000,unknownGame:0});assert.deepEqual(unknown.first,{completed:2,failed:1,skipped:0,rejected:0});assert.equal(unknown.unknownReceipts,8);assert.equal(unknown.fallbacks,0);assert.equal(unknown.sends,24);
 const receiptError=await simulation({games:3,parts:8,sourceMs:0,latencyMs:1000,deadlineMs:390000,receiptErrorGame:0});assert.deepEqual(receiptError.first,{completed:2,failed:1,skipped:0,rejected:0});assert.equal(receiptError.fallbacks,0);
 const claimError=await simulation({games:3,parts:8,sourceMs:0,latencyMs:1000,deadlineMs:390000,claimErrorGame:0});assert.deepEqual(claimError.first,{completed:2,failed:0,skipped:0,rejected:1});assert.equal(claimError.sends,16);
 const finishError=await simulation({games:3,parts:8,sourceMs:0,latencyMs:1000,deadlineMs:390000,finishErrorGame:0});assert.deepEqual(finishError.first,{completed:2,failed:0,skipped:0,rejected:1});assert.equal(finishError.sends,24);assert.equal(finishError.fallbacks,0);
 const counted=await simulation({games:3,parts:16,sourceMs:0,latencyMs:1,deadlineMs:390000,strongCounts:true});assert.deepEqual(counted.first,{completed:3,failed:0,skipped:0,rejected:0});assert.equal(counted.strongCounts,48);assert.equal(counted.inputCounts,0);assert(counted.peak<=16);assert(counted.peakPerGame<=8);
 const primaryReserve=await simulation({games:1,parts:8,sourceMs:0,latencyMs:1000,deadlineMs:125000,strongCounts:true});assert.deepEqual(primaryReserve.first,{completed:1,failed:0,skipped:0,rejected:0});assert.equal(primaryReserve.strongCounts,0,'Optional stronger counting cannot consume the remaining primary completion reserve');assert.equal(primaryReserve.claims,1);assert.equal(primaryReserve.sends,8);
 for(const run of [fixed,fast,three,retry,unknown,receiptError,claimError,finishError,counted]){assert(run.peak<=16);assert(run.peakPerGame<=8);assert.equal(run.inputCounts,0);}
 console.log('Whole-game actual reviewer proof passed: original queue failure reproduced; six complete/two unclaimed then next normal pending-only fresh-source poll completes all eight before lock; five3-part parallel games/deferred sixth; fast recovery, bounded known retry, unknown/receipt/claim failures release permits, strong counts per-game8/global16, unchanged output/two phases. Virtual time; zero real HTTP/DB/token counts/paid calls. Not a general vendor completion guarantee.');
}
void main().catch(error=>{Date.now=originalNow;console.error(error);process.exitCode=1;});
