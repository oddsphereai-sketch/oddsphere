/** Private forensic retention only; original identity acceptance never changes. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {syntheticNflIdentityFailureArgs} from './test-player-props-ai-nfl-identity-failure-evidence';
import {buildNflIdentityFailureEvidence,decodeNflIdentityFailureArchive,appendNflIdentityFailureEvidence,
 LEGACY_NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE,NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE,NFL_IDENTITY_FAILURE_RAW_LIMIT,
 NFL_IDENTITY_FAILURE_GZIP_LIMIT,NFL_IDENTITY_FAILURE_RECORD_LIMIT,NFL_IDENTITY_FAILURE_SEMANTIC_LIMIT,
 type NflIdentityFailureArgs,type NflIdentityFailureRecord} from '../lib/playerPropsAi/nflIdentityFailureEvidence';
import {resolveNflPropSourcePlayer} from '../lib/playerPropsAi/nflPlayerIdentity';
import {CATALOG} from '../lib/playerPropsAi/evidenceContract';
import {digest,stable} from '../lib/playerPropsAi/evidence';

globalThis.fetch=async()=>{throw Error('NFL source-failure R2 proof forbids HTTP');};
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const ready=(args:NflIdentityFailureArgs)=>{const c=buildNflIdentityFailureEvidence(args);if(c.kind!=='ready')throw Error(c.reason);assert.equal(c.kind,'ready');return c;};

/** Synthetic counts mirror one saved production shape, never its identities/data. */
export function syntheticNflIdentityFailureScaleArgs(at?:string):NflIdentityFailureArgs{
 const a=syntheticNflIdentityFailureArgs(at),template=a.observations.observations[0],known=(i:number)=>({id:`scale-${i}`,name:`Synthetic scale player ${String.fromCharCode(65+Math.floor(i/26))}${String.fromCharCode(65+i%26)}`});
 const row=(i:number,opening=false)=>{const p=known(i<8?0:1+(i-8)%63);return{...template,providerObservationId:`synthetic-scale-${i}`,providerPlayerId:p.id,playerName:p.name,playerTeam:i<8?null:'TB',market:CATALOG.nfl.required[Math.floor(Math.max(0,i-8)/63)%CATALOG.nfl.required.length],isOpening:opening};};
 const candidates=Array.from({length:2104},(_,i)=>row(i));
 const openings=Array.from({length:4418-candidates.length},(_,i)=>row(i+8,true));
 const irrelevant=Array.from({length:52739-4418},(_,i)=>({...template,canonicalGameId:'synthetic-other-game',providerObservationId:`synthetic-other-${i}`}));
 a.observations.observations=[...candidates,...openings,...irrelevant];
 a.context.games[0].awayDepth.roster=Array.from({length:63},(_,i)=>{const p=known(i+1);return{playerId:p.id,name:p.name,position:'RB'};}) as typeof a.context.games[0]['awayDepth']['roster'];
 const native=a.snapshot.board.decisions[0];
 a.snapshot.board.decisions=Array.from({length:264},(_,i)=>{const p=known(i%63+1);return{...native,providerPlayerId:p.id,playerName:p.name,team:'TB'};});
 a.snapshot.memberDecisions=Array.from({length:120},(_,i)=>({...a.snapshot.board.decisions[i],opponent:'CHI',market:CATALOG.nfl.required[i%CATALOG.nfl.required.length]})) as typeof a.snapshot.memberDecisions;
 return a;
}

function repack(record:NflIdentityFailureRecord,change:(input:Record<string,unknown>)=>void){
 const altered=structuredClone(record),input=JSON.parse(gunzipSync(Buffer.from(altered.archive!.data,'base64')).toString());change(input);
 const raw=Buffer.from(JSON.stringify(input)),gzip=gzipSync(raw);
 altered.archive={encoding:'gzip-base64',bytes:raw.length,sha256:sha(raw),gzipBytes:gzip.length,gzipSha256:sha(gzip),data:gzip.toString('base64')};
 altered.sourceHashes.identityInput=sha(raw);return altered;
}

/** Dynamic SQL clock fixture only. Golden comparison proves the original R1
 * small-record bytes; this never converts a stored historical record. */
export function syntheticLegacyNflFailureRecord(args:NflIdentityFailureArgs){
 const r=ready(args).record;assert.equal(r.status,'captured');assert(Buffer.byteLength(r.semanticCanonical)<NFL_IDENTITY_FAILURE_SEMANTIC_LIMIT);
 const semantic=JSON.parse(r.semanticCanonical);semantic.release=LEGACY_NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE;
 // The frozen original writer used R36; future application generation changes
 // must never change this explicitly legacy rolling-deploy fixture.
 r.generationRelease='player_props_ai_2026_11_11_r36_urgent_slot_cohorts';semantic.generationRelease=r.generationRelease;
 r.release=LEGACY_NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE;r.semanticCanonical=stable(semantic);r.semanticSha256=sha(r.semanticCanonical);
 return repack(r,input=>{input.release=r.release;(input.binding as Record<string,unknown>).release=r.release;(input.binding as Record<string,unknown>).generationRelease=r.generationRelease;input.semanticCanonical=r.semanticCanonical;});
}

export async function runNflSourceFailureR2Proof(){
 const legacy=JSON.parse(readFileSync('scripts/fixtures/player-props-ai/source-failure-r1.json','utf8')) as {small:ReturnType<typeof ready>;semanticBound:ReturnType<typeof ready>;scale:ReturnType<typeof ready>};
 const legacyBefore=digest(legacy),legacyBytes=JSON.stringify(legacy.small.record.archive);
 assert.equal(legacy.small.record.release,LEGACY_NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE);
 assert.deepEqual(syntheticLegacyNflFailureRecord(syntheticNflIdentityFailureArgs()),legacy.small.record,'Dynamic SQL R1 fixture matches every original frozen R1 byte');
 const legacyDecoded=decodeNflIdentityFailureArchive(legacy.small.record) as {semanticCanonical:string};
 assert.equal(legacyDecoded.semanticCanonical,legacy.small.record.semanticCanonical);
 assert.equal(legacy.semanticBound.record.archiveUnavailable,'semantic_bound');assert.equal(legacy.semanticBound.record.archive,null);
 assert.throws(()=>decodeNflIdentityFailureArchive(legacy.semanticBound.record),/archive unavailable/);
 assert.equal(JSON.parse(legacy.semanticBound.record.semanticCanonical).state.bytes,149471,'Frozen R1 negative control is never reconstructed as R2');

 const args=syntheticNflIdentityFailureScaleArgs(),protectedBefore=digest(args),capture=ready(args),record=capture.record;
 assert.equal(record.release,NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE);assert.equal(record.status,'captured');assert.equal(record.archiveUnavailable,null);
 const stub=JSON.parse(record.semanticCanonical);assert.equal(stub.state.unavailable,'semantic_bound');assert(stub.state.bytes>NFL_IDENTITY_FAILURE_SEMANTIC_LIMIT);
 assert(Buffer.byteLength(record.semanticCanonical)<=NFL_IDENTITY_FAILURE_SEMANTIC_LIMIT);
 assert(record.archive!.bytes<=NFL_IDENTITY_FAILURE_RAW_LIMIT);assert(record.archive!.gzipBytes<=NFL_IDENTITY_FAILURE_GZIP_LIMIT);assert(Buffer.byteLength(JSON.stringify(record))<=NFL_IDENTITY_FAILURE_RECORD_LIMIT);
 assert.deepEqual(record.counts,{sourceRows:52739,relevantRows:4418,candidateRows:2104,failedRows:8,nativeRows:264,memberRows:120,contexts:1});
 const input=decodeNflIdentityFailureArchive(record) as {binding:unknown;semanticCanonical:string;relevantObservations:{index:number;row:NflIdentityFailureArgs['observations']['observations'][number]}[];candidateSourceIndices:number[];
  nativeHeader:{generatedAt:string};nativeIdentityRows:{identity:{gameId:string;scheduledStart:string;providerPlayerId:string;playerName:string;team:string;observedAt:string;featureAsOf:string}}[];
  observationsHeader:{generatedAt:string};contextHeader:Record<string,unknown>;contexts:{game:NflIdentityFailureArgs['context']['games'][number]}[];outcomes:{index:number;code:string;identity:unknown}[]};
 assert.equal(sha(input.semanticCanonical),stub.state.sha256);assert.equal(Buffer.byteLength(input.semanticCanonical),stub.state.bytes);
 const originalSemantic=JSON.parse(input.semanticCanonical);originalSemantic.release=LEGACY_NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE;originalSemantic.generationRelease='player_props_ai_2026_11_11_r36_urgent_slot_cohorts';
 const originalCanonical=stable(originalSemantic),originalStub=JSON.parse(legacy.scale.record.semanticCanonical);
 assert.equal(legacy.scale.record.archiveUnavailable,'semantic_bound');assert.equal(legacy.scale.record.archive,null);
 assert.deepEqual(legacy.scale.record.counts,record.counts);assert.equal(originalStub.state.bytes,Buffer.byteLength(originalCanonical));assert.equal(originalStub.state.sha256,sha(originalCanonical),'Full original semantics match the pinned R1 same-scale negative control exactly');
 for(const [key,hash]of Object.entries(legacy.scale.record.sourceHashes))assert.equal(record.sourceHashes[key],hash,'Same exact source/native/member/context inputs as the original R1 scale fixture');
 assert.equal(input.relevantObservations.length,4418);assert.equal(input.candidateSourceIndices.length,2104);assert.equal(input.outcomes.length,2104);
 assert.deepEqual(input.relevantObservations.map(r=>r.row),args.observations.observations.slice(0,4418));
 // Replay precisely the archived resolver inputs; no current cache substitutes.
 const candidates=input.relevantObservations.filter(r=>input.candidateSourceIndices.includes(r.index));
 const native=input.nativeIdentityRows.map(({identity:{featureAsOf,...row}})=>({...row,forecastContext:{featureAsOf}}));
 const context={...input.contextHeader,games:input.contexts.map(c=>c.game)} as NflIdentityFailureArgs['context'];
 const replay=candidates.map(({index,row})=>{const identity=resolveNflPropSourcePlayer({row,rows:native as NflIdentityFailureArgs['snapshot']['board']['decisions'],observations:candidates.map(c=>c.row),context,game:args.game,cutoff:args.window.cutoff,observationsAvailableAt:input.observationsHeader.generatedAt,storedAvailableAt:input.nativeHeader.generatedAt});return{index,code:identity?'resolved':'unresolved',identity};});
 assert.deepEqual(replay,input.outcomes);assert.equal(replay.filter(r=>r.code==='unresolved').length,8);assert(replay.some(r=>r.code==='resolved'),'Healthy quote-only identities remain admitted by the same resolver');
 const churn=structuredClone(args);churn.observations.observations.forEach(r=>{r.americanPrice=140;r.providerObservationId+='-churn';});const changed=ready(churn).record;
 assert.equal(changed.semanticSha256,record.semanticSha256,'Bounded dedup still binds full semantics, not prices/poll IDs');assert.notEqual(changed.archive!.sha256,record.archive!.sha256);
 const identity=structuredClone(args);identity.observations.observations[0].providerPlayerId='different-unresolved-id';assert.notEqual(ready(identity).record.semanticSha256,record.semanticSha256);
 const timing=structuredClone(args);timing.context.capturedAt=new Date(Date.parse(args.observedAt)+1).toISOString();assert.notEqual(ready(timing).record.semanticSha256,record.semanticSha256);

 for(const field of ['sha256','bytes'] as const){const changed=structuredClone(record),semantic=JSON.parse(changed.semanticCanonical);semantic.state[field]=field==='bytes'?semantic.state.bytes+1:'f'.repeat(64);changed.semanticCanonical=stable(semantic);changed.semanticSha256=sha(changed.semanticCanonical);assert.throws(()=>decodeNflIdentityFailureArchive(changed),/bounded semantic binding/);}
 assert.throws(()=>decodeNflIdentityFailureArchive(repack(record,input=>{input.semanticCanonical=String(input.semanticCanonical).replace('scale-0','other-0');})),/bounded semantic binding/);
 assert.throws(()=>decodeNflIdentityFailureArchive(repack(record,input=>{const s=JSON.parse(String(input.semanticCanonical));s.nativeGameId='wrong';input.semanticCanonical=stable(s);})),/full semantic binding/);
 assert.throws(()=>decodeNflIdentityFailureArchive(repack(record,input=>{(input.binding as Record<string,unknown>).writerRunId='wrong';})),/archive binding/);
 const garbage=structuredClone(record);garbage.archive!.data='A'+garbage.archive!.data.slice(1);assert.throws(()=>decodeNflIdentityFailureArchive(garbage));
 for(const altered of [{...record,release:'unknown'}, {...record,archive:{...record.archive!,bytes:NFL_IDENTITY_FAILURE_RAW_LIMIT+1}}, {...record,archive:{...record.archive!,gzipBytes:NFL_IDENTITY_FAILURE_GZIP_LIMIT+1}}])assert.throws(()=>decodeNflIdentityFailureArchive(altered as NflIdentityFailureRecord));
 const small=ready(syntheticNflIdentityFailureArgs()).record;assert.equal((decodeNflIdentityFailureArchive(small) as {semanticCanonical:string}).semanticCanonical,small.semanticCanonical,'Small R2 records retain exact semantics without a stub');
 let appends=0;const client={rpc:()=>{appends++;return{abortSignal:async()=>({data:{status:'stored'},error:null})};}} as unknown as Parameters<typeof appendNflIdentityFailureEvidence>[0];
 assert.equal((await appendNflIdentityFailureEvidence(client,capture)).status,'stored');assert.equal((await appendNflIdentityFailureEvidence(client,legacy.small)).status,'stored');
 assert.equal((await appendNflIdentityFailureEvidence(client,{...capture,record:garbage})).status,'unavailable');assert.equal(appends,2);
 assert.equal(digest(args),protectedBefore,'Original native/member payload and every source input remain byte-stable');assert.equal(digest(legacy),legacyBefore);assert.equal(JSON.stringify(legacy.small.record.archive),legacyBytes);
 const v69=readFileSync('lib/db/schema-migration-v69-player-props-ai-source-failures.sql','utf8'),v72=readFileSync('lib/db/schema-migration-v72-player-props-ai-source-failure-r2.sql','utf8'),start='CREATE OR REPLACE FUNCTION public.player_props_ai_append_source_failure_v1';
 const originalSql=v69.slice(v69.indexOf(start),v69.indexOf('COMMENT ON TABLE'));
 let sameSql=v72.slice(v72.indexOf(start),v72.lastIndexOf('COMMIT;')).replace(`coalesce(p_capture->>'release','') NOT IN ('${LEGACY_NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE}','${NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE}')`,`p_capture->>'release' IS DISTINCT FROM '${LEGACY_NFL_IDENTITY_FAILURE_EVIDENCE_RELEASE}'`);
 sameSql=sameSql.slice(0,sameSql.indexOf("  -- R2's bounded semantic stub"))+sameSql.slice(sameSql.indexOf("  IF jsonb_typeof(p_capture->'counts')"));
 assert.equal(sameSql,originalSql,'All original SQL ACL/lease/job/time/size/dedup/overflow checks remain byte-exact; real PostgreSQL execution is separately required');
 console.log('NFL source-failure R2 pure proof passed: exact production-scale counts, eight unresolved rows replayed, unchanged healthy resolver acceptance, bounded full-semantic archive/dedup, frozen R1 precedence, mixed-version append, corruption and unchanged source/native/member payloads. No HTTP/DB/model calls.',JSON.stringify({semanticBytes:stub.state.bytes,rawBytes:record.archive!.bytes,gzipBytes:record.archive!.gzipBytes,recordBytes:Buffer.byteLength(JSON.stringify(record))}));
}
if(process.argv[1]?.endsWith('test-player-props-ai-nfl-source-failure-r2.ts'))runNflSourceFailureR2Proof().catch(error=>{console.error(error);process.exitCode=1;});
