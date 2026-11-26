/** Private prospective freshness comparison only. Never transforms a submitted
 * source, admitted law, stored proof, historical source audit or locked row. */
import {gunzipSync} from 'node:zlib';
import type {GamePacket,Json} from './evidenceContract';
import {CATALOG} from './evidenceContract';
import type {AcceptedGameReview} from './reviewer';
import {digest,instant,stable,validatePacket} from './evidence';
import {readerCanonicalContextHash} from './readerContext';
import {isNbaPlayerPropsContextMetric} from '../services/nba/nbaPlayerPropsReaderContract';

export const PROPS_AI_NBA_BENCHMARK_FRESHNESS_RELEASE='player_props_ai_nba_benchmark_freshness_2026_11_18_r1_exact_metric_sets' as const;
const SOURCE='nba_player_props_model_tournament_2026_10_28_r16_owls_sharp_market_reader';
const MARKETS=new Set<string>([...CATALOG.nba.required,...CATALOG.nba.expansion]);
const RELEASES=new Set(['player_props_ai_2026_11_26_r64_coupled_mean_tail_guidance','player_props_ai_2026_11_26_r63_retained_fixture_provenance','player_props_ai_2026_11_25_r62_scoped_correction_output','player_props_ai_2026_11_23_r61_lossless_market_rows','player_props_ai_2026_11_23_r60_correction_event_witnesses','player_props_ai_2026_11_23_r59_count_stage_headroom','player_props_ai_2026_11_23_r58_weighted_joint_examples','player_props_ai_2026_11_23_r57_explicit_law_disposition','player_props_ai_2026_11_19_r56_forecast_strength','player_props_ai_2026_11_19_r55_ready_game_admission','player_props_ai_2026_11_17_r51_event_tail_navigation','player_props_ai_2026_11_18_r52_joint_dependence_navigation','player_props_ai_2026_11_18_r53_exact_benchmark_context','player_props_ai_2026_11_18_r54_exact_counts_complete_numeric_retry']);
const object=(v:unknown):Record<string,Json>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,Json>:null;

/** Complete exact facts, independent of which offered market repeats them.
 * Conflicting values, unknown shapes, absent facts and all other evidence keep
 * their original strict context. No union is ever taken across actors/packets. */
export function nbaBenchmarkContextHash(packet:GamePacket,playerId:string):string|null{
 if(packet.sport!=='nba')return null;
 const player=packet.players.find(p=>p.id===playerId);if(!player)return null;
 const cutoff=Date.parse(packet.cutoff);
 if(!Number.isFinite(cutoff)||player.evidence.some(e=>typeof e.availableAt!=='string'||!Number.isFinite(Date.parse(e.availableAt))||Date.parse(e.availableAt)>cutoff))return null;
 const native=player.evidence.filter(e=>e.kind==='independent_model'&&e.source===SOURCE);if(!native.length)return null;
 if(new Set(native.map(e=>e.id)).size!==native.length)return null;
 const facts=new Map<string,Json>(),roles=new Map<string,Json>();
 for(const e of native){
  const v=object(e.value);
  if(!v||typeof v.market!=='string'||!MARKETS.has(v.market)||e.id!==`${playerId}:model:${v.market}`||v.context!==undefined
   ||!Array.isArray(v.role)||!v.role.every(x=>isNbaPlayerPropsContextMetric(x,'role'))
   ||!Array.isArray(v.matchup)||!v.matchup.every(x=>isNbaPlayerPropsContextMetric(x,'matchup')))return null;
  for(const fact of v.matchup){const metric=fact as Record<string,Json>,key=String(metric.key),prior=facts.get(key);if(prior&&stable(prior)!==stable(fact))return null;facts.set(key,fact);}
  for(const fact of v.role){const metric=fact as Record<string,Json>,key=String(metric.key),prior=roles.get(key);if(prior&&stable(prior)!==stable(fact))return null;roles.set(key,fact);}
 }
 const matchup=[...facts.values()].sort((a,b)=>stable(a).localeCompare(stable(b)));
 const evidence=player.evidence.map(e=>native.includes(e)?{...e,value:{...object(e.value)!,matchup}}:e);
 return readerCanonicalContextHash({...packet,players:[{...player,evidence}]},playerId);
}

/** Decode once in an invocation-local matcher. A checksum alone is insufficient:
 * bind original game/window/stage/cutoff and exact admitted actor proof separately. */
export function originalNbaBenchmarkPacket(packet:GamePacket,review:AcceptedGameReview):GamePacket|null{
 if(packet.sport!=='nba'||!RELEASES.has(review.release))return null;
 try{
  const a=review.inputEvidence;if(a.encoding!=='gzip-base64'||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>16_000_000||typeof a.data!=='string'||a.data.length>2_666_668)return null;
  const compressed=Buffer.from(a.data,'base64');if(compressed.length>2_000_000||compressed.toString('base64')!==a.data)return null;
  const raw=gunzipSync(compressed,{maxOutputLength:16_000_000});if(raw.length!==a.bytes||!Buffer.from(raw.toString('utf8')).equals(raw))return null;
  const old=JSON.parse(raw.toString('utf8')) as GamePacket;validatePacket(old);
  if(digest(old)!==a.digest||review.inputHash!==a.digest||old.sport!=='nba'||old.gameId!==review.gameId
   ||(old.sourceGameId??old.gameId)!==(review.sourceGameId??review.gameId)||(old.sourceGameId??old.gameId)!==(packet.sourceGameId??packet.gameId)
   ||instant(old.start)!==instant(review.start)||instant(old.start)!==instant(packet.start)||instant(old.lock)!==instant(review.lock)||instant(old.lock)!==instant(packet.lock)
   ||old.stage!==review.stage||instant(old.cutoff)!==instant(review.cutoff)||!review.issuedAt
   ||instant(old.cutoff)>instant(review.issuedAt)||instant(review.issuedAt)>instant(packet.cutoff)||instant(review.issuedAt)>=instant(review.lock))return null;
  return old;
 }catch{return null;}
}
