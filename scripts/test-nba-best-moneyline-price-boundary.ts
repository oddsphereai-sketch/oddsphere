import assert from "node:assert/strict";
import {gradeNbaMarket,gradeNbaR30MarketForAudit,type GradeInput} from "../lib/services/nba/nbaMarketReview";

for(const pick of ["home","away"] as const){
 const base:GradeInput={market:"moneyline",pick,confidence:70,modelProbabilityOnPick:.8136049439645139,
  currentPriceAmerican:-300,band:"support",edge:.08,dataQualityTier:"high",injuriesKnown:true};
 const support={release:"nba_named_book_posture_2026_11_04_r9_own_book_pressure" as const,evaluatedAt:"2026-11-06T21:00:00Z",market:"moneyline" as const,pickedSide:pick,
  supportingSources:["circa"],opposingSources:[],conflictingSources:[],scoreEffectApplied:true,consequence:"correct",forecastAuthorityGranted:false as const};
 for(const price of [-235,-300,-399]){
  const input={...base,currentPriceAmerican:price},bytes=JSON.stringify(input);
  assert.equal(gradeNbaR30MarketForAudit(input).grade,"best_angle","frozen R30 preserves its actual prior tier");
  assert.equal(gradeNbaMarket(input).grade,"lean","expensive likely winner remains Lean");
  assert.equal(gradeNbaMarket({...input,namedBookPosture:support}).grade,"lean","market confirmation cannot waive the owner price ceiling");
  assert.equal(gradeNbaMarket({...input,enforceSteepMoneylineBestAngleTier:false}).grade,"lean","legacy audit flag cannot bypass the current price boundary");
  assert.equal(gradeNbaMarket(input).effectiveConfidence,gradeNbaR30MarketForAudit(input).effectiveConfidence);
  assert.equal(JSON.stringify(input),bytes);
 }
 for(const price of [-501,-8000,-9000]){
  const input={...base,currentPriceAmerican:price,modelProbabilityOnPick:.999};
  assert.equal(gradeNbaMarket(input).grade,"no_play");
  assert.equal(gradeNbaMarket({...input,currentPriceAmerican:-500}).grade,"lean","same forecast regains an actionable Lean at the better real price");
  assert.equal(gradeNbaMarket({...input,namedBookPosture:support,enforceSteepMoneylineBestAngleTier:false}).grade,"no_play");
 }
 assert.equal(gradeNbaMarket({...base,currentPriceAmerican:-500,modelProbabilityOnPick:.99}).grade,"lean","inclusive Lean ceiling");
 for(const price of [-200,-199,-110,110])assert.equal(gradeNbaMarket({...base,currentPriceAmerican:price}).grade,"best_angle","improved price restores strongest-tier eligibility at the same forecast");
 assert.equal(gradeNbaMarket({...base,market:"spread",currentPriceAmerican:-110,confidence:68,modelProbabilityOnPick:.68}).grade,"best_angle","the game's Spread remains independently Best-eligible");
 assert.equal(gradeNbaMarket({...base,namedBookPosture:{...support,supportingSources:[],opposingSources:["circa","pinnacle"]}}).grade,"watch","price policy does not erase genuine opposition or force Lean");
}
console.log("PASS NBA owner Moneyline boundary: -235/-300 Lean, inclusive -200 recovery, home/away symmetry, independent Spread, causal/legacy bypass negatives and retained opposition");
