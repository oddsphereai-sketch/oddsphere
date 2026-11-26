import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {verifiedReaderFixture} from "./lib/player-props-ai-reader-fixture";
/** Audit actual reviewer-produced synthetic receipts, then tamper their evidence.
 * No network/database/provider/model/count requests; Responses HTTP is mocked.
 */
import assert from "node:assert/strict";
import {runPropsReview} from "../lib/playerPropsAi/reviewer";
import type {PropsAiJob,PropsAiReviewStore} from "../lib/playerPropsAi/budget";
import {PRODUCT_RELEASE,type GamePacket,type Player} from "../lib/playerPropsAi/evidenceContract";
import {readerEvidence,READER_AREAS} from "../lib/playerPropsAi/readerCoverage";
import {evidenceAliases} from "../lib/playerPropsAi/input";
import {encodeCanonicalScenarioLaw} from "../lib/playerPropsAi/generativeCoordinates";
import {PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL} from "../lib/playerPropsAi/releases";

async function scopedRejectionSelfTest(){
globalThis.fetch=async()=>{throw Error("Actor receipt audit proof forbids network and paid calls");};
const clone=<T>(x:T):T=>structuredClone(x),now="2026-11-09T21:00:00Z",v=(n:number)=>Array<number>(16).fill(n);
const players:Player[]=["a","b","c","d"].map(id=>({id,name:`Synthetic ${id}`,team:"BOS",opponent:"NYK",markets:["points"],missing:[],evidence:[18,20,22].map((points,i)=>({id:`${id}:game:${i}`,kind:"recent_games",source:"synthetic stats",availableAt:now,value:{game:{startTime:`2026-11-0${i+5}T18:00:00Z`,homeTeam:"BOS",awayTeam:"NYK"},box:{minutes:30,points}}}))}));
const packet:GamePacket={release:PRODUCT_RELEASE,sport:"nba",gameId:"synthetic-audit",start:"2026-11-09T23:00:00Z",lock:"2026-11-09T22:00:00Z",cutoff:now,stage:"final",sourceLimitations:[],players,quotes:[]};
const facts=readerEvidence(packet),aliases=evidenceAliases(packet);
function rawPlayer(player:Player,bad=false){
  const declined=player.id==="d",unqualified=player.id==="c";
  return verifiedReaderFixture(packet,player.id,{assessment:"The supplied evidence requires a cautious conditional forecast.",priorRead:{},coverage:Object.fromEntries(READER_AREAS.map(area=>[area,{status:facts[player.id][area].status,factIds:facts[player.id][area].facts.slice(0,1).map(f=>f.id),effect:"uncertain",observation:"The supplied evidence requires contextual caution."}])),
    evidenceIds:[[...aliases].find(([,id])=>id===player.evidence[0].id)![0]],gaps:unqualified?["The available source does not support a responsible numerical forecast."]:[],
    law:unqualified?null:encodeCanonicalScenarioLaw("nba",player,{weights:v(1),outcomes:{points:bad||declined?v(50):[18,22,...v(20).slice(2)],rebounds:v(4),assists:v(2),threes:v(1)}}),
    confidence:[declined||unqualified?0:2],exceptions:declined||unqualified?["The supplied source does not support this numerical scope."]:[null]});
}
const first={wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(players.map(p=>[p.id,rawPlayer(p,p.id==="b")]))},second={wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(players.map(p=>[p.id,rawPlayer(p,p.id==="b")]))};
const job={job_key:"synthetic-audit",sport:"nba",game_id:packet.gameId,game_day:"2026-11-09",stage:"final",scheduled_start:packet.start,lock_at:packet.lock,state:"pending",requested_tier:"default",model:PROPS_AI_STRONG_MODEL,parts:1} as PropsAiJob;
const attempts:import("./lib/player-props-ai-actor-admission-audit").PersistedActorAttempt[]=[],bodies:string[]=[];
let sends=0,fallbacks=0;let finishedError:string|null=null;
const store:PropsAiReviewStore={
  claim:async()=>({claimed:true,token:"synthetic",job}),
  send:async(_key,_token,phase,part)=>{const model=phase===1?PROPS_AI_STRONG_MODEL:PROPS_AI_PRIMARY_MODEL,id=`synthetic-attempt-${++sends}`;attempts.push({id,part,phase,state:"sending",model,requested_tier:"default",response_id:null,actual_micro:null,usage:null});return{id,reserved_micro:100000,model,requested_tier:"default"};},
  receipt:async(id,_token,actual,responseId,usage)=>{const attempt=attempts.find(a=>a.id===id)!;assert.equal(attempt.usage,null,"Only one immutable receipt is recorded");Object.assign(attempt,{actual_micro:actual,response_id:responseId,usage:clone(usage),state:actual===null?"unknown":"completed"});},
  fallback:async()=>{fallbacks++;return true;},
  finish:async(_key,_token,result,error)=>{finishedError=error;return {...job,state:result?"completed":"failed",result,error_code:error};},
};
const result=await runPropsReview({packet,job,store,key:"synthetic",writerRunId:"synthetic",preferStronger:true,clock:()=>now,deadline:Date.now()+300000,prepare:async()=>[{packet,inputTokens:1000}],countStrong:async()=>1000,
  fetchImpl:async(url,options)=>{assert.equal(String(url),"https://api.openai.com/v1/responses");bodies.push(String(options?.body));const request=JSON.parse(String(options?.body));const draft=bodies.length===1?first:{...second,players:{b:second.players.b}};
    return Response.json({id:`synthetic-response-${bodies.length}`,model:request.model,status:"completed",service_tier:"default",usage:{input_tokens:1000,output_tokens:200},output:[{content:[{type:"output_text",text:" \n"+JSON.stringify(draft)+"\n"}]}]});}});
assert.equal(result.status,"failed");assert.equal(sends,2);assert.equal(fallbacks,1);
assert.equal(attempts.length,2);const finalUsage=attempts[1].usage as {actorAdmissionEvidence:{rejectedActors:{reason:string}[]}};
const originalReason=finalUsage.actorAdmissionEvidence.rejectedActors[0].reason;
assert.notEqual(originalReason,"unparsed_draft");
assert.equal((result as {error?:string}).error,undefined);
// The immutable mocked store captures the job error returned by the real reviewer.
assert.equal(finishedError,originalReason);assert.match(finishedError!,/mean|source|support/i);
assert.deepEqual(JSON.parse(bodies[1]).text.format.schema.properties.players.required,["b"]);
assert(Buffer.byteLength(JSON.stringify(attempts[1].usage))<=768000);
console.log("Scoped correction numeric rejection stays numeric; retained actors, two existing phases and immutable known receipts preserved.");
}
scopedRejectionSelfTest().catch(error=>{console.error(error);process.exitCode=1;});
