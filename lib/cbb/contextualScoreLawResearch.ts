/** Pure score-distribution mathematics; no writer or provider calls.
 * A latent bivariate Gaussian is transformed to continuous home/away scores,
 * rounded to integers, and conditioned jointly on nonnegative, unequal scores.
 * Every cell, likelihood, moment and market uses that same normalization.
 * Quadrature errors are estimates; Gaussian marginal tail bounds are analytic.
 */
export type CbbContextualLatentGaussian={marginMean:number;totalMean:number;marginSd:number;totalSd:number;correlation:number};
export type CbbScoreLawNumerics={
 absoluteTolerance?:number;relativeTolerance?:number;tailMassTolerance?:number;
 maxEvaluations?:number;maxAdaptiveDepth?:number;maxGridScore?:number;maxGridCells?:number;
};
export class CbbScoreLawNumericalError extends Error{
 constructor(message:string){super(message);this.name="CbbScoreLawNumericalError";}
}
type Cell={home:number;away:number;probability:number};
type Integral={logValue:number;errorEstimate:number};
const LOG2PI=Math.log(2*Math.PI),LOG2=Math.log(2),LOG_GAMMA_HALF=.5723649429247001;
const addLog=(a:number,b:number)=>a===-Infinity?b:b===-Infinity?a:Math.max(a,b)+Math.log1p(Math.exp(-Math.abs(a-b)));
function differenceLog(a:number,b:number){
 if(b===-Infinity)return a;
 if(b>a)throw new CbbScoreLawNumericalError("negative Gaussian interval from numerical cancellation");
 return a===b?-Infinity:a+Math.log(-Math.expm1(b-a));
}
// Q(1/2,x^2/2), evaluated in log space in the tail. No CDF probability floor.
function logNormalTail(x:number):number{
 if(x<0)return Math.log1p(-Math.exp(logNormalTail(-x)));
 if(x===Infinity)return -Infinity;
 if(x===0)return -LOG2;
 const z=x*x/2,base=-z+.5*Math.log(z)-LOG_GAMMA_HALF;
 if(z<1.5){
  let term=2,sum=term,ap=.5;
  for(let n=1;n<=256;n++){ap++;term*=z/ap;sum+=term;if(Math.abs(term)<=Math.abs(sum)*2e-16)return -LOG2+Math.log1p(-sum*Math.exp(base));}
 }else{
  let b=z+.5,c=1e300,d=1/b,h=d;
  for(let i=1;i<=256;i++){
   const an=-i*(i-.5);b+=2;d=an*d+b;if(Math.abs(d)<1e-300)d=1e-300;
   c=b+an/c;if(Math.abs(c)<1e-300)c=1e-300;d=1/d;const delta=d*c;h*=delta;
   if(Math.abs(delta-1)<4e-16)return -LOG2+base+Math.log(h);
  }
 }
 throw new CbbScoreLawNumericalError("Gaussian tail did not converge");
}
/** E[max(-X,0)] for a declared working Normal(mean,sd²) value sensitivity.
 * This helper does not change the game score law or claim calibrated EV risk. */
export function cbbWorkingNormalExpectedDownside(mean:number,sd:number):number{
 if(!Number.isFinite(mean)||!Number.isFinite(sd)||sd<0)throw new CbbScoreLawNumericalError("invalid working value sensitivity");
 if(sd===0)return Math.max(-mean,0);
 if(mean<0)return cbbWorkingNormalExpectedDownside(-mean,sd)-mean;
 if(mean===0)return sd/Math.sqrt(2*Math.PI);
 const z=mean/sd,positive=Math.log(sd)-.5*z*z-.5*LOG2PI,negative=Math.log(mean)+logNormalTail(z);
 return Math.exp(differenceLog(positive,negative));
}
function normalIntervalLog(lo:number,hi:number):number{
 if(!(lo<hi))return -Infinity;
 const width=hi-lo,mid=(lo+hi)/2;
 if(Number.isFinite(width)&&width<1e-4&&Math.abs(mid)*width<1e-3){
  const correction=(mid*mid-1)*width*width/24;
  return Math.log(width)-.5*mid*mid-.5*LOG2PI+Math.log1p(correction);
 }
 if(lo>=0)return differenceLog(logNormalTail(lo),logNormalTail(hi));
 if(hi<=0)return differenceLog(logNormalTail(-hi),logNormalTail(-lo));
 return Math.log1p(-Math.exp(logNormalTail(-lo))-Math.exp(logNormalTail(hi)));
}
function tailZ(tolerance:number){
 let lo=0,hi=40;
 for(let i=0;i<70;i++){const mid=(lo+hi)/2;if(logNormalTail(mid)>Math.log(tolerance))lo=mid;else hi=mid;}
 return hi;
}
const GL8=[
 [.1834346424956498,.362683783378362], [.525532409916329,.3137066458778873],
 [.7966664774136267,.2223810344533745], [.9602898564975363,.1012285362903763],
];
const GL16=[
 [.09501250983763744,.1894506104550685],[.2816035507792589,.1826034150449236],
 [.4580167776572274,.16915651939500254],[.6178762444026438,.14959598881657674],
 [.755404408355003,.12462897125553387],[.8656312023878318,.09515851168249278],
 [.9445750230732326,.06225352393864789],[.9894009349916499,.027152459411754095],
];
const ERROR_INTERPRETATION="Unconditioned Gaussian tail bounds are analytic. Conditional mass/moment bounds assume the separately reported quadrature error estimates bound the conditioning-mass error; no certified interval-arithmetic bound is claimed.";

export function createCbbContextualScoreLaw(latent:CbbContextualLatentGaussian,options:CbbScoreLawNumerics={}){
 const frozen={...latent};
 if(!Object.values(frozen).every(Number.isFinite)||!(latent.marginSd>0&&latent.totalSd>0)||Math.abs(latent.correlation)>=1)
  throw new CbbScoreLawNumericalError("finite latent means, positive scales and correlation strictly inside (-1,1) are required");
 const config={absoluteTolerance:1e-10,relativeTolerance:1e-9,tailMassTolerance:1e-13,maxEvaluations:8_000_000,
  maxAdaptiveDepth:20,maxGridScore:2048,maxGridCells:500_000,...options};
 if(!(config.absoluteTolerance>0&&config.relativeTolerance>0&&config.tailMassTolerance>0&&config.tailMassTolerance<.01)||
  !Object.values(config).every(Number.isFinite)||![config.maxEvaluations,config.maxAdaptiveDepth,config.maxGridScore,config.maxGridCells].every(v=>Number.isInteger(v)&&v>0))
  throw new CbbScoreLawNumericalError("invalid numerical tolerance or computation budget");
 const {marginMean:mm,totalMean:mt,marginSd:sm,totalSd:st,correlation:rho}=latent;
 const hm=(mt+mm)/2,am=(mt-mm)/2;
 const hv=(st*st+sm*sm+2*rho*sm*st)/4,av=(st*st+sm*sm-2*rho*sm*st)/4,cov=(st*st-sm*sm)/4;
 const hs=Math.sqrt(hv),as=Math.sqrt(av);
 // This determinant formula avoids subtracting two nearly equal variances.
 const determinant=sm*sm*st*st*(1-rho)*(1+rho)/4;
 const conditionalSd=Math.sqrt(determinant/hv),slope=cov/hs;
 if(![hm,am,hv,av,hs,as,conditionalSd,slope].every(Number.isFinite)||!(hv>0&&av>0&&conditionalSd>0))
  throw new CbbScoreLawNumericalError("latent transform is numerically singular");
 const zLimit=tailZ(config.tailMassTolerance/16);
 let evaluations=0,quadratureErrorEstimate=0;
 const count=()=>{if(++evaluations>config.maxEvaluations)throw new CbbScoreLawNumericalError("rectangle integration evaluation budget exhausted");};
 function quadrature(fn:(z:number)=>number,left:number,right:number,nodes:number[][]){
  const middle=(left+right)/2,half=(right-left)/2;let sum=-Infinity;
  for(const [x,w] of nodes)for(const dir of [-1,1]){count();sum=addLog(sum,Math.log(w)+fn(middle+dir*half*x));}
  return Math.log(half)+sum;
 }
 function adaptive(fn:(z:number)=>number,left:number,right:number,absoluteBudget:number,depth:number,logAccurate:boolean):Integral{
  const low=quadrature(fn,left,right,GL8),high=quadrature(fn,left,right,GL16);
  const relative=low===high?0:!Number.isFinite(low)||!Number.isFinite(high)?Infinity:Math.abs(Math.expm1(low-high));
  const error=Math.exp(high)*relative;
  if(relative<=config.relativeTolerance||!logAccurate&&Number.isFinite(error)&&error<=absoluteBudget)return {logValue:high,errorEstimate:Number.isFinite(error)?error:0};
  if(depth>=config.maxAdaptiveDepth)throw new CbbScoreLawNumericalError("rectangle quadrature depth exhausted");
  const mid=(left+right)/2,a=adaptive(fn,left,mid,absoluteBudget/2,depth+1,logAccurate),b=adaptive(fn,mid,right,absoluteBudget/2,depth+1,logAccurate);
  return {logValue:addLog(a.logValue,b.logValue),errorEstimate:a.errorEstimate+b.errorEstimate};
 }
 function rectangle(hlo:number,hhi:number,alo:number,ahi:number,logAccurate=false,normalizationQuadrant=false):Integral{
  if(!(hlo<hhi&&alo<ahi))return {logValue:-Infinity,errorEstimate:0};
  let lo=(hlo-hm)/hs,hi=(hhi-hm)/hs;
  if(lo===-Infinity)lo=-zLimit;if(hi===Infinity)hi=zLimit;
  // Only normalization may omit these tails, charged explicitly below to
  // normalizerTailBound. Finite cells retain their original integration
  // interval, including a training label beyond the prediction-grid bounds.
  if(normalizationQuadrant){lo=Math.max(lo,-zLimit);hi=Math.min(hi,zLimit);}
  if(!(lo<hi))throw new CbbScoreLawNumericalError("conditioning region lies beyond the declared integration tail budget");
  // Partition construction itself must be bounded, before allocating points.
  // Counting only quadrature calls would leave huge means or tiny SDs able to
  // allocate billions of split points before the first counted evaluation.
  const regularStart=Math.ceil(lo/2)*2;
  const regularCount=Math.max(0,Math.ceil((hi-regularStart)/2));
  if(!Number.isFinite(regularCount)||regularCount>Math.floor((config.maxEvaluations-evaluations)/24))
   throw new CbbScoreLawNumericalError("rectangle partition budget exhausted before allocation");
  if(regularCount>0&&!(regularStart+2>regularStart))
   throw new CbbScoreLawNumericalError("rectangle partition cannot advance at floating-point precision");
  const points=[lo,hi];
  // Conditional-CDF transitions can become arbitrarily narrow at high
  // correlation. Split around their actual locations so quadrature cannot
  // silently miss a thin cell just because its nodes land outside the ridge.
  if(slope!==0)for(const edge of [alo,ahi])if(Number.isFinite(edge)){
   const center=(edge-am)/slope,width=conditionalSd/Math.abs(slope);
   for(const k of [-8,-4,-1,0,1,4,8]){const point=center+k*width;if(point>lo&&point<hi)points.push(point);}
  }
  for(let i=0;i<regularCount;i++){const z=regularStart+2*i;if(z>lo&&z<hi)points.push(z);}
  points.sort((a,b)=>a-b);
  const unique=points.filter((p,i)=>i===0||p>points[i-1]);
  const fn=(z:number)=>-.5*z*z-.5*LOG2PI+normalIntervalLog((alo-am-slope*z)/conditionalSd,(ahi-am-slope*z)/conditionalSd);
  let out=-Infinity,error=0;
  for(let i=1;i<unique.length;i++){
   const value=adaptive(fn,unique[i-1],unique[i],config.absoluteTolerance/(unique.length-1),0,logAccurate);
   out=addLog(out,value.logValue);error+=value.errorEstimate;
  }
  quadratureErrorEstimate+=error;
  return {logValue:out,errorEstimate:error};
 }
 const rawCell=(h:number,a:number,logAccurate=true)=>rectangle(h-.5,h+.5,a-.5,a+.5,logAccurate);
 // Ties above this index have mass at most the smaller one-dimensional
 // Gaussian upper tail. This limit is a numerical budget, not a score cap.
 const tieMax=Math.max(0,Math.ceil(Math.min(hm+hs*zLimit,am+as*zLimit)+.5));
 if(tieMax>config.maxGridScore)throw new CbbScoreLawNumericalError("tie normalization score budget exhausted");
 const quadrant=rectangle(-.5,Infinity,-.5,Infinity,false,true);
 let ties=0,tieError=0;
 for(let k=0;k<=tieMax;k++){const cell=rawCell(k,k,false);ties+=Math.exp(cell.logValue);tieError+=cell.errorEstimate;}
 const positiveMass=Math.exp(quadrant.logValue),normalizer=positiveMass-ties;
 const tieTailBound=Math.min(Math.exp(logNormalTail((tieMax+.5-hm)/hs)),Math.exp(logNormalTail((tieMax+.5-am)/as)));
 const normalizerTailBound=2*Math.exp(logNormalTail(zLimit))+tieTailBound;
 const normalizerQuadratureErrorEstimate=quadrant.errorEstimate+tieError;
 const normalizerError=normalizerTailBound+normalizerQuadratureErrorEstimate;
 if(!(normalizer>0)||normalizer<=16*normalizerError||!Number.isFinite(normalizer))
  throw new CbbScoreLawNumericalError("positive non-tied normalization cannot be resolved at the requested tolerance");
 const logNormalizer=Math.log(normalizer);
 function logCellProbability(home:number,away:number){
  if(!Number.isSafeInteger(home)||!Number.isSafeInteger(away)||home<0||away<0||home===away)return -Infinity;
  const value=rawCell(home,away).logValue-logNormalizer;
  if(!Number.isFinite(value))throw new CbbScoreLawNumericalError("a valid positive cell could not be resolved in finite log space");
  return value;
 }
 function cellProbability(home:number,away:number){return Math.exp(logCellProbability(home,away));}
 function cellNll(home:number,away:number){return -logCellProbability(home,away);}
 type Grid={cells:readonly Readonly<Cell>[];mass:number;omittedMassUpperBound:number;unconditionedGridTailBound:number;
  quadratureErrorEstimate:number;normalizerErrorEstimate:number;summationRoundoffUpperBound:number;errorInterpretation:string;
  bounds:{homeMin:number;homeMax:number;awayMin:number;awayMax:number}};
 let cachedGrid:Grid|null=null;
 function pmf():Grid{
  if(cachedGrid)return cachedGrid;
  const hmin=Math.max(0,Math.floor(hm-hs*zLimit-.5)),hmax=Math.max(0,Math.ceil(hm+hs*zLimit+.5));
  const amin=Math.max(0,Math.floor(am-as*zLimit-.5)),amax=Math.max(0,Math.ceil(am+as*zLimit+.5));
  if(Math.max(hmax,amax)>config.maxGridScore||(hmax-hmin+1)*(amax-amin+1)>config.maxGridCells)
   throw new CbbScoreLawNumericalError("prediction grid budget exhausted; no score/probability was capped");
  const before=quadratureErrorEstimate,cells:Cell[]=[];let mass=0;
  for(let h=hmin;h<=hmax;h++)for(let a=amin;a<=amax;a++)if(h!==a){
   const probability=Math.exp(rawCell(h,a,false).logValue-logNormalizer);cells.push({home:h,away:a,probability});mass+=probability;
  }
  const tails=(mean:number,sd:number,min:number,max:number)=>
   (min>0?Math.exp(logNormalTail((mean-min+.5)/sd)):0)+Math.exp(logNormalTail((max+.5-mean)/sd));
  const unconditionedGridTailBound=tails(hm,hs,hmin,hmax)+tails(am,as,amin,amax);
  const omitted=unconditionedGridTailBound/(normalizer-normalizerError);
  const qError=(quadratureErrorEstimate-before)/normalizer,nError=normalizerError/(normalizer-normalizerError);
  const summationRoundoffUpperBound=32*Number.EPSILON*cells.length;
  if(Math.abs(1-mass)>omitted+qError+nError+summationRoundoffUpperBound)
   throw new CbbScoreLawNumericalError("prediction grid mass does not match its normalization/error budget");
  cachedGrid=Object.freeze({cells:Object.freeze(cells.map(cell=>Object.freeze(cell))),mass,omittedMassUpperBound:omitted,unconditionedGridTailBound,
   quadratureErrorEstimate:qError,normalizerErrorEstimate:nError,summationRoundoffUpperBound,
   errorInterpretation:ERROR_INTERPRETATION,
   bounds:Object.freeze({homeMin:hmin,homeMax:hmax,awayMin:amin,awayMax:amax})});
  return cachedGrid;
 }
 function probabilities(market:"moneyline"|"spread"|"total",line:number|null=null){
  if(!["moneyline","spread","total"].includes(market))throw new CbbScoreLawNumericalError("unknown market");
  if(market!=="moneyline"&&(line===null||!Number.isFinite(line)||!Number.isInteger(line*2)))throw new CbbScoreLawNumericalError("exact integer or half-point market line is required");
  if(market==="moneyline"&&line!==null)throw new CbbScoreLawNumericalError("moneyline has no line");
  const grid=pmf();let first=0,second=0,push=0;
  for(const cell of grid.cells){const result=market==="total"?cell.home+cell.away-line!:cell.home-cell.away+(market==="spread"?line!:0);
   if(result>0)first+=cell.probability;else if(result<0)second+=cell.probability;else push+=cell.probability;
  }
  return {first,second,push,capturedMass:grid.mass,omittedMassUpperBound:grid.omittedMassUpperBound,
   quadratureErrorEstimate:grid.quadratureErrorEstimate,normalizerErrorEstimate:grid.normalizerErrorEstimate,
   summationRoundoffUpperBound:grid.summationRoundoffUpperBound,unconditionedGridTailBound:grid.unconditionedGridTailBound,
   errorInterpretation:ERROR_INTERPRETATION};
 }
 type FastProbability=ReturnType<typeof probabilities>&{approximation:"bounded_home_strips_unbounded_nonnegative_away"};
 const thresholdCache=new Map<string,Readonly<FastProbability>>();
 /** O(N) exact-contract integration through the SAME normalized score law.
  * Only the enumerated home marginal is tail-truncated; away remains unbounded
  * above. Forbidden tie cells are removed by splitting positive rectangles,
  * never by clipping a subtraction or normalizing the strips a second time. */
 function probabilitiesFast(market:"moneyline"|"spread"|"total",line:number|null=null):Readonly<FastProbability>{
  if(!["moneyline","spread","total"].includes(market))throw new CbbScoreLawNumericalError("unknown market");
  if(market!=="moneyline"&&(line===null||!Number.isFinite(line)||!Number.isInteger(line*2)))throw new CbbScoreLawNumericalError("exact integer or half-point market line is required");
  if(market==="moneyline"&&line!==null)throw new CbbScoreLawNumericalError("moneyline has no line");
  const key=JSON.stringify([market,line]),cached=thresholdCache.get(key);if(cached)return cached;
  const homeMin=Math.max(0,Math.floor(hm-hs*zLimit-.5)),homeMax=Math.max(0,Math.ceil(hm+hs*zLimit+.5));
  if(homeMax>config.maxGridScore||homeMax-homeMin+1>Math.floor((config.maxEvaluations-evaluations)/24))
   throw new CbbScoreLawNumericalError("threshold strip budget exhausted before enumeration");
  let first=0,second=0,push=0,rawError=0,terms=0;
  const positiveRectangle=(h:number,lo:number,hi:number)=>{
   lo=Math.max(-.5,lo);if(!(lo<hi))return 0;
   const value=rectangle(h-.5,h+.5,lo,hi,false);rawError+=value.errorEstimate;terms++;
   return Math.exp(value.logValue)/normalizer;
  };
  const strip=(h:number,lo:number,hi:number)=>{
   lo=Math.max(-.5,lo);if(!(lo<hi))return 0;
   const tieLo=h-.5,tieHi=h+.5;
   if(hi<=tieLo||lo>=tieHi)return positiveRectangle(h,lo,hi);
   return positiveRectangle(h,lo,Math.min(hi,tieLo))+positiveRectangle(h,Math.max(lo,tieHi),hi);
  };
  for(let h=homeMin;h<=homeMax;h++){
   if(market==="total"){
    const threshold=line!-h;
    first+=strip(h,Math.floor(threshold)+.5,Infinity);
    second+=strip(h,-.5,Math.ceil(threshold)-.5);
    if(Number.isInteger(threshold)&&threshold>=0&&threshold!==h)push+=positiveRectangle(h,threshold-.5,threshold+.5);
   }else{
    const threshold=h+(market==="spread"?line!:0);
    first+=strip(h,-.5,Math.ceil(threshold)-.5);
    second+=strip(h,Math.floor(threshold)+.5,Infinity);
    if(market==="spread"&&Number.isInteger(threshold)&&threshold>=0&&threshold!==h)
     push+=positiveRectangle(h,threshold-.5,threshold+.5);
   }
  }
  const capturedMass=first+second+push;
  const unconditionedGridTailBound=(homeMin>0?Math.exp(logNormalTail((hm-homeMin+.5)/hs)):0)+
   Math.exp(logNormalTail((homeMax+.5-hm)/hs));
  const omittedMassUpperBound=unconditionedGridTailBound/(normalizer-normalizerError);
  const qError=rawError/normalizer,nError=normalizerError/(normalizer-normalizerError);
  const summationRoundoffUpperBound=32*Number.EPSILON*terms;
  if(Math.abs(1-capturedMass)>omittedMassUpperBound+qError+nError+summationRoundoffUpperBound)
   throw new CbbScoreLawNumericalError("threshold strips do not match the common normalization/error budget");
  const value=Object.freeze({first,second,push,capturedMass,omittedMassUpperBound,quadratureErrorEstimate:qError,
   normalizerErrorEstimate:nError,summationRoundoffUpperBound,unconditionedGridTailBound,errorInterpretation:ERROR_INTERPRETATION,
   approximation:"bounded_home_strips_unbounded_nonnegative_away" as const});
  thresholdCache.set(key,value);return value;
 }
 function summary(){
  const grid=pmf();let home=0,away=0,hh=0,aa=0,ha=0;
  for(const c of grid.cells){home+=c.home*c.probability;away+=c.away*c.probability;
   hh+=c.home*c.home*c.probability;aa+=c.away*c.away*c.probability;ha+=c.home*c.away*c.probability;}
  const homeVariance=hh-home*home,awayVariance=aa-away*away,homeAwayCovariance=ha-home*away;
  const marginVariance=homeVariance+awayVariance-2*homeAwayCovariance,totalVariance=homeVariance+awayVariance+2*homeAwayCovariance;
  if(!(homeVariance>0&&awayVariance>0&&marginVariance>0&&totalVariance>0))throw new CbbScoreLawNumericalError("moments are not resolved as positive variances");
  const unconditionalMissing=grid.omittedMassUpperBound*(normalizer-normalizerError);
  const meanTail=(mean:number,variance:number)=>(Math.sqrt(mean*mean+variance)+.5)*Math.sqrt(unconditionalMissing)/(normalizer-normalizerError);
  const roundedFourthRoot=(mean:number,variance:number)=>Math.pow(mean**4+6*mean*mean*variance+3*variance*variance,.25)+.5;
  const hFourth=roundedFourthRoot(hm,hv),aFourth=roundedFourthRoot(am,av),momentTailScale=Math.sqrt(unconditionalMissing)/(normalizer-normalizerError);
  const largestScore=Math.max(grid.bounds.homeMax,grid.bounds.awayMax);
  const numericalMeanErrorEstimate=Math.max(Math.abs(home),Math.abs(away))*grid.normalizerErrorEstimate+
   largestScore*(grid.quadratureErrorEstimate+grid.summationRoundoffUpperBound);
  const numericalSecondMomentErrorEstimate=largestScore*largestScore*
   (grid.normalizerErrorEstimate+grid.quadratureErrorEstimate+grid.summationRoundoffUpperBound);
  const correlation=(homeVariance-awayVariance)/Math.sqrt(marginVariance*totalVariance);
  if(!Number.isFinite(correlation)||Math.abs(correlation)>=1)throw new CbbScoreLawNumericalError("conditioned correlation is not numerically resolved inside (-1,1)");
  return {latent:{...frozen},homeMean:home,awayMean:away,marginMean:home-away,totalMean:home+away,
   homeVariance,awayVariance,homeAwayCovariance,marginSd:Math.sqrt(marginVariance),totalSd:Math.sqrt(totalVariance),
   marginTotalCorrelation:correlation,
   homeWinProbability:probabilities("moneyline").first,normalizer,positiveMass,tieMass:ties,
   capturedMass:grid.mass,omittedMassUpperBound:grid.omittedMassUpperBound,unconditionedGridTailBound:grid.unconditionedGridTailBound,
   quadratureErrorEstimate:grid.quadratureErrorEstimate,summationRoundoffUpperBound:grid.summationRoundoffUpperBound,
   normalizerTailBound,normalizerQuadratureErrorEstimate,
   homeMeanTailErrorBound:meanTail(hm,hv),awayMeanTailErrorBound:meanTail(am,av),
   homeSecondMomentTailErrorBound:hFourth*hFourth*momentTailScale,awaySecondMomentTailErrorBound:aFourth*aFourth*momentTailScale,
   crossMomentTailErrorBound:hFourth*aFourth*momentTailScale,
   numericalMeanErrorEstimate,numericalSecondMomentErrorEstimate,
   errorInterpretation:ERROR_INTERPRETATION,
   evaluations,gridBounds:{...grid.bounds},numerics:{...config}};
 }
 return {latent:{...frozen},normalizer,normalizerTailBound,normalizerQuadratureErrorEstimate,
  logCellProbability,cellProbability,cellNll,probabilities,probabilitiesFast,summary,pmf,
  diagnostics:()=>({evaluations,quadratureErrorEstimate,normalizerTailBound,normalizerQuadratureErrorEstimate,
   thresholdCacheEntries:thresholdCache.size,fullPmfBuilt:cachedGrid!==null})};
}
