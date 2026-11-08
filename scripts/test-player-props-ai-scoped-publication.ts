import assert from "node:assert/strict";
import {PRODUCT_RELEASE,type GamePacket,type Player} from "../lib/playerPropsAi/evidenceContract";
import {criticalContextHashes} from "../lib/playerPropsAi/criticalContext";
import {validateLaw} from "../lib/playerPropsAi/law";
import {PROPS_AI_RELEASE,PROPS_AI_SELECTION_RELEASE} from "../lib/playerPropsAi/releases";
import {selectSiteReview,siteAiDecisions,siteReviewCoverage} from "../lib/playerPropsAi/publication";
import type {AcceptedGameReview} from "../lib/playerPropsAi/reviewer";
import {reviewPropsForSite} from "../lib/playerPropsAi/siteRuntime";
import {PROPS_AI_CONTROL_RELEASE} from "../lib/playerPropsAi/siteConfig";

// No provider, token-count or generation calls are permitted in this regression.
globalThis.fetch=async()=>{throw Error("Offline proof forbids network");};
const now="2026-11-08T18:00:00Z",start="2026-11-08T23:00:00Z",lock="2026-11-08T22:00:00Z";
const actor=(id:string):Player=>({id,name:id,team:"BOS",opponent:"NYK",markets:["points","rebounds"],missing:[],
  evidence:[{id:id+":availability",kind:"availability",source:"synthetic",availableAt:now,value:{status:"available"}}]});
const packet:GamePacket={release:PRODUCT_RELEASE,sport:"nba",gameId:"native",start,lock,cutoff:now,stage:"early",sourceLimitations:[],players:[actor("a"),actor("b")],
  quotes:["a","b"].flatMap(playerId=>["points","rebounds"].flatMap(market=>["over","under"].map(side=>({id:[playerId,market,side].join(":"),playerId,market,provider:"synthetic",book:"one",line:market==="points"?12.5:3.5,side:side as "over"|"under",american:-110,observedAt:now,receivedAt:now,receivedAtProvenance:"provider_response" as const,opening:false,live:false}))))};
const vector=(n:number)=>Array(16).fill(n);
const law=(p:Player)=>validateLaw("nba",p,{weights:[9,1,...Array(14).fill(0)],outcomes:{points:[10,40,...Array(14).fill(10)],rebounds:vector(2),assists:vector(3),threes:vector(0)}});
const review={release:PROPS_AI_RELEASE,gameId:"funded",sourceGameId:"native",start,lock,cutoff:now,stage:"early",issuedAt:now,inputHash:"synthetic",model:"synthetic",criticalContextHashes:criticalContextHashes(packet),marketScopes:{a:["points","rebounds"],b:["points","rebounds"]},partProvenance:[],inputEvidence:{digest:"synthetic"},
  players:packet.players.map(p=>({playerId:p.id,assessment:"Synthetic",law:law(p),confidence:[2,0],exceptions:[null,"Unresolved rebound source"],coverage:{}}))} as unknown as AcceptedGameReview;
const frozen=JSON.stringify(review),original=siteAiDecisions(packet,review,now);
for(const release of ["player_props_ai_2026_11_08_r15_review_window_handoff","player_props_ai_2026_11_08_r16_nfl_output_headroom"] as const){
  const retained={...review,release},retainedBefore=JSON.stringify(retained);
  assert.equal(selectSiteReview(packet,[retained],now),retained);
  assert.ok(siteAiDecisions(packet,retained,now).every(c=>c.evidence.release===retained.release),"accepted R15/R16 laws retain their own release, never relabeled as the new generation");
  assert.equal(JSON.stringify(retained),retainedBefore);
}
assert.equal(original.length,4);
const added=structuredClone(packet);added.players.push(actor("c"));
added.players[0].markets.push("assists");
added.quotes.push({...added.quotes[0],id:"new-scope",market:"assists"},{...added.quotes[0],id:"new-actor",playerId:"c"});
assert.equal(selectSiteReview(added,[review],now),review);
assert.deepEqual(siteAiDecisions(added,review,now),original,"new actors/scopes cannot erase unchanged decisions or inherit unreviewed confidence");
const coverage=siteReviewCoverage(added,review,now);
assert.equal(coverage.filter(p=>p.reviewed).length,2);
assert.deepEqual(coverage.find(p=>p.playerId==="a")?.unreviewedMarkets,["assists"]);
assert.equal(coverage.find(p=>p.playerId==="c")?.reviewed,false);
const changed=structuredClone(added);changed.players[0].evidence[0].value={status:"out"};
const remaining=siteAiDecisions(changed,review,now);
assert.ok(remaining.length>0&&remaining.every(c=>c.playerId==="b"),"actual changed availability rejects that actor; unaffected actor remains valid");
assert.equal(siteReviewCoverage(changed,review,now).find(p=>p.playerId==="a")?.contextCurrent,false);
const shared=structuredClone(packet);shared.players.forEach(p=>p.evidence.push({id:"team-injury",kind:"availability",source:"synthetic",availableAt:now,value:{teammate:"out"}}));
assert.equal(selectSiteReview(shared,[review],now),null,"a team injury still invalidates every actor whose supplied context changed");
const reordered=structuredClone(packet);reordered.players.forEach(p=>p.markets.reverse());
const priced=siteAiDecisions(reordered,review,now);
for(const c of priced){assert.equal(c.evidence.confidence,c.market==="points"?2:0);assert.equal(c.evidence.exception,c.market==="points"?null:"Unresolved rebound source");assert.equal(c.evidence.selectionRelease,PROPS_AI_SELECTION_RELEASE);}
const removed=structuredClone(packet);removed.players=removed.players.slice(0,1);removed.players[0].markets=["rebounds"];
const subset=siteAiDecisions(removed,review,now);assert.equal(subset.length,1);assert.equal(subset[0].evidence.confidence,0);assert.equal(subset[0].grade,"No Play");
const final={...review,stage:"final" as const};assert.equal(selectSiteReview(packet,[review,final],now),final);
for(const bad of [{...review,sourceGameId:"wrong"},{...review,start:"2026-11-08T23:01:00Z"},{...review,lock:"2026-11-08T22:01:00Z"},{...review,issuedAt:"2026-11-08T18:01:00Z"}])assert.equal(selectSiteReview(packet,[bad],now),null);
assert.equal(siteAiDecisions(packet,review,lock).length,0);
assert.equal(siteAiDecisions(packet,review,"2026-11-08T18:16:00Z").length,0,"stale prices remain ineligible");
const wrongTeam=structuredClone(packet);wrongTeam.players[0].team="WRONG";assert.ok(siteAiDecisions(wrongTeam,review,now).every(c=>c.playerId!=="a"));
const duplicate={...review,players:[...review.players,review.players[0]]};assert.ok(siteAiDecisions(packet,duplicate,now).every(c=>c.playerId!=="a"));
assert.equal(JSON.stringify(review),frozen,"the accepted review, evidence and law remain immutable");
console.log("Offline scope proof passed: new/removed actors and markets, confidence order, actual injury/team rejection, final precedence, exact clocks, fresh prices, immutable accepted reviews; zero network.");

async function runtimeProof(){
  const before={site:process.env.PLAYER_PROPS_AI_SITE_ENABLED,paid:process.env.PLAYER_PROPS_AI_PAID_RUNS_ENABLED};
  process.env.PLAYER_PROPS_AI_SITE_ENABLED="true";process.env.PLAYER_PROPS_AI_PAID_RUNS_ENABLED="false";
  const loaded:string[]=[];
  const client={from:(table:string)=>{
    const chain={select:()=>chain,eq:()=>chain,gte:()=>chain,order:()=>chain,
      single:async()=>({error:null,data:{release:PROPS_AI_CONTROL_RELEASE,paid_enabled:false}}),
      limit:async()=>({error:null,data:table==="player_props_ai_reviews"?[{result:review}]:[]})};return chain;
  }};
  try{
    const result=await reviewPropsForSite({client:client as never,sport:"nba",clock:()=>now,games:[
      {id:"native",start,home:"NYK",away:"BOS"},
      {id:"sunday-night",start:"2026-11-09T01:20:00Z",home:"NYK",away:"BOS"},
      {id:"monday",start:"2026-11-09T23:00:00Z",home:"NYK",away:"BOS"}],
      load:(game,window)=>{loaded.push(game.id);return {...added,gameId:game.id,start:game.start,lock:window.lock};}});
    assert.deepEqual(loaded,["native","sunday-night"],"Eastern day includes Sunday night UTC Monday, excludes actual Monday");
    assert.equal(result.coverage?.[0].players,3);assert.equal(result.coverage?.[0].reviewedPlayers,2);
    assert.equal(result.coverage?.[0].eligiblePlayers,2);assert.equal(result.coverage?.[0].pricedPlayers,2);
    assert.equal(result.coverage?.[0].unreviewedScopes,3);
  }finally{
    if(before.site===undefined)delete process.env.PLAYER_PROPS_AI_SITE_ENABLED;else process.env.PLAYER_PROPS_AI_SITE_ENABLED=before.site;
    if(before.paid===undefined)delete process.env.PLAYER_PROPS_AI_PAID_RUNS_ENABLED;else process.env.PLAYER_PROPS_AI_PAID_RUNS_ENABLED=before.paid;
  }
  console.log("Offline day-of runtime and honest coverage-count proof passed; paid transport disabled.");
}
void runtimeProof();
