import assert from "node:assert/strict";
import {cbbCanonicalBehaviorInputs} from "../lib/services/cbb/cbbCanonicalBehaviorInputs";
import {readCbbMarketBehavior,gradeCbbMarketBehavior} from "../lib/cbb/marketBehaviorCandidate";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import {normalCdf} from "../lib/cbb/model";
import type {CbbForecast,CbbQuote} from "../lib/cbb/types";
import { pairCbbCanonicalMarketEvidence, type CbbCanonicalPriceRow, type CbbCanonicalSplitRow } from "../lib/services/cbb/cbbCanonicalMarketEvidence";
import type { CbbGame } from "../lib/cbb/types";
const decisionAt="2026-11-02T16:00:00Z",start="2026-11-02T23:00:00Z",fetched="2026-11-02T15:30:00Z";
const run="cbb:2026-11-02:2026-11-02T15:30:00Z",source="2026-11-02T15:29:00Z",event="ncaab:Pepperdine@Cornell-20261102";
const team=(id:number,college:string)=>({id,college,name:college,full_name:college,abbreviation:college.slice(0,3),conference_id:1});
const game:CbbGame={id:777,date:start,season:2026,status:"pre",period:0,home_team:team(1,"Cornell"),visitor_team:team(2,"Pepperdine"),home_score:0,away_score:0};
function price(side:"home"|"away",id:number):CbbCanonicalPriceRow{
 return {id,provider:"owls",provider_event_id:event,ingestion_run_id:run,canonical_event_id:"777",canonical_market_id:"777:spread",league:"cbb",
  sportsbook:"circa",sharp_book:true,market_type:"spread",selection_key:`777:spread:${side}`,line:side==="home"?3:-3,american_price:-110,
  decimal_price:1+100/110,no_vig_probability:.5,provider_timestamp:source,fetched_at:fetched,inserted_at:side==="home"?"2026-11-02T15:30:03Z":"2026-11-02T15:30:04Z",
  raw_payload_hash:String(id).padStart(64,"a"),minutes_to_start:450};
}
function split(side:"home"|"away",id:number):CbbCanonicalSplitRow{
 return {id,provider:"owls",provider_event_id:event,ingestion_run_id:run,canonical_event_id:"777",canonical_market_id:"777:spread",league:"cbb",
  source_book:"circa",source_type:"sharp_adjacent_book",market_type:"spread",selection_key:`777:spread:${side}`,market_line:side==="home"?3:-3,market_price:null,
  money_pct:side==="home"?.1:.9,bets_pct:side==="home"?.6:.4,source_observed_at:source,fetched_at:fetched,
  inserted_at:side==="home"?"2026-11-02T15:30:01Z":"2026-11-02T15:30:02Z",source_timestamp_verified:true,split_line_basis:"provider_explicit",books_used:null,
  raw_payload_hash:String(id).padStart(64,"b"),minutes_to_start:450};
}
const prices=[price("home",1),price("away",2)],splits=[split("home",3),split("away",4)];
const read=(priceRows=prices,splitRows:CbbCanonicalSplitRow[]=splits,extra:Partial<Parameters<typeof pairCbbCanonicalMarketEvidence>[0]>={})=>
 pairCbbCanonicalMarketEvidence({game,decisionAt,priceRows,splitRows,...extra});
function forecast(asOf=decisionAt):CbbForecast{
 const margin=12,total=150,sd=11,zero=normalCdf((.5-margin)/sd)-normalCdf((-.5-margin)/sd);
 return {release:CBB_CURRENT_SCORE_RELEASE,gameId:game.id,asOf,homeId:1,awayId:2,homeScore:81,awayScore:69,margin,total,
  homeWinProbability:(1-normalCdf((.5-margin)/sd))/(1-zero),possessions:70,inputStatus:"complete",issues:[],
  uncertainty:{marginSd:sd,totalSd:16,marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:1000}};
}
const at=(m:number)=>`2026-11-02T15:${String(m).padStart(2,"0")}:00Z`;
const priceFrame=(m:number,id:number,line=3)=>prices.map((p,i)=>({...p,id:id+i,line:i===0?line:-line,provider_timestamp:at(m),
 fetched_at:at(m+1),ingestion_run_id:`cbb:2026-11-02:${at(m+1)}`,inserted_at:`2026-11-02T15:${String(m+1).padStart(2,"0")}:05Z`}));
const splitFrame=(m:number,id:number,line=3)=>splits.map((p,i)=>({...p,id:id+i,market_line:i===0?line:-line,source_observed_at:at(m),
 fetched_at:at(m+1),ingestion_run_id:`cbb:2026-11-02:${at(m+1)}`,inserted_at:`2026-11-02T15:${String(m+1).padStart(2,"0")}:04Z`}));
const beforePrices=priceFrame(0,101),middlePrices=priceFrame(10,201),afterPrices=priceFrame(20,301,2);
const beforeSplits=splitFrame(0,401),middleSplits=splitFrame(10,501),afterSplits=splitFrame(20,601,2);
const current:CbbQuote={...{orientationVerified:true},gameId:777,provider:"owls",sportsbook:"circa",market:"spread",line:2,
 firstPrice:-110,secondPrice:-110,providerObservedAt:at(25),fetchedAt:at(26),phase:"current"};
const target:CbbQuote={...current,sportsbook:"draftkings",line:6};
function candidate(inputs:ReturnType<typeof cbbCanonicalBehaviorInputs>,asOf=decisionAt,
 previous?:ReturnType<typeof readCbbMarketBehavior>){
 return readCbbMarketBehavior({independent:forecast(asOf),independentInputKey:"fixture-independent-r3",startsAt:start,targets:[target],
  currentQuotes:[target,current],anchors:previous?.receipt.anchors??null,historyQuotes:inputs.historyQuotes,historyFlows:inputs.historyFlows,
  previousPath:previous?.receipt.pathTape,quarantinedSources:previous?[]:inputs.quarantinedSources});
}
function grade(result:ReturnType<typeof readCbbMarketBehavior>){
 return gradeCbbMarketBehavior({forecast:result.forecast,target,references:[current],asOf:result.forecast.asOf},result.receipt);
}
const cleanInputs=cbbCanonicalBehaviorInputs(read([...beforePrices,...afterPrices],[]));
const clean=candidate(cleanInputs),cleanGrade=grade(clean);
assert.equal(clean.forecast.margin,12,"a source moving toward the independent score confirms it without double-moving its location");
assert.equal(clean.receipt.margin.status,"confirming");
assert.ok(cleanGrade.professionalReferences>0);
for(const kind of ["price","split"] as const){
 const native=kind==="price"?read([...beforePrices,...middlePrices,{...middlePrices[0],id:203,american_price:-130},...afterPrices],[]):
  read([...beforePrices,...afterPrices],[...beforeSplits,...middleSplits,{...middleSplits[0],id:503,money_pct:.8},...afterSplits]);
 const inputs=cbbCanonicalBehaviorInputs(native);
 assert.ok(inputs.quarantinedSources.some(q=>q.book==="circa"&&q.sourceAt===at(10)),`${kind} unsafe middle frame must reach candidate inputs`);
 const result=candidate(inputs),decision=grade(result);
 assert.equal(result.forecast.margin,12,`${kind} gap blocks numeric source authority instead of bridging surviving endpoints`);
 assert.equal(result.receipt.pathTape.streams.find(s=>s.book==="circa"&&s.market==="spread")?.quarantined,true);
 assert.ok(result.receipt.anchors.quarantinedKeys?.includes("circa:spread"));
 assert.equal(decision.professionalReferences,0,`${kind} gap blocks professional grade authority`);
 assert.equal(decision.economicCorroboration,false);assert.equal(decision.economicPathConfirmation,false);assert.equal(decision.actualActionConfirmation,false);
 assert.notEqual(decision.grade,"Best Angle");
 const repeated=candidate(inputs,"2026-11-02T16:01:00Z",result),repeatedGrade=grade(repeated);
 assert.equal(repeated.forecast.margin,12,"quarantine persists after the current loader no longer supplies the middle descriptor");
 assert.equal(repeatedGrade.professionalReferences,0);assert.equal(repeatedGrade.actualActionConfirmation,false);
 assert.ok(repeated.receipt.anchors.quarantinedKeys?.includes("circa:spread"));
}
console.log("PASS CBB native parser→candidate→grade: price and split unsafe-middle gaps persist, block numeric/grade source authority, and never become clean endpoint paths.");
