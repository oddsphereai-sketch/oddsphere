/** One-law offline composition. Interpretation is supplied by the same forecast
 * call, never independently re-created by the grade path. No writer or fallback.
 * Price references are ancillary quote economics, not a second game forecast. */
import {createCbbContextualScoreLaw,type CbbContextualLatentGaussian,type CbbScoreLawNumerics} from "./contextualScoreLawResearch";
import {createCbbJointSourceReferencePricer} from "./contextualSourceReferenceResearch";
import {cbbEvidenceReceiptBounds,cbbAvailabilityUpperBoundMs} from "./marketReceiptTime";
import {cbbPathBookFamily} from "./marketBehaviorPath";
import type {CbbContextualFeatureInput,CbbContextualConsumerQuote} from "./contextualForecastFeatures";
import {CBB_CONTEXTUAL_MARKET_INTERPRETATION_RELEASE,buildCbbContextualMarketInterpretation,type CbbContextualMarketInterpretation} from "./contextualMarketInterpretation";
import type {CbbQuote} from "./types";

export const CBB_INTERPRETED_DECISION_RELEASE="cbb_interpreted_decision_2026_11_05_r6_confidence_price_tiers" as const;
/** Product label boundaries, not learned accuracy claims or signal activation
 * gates. The forecast has already interpreted the full qualified market.
 * Confidence is the same unconditional win probability stored in the decision;
 * pushes are refunded in EV, never counted as wins toward the confidence bar. */
export const CBB_INTERPRETED_GRADE_POLICY=Object.freeze({bestMinimumWinProbability:.62,bestMinimumAmericanPrice:-200,
 leanMeaning:"positive_exact_price_value_on_the_final_forecast_side;expensive_favorites_remain_eligible",
 bestMeaning:"strong_final_outcome_confidence_with_positive_value_at_a_suitable_straight_bet_price",
 basis:"owner_confidence_accuracy_and_price_tiers;NBA_confidence_bar_and_NFL_favorite_price_boundary;no_EV_reserve_or_required_book_confirmation",
 sharpMeaning:"qualified_market_evidence_informs_final_forecast;book_context_does_not_identify_bettors_or_guarantee_correctness"});
export function gradeCbbContextualForecastSide(args:{winProbability:number;loseProbability:number;price:number;probabilityErrorEstimate?:number}){
 const {winProbability:p,loseProbability:loss,price}=args,probabilityErrorEstimate=args.probabilityErrorEstimate??0;
 if(![p,loss,price,probabilityErrorEstimate].every(Number.isFinite)||p<0||loss<0||probabilityErrorEstimate<0||p+loss>1+1e-10||p+loss<=0||Math.abs(price)<100)throw Error("CBB contextual grade requires a valid final-law probability and offered price");
 const expectedValue=p*profit(price)-loss;
 // This is arithmetic resolution, not a business edge reserve. Do not promote
 // a mathematically break-even offer because floating-point EV is +1e-17.
 const numericalValueErrorEstimate=(profit(price)+1)*probabilityErrorEstimate+8*Number.EPSILON*(Math.abs(p*profit(price))+Math.abs(loss)+1);
 const valueSignResolvedPositive=expectedValue>numericalValueErrorEstimate;
 const best=valueSignResolvedPositive&&p-probabilityErrorEstimate>=CBB_INTERPRETED_GRADE_POLICY.bestMinimumWinProbability&&price>=CBB_INTERPRETED_GRADE_POLICY.bestMinimumAmericanPrice;
 const grade=!valueSignResolvedPositive?"Watchlist" as const:best?"Best Angle" as const:"Lean" as const;
 const reason=grade==="Watchlist"?(expectedValue>0?"priced_value_sign_unresolved_at_numerical_precision":"forecast_available_price_not_actionable"):best?"joint_forecast_confidence_and_positive_price_value":
  price<CBB_INTERPRETED_GRADE_POLICY.bestMinimumAmericanPrice?"positive_value_price_outside_best_angle_range":"positive_value_below_best_angle_confidence";
 return {grade,reason,expectedValue,numericalValueErrorEstimate,probabilityErrorEstimate,valueSignResolvedPositive};
}
type Quote=CbbQuote&{orientationVerified?:boolean};
const implied=(p:number)=>p>0?100/(100+p):-p/(100-p);
const profit=(p:number)=>p>0?p/100:100/-p;
const family=(book:string)=>cbbPathBookFamily(book.trim().toLowerCase());
const ownNativeId=(q:{sourceEventId?:string;providerEventId?:string})=>q.sourceEventId??q.providerEventId;
const precise=(value:string)=>{const ms=Date.parse(value),fraction=value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1]??"";return !Number.isFinite(ms)||fraction.length>9&&/[1-9]/.test(fraction.slice(9))?null:BigInt(ms)*BigInt(1000000)+BigInt(fraction.slice(3,9).padEnd(6,"0"));};
const sameQuote=(a:Pick<Quote,"gameId"|"sportsbook"|"market"|"line"|"firstPrice"|"secondPrice"|"providerObservedAt">,b:typeof a)=>
 a.gameId===b.gameId&&family(a.sportsbook)===family(b.sportsbook)&&a.market===b.market&&a.line===b.line&&a.firstPrice===b.firstPrice&&a.secondPrice===b.secondPrice&&precise(a.providerObservedAt)!==null&&precise(a.providerObservedAt)===precise(b.providerObservedAt);
function executionProof(q:Quote,input:CbbContextualFeatureInput,receipt:CbbContextualMarketInterpretation):{problem:string|null;columnProof?:CbbContextualConsumerQuote}{
 const at=Date.parse(input.asOf),stream=receipt.streams.find(s=>family(s.book)===family(q.sportsbook)&&s.market===q.market&&(s.role==="consumer"||s.role==="professional")),current=stream?.currentQuote;
 if(!current||!sameQuote(q,current.rawQuote))return {problem:"execution_pair_not_current_unambiguous_interpreted_quote"};
 if(q.sourceEventId&&q.providerEventId&&q.sourceEventId!==q.providerEventId||ownNativeId(q)&&current.eventId&&q.provider&&q.provider===current.provider&&ownNativeId(q)!==current.eventId)return {problem:"execution_same_provider_native_identity_conflict"};
 if(q.gameId!==input.independent.gameId||q.phase!=="current"||"canonicalReceipt" in q)return {problem:"execution_identity_phase_or_receipt_invalid"};
 // Last-known-state selection may retain another whole observation of the
 // same native pair. The execution receipt must still own its actual column
 // attestation; a later DB receipt cannot lend that proof or fabricate it.
 const columnProof=q.provider==="balldontlie"&&q.orientationVerified===undefined?[...(input.consumerCurrentQuotes??[]),...(input.consumerHistoryQuotes??[])].find(p=>{
  if(!sameQuote(q,p)||precise(p.fetchedAt??"")===null||precise(p.fetchedAt??"")!==precise(q.fetchedAt)||p.provider!=="balldontlie"||p.orientationProof!=="native_home_away_fields"||"orientationVerified"in p&&p.orientationVerified===false||p.availabilityKind!=="http_response"||p.canonicalReceipt!==undefined||ownNativeId(q)&&ownNativeId(p)&&ownNativeId(q)!==ownNativeId(p))return false;
  const completion=precise(p.fetchedAt??""),available=precise(p.availableBy),native=precise(p.providerObservedAt),cutoff=precise(input.asOf);
  if(completion===null||available!==completion||native===null||cutoff===null||native>completion||completion>cutoff)return false;
  return buildCbbContextualMarketInterpretation({...input,currentQuotes:[],historyQuotes:[],consumerCurrentQuotes:[p],consumerHistoryQuotes:[],pathTape:null,splitContext:[],pressureDecisions:[],consumerQuarantinedSources:[],consumerTruncatedSources:[]}).streams.some(s=>s.currentQuote&&sameQuote(s.currentQuote.rawQuote,p));
 }):undefined;
 if(q.orientationVerified!==true&&!columnProof)return {problem:"execution_orientation_unattested"};
 if(![q.firstPrice,q.secondPrice].every(p=>Number.isFinite(p)&&Math.abs(p)>=100)||(q.market==="moneyline"?q.line!==null:q.line===null||!Number.isFinite(q.line)||!Number.isInteger(q.line*2))||q.market==="total"&&q.line!<=0)return {problem:"execution_contract_invalid"};
 const hold=implied(q.firstPrice)+implied(q.secondPrice);if(hold<.98||hold>1.3)return {problem:"execution_pair_hold_invalid"};
 try{const b=cbbEvidenceReceiptBounds(q),native=Date.parse(q.providerObservedAt);
  const pn=precise(q.providerObservedAt),pc=precise(q.fetchedAt),pa=precise(input.asOf);
  if(pn===null||pc===null||pa===null||pn>pc||pc>pa||![b.available,native].every(Number.isFinite)||native>b.available||b.available>at||at-native>3_600_000)return {problem:"execution_clock_unavailable_or_stale"};
 }catch{return {problem:"execution_receipt_invalid"};}
 return {problem:null,columnProof};
}
export function buildCbbInterpretedDecision(args:{input:CbbContextualFeatureInput;interpretation:CbbContextualMarketInterpretation;
 latent:CbbContextualLatentGaussian;targets:readonly Quote[];numerics?:CbbScoreLawNumerics}){
 const {input,interpretation:receipt}=args,at=Date.parse(input.asOf);
 if(receipt.release!==CBB_CONTEXTUAL_MARKET_INTERPRETATION_RELEASE||receipt.gameId!==input.independent.gameId||receipt.asOf!==input.asOf)throw Error("CBB decision interpretation/forecast identity mismatch");
 if(new Set(args.targets.map(q=>q.market)).size!==args.targets.length)throw Error("CBB decision requires one execution target per market");
 const law=createCbbContextualScoreLaw(args.latent,args.numerics),summary=law.summary(),references=createCbbJointSourceReferencePricer({gameId:receipt.gameId,asOf:input.asOf,finalLatent:args.latent,finalLaw:law,lawNumerics:args.numerics});
 const markets=(["moneyline","spread","total"] as const).map(market=>{
  const target=args.targets.find(q=>q.market===market),proof=target?executionProof(target,input,receipt):{problem:"missing_execution_pair"};
  if(!target||proof.problem)return {market,target:target??null,grade:"Held" as const,reason:proof.problem,selection:null,probability:null,loseProbability:null,pushProbability:null,price:null,expectedValue:null,stake:0};
  const p=law.probabilitiesFast(market,target.line);
  const selection:"first"|"second"=p.first>=p.second?"first":"second",direction=selection==="first"?1:-1;
  const probability=selection==="first"?p.first:p.second,loseProbability=selection==="first"?p.second:p.first,price=selection==="first"?target.firstPrice:target.secondPrice;
  const grading=gradeCbbContextualForecastSide({winProbability:probability,loseProbability,price,probabilityErrorEstimate:p.omittedMassUpperBound+p.quadratureErrorEstimate+p.normalizerErrorEstimate+p.summationRoundoffUpperBound});
  const {grade,reason,expectedValue}=grading;
  const sourceEconomics=receipt.streams.filter(s=>s.role==="professional"&&s.market===market&&family(s.book)!==family(target.sportsbook)&&s.currentQuote).flatMap(s=>{
   const raw=s.currentQuote!.rawQuote;if(!("phase" in raw)||!raw.fetchedAt||at-Date.parse(raw.providerObservedAt)>3_600_000)return [];
   return [{book:s.book,source:raw,reference:references.evaluate({source:raw as Quote,target,selection,integerPushAssumption:"borrow_final_joint_push",targetOrientationProof:proof.columnProof})}];
  });
  const positiveProfessionalValue=sourceEconomics.some(x=>x.reference.targetExpectedValue!==null&&x.reference.targetExpectedValue>0);
  // All evidence is available by the decision cutoff. A source response need
  // not predate another book's HTTP request: these are contemporaneous observed
  // offers, not a claim that an execution occurred after the source moved.
  // A later buyback does not disappear because the net leg still agrees. Both
  // remain forecast inputs; only an active, unopposed own-book episode qualifies
  // as current categorical action evidence. A held quote alone proves no side.
  const bookPriceActions=receipt.streams.filter(s=>s.role==="professional"&&family(s.book)!==family(target.sportsbook)&&(market==="total"?s.market==="total":s.market!=="total")).flatMap(s=>s.pressureResponses.filter(r=>r.activeCurrent&&r.hadActualMove&&r.continuity!=="conflict"&&r.net?.direction===direction&&r.latest?.direction===direction&&r.pressure.moneyBalance!==null&&r.pressure.moneyBalance!==0&&r.response&&
   cbbAvailabilityUpperBoundMs(r.response.availableBy)<=at&&cbbAvailabilityUpperBoundMs(r.pressure.availableBy)<=at&&at-Date.parse(r.response.nativeAt)<=3_600_000).map(r=>({book:s.book,market:s.market,continuity:r.continuity,relation:r.relation,pressure:r.pressure,response:r.response})));
  const observedProfessionalBookPriceConfirmation=bookPriceActions.length>0;
  const counterevidence={professionalNegativeReference:sourceEconomics.filter(x=>x.reference.targetExpectedValue!==null&&x.reference.targetExpectedValue<0),
   opposingCompositions:receipt.streams.filter(s=>(market==="total"?s.market==="total":s.market!=="total")&&s.pressures.at(-1)?.moneyBalance!==null&&Math.sign(s.pressures.at(-1)?.moneyBalance??0)===-direction).map(s=>({book:s.book,market:s.market,role:s.role,pressure:s.pressures.at(-1),meaning:"cumulative composition; wagering-price and new-money volume unknown"})),
   opposingPaths:receipt.streams.filter(s=>(market==="total"?s.market==="total":s.market!=="total")&&(s.net?.direction===-direction||s.latest?.direction===-direction)).map(s=>({book:s.book,market:s.market,role:s.role,net:s.net,latest:s.latest,pathResolution:s.pathResolution,unknowns:s.unknowns}))};
  return {market,target,selection,probability,loseProbability,pushProbability:p.push,price,expectedValue,grade,stake:0,
   reason,gradingNumerics:{probabilityErrorEstimate:grading.probabilityErrorEstimate,valueErrorEstimate:grading.numericalValueErrorEstimate,valueSignResolvedPositive:grading.valueSignResolvedPositive},
   marketFairProbability:implied(price)/(implied(target.firstPrice)+implied(target.secondPrice)),sourceEconomics,positiveProfessionalValue,observedProfessionalBookPriceConfirmation,bookPriceActions,counterevidence,
   evidenceDisposition:"Full factual receipt informs the final forecast; grades use its exact probability and offered price. Opposing facts remain visible; ancillary references and observed actions are attribution, never mandatory promotion gates.",probabilityNumerics:p};
 });
 return {release:CBB_INTERPRETED_DECISION_RELEASE,authority:"offline_research_only" as const,gameId:receipt.gameId,asOf:input.asOf,interpretation:receipt,
  latentDistribution:{...args.latent},finalScore:{home:summary.homeMean,away:summary.awayMean,margin:summary.marginMean,total:summary.totalMean,homeWinProbability:summary.homeWinProbability},
  finalUncertainty:{marginSd:summary.marginSd,totalSd:summary.totalSd,marginTotalCorrelation:summary.marginTotalCorrelation},marketDecisions:markets,lawNumerics:summary,sourceReferenceNumerics:references.diagnostics(),policy:CBB_INTERPRETED_GRADE_POLICY};
}
export type CbbInterpretedMarketDecision=ReturnType<typeof buildCbbInterpretedDecision>;
