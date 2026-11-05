import assert from "node:assert/strict";
import {createCbbContextualScoreLaw,CbbScoreLawNumericalError} from "../lib/cbb/contextualScoreLawResearch";

const near=(a:number,b:number,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,`${a} differs from ${b} by more than ${e}`);
const independent={marginMean:1,totalMean:11,marginSd:2,totalSd:2,correlation:0};
const refs=[
 ["moneyline",null,.7230160136026764,.27698398639732413,0],
 ["spread",-1,.48661051161421087,.27698398639732413,.23640550198846536],
 ["spread",1,.7230160136026764,.13067120357400358,.14631278282332086],
 ["total",11,.38182898046652736,.3817655175503187,.23640550198315435],
 ["total",11.5,.38182898046652736,.618171019533473,0],
] as const;
// Independently calculated using Python math.erfc univariate H/A intervals,
// not this module's normal CDF or its full-grid evaluator.
const exact=createCbbContextualScoreLaw(independent);
for(const [market,line,first,second,push]of refs){
 const p=exact.probabilitiesFast(market,line);
 near(p.first,first,2e-12);near(p.second,second,2e-12);near(p.push,push,2e-12);
}
assert.equal(exact.diagnostics().fullPmfBuilt,false,"fast thresholds cannot secretly enumerate a PMF");
const cached=exact.probabilitiesFast("total",11),before=exact.diagnostics().evaluations;
assert.equal(exact.probabilitiesFast("total",11),cached);assert.equal(exact.diagnostics().evaluations,before);
assert.ok(Object.isFrozen(cached));

for(const latent of [independent,{marginMean:3,totalMean:150,marginSd:12,totalSd:17,correlation:.4},
 {marginMean:-7,totalMean:143,marginSd:13,totalSd:19,correlation:-.7},
 {marginMean:1,totalMean:2,marginSd:3,totalSd:2,correlation:-.5},
 {marginMean:1.2,totalMean:11,marginSd:1.2,totalSd:1.7,correlation:.999999}]){
 const law=createCbbContextualScoreLaw(latent);
 const lines=[0,-.5,.5,-1,1,-2.5,2.5,-8,8];
 for(const [market,line] of [["moneyline",null],...lines.map(line=>["spread",line] as const),
  ...[Math.floor(latent.totalMean)-2,Math.floor(latent.totalMean),Math.floor(latent.totalMean)+.5,Math.floor(latent.totalMean)+3]
   .map(line=>["total",line] as const)] as const){
  const fast=law.probabilitiesFast(market,line),full=law.probabilities(market,line);
  const error=fast.omittedMassUpperBound+full.omittedMassUpperBound+fast.quadratureErrorEstimate+full.quadratureErrorEstimate+
   fast.normalizerErrorEstimate+full.normalizerErrorEstimate+fast.summationRoundoffUpperBound+full.summationRoundoffUpperBound;
  near(fast.first,full.first,error);near(fast.second,full.second,error);near(fast.push,full.push,error);
  near(fast.first+fast.second+fast.push,1,error);
  assert.ok(fast.first>=0&&fast.second>=0&&fast.push>=0);
  if(market==="moneyline"||line===0||!Number.isInteger(line))assert.equal(fast.push,0);
 }
 const mirror=createCbbContextualScoreLaw({...latent,marginMean:-latent.marginMean,correlation:-latent.correlation});
 const a=law.probabilitiesFast("spread",-2),b=mirror.probabilitiesFast("spread",2);
 near(a.first,b.second,1e-8);near(a.push,b.push,1e-8);
 const t=law.probabilitiesFast("total",Math.round(latent.totalMean)),tm=mirror.probabilitiesFast("total",Math.round(latent.totalMean));
 near(t.first,tm.first,1e-8);near(t.push,tm.push,1e-8);
 assert.equal(mirror.diagnostics().fullPmfBuilt,false);
}
const tail=createCbbContextualScoreLaw(independent,{maxGridCells:1});
const far=tail.probabilitiesFast("total",40.5);
assert.ok(far.first>0,"fast strips retain away-tail event mass beyond a finite prediction grid");
assert.equal(far.push,0);assert.equal(tail.diagnostics().fullPmfBuilt,false);
assert.throws(()=>tail.pmf(),/grid budget/);
assert.throws(()=>tail.probabilitiesFast("spread",1.25),CbbScoreLawNumericalError);
assert.throws(()=>tail.probabilitiesFast("moneyline",1),CbbScoreLawNumericalError);
assert.throws(()=>createCbbContextualScoreLaw(independent,{maxEvaluations:1000}).probabilitiesFast("total",11),/budget/);

const latent={marginMean:3,totalMean:150,marginSd:12,totalSd:17,correlation:.1};
const fastLaw=createCbbContextualScoreLaw(latent),startFast=Date.now();
for(const line of [140,142.5,145,147.5,150,152.5,155,157.5,160])fastLaw.probabilitiesFast("total",line);
const fastMs=Date.now()-startFast,fastEvaluations=fastLaw.diagnostics().evaluations;
assert.equal(fastLaw.diagnostics().fullPmfBuilt,false);
const fullLaw=createCbbContextualScoreLaw(latent),startFull=Date.now();
fullLaw.probabilities("total",150);
const fullMs=Date.now()-startFull,fullEvaluations=fullLaw.diagnostics().evaluations;
assert.ok(fastEvaluations<fullEvaluations,"nine O(N) strip contracts must cost less quadrature than a single full PMF");
console.log(JSON.stringify({result:"PASS joint-law fast thresholds: independent references, full-grid agreement, mirrors, pushes, rho, tails, cache and budgets",
 benchmark:{fastContracts:9,fastMs,fastEvaluations,fullPmfContracts:1,fullMs,fullEvaluations}}));
