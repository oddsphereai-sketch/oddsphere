/** Actual normalized report→admission→member→first-lock metamorphic controls.
 * All sources/SQL/HTTP/models are synthetic; this test never performs I/O. */
import assert from 'node:assert/strict';
import {nflCrossSourceReaderClockProof} from './lib/player-props-ai-reader-context-nfl';
import {nbaSharedEspnReaderClockProof} from './lib/player-props-ai-reader-context-nba';
import {nbaAuthorityFixture,nbaAuthorityReview} from './test-player-props-ai-nba-lock-authority';
import {parseEspnGameInjuriesPayload} from '../lib/services/nba/espnNbaInjuries';
import {attachCapturedNbaParticipationReports,playerParticipationEligibility} from '../lib/playerPropsAi/participationEligibility';
import {readerAvailabilityContextHash,reviewedReaderContextCurrent} from '../lib/playerPropsAi/readerClaimFreshness';
import {readerCanonicalContextHash,PROPS_AI_READER_CONTEXT_RELEASE} from '../lib/playerPropsAi/readerContext';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {siteAiDecisions,siteReviewCoverage} from '../lib/playerPropsAi/publication';
import {applyNbaSiteAi,restoreNbaNativeGame} from '../lib/playerPropsAi/siteBindings';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../lib/services/nba/nbaPlayerPropsLifecycle';
import {mergeNbaHandoffs,testNbaSourceAuthority,testNbaHandoffCapture} from '../lib/playerPropsAi/nbaLockAuthority';
import {attachGameReaderContext} from '../lib/playerPropsAi/gameContext';
import type {GamePacket,Json} from '../lib/playerPropsAi/evidenceContract';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
globalThis.fetch=async()=>{throw Error('Reader context proof forbids network');};
const previousEnv=process.env.NODE_ENV;Object.assign(process.env,{NODE_ENV:'test'});
try{
 const f=nbaAuthorityFixture(),sourceAt=f.packet.cutoff,laterAt='2026-11-10T22:27:00Z',after='2026-11-10T22:30:01Z',old='2026-11-10T22:20:00Z',newer='2026-11-10T22:22:00Z';
 const row=(name:string,status:string,date=old,id=name,detail='Ankle')=>({athlete:{id,displayName:name,position:{abbreviation:'G'}},status,date,details:{type:detail,returnDate:'2026-11-12'}});
 const bos=[row('Synthetic a','Available'),row('Other Player','Out')],nyk=[row('Opponent Player','Questionable')];
 const group=(team:string,injuries:ReturnType<typeof row>[])=>({team:{abbreviation:team},injuries});
 const groups=()=>[group('BOS',structuredClone(bos)),group('NYK',structuredClone(nyk))];
 function produce(values:ReturnType<typeof groups>,cutoff=sourceAt,base:GamePacket=f.packet){
  const raw=JSON.stringify(values),report=parseEspnGameInjuriesPayload({injuries:values},'401234567','BOS','NYK');assert(report);
  const packet=attachCapturedNbaParticipationReports({...structuredClone(base),cutoff},[{gameId:base.gameId,start:base.start,awayTeam:'BOS',homeTeam:'NYK',expectedEventId:report.eventId,availableAt:cutoff,report}]);
  assert.equal(JSON.stringify(values),raw,'Source construction preserves original provider response');return packet;
 }
 const source=produce(groups()),sourceBytes=JSON.stringify(source),review=nbaAuthorityReview(source),reviewBytes=JSON.stringify(review),baseline=f.snapshot([f.row(),f.row('a','rebounds'),f.row('b')]),choices=siteAiDecisions(source,review,sourceAt),applied=applyNbaSiteAi(baseline,source,choices,sourceAt);
 assert.equal(choices.length,3);assert(choices.every(c=>c.grade==='Best Angle'));
 const initial=[testNbaSourceAuthority(()=>sourceAt)(source,review),testNbaHandoffCapture(()=>sourceAt)(applied.decisions,source,review,'ai')];
 const proof=review.players[0].sourceReadProofs!;
 assert.equal(proof.contextRelease,PROPS_AI_READER_CONTEXT_RELEASE);assert.equal(proof.originalCriticalContextHash,review.criticalContextHashes.a);
 function firstLock(packet:GamePacket,accepted:AcceptedGameReview=review){
  const current=siteAiDecisions(packet,accepted,laterAt),restored=restoreNbaNativeGame(applied,baseline,packet,laterAt),candidate=applyNbaSiteAi(restored,packet,current,laterAt);
  const latest=[testNbaSourceAuthority(()=>laterAt)(packet,accepted),testNbaHandoffCapture(()=>laterAt)(candidate.decisions,packet,accepted,'native'),testNbaHandoffCapture(()=>laterAt)(candidate.decisions,packet,accepted,'ai')];
  return{current,locked:advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:applied,candidate,lockHandoff:mergeNbaHandoffs([...initial,...latest])}).snapshot};
 }
 const originalLock=firstLock(produce(groups(),laterAt)).locked;
 const changedGroups=groups();changedGroups.reverse();
 const changedRows=groups();changedRows[0].injuries.reverse();
 const clockOnly=groups();clockOnly[0].injuries[0].date=newer;
 const duplicates=groups();duplicates[0].injuries.push(structuredClone(duplicates[0].injuries[1]));
 const positive=[produce(groups(),laterAt),produce(changedGroups,laterAt),produce(changedRows,laterAt),produce(clockOnly,laterAt),produce(duplicates,laterAt)];
 for(const packet of positive){
  assert.equal(playerParticipationEligibility(packet,packet.players[0]).status,'eligible');
  assert.equal(readerAvailabilityContextHash(packet,'a'),readerAvailabilityContextHash(source,'a'));
  assert.equal(readerCanonicalContextHash(packet,'a'),readerCanonicalContextHash(source,'a'));
  assert(siteReviewCoverage(packet,review,laterAt).every(p=>p.contextCurrent));
  const result=firstLock(packet);assert.equal(result.current.length,3);assert(result.locked.decisions.every(r=>r.aiReview&&r.grade==='Best Angle'));
  for(const row of result.locked.decisions){const prior=originalLock.decisions.find(r=>r.playerId===row.playerId&&r.market===row.market)!;const forecast=(r:typeof row)=>{const{sourceEligibility:currentSource,...acceptedEvidence}=r.aiReview!;void currentSource;return{...r,aiReview:acceptedEvidence};};assert.deepEqual(forecast(row),forecast(prior),'Benign medical set/clock refresh retains forecast/price/grade and accepted text/law; current source eligibility keeps its actual provenance');}
 }
 assert.notEqual(criticalContextHashes(positive[1]).a,review.criticalContextHashes.a,'Legacy raw-order hash is unchanged');
 const priorClaimReview={...review,release:'player_props_ai_2026_11_10_r31_verified_reader_claims' as const};
 for(const packet of positive){assert(reviewedReaderContextCurrent(packet,priorClaimReview,'a'),'Original R31 canonical medical contract stays eligible under R32');assert.equal(siteAiDecisions(packet,priorClaimReview,laterAt).length,3);}
 assert.equal(reviewedReaderContextCurrent(positive[1],{...review,release:'player_props_ai_2026_11_10_r30_source_and_slate_authority'},'a'),false,'Pre-claim legacy release retains exact raw-context precedence');

 // Every substantive row field remains an input, including other actors whose
 // injuries may alter the reviewed actor's opportunity or matchup.
 const changes:[string,(values:ReturnType<typeof groups>)=>void][]=[
  ['own status',g=>{g[0].injuries[0].status='Out';}],['teammate status',g=>{g[0].injuries[1].status='Available';}],['opponent status',g=>{g[1].injuries[0].status='Out';}],
  ['own injury detail',g=>{g[0].injuries[0].details.type='Back';}],['teammate injury detail',g=>{g[0].injuries[1].details.type='Back';}],['opponent injury detail',g=>{g[1].injuries[0].details.type='Back';}],
  ['teammate name',g=>{g[0].injuries[1].athlete.displayName='Different Teammate';}],['opponent provider ID',g=>{g[1].injuries[0].athlete.id='different-id';}],
  ['teammate position',g=>{g[0].injuries[1].athlete.position.abbreviation='C';}],['opponent return expectation',g=>{g[1].injuries[0].details.returnDate='2026-11-20';}],
 ];
 for(const [label,change]of changes){const values=groups();change(values);const packet=produce(values,laterAt);assert.notEqual(readerCanonicalContextHash(packet,'a'),readerCanonicalContextHash(source,'a'),label);assert.equal(siteAiDecisions(packet,review,laterAt).length,0,label);assert(firstLock(packet).locked.decisions.every(r=>!r.aiReview),label);}
 for(const mutate of [(p:GamePacket)=>{(p.players[0].evidence[0].value as Record<string,Json>).box={points:99,minutes:30};},(p:GamePacket)=>{p.players[0].evidence.push({id:'depth',kind:'matchup',availableAt:laterAt,source:'existing exact-game depth',value:{away:{team:'BOS',roster:[{playerId:'1',name:'Other Player',injuryStatus:'Out',depth:1},{playerId:'2',name:'Another Player',depth:2}]},home:{team:'NYK',roster:[]}}});}]){
  const packet=produce(groups(),laterAt);mutate(packet);assert.equal(reviewedReaderContextCurrent(packet,review,'a'),false,'Production/role change remains material');
 }
 // A full ordered role/depth list is deliberately NOT a medical set.
 const roleSource=produce(groups());(roleSource.players[0].evidence.find(e=>e.kind==='independent_model')!.value as Record<string,Json>).role=[{key:'minutes',value:30},{key:'usage',value:.2}];
 const roleCurrent=structuredClone(roleSource);((roleCurrent.players[0].evidence.find(e=>e.kind==='independent_model')!.value as Record<string,Json>).role as Json[]).reverse();assert.notEqual(readerCanonicalContextHash(roleCurrent,'a'),readerCanonicalContextHash(roleSource,'a'));
 const depthSource=produce(groups());depthSource.players[0].evidence.push({id:'depth',kind:'matchup',availableAt:sourceAt,source:'existing exact-game depth',value:{away:{team:'BOS',roster:[{playerId:'1',name:'Other Player',injuryStatus:'Out',depth:1},{playerId:'2',name:'Another Player',depth:2}]},home:{team:'NYK',roster:[]}}});
 const depthCurrent=structuredClone(depthSource);((depthCurrent.players[0].evidence.at(-1)!.value as {away:{roster:Json[]}}).away.roster).reverse();assert.notEqual(readerCanonicalContextHash(depthCurrent,'a'),readerCanonicalContextHash(depthSource,'a'));
 // Clock-only changes must still invalidate when they select a different full
 // own/teammate/opponent record, or create/remove equal-clock conflicts.
 for(const identity of ['Synthetic a','Other Player','Opponent Player']){
  const team=identity==='Opponent Player'?'NYK':'BOS';
  const report=(status:string,date:string,detail='Ankle')=>[group('BOS',team==='BOS'?[row(identity,status,date,identity,detail)]:[]),group('NYK',team==='NYK'?[row(identity,status,date,identity,detail)]:[])];
  const early=produce(report('Out',old)),both=produce(report('Available',newer),sourceAt,early),accepted=nbaAuthorityReview(both);
  const crossed=produce(report('Available',newer),laterAt,produce(report('Out','2026-11-10T22:22:30Z'),laterAt));
  assert.notEqual(readerCanonicalContextHash(crossed,'a'),readerCanonicalContextHash(both,'a'),`${identity}: effective authority changed`);assert.equal(reviewedReaderContextCurrent(crossed,accepted,'a'),false);
  const tied=produce(report('Available',newer),laterAt,produce(report('Out',newer),laterAt));assert.equal(reviewedReaderContextCurrent(tied,accepted,'a'),false,`${identity}: equal-clock conflict`);
  const detailSource=produce(report('Available',newer,'Back'),sourceAt,produce(report('Available',old,'Ankle'))),detailReview=nbaAuthorityReview(detailSource);
  const detailCrossed=produce(report('Available',newer,'Back'),laterAt,produce(report('Available','2026-11-10T22:22:30Z','Ankle'),laterAt));
  assert.equal(reviewedReaderContextCurrent(detailCrossed,detailReview,'a'),false,`${identity}: unchanged status but winning injury detail changed`);
 }
 // Distinct supplied actor IDs cannot be merged because names happen to match.
 const twins=(first:string,second:string)=>[group('BOS',[row('Twin Player','Out',first,'provider-1'),row('Twin Player','Available',second,'provider-2')]),group('NYK',[])];
 const twinsBefore=produce(twins(old,newer)),twinsAfter=produce(twins(newer,old),laterAt);assert.equal(readerCanonicalContextHash(twinsBefore,'a'),readerCanonicalContextHash(twinsAfter,'a'),'Separate known IDs retain their separate medical authority');
 // The existing NFL context producer also emits unordered team/player/clearance
 // sets; source detail survives and clock winner changes cannot clear old facts.
 const nfl={...f.packet,sport:'nfl' as const,players:[{...f.packet.players[0],id:'nfl-bdl-player:1',markets:['receptions'],evidence:[]}]};
 const injuries={eventId:'g',awayTeam:'BOS',homeTeam:'NYK',reportUpdatedAt:old,teams:[{abbreviation:'BOS',players:[{name:'Other Player',status:'Out',detail:'Back',reportedAt:old},{name:'Another Player',status:'Questionable',detail:'Foot',reportedAt:old}]},{abbreviation:'NYK',players:[]}],playerClearances:[{teamAbbreviation:'BOS',name:'Synthetic a',reportedAt:old},{teamAbbreviation:'NYK',name:'Cleared Opponent',reportedAt:old}]};
 const nflSource=(value:Json)=>attachGameReaderContext(nfl,[{id:'g',gameId:'g',start:nfl.start,awayTeam:'BOS',homeTeam:'NYK',availableAt:sourceAt,source:'existing exact-game NFL collector',injuries:value}]);
 const nflOriginal=nflSource(injuries),nflReordered=structuredClone(injuries);nflReordered.teams.reverse();nflReordered.teams.find(t=>t.abbreviation==='BOS')!.players.reverse();nflReordered.playerClearances.reverse();assert.equal(readerCanonicalContextHash(nflOriginal,'nfl-bdl-player:1'),readerCanonicalContextHash(nflSource(nflReordered),'nfl-bdl-player:1'));
 const nflChanged=structuredClone(injuries);nflChanged.teams[0].players[0].detail='Knee';assert.notEqual(readerCanonicalContextHash(nflOriginal,'nfl-bdl-player:1'),readerCanonicalContextHash(nflSource(nflChanged),'nfl-bdl-player:1'));
 // Missing/corrupt prospective proofs fail; they are never reconstructed from
 // raw inputs or accepted legacy hashes. The admitted legacy hash remains bound.
 for(const mutate of [(r:AcceptedGameReview)=>{delete r.players[0].sourceReadProofs;},(r:AcceptedGameReview)=>{r.players[0].sourceReadProofs!.contextRelease='other';},(r:AcceptedGameReview)=>{r.players[0].sourceReadProofs!.canonicalContextHash='tampered';},(r:AcceptedGameReview)=>{r.players[0].sourceReadProofs!.originalCriticalContextHash='tampered';},(r:AcceptedGameReview)=>{r.criticalContextHashes.a='tampered';}]){const invalid=structuredClone(review);mutate(invalid);assert.equal(reviewedReaderContextCurrent(source,invalid,'a'),false);}
 const legacy=structuredClone(review);legacy.release='player_props_ai_2026_11_10_r29_identity_and_execution_evidence';for(const p of legacy.players)delete p.sourceReadProofs;assert(reviewedReaderContextCurrent(source,legacy,'a'));assert(!reviewedReaderContextCurrent(positive[1],legacy,'a'),'A legacy accepted record keeps its original raw-order contract');
 const lockedBytes=JSON.stringify(originalLock),retained=advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:originalLock,candidate:baseline,lockHandoff:{observations:[],proofs:[]}}).snapshot;assert.deepEqual(retained.decisions,originalLock.decisions);assert.equal(JSON.stringify(originalLock),lockedBytes);
 assert.equal(JSON.stringify(source),sourceBytes);assert.equal(JSON.stringify(review),reviewBytes,'No admitted review, text, law, hash or proof is rewritten');
 nflCrossSourceReaderClockProof();
 nbaSharedEspnReaderClockProof();
 console.log('R31 reader context passed: actual ESPN parser/admission/member/first lock preserves benign medical ordering/duplicates/refetch and same-state clocks; all-identity status/detail/identity/role/depth and competing authority changes remain material, separate provider IDs stay separate, NFL typed sets are canonical, missing/tampered proof and legacy hash/lock precedence remain exact. No I/O.');
}finally{if(previousEnv===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:previousEnv});}
