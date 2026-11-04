import assert from "node:assert/strict";
import {invertCbbJointMarginLaw} from "../lib/cbb/jointMarketLaw";
import {normalCdf,cbbThresholdProbabilities} from "../lib/cbb/model";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import type {CbbForecast,CbbQuote} from "../lib/cbb/types";

function forecast(margin:number,marginSd:number):CbbForecast{
  const total=150,zero=normalCdf((.5-margin)/marginSd)-normalCdf((-.5-margin)/marginSd);
  return {release:CBB_CURRENT_SCORE_RELEASE,gameId:777,asOf:"2026-11-04T01:00:00Z",homeId:1,awayId:2,
    margin,total,homeScore:(total+margin)/2,awayScore:(total-margin)/2,possessions:70,
    homeWinProbability:(1-normalCdf((.5-margin)/marginSd))/(1-zero),inputStatus:"complete",issues:[],
    uncertainty:{marginSd,totalSd:16,marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:1000}};
}
const american=(p:number)=>p>=.5?-100*p/(1-p):100*(1-p)/p;
function quote(f:CbbForecast,market:"moneyline"|"spread",line:number|null):CbbQuote{
  const p=cbbThresholdProbabilities(f,market,line),fair=p.first/(p.first+p.second);
  return {gameId:777,sportsbook:"pinnacle",market,line,firstPrice:american(fair),secondPrice:american(1-fair),
    provider:"owls",phase:"current",providerObservedAt:"2026-11-04T00:58:00Z",fetchedAt:"2026-11-04T00:59:00Z"};
}
const base=forecast(20,11);
for(const [margin,sd,line] of [[12,7,-10.5],[-12,7,10.5],[3,16,-4],[-3,16,4],[0,8,-2],[0,8,2],[35,5,-35.5],[-35,5,35.5]] as const){
  const source=forecast(margin,sd),ml=quote(source,"moneyline",null),spread=quote(source,"spread",line);
  const solved=invertCbbJointMarginLaw(base,ml,spread);
  assert.equal(solved.status,"identified",JSON.stringify({margin,sd,line,solved}));
  assert.ok(Math.abs(solved.margin!-margin)<1e-5,JSON.stringify(solved));
  assert.ok(Math.abs(solved.marginSd!-sd)<1e-5,JSON.stringify(solved));
  const reconstructed=forecast(solved.margin!,solved.marginSd!);
  assert.ok(Math.abs(reconstructed.homeWinProbability-source.homeWinProbability)<1e-8);
  const a=cbbThresholdProbabilities(reconstructed,"spread",line),b=cbbThresholdProbabilities(source,"spread",line);
  assert.ok(Math.abs(a.first/(a.first+a.second)-b.first/(b.first+b.second))<1e-8);
}
// Same spread/juice with a different winner probability changes dispersion;
// a flat spread is not permission to erase the separate ML information.
const before=forecast(5,10),after=forecast(5,5),line=-5;
const heldSpread: CbbQuote={...quote(before,"spread",line),firstPrice:-110,secondPrice:-110};
const first=invertCbbJointMarginLaw(base,quote(before,"moneyline",null),heldSpread);
const second=invertCbbJointMarginLaw(base,quote(after,"moneyline",null),heldSpread);
assert.equal(first.status,"identified");assert.equal(second.status,"identified");
assert.ok(Math.abs(first.marginSd!-second.marginSd!)>1);
assert.notEqual(first.homeWinProbability,second.homeWinProbability);
for(const line of [-.5,0,.5]){
  const source=forecast(-3,9),ml=quote(source,"moneyline",null),spread=quote(source,"spread",line);
  const solved=invertCbbJointMarginLaw(base,ml,spread);
  assert.equal(solved.status,"underidentified");assert.equal(solved.marginSd,base.uncertainty.marginSd);
  assert.ok(Math.abs(solved.homeWinProbability!-source.homeWinProbability)<1e-8);
  assert.equal(invertCbbJointMarginLaw(base,ml,{...spread,firstPrice:-200,secondPrice:175}).status,"inconsistent");
}
const native=forecast(12,7),ml=quote(native,"moneyline",null),spread=quote(native,"spread",-10.5);
assert.equal(invertCbbJointMarginLaw(base,ml,{...spread,sportsbook:"circa"}).status,"unavailable");
assert.equal(invertCbbJointMarginLaw(base,ml,{...spread,gameId:778}).status,"unavailable");
assert.equal(invertCbbJointMarginLaw(base,{...ml,line:0},spread).status,"unavailable");
assert.equal(invertCbbJointMarginLaw(base,ml,{...spread,line:-10.25}).status,"unavailable");
assert.equal(invertCbbJointMarginLaw(base,{...ml,firstPrice:NaN},spread).status,"unavailable");
assert.equal(invertCbbJointMarginLaw(base,ml,{...spread,sportsbook:"ps3838"}).status,"identified");
assert.equal(invertCbbJointMarginLaw(base,quote(forecast(-5,10),"moneyline",null),
  {...spread,firstPrice:-110,secondPrice:-110}).status,"inconsistent","a positive cover threshold cannot be likelier than winning");
assert.equal(invertCbbJointMarginLaw(base,ml,{...spread,firstPrice:ml.firstPrice,secondPrice:ml.secondPrice}).status,"inconsistent",
  "equal distinct-threshold probabilities imply no finite dispersion");
const impossible=forecast(160,20);
assert.equal(invertCbbJointMarginLaw(base,quote(impossible,"moneyline",null),quote(impossible,"spread",-159.5)).status,"inconsistent",
  "a source solution cannot imply a negative team mean or be clipped to the total");
assert.equal(invertCbbJointMarginLaw({...base,uncertainty:{...base.uncertainty,marginSd:Infinity}},ml,spread).status,"unavailable");
console.log("PASS CBB joint native margin law: exact no-tie/push inversion, mirrors, ML shape, duplicate-contract identifiability and contradictory-source rejection");
