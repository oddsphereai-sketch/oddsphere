/** Actual provider normalizer → current source → R31 parser → existing member
 * scope → authentic first lock. Synthetic captured inputs only; no I/O. */
import assert from 'node:assert/strict';
import {normalizeBallDontLieNbaPlayerProps} from '../lib/services/nba/nbaPlayerPropsProviders';
import {mergeNbaPlayerPropsMarketHistory} from '../lib/services/nba/nbaPlayerPropsPrivateStore';
import {liveNbaPacket} from '../lib/playerPropsAi/liveSources';
import {nbaAuthorityFixture,nbaAuthorityReview,nbaAuthorityDraft} from './test-player-props-ai-nba-lock-authority';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import {applyNbaSiteAi} from '../lib/playerPropsAi/siteBindings';
import {testNbaSourceAuthority,testNbaHandoffCapture,mergeNbaHandoffs} from '../lib/playerPropsAi/nbaLockAuthority';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../lib/services/nba/nbaPlayerPropsLifecycle';
import {parseJointReview} from '../lib/playerPropsAi/request';
import {digest} from '../lib/playerPropsAi/evidence';
import {nbaPlayedStateFixture} from './lib/player-props-ai-nba-played-fixture';

globalThis.fetch=async()=>{throw Error('Reviewed NBA label controls forbid network');};
const previousEnv=process.env.NODE_ENV;Object.assign(process.env,{NODE_ENV:'test'});
try{
 const f=nbaAuthorityFixture(),at=f.packet.cutoff,past='2026-11-10T22:20:00Z',later='2026-11-10T22:24:00Z',after='2026-11-10T22:30:01Z',id='nba-bdl-player:1';
 const game={id:'g',start:f.packet.start,home:'NYK',away:'BOS'};
 const produce=(label:string,clock=at,identified=true)=>normalizeBallDontLieNbaPlayerProps({values:[{id:123,game_id:7,player_id:1,player:{first_name:label,last_name:'Name',team_id:1},prop_type:'points',vendor:'book',line_value:15.5,updated_at:clock,market:{type:'over_under',over_odds:-110,under_odds:-110}}],fetchedAt:clock,events:{'7':{canonicalGameId:'g',homeTeam:'NYK',awayTeam:'BOS',scheduledStart:game.start}},canonicalPlayers:identified?{'1':id}:{}}).rows.map(q=>({...q,receivedAt:clock}));
 const old=produce('Historical',past),current=produce('Current');assert.equal(current.length,2);
 const priorHistory=mergeNbaPlayerPropsMarketHistory({previous:null,current:old,slateDate:'2026-11-10',capturedAt:past}).history;
 const market=mergeNbaPlayerPropsMarketHistory({previous:priorHistory,current,slateDate:'2026-11-10',capturedAt:at}).history;
 const native={...f.row(),playerId:id,playerName:old[0].playerName!},baseline=f.snapshot([native]);
 const state=nbaPlayedStateFixture(past,[1],[14,18,20],[4,6,8]);
 const args={game,window:{gameId:'g',stage:'final' as const,cutoff:at,lock:f.packet.lock},snapshot:baseline,market,prior:state,current:state,currentObservations:current};
 const source=(observations=current,clock=at)=>liveNbaPacket({...args,window:{...args.window,cutoff:clock},currentObservations:observations});
 const packet=source(),review=nbaAuthorityReview(packet),choices=siteAiDecisions(packet,review,at),original=digest({args,packet,review});
 assert.equal(packet.players[0].name,'Current Name');assert.equal(choices.length,1);
 const member=applyNbaSiteAi(baseline,packet,choices,at);
 assert.equal(member.decisions.length,1);assert.equal(member.decisions[0].playerName,'Current Name');
 assert.equal(native.playerName,'Historical Name','Original native display alias is not mutated');
 assert.deepEqual(applyNbaSiteAi(member,packet,choices,at).decisions,member.decisions,'Repeated reviewed overlays retain the exact current label and tuple');
 const forecast=(row:typeof native)=>({playerId:row.playerId,market:row.market,line:row.line,projection:row.projection,probability:row.probability,side:row.side,grade:row.grade,sportsbook:row.sportsbook,price:row.americanPrice,ev:row.expectedValue,lawHash:row.aiReview?.lawHash});
 assert.deepEqual(forecast(member.decisions[0]),{playerId:id,market:'points',line:choices[0].line,projection:choices[0].projection,probability:choices[0].probability,side:choices[0].side,grade:choices[0].grade,sportsbook:choices[0].book,price:choices[0].american,ev:choices[0].expectedValue,lawHash:review.players[0].law!.hash});
 const observe=testNbaSourceAuthority(()=>at),capture=testNbaHandoffCapture(()=>at);
 const proof=capture(member.decisions,packet,review,'ai');assert.equal(proof.proofs.length,1);
 const locked=advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:null,candidate:member,lockHandoff:mergeNbaHandoffs([observe(packet,review),proof])}).snapshot;
 assert.equal(locked.decisions.length,1);assert.equal(locked.decisions[0].playerName,'Current Name');assert.deepEqual(forecast(locked.decisions[0]),forecast(member.decisions[0]));
 for(const playerName of ['Historical Name','Forged Name'])assert.equal(capture(member.decisions.map(row=>({...row,playerName})),packet,review,'ai').proofs.length,0,'An AI name differing from the exact current source cannot receive a new proof');
 assert.equal(capture([native],packet,null,'native').proofs.length,1,'Native aliases retain their original proof contract');
 // An independently captured current same-ID label can change without changing
 // the accepted law, probabilities, original reasoning or original input label.
 const updated=source(produce('Updated',later),later),laterChoices=siteAiDecisions(updated,review,later),updatedMember=applyNbaSiteAi(member,updated,laterChoices,later);
 assert.equal(updated.players[0].name,'Updated Name');assert.equal(updatedMember.decisions[0].playerName,'Updated Name');assert.deepEqual(forecast(updatedMember.decisions[0]),forecast(member.decisions[0]));
 const updatedProof=testNbaHandoffCapture(()=>later)(updatedMember.decisions,updated,review,'ai');assert.equal(updatedProof.proofs.length,1);
 const updatedLock=advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:null,candidate:updatedMember,lockHandoff:mergeNbaHandoffs([testNbaSourceAuthority(()=>later)(updated,review),updatedProof])}).snapshot;
 assert.equal(updatedLock.decisions[0].playerName,'Updated Name');
 assert.throws(()=>source([...current,...produce('Conflicting')]),/current player-name identity incomplete or conflicting/);
 assert.throws(()=>source(produce('Unknown',at,false)),/retail offered-player identity incomplete/);
 assert.strictEqual(applyNbaSiteAi(baseline,packet,[],at),baseline,'No accepted choice does not relabel a generic native row or invent a review');
 const declinedRaw=nbaAuthorityDraft(packet);for(const row of Object.values(declinedRaw.players)){row.law=null as never;row.gaps=['forecast_declined'];row.exceptions=['forecast_declined'];row.confidence=[0];}
 const declined={...review,...parseJointReview(packet,declinedRaw)};
 assert.deepEqual(siteAiDecisions(packet,declined,at),[]);assert.strictEqual(applyNbaSiteAi(baseline,packet,siteAiDecisions(packet,declined,at),at),baseline,'A declined law cannot manufacture a reviewed label');
 const legacyReview={...review,release:'player_props_ai_2026_11_10_r29_identity_and_execution_evidence' as const,players:review.players.map(row=>{const {sourceReadProofs:ignored,...originalRow}=row;void ignored;return originalRow;})};
 const legacyBytes=digest(legacyReview),legacyChoices=siteAiDecisions(packet,legacyReview,at),legacyMember=applyNbaSiteAi(baseline,packet,legacyChoices,at);
 assert.equal(legacyMember.decisions[0].playerName,'Current Name');assert.equal(capture(legacyMember.decisions,packet,legacyReview,'ai').proofs.length,1);assert.equal(digest(legacyReview),legacyBytes,'Old accepted reasoning/law is not relabeled or rewritten');
 const legacyLocked=f.snapshot([{...member.decisions[0],playerName:'Exact Legacy Locked Name',lockedAt:f.packet.lock}]),lockedBytes=digest(legacyLocked);
 const untouched=applyNbaSiteAi(legacyLocked,updated,laterChoices,later);assert.strictEqual(untouched,legacyLocked);
 const retained=advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:legacyLocked,candidate:updatedMember,lockHandoff:{observations:[{} as never],proofs:[{} as never]}}).snapshot;
 assert.deepEqual(retained.decisions,legacyLocked.decisions,'Stored locks precede even malformed optional new identity authority');assert.equal(digest(legacyLocked),lockedBytes);
 assert.equal(digest({args,packet,review}),original,'Captured source, original baseline and admitted review remain immutable');
 console.log('NBA reviewed labels passed: actual normalizer/history/source/parser, current labels on existing reviewed scopes and new first locks, repeated overlay, same-ID current label update with identical law/numbers, wrong-name proof refusal, native aliases, unknown/conflicting source refusal, declined/no-review behavior, legacy accepted-law reuse and exact stored-lock precedence. No I/O.');
}finally{if(previousEnv===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:previousEnv});}
