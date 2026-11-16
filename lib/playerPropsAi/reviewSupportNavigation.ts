/** Deterministic navigation over the same admission rules, never a forecast. */
import type {GamePacket} from './evidenceContract';
import {sourceForecastEventConstraints} from './forecastSanity';
import {numericSourceConstraints} from './numericSourceNavigation';
import {evidenceAliases} from './input';
import {PROPS_AI_LAW_RELEASE} from './releases';
import {invariant} from './evidence';

export const REVIEW_SUPPORT_NAVIGATION_RELEASE='player_props_review_support_navigation_2026_11_16_r1_event_and_exception_actions' as const;
export function reviewSupportNavigation(packet:GamePacket){
 const aliases=new Map([...evidenceAliases(packet)].map(([alias,id])=>[id,alias])),quotes=new Map(packet.quotes.map(q=>[q.id,q]));
 return{release:REVIEW_SUPPORT_NAVIGATION_RELEASE,
  meaning:'These are the SAME original-source/backend requirements, not another model, new evidence, probability targets or scenario caps. Every non-declined scope must satisfy ALL of its event requirements using positive-weight scenarios. Zero-weight rows are not witnesses. Correct the distribution or explicitly choose a permitted source reason or forecast_declined in that market\'s aligned exceptions entry; confidence zero alone is not a decline. Never silently add tails, clamp values, copy a prior, invent data or automatically decline supported siblings.',
  eventMass:{ordinary:'event=sum(weight where canonical stat > line), complement=sum(weight where stat < line), push=sum(weight where stat = line)',inclusive:'event=sum(weight where canonical stat >= line), complement=sum(weight where stat < line), push=0',anytime_td:'canonical stat is the indicator of own non-passing touchdowns >= 1, not a passing-touchdown count',both_sides_positive:'event>0 AND complement>0; an integer push cannot replace either independent-source tail',priced_complement_or_push:'win>0 AND (push>0 OR (event>0 AND complement>0)); win=event for a one-way Yes offer, otherwise max(event,complement). All-push is invalid. No arbitrary probability floor is required.'},
  players:packet.players.map((player,playerIndex)=>{
   const indices=[...new Set(numericSourceConstraints(packet,player).filter(c=>c.meanRule==='explicit_decline_affected').flatMap(c=>c.affectedMarketIndices))].sort((a,b)=>a-b);
   return{playerIndex,playerId:player.id,
    unavailableNumericActions:indices.map(marketIndex=>({marketIndex,market:player.markets[marketIndex],action:`exceptions[${marketIndex}] must explicitly select a permitted source reason or forecast_declined; confidence[${marketIndex}]=0 alone does not resolve missing numeric support. No missing value becomes zero.`})),
    eventRequirements:sourceForecastEventConstraints(packet,player,PROPS_AI_LAW_RELEASE).map(event=>{
     const alias=aliases.get(event.sourceId),quote=quotes.get(event.sourceId);
     invariant(event.origin==='independent_prior'?alias!==undefined:quote!==undefined,'Event navigation requires its exact original source');
     return{marketIndex:player.markets.indexOf(event.market),market:event.market,line:event.line,comparison:event.inclusive?'inclusive':'ordinary',rule:event.rule,oneWayYes:event.oneWayYes,
      source:event.origin==='independent_prior'?{kind:event.origin,evidenceAlias:alias!}:{kind:event.origin,quoteId:event.sourceId,provider:quote!.provider,book:quote!.book,side:quote!.side},
     };
    }),
   };
  }),
 };
}
