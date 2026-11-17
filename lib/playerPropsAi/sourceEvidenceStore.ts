/** Private immutable evidence from the actual ordinary writer callback. This
 * module never generates, qualifies, repairs, reprices or publishes a forecast. */
import {gzipSync,gunzipSync} from 'node:zlib';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {GamePacket} from './evidenceContract';
import type {AcceptedGameReview} from './reviewer';
import {buildPropsSourceContextAudit,PROPS_SOURCE_CONTEXT_AUDIT_RELEASE,type PropsSourceContextAudit} from './sourceContextAudit';
import {propsReviewHasVerifiedReaderClaims} from './releases';
import {readerCanonicalContextHash} from './readerContext';
import {readerAvailabilityContextHash} from './readerClaimFreshness';
import {digest,etDate,instant,validatePacket} from './evidence';
export const PROPS_SOURCE_EVIDENCE_RELEASE='player_props_source_evidence_2026_11_17_r1_immutable_callback' as const;
export const PROPS_SOURCE_EVIDENCE_STORAGE_RELEASE='player_props_source_evidence_storage_2026_11_17_r2_bounded_ack' as const;
export const PROPS_SOURCE_EVIDENCE_LIMITS={rawBytes:16_000_000,compressedBytes:2_000_000,contextsPerGameDay:64,writeWindowMs:5000,reconcileWindowMs:1500} as const;
type Capsule={release:typeof PROPS_SOURCE_EVIDENCE_RELEASE;contextHash:string;packetHash:string;auditHash:string;bytes:number;compressedBytes:number;encoding:'gzip-base64';data:string;observedAt:string;originalReview:Pick<AcceptedGameReview,'release'|'inputHash'|'issuedAt'|'cutoff'|'gameId'|'sourceGameId'|'start'|'lock'|'stage'>;audit:PropsSourceContextAudit};
export type SourceEvidenceReceipt={status:'not_needed'|'retained'|'unavailable';key?:string;packetHash?:string;reason?:string};
function originalReference(review:AcceptedGameReview):Capsule['originalReview']{return{release:review.release,inputHash:review.inputHash,issuedAt:review.issuedAt!,cutoff:review.cutoff,gameId:review.gameId,...(review.sourceGameId?{sourceGameId:review.sourceGameId}:{}),start:review.start,lock:review.lock,stage:review.stage};}
function identity(packet:GamePacket,review:Capsule['originalReview'],audit:PropsSourceContextAudit){
 return digest({sport:packet.sport,game:packet.sourceGameId??packet.gameId,start:packet.start,lock:packet.lock,review,
  actors:audit.actors.map(a=>({actor:a.actorId,present:a.currentPresent,canonical:a.currentCanonicalHash,availability:a.currentAvailabilityHash,scopes:a.currentScopes})).sort((a,b)=>a.actor.localeCompare(b.actor))});
}
export function decodePropsSourceEvidence(value:unknown):{capsule:Capsule;packet:GamePacket}{
 const c=value as Capsule;
 if(c?.release!==PROPS_SOURCE_EVIDENCE_RELEASE||c.encoding!=='gzip-base64'||!Number.isSafeInteger(c.bytes)||c.bytes<1||c.bytes>PROPS_SOURCE_EVIDENCE_LIMITS.rawBytes
  ||!Number.isSafeInteger(c.compressedBytes)||c.compressedBytes<1||c.compressedBytes>PROPS_SOURCE_EVIDENCE_LIMITS.compressedBytes
  ||typeof c.data!=='string'||c.data.length>Math.ceil(PROPS_SOURCE_EVIDENCE_LIMITS.compressedBytes/3)*4)throw Error('invalid_capsule');
 const compressed=Buffer.from(c.data,'base64');if(compressed.length!==c.compressedBytes||compressed.toString('base64')!==c.data)throw Error('invalid_compressed_bytes');
 const raw=gunzipSync(compressed,{maxOutputLength:PROPS_SOURCE_EVIDENCE_LIMITS.rawBytes});if(raw.length!==c.bytes||!Buffer.from(raw.toString('utf8')).equals(raw))throw Error('invalid_raw_bytes');
 const packet=JSON.parse(raw.toString('utf8')) as GamePacket;validatePacket(packet);
 if(digest(c.audit)!==c.auditHash||c.audit.release!==PROPS_SOURCE_CONTEXT_AUDIT_RELEASE||c.audit.gameId!==(packet.sourceGameId??packet.gameId)||c.audit.packetGameId!==packet.gameId||c.audit.sport!==packet.sport
  ||c.audit.start!==packet.start||c.audit.lock!==packet.lock||c.audit.cutoff!==packet.cutoff
  ||c.audit.sourceInputRelease!==(packet.sourceInputRelease??null)||c.audit.sourceOfferSetStatus!==(packet.sourceOfferSetStatus??'unspecified')
  ||c.audit.executionSet.provided!==Array.isArray(packet.executionQuotes)||c.audit.executionSet.rows!==(packet.executionQuotes?.length??0)||c.audit.executionSet.hash!==(Array.isArray(packet.executionQuotes)?digest(packet.executionQuotes):null)
  ||c.audit.counts.actors!==c.audit.actors.length||c.audit.counts.originalActors!==c.audit.actors.filter(a=>a.originalPresent).length
  ||c.audit.counts.currentActors!==packet.players.length||new Set(c.audit.actors.map(a=>a.actorId)).size!==c.audit.actors.length
  ||c.audit.actors.filter(a=>a.currentPresent).length!==packet.players.length||c.audit.actors.some(a=>{const p=packet.players.find(p=>p.id===a.actorId);return a.currentPresent!==Boolean(p)||Boolean(p)&&(digest([...a.currentScopes].sort())!==digest([...p!.markets].sort())||a.currentCanonicalHash!==readerCanonicalContextHash(packet,a.actorId)||a.currentAvailabilityHash!==readerAvailabilityContextHash(packet,a.actorId));})
  ||digest(packet)!==c.packetHash||c.audit.currentPacketHash!==c.packetHash||instant(c.observedAt)<instant(packet.cutoff)
  ||c.observedAt!==c.audit.observedAt||c.audit.status!=='complete'||c.audit.reason!==null||c.audit.comparisonComplete!==true||c.audit.collectorCoverageAttested!==false||c.audit.forecastDecision!==false||c.audit.review.status!=='verified'||c.originalReview.inputHash!==c.audit.review.inputHash
  ||!propsReviewHasVerifiedReaderClaims(c.originalReview.release)||!['early','final'].includes(c.originalReview.stage)
  ||typeof c.originalReview.issuedAt!=='string'||instant(c.originalReview.issuedAt)>instant(c.observedAt)
  ||c.audit.review.archiveDigest!==c.originalReview.inputHash||c.audit.review.cutoff!==c.originalReview.cutoff
  ||instant(c.originalReview.cutoff)>instant(c.originalReview.issuedAt!)||instant(c.originalReview.issuedAt!)>=instant(packet.lock)
  ||instant(c.originalReview.start)!==instant(packet.start)||instant(c.originalReview.lock)!==instant(packet.lock)
  ||(c.originalReview.sourceGameId??c.originalReview.gameId)!==(packet.sourceGameId??packet.gameId)
  ||c.originalReview.release!==c.audit.review.release||c.originalReview.issuedAt!==c.audit.review.issuedAt
  ||c.contextHash!==identity(packet,c.originalReview,c.audit))throw Error('invalid_binding');
 return{capsule:c,packet};
}
/** Original-side audit truth requires the actual immutable accepted review,
 * never only a self-consistent checksum or a matching original input hash. */
export function verifyPropsSourceEvidence(value:unknown,review:AcceptedGameReview){
 const decoded=decodePropsSourceEvidence(value);
 if(digest(decoded.capsule.originalReview)!==digest(originalReference(review)))throw Error('existing_evidence_conflict');
 const rebuilt=buildPropsSourceContextAudit({packet:decoded.packet,review,observedAt:decoded.capsule.observedAt,lookupAvailable:true});
 if(!rebuilt.comparisonComplete||digest(rebuilt)!==digest(decoded.capsule.audit))throw Error('existing_evidence_conflict');
 return decoded;
}
/** Insert-only, bounded and awaited under the existing sport writer. A duplicate
 * is verified, never replaced. Evidence failure is explicit but cannot suppress
 * a valid forecast or trigger another paid review. Only semantic context changes
 * receive capsules; routine prices/refetch clocks do not create unbounded rows. */
export async function retainPropsSourceEvidence(args:{client:SupabaseClient;writerRunId?:string;packet:GamePacket;review:AcceptedGameReview|null;audit:PropsSourceContextAudit;observedAt:string}):Promise<SourceEvidenceReceipt>{
 const {packet,review,audit}=args;
 if(!review||audit.review.status!=='verified'||!audit.comparisonComplete||!audit.actors.some(a=>a.canonicalChanged===true||a.availabilityChanged===true||a.originalPresent!==a.currentPresent||a.addedScopes.length>0||a.removedScopes.length>0))return{status:'not_needed'};
 if(!args.writerRunId)return{status:'unavailable',reason:'missing_existing_writer_lease'};
 const day=etDate(packet.start),prefix=`props-source-evidence:v1:${packet.sport}:${day}:${digest(packet.sourceGameId??packet.gameId)}:`,contextHash=identity(packet,originalReference(review),audit),key=prefix+contextHash;
 const signal=AbortSignal.timeout(PROPS_SOURCE_EVIDENCE_LIMITS.writeWindowMs);
 const read=(readSignal=signal)=>args.client.from('lab_response_snapshots').select('payload').eq('snapshot_key',key).abortSignal(readSignal).maybeSingle();
 const verify=(payload:unknown)=>{const old=verifyPropsSourceEvidence(payload,review);if(old.capsule.contextHash!==contextHash||old.packet.sport!==packet.sport||old.packet.sourceGameId!==packet.sourceGameId||old.packet.gameId!==packet.gameId||instant(old.packet.start)!==instant(packet.start)||digest(old.capsule.originalReview)!==digest(originalReference(review)))throw Error('existing_evidence_conflict');return{status:'retained' as const,key,packetHash:old.capsule.packetHash};};
 try{
  validatePacket(packet);if(digest(packet)!==audit.currentPacketHash||audit.gameId!==(packet.sourceGameId??packet.gameId)||audit.review.inputHash!==review.inputHash||instant(args.observedAt)<instant(audit.observedAt)||instant(audit.observedAt)<instant(packet.cutoff))throw Error('callback_binding_mismatch');
  const found=await read();if(found.error)throw Error('evidence_read_unavailable');if(found.data)return verify(found.data.payload);
  const inventory=await args.client.from('lab_response_snapshots').select('snapshot_key').like('snapshot_key',prefix+'%').limit(PROPS_SOURCE_EVIDENCE_LIMITS.contextsPerGameDay).abortSignal(signal);
  if(inventory.error||!Array.isArray(inventory.data))throw Error('evidence_inventory_unavailable');if(inventory.data.length>=PROPS_SOURCE_EVIDENCE_LIMITS.contextsPerGameDay)throw Error('evidence_context_limit');
  const raw=Buffer.from(JSON.stringify(packet));if(raw.length>PROPS_SOURCE_EVIDENCE_LIMITS.rawBytes)throw Error('evidence_raw_limit');const compressed=gzipSync(raw);if(compressed.length>PROPS_SOURCE_EVIDENCE_LIMITS.compressedBytes)throw Error('evidence_compressed_limit');
  const capsule:Capsule={release:PROPS_SOURCE_EVIDENCE_RELEASE,contextHash,packetHash:digest(packet),auditHash:digest(audit),bytes:raw.length,compressedBytes:compressed.length,encoding:'gzip-base64',data:compressed.toString('base64'),observedAt:audit.observedAt,originalReview:originalReference(review),audit};decodePropsSourceEvidence(capsule);
  const retention=new Date(instant(packet.start)+366*86400000).toISOString();
  const saved=await args.client.from('lab_response_snapshots').insert({snapshot_key:key,kind:'daily_edge',sport:packet.sport,slate_date:day,payload:capsule,payload_version:PROPS_SOURCE_EVIDENCE_RELEASE,source:PROPS_SOURCE_EVIDENCE_RELEASE,generated_at:audit.observedAt,updated_at:audit.observedAt,expires_at:retention,stale_until:retention}).abortSignal(signal);
  // A timed-out insert may already have committed. Its aborted signal cannot
  // confirm the acknowledgement: allow exactly one separately bounded read,
  // retaining the same immutable key and full original-review verification.
  if(saved.error){const reconciled=await read(AbortSignal.timeout(PROPS_SOURCE_EVIDENCE_LIMITS.reconcileWindowMs));if(reconciled.error||!reconciled.data)throw Error('evidence_insert_unconfirmed');return verify(reconciled.data.payload);}
  return{status:'retained',key,packetHash:capsule.packetHash};
 }catch(error){return{status:'unavailable',key,reason:signal.aborted?'evidence_storage_deadline':error instanceof Error?error.message:'evidence_storage_unavailable'};}
}
