/** Actual reader/admission/publication/lock functions; all data is synthetic. */
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {nbaAuthorityFixture,nbaAuthorityReview} from './test-player-props-ai-nba-lock-authority';
import type {GamePacket,Json} from '../lib/playerPropsAi/evidenceContract';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import {digest} from '../lib/playerPropsAi/evidence';
import {readerCanonicalContextHash} from '../lib/playerPropsAi/readerContext';
import {nbaBenchmarkContextHash,originalNbaBenchmarkPacket} from '../lib/playerPropsAi/nbaBenchmarkContext';
import {reviewedReaderContextCurrent,createReviewedReaderContextMatcher} from '../lib/playerPropsAi/readerClaimFreshness';
import {siteAiDecisions,siteReviewCoverage} from '../lib/playerPropsAi/publication';
import {applyNbaSiteAi,restoreNbaNativeGame} from '../lib/playerPropsAi/siteBindings';
import {testNbaSourceAuthority,testNbaHandoffCapture,mergeNbaHandoffs} from '../lib/playerPropsAi/nbaLockAuthority';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../lib/services/nba/nbaPlayerPropsLifecycle';
globalThis.fetch=async()=>{throw Error('Benchmark controls forbid network');};
Object.assign(process.env,{NODE_ENV:'test'});
const clone=structuredClone,source='nba_player_props_model_tournament_2026_10_28_r16_owls_sharp_market_reader',later='2026-11-10T22:27:00Z';
const f=nbaAuthorityFixture(),original=clone(f.packet),metric=(key:string,label:string,value:number,format:string)=>({key,label,value,format,provenance:'point_in_time_model_input'});
const A=metric('game_pace_mean_5','Matchup pace · L5',99,'decimal'),B=metric('opponent_adjusted_defense','Opponent adjusted defense',110,'decimal'),C=metric('opponent_rebound_chances_per100_5','Opponent rebound chances / 100 · L5',40,'decimal'),D=metric('team_assist_percentage_5','Team assist rate · L5',.6,'percent'),R=metric('minutes_mean_3','Minutes · L3',30,'minutes');
for(const p of original.players)for(const market of ['points','rebounds'])p.evidence.push({id:`${p.id}:model:${market}`,kind:'independent_model',source,availableAt:original.cutoff,value:{market,role:[R],matchup:market==='points'?[A,B]:[A,C]}});
const archive=(review:AcceptedGameReview,packet:GamePacket)=>{const raw=Buffer.from(JSON.stringify(packet));return{...review,gameId:packet.gameId,sourceGameId:packet.sourceGameId??packet.gameId,inputHash:digest(packet),inputEvidence:{encoding:'gzip-base64' as const,data:gzipSync(raw).toString('base64'),bytes:raw.length,digest:digest(packet)}};};
const review=archive(nbaAuthorityReview(original),original),before=digest({original,review});
function current(){const p=clone(original);p.cutoff=later;for(const actor of p.players)for(const e of actor.evidence.filter(e=>e.source===source)){const v=e.value as Record<string,Json>;v.matchup=clone(v.market==='points'?[C,A,B,A]:[A]);}for(const q of [...p.quotes,...p.executionQuotes!]){q.observedAt=later;q.receivedAt=later;}return p;}
const packet=current();assert.notEqual(readerCanonicalContextHash(packet,'a'),readerCanonicalContextHash(original,'a'));assert.equal(nbaBenchmarkContextHash(packet,'a'),nbaBenchmarkContextHash(original,'a'));assert(reviewedReaderContextCurrent(packet,review,'a'));assert.equal(siteAiDecisions(packet,review,later).length,3);
for(const release of ['player_props_ai_2026_11_17_r51_event_tail_navigation','player_props_ai_2026_11_18_r52_joint_dependence_navigation','player_props_ai_2026_11_25_r62_scoped_correction_output',review.release])assert(reviewedReaderContextCurrent(packet,{...review,release} as AcceptedGameReview,'a'),'Explicit original release compatibility');
assert(!reviewedReaderContextCurrent(packet,{...review,release:'player_props_ai_2026_11_17_r48_reference_identity_receipts'},'a'),'Older releases retain original comparison');
const matcher=createReviewedReaderContextMatcher(packet,review);for(let i=0;i<4;i++)for(const p of packet.players)assert(matcher(p.id));
const metricRows=(p:GamePacket)=>p.players[0].evidence.filter(e=>e.source===source).map(e=>(e.value as Record<string,Json>).matchup as Record<string,Json>[]);
const negatives:Array<[string,(p:GamePacket)=>void]>=[
 ['real value',p=>metricRows(p).flat().filter(m=>m.key===A.key).forEach(m=>m.value=101)],
 ['lost fact',p=>metricRows(p).forEach(a=>{for(let i=a.length-1;i>=0;i--)if(a[i].key===B.key)a.splice(i,1);})],
 ['added fact',p=>metricRows(p)[0].push(D)],
 ['conflicting same key',p=>metricRows(p)[0].push({...A,value:100})],
 ['unknown key',p=>metricRows(p)[0][0].key='unknown_context'],
 ['changed label',p=>metricRows(p)[0][0].label='Other meaning'],
 ['changed unit',p=>metricRows(p)[0][0].format='percent'],
 ['market provenance',p=>metricRows(p)[0][0].provenance='sportsbook_observation'],
 ['unknown annotation',p=>metricRows(p)[0][0].extra=true],
 ['foreign source',p=>p.players[0].evidence.filter(e=>e.source===source).forEach(e=>e.source='unknown-source')],
 ['real role',p=>{const e=p.players[0].evidence.find(e=>e.source===source)!;(e.value as Record<string,Json>).role=[{...R,value:20}];}],
 ['real stats',p=>{(p.players[0].evidence[0].value as Record<string,Json>).newSourceFact=1;}],
 ['changed identity',p=>p.players[0].team='MIA'],
 ['unknown context',p=>{const e=p.players[0].evidence.find(e=>e.source===source)!;(e.value as Record<string,Json>).context={unexpected:true};}],
 ['future source',p=>{p.players[0].evidence.find(e=>e.source===source)!.availableAt='2026-11-10T22:29:00Z';}],
 ['invalid source clock',p=>{p.players[0].evidence.find(e=>e.source===source)!.availableAt='invalid';}],
 ['ambiguous native identity',p=>p.players[0].evidence.push(clone(p.players[0].evidence.find(e=>e.source===source)!))],
 ['real medical',p=>p.players[0].evidence.push({id:'new-medical',kind:'availability',source:'synthetic current report',availableAt:later,value:{canonicalGameId:p.gameId,scheduledStart:p.start,context:{away:{team:'BOS',known:true,players:[{name:p.players[0].name,status:'out',reportedAt:later}]},home:{team:'NYK',known:true,players:[]}}}})],
];
for(const [label,mutate]of negatives){const p=current();mutate(p);assert.equal(reviewedReaderContextCurrent(p,review,'a'),false,label);}
for(const mutate of [(r:AcceptedGameReview)=>{r.inputHash='a'.repeat(64);},(r:AcceptedGameReview)=>{r.inputEvidence.data='corrupt';},(r:AcceptedGameReview)=>{r.inputEvidence.bytes=16_000_001;},(r:AcceptedGameReview)=>{r.gameId='another';},(r:AcceptedGameReview)=>{r.start='2030-01-01T00:00:00Z';},(r:AcceptedGameReview)=>{r.players[0].sourceReadProofs!.canonicalContextHash='b'.repeat(64);},(r:AcceptedGameReview)=>{r.criticalContextHashes.a='c'.repeat(64);}]){const bad=clone(review);mutate(bad);assert(!reviewedReaderContextCurrent(packet,bad,'a'),'Invalid immutable original/proof cannot recover');}
assert(originalNbaBenchmarkPacket(packet,review));assert.equal(nbaBenchmarkContextHash({...packet,sport:'nfl'},'a'),null);assert.equal(nbaBenchmarkContextHash({...packet,sport:'mlb'},'a'),null);
// Same exact original laws recover both actionable sides, with no price/grade rewrite.
const v=(n:number)=>Array<number>(16).fill(n);for(const weights of [[2,6,2,...v(0).slice(3)],[8,1,1,...v(0).slice(3)]]){const r=archive(nbaAuthorityReview(original,weights),original),expected=siteAiDecisions(original,r,original.cutoff),choices=siteAiDecisions(packet,r,later);assert.equal(choices.length,expected.length);for(const c of choices){const old=expected.find(x=>x.playerId===c.playerId&&x.market===c.market)!;for(const key of ['projection','probability','over','under','push','expectedValue','grade','confidence']as const)if(key!=='confidence')assert.equal(c[key],old[key]);assert.equal(c.evidence.lawHash,old.evidence.lawHash);}const base=f.snapshot([f.row(),f.row('a','rebounds'),f.row('b')]),applied=applyNbaSiteAi(base,packet,choices,later);assert.equal(applied.decisions.length,3);const native=restoreNbaNativeGame(applied,base,packet,later);assert.equal(native.decisions.length,3);const handoff=mergeNbaHandoffs([testNbaSourceAuthority(()=>later)(packet,r),testNbaHandoffCapture(()=>later)(applied.decisions,packet,r,'ai')]);const locked=advanceNbaPlayerPropsCandidateLifecycle({now:'2026-11-10T22:30:01Z',previous:applied,candidate:applied,lockHandoff:handoff}).snapshot;assert(locked.decisions.every(x=>x.lockedAt&&x.aiReview));const changed=current();metricRows(changed)[0][0].value=999;assert.deepEqual(applyNbaSiteAi(locked,changed,[],later).decisions,locked.decisions,'Existing lock never reinterpreted by new comparison');}
assert.equal(digest({original,review}),before);assert(siteReviewCoverage(packet,review,later).every(p=>p.contextCurrent));console.log('Exact typed NBA benchmark regrouping PASS: original input/proof binding; 25 corruption/real-change negatives; paired Over/Under actual pricing/first-lock/legacy precedence; immutable source/law; no HTTP/model/provider/PG.');
