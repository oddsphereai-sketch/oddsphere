import assert from "node:assert/strict";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import {readCbbMarketBehavior,CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import {buildCbbProvisionalBoard} from "../lib/cbb/provisionalBoard";
import type {CbbForecast,CbbQuote} from "../lib/cbb/types";

// Actual unlocked CLT/GAST receipt captured after the normal 21:02 refresh on
// 2026-11-04. The original independent uncertainty was stored, not reconstructed.
// Frozen provenance: cbb-history-law-live-watchlist-final-raw-20261104.json,
// member key cbb::member-game::10882652. No outcomes or provider calls are used.
const asOf="2026-11-04T21:02:38.373Z",startsAt="2026-11-06T00:00:00.000Z";
const independent:CbbForecast={release:CBB_CURRENT_SCORE_RELEASE,gameId:10882652,homeId:40,awayId:337,asOf,
 homeScore:80.46742949297743,awayScore:63.93150185141175,total:144.39893134438918,margin:16.535927641565685,
 homeWinProbability:.9231859526730855,possessions:66.6192711190169,inputStatus:"complete",issues:[],
 uncertainty:{games:11383,totalSd:16.993742849108834,marginSd:11.882808501656784,totalCorrection:.822132324525501,
  fitThroughSeason:2024,marginCorrection:-.13713535132332144,marginTotalCorrelation:.025514787619637783}};
const quote=(market:CbbQuote["market"],line:number|null,firstPrice:number,secondPrice:number,sportsbook="fanduel")=>({
 gameId:independent.gameId,market,line,firstPrice,secondPrice,sportsbook,provider:"owls" as const,phase:"current" as const,
 orientationVerified:true as const,requestedAt:"2026-11-04T21:02:35.439Z",fetchedAt:"2026-11-04T21:02:35.606Z",
 providerObservedAt:"2026-11-04T21:01:44.963Z"});
const actualTargets=[quote("moneyline",null,-850,570),quote("spread",-11.5,-115,-105),quote("total",151.5,-110,-110)];
function run(targets:CbbQuote[],currentQuotes:CbbQuote[]=[],extra:Partial<Parameters<typeof readCbbMarketBehavior>[0]>={}){
 const read=readCbbMarketBehavior({independent,independentInputKey:"frozen-clt-gast-20261104-210238",startsAt,
  targets,currentQuotes,anchors:null,...extra});
 const board=buildCbbProvisionalBoard(read.forecast,[...targets,...currentQuotes],{marketBehavior:read.receipt});
 return {read,board,ml:board.rows.find(r=>r.market==="moneyline")!};
}
const inputBytes=JSON.stringify(independent),actual=run(actualTargets);
assert.equal(actual.ml.grade,"Lean","actual positive-value -850 CLT moneyline must not be vetoed by an arbitrary -250 floor");
assert.equal(actual.ml.professionalReferences,0,"the actual case cannot invent sharp confirmation");
assert.equal(actual.ml.probability,independent.homeWinProbability);
assert.equal(actual.ml.price,-850);assert.equal(actual.ml.selection,"first");
assert.ok(Math.abs(actual.ml.expectedValue!-.03179606475227198)<1e-12);
assert.equal(actual.ml.gradeBasis,"model_value","no source means model value, not a manufactured Best Angle");
assert.deepEqual(actual.board.score,actual.read.receipt.finalScore);
assert.equal(JSON.stringify(independent),inputBytes,"classification must not mutate the independent forecast");

// Controlled native source quote: its two real-form payouts imply 89% fair
// home probability with 4% hold. The reader derives its coherent final law;
// these tests never inject a final probability or bypass the reader to grade.
const american=(p:number)=>p>=.5?-100*p/(1-p):100*(1-p)/p;
const source=quote("moneyline",null,american(.89*1.04),american(.11*1.04),"circa");
const supported=run([quote("moneyline",null,-350,270)],[source]);
assert.ok(Math.abs(supported.ml.probability!-.89)<1e-10);
assert.ok(supported.ml.expectedValue!>=.08);
assert.equal(supported.ml.grade,"Best Angle","qualified professional exact-target economics remain eligible below -250");
assert.equal(supported.ml.gradeBasis,"model_and_professional_value");
assert.equal(supported.ml.professionalReferences,1);
assert.equal(supported.ml.pathResistance,false);
const mirroredIndependent:CbbForecast={...independent,homeId:independent.awayId,awayId:independent.homeId,
 homeScore:independent.awayScore,awayScore:independent.homeScore,margin:-independent.margin,
 homeWinProbability:1-independent.homeWinProbability,
 uncertainty:{...independent.uncertainty,marginTotalCorrelation:-independent.uncertainty.marginTotalCorrelation}};
const mirror=run([quote("moneyline",null,270,-350)],
 [{...source,firstPrice:source.secondPrice,secondPrice:source.firstPrice}],{independent:mirroredIndependent});
assert.equal(mirror.ml.selection,"second","away favorites receive the same exact-price eligibility");
assert.equal(mirror.ml.price,-350);assert.equal(mirror.ml.grade,"Best Angle");
assert.ok(Math.abs(mirror.ml.probability!-supported.ml.probability!)<1e-10);

for(const [price,other,expectedGrade] of [[-500,400,"Lean"],[-700,500,"Watchlist"],[-850,570,"Watchlist"],[-5000,1800,"Watchlist"]] as const){
 const worse=run([quote("moneyline",null,price,other)],[source]);
 assert.equal(worse.ml.grade,expectedGrade,`${price}: only actual payout economics and existing evidence requirements govern the tier`);
 assert.deepEqual(worse.read.receipt.finalScore,supported.read.receipt.finalScore,"execution payout cannot rewrite the source-conditioned score");
 assert.equal(worse.ml.probability,supported.ml.probability);
 assert.equal(worse.ml.selection,"first","do not switch to the weaker-probability underdog to manufacture value");
 if(price===-700)assert.ok(worse.ml.expectedValue!>0&&worse.ml.expectedValue!<.03);
 if(price<=-850)assert.ok(worse.ml.expectedValue!<0);
}
assert.ok(100/5000<.03,"even certainty cannot clear the existing Lean EV reserve at -5000; no extra price cap is needed");

// Held own-book money pressure is genuine context, never permission to wager
// at a negative-EV execution price. Arrival and native response clocks bind.
const prior={...source,requestedAt:undefined,providerObservedAt:"2026-11-04T20:20:00Z",fetchedAt:"2026-11-04T20:21:00Z"};
const pressured=run([quote("moneyline",null,-5000,1800)],[source],{
 anchors:{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:independent.gameId,startsAt,independentRelease:independent.release,
  independentInputKey:"frozen-clt-gast-20261104-210238",capturedAt:"2026-11-04T20:21:00Z",quotes:[prior]},
 flows:[{provider:"owls",gameId:independent.gameId,sourceBook:"circa",market:"moneyline",line:null,firstMoney:.99,secondMoney:.01,
  firstTickets:.6,secondTickets:.4,sourceEventId:"controlled-clt-native-money",sourceIdentity:"independent_named_fixture_join",
  orientationVerified:true,observedAt:"2026-11-04T20:30:00Z",fetchedAt:"2026-11-04T20:31:00Z"}]});
assert.ok(pressured.read.receipt.pressureDecisions.some(p=>p.book==="circa"&&p.reaction==="held"),"exercise admitted native money and actual held response");
assert.equal(pressured.ml.selection,"first");assert.ok(pressured.ml.expectedValue!<0);
assert.equal(pressured.ml.grade,"Watchlist","99% sharp-book concentration cannot promote bad executable economics");

// No source gives the actual CLT datum only Lean even with a large payout edge.
assert.equal(run([quote("moneyline",null,-350,270)]).ml.grade,"Lean");
assert.ok(run([],[]).board.rows.every(row=>row.grade==="Held"),"missing executable markets stay Held");
assert.ok(run(actualTargets,[],{independent:{...independent,inputStatus:"incomplete"}}).board.rows.every(row=>row.grade==="Held"),
 "missing forecast inputs cannot become priced informational or actionable grades");

// This change is moneyline-only. Existing spread/total -500 eligibility is
// deliberately unchanged even for very favorable forecast thresholds.
for(const [market,line] of [["spread",-1.5],["total",110.5]] as const){
 const expensive=run([quote(market,line,-600,450)]).board.rows.find(r=>r.market===market)!;
 const allowed=run([quote(market,line,-500,400)]).board.rows.find(r=>r.market===market)!;
 assert.equal(expensive.selection,"first");assert.ok(expensive.expectedValue!>=.03);
 assert.equal(expensive.grade,"Watchlist");assert.equal(expensive.reason,"price_too_steep_for_actionable");
 assert.equal(allowed.grade,"Lean");
 assert.equal(expensive.probability,allowed.probability);
}
console.log("CBB moneyline price eligibility: actual CLT, source-priced Best, adverse-payout demotions, sharp-pressure/missing/non-ML controls passed");
