/** Recommendation policy after the final law, never a forecast adjustment.
 * A negative reference alone cannot veto a confidence Lean. Require the same
 * professional book's current, ordered price response against the selection,
 * aligned opposing composition, and negative economics at the exact contract.
 * Cross-line shape transfers, stale paths and cumulative shares alone do not
 * establish this qualification. This is owner-directed caution, not a fitted
 * accuracy claim or an identification of sharp bettors/new money. */
import type {CbbContextualMarketInterpretation} from "./contextualMarketInterpretation";
import type {createCbbJointSourceReferencePricer} from "./contextualSourceReferenceResearch";
import {cbbPathBookFamily} from "./marketBehaviorPath";
import type {CbbQuote} from "./types";

export const CBB_MARKET_RESISTANCE_GRADE_RELEASE="cbb_market_resistance_grade_2026_11_06_r1_current_contract" as const;
type Grade="Best Angle"|"Lean"|"Watchlist"|"No Play";
type SourceEconomics={book:string;source:CbbQuote;reference:ReturnType<ReturnType<typeof createCbbJointSourceReferencePricer>["evaluate"]>};
export function assessCbbMarketResistance(args:{asOf:string;interpretation:CbbContextualMarketInterpretation;
 target:CbbQuote;selection:"first"|"second";baseGrade:Grade;sourceEconomics:readonly SourceEconomics[]}){
 const {target,selection,baseGrade}=args,at=Date.parse(args.asOf),direction=selection==="first"?1:-1;
 const family=(book:string)=>cbbPathBookFamily(book.trim().toLowerCase());
 const evidence=args.interpretation.streams.filter(s=>s.role==="professional"&&s.market===target.market&&family(s.book)!==family(target.sportsbook)).flatMap(s=>{
  const economic=args.sourceEconomics.find(x=>family(x.book)===family(s.book)&&x.source.market===target.market&&x.reference.status==="direct");
  if(!economic||!s.currentQuote)return [];
  const {source,reference}=economic,value=reference.directTargetResolvedBetExpectedValue;
  // Direct references identify the offered contract without an assumed shape.
  // Bound arithmetic roundoff, not a hand-set percentage value reserve.
  const selectedPrice=selection==="first"?target.firstPrice:target.secondPrice;
  const payout=selectedPrice>0?selectedPrice/100:100/-selectedPrice;
  const rounding=64*Number.EPSILON*(payout+Math.abs(value??0)+1);
  if(value===null||!Number.isFinite(value)||value>=-rounding||reference.targetValueSign!=="negative"||
   source.gameId!==target.gameId||source.line!==target.line||source.phase!=="current"||
   !Number.isFinite(at)||!Number.isFinite(Date.parse(source.providerObservedAt))||at-Date.parse(source.providerObservedAt)>3_600_000||Date.parse(source.providerObservedAt)>at)return [];
  return s.pressureResponses.filter(r=>r.activeCurrent&&r.hadActualMove&&r.continuity!=="conflict"&&
   r.net?.direction===-direction&&r.latest?.direction===-direction&&r.relation==="toward_composition"&&
   r.pressure.moneyBalance!==null&&Math.sign(r.pressure.moneyBalance)===-direction&&r.response&&
   r.response.nativeAt===s.currentQuote!.nativeAt&&r.response.availableBy===s.currentQuote!.availableBy&&
   r.response.provider===s.currentQuote!.provider&&r.response.eventId===s.currentQuote!.eventId&&
   r.response.nativeAt===source.providerObservedAt&&r.response.line===source.line&&
   r.response.firstPrice===source.firstPrice&&r.response.secondPrice===source.secondPrice&&
   Date.parse(r.response.availableBy)<=at&&Date.parse(r.pressure.availableBy)<=at).slice(-1).map(r=>({
    book:s.book,market:s.market,continuity:r.continuity,pressureNativeAt:r.pressure.nativeAt,
    responseNativeAt:r.response!.nativeAt,responseAvailableBy:r.response!.availableBy,
    sourceObservedAt:source.providerObservedAt,sourceExpectedValue:value,
    netDirection:r.net!.direction,latestDirection:r.latest!.direction,moneyBalance:r.pressure.moneyBalance,
    meaning:"ordered own-book price response and cumulative composition; no new-money or bettor-identity claim" as const}));
 });
 const applied=(baseGrade==="Lean"||baseGrade==="Best Angle")&&evidence.length>0;
 return {release:CBB_MARKET_RESISTANCE_GRADE_RELEASE,baseGrade,applied,grade:applied?"Watchlist" as const:baseGrade,
  reason:applied?"current_professional_price_response_opposes_pick_at_offered_contract" as const:"no_qualified_current_contract_resistance" as const,evidence};
}
