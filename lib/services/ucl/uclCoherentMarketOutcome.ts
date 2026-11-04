import type {SoccerFixtureEventIdentity} from "@/lib/providers/real_api/SharpApiEplMarketProvider";
import type {EplCoherentMarketOutcome} from "@/lib/services/epl/eplCoherentMarketOutcome";
import type {EplForwardBookVector} from "@/lib/services/epl/eplForwardEvidenceCapture";
import type {BdlUclOdds} from "@/lib/providers/real_api/BallDontLieUclProvider";
import type {EplStoredPriceObservation} from "@/lib/services/epl/buildEplDailyEdgePreview";
import {bivariatePoissonScoreDistribution,medianTotalFromDistribution,mostLikelyTotalFromDistribution,type ScoreDistribution} from "@/lib/services/soccer/dixonColes";
import {deriveSoccerMarketProbabilities} from "@/lib/services/soccer/soccerMarketProbabilities";
import {deriveUclRelativeMarketRead,type UclRelativeMarketReadReceipt} from "./uclRelativeMarketRead";
export const UCL_COHERENT_MARKET_OUTCOME_RELEASE =
  "ucl_coherent_market_outcome_2026_11_04_r13_unfrozen_score_law" as const;

type Side="home"|"draw"|"away";
const SIDES=["home","draw","away"] as const;
function resultSide(home:number,away:number):Side{return home>away?"home":home<away?"away":"draw";}
function leader(vector:Record<Side,number>):Side{return SIDES.reduce((best,side)=>vector[side]>vector[best]?side:best,"home");}
function summarize(joint: ScoreDistribution, markets: ReturnType<typeof deriveSoccerMarketProbabilities>) {
  let expectedHome = 0;
  let expectedAway = 0;
  let likelyScore = { home: 0, away: 0, probability: joint[0]![0]! };
  const forecastResult = leader(markets.match_result);
  const forecastTotal = markets.total.over >= markets.total.under ? "over" : "under";
  const forecastBtts = markets.btts.yes >= markets.btts.no ? "yes" : "no";
  let representativeScore: EplCoherentMarketOutcome["representativeScore"] = null;
  for (let home = 0; home < joint.length; home += 1) {
    for (let away = 0; away < joint[home]!.length; away += 1) {
      const probability = joint[home]![away]!;
      expectedHome += home * probability;
      expectedAway += away * probability;
      if (probability > likelyScore.probability) likelyScore = { home, away, probability };
      const totalMatches = forecastTotal === "over" ? home + away > 2.5 : home + away < 2.5;
      const bttsMatches = forecastBtts === "yes" ? home > 0 && away > 0 : home === 0 || away === 0;
      if (resultSide(home, away) === forecastResult && totalMatches && bttsMatches
        && (!representativeScore || probability > representativeScore.probability)) {
        representativeScore = { home, away, probability };
      }
    }
  }
  return { expectedGoals: { home: expectedHome, away: expectedAway }, likelyScore, representativeScore };
}

export type UclCoherentMarketOutcome=EplCoherentMarketOutcome & {audit:EplCoherentMarketOutcome["audit"] & {goalsReader:NonNullable<EplCoherentMarketOutcome["audit"]["goalsReader"]> & {
 relativeMarketReader:UclRelativeMarketReadReceipt;
 nativeGoalMarketRead:{method:"relative_same_book_paths";totalApplied:boolean;bttsApplied:boolean;converged:boolean;residual:number;reason:string;before:{home:number;away:number};after:{home:number;away:number};matchResultBefore:Record<Side,number>;matchResultAfter:Record<Side,number>};
}}};
export function deriveUclCoherentMarketOutcome(input:{matchId?:number;independentLambdaHome:number;independentLambdaAway:number;independentJoint?:ScoreDistribution;openingOdds?:BdlUclOdds[];matchResultVectors?:EplForwardBookVector[];totalVectors:EplForwardBookVector[];bttsVectors?:EplForwardBookVector[];storedPriceHistory?:EplStoredPriceObservation[];modelEvidenceQuality?:"thin"|"standard";evaluatedMatchResultCanonicalBook:string|null;evaluatedTotalCanonicalBook:string|null;evaluatedBttsCanonicalBook:string|null;fixtureEventIdentities?:SoccerFixtureEventIdentity[];providerEventId:string|null;decisionAt:string;kickoff:string;}):UclCoherentMarketOutcome{
 const original=input.independentJoint??bivariatePoissonScoreDistribution(input.independentLambdaHome,input.independentLambdaAway,-.1);
 const read=deriveUclRelativeMarketRead(original,input),joint=read.joint,markets=read.receipt.finalProbabilities;
 const axes=read.receipt.markets,totalApplied=axes.total.status==="applied",bttsApplied=axes.btts.status==="applied",mrApplied=axes.match_result.status==="applied";
 const inactive=Object.values(axes).flatMap(axis=>axis.inactive).concat((input.openingOdds??[]).map(row=>({identity:`opening_1x2:${row.vendor}:${row.id}`,reason:"unpaired_opening_rows_not_relative_path_authority"})));
 const pathMovement=(market:"total"|"btts")=>{const axis=axes[market],p=axis.selected;
  return{books:p?.baseline?1:0,delta:p?.baseline&&(market!=="total"||p.baseline.line===p.current.line)?p.current.probabilities[market==="total"?"over":"yes"]!-p.baseline.probabilities[market==="total"?"over":"yes"]!:null,
   side:axis.direction==="over"||axis.direction==="under"||axis.direction==="yes"||axis.direction==="no"?axis.direction:axis.direction==="flat"?"stable" as const:null};};
 return{release:UCL_COHERENT_MARKET_OUTCOME_RELEASE,source:totalApplied||bttsApplied||mrApplied?"relative_same_book_market_paths":"independent_club_pmf",
 joint,markets,...summarize(joint,markets),medianTotal:medianTotalFromDistribution(joint),mostLikelyTotal:mostLikelyTotalFromDistribution(joint),
 audit:{evaluatedCanonicalBooksExcluded:[],eligibleAlternativeBooks:axes.match_result.candidates.filter(p=>p.independentOfExecutionBook).map(p=>p.book),eligibleAlternativeSources:[],
 correlationState:"correlated_or_indeterminate",movementRole:"relative_same_book_price_paths",evaluatedQuoteRole:"paired_path_evidence_and_execution_economics",
 inactiveVectors:inactive,targetOverProbability:null,totalProbabilityResidual:read.receipt.residual,maximumMatchResultResidual:mrApplied?read.receipt.residual:0,gateReasons:[],
 matchResultReader:{consensus:null,consensusLeader:axes.match_result.currentTargetProbabilities.home!==undefined?leader(axes.match_result.currentTargetProbabilities as Record<Side,number>):null,eligibleBooks:axes.match_result.candidates.map(p=>p.book),agreement:0,dispersion:0,authority:0},
 goalsReader:{totalConsensus:null,bttsConsensus:null,crossMarketBttsYes:totalApplied?markets.btts.yes:null,totalEligibleBooks:axes.total.candidates.filter(p=>p.baseline).map(p=>p.book),bttsEligibleBooks:axes.btts.candidates.filter(p=>p.baseline).map(p=>p.book),
 totalMovement:pathMovement("total") as NonNullable<EplCoherentMarketOutcome["audit"]["goalsReader"]>["totalMovement"],bttsMovement:pathMovement("btts") as NonNullable<EplCoherentMarketOutcome["audit"]["goalsReader"]>["bttsMovement"],totalCorrectionApplied:totalApplied,bttsCorrectionApplied:bttsApplied,modelEvidenceQuality:input.modelEvidenceQuality??"standard",
 relativeMarketReader:read.receipt,nativeGoalMarketRead:{method:"relative_same_book_paths",totalApplied,bttsApplied,converged:read.receipt.converged,residual:read.receipt.residual,reason:read.receipt.reason,before:read.receipt.originalMeans,after:read.receipt.finalMeans,matchResultBefore:read.receipt.originalProbabilities.match_result,matchResultAfter:markets.match_result}}}};
}
