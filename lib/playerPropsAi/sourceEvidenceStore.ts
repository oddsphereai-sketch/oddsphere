/** Private immutable evidence from the actual ordinary writer callback. This
 * module never generates, qualifies, repairs, reprices or publishes a forecast. */
import {gzipSync,gunzipSync} from 'node:zlib';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {GamePacket} from './evidenceContract';
import type {AcceptedGameReview} from './reviewer';
import type {PropsSourceContextAudit} from './sourceContextAudit';
import {digest,etDate,instant,validatePacket} from './evidence';
export const PROPS_SOURCE_EVIDENCE_RELEASE='player_props_source_evidence_2026_11_17_r1_immutable_callback' as const;
export const PROPS_SOURCE_EVIDENCE_LIMITS={rawBytes:16_000_000,compressedBytes:2_000_000,contextsPerGameDay:64,writeWindowMs:1500} as const;
type Capsule={release:typeof PROPS_SOURCE_EVIDENCE_RELEASE;contextHash:string;packetHash:string;bytes:number;compressedBytes:number;encoding:'gzip-base64';data:string;observedAt:string;originalReview:{release:string;inputHash:string;issuedAt:string};audit:PropsSourceContextAudit};
export type SourceEvidenceReceipt={status:'not_needed'|'retained'|'unavailable';key?:string;packetHash?:string;reason?:string};
function identity(packet:GamePacket,review:AcceptedGameReview,audit:PropsSourceContextAudit){
 return digest({sport:packet.sport,game:packet.sourceGameId??packet.gameId,start:packet.start,lock:packet.lock,review:review.inputHash,
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
 if(digest(packet)!==c.packetHash||c.audit.currentPacketHash!==c.packetHash||instant(c.observedAt)<instant(packet.cutoff)
  ||c.observedAt!==c.audit.observedAt||c.audit.status!=='complete'||c.audit.comparisonComplete!==true||c.audit.review.status!=='verified'||c.originalReview.inputHash!==c.audit.review.inputHash
  ||c.originalReview.release!==c.audit.review.release||c.originalReview.issuedAt!==c.audit.review.issuedAt
  ||c.contextHash!==identity(packet,{inputHash:c.originalReview.inputHash} as AcceptedGameReview,c.audit))throw Error('invalid_binding');
 return{capsule:c,packet};
}
/** Insert-only, bounded and awaited under the existing sport writer. A duplicate
 * is verified, never replaced. Evidence failure is explicit but cannot suppress
 * a valid forecast or trigger another paid review. Only semantic context changes
 * receive capsules; routine prices/refetch clocks do not create unbounded rows. */
export async function retainPropsSourceEvidence(args:{client:SupabaseClient;writerRunId?:string;packet:GamePacket;review:AcceptedGameReview|null;audit:PropsSourceContextAudit;observedAt:string}):Promise<SourceEvidenceReceipt>{
 const {packet,review,audit}=args;
 if(!review||audit.review.status!=='verified'||!audit.comparisonComplete||!audit.actors.some(a=>a.canonicalChanged===true||a.availabilityChanged===true))return{status:'not_needed'};
 if(!args.writerRunId)return{status:'unavailable',reason:'missing_existing_writer_lease'};
 const day=etDate(packet.start),prefix=`props-source-evidence:v1:${packet.sport}:${day}:${digest(packet.sourceGameId??packet.gameId)}:`,contextHash=identity(packet,review,audit),key=prefix+contextHash;
 const signal=AbortSignal.timeout(PROPS_SOURCE_EVIDENCE_LIMITS.writeWindowMs);
 const read=()=>args.client.from('lab_response_snapshots').select('payload').eq('snapshot_key',key).abortSignal(signal).maybeSingle();
 const verify=(payload:unknown)=>{const old=decodePropsSourceEvidence(payload);if(old.capsule.contextHash!==contextHash||old.packet.sport!==packet.sport||old.packet.sourceGameId!==packet.sourceGameId||old.packet.gameId!==packet.gameId||instant(old.packet.start)!==instant(packet.start)||old.capsule.originalReview.inputHash!==review.inputHash)throw Error('existing_evidence_conflict');return{status:'retained' as const,key,packetHash:old.capsule.packetHash};};
 try{
  validatePacket(packet);if(digest(packet)!==audit.currentPacketHash||audit.gameId!==(packet.sourceGameId??packet.gameId)||audit.review.inputHash!==review.inputHash||instant(args.observedAt)<instant(audit.observedAt)||instant(audit.observedAt)<instant(packet.cutoff))throw Error('callback_binding_mismatch');
  const found=await read();if(found.error)throw Error('evidence_read_unavailable');if(found.data)return verify(found.data.payload);
  const inventory=await args.client.from('lab_response_snapshots').select('snapshot_key').like('snapshot_key',prefix+'%').limit(PROPS_SOURCE_EVIDENCE_LIMITS.contextsPerGameDay).abortSignal(signal);
  if(inventory.error||!Array.isArray(inventory.data))throw Error('evidence_inventory_unavailable');if(inventory.data.length>=PROPS_SOURCE_EVIDENCE_LIMITS.contextsPerGameDay)throw Error('evidence_context_limit');
  const raw=Buffer.from(JSON.stringify(packet));if(raw.length>PROPS_SOURCE_EVIDENCE_LIMITS.rawBytes)throw Error('evidence_raw_limit');const compressed=gzipSync(raw);if(compressed.length>PROPS_SOURCE_EVIDENCE_LIMITS.compressedBytes)throw Error('evidence_compressed_limit');
  const capsule:Capsule={release:PROPS_SOURCE_EVIDENCE_RELEASE,contextHash,packetHash:digest(packet),bytes:raw.length,compressedBytes:compressed.length,encoding:'gzip-base64',data:compressed.toString('base64'),observedAt:audit.observedAt,originalReview:{release:review.release,inputHash:review.inputHash,issuedAt:review.issuedAt!},audit};decodePropsSourceEvidence(capsule);
  const retention=new Date(instant(packet.start)+366*86400000).toISOString();
  const saved=await args.client.from('lab_response_snapshots').insert({snapshot_key:key,kind:'daily_edge',sport:packet.sport,slate_date:day,payload:capsule,payload_version:PROPS_SOURCE_EVIDENCE_RELEASE,source:PROPS_SOURCE_EVIDENCE_RELEASE,generated_at:audit.observedAt,updated_at:audit.observedAt,expires_at:retention,stale_until:retention}).abortSignal(signal);
  if(saved.error){const reconciled=await read();if(reconciled.error||!reconciled.data)throw Error('evidence_insert_unconfirmed');return verify(reconciled.data.payload);}
  return{status:'retained',key,packetHash:capsule.packetHash};
 }catch(error){return{status:'unavailable',key,reason:signal.aborted?'evidence_storage_deadline':error instanceof Error?error.message:'evidence_storage_unavailable'};}
}
