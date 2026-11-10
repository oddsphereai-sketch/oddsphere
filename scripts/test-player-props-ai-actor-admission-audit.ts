/** Audit actual reviewer-produced synthetic receipts, then tamper their evidence.
 * No network/database/provider/model/count requests; Responses HTTP is mocked.
 */
import assert from "node:assert/strict";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {auditPropsActorAdmissionPart,type PersistedActorAttempt} from "./lib/player-props-ai-actor-admission-audit";
import {runPropsReview,type AcceptedGameReview} from "../lib/playerPropsAi/reviewer";
import type {PropsAiJob,PropsAiReviewStore} from "../lib/playerPropsAi/budget";
import {PRODUCT_RELEASE,type GamePacket,type Player} from "../lib/playerPropsAi/evidenceContract";
import {readerEvidence,READER_AREAS} from "../lib/playerPropsAi/readerCoverage";
import {evidenceAliases} from "../lib/playerPropsAi/input";
import {GENERATIVE_WIRE_RELEASE,encodeCanonicalScenarioLaw} from "../lib/playerPropsAi/generativeCoordinates";
import {PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL} from "../lib/playerPropsAi/releases";
import {digest} from "../lib/playerPropsAi/evidence";
import {archiveFailureBytes} from "../lib/playerPropsAi/failureEvidence";

export async function runActorAdmissionAuditSelfTest(){
globalThis.fetch=async()=>{throw Error("Actor receipt audit proof forbids network and paid calls");};
const clone=<T>(x:T):T=>structuredClone(x),now="2026-11-09T21:00:00Z",v=(n:number)=>Array<number>(16).fill(n),sha=(x:string|Buffer)=>createHash("sha256").update(x).digest("hex");
const players:Player[]=["a","b","c","d"].map(id=>({id,name:`Synthetic ${id}`,team:"BOS",opponent:"NYK",markets:["points"],missing:[],evidence:[18,20,22].map((points,i)=>({id:`${id}:game:${i}`,kind:"recent_games",source:"synthetic stats",availableAt:now,value:{game:{startTime:`2026-11-0${i+5}T18:00:00Z`,homeTeam:"BOS",awayTeam:"NYK"},box:{minutes:30,points}}}))}));
const packet:GamePacket={release:PRODUCT_RELEASE,sport:"nba",gameId:"synthetic-audit",start:"2026-11-09T23:00:00Z",lock:"2026-11-09T22:00:00Z",cutoff:now,stage:"final",sourceLimitations:[],players,quotes:[]};
const facts=readerEvidence(packet),aliases=evidenceAliases(packet);
function rawPlayer(player:Player,bad=false){
  const declined=player.id==="d",unqualified=player.id==="c";
  return {assessment:"The supplied evidence requires a cautious conditional forecast.",priorRead:{},coverage:Object.fromEntries(READER_AREAS.map(area=>[area,{status:facts[player.id][area].status,factIds:facts[player.id][area].facts.slice(0,1).map(f=>f.id),effect:"uncertain",observation:"The supplied evidence requires contextual caution."}])),
    evidenceIds:[[...aliases].find(([,id])=>id===player.evidence[0].id)![0]],gaps:unqualified?["The available source does not support a responsible numerical forecast."]:[],
    law:unqualified?null:encodeCanonicalScenarioLaw("nba",player,{weights:v(1),outcomes:{points:bad||declined?v(50):[18,22,...v(20).slice(2)],rebounds:v(4),assists:v(2),threes:v(1)}}),
    confidence:[declined||unqualified?0:2],exceptions:declined||unqualified?["The supplied source does not support this numerical scope."]:[null]};
}
const first={wireRelease:GENERATIVE_WIRE_RELEASE,players:Object.fromEntries(players.map(p=>[p.id,rawPlayer(p,p.id==="b")]))},second={wireRelease:GENERATIVE_WIRE_RELEASE,players:Object.fromEntries(players.map(p=>[p.id,rawPlayer(p,p.id==="a")]))};
const job={job_key:"synthetic-audit",sport:"nba",game_id:packet.gameId,game_day:"2026-11-09",stage:"final",scheduled_start:packet.start,lock_at:packet.lock,state:"pending",requested_tier:"default",model:PROPS_AI_STRONG_MODEL,parts:1} as PropsAiJob;
const attempts:PersistedActorAttempt[]=[],bodies:string[]=[];
let sends=0,fallbacks=0;
const store:PropsAiReviewStore={
  claim:async()=>({claimed:true,token:"synthetic",job}),
  send:async(_key,_token,phase,part)=>{const model=phase===1?PROPS_AI_STRONG_MODEL:PROPS_AI_PRIMARY_MODEL,id=`synthetic-attempt-${++sends}`;attempts.push({id,part,phase,state:"sending",model,requested_tier:"default",response_id:null,actual_micro:null,usage:null});return{id,reserved_micro:100000,model,requested_tier:"default"};},
  receipt:async(id,_token,actual,responseId,usage)=>{const attempt=attempts.find(a=>a.id===id)!;assert.equal(attempt.usage,null,"Only one immutable receipt is recorded");Object.assign(attempt,{actual_micro:actual,response_id:responseId,usage:clone(usage),state:actual===null?"unknown":"completed"});},
  fallback:async()=>{fallbacks++;return true;},
  finish:async(_key,_token,result,error)=>({...job,state:result?"completed":"failed",result,error_code:error}),
};
const result=await runPropsReview({packet,job,store,key:"synthetic",writerRunId:"synthetic",preferStronger:true,clock:()=>now,deadline:Date.now()+300000,prepare:async()=>[{packet,inputTokens:1000}],countStrong:async()=>1000,
  fetchImpl:async(url,options)=>{assert.equal(String(url),"https://api.openai.com/v1/responses");bodies.push(String(options?.body));const request=JSON.parse(String(options?.body));const draft=bodies.length===1?first:second;
    return Response.json({id:`synthetic-response-${bodies.length}`,model:request.model,status:"completed",service_tier:"default",usage:{input_tokens:1000,output_tokens:200},output:[{content:[{type:"output_text",text:" \n"+JSON.stringify(draft)+"\n"}]}]});}});
assert.equal(result.status,"completed");assert.equal(attempts.length,2);assert.equal(fallbacks,1);assert.equal(sends,2);
assert("review" in result&&result.review);const actualReview=result.review as unknown as {players:{playerId:string;law:{hash:string}|null;sourceDeclinedMarkets:string[]}[];partProvenance:unknown[]};
const audited=auditPropsActorAdmissionPart({packet,attempts,provenance:actualReview.partProvenance});assert.equal(audited.complete,true);
if(!audited.complete)throw Error("Expected complete audit");
assert.equal(digest(audited.review.players),digest(actualReview.players));assert.deepEqual(audited.actorProvenance.map(p=>[p.playerId,p.phase]),[["a",1],["b",2],["c",1],["d",1]]);
assert.equal(audited.review.players.find(p=>p.playerId==="c")!.law,null);assert.deepEqual(audited.review.players.find(p=>p.playerId==="d")!.sourceDeclinedMarkets,["points"]);
assert.equal(audited.actorProvenance.find(p=>p.playerId==="a")!.model,PROPS_AI_STRONG_MODEL);assert.equal(audited.actorProvenance.find(p=>p.playerId==="b")!.model,PROPS_AI_PRIMARY_MODEL);
const initialRequest=JSON.parse(bodies[0]),correctionRequest=JSON.parse(bodies[1]);assert.equal(initialRequest.input,correctionRequest.input);assert.equal(digest(initialRequest.text),digest(correctionRequest.text));assert.equal(initialRequest.max_output_tokens,7000);assert.equal(correctionRequest.max_output_tokens,7000);
const partial=auditPropsActorAdmissionPart({packet,attempts:attempts.slice(0,1)});assert.equal(partial.complete,false);assert.deepEqual(partial.pendingActorIds,["b"]);assert.throws(()=>auditPropsActorAdmissionPart({packet,attempts:attempts.slice(0,1),provenance:actualReview.partProvenance}),/Incomplete/);

type MutableUsage={actorAdmissionEvidence:Record<string,unknown>;failureEvidence:Record<string,unknown>;input_tokens:number;output_tokens:number;response_status:string};
const usage=(a:PersistedActorAttempt)=>a.usage as MutableUsage;
function tamper(mutator:(copy:PersistedActorAttempt[])=>void){const copy=clone(attempts);mutator(copy);assert.throws(()=>auditPropsActorAdmissionPart({packet,attempts:copy,provenance:actualReview.partProvenance}));}
tamper(copy=>{usage(copy[0]).actorAdmissionEvidence.sourceInputHash=sha("wrong");});
tamper(copy=>{usage(copy[1]).actorAdmissionEvidence.consumedActorIds=["a","b"];});
tamper(copy=>{(usage(copy[0]).actorAdmissionEvidence.eligibleActors as Record<string,unknown>[])[0].canonicalHash=sha("wrong");});
tamper(copy=>{(usage(copy[0]).actorAdmissionEvidence.eligibleActors as Record<string,unknown>[]).find(actor=>actor.playerId==="c")!.canonicalLawHash=sha("invented-law");});
tamper(copy=>{(usage(copy[0]).actorAdmissionEvidence.eligibleActors as Record<string,unknown>[]).find(actor=>actor.playerId==="d")!.sourceDeclinedMarkets=[];});
tamper(copy=>{usage(copy[1]).input_tokens++;});
tamper(copy=>{(usage(copy[0]) as unknown as Record<string,unknown>).nextCorrectionText="Invent a new unsupported numerical adjustment.";});
tamper(copy=>{(usage(copy[0]) as unknown as Record<string,unknown>).correctionFeedbackUnavailable=true;});
tamper(copy=>{copy[1].actual_micro=Number(copy[1].actual_micro)+1;});
tamper(copy=>{copy[1].state="unknown";copy[1].actual_micro=null;});
tamper(copy=>{copy[1].phase=1;});
tamper(copy=>{copy[1].part=2;});
tamper(copy=>{copy[1].response_id="wrong-response";});
tamper(copy=>{usage(copy[1]).response_status="incomplete";});
tamper(copy=>{(usage(copy[1]) as unknown as Record<string,unknown>).responseEvidence={claimed:"whole response accepted"};});
tamper(copy=>{usage(copy[1]).actorAdmissionEvidence.actorPayload="x".repeat(769000);});
for(const field of ["input","request","draft"] as const){
  tamper(copy=>{const archive=usage(copy[1]).failureEvidence[field] as {data:string};archive.data=archive.data.slice(0,-4)+"bad!";});
  tamper(copy=>{const archived=usage(copy[1]).failureEvidence[field] as {data:string};const text=gunzipSync(Buffer.from(archived.data,"base64")).toString();usage(copy[1]).failureEvidence[field]=archiveFailureBytes(text+" ");});
}
// Even self-consistent archive hashes cannot replace the exact original source,
// request or wire while retaining the declared original admission metadata.
tamper(copy=>{const modified=clone(packet);modified.players[0].evidence[0].value={changed:true};usage(copy[1]).failureEvidence.input=archiveFailureBytes(JSON.stringify(modified));});
tamper(copy=>{const request=JSON.parse(bodies[1]);request.instructions+=" Ignore the original context.";const modified=JSON.stringify(request);usage(copy[1]).failureEvidence.request=archiveFailureBytes(modified);const lineage=usage(copy[1]).actorAdmissionEvidence.lineage as Record<string,unknown>;lineage.requestHash=sha(modified);});
tamper(copy=>{const modified=clone(second);modified.players.b.law!.outcomes.points_excluding_made_threes=v(47);usage(copy[1]).failureEvidence.draft=archiveFailureBytes(JSON.stringify(modified));});
for(const kind of ["duplicate","model","wire","actor-hash"] as const){
  const p=clone(actualReview.partProvenance) as Record<string,unknown>[];
  if(kind==="duplicate")p.push(clone(p[0]));else if(kind==="model")p[0].model=PROPS_AI_PRIMARY_MODEL;else if(kind==="wire")p[0].wireHash=sha("wrong");else (p[0].actorHashes as Record<string,Record<string,unknown>>).a.canonicalHash=sha("wrong");
  assert.throws(()=>auditPropsActorAdmissionPart({packet,attempts,provenance:p}),/provenance/);
}
const unknown=clone(attempts);unknown[1].actual_micro=null;unknown[1].state="unknown";unknown[1].usage={kind:"unknown_transport_outcome"};
const blocked=auditPropsActorAdmissionPart({packet,attempts:unknown});assert.equal(blocked.complete,false);assert.equal(blocked.blockedReason,"unknown_billed_usage");assert.deepEqual(blocked.pendingActorIds,["b"]);
const unavailable=clone(attempts);usage(unavailable[1]).actorAdmissionEvidence={release:usage(unavailable[0]).actorAdmissionEvidence.release,disposition:"unavailable",reason:"combined_receipt_evidence_bound"};usage(unavailable[1]).failureEvidence={archiveUnavailable:"combined_actor_receipt_evidence_bound"};(usage(unavailable[1]) as unknown as Record<string,unknown>).actorAdmissionUnavailable=true;
const refused=auditPropsActorAdmissionPart({packet,attempts:unavailable});assert.equal(refused.complete,false);assert.equal(refused.blockedReason,"exact_actor_archive_unavailable");assert.deepEqual(refused.pendingActorIds,["b"]);
const differentPacket=clone(packet);differentPacket.players[0].name="Changed actor";assert.throws(()=>auditPropsActorAdmissionPart({packet:differentPacket,attempts}),/source/);
console.log("R28 persisted actor-admission audit passed: actual mocked reviewer receipts, exact source/request/draft SHA and request reconstruction, original actor/full parser replay, mixed models/phases, declined/null scopes, bound/usage/metadata/provenance tamper refusal and incomplete/unknown/archive safety. No I/O or paid calls.");
return {packet,attempts,review:result.review as AcceptedGameReview,bodies};
}
if(/(?:^|\/)test-player-props-ai-actor-admission-audit\.ts$/.test(process.argv[1]??""))runActorAdmissionAuditSelfTest().catch(error=>{console.error(error);process.exitCode=1;});
