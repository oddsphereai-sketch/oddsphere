import {createHash} from "node:crypto";
import {CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,type CbbMarketAnchors,type CbbBehaviorFlow} from "@/lib/cbb/marketBehaviorCandidate";
import {CBB_CURRENT_SCORE_RELEASE} from "@/lib/cbb/currentScoreRuntime";
import type {CbbProvisionalSnapshot} from "@/lib/cbb/provisionalLifecycle";
import type {CbbForecast,CbbTrainingGame} from "@/lib/cbb/types";
import type {cbbCurrentSplitEvidence} from "@/lib/cbb/owlsSplitEvidence";

export function cbbIndependentInputKey(fixture:{id:number;homeId:number;awayId:number;neutral:boolean|null;season:number},history:CbbTrainingGame[]){
 return createHash("sha256").update(JSON.stringify({release:CBB_CURRENT_SCORE_RELEASE,fixture,history})).digest("hex");
}
/** The independent runtime admits a final six hours after its scheduled start.
 * Replaying an earlier decision must use that decision's genuine availability,
 * rather than submitting newly available results to an older clock. */
export function cbbHistoryAtDecision(history:CbbTrainingGame[],clock:string){
 const cutoff=Date.parse(clock);
 return history.filter(game=>Date.parse(game.date)+6*3600_000<=cutoff);
}
/** Retained original receipts stay exact. Reproducing a previous r3 score
 * attests the runtime/input parity, never news consumption or causality. */
export function cbbOriginalMarketAnchors(previous:CbbProvisionalSnapshot|null,key:string,priorIndependent:CbbForecast|null):CbbMarketAnchors|null{
 if(!previous||previous.lockedAt)return null;
 const stored=previous.board.marketContext.verifiedMarketRead;
 if(stored)return stored.anchors;
 if(previous.board.modelRelease!==CBB_CURRENT_SCORE_RELEASE||!priorIndependent||priorIndependent.release!==CBB_CURRENT_SCORE_RELEASE||
   priorIndependent.gameId!==previous.gameId||priorIndependent.asOf!==previous.board.asOf)return null;
 const score=previous.board.score;
 if([[score.home,priorIndependent.homeScore],[score.away,priorIndependent.awayScore],[score.margin,priorIndependent.margin],
   [score.total,priorIndependent.total],[score.homeWinProbability,priorIndependent.homeWinProbability]].some(([a,b])=>Math.abs(a-b)>1e-8))return null;
 return {release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:previous.gameId,startsAt:previous.startsAt,independentRelease:CBB_CURRENT_SCORE_RELEASE,
  independentInputKey:key,capturedAt:previous.board.asOf,quotes:previous.board.rows.flatMap(row=>row.professionalReferenceQuotes??[])};
}

/** Only the existing independent named-event join may establish source flow.
 * Own-side source lines are converted to the canonical HOME contract once. */
export function cbbBehaviorFlows(evidence:ReturnType<typeof cbbCurrentSplitEvidence>):CbbBehaviorFlow[]{
 const groups=new Map<string,typeof evidence.rows>();
 for(const row of evidence.rows){const key=JSON.stringify([row.market,row.sourceBook,row.observedAt]);groups.set(key,[...(groups.get(key)??[]),row]);}
 return [...groups.values()].flatMap(rows=>{
  const first=rows.filter(row=>row.selection==="first"),second=rows.filter(row=>row.selection==="second");
  if(first.length!==1||second.length!==1||first[0].moneyPct===null||second[0].moneyPct===null||first[0].ticketsPct===null||second[0].ticketsPct===null)return [];
  const a=first[0],b=second[0],line=a.sourceLine;
  if(a.market!=="moneyline"&&(line===null||line!==b.sourceLine))return [];
  return [{provider:"owls" as const,gameId:a.gameId,sourceBook:a.sourceBook,market:a.market,line,
   firstMoney:a.moneyPct!,secondMoney:b.moneyPct!,firstTickets:a.ticketsPct!,secondTickets:b.ticketsPct!,observedAt:a.observedAt,
   fetchedAt:a.fetchedAt,orientationVerified:a.orientationVerified&&b.orientationVerified,sourceEventId:a.sourceEventId,
   sourceIdentity:"independent_named_fixture_join" as const}];
 });
}
