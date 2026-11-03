import {cbbExactMarketCenter} from "./marketReaderResearch";
import {cbbImpliedProbability,reviewCbbQuote} from "./marketEvidence";
import {cbbThresholdProbabilities} from "./model";
import {gradeCbbProvisional,type CbbGradeEvidence,type CbbProvisionalGrade} from "./provisionalGradePolicy";
import {cbbBookFamily,CBB_MARKET_BEHAVIOR_GRADE_RELEASE,assertCbbMarketBehaviorGradeReceipt,type CbbMarketBehaviorReceipt} from "./marketBehaviorCandidate";
import {cbbEvidenceAvailableAt} from "./marketReceiptTime";
import type {CbbQuote} from "./types";
import {readCbbDecisionSplits} from "./decisionSplitContext";

export type CbbProfessionalTargetEconomics={quote:CbbQuote;probability:number;pushProbability:number;expectedValue:number};
/** Each physical source is inverted independently through the declared CBB
 * law, then evaluated at the actual target threshold AND executable payout. */
export function cbbProfessionalTargetEconomics(input:CbbGradeEvidence,quotes:CbbQuote[]):CbbProfessionalTargetEconomics[]{
  const selected=reviewCbbQuote(input.forecast,input.target).selection;
  const price=selected==="first"?input.target.firstPrice:input.target.secondPrice;
  const profit=price>0?price/100:100/-price;
  return quotes.map(quote=>{
    const fair=cbbImpliedProbability(quote.firstPrice)/(cbbImpliedProbability(quote.firstPrice)+cbbImpliedProbability(quote.secondPrice));
    const center=cbbExactMarketCenter(input.forecast,quote,fair);
    const source=quote.market==="total"?{...input.forecast,total:center}:quote.market==="spread"?{...input.forecast,margin:center}:
      {...input.forecast,homeWinProbability:fair};
    const probabilities=cbbThresholdProbabilities(source,input.target.market,input.target.line);
    const probability=selected==="first"?probabilities.first:probabilities.second;
    const lose=selected==="first"?probabilities.second:probabilities.first;
    return {quote:structuredClone(quote),probability,pushProbability:probabilities.push,expectedValue:probability*profit-lose};
  });
}
/** Canonical rows carry a bounded arrival window, never an execution receipt.
 * Validate provenance before consulting legacy triage; retain every raw clock. */
function receiptAvailableAtDecision(quote:CbbQuote,at:number){
  if("canonicalReceipt" in quote&&(quote.canonicalReceipt===null||typeof quote.canonicalReceipt!=="object"))return false;
  try{const available=cbbEvidenceAvailableAt(quote),observed=Date.parse(quote.providerObservedAt);
    return Number.isFinite(at)&&Number.isFinite(available)&&Number.isFinite(observed)&&observed<=available&&available<=at;
  }catch{return false;}
}
function receivedQuoteValid(quote:CbbQuote,forecast:CbbGradeEvidence["forecast"],at:number){
  if(quote.gameId!==forecast.gameId||quote.phase!=="current"||!receiptAvailableAtDecision(quote,at)||
    at-Date.parse(quote.providerObservedAt)>3600_000||quote.market!=="moneyline"&&
    (quote.line===null||!Number.isFinite(quote.line)||!Number.isInteger(quote.line*2)))return false;
  try{const hold=cbbImpliedProbability(quote.firstPrice)+cbbImpliedProbability(quote.secondPrice);return hold>=.98&&hold<=1.3;}
  catch{return false;}
}
export function gradeCbbReceivedMarket(input:CbbGradeEvidence,receipt:CbbMarketBehaviorReceipt){
  assertCbbMarketBehaviorGradeReceipt(input,receipt);
  const at=Date.parse(input.asOf);
  if("canonicalReceipt" in input.target||!receiptAvailableAtDecision(input.target,at)){
    const held=gradeCbbProvisional({...input,forecast:{...input.forecast,inputStatus:"incomplete"},references:[]});
    return {...held,release:CBB_MARKET_BEHAVIOR_GRADE_RELEASE,reason:"unavailable_executable_target_receipt",
      modelExpectedValue:null,professionalTargetEconomics:[] as CbbProfessionalTargetEconomics[],economicCorroboration:false,
      economicPathConfirmation:false,actualActionConfirmation:false,marketPressure:"unavailable" as const,pathResistance:false,
      gradeBasis:"held_or_non_actionable",splitRead:[]};
  }
  const quarantined=new Set(receipt.anchors.quarantinedKeys??[]);
  const references=receipt.currentProfessionalQuotes.filter(q=>receiptAvailableAtDecision(q,at)&&!quarantined.has(`${cbbBookFamily(q.sportsbook)}:${q.market}`)&&
    !receipt.excludedFamilies.includes(cbbBookFamily(q.sportsbook))&&(q as CbbQuote&{orientationVerified?:boolean}).orientationVerified===true);
  const base=gradeCbbProvisional({...input,references},{quoteValidator:receivedQuoteValid});
  if(base.grade==="Held")return {...base,release:CBB_MARKET_BEHAVIOR_GRADE_RELEASE,
    modelExpectedValue:null,professionalTargetEconomics:[] as CbbProfessionalTargetEconomics[],economicCorroboration:false,
    economicPathConfirmation:false,actualActionConfirmation:false,marketPressure:"unavailable" as const,pathResistance:false,
    gradeBasis:"held_or_non_actionable",splitRead:[]};
  const professionalTargetEconomics=cbbProfessionalTargetEconomics(input,base.professionalReferenceQuotes);
  const economicCorroboration=professionalTargetEconomics.some(q=>q.expectedValue>1e-7)&&professionalTargetEconomics.every(q=>q.expectedValue>=-1e-7);
  const premiumProfessionalValue=professionalTargetEconomics.some(q=>q.expectedValue>=.08)&&
    professionalTargetEconomics.every(q=>q.expectedValue>=-1e-7);
  const selected=reviewCbbQuote(input.forecast,input.target).selection,sign=selected==="first"?1:-1;
  const splitRead=readCbbDecisionSplits(receipt.splitContext??[],input.target.market,input.target.line,selected as "first"|"second");
  const streams=receipt.pathPosture.filter(s=>s.market===input.target.market&&
    !receipt.excludedFamilies.includes(s.book)&&!quarantined.has(`${s.book}:${s.market}`));
  const relevantPressure=streams.filter(s=>s.status==="observed"&&s.pressureDirection!==null&&s.pressureDirection!==0);
  const support=relevantPressure.filter(s=>s.pressureDirection!*sign>0),opposition=relevantPressure.filter(s=>s.pressureDirection!*sign<0);
  const marketPressure=opposition.length&&support.length?"mixed":opposition.length?"opposes":support.length?"supports":"unavailable";
  const axis=input.target.market==="total"?receipt.total:receipt.margin;
  const adverseSources=streams.filter(s=>s.status==="observed"&&s.recentDirection*sign<0);
  // A complete, resolved own-source response already transported into this
  // exact axis is not a second independent objection to the final law. An
  // unequal/cross-market response, buyback or incomplete history cannot earn
  // this exemption. Native flow below remains separate information: its
  // concentration/pressure was never converted into numeric score points.
  const fullyAppliedPriceResponse=(s:typeof streams[number])=>receipt.historyCompleteness.price&&s.coverage==="retained_window"&&
    axis.status==="applied"&&["ongoing","resumed"].includes(s.sourceCurrentResolution)&&
    receipt.episodes.some(e=>e.book===s.book&&e.market===s.market&&Math.abs(e.delta-axis.delta)<=1e-7);
  const freshAdverse=adverseSources.some(s=>!fullyAppliedPriceResponse(s));
  // A named source's concentration is context even without matched response;
  // it cannot become invented score points or exact-target action confirmation.
  const unmatchedCircaOpposition=streams.some(s=>s.book==="circa"&&!s.latestFlowMatched&&s.flowConcentrationDirection*sign<0);
  // Response is relative to source money, not to this pick. A book resisting
  // opposite-side money can support the pick; only pick-adverse residuals or
  // pressure toward the pick that the source actually held are resistance.
  const matchedFlowResistance=streams.some(s=>s.latestFlowMatched&&s.boundFlowDirection!==null&&s.boundFlowDirection!==0&&(
    (s.flowReactionDirection!==null&&s.flowReactionDirection*sign<0)||
    (s.flowResponse==="held"&&s.boundFlowDirection!==null&&s.boundFlowDirection*sign>0)));
  const pathConflict=["conflicting","unresolved"].includes(axis.status)||streams.some(s=>s.status==="conflicting"||s.flowCurrentResolution==="contested"||s.sourceCurrentResolution==="contested");
  const historyIncomplete=!receipt.historyCompleteness.price;
  const pathResistance=historyIncomplete||freshAdverse||unmatchedCircaOpposition||matchedFlowResistance||opposition.length>0||pathConflict;
  const exactSupport=support.some(s=>s.pressureLine===input.target.line&&s.book===axis.sourceBook&&s.market===axis.sourceMarket);
  const targetRequested=Date.parse((input.target as CbbQuote&{requestedAt?:string}).requestedAt??"");
  const validTargetRequest=Number.isFinite(targetRequested)&&targetRequested<=Date.parse(input.target.fetchedAt);
  const resolvedSource=streams.find(s=>s.book===axis.sourceBook&&s.market===axis.sourceMarket);
  const sourceAvailable=Date.parse(resolvedSource?.frontierAvailableBy??"");
  const sourceEpisode=receipt.episodes.find(e=>e.book===axis.sourceBook&&e.market===axis.sourceMarket);
  const economicPathConfirmation=["applied","confirming"].includes(axis.status)&&axis.sourceMarket===input.target.market&&
    !!sourceEpisode&&sourceEpisode.delta*sign>1e-7&&
    resolvedSource?.recentDirection===sign&&Number.isFinite(sourceAvailable)&&validTargetRequest&&sourceAvailable<=targetRequested&&!pathResistance;
  const actualActionConfirmation=receipt.historyCompleteness.split&&economicPathConfirmation&&axis.sourceMarket===input.target.market&&
    exactSupport&&!pathResistance;
  // Fully applied equal endpoint responses are already in this law. Two
  // physical sources can constrain Lean only while resistance is unresolved;
  // counting transported moves again would impose a second model penalty.
  const unresolvedSources=streams.filter(s=>s.status==="observed"&&(
    (s.latestFlowMatched&&s.flowResponse==="held"&&s.boundFlowDirection!==null&&s.boundFlowDirection*sign>0)||
    (s.recentDirection*sign<0&&(axis.status!=="applied"||s.sourceCurrentResolution==="contested"||s.sourceCurrentResolution==="cancelled"||s.flowCurrentResolution==="contested"||s.flowCurrentResolution==="cancelled"))));
  const corroboratedOpposition=new Set(unresolvedSources.map(s=>s.book)).size>=2;
  const modelExpectedValue=base.expectedValue,eligible=base.price!==null&&base.price>=(input.target.market==="moneyline"?-250:-500);
  let grade:CbbProvisionalGrade=base.grade,reason=base.reason,gradeBasis="held_or_non_actionable";
  if(modelExpectedValue!==null){
    // A source's vig-negative implied EV is not a veto on independent value.
    grade=modelExpectedValue<0?"No Play":"Watchlist";
    reason=modelExpectedValue<0?"non_positive_exact_price_value":
      modelExpectedValue<.03?"edge_below_actionable_reserve":
      !eligible?"price_too_steep_for_actionable":
      base.referenceState==="opposes"?"professional_opposition":
      base.referenceState==="neutral"?"professional_reference_neutral":
      base.referenceState==="mixed"?"professional_reference_mixed":"edge_below_actionable_reserve";
    if(modelExpectedValue>=.03&&eligible&&(base.referenceState==="agrees"||base.referenceState==="unavailable"||economicCorroboration)){
      grade="Lean";reason="positive_model_value_without_qualified_action_confirmation";gradeBasis="model_value";
    }
    if(modelExpectedValue>=.08&&eligible&&premiumProfessionalValue&&!pathResistance){
      grade="Best Angle";reason="model_and_material_professional_exact_target_value";gradeBasis="model_and_professional_value";
    }
    if(modelExpectedValue>=.03&&eligible&&economicPathConfirmation&&grade==="Watchlist"&&base.referenceState==="neutral"){
      grade="Lean";reason="qualified_same_market_price_confirmation";gradeBasis="qualified_same_market_price";
    }
    else if(modelExpectedValue>=.08&&eligible&&actualActionConfirmation&&grade==="Lean"){
      grade="Best Angle";reason="verified_same_market_action_with_material_model_value";gradeBasis="verified_same_market_action";
    }
    if(corroboratedOpposition&&(grade==="Lean"||grade==="Best Angle")){
      grade="Watchlist";reason="corroborated_unresolved_source_resistance";gradeBasis="qualified_source_resistance";
    }
  }
  return {...base,release:CBB_MARKET_BEHAVIOR_GRADE_RELEASE,grade,reason,modelExpectedValue,
    professionalTargetEconomics,economicCorroboration,economicPathConfirmation,actualActionConfirmation,marketPressure,pathResistance,gradeBasis,splitRead};
}
