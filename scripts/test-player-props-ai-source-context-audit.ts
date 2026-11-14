/** Pure actual-source audit controls; no provider, database, model or count I/O. */
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {buildPropsSourceContextAudit,buildPropsSourceContextAuditSlate,retainedPropsSourceContextAudits,PROPS_SOURCE_CONTEXT_AUDIT_LIMITS} from '../lib/playerPropsAi/sourceContextAudit';
import {digest} from '../lib/playerPropsAi/evidence';
import {nbaAuthorityFixture,nbaAuthorityReview} from './test-player-props-ai-nba-lock-authority';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {GamePacket,Json} from '../lib/playerPropsAi/evidenceContract';
globalThis.fetch=async()=>{throw Error('Source audit forbids network');};
const at='2026-11-10T22:24:00Z',base=nbaAuthorityFixture().packet;
function accepted(packet:GamePacket=base){
 const raw=JSON.stringify(packet),review=nbaAuthorityReview(packet);
 return{...review,gameId:packet.gameId,inputEvidence:{encoding:'gzip-base64' as const,digest:digest(packet),bytes:Buffer.byteLength(raw),data:gzipSync(raw).toString('base64')}};
}
const review=accepted(),before=JSON.stringify({base,review});
for(const release of [review.release,'player_props_ai_2026_11_11_r36_urgent_slot_cohorts','player_props_ai_2026_11_11_r35_terminal_wave_guard','player_props_ai_2026_11_11_r34_source_mean_admission','player_props_ai_2026_11_11_r33_two_phase_review_window','player_props_ai_2026_11_11_r32_lossless_reader_tables','player_props_ai_2026_11_10_r31_verified_reader_claims'] as const){
 const result=buildPropsSourceContextAudit({packet:base,review:{...review,release},observedAt:at});
 assert.equal(result.status,'complete');assert.equal(result.review.status,'verified');assert(result.comparisonComplete);
 assert(result.actors.every(a=>a.canonicalChanged===false&&a.availabilityChanged===false&&a.admittedProofMatchesOriginal));
 assert(result.actors.every(a=>a.evidence.length===0&&a.evidenceInventory.unchangedRecords===base.players.find(p=>p.id===a.actorId)!.evidence.length&&a.evidenceInventory.originalHash===a.evidenceInventory.currentHash));
 assert.equal(result.currentPacketHash,digest(base));assert.equal(result.executionSet.rows,base.executionQuotes!.length);
 assert.equal(result.collectorCoverageAttested,false);assert.equal(result.forecastDecision,false);
 const json=JSON.stringify(result);for(const p of base.players){assert(!json.includes(p.name));for(const e of p.evidence){assert(!json.includes(e.source));assert(!json.includes(e.id));}}
}
const current=structuredClone(base);current.cutoff=at;
current.players[0].evidence[0].availableAt='2026-11-10T20:00:01Z';
current.players[0].evidence.push({id:'new-private-report',kind:'availability',source:'private source name',availableAt:at,value:{canonicalGameId:base.gameId,scheduledStart:base.start,context:{away:{team:'BOS',known:true,players:[{name:base.players[0].name,status:'out',reportedAt:at}]},home:{team:'NYK',known:true,players:[]}}}});
current.players[0].markets.push('assists');current.players[1].evidence.shift();
const changed=buildPropsSourceContextAudit({packet:current,review,observedAt:at});assert.equal(changed.status,'complete');
const retainedR35={...review,release:'player_props_ai_2026_11_11_r35_terminal_wave_guard' as const},r35Before=JSON.stringify(retainedR35);
const retainedChange=buildPropsSourceContextAudit({packet:current,review:retainedR35,observedAt:at});assert.equal(retainedChange.review.status,'verified');assert(retainedChange.comparisonComplete);assert(retainedChange.actors[0].canonicalChanged&&retainedChange.actors[0].currentQualification?.blocked);assert.equal(JSON.stringify(retainedR35),r35Before,'R35 law and archive remain opaque and exact');
const a=changed.actors.find(a=>a.actorId==='a')!;assert(a.canonicalChanged&&a.availabilityChanged);assert.equal(a.currentQualification?.blocked,true);assert.equal(a.originalQualification?.blocked,false);assert.deepEqual(a.addedScopes,['assists']);assert(a.evidence.some(e=>e.change==='availability_only'));assert(a.evidence.some(e=>e.change==='added'&&e.kind==='availability'));
assert(changed.actors.find(a=>a.actorId==='b')!.evidence.some(e=>e.change==='removed'));
const value=structuredClone(base);(value.players[0].evidence[0].value as {box:{points:number}}).box.points++;
assert(buildPropsSourceContextAudit({packet:value,review,observedAt:at}).actors[0].evidence.some(e=>e.change==='value_changed'));
const market=structuredClone(base);market.players[0].evidence.push({id:'new-market-source',kind:'market',source:'synthetic price feed',availableAt:base.cutoff,value:{american:125}});
const marketAudit=buildPropsSourceContextAudit({packet:market,review,observedAt:at}).actors[0];assert.equal(marketAudit.canonicalChanged,false);assert.notEqual(marketAudit.evidenceInventory.originalHash,marketAudit.evidenceInventory.currentHash);assert.equal(marketAudit.detailGranularity,'non_market_changed_records');assert.equal(marketAudit.evidence.length,0);assert.equal(marketAudit.evidenceKinds.find(k=>k.kind==='market')!.changes.added,1,'Every market change stays in exact kind inventory without individual record repetition');
const deleted=structuredClone(base);deleted.players=deleted.players.filter(p=>p.id!=='b');deleted.quotes=deleted.quotes.filter(q=>q.playerId!=='b');deleted.executionQuotes=deleted.executionQuotes!.filter(q=>q.playerId!=='b');
assert.equal(buildPropsSourceContextAudit({packet:deleted,review,observedAt:at}).actors.find(a=>a.actorId==='b')!.currentPresent,false);
const added=structuredClone(base);added.players.push({...structuredClone(added.players[0]),id:'new_actor',evidence:[]});
assert.equal(buildPropsSourceContextAudit({packet:added,review,observedAt:at}).actors.find(a=>a.actorId==='new_actor')!.originalPresent,false);
// No accepted-law/wire reparse: even a law getter which throws is never read.
const opaque={...accepted(),release:'player_props_ai_2026_11_11_r35_terminal_wave_guard' as const};for(const player of opaque.players)Object.defineProperty(player,'law',{get(){throw Error('Do not reparse a stored law');}});
assert.equal(buildPropsSourceContextAudit({packet:base,review:opaque,observedAt:at}).review.status,'verified');
for(const release of ['player_props_ai_2026_11_10_r29_identity_and_execution_evidence','unrecognized'] as const){const legacy={...review,release,inputEvidence:{...review.inputEvidence,data:'bad'}} as unknown as AcceptedGameReview;assert.equal(buildPropsSourceContextAudit({packet:base,review:legacy,observedAt:at}).review.status,'unsupported_release');}
for(const mutate of [(r:AcceptedGameReview)=>{r.inputHash='f'.repeat(64);},(r:AcceptedGameReview)=>{r.inputEvidence.bytes++;},(r:AcceptedGameReview)=>{r.inputEvidence.data='bad';},(r:AcceptedGameReview)=>{r.inputEvidence.digest='f'.repeat(64);}]){const broken=structuredClone(review);mutate(broken);const result=buildPropsSourceContextAudit({packet:base,review:broken,observedAt:at});assert.equal(result.review.status,'invalid_archive');assert(!result.comparisonComplete);assert(result.actors.every(a=>a.originalCanonicalHash===null));}
assert.equal(buildPropsSourceContextAudit({packet:base,review:{...review,sourceGameId:'foreign'},observedAt:at}).review.status,'binding_mismatch');
const badProof=structuredClone(review);badProof.players[0].sourceReadProofs!.canonicalContextHash='f'.repeat(64);assert.equal(buildPropsSourceContextAudit({packet:base,review:badProof,observedAt:at}).actors[0].admittedProofMatchesOriginal,false);
assert.equal(buildPropsSourceContextAudit({packet:base,review,observedAt:at,lookupAvailable:false}).review.status,'lookup_unavailable');
assert.equal(buildPropsSourceContextAudit({packet:base,review:null,observedAt:at}).review.status,'none');
assert.equal(buildPropsSourceContextAudit({packet:base,review,observedAt:'2026-11-10T19:00:00Z'}).reason,'source_after_observation');
const many=structuredClone(base);many.players=Array(PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.actors+1).fill(base.players[0]);const overflow=buildPropsSourceContextAudit({packet:many,review,observedAt:at});assert.equal(overflow.status,'overflow');assert.equal(overflow.actors.length,0);assert(!overflow.comparisonComplete);
const records=structuredClone(base);records.players[0].evidence=Array(PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.evidenceRecords+1).fill(base.players[0].evidence[0]);assert.equal(buildPropsSourceContextAudit({packet:records,review,observedAt:at}).reason,'evidence_limit');
const huge=structuredClone(base);huge.players[0].evidence[0].value={blob:'x'.repeat(PROPS_SOURCE_CONTEXT_AUDIT_LIMITS.inputBytes)} as Json;assert.equal(buildPropsSourceContextAudit({packet:huge,review,observedAt:at}).reason,'current_packet_bytes');
const audit=buildPropsSourceContextAudit({packet:base,review,observedAt:at}),slate=buildPropsSourceContextAuditSlate([audit]);assert(slate.comparisonComplete);assert.equal(slate.collectorCoverageAttested,false);const slateOverflow=buildPropsSourceContextAuditSlate(Array(17).fill(audit));assert.equal(slateOverflow.status,'overflow');assert.equal(slateOverflow.audits.length,0);assert(!slateOverflow.comparisonComplete);
const retention={slateDate:'2026-11-10',generatedAt:at,games:[{gameId:base.gameId,scheduledStart:base.start}]},slateBytes=JSON.stringify(slate);
assert.deepEqual(retainedPropsSourceContextAudits(slate,retention),{status:'retained',audits:slate.audits});assert.equal(JSON.stringify(slate),slateBytes,'Retention never mutates the canonical prior or re-dates source evidence');
assert.equal(retainedPropsSourceContextAudits(undefined,retention).status,'absent');
assert.equal(retainedPropsSourceContextAudits(slate,{...retention,slateDate:'2026-11-11'}).status,'unavailable');
for(const mutate of [(s:typeof slate)=>{s.release='unknown' as never;},(s:typeof slate)=>{s.audits[0].actors[0].currentCanonicalHash='broken';},(s:typeof slate)=>{s.audits[0].observedAt='2026-11-10T22:25:00Z';},(s:typeof slate)=>{s.audits[0].counts.evidenceRecords++;},(s:typeof slate)=>{s.audits[0].actors[0].evidenceInventory.currentHash='broken';},(s:typeof slate)=>{s.gameCount++;},(s:typeof slate)=>{Object.assign(s.audits[0],{rawSource:{privateName:'private'}});}]){const invalid=structuredClone(slate);mutate(invalid);assert.deepEqual(retainedPropsSourceContextAudits(invalid,retention),{status:'unavailable',audits:[]});}
assert.equal(JSON.stringify({base,review}),before,'No packet, accepted review, evidence, law or locked data is mutated');
console.log('Source context audit passed: exact current/R31/R32 immutable archive binding, source/multiplicity/value/clock/scope/qualification differences, no law/wire reparse or raw names/values, unsupported/corrupt/missing originals, explicit bounds and zero-I/O immutability.');
