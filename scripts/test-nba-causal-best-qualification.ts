import assert from "node:assert/strict";
import {gradeNbaMarket,gradeNbaR29MarketForAudit,type GradeInput} from "../lib/services/nba/nbaMarketReview";

for(const [market,picks] of [["moneyline",["home","away"]],["spread",["home","away"]],["total",["over","under"]]] as const)
 for(const pick of picks)for(const price of [-110,110]){
  const support={release:"nba_named_book_posture_2026_11_04_r9_own_book_pressure" as const,evaluatedAt:"2026-11-06T20:16:00Z",
   market,pickedSide:pick,supportingSources:["circa"],opposingSources:[],conflictingSources:[],
   scoreEffectApplied:true,consequence:"correct",forecastAuthorityGranted:false as const};
  const input:GradeInput={market,pick,confidence:55.5,modelProbabilityOnPick:.555,band:"support",edge:.02,
   dataQualityTier:"high",injuriesKnown:true,currentPriceAmerican:price,namedBookPosture:support};
  const before=JSON.stringify(input);
  assert.equal(gradeNbaR29MarketForAudit(input).grade,"best_angle","Frozen prior reproduces the live low-confidence causal bypass");
  assert.equal(gradeNbaMarket(input).grade,"lean","Market support cannot waive the existing Best confidence bar");
  const stronger={...input,confidence:65,modelProbabilityOnPick:.65};
  assert.equal(gradeNbaMarket({...stronger,namedBookPosture:undefined}).grade,"lean","Smaller economic edge alone stays Lean");
  assert.equal(gradeNbaMarket(stronger).grade,"best_angle","Supported qualified final confidence retains genuine causal promotion");
  for(const change of [{injuriesKnown:false},{dataQualityTier:"medium" as const},{modelProbabilityOnPick:.555},
   {currentPriceAmerican:undefined},{modelProbabilityOnPick:undefined}])
   assert.notEqual(gradeNbaMarket({...stronger,...change}).grade,"best_angle","Causal confirmation cannot waive strongest-tier quality or exact-price qualification");
  assert.equal(gradeNbaMarket({...stronger,namedBookPosture:{...support,opposingSources:["circa","pinnacle"],supportingSources:[]}}).grade,"watch");
  if(market==="moneyline"){
   assert.equal(gradeNbaMarket({...stronger,confidence:90,modelProbabilityOnPick:.9,currentPriceAmerican:-500}).grade,"lean","Causal support cannot waive the existing steep-price tier");
   assert.equal(gradeNbaMarket({...stronger,moneylineEvidence:{directReadQualified:true,directReadSide:pick==="home"?"away":"home",spreadReadQualified:false,spreadReadSide:null,spreadCorrectionApplied:false}}).grade,"lean","Another context field cannot erase qualified direct opposition");
  }
  assert.equal(JSON.stringify(input),before,"Prior and new grade comparisons preserve the forecast/evidence inputs");
 }
console.log("PASS NBA causal Best qualification: live55.5 regression, both sides/all markets/prices, stronger-context promotion, quality/injury/price/opposition guards and frozen prior");
