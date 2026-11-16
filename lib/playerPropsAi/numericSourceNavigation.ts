/** Prospective request navigation over the exact admission contract, never a forecast. */
import type {GamePacket} from './evidenceContract';
import {sourceMeanAdmissionSupport} from './forecastSanity';
import {primitives} from './law';
import {generativeStatistics} from './generativeCoordinates';
import {qualifiedForecastMarkets} from './sourceEvents';
import {evidenceAliases} from './input';

export const NUMERIC_SOURCE_NAVIGATION_RELEASE='player_props_numeric_source_navigation_2026_11_16_r1_canonical_mean_contract' as const;
export const NUMERIC_SOURCE_NAVIGATION_MEANING='The following is deterministic navigation over the SAME original sources and exact backend admission rules, not another model, vote, forecast target or new evidence. Market envelopes constrain weighted CANONICAL means, never individual scenario tails or generative components. Raw sources and actor-local claims remain authoritative. Read the market, role, matchup and contrary evidence before choosing a coherent distribution within the supported contract. Quantitative data already represented in an envelope may expand it; new prose or a team total cannot waive an actor mean bound. An unavailable market requires an explicit permitted source-bound exception or forecast_declined, not confidence zero alone. A missing dependency envelope is not an instruction to decline a supported parent market. Keep all actors/markets and valid supported scopes; never clamp a draft to a bound.';
export function numericSourceNavigation(packet:GamePacket){
 if(packet.sport==='nba')return null;
 const aliases=new Map([...evidenceAliases(packet)].map(([alias,id])=>[id,alias]));
 return{release:NUMERIC_SOURCE_NAVIGATION_RELEASE,meaning:NUMERIC_SOURCE_NAVIGATION_MEANING,coordinateMeaning:packet.sport==='nfl'
  ?'Each index uses the same weight across statistics. canonical passing_completions=non_touchdown_completions+passing_tds; canonical passing_attempts=non_touchdown_completions+passing_tds+interceptions+other_incomplete_passes. passing_yards_if_completion is total net game passing yards when completions>0, not yards per completion. Mean bounds on attempts/completions do not bound these component columns individually. anytime_td is a binary indicator of own non-passing touchdowns, not their count.'
  :'Each index uses the same weight across statistics. Canonical runs/RBIs include home runs plus their respective non_home_run components; hits and total bases derive from the same single/double/triple/home-run outcomes. Source plate appearances establish opportunity rather than a zero ceiling for rare events. Mean boundaries are not per-scenario maxima.',
  players:packet.players.map((player,index)=>{
   const support=sourceMeanAdmissionSupport(packet,player),qualified=new Set(qualifiedForecastMarkets(player));
   return{playerIndex:index,playerId:player.id,canonicalStatistics:primitives(packet.sport,player),scenarioStatistics:generativeStatistics(packet.sport,player),
    markets:player.markets.map((market,marketIndex)=>({marketIndex,market,qualifiedSourceEvent:qualified.has(market),meanAdmissionSupport:qualified.has(market)?support[market]??null:null})),
    evidenceAliases:player.evidence.map(e=>aliases.get(e.id)!),
   };
  })};
}
