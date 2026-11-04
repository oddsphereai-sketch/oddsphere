import assert from "node:assert/strict";
import {normalCdf} from "../lib/cbb/model";
import {reviewCbbQuote} from "../lib/cbb/marketEvidence";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import {readCbbMarketBehavior,gradeCbbMarketBehavior,CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import {buildCbbProvisionalBoard} from "../lib/cbb/provisionalBoard";
import {advanceCbbProvisionalSnapshot} from "../lib/cbb/provisionalLifecycle";
import {adaptCbbProvisionalGame} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import {selectTopAvailableAngles} from "../app/lab/components/daily-edge/selectTopAvailableAngles";
import {headlinePrimaryMarket} from "../app/lab/lib/perPickHeadline";
import {primaryDailyEdgeMarket} from "../app/lab/lib/dailyEdgeReaderState";
import {gradeNbaMarket} from "../lib/services/nba/nbaMarketReview";
import type {CbbForecast,CbbQuote,CbbGame} from "../lib/cbb/types";

const asOf="2026-11-04T16:32:38.327Z",startsAt="2026-11-05T01:00:00.000Z";
// Actual frozen NKU/SDAK independent datum, not probabilities chosen to force
// a grade. The reader owns all subsequent market-conditioned probabilities.
const independent:CbbForecast={release:CBB_CURRENT_SCORE_RELEASE,gameId:10882621,homeId:330,awayId:172,asOf,
 homeScore:83.39547864486079,awayScore:79.71176416918178,margin:3.683714475679024,total:163.10724281404256,
 homeWinProbability:.6256355759883397,possessions:74.94842060428896,inputStatus:"complete",issues:[],
 uncertainty:{games:11383,totalSd:16.993742849108834,marginSd:11.882808501656784,totalCorrection:.822132324525501,
  fitThroughSeason:2024,marginCorrection:-.13713535132332144,marginTotalCorrelation:.025514787619637783}};
const quote=(market:CbbQuote["market"],line:number|null,firstPrice:number,secondPrice:number,sportsbook="draftkings"):CbbQuote&{orientationVerified:true;requestedAt:string}=>({
 gameId:independent.gameId,market,line,firstPrice,secondPrice,sportsbook,provider:"owls",phase:"current",orientationVerified:true,
 requestedAt:"2026-11-04T16:32:35.803Z",providerObservedAt:"2026-11-04T16:32:11.742Z",fetchedAt:"2026-11-04T16:32:36.108Z"});
const targets=[quote("moneyline",null,124,-148),quote("spread",2.5,-108,-112),quote("total",162.5,-108,-112)];
const sources=[quote("moneyline",null,120,-140,"circa"),quote("spread",2.5,-110,-110,"circa"),quote("total",162,-110,-110,"circa")]
 .map(q=>({...q,providerObservedAt:"2026-11-04T16:32:20.082Z"}));
const args={independent,independentInputKey:"actual-frozen-nku-sdak-input",startsAt,targets,currentQuotes:sources,anchors:null};
const inputBytes=JSON.stringify(args),read=readCbbMarketBehavior(args);
const board=buildCbbProvisionalBoard(read.forecast,[...targets,...sources],{marketBehavior:read.receipt});
for(const row of board.rows){
 const target=targets.find(q=>q.market===row.market)!;
 const review=reviewCbbQuote(read.forecast,target);
 assert.ok(Number.isFinite(review.probability)&&review.probability>0&&review.probability<1);
 assert.ok(review.expectedValue<0,`${row.market} actual exact-price economics are negative`);
 assert.equal(row.grade,"Watchlist",`${row.market} still has a valid informational forecast`);
 assert.equal(row.reason,"forecast_available_price_not_actionable");
 assert.equal(row.gradeBasis,"forecast_monitoring");
 assert.equal(row.selection,review.selection);assert.equal(row.probability,review.probability);
 assert.equal(row.expectedValue,review.expectedValue);assert.equal(row.price,review.selection==="first"?target.firstPrice:target.secondPrice);
 const graded=gradeCbbMarketBehavior({forecast:read.forecast,target,references:sources,asOf},read.receipt);
 assert.equal(graded.stake,0,"Watchlist never creates a wager");
 // The active NBA caller is nbaMarketIntelligence.buildML/Spread/Total:
 // gradeMarket defaults to gradeNbaMarket and passes final uncapped p/price.
 // The older buildMarketReviewRows helper omits those economics; do not use it.
 const nba=gradeNbaMarket({market:row.market,pick:row.market==="total"?(row.selection==="first"?"over":"under"):
  row.selection==="first"?"home":"away",confidence:review.probability*100,modelProbabilityOnPick:review.probability,
  currentPriceAmerican:row.price,band:"neutral",edge:review.probability-row.marketFairProbability!,
  dataQualityTier:"high",injuriesKnown:true,continuousMarketDecision:true});
 assert.equal(nba.grade,"watch","NBA production economics likewise preserves a valid negative-EV forecast as informational");
 assert.equal(nba.bestAngleEligible,false);
 assert.ok(nba.rationale.some(r=>r.includes("does not clear positive value")),"exercise the actual price guard, not a low-confidence sleeve");
}
assert.equal(JSON.stringify(args),inputBytes,"the Watchlist classification cannot change the supplied independent forecast or quotes");
assert.deepEqual(board.score,read.receipt.finalScore);

// A separate stress fixture retains the actual SCU independent datum and
// real current Circa contracts. Only the execution payouts and pressure
// sequence are synthetic; no probability or score is forced for a grade.
const margin=21.60238971580011,total=158.22397759322138,sd=independent.uncertainty.marginSd;
const zero=normalCdf((.5-margin)/sd)-normalCdf((-.5-margin)/sd);
const scu:CbbForecast={...independent,gameId:10882627,homeId:363,awayId:171,margin,total,
 homeScore:89.91318365451075,awayScore:68.31079393871063,homeWinProbability:(1-normalCdf((.5-margin)/sd))/(1-zero),possessions:74.01177272978728};
const current=[quote("moneyline",null,-2100,1150,"circa"),quote("spread",-17,-110,-110,"circa"),quote("total",161.5,-110,-110,"circa")]
 .map(q=>({...q,gameId:scu.gameId}));
const overpriced=[quote("moneyline",null,-5000,800),quote("spread",-16.5,-400,300),quote("total",157.5,-400,300)]
 .map(q=>({...q,gameId:scu.gameId}));
const originals=current.map(q=>({...q,requestedAt:undefined,providerObservedAt:"2026-11-04T15:20:00Z",fetchedAt:"2026-11-04T15:21:00Z"}));
const supported=readCbbMarketBehavior({independent:scu,independentInputKey:"actual-scu-datum-stress-prices",startsAt,targets:overpriced,currentQuotes:current,
 anchors:{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:scu.gameId,startsAt,independentRelease:scu.release,
  independentInputKey:"actual-scu-datum-stress-prices",capturedAt:"2026-11-04T15:21:00Z",quotes:originals},
 flows:current.map(q=>({provider:"owls",gameId:scu.gameId,sourceBook:"circa",market:q.market,line:q.line,
  firstMoney:.99,secondMoney:.01,firstTickets:.6,secondTickets:.4,sourceEventId:"ncaab:Milwaukee@Santa Clara-20261105",
  sourceIdentity:"independent_named_fixture_join",orientationVerified:true,observedAt:"2026-11-04T15:30:00Z",fetchedAt:"2026-11-04T15:31:00Z"}))});
const supportedBoard=buildCbbProvisionalBoard(supported.forecast,[...overpriced,...current],{marketBehavior:supported.receipt});
assert.equal(supported.receipt.pressureDecisions.filter(p=>p.book==="circa"&&p.reaction==="held").length,3);
for(const row of supportedBoard.rows){
 assert.equal(row.selection,"first");assert.ok(row.expectedValue!<0);
 assert.equal(row.grade,"Watchlist","99% source money cannot make an overpriced forecast actionable");
 assert.equal(row.reason,"forecast_available_price_not_actionable");
}

const team=(id:number,college:string,abbreviation:string)=>({id,college,abbreviation,name:college,full_name:college,conference_id:null});
function dto(forecast:CbbForecast,pricedBoard:ReturnType<typeof buildCbbProvisionalBoard>){
 const game:CbbGame={id:forecast.gameId,date:startsAt,season:2026,status:"pre",period:0,home_score:0,away_score:0,
  home_team:team(forecast.homeId,forecast.gameId===10882621?"South Dakota":"Santa Clara",forecast.gameId===10882621?"SDAK":"SCU"),
  visitor_team:team(forecast.awayId,forecast.gameId===10882621?"Northern Kentucky":"Milwaukee",forecast.gameId===10882621?"NKU":"MILW")};
 const snapshot=advanceCbbProvisionalSnapshot({existing:null,candidate:pricedBoard,startsAt,now:asOf});
 return adaptCbbProvisionalGame({game,snapshot,homeLogo:null,awayLogo:null,now:asOf});
}
for(const [forecast,pricedBoard] of [[read.forecast,board],[supported.forecast,supportedBoard]] as const){
 const displayed=dto(forecast,pricedBoard);
 for(const row of pricedBoard.rows){
  const market=displayed.markets[row.market==="spread"?"first_inning":row.market];
  assert.equal(market.verdict.key,"watchlist");assert.equal(market.modelProb,row.probability);
  assert.equal(market.confidence,row.probability);assert.equal(market.modelTrustPct,row.probability!*100);
  assert.equal(market.recommendationConfidence,null,"outcome likelihood is preserved without implying an actionable recommendation");
 }
 assert.deepEqual(selectTopAvailableAngles([displayed]).games,[],"negative-EV informational watches cannot enter the Top Available Angles fallback");
}
const gapRow=supportedBoard.rows.find(row=>row.market==="moneyline")!;
const gapDto=dto(supported.forecast,supportedBoard);
assert.ok(gapRow.expectedValue!<0&&gapDto.markets.moneyline.modelMarketGapPct!>=1.5,
 "a positive no-vig gap can coexist with negative actual-price EV; the fallback must reject both selection routes");

// Positive but sub-actionable model value keeps its existing informational
// confidence and fallback behavior; no threshold or confidence cap is copied.
const thinTarget={...quote("total",157.5,-105,-115),gameId:scu.gameId};
const thinRead=readCbbMarketBehavior({independent:scu,independentInputKey:"actual-scu-thin-price-control",startsAt,targets:[thinTarget],currentQuotes:[],anchors:null});
const thinBoard=buildCbbProvisionalBoard(thinRead.forecast,[thinTarget],{marketBehavior:thinRead.receipt});
const thinRow=thinBoard.rows.find(row=>row.market==="total")!;
assert.equal(thinRow.grade,"Watchlist");assert.ok(thinRow.expectedValue!>0&&thinRow.expectedValue!<.03);
const thinDto=dto(thinRead.forecast,thinBoard);
assert.equal(thinDto.markets.total.recommendationConfidence,thinRow.probability!*100);
assert.equal(selectTopAvailableAngles([thinDto]).games.length,1,"the existing genuinely positive-value Watchlist fallback remains available");

// New price-only ML watches must not bury the previously eligible Total
// watch through the old ML-first tie break, then exclude the entire game.
const mixedTargets=[quote("moneyline",null,-5000,800),quote("spread",-21.5,-110,-110),thinTarget]
 .map(q=>({...q,gameId:scu.gameId}));
const mixedRead=readCbbMarketBehavior({independent:scu,independentInputKey:"mixed-watch-value-control",startsAt,targets:mixedTargets,currentQuotes:[],anchors:null});
const mixedBoard=buildCbbProvisionalBoard(mixedRead.forecast,mixedTargets,{marketBehavior:mixedRead.receipt});
assert.ok(mixedBoard.rows.every(row=>row.grade==="Watchlist"));
const mixedDto=dto(mixedRead.forecast,mixedBoard);
assert.ok(mixedDto.markets.moneyline.reviewFlags?.includes("informational_non_actionable_price"));
assert.equal(headlinePrimaryMarket(mixedDto),"total");
assert.equal(primaryDailyEdgeMarket(mixedDto),"total","the active production reader must also preserve the value-supported Watch headline");
assert.equal(selectTopAvailableAngles([mixedDto]).games.length,1,"retain the genuine price-supported watch when an informational ML watch is added");

const absent=readCbbMarketBehavior({...args,targets:[],currentQuotes:[]});
const absentBoard=buildCbbProvisionalBoard(absent.forecast,[],{marketBehavior:absent.receipt});
const incomplete=readCbbMarketBehavior({...args,independent:{...independent,inputStatus:"incomplete",issues:["missing_team_input"]}});
const incompleteBoard=buildCbbProvisionalBoard(incomplete.forecast,[...targets,...sources],{marketBehavior:incomplete.receipt});
const futureTargets=targets.map(q=>({...q,fetchedAt:"2026-11-04T16:33:00Z"}));
const futureRead=readCbbMarketBehavior({...args,targets:futureTargets});
const futureBoard=buildCbbProvisionalBoard(futureRead.forecast,[...futureTargets,...sources],{marketBehavior:futureRead.receipt});
for(const heldBoard of [absentBoard,incompleteBoard,futureBoard])for(const row of heldBoard.rows){
 assert.equal(row.grade,"Held","missing, incomplete or unavailable execution data stays held, never Watchlist");
 assert.equal(row.selection,null);assert.equal(row.probability,null);assert.equal(row.expectedValue,null);
}
let invalidBoard:ReturnType<typeof buildCbbProvisionalBoard>|null=null;
try{
 const invalid=readCbbMarketBehavior({...args,currentQuotes:[],independent:{...independent,uncertainty:{...independent.uncertainty,totalSd:Number.NaN}}});
 invalidBoard=buildCbbProvisionalBoard(invalid.forecast,targets,{marketBehavior:invalid.receipt});
}catch{/* Rejecting an invalid law before publication is also correct. */}
if(invalidBoard){
 const invalidTotal=invalidBoard.rows.find(row=>row.market==="total")!;
 assert.equal(invalidTotal.grade,"Held","a non-finite total law is not an informational forecast");
 assert.equal(invalidTotal.probability,null);assert.equal(invalidTotal.expectedValue,null);
}
const nbaHeld=gradeNbaMarket({pick:null,confidence:0,band:"market_unavailable",edge:0,dataQualityTier:"fallback",injuriesKnown:false});
assert.equal(nbaHeld.grade,"held");
const nbaMissing=gradeNbaMarket({pick:"home",confidence:independent.homeWinProbability*100,modelProbabilityOnPick:independent.homeWinProbability,
 market:"moneyline",currentPriceAmerican:null,band:"market_unavailable",edge:0,dataQualityTier:"high",injuriesKnown:true,continuousMarketDecision:true});
assert.equal(nbaMissing.grade,"no_market","missing NBA market data is distinct from a valid priced Watchlist");
console.log("PASS CBB Watchlist semantics: actual reader/board ML+spread+total economics, negative EV informational only, heavy pressure cannot create action, held data excluded, active NBA price guard aligned.");
