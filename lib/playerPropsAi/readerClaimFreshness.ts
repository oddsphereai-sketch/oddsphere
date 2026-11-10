/** Prospective reader freshness supplements the existing source-content hash.
 * Source clocks select authority, but routine refetch clocks are not themselves
 * context changes. Stored legacy reviews keep their original hash contract.
 */
import type {GamePacket} from './evidenceContract';
import type {AcceptedGameReview} from './reviewer';
import {criticalContextHashes} from './criticalContext';
import {digest} from './evidence';
import {currentBatterLineup} from './readerClaims';
import {playerParticipationEligibility} from './participationEligibility';
import {PROPS_AI_READER_CLAIMS_RELEASE} from './releases';
import {readerCanonicalContextHash,PROPS_AI_READER_CONTEXT_RELEASE} from './readerContext';

const CLAIM_REVIEW_RELEASE='player_props_ai_2026_11_10_r31_verified_reader_claims';
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const status=(value:string)=>value.trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
export function readerAvailabilityContextHash(packet:GamePacket,playerId:string){
 const player=packet.players.find(p=>p.id===playerId);if(!player)return null;
 const eligibility=playerParticipationEligibility(packet,player),lineup=currentBatterLineup(packet,player);
 const medical=eligibility.facts.filter(f=>f.ownIdentityBasis!=='attached_batter_lineup'&&f.ownIdentityBasis!=='exact_team_report_omission');
 const explicit=medical.filter(f=>f.status!=='unknown'),latestExplicit=Math.max(-Infinity,...explicit.map(f=>Date.parse(f.effectiveAt))),latestReported=Math.max(-Infinity,...medical.map(f=>Date.parse(f.effectiveAt)));
 const designations=(at:number,entries:typeof medical)=>[...new Set(entries.filter(f=>Date.parse(f.effectiveAt)===at).map(f=>status(f.rawStatus)))].sort();
 return digest({status:eligibility.status,blocked:eligibility.blocked,conflict:eligibility.conflict,
  medical:{explicit:designations(latestExplicit,explicit),latestReported:designations(latestReported,medical)},
  lineup:lineup?{status:lineup.status,battingOrder:lineup.battingOrder}:null});
}
/** Complete freshness predicate: versioned full source-context equality AND the
 * future claim's admitted effective availability state. Missing R31 proof is
 * unavailable, never permission to reconstruct an older accepted observation.
 */
export function reviewedReaderContextCurrent(packet:GamePacket,review:AcceptedGameReview,playerId:string){
 const player=packet.players.find(p=>p.id===playerId);if(!player)return false;
 // The established hash is actor-local; avoid rehashing the complete slate
 // for every actor when publication evaluates their scopes independently.
 if(review.release!==CLAIM_REVIEW_RELEASE)return review.criticalContextHashes?.[playerId]===criticalContextHashes({...packet,players:[player]})[playerId];
 const proof=object(review.players.find(p=>p.playerId===playerId)?.sourceReadProofs);
 return proof.release===PROPS_AI_READER_CLAIMS_RELEASE&&proof.contextRelease===PROPS_AI_READER_CONTEXT_RELEASE
  &&typeof proof.originalCriticalContextHash==='string'&&proof.originalCriticalContextHash===review.criticalContextHashes?.[playerId]
  &&typeof proof.canonicalContextHash==='string'&&proof.canonicalContextHash===readerCanonicalContextHash(packet,playerId)
  &&typeof proof.availabilityContextHash==='string'
  &&proof.availabilityContextHash===readerAvailabilityContextHash(packet,playerId);
}
