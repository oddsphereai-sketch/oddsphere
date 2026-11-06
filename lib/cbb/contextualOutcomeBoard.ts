/** Pure publication shape for an already evaluated one-law decision.
 * This module never forecasts, prices, grades, selects an execution target, or
 * advances a lock. The caller keeps cross/newcomer no-wager policy outside it. */
import {CBB_OUTCOME_DECISION_RELEASE,cbbOutcomeIndependentInputSha256,type forecastCbbOutcomeDecision} from "./contextualOutcomeDecision";
import type {CbbForecast,CbbMarket} from "./types";
import {CBB_CONTEXTUAL_RECOMMENDATION_RISK_RELEASE,assessCbbOutcomeConfidenceRisk} from "./contextualRecommendationRisk";
import {assessConfidenceLeanPrice} from "../services/dailyEdge/confidenceLeanPrice";

export const CBB_CONTEXTUAL_OUTCOME_BOARD_RELEASE="cbb_contextual_outcome_board_2026_11_05_r1_copy_only" as const;
export const CBB_CONTEXTUAL_OUTCOME_BOARD_GRADE_RELEASE="cbb_contextual_outcome_grade_2026_11_06_r11_current_contract_resistance" as const;
export const CBB_CONTEXTUAL_OUTCOME_CONFIDENCE_GRADE_RELEASE="cbb_contextual_outcome_grade_2026_11_06_r10_confidence_led_lean" as const;
export const CBB_CONTEXTUAL_OUTCOME_CONFIDENCE_DECISION_RELEASE="cbb_outcome_decision_2026_11_06_r11_confidence_led_lean" as const;
export const CBB_CONTEXTUAL_OUTCOME_PREVIOUS_GRADE_RELEASE="cbb_contextual_outcome_grade_2026_11_06_r9_economic_total_retained_margin" as const;
export const CBB_CONTEXTUAL_OUTCOME_PREVIOUS_DECISION_RELEASE="cbb_outcome_decision_2026_11_06_r10_economic_total_retained_margin" as const;
export const CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_GRADE_RELEASE="cbb_contextual_outcome_grade_2026_11_05_r7_contextual_recommendation_risk" as const;
export const CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_DECISION_RELEASE="cbb_outcome_decision_2026_11_05_r8_contextual_recommendation_risk" as const;
export const CBB_CONTEXTUAL_OUTCOME_LEGACY_GRADE_RELEASE="cbb_contextual_outcome_grade_2026_11_05_r6_noplay_price_lanes" as const;
export const CBB_CONTEXTUAL_OUTCOME_LEGACY_DECISION_RELEASE="cbb_outcome_decision_2026_11_05_r7_noplay_price_lanes" as const;
export const CBB_CONTEXTUAL_OUTCOME_GAME_RELEASE="cbb_contextual_game_outcome_2026_11_05_r1_stored_joint_law" as const;
type CurrentOutcomeDecision=ReturnType<typeof forecastCbbOutcomeDecision>;
export type CbbOutcomeDecision=Omit<CurrentOutcomeDecision,"release">&{release:CurrentOutcomeDecision["release"]|typeof CBB_CONTEXTUAL_OUTCOME_CONFIDENCE_DECISION_RELEASE|typeof CBB_CONTEXTUAL_OUTCOME_PREVIOUS_DECISION_RELEASE|typeof CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_DECISION_RELEASE|typeof CBB_CONTEXTUAL_OUTCOME_LEGACY_DECISION_RELEASE};
export function cbbOutcomeGradeReleaseForDecision(release:CbbOutcomeDecision["release"]){return release===CBB_OUTCOME_DECISION_RELEASE?CBB_CONTEXTUAL_OUTCOME_BOARD_GRADE_RELEASE:release===CBB_CONTEXTUAL_OUTCOME_CONFIDENCE_DECISION_RELEASE?CBB_CONTEXTUAL_OUTCOME_CONFIDENCE_GRADE_RELEASE:release===CBB_CONTEXTUAL_OUTCOME_PREVIOUS_DECISION_RELEASE?CBB_CONTEXTUAL_OUTCOME_PREVIOUS_GRADE_RELEASE:release===CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_DECISION_RELEASE?CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_GRADE_RELEASE:CBB_CONTEXTUAL_OUTCOME_LEGACY_GRADE_RELEASE;}
const MARKETS:readonly CbbMarket[]=["moneyline","spread","total"];
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const validProbability=(v:unknown):v is number=>finite(v)&&v>=0&&v<=1;
const sameFields=(a:object,b:object)=>Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([k,v])=>v===(b as Record<string,unknown>)[k]);

/** Ancillary display state, not a vote or a grading rule. Copy the underlying
 * source economics too, including opposing references in an actionable row. */
function referenceState(row:CbbOutcomeDecision["marketDecisions"][number]){
 const values=(row.sourceEconomics??[]).map(r=>r.reference.targetExpectedValue).filter(finite);
 if(!values.length)return "unavailable" as const;
 const positive=values.some(v=>v>0),negative=values.some(v=>v<0);
 return positive&&negative?"mixed" as const:positive?"agrees" as const:negative?"opposes" as const:"neutral" as const;
}

export function buildCbbContextualOutcomeBoard(args:{decision:CbbOutcomeDecision;independent:CbbForecast}){
 const {decision,independent}=args,asOf=Date.parse(decision.asOf),priorAt=Date.parse(independent.asOf);
 if(![CBB_OUTCOME_DECISION_RELEASE,CBB_CONTEXTUAL_OUTCOME_CONFIDENCE_DECISION_RELEASE,CBB_CONTEXTUAL_OUTCOME_PREVIOUS_DECISION_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_DECISION_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_DECISION_RELEASE].includes(decision.release)||decision.authority!=="offline_research_only"||
  !["future","retrospective_development"].includes(decision.mode)||!Number.isSafeInteger(decision.gameId)||decision.gameId<=0||
  independent.gameId!==decision.gameId||independent.inputStatus!=="complete"||!Number.isSafeInteger(independent.homeId)||
  !Number.isSafeInteger(independent.awayId)||independent.homeId<=0||independent.awayId<=0||independent.homeId===independent.awayId||
  decision.fixtureIdentity?.homeId!==independent.homeId||decision.fixtureIdentity?.awayId!==independent.awayId||
  !finite(asOf)||!finite(priorAt)||priorAt>asOf||decision.independentInputSha256!==cbbOutcomeIndependentInputSha256(independent)||
  decision.interpretation.gameId!==decision.gameId||decision.interpretation.asOf!==decision.asOf)
  throw Error("CBB outcome board decision/original independent identity mismatch");
 const score=decision.finalScore,u=decision.finalUncertainty;
 if(![score.home,score.away,score.margin,score.total].every(finite)||score.home<0||score.away<0||
  Math.abs(score.home-score.away-score.margin)>1e-8||Math.abs(score.home+score.away-score.total)>1e-8||
  !validProbability(score.homeWinProbability)||![u.marginSd,u.totalSd,u.marginTotalCorrelation].every(finite)||u.marginSd<=0||u.totalSd<=0||Math.abs(u.marginTotalCorrelation)>1||
  !["first","second"].includes(decision.gameOutcome.selection)||!validProbability(decision.gameOutcome.probability)||
  decision.gameOutcome.selection!==(score.homeWinProbability>=.5?"first":"second")||Math.abs(decision.gameOutcome.probability-(decision.gameOutcome.selection==="first"?score.homeWinProbability:1-score.homeWinProbability))>1e-12)
  throw Error("CBB outcome board requires a complete coherent stored score law");
 if(decision.marketDecisions.length!==3||new Set(decision.marketDecisions.map(r=>r.market)).size!==3||MARKETS.some(m=>!decision.marketDecisions.some(r=>r.market===m)))
  throw Error("CBB outcome board requires all three stored market decisions");
 const copied=structuredClone(decision),rows=MARKETS.map(market=>{
  const row=copied.marketDecisions.find(r=>r.market===market)!;
  if(row.target&&(row.target.gameId!==decision.gameId||row.target.market!==market))throw Error("CBB outcome board target identity mismatch");
  if(!["Held","No Play","Watchlist","Lean","Best Angle"].includes(row.grade)||(row.grade==="Held")!==(row.selection===null))throw Error("CBB outcome board stored grade/selection mismatch");
  if(row.selection!==null&&(!row.target||!["first","second"].includes(row.selection)||!validProbability(row.probability)||!validProbability(row.pushProbability)||!validProbability(row.loseProbability)||!finite(row.price)||!finite(row.expectedValue)))
   throw Error("CBB outcome board selected market lacks stored economics");
  if(row.grade==="Held"&&(row.selection!==null||row.probability!==null||row.pushProbability!==null||row.loseProbability!==null||row.price!==null||row.expectedValue!==null))
   throw Error("CBB outcome board Held decision has wager economics");
  const confidenceLean=(decision.release===CBB_OUTCOME_DECISION_RELEASE||decision.release===CBB_CONTEXTUAL_OUTCOME_CONFIDENCE_DECISION_RELEASE)&&row.grade==="Lean"&&row.recommendationBasis==="outcome_confidence"&&
   row.confidenceLeanAssessment?.supported===true&&row.confidenceLeanAssessment.price.qualified&&row.confidenceLeanAssessment.risk?.supported===true;
  if(confidenceLean){
   const priceProof=assessConfidenceLeanPrice({winProbability:row.probability!,loseProbability:row.loseProbability!,price:row.price!,
    opposingPrice:row.selection==="first"?row.target!.secondPrice:row.target!.firstPrice,
    minimumWinProbability:.55,probabilityErrorEstimate:row.gradingNumerics?.probabilityErrorEstimate});
   const riskProof=row.recommendationRisk&&assessCbbOutcomeConfidenceRisk({risk:row.recommendationRisk,winProbability:row.probability!,loseProbability:row.loseProbability!});
   if(!priceProof.qualified||!riskProof?.supported||!sameFields(priceProof,row.confidenceLeanAssessment!.price)||
    !sameFields(riskProof,row.confidenceLeanAssessment!.risk!))throw Error("CBB confidence Lean assessment differs from the stored outcome and paired quote");
  }
  if(decision.release!==CBB_CONTEXTUAL_OUTCOME_LEGACY_DECISION_RELEASE&&(row.grade==="Lean"||row.grade==="Best Angle"||row.gradingNumerics?.valueSignResolvedPositive)&&
   (!row.recommendationRisk||row.recommendationRisk.release!==CBB_CONTEXTUAL_RECOMMENDATION_RISK_RELEASE||row.recommendationRisk.assessmentTier!=="lean"||
    row.recommendationRisk.nominalExpectedValue!==row.expectedValue||
    ((row.grade==="Lean"||row.grade==="Best Angle")&&!row.recommendationRisk.supported&&!confidenceLean)||
    row.grade==="Best Angle"&&(!row.recommendationRisk.bestAngleAssessment?.supported||row.recommendationRisk.bestAngleAssessment.assessmentTier!=="best"||
     row.recommendationRisk.bestAngleAssessment.release!==CBB_CONTEXTUAL_RECOMMENDATION_RISK_RELEASE)))
   throw Error("CBB outcome board recommendation lacks its declared risk assessment");
  const selected=row.selection!==null,target=selected?row.target:null,informationalNonActionablePrice=row.grade==="Watchlist"||row.grade==="No Play";
  return {...row,targetBook:row.target?.sportsbook??null,line:target?.line??null,
   observedQuote:target?{firstPrice:target.firstPrice,secondPrice:target.secondPrice,line:target.line}:null,
   quoteObservedAt:target?.providerObservedAt??null,quoteProvider:target?.provider??null,
   marketFairProbability:row.marketFairProbability??null,modelExpectedValue:row.expectedValue,
   professionalReferences:row.sourceEconomics?.length??0,professionalReferenceQuotes:(row.sourceEconomics??[]).map(r=>r.source),
   referenceState:referenceState(row),economicCorroboration:row.positiveProfessionalValue??false,
   actualActionConfirmation:row.observedProfessionalBookPriceConfirmation??false,
   pathResistance:(row.counterevidence?.opposingPaths.length??0)>0,
   gradeBasis:"stored_contextual_joint_law_decision" as const,
   informationalNonActionablePrice,rawConfidence:row.probability,
   recommendationConfidenceProbability:row.grade==="Held"||informationalNonActionablePrice?null:row.probability,
   reviewFlags:informationalNonActionablePrice?["informational_non_actionable_price"]:[]};
 });
 const targetBooks=[...new Set(rows.filter(r=>r.selection!==null).map(r=>r.targetBook))];
 return {release:CBB_CONTEXTUAL_OUTCOME_BOARD_RELEASE,authority:decision.authority,mode:decision.mode,
  modelRelease:decision.artifact.release,decisionRelease:decision.release,gradeRelease:cbbOutcomeGradeReleaseForDecision(decision.release),
  gameId:decision.gameId,asOf:decision.asOf,targetBook:targetBooks.length===1?targetBooks[0]:null,
  score:structuredClone(score),rows,
  gameForecast:{release:CBB_CONTEXTUAL_OUTCOME_GAME_RELEASE,homeId:independent.homeId,awayId:independent.awayId,
   homeWinProbability:score.homeWinProbability,...structuredClone(decision.gameOutcome),uncertainty:structuredClone(u),
   law:structuredClone(decision.numericalTrace),inputs:{independentRelease:independent.release,independentInputSha256:decision.independentInputSha256,artifact:structuredClone(decision.artifact)}},
  marketContext:{predictionReader:"contextual_outcome_one_law" as const,verifiedMarketRead:null,retainedLevelInput:null,
   contextualOutcomeDecision:copied,originalIndependent:structuredClone(independent),
   professionalPriceReferences:rows.reduce((n,r)=>n+r.professionalReferences,0),
   missing:[...new Set(decision.interpretation.streams.flatMap(s=>s.unknowns.map(reason=>`${s.book}:${s.market}:${reason}`)))],
   provenance:decision.release===CBB_OUTCOME_DECISION_RELEASE?"Scores, exact-price probabilities/pushes/EV, selections and resistance-qualified grades copy one stored contextual decision. This mapper never reforecasts or regrades. Raw cumulative shares are not bettor identity or new-money volume.":"Scores, exact-price probabilities/pushes/EV, market selections and grades copy one stored contextual decision. Ancillary references never reforecast or regrade. Raw cumulative shares are not bettor identity or new-money volume.",
   publicationPolicy:"Caller preserves cross-division/newcomer no-wager coverage, authoritative execution targets, prelock eligibility and exact locked-reader precedence. This pure mapper neither activates nor writes a model."}};
}
export type CbbContextualOutcomeBoard=ReturnType<typeof buildCbbContextualOutcomeBoard>;
