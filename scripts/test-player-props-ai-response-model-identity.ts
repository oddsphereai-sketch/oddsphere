import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {runPropsReview} from "../lib/playerPropsAi/reviewer";
import {usageMicroUsd,verifiedUsageMicroUsd,type PropsAiJob} from "../lib/playerPropsAi/budget";
import {PRODUCT_RELEASE,type GamePacket} from "../lib/playerPropsAi/evidenceContract";
import {PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL,PROPS_AI_RELEASE,
 propsReviewHasMemberExecutionContracts,propsReviewHasVerifiedReaderClaims,type PropsAiModel} from "../lib/playerPropsAi/releases";
import {PROPS_AI_RESPONSE_MODEL_IDENTITY_RELEASE,responseModelIdentity,responseTierIdentity,responseReferenceIdentity} from "../lib/playerPropsAi/openai";
import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {evidenceAliases} from "../lib/playerPropsAi/input";
import {playerSubset} from "../lib/playerPropsAi/partitions";
import {encodeCanonicalScenarioLaw} from "../lib/playerPropsAi/generativeCoordinates";
import {verifiedReaderFixture} from "./lib/player-props-ai-reader-fixture";
globalThis.fetch=(async()=>{throw Error("Real network forbidden");}) as typeof fetch;
const at="2030-11-17T17:00:00.000Z",lock="2030-11-17T18:00:00.000Z",start="2030-11-17T19:00:00.000Z",v=(x:number)=>Array(16).fill(x);
function packet(count=1,sport:GamePacket["sport"]="nba"):GamePacket{return{release:PRODUCT_RELEASE,sport,gameId:"synthetic-identity",start,lock,cutoff:at,stage:"final",sourceLimitations:[],quotes:[],players:Array.from({length:count},(_,i)=>({id:`p${i}`,name:`Synthetic Actor ${i}`,team:"BOS",opponent:"NYK",markets:[sport==="nba"?"points":sport==="nfl"?"receptions":"batter_hits"],missing:[],evidence:[18,20,22].map((points,n)=>({id:`p${i}:log${n}`,kind:"recent_games" as const,source:"synthetic original statistics",availableAt:at,value:{game:{startTime:`2030-11-${String(5+n).padStart(2,"0")}T20:00:00Z`,homeTeam:"BOS",awayTeam:"NYK"},box:{points,minutes:30}}}))}))};}
function draft(p:GamePacket){const aliases=evidenceAliases(p);return{wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(p.players.map(player=>[player.id,verifiedReaderFixture(p,player.id,{priorRead:{},evidenceIds:[[...aliases].find(([,id])=>id===player.evidence[0]!.id)![0]],gaps:[],confidence:[2],exceptions:[null],law:encodeCanonicalScenarioLaw("nba",player,{weights:v(1),outcomes:{points:[18,22,...v(20).slice(2)],rebounds:v(4),assists:v(2),threes:v(1)}})})]))};}
async function run(mode:{model:PropsAiModel;observed:unknown;sport?:GamePacket["sport"];stream?:boolean;parts?:number;correction?:boolean;requestedTier?:"default"|"flex";observedTier?:unknown;observedId?:unknown;observedStatus?:unknown}){
 const p=packet(mode.parts??1,mode.sport),before=JSON.stringify(p),job={job_key:`props-ai|${p.sport}|synthetic-identity|2030-11-17|final`,game_id:p.gameId,sport:p.sport,scheduled_start:start,lock_at:lock,game_day:"2030-11-17",stage:"final",state:"pending",model:mode.model,requested_tier:"default"} as PropsAiJob;
 const receipts:Array<{actual:number|null;responseId:string|null;usage:Record<string,unknown>}>=[],finishes:Array<{review:unknown;error:unknown}>=[],bodies:string[]=[],drafts:string[]=[];let sends=0,calls=0,fallbacks=0;
 const result=await runPropsReview({packet:p,job,key:"synthetic-never-real",writerRunId:"synthetic-owner",preferStronger:mode.model===PROPS_AI_STRONG_MODEL,countStrong:async()=>100,clock:()=>at,deadline:Date.now()+4_000_000,
  prepare:async()=>p.players.map(player=>({packet:playerSubset(p,[player.id]),inputTokens:100})),store:{
   claim:async()=>({claimed:true,token:"synthetic",job}),send:async()=>({id:`attempt-${++sends}`,reserved_micro:10000,model:mode.model,requested_tier:mode.requestedTier??"default"}),
   receipt:async(_id,_token,actual,responseId,usage)=>{receipts.push({actual,responseId,usage:usage as Record<string,unknown>});},fallback:async()=>{fallbacks++;return mode.correction??false;},
   finish:async(_key,_token,review,error)=>{finishes.push({review,error});return{...job,state:review?"completed":"failed",result:review,error_code:error};}},
  fetchImpl:async(_url,options)=>{calls++;bodies.push(String(options?.body));const request=JSON.parse(bodies.at(-1)!);assert.equal(request.model,mode.model);
   const firstCorrection=mode.correction&&calls===1,wire=firstCorrection?{}:p.sport==="nba"&&p.players.length===1?draft(playerSubset(p,[p.players[0]!.id])):{};
   drafts.push(JSON.stringify(wire));const response={id:!firstCorrection&&Object.hasOwn(mode,"observedId")?mode.observedId:`synthetic-response-${calls}`,model:firstCorrection?mode.model:mode.observed,status:!firstCorrection&&Object.hasOwn(mode,"observedStatus")?mode.observedStatus:"completed",service_tier:!firstCorrection&&Object.hasOwn(mode,"observedTier")?mode.observedTier:"default",usage:{input_tokens:100,output_tokens:100},output:[{content:[{type:"output_text",text:drafts.at(-1)!}]}]};
   return mode.stream?new Response(`data: ${JSON.stringify({type:"response.completed",response})}\n\n`,{headers:{"content-type":"text/event-stream"}}):Response.json(response);
  }});
 assert.equal(JSON.stringify(p),before);assert.equal(fallbacks,mode.correction?1:0);assert.equal(finishes.length,1);
 return{result,receipts,finishes,sends,calls,bodies,drafts};
}
async function main(){let cases=0;
 for(const model of [PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL]){
  assert.equal(responseModelIdentity(model,model).status,"verified");
  for(const observed of [undefined,null,0,{},[],"",model+"-2099-01-01",model+"-other"," "+model,model+" ","gpt-6-luna-extra", "sk-synthetic-sensitive", "x".repeat(10000)]){
   assert.notEqual(responseModelIdentity(model,observed).status,"verified");assert(JSON.stringify(responseModelIdentity(model,observed)).length<500);cases++;
  }
  for(const stream of [false,true]){
   const good=await run({model,observed:model,stream});assert.equal(good.result.status,"completed");assert.equal(good.calls,1,JSON.stringify(good.receipts.map(r=>({reason:(r.usage.failureEvidence as {reason?:string})?.reason,actor:r.usage.actorAdmissionEvidence}))));
   assert.equal(good.receipts[0]!.actual,usageMicroUsd(model,{input_tokens:100,output_tokens:100},"default"));
   assert.deepEqual(good.receipts[0]!.usage.response_model_identity,{release:PROPS_AI_RESPONSE_MODEL_IDENTITY_RELEASE,status:"verified",requestedModel:model,responseModel:model});cases++;
   const wrong=await run({model,observed:model===PROPS_AI_PRIMARY_MODEL?PROPS_AI_STRONG_MODEL:PROPS_AI_PRIMARY_MODEL,stream});
   assert.equal(wrong.result.status,"failed");assert.equal(wrong.calls,1);assert.equal(wrong.sends,1);assert.equal(wrong.receipts.length,1);assert.equal(wrong.receipts[0]!.actual,null);
   assert.equal(wrong.finishes[0]!.review,null);assert.match(String(wrong.finishes[0]!.error),/response_model_identity_mismatch/);
   const usage=wrong.receipts[0]!.usage,e=usage.failureEvidence as {request:{sha256:string};draft:{sha256:string}};
   assert.equal((usage.response_model_identity as {status:string}).status,"mismatch");
   assert.equal(e.request.sha256,createHash("sha256").update(wrong.bodies[0]!).digest("hex"));
   assert.equal(e.draft.sha256,createHash("sha256").update(wrong.drafts[0]!).digest("hex"));cases++;
  }
 }
 for(const sport of ["nba","nfl","mlb"] as const)for(const observed of [undefined,null,{},"unknown-model",PROPS_AI_STRONG_MODEL]){
  const bad=await run({model:PROPS_AI_PRIMARY_MODEL,observed,sport});assert.equal(bad.result.status,"failed");assert.equal(bad.calls,1);assert.equal(bad.receipts[0]!.actual,null);assert.equal(bad.finishes[0]!.review,null);cases++;
 }
 const wave=await run({model:PROPS_AI_PRIMARY_MODEL,observed:PROPS_AI_STRONG_MODEL,parts:9});
 assert.equal(wave.calls,9);assert.equal(wave.receipts.length,9);assert(wave.receipts.every(r=>r.actual===null));assert.equal(wave.result.status,"failed");cases++;
 const correction=await run({model:PROPS_AI_PRIMARY_MODEL,observed:PROPS_AI_STRONG_MODEL,correction:true});
 assert.equal(correction.calls,2);assert.equal(correction.receipts[0]!.actual,usageMicroUsd(PROPS_AI_PRIMARY_MODEL,{input_tokens:100,output_tokens:100},"default"));assert.equal(correction.receipts[1]!.actual,null);assert.equal(correction.finishes[0]!.review,null);cases++;
 for(const model of [PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL])for(const requestedTier of ["default","flex"] as const)for(const observedTier of ["default","flex"] as const)for(const stream of [false,true]){
  const good=await run({model,observed:model,requestedTier,observedTier,stream});assert.equal(good.result.status,"completed");assert.equal(good.calls,1);
  assert.equal(good.receipts[0]!.actual,verifiedUsageMicroUsd(model,{input_tokens:100,output_tokens:100},observedTier));
  assert.equal((good.receipts[0]!.usage.response_tier_identity as {status:string}).status,"verified");cases++;
 }
 for(const observedTier of [undefined,null,{},[],0,"","auto","priority","fast","scale","default ","unrecognized"]){
  assert.notEqual(responseTierIdentity("default",observedTier).status,"verified");
  assert.throws(()=>verifiedUsageMicroUsd(PROPS_AI_PRIMARY_MODEL,{input_tokens:100,output_tokens:100},observedTier),/unsupported_actual_service_tier/);
  for(const stream of [false,true]){const bad=await run({model:PROPS_AI_PRIMARY_MODEL,observed:PROPS_AI_PRIMARY_MODEL,observedTier,stream});
   assert.equal(bad.result.status,"failed");assert.equal(bad.calls,1);assert.equal(bad.receipts[0]!.actual,null);assert.equal(bad.finishes[0]!.review,null);cases++;
  }
 }
 for(const observedId of [undefined,null,{},[],0,""," "," x ","x\u0000","x\n","\ud800","\udfff","x".repeat(257),"😀".repeat(65)]){
  assert.notEqual(responseReferenceIdentity(observedId).status,"verified");
  for(const stream of [false,true]){const bad=await run({model:PROPS_AI_PRIMARY_MODEL,observed:PROPS_AI_PRIMARY_MODEL,observedId,stream});
   assert.equal(bad.result.status,"failed");assert.equal(bad.calls,1);assert.equal(bad.receipts[0]!.actual,null);assert.equal(bad.receipts[0]!.responseId,null);assert.equal(bad.finishes[0]!.review,null);cases++;
  }
 }
 assert.equal(responseReferenceIdentity("opaque:reference/kept-exact").responseId,"opaque:reference/kept-exact","no response-ID prefix inference");
 for(const observedStatus of [undefined,null,{},"in_progress","queued","unknown","completed "]){
  const bad=await run({model:PROPS_AI_PRIMARY_MODEL,observed:PROPS_AI_PRIMARY_MODEL,observedStatus});
  assert.equal(bad.calls,1);assert.equal(bad.receipts[0]!.actual,null);assert.equal(bad.finishes[0]!.review,null);cases++;
 }
 for(const extra of [{observedTier:"priority"},{observedId:""}]){
  const late=await run({model:PROPS_AI_PRIMARY_MODEL,observed:PROPS_AI_PRIMARY_MODEL,...extra,correction:true});assert.equal(late.calls,2);assert.equal(late.receipts[1]!.actual,null);assert.equal(late.finishes[0]!.review,null);cases++;
  const siblings=await run({model:PROPS_AI_PRIMARY_MODEL,observed:PROPS_AI_PRIMARY_MODEL,...extra,parts:9});assert.equal(siblings.calls,9);assert.equal(siblings.receipts.length,9);assert(siblings.receipts.every(r=>r.actual===null));cases++;
 }
 assert.equal(usageMicroUsd(PROPS_AI_PRIMARY_MODEL,{input_tokens:100,output_tokens:100},"unknown"),60,"legacy/planning upper bound remains exact, not a known settlement");
 assert.equal(PROPS_AI_RELEASE,"player_props_ai_2026_11_18_r54_exact_counts_complete_numeric_retry");
 const old="player_props_ai_2026_11_14_r38_exact_confidence_and_evidence";assert(propsReviewHasMemberExecutionContracts(old));assert(propsReviewHasVerifiedReaderClaims(old));
 console.log(JSON.stringify({responseModelIdentity:true,supportedActualTierIdentity:true,nonemptyOriginalResponseReference:true,cases,allThreeSportsRejectUnknownIdentity:true,jsonAndStream:true,bothConfiguredModelsPreserved:true,knownActualTierCanDifferFromRequest:true,unknownChargesStayHeld:true,laterWavesAndCorrectionBlocked:true,oldR38PolicyPreserved:true,networkCalls:0}));
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
