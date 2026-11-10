import {compileReaderClaims} from "../lib/playerPropsAi/readerClaims";
import {jointReviewRequest} from "../lib/playerPropsAi/request";
import {buildVerifiedReaderSelections} from "./lib/player-props-ai-reader-fixture";
import {encodeCanonicalScenarioLaw,generativeStatistics} from "../lib/playerPropsAi/generativeCoordinates";
import {primitives} from "../lib/playerPropsAi/law";
import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
/** Offline output-capacity regression; never sends token-count or generation requests. */
import assert from "node:assert/strict";
import {PRODUCT_RELEASE,CATALOG,type GamePacket} from "../lib/playerPropsAi/evidenceContract";
import {prepareReviewParts} from "../lib/playerPropsAi/partitions";
import {digest} from "../lib/playerPropsAi/evidence";
import {runPropsReview} from "../lib/playerPropsAi/reviewer";
import {DEFAULT_PROPS_SOURCE_BOUNDS} from "../lib/playerPropsAi/calendar";
import {usageMicroUsd} from "../lib/playerPropsAi/budget";
import {PROPS_AI_MAX_OUTPUT_PER_REQUEST,PROPS_AI_PRIMARY_MODEL} from "../lib/playerPropsAi/releases";
globalThis.fetch=async()=>{throw Error("Offline headroom proof forbids network");};
const now="2026-11-08T18:00:00Z";
function source(count:number):GamePacket{return {release:PRODUCT_RELEASE,sport:"nfl",gameId:"synthetic",start:"2026-11-08T23:00:00Z",lock:"2026-11-08T22:00:00Z",cutoff:now,stage:"final",sourceLimitations:[],quotes:[],players:Array.from({length:count},(_,i)=>({id:`p${i}`,name:`Synthetic ${i}`,team:"HOU",opponent:"LAC",markets:["rushing_yards","receiving_yards","receptions","anytime_td"],missing:[],evidence:[{id:`source${i}`,kind:"recent_games" as const,availableAt:now,source:"synthetic",value:{games:Array.from({length:i<2?20:5},(_,game)=>({game,rushing_yards:40.12345,receiving_yards:30.98765,receptions:4}))}}]}))};}
async function main(){
 for(const [actors,maxPlayers,expected] of [[32,4,8],[43,6,8],[64,8,8],[128,8,16]]){
  const packet=source(actors),before=digest(packet),parts=await prepareReviewParts(packet,{key:"offline",count:async p=>p.players.length*10000});
  assert.equal(parts.length,expected);assert.ok(parts.every(p=>p.packet.players.length<=maxPlayers));
  assert.deepEqual(parts.flatMap(p=>p.packet.players.map(x=>x.id)).sort(),packet.players.map(p=>p.id).sort());
  for(const part of parts)for(const player of part.packet.players)assert.deepEqual(player,packet.players.find(p=>p.id===player.id),"all individual stats, context and markets remain intact");
  assert.equal(digest(packet),before);
 }
 const packet=source(14);packet.sport="nba";packet.players.forEach(p=>p.markets=["points"]);
 assert.equal((await prepareReviewParts(packet,{key:"offline",count:async p=>p.players.length*10000})).length,2,"NBA batching remains unchanged");
 let calls=0;const store=new Proxy({},{get(){calls++;throw Error("closed slot must not touch wallet");}});
 for(const state of ["failed","completed"]){const result=await runPropsReview({packet,job:{state} as never,store:store as never,key:"offline",writerRunId:"offline",preferStronger:false,prepare:async()=>{calls++;throw Error("closed slot must not prepare");}});assert.equal(result.status,"skipped");}
 assert.equal(calls,0,"a new release cannot reset or repurchase failed/completed slots");
 // Maximum supported actor/part layouts use every catalog market. Counts below
 // are deliberately injected, not vendor-token measurements or billing claims.
 const schemaBytes:{sport:string;actors:number;parts:number;largestRequestBytes:number;largestResponseBytes:number;largestScenarioStatistics:number}[]=[];
 for(const [sport,actors] of [['nba',64],['nfl',128],['mlb',64]] as const){
  const all=source(actors);all.sport=sport;all.players.forEach(p=>{p.markets=[...CATALOG[sport].required];});
  const original=digest(all);let countCalls=0,largestRequestBytes=0,largestResponseBytes=0,largestScenarioStatistics=0;
  const parts=await prepareReviewParts(all,{key:'offline',count:async part=>{
   countCalls++;const request=jointReviewRequest(part,PROPS_AI_PRIMARY_MODEL,7000);
   largestRequestBytes=Math.max(largestRequestBytes,Buffer.byteLength(JSON.stringify(request)));
   assert.equal(request.max_output_tokens,7000);const input=JSON.parse(request.input),catalog=compileReaderClaims(part);
   assert.equal(input.document.wireRelease,PROPS_AI_WIRE_RELEASE);
   assert.deepEqual(Object.keys(input.document.verifiedReaderClaims).sort(),part.players.map(p=>p.id).sort());
   const response={wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(part.players.map(player=>{
    const selections=buildVerifiedReaderSelections(part,player.id);
    for(const area of Object.keys(catalog[player.id].areas) as (keyof typeof selections.coverage)[])assert(catalog[player.id].areas[area].requiredClaimIds.every(id=>selections.coverage[area].claimIds.includes(id)));
    assert.equal(selections.exceptions.length,player.markets.length);
    const canonical={weights:Array(16).fill(1),outcomes:Object.fromEntries(primitives(sport,player).map(stat=>[stat,Array(16).fill(stat==='passing_attempts'?30:stat==='passing_completions'?20:0)]))};
    const law=encodeCanonicalScenarioLaw(sport,player,canonical);largestScenarioStatistics=Math.max(largestScenarioStatistics,generativeStatistics(sport,player).length);
    return[player.id,{...selections,priorRead:{},evidenceIds:['e0'],law,confidence:player.markets.map(()=>1)}];
   }))};
   largestResponseBytes=Math.max(largestResponseBytes,Buffer.byteLength(JSON.stringify(response)));
   return part.players.length*10000;
  }});
  assert.equal(parts.length,sport==='nfl'?16:8);assert(countCalls>0);
  assert(parts.every(p=>p.packet.players.length===8));assert.deepEqual(parts.flatMap(p=>p.packet.players.map(x=>x.id)).sort(),all.players.map(p=>p.id).sort());
  for(const part of parts)for(const player of part.packet.players)assert.deepEqual(player,all.players.find(p=>p.id===player.id),'The full source facts and all8/10/17markets survive new claim schema preparation');
  assert.equal(digest(all),original);assert(largestResponseBytes<32000,'Structured reader selections retain a bounded compact JSON output; this is a byte check, not an authoritative tokenizer proof');
  schemaBytes.push({sport,actors,parts:parts.length,largestRequestBytes,largestResponseBytes,largestScenarioStatistics});
 }
 console.log(JSON.stringify({proof:'future_claim_schema_complete_all_sport_capacity',schemaBytes,tokenCountMeaning:'All input counts injected; output byte sizes are diagnostic proxies, not guaranteed billed-token or completion bounds.'}));

 assert.equal(PROPS_AI_MAX_OUTPUT_PER_REQUEST,7000);
 const perSlot=DEFAULT_PROPS_SOURCE_BOUNDS.nfl.reduce((n,r)=>n+usageMicroUsd(PROPS_AI_PRIMARY_MODEL,{input_tokens:r.input_tokens,output_tokens:r.max_output_tokens}),0);
 assert.equal(perSlot,76000,"updated NFL full-month default envelope reserves 7.6 cents per primary slot, not a bill");
 console.log("Offline NFL headroom proof passed: 43 actors/8 smaller parts, unchanged 128-actor capacity, exact evidence/scope coverage, NBA unchanged, closed-slot immutability, unchanged output ceiling and bounded monthly envelope; zero network.");
}
void main();
