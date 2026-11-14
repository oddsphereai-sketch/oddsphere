/** Prospective source provenance only. No I/O, forecast decision, source repair,
 * legacy wire/law parsing, or mutation of the supplied packet/review/locks. */
import {gunzipSync} from 'node:zlib';
import {digest,instant,etDate,validatePacket} from './evidence';
import type {Evidence,GamePacket,Player} from './evidenceContract';
import type {AcceptedGameReview} from './reviewer';
import {criticalContextHashes} from './criticalContext';
import {readerCanonicalContextHash,PROPS_AI_READER_CONTEXT_RELEASE} from './readerContext';
import {readerAvailabilityContextHash} from './readerClaimFreshness';
import {playerParticipationEligibility} from './participationEligibility';
import {PROPS_AI_READER_CLAIMS_RELEASE,PROPS_AI_RELEASE} from './releases';

export const PROPS_SOURCE_CONTEXT_AUDIT_RELEASE='player_props_source_context_audit_2026_11_11_r1_actual_callback' as const;
export const PROPS_SOURCE_CONTEXT_AUDIT_LIMITS={games:16,actors:256,evidenceRecords:4096,inputBytes:16_000_000,compressedBytes:2_000_000,outputBytes:1_000_000} as const;
const supported=new Set<string>([PROPS_AI_RELEASE,"player_props_ai_2026_11_11_r36_urgent_slot_cohorts","player_props_ai_2026_11_11_r35_terminal_wave_guard","player_props_ai_2026_11_11_r34_source_mean_admission",'player_props_ai_2026_11_11_r33_two_phase_review_window','player_props_ai_2026_11_11_r32_lossless_reader_tables','player_props_ai_2026_11_10_r31_verified_reader_claims']);
type ReviewStatus='verified'|'none'|'lookup_unavailable'|'unsupported_release'|'invalid_archive'|'binding_mismatch';
type Change='added'|'removed'|'value_changed'|'availability_only'|'unchanged';
type EvidenceVersion={valueHash:string;availableAt:string;count:number};
export type PropsSourceEvidenceAudit={identityHash:string;recordIdHash:string;sourceHash:string;kind:Evidence['kind'];change:Change;original:EvidenceVersion[];current:EvidenceVersion[]};
type KindInventory={kind:Evidence['kind'];originalHash:string;currentHash:string;originalRecords:number;currentRecords:number;changes:Record<Change,number>};
type Qualification=Pick<ReturnType<typeof playerParticipationEligibility>,'release'|'status'|'blocked'|'reason'|'conflict'|'availableAt'|'effectiveAt'>&{factCount:number;factsHash:string};
export type PropsSourceActorAudit={
 actorId:string;originalPresent:boolean;currentPresent:boolean;acceptedActorPresent:boolean;
 originalScopes:string[];currentScopes:string[];acceptedScopes:string[];addedScopes:string[];removedScopes:string[];
 originalCanonicalHash:string|null;currentCanonicalHash:string|null;originalAvailabilityHash:string|null;currentAvailabilityHash:string|null;
 admittedCanonicalHash:string|null;admittedAvailabilityHash:string|null;admittedProofMatchesOriginal:boolean|null;
 canonicalChanged:boolean|null;availabilityChanged:boolean|null;changedEvidenceKinds:Evidence['kind'][];
 evidenceInventory:{originalHash:string|null;currentHash:string|null;originalRecords:number;currentRecords:number;unchangedRecords:number;unchangedHash:string|null;comparisonAvailable:boolean};
 detailGranularity:'non_market_changed_records';evidenceKinds:KindInventory[];
 originalQualification:Qualification|null;currentQualification:Qualification|null;evidence:PropsSourceEvidenceAudit[];
};
export type PropsSourceContextAudit={
 release:typeof PROPS_SOURCE_CONTEXT_AUDIT_RELEASE;status:'complete'|'overflow'|'invalid';reason:string|null;
 /** Complete means bounded audit enumeration, never collector coverage or publication authority. */
 comparisonComplete:boolean;collectorCoverageAttested:false;forecastDecision:false;
 gameId:string;packetGameId:string;sport:GamePacket['sport'];start:string;lock:string;cutoff:string;observedAt:string;
 currentPacketHash:string|null;sourceInputRelease:string|null;sourceOfferSetStatus:string;
 executionSet:{provided:boolean;rows:number;hash:string|null};
 review:{status:ReviewStatus;release:string|null;inputHash:string|null;archiveDigest:string|null;issuedAt:string|null;cutoff:string|null};
 counts:{originalActors:number;currentActors:number;actors:number;evidenceRecords:number};actors:PropsSourceActorAudit[];
};
const nullableString=(v:unknown)=>typeof v==='string'?v:null;
const bounded=(v:unknown)=>typeof v==='string'&&v.length<=256?v:'invalid_or_oversized';
const optionalBounded=(v:unknown)=>typeof v==='string'?bounded(v):null;
const sorted=(v:readonly string[])=>[...new Set(v)].sort();
function qualification(packet:GamePacket,player:Player):Qualification{
 const q=playerParticipationEligibility(packet,player);
 return{release:q.release,status:q.status,blocked:q.blocked,reason:q.reason,conflict:q.conflict,availableAt:q.availableAt,effectiveAt:q.effectiveAt,factCount:q.facts.length,factsHash:digest(q.facts)};
}
/** Identity hashes include exact source labels/IDs without leaking arbitrary
 * source strings or names. Multiplicity and original value/availability remain explicit. */
function evidenceAudit(original:readonly Evidence[],current:readonly Evidence[]):PropsSourceEvidenceAudit[]{
 const groups=new Map<string,{row:Evidence;original:Evidence[];current:Evidence[]}>();
 for(const [side,rows]of [['original',original],['current',current]] as const)for(const row of rows){
  const identity=digest({id:row.id,kind:row.kind,source:row.source});
  if(!groups.has(identity))groups.set(identity,{row,original:[],current:[]});groups.get(identity)![side].push(row);
 }
 const versions=(rows:Evidence[])=>{
  const result=new Map<string,EvidenceVersion>();for(const row of rows){const valueHash=digest(row.value),key=digest([valueHash,row.availableAt]),prior=result.get(key);result.set(key,{valueHash,availableAt:row.availableAt,count:(prior?.count??0)+1});}
  return [...result.values()].sort((a,b)=>a.valueHash.localeCompare(b.valueHash)||a.availableAt.localeCompare(b.availableAt));
 };
 const values=(rows:Evidence[])=>rows.map(row=>digest(row.value)).sort();
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([identityHash,g])=>{
  const old=versions(g.original),now=versions(g.current);
  const change:Change=!old.length?'added':!now.length?'removed':digest(values(g.original))!==digest(values(g.current))?'value_changed':digest(old)!==digest(now)?'availability_only':'unchanged';
  return{identityHash,recordIdHash:digest(g.row.id),sourceHash:digest(g.row.source),kind:g.row.kind,change,original:old,current:now};
 });
}
function originalPacket(review:AcceptedGameReview,packet:GamePacket,observedAt:string):{status:ReviewStatus;packet:GamePacket|null}{
 if(!supported.has(review.release))return{status:'unsupported_release',packet:null};
 let original:GamePacket;
 try{
  const a=review.inputEvidence;
  if(a?.encoding!=='gzip-base64'||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.inputBytes
   ||typeof a.data!=='string'||a.data.length>Math.ceil(PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.compressedBytes/3)*4)throw Error();
  const compressed=Buffer.from(a.data,'base64');if(compressed.length>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.compressedBytes||compressed.toString('base64')!==a.data)throw Error();
  const raw=gunzipSync(compressed,{maxOutputLength:PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.inputBytes});
  if(raw.length!==a.bytes||!Buffer.from(raw.toString('utf8')).equals(raw))throw Error();
  original=JSON.parse(raw.toString('utf8')) as GamePacket;
  if(digest(original)!==a.digest||review.inputHash!==a.digest)throw Error();
  validatePacket(original);
 }catch{return{status:'invalid_archive',packet:null};}
 try{
  const native=(p:Pick<GamePacket,'gameId'|'sourceGameId'>)=>p.sourceGameId??p.gameId;
  if(original.sport!==packet.sport||original.gameId!==review.gameId||native(original)!==native(review)||native(original)!==native(packet)
   ||instant(original.start)!==instant(review.start)||instant(original.start)!==instant(packet.start)
   ||instant(original.lock)!==instant(review.lock)||instant(original.lock)!==instant(packet.lock)
   ||original.stage!==review.stage||instant(original.cutoff)!==instant(review.cutoff)
   ||!review.issuedAt||instant(original.cutoff)>instant(review.issuedAt)||instant(review.issuedAt)>instant(observedAt)||instant(review.issuedAt)>=instant(review.lock))throw Error();
 }catch{return{status:'binding_mismatch',packet:null};}
 return{status:'verified',packet:original};
}
/** Caller must pass its actual callback packet, never a cached reconstruction.
 * This records that supplied provenance; it cannot attest a provider response.
 * Unsupported/missing originals retain explicit absence, never inferred values. */
export function buildPropsSourceContextAudit(args:{packet:GamePacket;review:AcceptedGameReview|null;observedAt:string;lookupAvailable?:boolean}):PropsSourceContextAudit{
 const {packet,review,observedAt}=args;
 const result:PropsSourceContextAudit={release:PROPS_SOURCE_CONTEXT_AUDIT_RELEASE,status:'invalid',reason:null,comparisonComplete:false,collectorCoverageAttested:false,forecastDecision:false,
  gameId:bounded(packet.sourceGameId??packet.gameId),packetGameId:bounded(packet.gameId),sport:packet.sport,start:bounded(packet.start),lock:bounded(packet.lock),cutoff:bounded(packet.cutoff),observedAt:bounded(observedAt),
  currentPacketHash:null,sourceInputRelease:optionalBounded(packet.sourceInputRelease),sourceOfferSetStatus:packet.sourceOfferSetStatus??'unspecified',
  executionSet:{provided:Array.isArray(packet.executionQuotes),rows:packet.executionQuotes?.length??0,hash:null},
  review:{status:args.lookupAvailable===false?'lookup_unavailable':review?'invalid_archive':'none',release:optionalBounded(review?.release),inputHash:optionalBounded(review?.inputHash),archiveDigest:optionalBounded(review?.inputEvidence?.digest),issuedAt:optionalBounded(review?.issuedAt),cutoff:optionalBounded(review?.cutoff)},
  counts:{originalActors:0,currentActors:packet.players.length,actors:0,evidenceRecords:0},actors:[]};
 const stop=(status:'overflow'|'invalid',reason:string)=>({...result,status,reason,comparisonComplete:false,actors:[]});
 try{
  if(packet.players.length>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.actors)return stop('overflow','actor_limit');
  if(packet.players.some(p=>p.id.length>256||p.markets.length>256||p.markets.some(m=>m.length>256)))return stop('overflow','scope_identity_limit');
  if(instant(packet.cutoff)>instant(observedAt))return stop('invalid','source_after_observation');
  const currentEvidence=packet.players.reduce((n,p)=>n+p.evidence.length,0);result.counts.evidenceRecords=currentEvidence;
  if(currentEvidence>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.evidenceRecords)return stop('overflow','evidence_limit');
  if(Buffer.byteLength(JSON.stringify(packet))>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.inputBytes)return stop('overflow','current_packet_bytes');
  validatePacket(packet);result.currentPacketHash=digest(packet);result.executionSet.hash=packet.executionQuotes?digest(packet.executionQuotes):null;
  const decoded=args.lookupAvailable===false?{status:'lookup_unavailable' as const,packet:null}:review?originalPacket(review,packet,observedAt):{status:'none' as const,packet:null};
  result.review.status=decoded.status;const old=decoded.packet;
  result.counts.originalActors=old?.players.length??0;
  const ids=sorted([...(old?.players.map(p=>p.id)??[]),...packet.players.map(p=>p.id)]);result.counts.actors=ids.length;
  if(ids.length>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.actors)return stop('overflow','actor_limit');
  result.counts.evidenceRecords+=(old?.players.reduce((n,p)=>n+p.evidence.length,0)??0);
  if(result.counts.evidenceRecords>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.evidenceRecords)return stop('overflow','evidence_limit');
  const originalCritical=old?criticalContextHashes(old):{};
  result.actors=ids.map(actorId=>{
   const original=old?.players.find(p=>p.id===actorId),current=packet.players.find(p=>p.id===actorId),accepted=review?.players.find(p=>p.playerId===actorId);
   const originalCanonicalHash=old&&original?readerCanonicalContextHash(old,actorId):null,currentCanonicalHash=current?readerCanonicalContextHash(packet,actorId):null;
   const originalAvailabilityHash=old&&original?readerAvailabilityContextHash(old,actorId):null,currentAvailabilityHash=current?readerAvailabilityContextHash(packet,actorId):null;
   const proof=accepted?.sourceReadProofs,admittedCanonicalHash=nullableString(proof?.canonicalContextHash),admittedAvailabilityHash=nullableString(proof?.availabilityContextHash);
   const originalScopes=sorted(original?.markets??[]),currentScopes=sorted(current?.markets??[]),acceptedScopes=sorted(review?.marketScopes[actorId]??[]);
   const inventory=evidenceAudit(original?.evidence??[],current?.evidence??[]),unchanged=inventory.filter(e=>e.change==='unchanged');
   // Exact inventory hashes/counts bind unchanged records without repeating
   // every source ID/value hash across every actor and game. Detail is reserved
   // for actual differences; an unavailable original is not an added-source claim.
   // Market evidence is already excluded by the established context guard.
   // Preserve its complete identity/value inventory and change counts, without
   // repeating every repriced historical quote record on every regular slate.
   const evidence=old?inventory.filter(e=>e.kind!=='market'&&e.change!=='unchanged'):[];
   const evidenceKinds=[...new Set(inventory.map(e=>e.kind))].sort().map(kind=>{
    const entries=inventory.filter(e=>e.kind===kind),count=(side:'original'|'current')=>entries.reduce((n,e)=>n+e[side].reduce((m,v)=>m+v.count,0),0);
    return{kind,originalHash:digest(entries.filter(e=>e.original.length).map(e=>({identityHash:e.identityHash,versions:e.original}))),currentHash:digest(entries.filter(e=>e.current.length).map(e=>({identityHash:e.identityHash,versions:e.current}))),originalRecords:count('original'),currentRecords:count('current'),changes:Object.fromEntries((['added','removed','value_changed','availability_only','unchanged'] as const).map(change=>[change,old?entries.filter(e=>e.change===change).length:0])) as Record<Change,number>};
   });
   return{actorId,originalPresent:Boolean(original),currentPresent:Boolean(current),acceptedActorPresent:Boolean(accepted),originalScopes,currentScopes,acceptedScopes,
    addedScopes:old?currentScopes.filter(m=>!originalScopes.includes(m)):[],removedScopes:old?originalScopes.filter(m=>!currentScopes.includes(m)):[],
    originalCanonicalHash,currentCanonicalHash,originalAvailabilityHash,currentAvailabilityHash,admittedCanonicalHash,admittedAvailabilityHash,
    admittedProofMatchesOriginal:old&&original?proof?.release===PROPS_AI_READER_CLAIMS_RELEASE&&proof.contextRelease===PROPS_AI_READER_CONTEXT_RELEASE&&proof.originalCriticalContextHash===originalCritical[actorId]&&review!.criticalContextHashes[actorId]===originalCritical[actorId]&&admittedCanonicalHash===originalCanonicalHash&&admittedAvailabilityHash===originalAvailabilityHash:null,
    canonicalChanged:originalCanonicalHash&&currentCanonicalHash?originalCanonicalHash!==currentCanonicalHash:null,availabilityChanged:originalAvailabilityHash&&currentAvailabilityHash?originalAvailabilityHash!==currentAvailabilityHash:null,
    changedEvidenceKinds:old?[...new Set(inventory.filter(e=>e.change!=='unchanged').map(e=>e.kind))].sort():[],
    evidenceInventory:{originalHash:original?digest(inventory.filter(e=>e.original.length).map(e=>({identityHash:e.identityHash,versions:e.original}))):null,currentHash:current?digest(inventory.filter(e=>e.current.length).map(e=>({identityHash:e.identityHash,versions:e.current}))):null,originalRecords:original?.evidence.length??0,currentRecords:current?.evidence.length??0,unchangedRecords:unchanged.reduce((n,e)=>n+e.current.reduce((m,v)=>m+v.count,0),0),unchangedHash:old?digest(unchanged):null,comparisonAvailable:Boolean(old)},
    detailGranularity:'non_market_changed_records' as const,evidenceKinds,
    originalQualification:old&&original?qualification(old,original):null,currentQualification:current?qualification(packet,current):null,evidence};
  });
  result.status='complete';result.comparisonComplete=decoded.status==='verified';
  if(Buffer.byteLength(JSON.stringify(result))>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.outputBytes)return stop('overflow','output_bytes');
  return result;
 }catch{return stop('invalid','source_audit_unavailable');}
}

/** Bounded slate attachment; overflow removes proof rather than silently
 * presenting the retained subset as the entire slate. Stored locks are external. */
export function buildPropsSourceContextAuditSlate(audits:readonly PropsSourceContextAudit[]){
 const overflow=audits.length>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.games||audits.reduce((n,a)=>n+a.counts.actors,0)>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.actors
  ||Buffer.byteLength(JSON.stringify(audits))>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.outputBytes;
 return{release:PROPS_SOURCE_CONTEXT_AUDIT_RELEASE,status:overflow?'overflow' as const:'complete' as const,gameCount:audits.length,comparisonComplete:!overflow&&audits.every(a=>a.status==='complete'&&a.comparisonComplete),collectorCoverageAttested:false as const,audits:overflow?[]:[...audits]};
}

/** Validate already stored prospective metadata without re-dating it or
 * reconstructing any source. The original canonical receipt stays untouched. */
export function retainedPropsSourceContextAudits(value:unknown,args:{slateDate:string;generatedAt:string;games:readonly {gameId:string;scheduledStart:string}[]}):{status:'absent'|'retained'|'unavailable';audits:PropsSourceContextAudit[]}{
 if(value===undefined)return{status:'absent',audits:[]};
 const unavailable=()=>({status:'unavailable' as const,audits:[]});
 try{
  if(!value||typeof value!=='object'||Buffer.byteLength(JSON.stringify(value))>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.outputBytes)return unavailable();
  const slate=value as ReturnType<typeof buildPropsSourceContextAuditSlate>;
  const exact=(v:unknown,keys:string)=>Boolean(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===keys.split(' ').sort().join('|'));
  if(!exact(slate,'release status gameCount comparisonComplete collectorCoverageAttested audits')||slate.release!==PROPS_SOURCE_CONTEXT_AUDIT_RELEASE||slate.status!=='complete'||slate.collectorCoverageAttested!==false||!Array.isArray(slate.audits)
   ||slate.gameCount!==slate.audits.length||slate.gameCount>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.games
   ||slate.comparisonComplete!==slate.audits.every(a=>a.status==='complete'&&a.comparisonComplete))return unavailable();
  const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
  // All serialized hash fields, including every individual changed source
  // value and complete-kind inventory, must keep their original hash form.
  const hashesValid=(v:unknown):boolean=>v===null||typeof v!=='object'||Object.entries(v).every(([k,x])=>k==='hash'||k.endsWith('Hash')||k==='inputHash'||k==='archiveDigest'?x===null||hash(x):hashesValid(x));
  const ids=new Set<string>();let actors=0;
  for(const a of slate.audits){
   const game=args.games.find(g=>g.gameId===a.gameId);
   if(!exact(a,'release status reason comparisonComplete collectorCoverageAttested forecastDecision gameId packetGameId sport start lock cutoff observedAt currentPacketHash sourceInputRelease sourceOfferSetStatus executionSet review counts actors')
    ||!exact(a.executionSet,'provided rows hash')||typeof a.executionSet.provided!=='boolean'||!count(a.executionSet.rows)
    ||!exact(a.review,'status release inputHash archiveDigest issuedAt cutoff')||!exact(a.counts,'originalActors currentActors actors evidenceRecords')
    ||a.release!==PROPS_SOURCE_CONTEXT_AUDIT_RELEASE||a.status!=='complete'||a.reason!==null||a.sport!=='nba'||a.collectorCoverageAttested!==false||a.forecastDecision!==false
    ||!game||ids.has(a.gameId)||etDate(a.start)!==args.slateDate||instant(a.start)!==instant(game.scheduledStart)||instant(a.lock)!==instant(a.start)-3600000
    ||instant(a.cutoff)>=instant(a.lock)||instant(a.cutoff)>instant(a.observedAt)||instant(a.observedAt)>instant(args.generatedAt)||!hash(a.currentPacketHash)
    ||!['verified','none','lookup_unavailable','unsupported_release','invalid_archive','binding_mismatch'].includes(a.review.status)||a.comparisonComplete!==(a.review.status==='verified')
    ||!Array.isArray(a.actors)||a.counts.actors!==a.actors.length||!count(a.counts.evidenceRecords)||a.counts.evidenceRecords>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.evidenceRecords
    ||a.counts.originalActors!==a.actors.filter(p=>p.originalPresent).length||a.counts.currentActors!==a.actors.filter(p=>p.currentPresent).length||!hashesValid(a))return unavailable();
   ids.add(a.gameId);actors+=a.actors.length;if(actors>PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.actors)return unavailable();
   const actorIds=new Set<string>();let evidence=0;
   for(const p of a.actors){
    if(!exact(p,'actorId originalPresent currentPresent acceptedActorPresent originalScopes currentScopes acceptedScopes addedScopes removedScopes originalCanonicalHash currentCanonicalHash originalAvailabilityHash currentAvailabilityHash admittedCanonicalHash admittedAvailabilityHash admittedProofMatchesOriginal canonicalChanged availabilityChanged changedEvidenceKinds evidenceInventory detailGranularity evidenceKinds originalQualification currentQualification evidence')
     ||![p.originalPresent,p.currentPresent,p.acceptedActorPresent].every(v=>typeof v==='boolean')||![p.admittedProofMatchesOriginal,p.canonicalChanged,p.availabilityChanged].every(v=>v===null||typeof v==='boolean')
     ||!exact(p.evidenceInventory,'originalHash currentHash originalRecords currentRecords unchangedRecords unchangedHash comparisonAvailable')||typeof p.evidenceInventory.comparisonAvailable!=='boolean'
     ||typeof p.actorId!=='string'||p.actorId.length>256||actorIds.has(p.actorId)||p.detailGranularity!=='non_market_changed_records'
     ||![p.originalScopes,p.currentScopes,p.acceptedScopes,p.addedScopes,p.removedScopes].every(s=>Array.isArray(s)&&s.length<=256&&s.every(v=>typeof v==='string'&&v.length<=256)&&new Set(s).size===s.length)
     ||p.originalPresent&&!hash(p.originalCanonicalHash)||p.currentPresent&&!hash(p.currentCanonicalHash)
     ||p.originalPresent&&!hash(p.originalAvailabilityHash)||p.currentPresent&&!hash(p.currentAvailabilityHash)
     ||!count(p.evidenceInventory.originalRecords)||!count(p.evidenceInventory.currentRecords)||!count(p.evidenceInventory.unchangedRecords)
     ||p.originalPresent&&!hash(p.evidenceInventory.originalHash)||p.currentPresent&&!hash(p.evidenceInventory.currentHash)
     ||!Array.isArray(p.evidence)||!Array.isArray(p.evidenceKinds))return unavailable();
    actorIds.add(p.actorId);evidence+=p.evidenceInventory.originalRecords+p.evidenceInventory.currentRecords;
    for(const q of [p.originalQualification,p.currentQualification])if(q!==null&&(!exact(q,'release status blocked reason conflict availableAt effectiveAt factCount factsHash')||!['blocked','eligible','unknown'].includes(q.status)||typeof q.blocked!=='boolean'||typeof q.conflict!=='boolean'||!count(q.factCount)||!hash(q.factsHash)))return unavailable();
    for(const e of p.evidence){if(!exact(e,'identityHash recordIdHash sourceHash kind change original current')||!['recent_games','matchup_history','availability','matchup','independent_model'].includes(e.kind)||!['added','removed','value_changed','availability_only'].includes(e.change)||!hash(e.identityHash)||!hash(e.recordIdHash)||!hash(e.sourceHash))return unavailable();for(const versions of [e.original,e.current]){if(!Array.isArray(versions))return unavailable();for(const v of versions)if(!exact(v,'valueHash availableAt count')||!hash(v.valueHash)||!count(v.count)||v.count===0||instant(v.availableAt)>instant(a.cutoff))return unavailable();}}
    for(const k of p.evidenceKinds)if(!exact(k,'kind originalHash currentHash originalRecords currentRecords changes')||!exact(k.changes,'added removed value_changed availability_only unchanged')||!['recent_games','matchup_history','availability','matchup','independent_model','market'].includes(k.kind)||!count(k.originalRecords)||!count(k.currentRecords)||!hash(k.originalHash)||!hash(k.currentHash)||!Object.values(k.changes).every(count))return unavailable();
   }
   if(evidence!==a.counts.evidenceRecords)return unavailable();
  }
  return{status:'retained',audits:[...slate.audits]};
 }catch{return unavailable();}
}
