/** Prospective request navigation over the exact admission contract, never a forecast. */
import {COMBOS,type GamePacket,type Player} from './evidenceContract';
import {sourceMeanAdmissionSupport} from './forecastSanity';
import {primitives,marketUsesStatistic} from './law';
import {generativeStatistics} from './generativeCoordinates';
import {qualifiedForecastMarkets} from './sourceEvents';
import {evidenceAliases} from './input';

export const NUMERIC_SOURCE_NAVIGATION_RELEASE='player_props_numeric_source_navigation_2026_11_16_r1_canonical_mean_contract' as const;
export const NUMERIC_SOURCE_NAVIGATION_MEANING='The following is deterministic navigation over the SAME original sources and exact backend admission rules, not another model, vote, forecast target or new evidence. All applicable canonical constraints include their exact affected market indices. Active envelopes constrain weighted CANONICAL means, never individual scenario tails or generative components. Raw sources and actor-local claims remain authoritative. Read the market, role, matchup and contrary evidence before choosing a coherent distribution within the supported contract. Quantitative data already represented in an envelope may expand it; new prose or a team total cannot waive an actor mean bound. explicit_decline_affected means unavailable required numerical support: explicitly except the affected scopes, not confidence zero alone. A combo total prior cannot allocate its signed components. no_mean_bound means this dependency has no numerical mean gate; physical identities still apply. Keep all actors/markets and valid supported scopes; never clamp a draft to a bound.';
/** The same canonical-statistic iteration, affected scopes and required-support
 * policy as sourceForecastIssues. No synthetic law or guessed allocation. */
export function numericSourceConstraints(packet:GamePacket,player:Player){
 const support=sourceMeanAdmissionSupport(packet,player),qualified=qualifiedForecastMarkets(player);
 return [...new Set([...primitives(packet.sport,player),...qualified])].flatMap(statistic=>{
  const affected=qualified.filter(m=>marketUsesStatistic(m,statistic));if(!affected.length)return[];
  const envelope=support[statistic]??null,required=qualified.includes(statistic)||statistic.endsWith('yards')&&affected.some(m=>COMBOS[m]?.includes(statistic));
  return[{statistic,affectedMarketIndices:affected.map(m=>player.markets.indexOf(m)),meanAdmissionSupport:envelope,
   meanRule:envelope?.active?'within_range' as const:required?'explicit_decline_affected' as const:'no_mean_bound' as const}];
 });
}
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
    canonicalMeanConstraints:numericSourceConstraints(packet,player),evidenceAliases:player.evidence.map(e=>aliases.get(e.id)!),
   };
  })};
}
