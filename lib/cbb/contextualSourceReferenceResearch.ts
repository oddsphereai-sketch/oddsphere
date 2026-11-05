/** Ancillary professional-source price diagnostics only. Proportional
 * two-way de-vig supplies a quote-implied conditional reference, not a uniquely
 * identified true book probability, game distribution or sharp bettor identity.
 * Cross-line transport borrows model shape explicitly and NEVER supplies or
 * mutates the final game forecast. No provider/writer/model-selection hook. */
import {createCbbContextualScoreLaw,CbbScoreLawNumericalError,type CbbContextualLatentGaussian,type CbbScoreLawNumerics} from "./contextualScoreLawResearch";
import {cbbEvidenceReceiptBounds} from "./marketReceiptTime";
import type {CbbQuote} from "./types";
import type {CbbContextualConsumerQuote} from "./contextualForecastFeatures";

type Quote=CbbQuote&{orientationVerified?:boolean};
const instant=(v:string|undefined)=>{if(typeof v!=="string"||!Number.isFinite(Date.parse(v)))return null;const f=v.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1]??"";return f.length>9&&/[1-9]/.test(f.slice(9))?null:BigInt(Date.parse(v))*BigInt(1000000)+BigInt(f.slice(3,9).padEnd(6,"0"));};
const sameInstant=(a:string|undefined,b:string|undefined)=>instant(a)!==null&&instant(a)===instant(b);
type Law=ReturnType<typeof createCbbContextualScoreLaw>;
type Probabilities=ReturnType<Law["probabilitiesFast"]>;
type NumericalBounds=Pick<Probabilities,"omittedMassUpperBound"|"quadratureErrorEstimate"|"normalizerErrorEstimate"|"summationRoundoffUpperBound"|"errorInterpretation">;
const numericalBounds=(p:Probabilities):NumericalBounds=>Object.freeze({omittedMassUpperBound:p.omittedMassUpperBound,
 quadratureErrorEstimate:p.quadratureErrorEstimate,normalizerErrorEstimate:p.normalizerErrorEstimate,
 summationRoundoffUpperBound:p.summationRoundoffUpperBound,errorInterpretation:p.errorInterpretation});
type RootProof={axis:"marginMean"|"totalMean";location:number;interval:readonly [number,number];fairResidual:number;iterations:number;
 sourceConditionalProbability:number;fairTolerance:number;locationTolerance:number;
 sourceConditionalNumericalErrorEstimate:number;
 interpretation:"numerical_bracket_under_borrowed_shape_not_a_statistical_confidence_interval"};
export type CbbSourceReferenceResult={
 role:"reference_economics_only";finalForecastInfluence:"none";
 deVigMethod:"proportional_two_way_implied_odds";
 probabilityInterpretation:"quote_implied_conditional_reference_not_uniquely_identified_true_book_probability";
 status:"direct"|"direct_conditional_only"|"assumption_based"|"unidentifiable";reason:string;
 sourceConditionalFairFirst:number|null;directTargetResolvedBetExpectedValue:number|null;
 targetExpectedValue:number|null;targetValueSign:"positive"|"negative"|"zero"|"unidentified";
 probabilities:{first:number;second:number;push:number}|null;
 numerical:NumericalBounds|null;assumptions:readonly string[];root:RootProof|null;
};
export const CBB_JOINT_REFERENCE_SOURCE_FAMILIES=Object.freeze(["circa","pinnacle","bookmaker"] as const);
const family=(book:string)=>{
 const compact=book.trim().toLowerCase().replace(/[^a-z0-9]/g,"");
 if(["circa","circasports","circasportsbook"].includes(compact))return "circa";
 if(["pinnacle","ps3838","pinnaclemqtt","pinnaclesports","pinnaclesportsbook"].includes(compact))return "pinnacle";
 if(["bookmaker","bookmakersports","bookmakersportsbook","bookmakerus"].includes(compact))return "bookmaker";
 return compact;
};
const implied=(price:number)=>price>0?100/(price+100):-price/(-price+100);
const profit=(price:number)=>price>0?price/100:100/-price;
const sign=(v:number)=>v>0?"positive" as const:v<0?"negative" as const:"zero" as const;
const shapeAssumption="borrow_final_joint_latent_margin_total_scales_and_correlation; shift_only_native_market_location_keep_other_location_fixed; not_identified_by_source_odds";

export function createCbbJointSourceReferencePricer(args:{gameId:number;asOf:string;finalLatent:CbbContextualLatentGaussian;
 finalLaw?:Law;lawNumerics?:CbbScoreLawNumerics;rootNumerics?:{fairTolerance?:number;locationTolerance?:number;
 maxRootIterations?:number;maxBracketExpansions?:number;maxLawEvaluations?:number}}){
 if(!Number.isSafeInteger(args.gameId)||args.gameId<=0||!Number.isFinite(Date.parse(args.asOf)))throw Error("invalid reference event/cutoff");
 const gameId=args.gameId,latent=Object.freeze({...args.finalLatent}),at=Date.parse(args.asOf);
 const lawNumerics=args.lawNumerics?Object.freeze({...args.lawNumerics}):undefined;
 const config={fairTolerance:1e-8,locationTolerance:1e-6,maxRootIterations:48,maxBracketExpansions:12,maxLawEvaluations:4096,...args.rootNumerics};
 if(!(config.fairTolerance>0&&config.locationTolerance>0)||!Object.values(config).every(Number.isFinite)||
  ![config.maxRootIterations,config.maxBracketExpansions,config.maxLawEvaluations].every(v=>Number.isSafeInteger(v)&&v>0))throw Error("invalid source-reference numerical budget");
 let lawEvaluations=args.finalLaw?0:1;
 const finalLaw=args.finalLaw??createCbbContextualScoreLaw(latent,lawNumerics);
 if((["marginMean","totalMean","marginSd","totalSd","correlation"] as const).some(k=>finalLaw.latent[k]!==latent[k]))
  throw Error("reference context does not match the final latent law");
 const quoteKey=(q:Quote)=>JSON.stringify([q.gameId,family(q.sportsbook),q.market,q.phase,q.provider??null,q.line,q.firstPrice,q.secondPrice,
  q.sourceEventId??null,q.providerEventId??null,
  q.providerObservedAt,q.fetchedAt,["requestedAt" in q,q.requestedAt??null],
  ["canonicalReceipt" in q,q.canonicalReceipt??null],q.orientationVerified??null]);
 const validate=(q:Quote,executable:boolean,proof?:CbbContextualConsumerQuote):string|null=>{
  const columnProof=executable&&q.provider==="balldontlie"&&q.orientationVerified===undefined&&proof?.orientationProof==="native_home_away_fields"&&
   proof.availabilityKind==="http_response"&&proof.gameId===q.gameId&&family(proof.sportsbook)===family(q.sportsbook)&&proof.market===q.market&&
   proof.line===q.line&&proof.firstPrice===q.firstPrice&&proof.secondPrice===q.secondPrice&&sameInstant(proof.providerObservedAt,q.providerObservedAt)&&
   sameInstant(proof.fetchedAt,q.fetchedAt)&&sameInstant(proof.availableBy,proof.fetchedAt)&&instant(proof.providerObservedAt)!<=instant(proof.fetchedAt)!&&Date.parse(proof.availableBy)<=at&&
   (!(q.sourceEventId??q.providerEventId)||!(proof.sourceEventId??proof.providerEventId)||(q.sourceEventId??q.providerEventId)===(proof.sourceEventId??proof.providerEventId));
  if(q.gameId!==gameId||q.phase!=="current"||!(q.orientationVerified===true||columnProof)||!q.sportsbook?.trim())return "unattested_quote_identity_or_orientation";
  if(!["moneyline","spread","total"].includes(q.market))return "unknown_native_market";
  if(![q.firstPrice,q.secondPrice].every(p=>Number.isFinite(p)&&Math.abs(p)>=100)||
   (q.market==="moneyline"?q.line!==null:q.line===null||!Number.isFinite(q.line)||!Number.isInteger(q.line*2)))return "invalid_two_sided_contract";
  if(q.market==="total"&&q.line!<=0)return "invalid_total_contract";
  const hold=implied(q.firstPrice)+implied(q.secondPrice);if(hold<.98||hold>1.3)return "incoherent_native_hold";
  if("canonicalReceipt" in q&&(!q.canonicalReceipt||typeof q.canonicalReceipt!=="object"||Array.isArray(q.canonicalReceipt)))
   return "invalid_identifiable_canonical_receipt";
  if(executable&&"canonicalReceipt" in q)return "target_is_not_an_executable_receipt";
  const ids=[q.sourceEventId,q.providerEventId,q.canonicalReceipt?.providerEventId].filter(x=>x!==undefined);if(ids.some(x=>typeof x!=="string"||!x.trim())||new Set(ids).size>1)return "known_native_quote_identity_conflict";
  try{const b=cbbEvidenceReceiptBounds(q),observed=Date.parse(q.providerObservedAt);
   const native=instant(q.providerObservedAt),completion=instant(q.fetchedAt),available=instant(q.canonicalReceipt?.availableBy??q.fetchedAt),cutoff=instant(args.asOf);
   if(![observed,b.available].every(Number.isFinite)||native===null||completion===null||available===null||cutoff===null||native>available||completion>available||available>cutoff||observed>b.available||b.available>at)return "future_or_unavailable_quote";
  }catch{return "invalid_quote_receipt";}
  return null;
 };
 type Inversion={status:"ok";law:Law;proof:RootProof}|{status:"unidentifiable";reason:string};
 const inversions=new Map<string,Inversion>(),results=new Map<string,Readonly<CbbSourceReferenceResult>>();
 const newLaw=(location:number,axis:"marginMean"|"totalMean")=>{
  if(lawEvaluations>=config.maxLawEvaluations)throw new CbbScoreLawNumericalError("source-reference law evaluation budget exhausted");
  lawEvaluations++;return createCbbContextualScoreLaw({...latent,[axis]:location},lawNumerics);
 };
 const conditional=(p:Probabilities)=>{
  const nonpush=p.first+p.second;if(!(nonpush>0))throw new CbbScoreLawNumericalError("native non-push probability is unresolved");
  const error=2*(p.omittedMassUpperBound+p.quadratureErrorEstimate+p.normalizerErrorEstimate+p.summationRoundoffUpperBound)/nonpush;
  if(!(error<=config.fairTolerance))throw new CbbScoreLawNumericalError("native conditional probability is unresolved at the requested numerical tolerance");
  return {value:p.first/nonpush,errorEstimate:error};
 };
 function invert(source:Quote,fair:number):Inversion{
  const key=quoteKey(source),cached=inversions.get(key);if(cached)return cached;
  const axis=source.market==="total"?"totalMean":"marginMean",center=latent[axis],scale=source.market==="total"?latent.totalSd:latent.marginSd;
  try{
   const evaluate=(location:number)=>{const law=newLaw(location,axis),p=conditional(law.probabilitiesFast(source.market,source.line));return {location,law,p:p.value,errorEstimate:p.errorEstimate};};
   let low=evaluate(center-scale),high=evaluate(center+scale),expansions=0;
   if(low.p>high.p+config.fairTolerance)throw new CbbScoreLawNumericalError("source-reference response is not monotone on bracket");
   while(!(low.p<=fair&&fair<=high.p)&&expansions<config.maxBracketExpansions){
    const span=scale*2**(++expansions);low=evaluate(center-span);high=evaluate(center+span);
    if(low.p>high.p+config.fairTolerance)throw new CbbScoreLawNumericalError("source-reference response is not monotone on bracket");
   }
   if(!(low.p<=fair&&fair<=high.p))throw new CbbScoreLawNumericalError("source conditional probability is not bracketed under borrowed shape");
   let best=Math.abs(low.p-fair)<Math.abs(high.p-fair)?low:high,iterations=0;
   for(;iterations<config.maxRootIterations;iterations++){
    const mid=evaluate((low.location+high.location)/2);
    if(mid.p<low.p-config.fairTolerance||mid.p>high.p+config.fairTolerance)throw new CbbScoreLawNumericalError("source-reference response is not monotone within bracket");
    if(Math.abs(mid.p-fair)<Math.abs(best.p-fair))best=mid;
    if(mid.p<fair)low=mid;else high=mid;
    if(high.location-low.location<=config.locationTolerance&&Math.abs(best.p-fair)<=config.fairTolerance)break;
   }
   if(best.location<low.location||best.location>high.location)best=evaluate((low.location+high.location)/2);
   if(high.location-low.location>config.locationTolerance||Math.abs(best.p-fair)>config.fairTolerance)
    throw new CbbScoreLawNumericalError("source-reference root iteration/residual budget exhausted");
   const out:Inversion={status:"ok",law:best.law,proof:{axis,location:best.location,interval:[low.location,high.location],
    fairResidual:best.p-fair,iterations:iterations+1,sourceConditionalProbability:best.p,
    sourceConditionalNumericalErrorEstimate:best.errorEstimate,
    fairTolerance:config.fairTolerance,locationTolerance:config.locationTolerance,
    interpretation:"numerical_bracket_under_borrowed_shape_not_a_statistical_confidence_interval"}};
   inversions.set(key,out);return out;
  }catch(error){if(!(error instanceof CbbScoreLawNumericalError))throw error;
   const out:Inversion={status:"unidentifiable",reason:error.message};inversions.set(key,out);return out;}
 }
 function evaluate(input:{source:Quote;target:Quote;selection:"first"|"second";integerPushAssumption?:"borrow_final_joint_push";targetOrientationProof?:CbbContextualConsumerQuote}):Readonly<CbbSourceReferenceResult>{
  const {source,target,selection}=input,key=JSON.stringify([quoteKey(source),quoteKey(target),selection,input.integerPushAssumption??null,input.targetOrientationProof??null]);
  const cached=results.get(key);if(cached)return cached;
  const base:CbbSourceReferenceResult={role:"reference_economics_only",finalForecastInfluence:"none",status:"unidentifiable",reason:"unresolved",
   deVigMethod:"proportional_two_way_implied_odds",
   probabilityInterpretation:"quote_implied_conditional_reference_not_uniquely_identified_true_book_probability",
   sourceConditionalFairFirst:null,directTargetResolvedBetExpectedValue:null,targetExpectedValue:null,targetValueSign:"unidentified",
   probabilities:null,numerical:null,assumptions:[],root:null};
  const done=(value:CbbSourceReferenceResult)=>{const result=Object.freeze({...value,
   probabilities:value.probabilities?Object.freeze({...value.probabilities}):null,
   root:value.root?Object.freeze({...value.root,interval:Object.freeze([value.root.interval[0],value.root.interval[1]] as const)}):null,
   assumptions:Object.freeze([...value.assumptions])});results.set(key,result);return result;};
  const invalid=validate(source,false)??validate(target,true,input.targetOrientationProof);
  if(invalid)return done({...base,reason:invalid});
  if(!(CBB_JOINT_REFERENCE_SOURCE_FAMILIES as readonly string[]).includes(family(source.sportsbook)))
   return done({...base,reason:"unsupported_nonprofessional_reference_source"});
  if(selection!=="first"&&selection!=="second")return done({...base,reason:"invalid_selection"});
  if(source.market!==target.market)return done({...base,reason:"cross_market_reference_not_identified"});
  if(family(source.sportsbook)===family(target.sportsbook))return done({...base,reason:"source_and_target_are_same_physical_book"});
  const fair=implied(source.firstPrice)/(implied(source.firstPrice)+implied(source.secondPrice)),price=selection==="first"?target.firstPrice:target.secondPrice;
  if(!(fair>0&&fair<1))return done({...base,reason:"native_fair_probability_not_numerically_inside_unit_interval"});
  base.sourceConditionalFairFirst=fair;
  if(source.market==="total"&&source.line!<=1)return done({...base,reason:"native_contract_impossible_under_nonnegative_nontied_scores"});
  if(source.line===target.line){
   const selected=selection==="first"?fair:1-fair,resolved=selected*profit(price)-(1-selected);
   const direct={...base,directTargetResolvedBetExpectedValue:resolved,targetValueSign:sign(resolved)};
   const noPush=source.market==="moneyline"||!Number.isInteger(source.line)||source.market==="spread"&&source.line===0;
   if(noPush)return done({...direct,status:"direct",reason:"same_contract_proportional_devig_reference_no_push",
    probabilities:{first:fair,second:1-fair,push:0},targetExpectedValue:resolved});
   if(input.integerPushAssumption!=="borrow_final_joint_push")return done({...direct,status:"direct_conditional_only",reason:"integer_push_mass_not_identified_by_native_odds"});
   try{const p=finalLaw.probabilitiesFast(source.market,source.line),push=p.push,first=fair*(1-push),second=(1-fair)*(1-push);
    return done({...direct,status:"assumption_based",reason:"native_fair_with_explicit_model_borrowed_push_mass",
     probabilities:{first,second,push},numerical:numericalBounds(p),targetExpectedValue:(selection==="first"?first:second)*profit(price)-(selection==="first"?second:first),
     assumptions:["same_contract_integer_push_borrowed_from_final_joint_law; not_identified_by_source_odds"]});
   }catch(error){if(!(error instanceof CbbScoreLawNumericalError))throw error;return done({...direct,reason:error.message});}
  }
  const inversion=invert(source,fair);
  if(inversion.status!=="ok")return done({...base,reason:inversion.reason,assumptions:[shapeAssumption]});
  try{
   const p=inversion.law.probabilitiesFast(target.market,target.line),win=selection==="first"?p.first:p.second,lose=selection==="first"?p.second:p.first;
   const ev=win*profit(price)-lose;
   return done({...base,status:"assumption_based",reason:"cross_line_reference_under_explicit_transferred_joint_shape",targetExpectedValue:ev,
    targetValueSign:sign(ev),probabilities:{first:p.first,second:p.second,push:p.push},numerical:numericalBounds(p),assumptions:[shapeAssumption],root:inversion.proof});
  }catch(error){if(!(error instanceof CbbScoreLawNumericalError))throw error;return done({...base,reason:error.message,assumptions:[shapeAssumption]});}
 }
 return {evaluate,diagnostics:()=>({lawEvaluations,inversionCacheEntries:inversions.size,resultCacheEntries:results.size,
  anyReferencePmfBuilt:[...inversions.values()].some(v=>v.status==="ok"&&v.law.diagnostics().fullPmfBuilt),
  anyFullPmfBuilt:finalLaw.diagnostics().fullPmfBuilt||[...inversions.values()].some(v=>v.status==="ok"&&v.law.diagnostics().fullPmfBuilt),
  role:"reference_economics_only" as const})};
}
