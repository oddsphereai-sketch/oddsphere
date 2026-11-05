import assert from "node:assert/strict";
import {createCbbContextualScoreLaw,CbbScoreLawNumericalError,type CbbContextualLatentGaussian} from "../lib/cbb/contextualScoreLawResearch";

const near=(a:number,b:number,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b} (tolerance ${tolerance})`);
const latent:CbbContextualLatentGaussian={marginMean:1,totalMean:11,marginSd:2,totalSd:2,correlation:0};
const law=createCbbContextualScoreLaw(latent),grid=law.pmf(),summary=law.summary();
const totalError=grid.omittedMassUpperBound+grid.quadratureErrorEstimate+grid.normalizerErrorEstimate+grid.summationRoundoffUpperBound;
near(grid.mass,1,totalError);
assert.ok(grid.cells.every(cell=>cell.home>=0&&cell.away>=0&&cell.home!==cell.away&&cell.probability>=0));
assert.equal(law.cellProbability(5,5),0);assert.equal(law.cellProbability(-1,2),0);
assert.equal(law.cellNll(5,5),Infinity);assert.equal(law.cellNll(2.5,3),Infinity);

// Independent continuous H~N(6,2), A~N(5,2). Reference constants were computed
// separately with Python math.erfc and products of exact univariate intervals,
// rather than reusing this module's CDF/quadrature implementation.
near(law.normalizer,.8266182658567203,2e-12);
near(law.cellProbability(6,5),.09237186868145461,2e-12);
near(law.cellProbability(8,4),.027846196425669573,2e-12);
near(law.cellNll(6,5),2.381932798188674,2e-11);
assert.ok(summary.homeMean>0&&summary.awayMean>0);
near(summary.homeMean+summary.awayMean,summary.totalMean);
near(summary.homeMean-summary.awayMean,summary.marginMean);
assert.notEqual(summary.marginMean,latent.marginMean,"conditioning changes actual means; do not silently report latent means as score expectations");

for(const [market,line] of [["moneyline",null],["spread",0],["spread",-1],["spread",-1.5],["total",11],["total",11.5]] as const){
 const p=law.probabilities(market,line);
 near(p.first+p.second+p.push,1,totalError);
 let first=0,second=0,push=0;
 for(const c of grid.cells){const outcome=market==="total"?c.home+c.away-line!:c.home-c.away+(market==="spread"?line!:0);
  if(outcome>0)first+=c.probability;else if(outcome<0)second+=c.probability;else push+=c.probability;
 }
 near(p.first,first,1e-14);near(p.second,second,1e-14);near(p.push,push,1e-14);
 if(market==="moneyline"||line===0||!Number.isInteger(line))assert.equal(p.push,0);
 else assert.ok(p.push>0,"integer total/spread pushes remain genuine cell mass");
}
near(law.probabilities("moneyline").first,law.probabilities("spread",-.5).first,1e-14);
near(law.probabilities("moneyline").first,law.probabilities("spread",.5).first,1e-14);
assert.equal(law.probabilities("moneyline").push,0);

// A far-tail label remains a direct log rectangle/Z evaluation even though
// it is outside the transient display/prediction grid. No probability floor.
assert.ok(40>grid.bounds.homeMax);
assert.ok(Number.isFinite(law.cellNll(40,10)));
assert.ok(law.cellProbability(40,10)>0);
assert.ok(law.cellNll(40,10)>law.cellNll(35,10));
assert.ok(Number.isFinite(law.cellNll(100,10)),"underflow of exp(log p) cannot destroy finite log likelihood");
assert.equal(law.cellProbability(100,10),0,"IEEE underflow is allowed; no artificial probability minimum is substituted");
assert.equal(law.pmf(),grid,"PMF is transiently cached, not rebuilt per market");
assert.ok(Object.isFrozen(grid)&&Object.isFrozen(grid.cells)&&Object.isFrozen(grid.cells[0]));

for(const correlation of [-.65,.4,.999999,-.999999]){
 const p={marginMean:1.2,totalMean:11,marginSd:1.2,totalSd:1.7,correlation};
 const a=createCbbContextualScoreLaw(p),b=createCbbContextualScoreLaw({...p,marginMean:-p.marginMean,correlation:-correlation});
 const sa=a.summary(),sb=b.summary();
 near(a.normalizer,b.normalizer,2e-9);
 near(sa.homeMean,sb.awayMean,2e-8);near(sa.awayMean,sb.homeMean,2e-8);
 near(sa.marginMean,-sb.marginMean,2e-8);near(sa.totalMean,sb.totalMean,2e-8);
 near(sa.marginSd,sb.marginSd,2e-7);near(sa.totalSd,sb.totalSd,2e-7);
 near(sa.marginTotalCorrelation,-sb.marginTotalCorrelation,2e-7);
 const ma=a.probabilities("moneyline"),mb=b.probabilities("moneyline");
 near(ma.first,mb.second,2e-9);assert.equal(ma.push,0);assert.equal(mb.push,0);
 const ta=a.probabilities("total",11),tb=b.probabilities("total",11);
 near(ta.first,tb.first,2e-9);near(ta.push,tb.push,2e-9);
 const spa=a.probabilities("spread",-1.5),spb=b.probabilities("spread",1.5);
 near(spa.first,spb.second,2e-9);
 near(a.cellProbability(6,4),b.cellProbability(4,6),2e-9);
 assert.ok(sa.capturedMass>1-1e-8&&sa.capturedMass<1+1e-8);
}

// Correlation must affect actual normalized market probabilities, not remain
// an unused stored field beside separate legacy Gaussian marginal formulas.
const positive=createCbbContextualScoreLaw({...latent,correlation:.7});
const negative=createCbbContextualScoreLaw({...latent,correlation:-.7});
assert.ok(Math.abs(positive.probabilities("total",11).first-negative.probabilities("total",11).first)>.001);

for(const bad of [{...latent,marginSd:0},{...latent,totalSd:-1},{...latent,correlation:1},{...latent,correlation:-1},
 {...latent,totalMean:Infinity},{...latent,marginMean:NaN}])assert.throws(()=>createCbbContextualScoreLaw(bad),CbbScoreLawNumericalError);
assert.throws(()=>law.probabilities("spread",null),CbbScoreLawNumericalError);
assert.throws(()=>law.probabilities("total",11.25),CbbScoreLawNumericalError);
assert.throws(()=>law.probabilities("moneyline",1),CbbScoreLawNumericalError);
assert.throws(()=>createCbbContextualScoreLaw(latent,{maxEvaluations:1}),/budget/);
// These inputs formerly attempted enormous split-point arrays before the
// quadrature evaluation counter ran. The preflight must reject immediately;
// the test never constructs or waits for that enormous intermediate array.
assert.throws(()=>createCbbContextualScoreLaw({...latent,totalMean:1e12,marginSd:1,totalSd:1},
 {maxEvaluations:1,maxGridScore:2048}),/tie normalization score budget/);
assert.throws(()=>createCbbContextualScoreLaw({...latent,marginSd:1e-12,totalSd:1e-12},
 {maxEvaluations:1000}),/partition budget/);
assert.throws(()=>createCbbContextualScoreLaw(latent,{maxGridScore:2}),/budget/);
assert.throws(()=>createCbbContextualScoreLaw(latent,{tailMassTolerance:0}),/tolerance/);
const limited=createCbbContextualScoreLaw(latent,{maxGridCells:2});
assert.ok(Number.isFinite(limited.cellNll(6,5)),"cell NLL/normalizer never requires a full PMF");
assert.throws(()=>limited.summary(),/grid budget/);
const basketball=createCbbContextualScoreLaw({marginMean:3,totalMean:150,marginSd:12,totalSd:17,correlation:.1});
const before=basketball.diagnostics().evaluations;
assert.ok(Number.isFinite(basketball.cellNll(80,70)));
assert.ok(basketball.diagnostics().evaluations-before<1000,"one training label is O(1) rectangles after the O(N) tie normalizer");
console.log("PASS offline joint score law: independent reference, normalization, one-law market/push/likelihood, mirrors, rho, far-tail log cells, extreme correlation and explicit numerical failures");
