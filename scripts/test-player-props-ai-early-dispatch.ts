/** Actual live source and reviewer/transport boundary; all SQL/HTTP is mocked. */
import assert from "node:assert/strict";
import {liveNbaPacket} from "../lib/playerPropsAi/liveSources";
import {runPropsReview,type AcceptedGameReview} from "../lib/playerPropsAi/reviewer";
import type {PropsAiJob,PropsAiReviewStore} from "../lib/playerPropsAi/budget";
import type {GamePacket} from "../lib/playerPropsAi/evidenceContract";
import {playerSubset} from "../lib/playerPropsAi/partitions";
import {evidenceAliases} from "../lib/playerPropsAi/input";
import {independentPriorEvents} from "../lib/playerPropsAi/priorEvents";
import {encodeCanonicalScenarioLaw} from "../lib/playerPropsAi/generativeCoordinates";
import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {digest} from "../lib/playerPropsAi/evidence";
import {verifiedReaderFixture} from "./lib/player-props-ai-reader-fixture";
import {generateAiReview,AiRequestNotStartedError,type AiRequest} from "../lib/playerPropsAi/openai";

globalThis.fetch=async()=>{throw Error("Early dispatch proof forbids real network");};
const boundary="2030-11-17T19:35:00.000Z",before="2030-11-17T19:34:59.999Z",after="2030-11-17T19:35:09.000Z";
const start="2030-11-17T21:00:00Z",lock="2030-11-17T20:00:00Z",sourceAt="2030-11-17T19:34:58Z";
const v=(n:number)=>Array<number>(16).fill(n);
function source(stage:"early"|"final",cutoff:string):GamePacket{
 const game={id:"synthetic-current-game",start,away:"BOS",home:"NYK"};
 const state={updatedAt:sourceAt,games:[{gameId:1,homeTeamId:1,awayTeamId:2,homeTeam:"BOS",awayTeam:"NYK",startTime:"2030-11-01T20:00:00Z"}],boxes:[],advanced:[],players:[]};
 const native=[9001,9002].map(id=>({gameId:game.id,scheduledStart:start,playerId:`nba-bdl-player:${id}`,playerName:`Synthetic ${id}`,team:"BOS",opponent:"NYK",market:"points",line:20.5,side:"over",independentSide:"over",independentProbability:.6,independentProjection:21,evaluatedAt:sourceAt,modelRelease:"synthetic-native",role:[],production:[],matchup:[],lockedAt:null}));
 const offers=native.flatMap(row=>["over","under"].map((side,i)=>({canonicalPlayerId:row.playerId,canonicalGameId:game.id,playerName:row.playerName,playerTeam:"1",market:"points",sportsbook:"synthetic",line:20.5,side,americanPrice:-110,provider:"balldontlie",providerObservationId:`${row.playerId}:${i}`,isOpening:false,isLive:false,observedAt:sourceAt,receivedAt:sourceAt,fetchedAt:sourceAt})));
 const packet=liveNbaPacket({game,window:{gameId:game.id,stage,cutoff,lock},snapshot:{generatedAt:sourceAt,slateDate:"2030-11-17",games:[{gameId:game.id,scheduledStart:start,awayTeam:"BOS",homeTeam:"NYK"}],decisions:native},market:{updatedAt:sourceAt,observations:offers},prior:state,current:state,currentObservations:offers} as never);
 assert.equal(packet.sourceOfferSetStatus,"nonempty");assert.equal(packet.players.length,2);assert.equal(packet.executionQuotes?.length,4);
 return packet;
}
function draft(packet:GamePacket){
 const aliases=evidenceAliases(packet),alias=(id:string)=>[...aliases].find(([,value])=>value===id)![0];
 return {wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(packet.players.map(p=>[p.id,verifiedReaderFixture(packet,p.id,{priorRead:Object.fromEntries(independentPriorEvents(p).map(e=>[alias(e.sourceId),e.preferredOutcome])),evidenceIds:[alias(p.evidence[0].id)],gaps:[],confidence:[2],exceptions:[null],law:encodeCanonicalScenarioLaw("nba",p,{weights:v(1),outcomes:{points:[16,24,...v(20).slice(2)],rebounds:v(4),assists:v(3),threes:v(1)}})})]))};
}
type Mode="claim_boundary"|"claim_after"|"send_boundary"|"send_after"|"queue"|"phase2_ack"|"phase2_queue"|"phase2_send"|"receipt_boundary"|"mixed_unknown_unsent"|"exact_boundary"|"early_positive"|"final_positive";
type Attempt={id:string;phase:number;part:number;actual:number|null|undefined;reserved:number;kind?:string};
async function exercise(mode:Mode){
 let tick=mode==="exact_boundary"?boundary:mode==="final_positive"?after:before,claims=0,sends=0,calls=0,fallbacks=0,finishes=0,slots=0;
 const stage=mode==="final_positive"?"final":"early",packet=source(stage,tick),original=digest(packet);
 const parts=packet.players.map(p=>({packet:playerSubset(packet,[p.id]),inputTokens:1000}));
 const attempts:Attempt[]=[],dispatched:{phase:number;part:number;at:string}[]=[],receipts:Attempt[]=[];
 let held=0,finishedReview:AcceptedGameReview|null=null;
 const job={job_key:`synthetic:${mode}`,sport:"nba",game_id:packet.gameId,game_day:"2030-11-17",stage,scheduled_start:start,lock_at:lock,state:"pending"} as PropsAiJob;
 const store:PropsAiReviewStore={
  claim:async(_key,_hash,requests)=>{claims++;assert.equal(requests.length,2,"Every offered actor remains in the claim");if(mode==="claim_boundary")tick=boundary;if(mode==="claim_after")tick=after;return{claimed:true,token:"synthetic-token",job:{...job,state:"running",model:"gpt-6-luna",requested_tier:"default"}};},
  send:async(_key,_token,phase,part)=>{sends++;assert(!attempts.some(a=>a.phase===phase&&a.part===part));const attempt={id:`synthetic:${phase}:${part}`,phase,part,actual:undefined,reserved:10000};attempts.push(attempt);if(mode==="send_boundary"||mode==="phase2_send"&&phase===2)tick=boundary;if(mode==="send_after")tick=after;return{id:attempt.id,reserved_micro:attempt.reserved,model:"gpt-6-luna",requested_tier:"default"};},
  receipt:async(id,_token,actual,_response,usage)=>{const a=attempts.find(a=>a.id===id)!;assert(a);assert.equal(a.actual,undefined,"No original charge receipt may be rewritten");a.actual=actual;a.kind=(usage as {kind?:string}).kind;receipts.push({...a});if(mode==="receipt_boundary")tick=boundary;},
  fallback:async()=>{fallbacks++;assert(Date.parse(tick)<Date.parse(boundary)||stage==="final","No fallback authorization after early final-only boundary");if(mode==="phase2_ack")tick=boundary;return true;},
  finish:async(_key,_token,result,error)=>{finishes++;held=attempts.reduce((sum,a)=>sum+(a.actual===undefined?0:a.actual===null?a.reserved:a.actual),0);finishedReview=result?{...(result as AcceptedGameReview),issuedAt:tick}:null;return{...job,state:result?"completed":"failed",result:finishedReview,error_code:error};},
 };
 const result=await runPropsReview({packet,job,store,key:"synthetic-never-real",writerRunId:"synthetic-owner",preferStronger:false,clock:()=>tick,deadline:Date.now()+300000,prepare:async()=>parts,
  generationSlot:async run=>{slots++;if(mode==="queue"||mode==="phase2_queue"&&slots>2)tick=boundary;return run();},
  fetchImpl:async(url,options)=>{
   assert.equal(String(url),"https://api.openai.com/v1/responses","No provider or input-count HTTP");
   const body=JSON.parse(String(options?.body)),ids=Object.keys(body.text.format.schema.properties.players.properties);
   const part=parts.find(part=>part.packet.players[0].id===ids[0])!;assert(part);assert.deepEqual(ids,part.packet.players.map(p=>p.id));
   const phase=fallbacks?2:1,partNumber=parts.indexOf(part)+1;calls++;dispatched.push({phase,part:partNumber,at:tick});
   assert(stage==="final"||Date.parse(tick)<Date.parse(boundary),"No early HTTP starts at/after final due");
   if(mode==="mixed_unknown_unsent"){tick=boundary;throw Error("Synthetic genuinely dispatched unknown outcome");}
   const invalid=["phase2_ack","phase2_queue","phase2_send","receipt_boundary"].includes(mode);
   if(mode==="early_positive"&&calls===2)tick="2030-11-17T19:35:01.000Z";
   return Response.json({id:`synthetic-response:${phase}:${partNumber}`,model:"gpt-6-luna",status:"completed",service_tier:"default",usage:{input_tokens:1000,output_tokens:200},output:[{content:[{type:"output_text",text:JSON.stringify(invalid?{}:draft(part.packet))}]}]});
  },
 });
 assert.equal(digest(packet),original,"Sources, all actors and markets remain unchanged");
 const positive=mode==="early_positive"||mode==="final_positive";
 if(mode==="exact_boundary"){assert.equal(result.status,"skipped");assert.equal(claims,0);assert.equal(finishes,0);}
 else{assert.equal(claims,1);assert.equal(finishes,1);assert.equal(result.status,positive?"completed":"failed");}
 if(positive){assert.equal(calls,2);assert.equal(sends,2);assert.equal(receipts.length,2);assert.equal(fallbacks,0);assert(finishedReview);assert.deepEqual((finishedReview as AcceptedGameReview).players.map(p=>p.playerId).sort(),packet.players.map(p=>p.id).sort());assert((finishedReview as AcceptedGameReview).players.every(p=>p.law));}
 else if(["claim_boundary","claim_after","queue","exact_boundary"].includes(mode)){assert.equal(calls,0);assert.equal(sends,0);assert.equal(receipts.length,0);assert.equal(fallbacks,0);assert.equal(held,0);}
 else if(["send_boundary","send_after"].includes(mode)){assert.equal(calls,0);assert.equal(sends,1);assert.equal(receipts.length,1);assert(receipts.every(r=>r.actual===0&&r.kind==="known_unbilled_before_http"));assert.equal(fallbacks,0);assert.equal(held,0);}
 else if(mode==="mixed_unknown_unsent"){assert.equal(calls,1);assert.equal(sends,2);assert.equal(receipts.length,2);assert.equal(fallbacks,0);assert.equal(receipts.filter(r=>r.actual===null).length,1);assert.equal(receipts.filter(r=>r.actual===0&&r.kind==="known_unbilled_before_http").length,1);assert.equal(held,10000,"Genuinely unknown dispatched charge remains held when an unsent sibling is zeroed");}
 else{assert.equal(calls,2);assert.equal(fallbacks,mode==="receipt_boundary"?0:1);assert.equal(held,400,"Both original actual charge receipts remain exact");if(mode==="phase2_send"){assert.equal(sends,3);assert.equal(receipts.filter(r=>r.phase===2&&r.actual===0&&r.kind==="known_unbilled_before_http").length,1);}else assert.equal(sends,2);}
 return{mode,claims,sends,calls,fallbacks,held,receiptCharges:receipts.map(r=>r.actual),status:result.status};
}
async function main(){
 // Transport resamples the stage predicate AFTER its own serialization too.
 let current=true,http=0;
 const body:AiRequest={model:"gpt-6-luna",instructions:"Synthetic only",input:"{}",max_output_tokens:7000,store:false,text:{toJSON(){current=false;return {};}}};
 await assert.rejects(generateAiReview(body,{key:"synthetic",timeoutMs:120000,minimumTimeoutMs:90000,canStart:()=>current,fetchImpl:async()=>{http++;throw Error("Closed stage cannot dispatch");}}),AiRequestNotStartedError);
 assert.equal(http,0);
 const modes:Mode[]=["claim_boundary","claim_after","send_boundary","send_after","queue","phase2_ack","phase2_queue","phase2_send","receipt_boundary","mixed_unknown_unsent","exact_boundary","early_positive","final_positive"];
 const results=[];for(const mode of modes)results.push(await exercise(mode));
 console.log(JSON.stringify({proof:"actual_source_reviewer_early_dispatch_boundary",allSQLAndHTTPMocked:true,results}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
