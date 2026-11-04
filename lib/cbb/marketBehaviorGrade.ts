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
      gradeBasis:"held_or_non_actionable",splitRead:[],contextualResistance:false,contrarianSupport:false};
  }
  const quarantined=new Set([...(receipt.anchors.quarantinedKeys??[]),...(receipt.withheldCurrentSources??[]).map(q=>`${cbbBookFamily(q.book)}:${q.market}`)]);
  const references=receipt.currentProfessionalQuotes.filter(q=>receiptAvailableAtDecision(q,at)&&!quarantined.has(`${cbbBookFamily(q.sportsbook)}:${q.market}`)&&
    !receipt.excludedFamilies.includes(cbbBookFamily(q.sportsbook))&&(q as CbbQuote&{orientationVerified?:boolean}).orientationVerified===true);
  const base=gradeCbbProvisional({...input,references},{quoteValidator:receivedQuoteValid});
  if(base.grade==="Held")return {...base,release:CBB_MARKET_BEHAVIOR_GRADE_RELEASE,
    modelExpectedValue:null,professionalTargetEconomics:[] as CbbProfessionalTargetEconomics[],economicCorroboration:false,
    economicPathConfirmation:false,actualActionConfirmation:false,marketPressure:"unavailable" as const,pathResistance:false,
    gradeBasis:"held_or_non_actionable",splitRead:[],contextualResistance:false,contrarianSupport:false};
  const professionalTargetEconomics=cbbProfessionalTargetEconomics(input,base.professionalReferenceQuotes);
  const economicCorroboration=professionalTargetEconomics.some(q=>q.expectedValue>1e-7)&&professionalTargetEconomics.every(q=>q.expectedValue>=-1e-7);
  const premiumProfessionalValue=professionalTargetEconomics.some(q=>q.expectedValue>=.08)&&
    professionalTargetEconomics.every(q=>q.expectedValue>=-1e-7);
  const selected=reviewCbbQuote(input.forecast,input.target).selection,sign=selected==="first"?1:-1;
  const splitRead=readCbbDecisionSplits(receipt.splitContext??[],input.target.market,input.target.line,selected as "first"|"second");
  const sameAxis=(market:CbbQuote["market"])=>input.target.market==="total"?market==="total":market!=="total";
  const pressure=(receipt.pressureDecisions??[]).filter(row=>sameAxis(row.market)&&row.reaction!=="unbound"&&row.moneyDirection!==null&&row.moneyDirection!==0);
  const streams=receipt.pathPosture.filter(s=>sameAxis(s.market)&&
    !receipt.excludedFamilies.includes(s.book)&&!quarantined.has(`${s.book}:${s.market}`));
  // A retained response has its original bound native clock even when a
  // later identical read is honestly still unmatched. Its existing tier
  // consequences must not disappear solely because collection repeated.
  const responseBound=(s:typeof streams[number])=>s.latestFlowMatched||
    s.pressureObservedAt!==null&&s.flowResponse!==null&&s.boundFlowDirection!==null;
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
    ["applied","confirming"].includes(axis.status)&&["ongoing","resumed","reversed"].includes(s.sourceCurrentResolution)&&
    s.sourceUnresolvedDirection===s.recentDirection&&receipt.episodes.some(e=>e.book===s.book&&e.market===s.market&&
      (axis.authority?.authorIds.includes(`${e.book}:${e.market}`)??(e.book===axis.sourceBook&&e.market===axis.sourceMarket)));
  const freshAdverse=adverseSources.some(s=>!fullyAppliedPriceResponse(s));
  // A named source's concentration is context even without matched response;
  // it cannot become invented score points or exact-target action confirmation.
  const unmatchedCircaOpposition=streams.some(s=>s.book==="circa"&&!responseBound(s)&&s.flowConcentrationDirection*sign<0);
  // Response is relative to source money, not to this pick. A book resisting
  // opposite-side money can support the pick; only pick-adverse residuals or
  // pressure toward the pick that the source actually held are resistance.
  const matchedFlowResistance=streams.some(s=>responseBound(s)&&s.boundFlowDirection!==null&&s.boundFlowDirection!==0&&(
    (s.flowReactionDirection!==null&&s.flowReactionDirection*sign<0)||
    (s.flowResponse==="held"&&s.boundFlowDirection!==null&&s.boundFlowDirection*sign>0)));
  const pathConflict=axis.crossMarketDisagreement===true||["conflicting","unresolved"].includes(axis.status)||streams.some(s=>s.status==="conflicting"||s.flowCurrentResolution==="contested"||s.sourceCurrentResolution==="contested");
  const historyIncomplete=!receipt.historyCompleteness.price;
  const professionalPressure=pressure.filter(row=>row.sourceClass==="professional_adjacent_named_book"&&!receipt.excludedFamilies.includes(row.book));
  const nativeResistance=professionalPressure.some(row=>row.resolution==="contested"||row.moneyDirection===sign&&row.reactionDirection!==sign||
    row.moneyDirection===-sign&&row.reactionDirection===-sign);
  const contrarianSupport=professionalPressure.some(row=>row.moneyDirection===-sign&&row.resolution==="held");
  const retailResistance=pressure.some(row=>row.sourceClass!=="professional_adjacent_named_book"&&
    (row.resolution==="contested"||row.moneyDirection===sign&&row.reactionDirection!==sign||row.moneyDirection===-sign&&row.reactionDirection===-sign));
  const laterProfessionalSupport=professionalPressure.some(row=>row.reactionDirection===sign&&row.latestDirection===sign&&["ongoing","resumed","reversed"].includes(row.resolution)&&
    pressure.filter(other=>other.sourceClass!=="professional_adjacent_named_book"&&other.current).every(other=>
      Date.parse(row.current!.providerObservedAt)>Date.parse(other.current!.providerObservedAt)));
  const contextualResistance=retailResistance&&!laterProfessionalSupport;
  const pathResistance=historyIncomplete||freshAdverse||unmatchedCircaOpposition||matchedFlowResistance||opposition.length>0||pathConflict||nativeResistance||contextualResistance;
  // The flow's exact NATIVE contract is already qualified. The executable
  // target is repriced through the same CBB law; it need not copy that line.
  const authorIds=axis.authority?.authorIds??[`${axis.sourceBook}:${axis.sourceMarket}`];
  const targetRequested=Date.parse((input.target as CbbQuote&{requestedAt?:string}).requestedAt??"");
  const validTargetRequest=Number.isFinite(targetRequested)&&targetRequested<=Date.parse(input.target.fetchedAt);
  const priceConfirmations=streams.filter(source=>authorIds.includes(`${source.book}:${source.market}`)&&sameAxis(source.market)&&
    receipt.episodes.some(e=>e.book===source.book&&e.market===source.market&&e.delta*sign>1e-7)&&source.recentDirection===sign&&
    Number.isFinite(Date.parse(source.frontierAvailableBy??""))&&validTargetRequest&&Date.parse(source.frontierAvailableBy!)<=targetRequested);
  const economicPathConfirmation=["applied","confirming"].includes(axis.status)&&priceConfirmations.length>0&&!pathResistance;
  const ownSourceActions=professionalPressure.filter(row=>row.moneyDirection===sign&&row.reactionDirection===sign&&row.latestDirection===sign&&
    ["ongoing","resumed","reversed"].includes(row.resolution)&&
    row.current&&validTargetRequest&&Date.parse(row.availableBy)<=targetRequested&&cbbEvidenceAvailableAt(row.current)<=targetRequested);
  const legacyActionSources=priceConfirmations.filter(source=>support.some(s=>s.book===source.book&&s.market===source.market));
  const actualActionConfirmation=receipt.historyCompleteness.split&&!pathResistance&&["applied","confirming"].includes(axis.status)&&
    (economicPathConfirmation&&legacyActionSources.length>0||ownSourceActions.length>0);
  const actionAtTargetMarket=legacyActionSources.some(source=>source.market===input.target.market)||ownSourceActions.some(source=>source.market===input.target.market);
  // Fully applied equal endpoint responses are already in this law. Two
  // physical sources can constrain Lean only while resistance is unresolved;
  // counting transported moves again would impose a second model penalty.
  const unresolvedSources=streams.filter(s=>s.status==="observed"&&(
    (responseBound(s)&&s.flowResponse==="held"&&s.boundFlowDirection!==null&&s.boundFlowDirection*sign>0)||
    (s.recentDirection*sign<0&&!fullyAppliedPriceResponse(s))));
  const corroboratedOpposition=new Set(unresolvedSources.map(s=>s.book)).size>=2;
  // Moneyline risk is already expressed in its executable payout and the
  // resulting EV. A second -250 cutoff must not veto genuinely positive
  // value or qualified market support. Keep the existing non-ML contract rule.
  const modelExpectedValue=base.expectedValue,eligible=base.price!==null&&
    (input.target.market==="moneyline"||base.price>=-500);
  let grade:CbbProvisionalGrade=base.grade,reason=base.reason,gradeBasis="held_or_non_actionable";
  if(modelExpectedValue!==null){
    // A source's vig-negative implied EV is not a veto on independent value.
    // Match the product's informational Watchlist lane: a complete priced
    // forecast remains readable even when its selected price is not a bet.
    // Positive-value/action requirements below remain unchanged. Held data
    // stays held; this must never turn missing analysis into a Watchlist.
    grade="Watchlist";
    gradeBasis=modelExpectedValue<0?"forecast_monitoring":"held_or_non_actionable";
    reason=modelExpectedValue<0?"forecast_available_price_not_actionable":
      modelExpectedValue<.03?"edge_below_actionable_reserve":
      !eligible?"price_too_steep_for_actionable":
      base.referenceState==="opposes"?"professional_opposition":
      base.referenceState==="neutral"?"professional_reference_neutral":
      base.referenceState==="mixed"?"professional_reference_mixed":"edge_below_actionable_reserve";
    if(modelExpectedValue>=.03&&eligible&&(base.referenceState==="agrees"||base.referenceState==="unavailable"||economicCorroboration)){
      grade="Lean";reason="positive_model_value_without_qualified_action_confirmation";gradeBasis="model_value";
    }
    if(modelExpectedValue>=.03&&eligible&&contrarianSupport&&!pathResistance&&grade==="Watchlist"){
      grade="Lean";reason="opposite_source_money_met_by_held_quote";gradeBasis="qualified_contrarian_response";
    }
    if(modelExpectedValue>=.08&&eligible&&premiumProfessionalValue&&!pathResistance){
      grade="Best Angle";reason="model_and_material_professional_exact_target_value";gradeBasis="model_and_professional_value";
    }
    if(modelExpectedValue>=.03&&eligible&&economicPathConfirmation&&grade==="Watchlist"&&base.referenceState==="neutral"){
      grade="Lean";reason="qualified_same_market_price_confirmation";gradeBasis="qualified_same_market_price";
    }
    if(modelExpectedValue>=.08&&eligible&&actualActionConfirmation&&grade==="Lean"){
      grade="Best Angle";reason=actionAtTargetMarket?"verified_same_market_action_with_material_model_value":"verified_margin_axis_action_with_material_model_value";
      gradeBasis=actionAtTargetMarket?"verified_same_market_action":"verified_translated_margin_action";
    }
    if(pathResistance&&grade==="Best Angle"){
      grade="Lean";reason="unresolved_current_market_resistance";gradeBasis="qualified_source_resistance";
    }
    if(corroboratedOpposition&&(grade==="Lean"||grade==="Best Angle")){
      grade="Watchlist";reason="corroborated_unresolved_source_resistance";gradeBasis="qualified_source_resistance";
    }
  }
  return {...base,release:CBB_MARKET_BEHAVIOR_GRADE_RELEASE,grade,reason,modelExpectedValue,
    professionalTargetEconomics,economicCorroboration,economicPathConfirmation,actualActionConfirmation,
    marketPressure:actualActionConfirmation&&marketPressure==="unavailable"?"supports" as const:marketPressure,pathResistance,gradeBasis,splitRead,
    contextualResistance,contrarianSupport};
}
