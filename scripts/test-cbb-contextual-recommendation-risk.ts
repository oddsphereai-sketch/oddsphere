import assert from "node:assert/strict";
import {createCbbRecommendationRiskEvaluator} from "../lib/cbb/contextualRecommendationRisk";
import {createCbbContextualScoreLaw,type CbbContextualLatentGaussian} from "../lib/cbb/contextualScoreLawResearch";
import {buildCbbInterpretedDecision} from "../lib/cbb/contextualInterpretedDecision";
import {buildCbbContextualMarketInterpretation} from "../lib/cbb/contextualMarketInterpretation";
import type {CbbMarket} from "../lib/cbb/types";
const base:CbbContextualLatentGaussian={marginMean:1.45,totalMean:146,marginSd:12,totalSd:16,correlation:0};
function assess(latent=base,locationSd=.001,price=-120,market:CbbMarket="moneyline",line:number|null=null,selection:"first"|"second"="first"){
 const p=createCbbContextualScoreLaw(latent).probabilitiesFast(market,line),win=selection==="first"?p.first:p.second,loss=selection==="first"?p.second:p.first;
 const expectedValue=win*(price>0?price/100:100/-price)-loss;
 const value=createCbbRecommendationRiskEvaluator({latent,context:{marginLocationSd:locationSd,totalLocationSd:locationSd,calibrationGames:137}})({market,line,selection,price,expectedValue,resolvedMass:win+loss,numericalValueErrorEstimate:1e-10,probabilityErrorEstimate:1e-11});
 return {...value,original:{win,loss,push:p.push,expectedValue}};
}
const low=assess(),fragile=assess(base,.5),largerFragile=assess({...base,marginMean:4.8},8);
assert.ok(low.original.expectedValue<.01&&low.supported,"A small but stable advantage can qualify; this is not a blanket 1% or 3% floor");
assert.equal(fragile.supported,false,"Same price/forecast becomes informational when fitted location uncertainty consumes its advantage");
assert.ok(largerFragile.original.expectedValue>low.original.expectedValue&&!largerFragile.supported,"A larger fragile edge can fail while a smaller stable edge passes");
const betterPrice=assess(base,.5,-110);
assert.equal(betterPrice.supported,true,"Real price improvement promotes the same uncertain selected prediction");
assert.deepEqual(fragile.original.win,betterPrice.original.win,"Price cannot change the prediction");
assert.equal(assess(base,.001,-120).supported,true,"Reduced fitted uncertainty is a paired promotion path at the same price");
const extreme=assess({...base,marginMean:100},.001,-100000),confident=assess({...base,marginMean:30},1,-300);
assert.ok(extreme.original.expectedValue>0&&!extreme.supported&&!extreme.priceCanSupportRecommendation,"A nearly certain winner is distinct from a useful return at extreme prices");
assert.ok(confident.supported&&confident.priceCanSupportRecommendation,"Reasonably priced confident favorites remain eligible without an odds veto");
const integer=assess({...base,marginMean:3},0,110,"spread",-3);
assert.ok(integer.original.push>0);
assert.ok(Math.abs(integer.minimumStressedExpectedValue-(137*integer.original.expectedValue-(integer.original.win+integer.original.loss))/138)<1e-12,"Adverse-case stress preserves refunded push mass");
const mirror=assess({...base,marginMean:-3},0,110,"spread",3,"second");
assert.ok(Math.abs(integer.minimumStressedExpectedValue-mirror.minimumStressedExpectedValue)<1e-10,"Mirrored home/away orientation preserves risk economics");
assert.throws(()=>createCbbRecommendationRiskEvaluator({latent:base,context:{marginLocationSd:-1,totalLocationSd:0,calibrationGames:137}}),/requires/);
assert.throws(()=>createCbbRecommendationRiskEvaluator({latent:base,context:{marginLocationSd:0,totalLocationSd:0,calibrationGames:0}}),/requires/);
// Production composition preserves the entire forecast and nominal payout.
const at="2026-11-05T21:00:00Z",quote={gameId:77,sportsbook:"draftkings",market:"moneyline" as const,line:null,firstPrice:-120,secondPrice:110,
 provider:"owls" as const,providerObservedAt:"2026-11-05T20:59:00Z",requestedAt:"2026-11-05T20:59:58Z",fetchedAt:"2026-11-05T20:59:59Z",phase:"current" as const,orientationVerified:true};
const input={independent:{gameId:77,asOf:at,release:"test",inputStatus:"complete" as const,margin:base.marginMean,total:base.totalMean},asOf:at,startsAt:"2026-11-06T01:00:00Z",currentQuotes:[quote]};
const nominal=buildCbbInterpretedDecision({input,interpretation:buildCbbContextualMarketInterpretation(input),latent:base,targets:[quote]});
const risk=buildCbbInterpretedDecision({input,interpretation:buildCbbContextualMarketInterpretation(input),latent:base,targets:[quote],recommendationRisk:{marginLocationSd:.5,totalLocationSd:.5,calibrationGames:137}});
assert.equal(nominal.marketDecisions[0].grade,"Lean");assert.equal(risk.marketDecisions[0].grade,"Watchlist");
assert.deepEqual(nominal.finalScore,risk.finalScore);assert.deepEqual(nominal.finalUncertainty,risk.finalUncertainty);
for(const key of ["selection","probability","loseProbability","pushProbability","price","expectedValue"] as const)assert.equal(nominal.marketDecisions[0][key],risk.marketDecisions[0][key],`Risk grading cannot change ${key}`);
console.log("PASS contextual recommendation quality: adaptive small-stable/larger-fragile cases, paired price/uncertainty promotions, extreme-return No Play eligibility, affordable favorite, exact pushes, orientation, unchanged forecast and no source quorum");
