/** Actual reviewer + mocked HTTP: disjoint parts and correction may not share a response. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {runPropsReview} from "../lib/playerPropsAi/reviewer";
import type {PropsAiJob} from "../lib/playerPropsAi/budget";
import {nbaAuthorityFixture,nbaAuthorityDraft} from "./test-player-props-ai-nba-lock-authority";
import {playerSubset} from "../lib/playerPropsAi/partitions";
import {PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL} from "../lib/playerPropsAi/releases";
globalThis.fetch=(async()=>{throw Error("Real network forbidden");}) as typeof fetch;
async function run(reuse:boolean,correction=false,model:typeof PROPS_AI_PRIMARY_MODEL|typeof PROPS_AI_STRONG_MODEL=PROPS_AI_PRIMARY_MODEL){
 const p=nbaAuthorityFixture().packet;if(correction)p.players=p.players.slice(0,1);
 const parts=p.players.map(x=>playerSubset(p,[x.id])),job={job_key:"synthetic-reference",game_id:p.gameId,sport:p.sport,scheduled_start:p.start,lock_at:p.lock,game_day:"2026-11-10",stage:p.stage,state:"pending"} as PropsAiJob;
 const receipts:{actual:number|null;id:string|null;usage:Record<string,unknown>}[]=[],requests:string[]=[],drafts:string[]=[];let sends=0,calls=0,fallback=0;
 const result=await runPropsReview({packet:p,job,key:"synthetic-never-real",writerRunId:"synthetic",preferStronger:model===PROPS_AI_STRONG_MODEL,countStrong:async()=>100,clock:()=>p.cutoff,deadline:Date.now()+1000000,prepare:async()=>parts.map(packet=>({packet,inputTokens:100})),store:{
 claim:async()=>({claimed:true,job,token:"synthetic"}),send:async(_key,_token,phase)=>({id:`attempt-${++sends}`,model:phase===2?PROPS_AI_PRIMARY_MODEL:model,requested_tier:"default",reserved_micro:10000}),receipt:async(_id,_token,actual,id,usage)=>{receipts.push({actual,id,usage:usage as Record<string,unknown>});},fallback:async()=>{fallback++;return correction;},finish:async(_key,_token,review,error)=>({...job,state:review?"completed":"failed",result:review,error_code:error})},
 fetchImpl:async(_url,options)=>{requests.push(String(options?.body));const requested=JSON.parse(String(options?.body)),n=calls++,packet=parts[correction?0:n]!,wire=correction&&n===0?{}:nbaAuthorityDraft(packet);drafts.push(JSON.stringify(wire));return Response.json({id:reuse?"one-original-reference":`distinct-reference-${n}`,model:requested.model,status:"completed",service_tier:"default",usage:{input_tokens:100,output_tokens:100},output:[{content:[{type:"output_text",text:drafts[n]}]}]});}});
 return {result,receipts,requests,drafts,calls,fallback};
}
async function main(){let cases=0;
 for(const model of [PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL])for(const correction of [false,true]){
  const good=await run(false,correction,model);assert.equal(good.result.status,"completed",JSON.stringify({correction,model,result:good.result.status,reason:"reason" in good.result?good.result.reason:null,receipts:good.receipts.map(r=>({actual:r.actual,kind:r.usage.kind,reason:(r.usage.failureEvidence as {reason?:unknown})?.reason}))}));assert.equal(good.calls,2);assert(good.receipts.every(x=>x.actual!==null));cases++;
  const bad=await run(true,correction,model);assert.equal(bad.result.status,"failed");assert.equal(bad.calls,2);assert.equal(bad.fallback,correction?1:0);assert.equal(bad.receipts.filter(x=>x.actual!==null).length,1);const unknown=bad.receipts.find(x=>x.actual===null)!;assert.equal(unknown.usage.kind,"response_reference_reused");assert.equal(unknown.id,"one-original-reference");
  const raw=unknown.usage.failureEvidence as {request:{sha256:string};draft:{sha256:string}};assert.equal(raw.request.sha256,createHash("sha256").update(bad.requests[1]).digest("hex"));assert.equal(raw.draft.sha256,createHash("sha256").update(bad.drafts[1]).digest("hex"));cases++;
 }
 console.log(JSON.stringify({cases,actualReviewer:true,uniqueDisjointPartsAndCorrectionsPreserved:true,reusedReferenceCannotComplete:true,originalRequestAndDraftHashesExact:true,unknownHoldAndNoExtraCalls:true,networkCalls:0}));
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
