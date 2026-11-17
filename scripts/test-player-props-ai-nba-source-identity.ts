import assert from 'node:assert/strict';
import {resolveNbaOfferedPlayerTeam}from'../lib/playerPropsAi/nbaSourceIdentity';
const cutoff='2026-11-09T22:43:00Z',past='2026-11-09T07:12:00Z',future='2026-11-09T22:44:00Z';
const offer=(playerTeam:string|null,at=past)=>({playerTeam,observedAt:at,fetchedAt:at,receivedAt:at,isLive:false});
const base={native:[],offers:[offer(null),offer('4')],teamNames:new Map([['4','CHA'],['6','CLE'],['5','CHI']]),home:'CHA',away:'CLE',snapshotAt:past,archiveAt:past,cutoff};
assert.deepEqual(resolveNbaOfferedPlayerTeam(base),{team:'CHA',opponent:'CLE'},'Missing first feed team cannot hide exact supplied same-actor/game provider team');
assert.deepEqual(resolveNbaOfferedPlayerTeam({...base,offers:[...base.offers].reverse()}),resolveNbaOfferedPlayerTeam(base),'Feed order cannot choose team identity');
assert.deepEqual(resolveNbaOfferedPlayerTeam({...base,offers:[offer(null)]}),{team:'unknown',opponent:'unknown'});
assert.equal(resolveNbaOfferedPlayerTeam({...base,offers:[offer(null),offer('4',future)]}).team,'unknown','Future receipt not source evidence');
assert.equal(resolveNbaOfferedPlayerTeam({...base,offers:[offer('4'),offer('6')]}).team,'unknown','Conflicting home/away teams are not guessed');
assert.deepEqual(resolveNbaOfferedPlayerTeam({...base,offers:[offer('5')]}),{team:'CHI',opponent:'unknown'},'Known wrong-game team remains invalid to the live guard');
assert.equal(resolveNbaOfferedPlayerTeam({...base,native:[{team:'CLE',opponent:'CHA',evaluatedAt:past}]}).team,'unknown','Native/provider conflict refused');
assert.equal(resolveNbaOfferedPlayerTeam({...base,native:[{team:'CLE',opponent:'CHA',evaluatedAt:future}]}).team,'CHA','Future native row cannot contradict available provider fact');
assert.equal(resolveNbaOfferedPlayerTeam({...base,offers:[],native:[{team:'CLE',opponent:'CHA',evaluatedAt:past}]}).team,'CLE');
assert.equal(resolveNbaOfferedPlayerTeam({...base,offers:[],native:[{team:'CLE',opponent:'CHA',evaluatedAt:past}],snapshotAt:future}).team,'unknown');
assert.equal(resolveNbaOfferedPlayerTeam({...base,offers:[{...offer('4'),isLive:true}]}).team,'unknown');
assert.equal(resolveNbaOfferedPlayerTeam({...base,offers:[offer('unrecognized label')]}).team,'unknown');
assert.equal(resolveNbaOfferedPlayerTeam({...base,offers:[{...offer('4'),fetchedAt:future}]}).team,'unknown');
assert.equal(resolveNbaOfferedPlayerTeam({...base,offers:[{...offer('4'),receivedAt:undefined}],archiveAt:future}).team,'unknown');
console.log('NBA offered-team identity: exact later provider evidence promotes valid identity; missing/conflicting/future/live/wrong-game source remains refused. No network.');

assert.equal(resolveNbaOfferedPlayerTeam({...base,native:[{team:'CHA',opponent:'LAL',evaluatedAt:past}]}).team,'unknown','Wrong native opponent cannot be silently reconstructed');

import {fromCachedExport,type CachedExport}from'../lib/playerPropsAi/cachedAdapters';
import {liveNbaPacket}from'../lib/playerPropsAi/liveSources';
import {NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE} from '../lib/services/nba/nbaPlayerPropsCurrentState';
import type {NbaPlayerPropsCurrentState} from '../lib/services/nba/nbaPlayerPropsCurrentState';
import {digest}from'../lib/playerPropsAi/evidence';
import {sourceInput} from '../lib/playerPropsAi/request';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {readerCanonicalContextHash} from '../lib/playerPropsAi/readerContext';
import {readerAvailabilityContextHash} from '../lib/playerPropsAi/readerClaimFreshness';
import {attachCapturedNbaParticipationReports,playerParticipationEligibility} from '../lib/playerPropsAi/participationEligibility';
const id='nba-bdl-player:9001',gameId='synthetic-nba-game',start='2026-11-10T00:00:00Z',lock='2026-11-09T23:00:00Z';
const state={updatedAt:past,games:[{gameId:1,homeTeamId:4,awayTeamId:6,homeTeam:'CHA',awayTeam:'CLE',startTime:'2026-11-01T00:00:00Z'}],boxes:[],advanced:[],players:[]};
const observations=[{...offer(null,'2026-11-09T22:42:00Z'),provider:'owls',side:'over'},{...offer('4','2026-11-09T22:42:00Z'),provider:'balldontlie',side:'under'}].map((q,i)=>({...q,canonicalPlayerId:id,canonicalGameId:gameId,playerName:'Synthetic offered actor',market:'rebounds',sportsbook:'synthetic-book',line:4.5,americanPrice:-110,providerObservationId:'synthetic-'+i,isOpening:false}));
const source={readOnly:true,generatedAt:cutoff,priorNba:state,currentNba:state,nba:[{date:'2026-11-09',snapshot:{generatedAt:past,slateDate:'2026-11-09',games:[{gameId,scheduledStart:start,homeTeam:'CHA',awayTeam:'CLE'}],decisions:[]},market:{updatedAt:past,observations}}],nfl:[]}as unknown as CachedExport;
const before=digest(source),window={gameId,stage:'final' as const,cutoff,lock};
const adapted=fromCachedExport(source,window).packets[0];
assert.equal(adapted.players.length,1);assert.equal(adapted.players[0].team,'CHA');assert.equal(adapted.players[0].opponent,'CLE');assert.deepEqual(adapted.players[0].markets,['rebounds']);
assert(adapted.players[0].missing.some(s=>s.includes('independent baseline missing')),'Source identity cannot fabricate an independent head');
const live=liveNbaPacket({game:{id:gameId,start,home:'CHA',away:'CLE'},window,snapshot:source.nba[0].snapshot!,market:source.nba[0].market!,prior:source.priorNba,current:source.currentNba,currentObservations:source.nba[0].market!.observations});
assert.equal(live.players.length,1);assert.equal(live.players[0].team,'CHA');assert.equal(live.executionQuotes?.length,2);assert.equal(digest(source),before,'Adapter/live input may not mutate private source archive');
assert.equal(live.players[0].evidence.filter(e=>e.kind==='independent_model').length,0);
const disputed:CachedExport={...source,nba:[{...source.nba[0],market:{...source.nba[0].market!,observations:[...source.nba[0].market!.observations,{...source.nba[0].market!.observations[1],playerTeam:'6',providerObservationId:'conflict'}]}}]};
assert.throws(()=>liveNbaPacket({game:{id:gameId,start,home:'CHA',away:'CLE'},window,snapshot:disputed.nba[0].snapshot!,market:disputed.nba[0].market!,prior:disputed.priorNba,current:disputed.currentNba,currentObservations:disputed.nba[0].market!.observations}),/NBA player\/team matchup identity incomplete/);
console.log('Actual cached adapter and live packet retain the unmodelled offered actor, both providers, market and missing-head status; conflicting team remains blocked; source bytes unchanged.');

// Current explicit full-team names use the existing collector catalog, even
// without a priced native head. Last-played associations never fill missing team.
const teamlessMarket={...source.nba[0].market!,observations:source.nba[0].market!.observations.filter(q=>q.provider==='owls')};
const identityArgs={game:{id:gameId,start,home:'CHA',away:'CLE'},window,snapshot:source.nba[0].snapshot!,market:teamlessMarket,prior:source.priorNba,current:source.currentNba,currentObservations:teamlessMarket.observations};
assert.throws(()=>liveNbaPacket(identityArgs),/NBA player\/team matchup identity incomplete/,'Missing current team remains held, never guessed from history');
const fullName=teamlessMarket.observations.map(q=>({...q,playerTeam:'Charlotte Hornets'}));
const fullNameArgs={...identityArgs,currentObservations:fullName,market:{...teamlessMarket,observations:fullName}},identityBefore=digest(fullNameArgs),identified=liveNbaPacket(fullNameArgs);
assert.equal(identified.players.length,1);assert.equal(identified.players[0].team,'CHA');assert.deepEqual(identified.players[0].markets,['rebounds']);assert.equal(identified.players[0].evidence.filter(e=>e.kind==='independent_model').length,0);
const repeatedIdentity=liveNbaPacket({...fullNameArgs,window:{...window,cutoff:'2026-11-09T22:44:00Z'}});assert.deepEqual(criticalContextHashes(repeatedIdentity),criticalContextHashes(identified));
assert.equal(readerCanonicalContextHash(repeatedIdentity,id),readerCanonicalContextHash(identified,id));assert.equal(readerAvailabilityContextHash(repeatedIdentity,id),readerAvailabilityContextHash(identified,id));
assert.equal(digest(fullNameArgs),identityBefore);
const rosterRows=fullName.map(q=>({...q,provider:'balldontlie' as const,playerIdentityAvailableAt:'2026-11-09T22:42:30Z'}));
const rosterArgs={...fullNameArgs,currentObservations:rosterRows,market:{...teamlessMarket,observations:rosterRows}},rosterPacket=liveNbaPacket(rosterArgs);
assert(rosterPacket.sourceIdentityEvidence&&JSON.stringify(rosterPacket.sourceIdentityEvidence).includes('2026-11-09T22:42:30Z'));
const withoutReceipt=structuredClone(rosterPacket);delete withoutReceipt.sourceIdentityEvidence;assert.equal(sourceInput(rosterPacket),sourceInput(withoutReceipt),'Private identity provenance is not extra AI tokens or another independent evidence signal');
assert.deepEqual(criticalContextHashes(rosterPacket),criticalContextHashes(identified),'Same identity receipt cannot be counted as another matchup signal or change identical context');
assert.equal(readerCanonicalContextHash(rosterPacket,id),readerCanonicalContextHash(identified,id));
assert.equal(readerAvailabilityContextHash(rosterPacket,id),readerAvailabilityContextHash(identified,id));
assert(rosterPacket.executionQuotes?.every(q=>q.receivedAt===rosterRows[0].receivedAt),'Identity lookup cannot pretend to refresh an executable price');
const laterRoster=rosterRows.map(q=>({...q,playerIdentityAvailableAt:'2026-11-09T22:43:30Z'})),laterRosterPacket=liveNbaPacket({...rosterArgs,window:{...window,cutoff:'2026-11-09T22:44:00Z'},currentObservations:laterRoster,market:{...teamlessMarket,observations:laterRoster}});
assert.deepEqual(criticalContextHashes(laterRosterPacket),criticalContextHashes(rosterPacket));assert.equal(readerCanonicalContextHash(laterRosterPacket,id),readerCanonicalContextHash(rosterPacket,id));assert.equal(readerAvailabilityContextHash(laterRosterPacket,id),readerAvailabilityContextHash(rosterPacket,id));
assert.throws(()=>liveNbaPacket({...rosterArgs,currentObservations:laterRoster,market:{...teamlessMarket,observations:laterRoster}}),/NBA player\/team matchup identity incomplete/,'Future roster response cannot establish a team at an earlier quote cutoff');
assert.throws(()=>liveNbaPacket({...rosterArgs,currentObservations:[rosterRows[0],...laterRoster],market:{...teamlessMarket,observations:[rosterRows[0],...laterRoster]}}),/NBA player\/team matchup identity incomplete/,'Another valid team quote cannot launder future metadata into current actor names or source evidence');

for(const playerTeam of ['Chicago Bulls','unrecognized team']){const rows=fullName.map(q=>({...q,playerTeam}));assert.throws(()=>liveNbaPacket({...fullNameArgs,currentObservations:rows,market:{...teamlessMarket,observations:rows}}),/NBA player\/team matchup identity incomplete/);}
// A real current trade/report cannot be bypassed with the historical cache team.
const historicalIdentity={...source.currentNba,release:NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE,season:2026,players:[{playerId:9001,playerName:'Synthetic offered actor',latestTeamId:4,lastObservedAt:'2026-11-01T00:00:00Z'}]} as NbaPlayerPropsCurrentState;
assert.throws(()=>liveNbaPacket({...identityArgs,current:historicalIdentity}),/NBA player\/team matchup identity incomplete/,'Even a matching historical ID/name/team never becomes current roster authority');
const currentCle=fullName.map(q=>({...q,playerTeam:'Cleveland Cavaliers'}));
const traded=liveNbaPacket({...identityArgs,current:historicalIdentity,currentObservations:currentCle,market:{...teamlessMarket,observations:currentCle}});
assert.equal(traded.players[0].team,'CLE','A current explicit team owns identity despite an older played-team association');
const medical=attachCapturedNbaParticipationReports(traded,[{gameId,start,awayTeam:'CLE',homeTeam:'CHA',expectedEventId:'1',availableAt:cutoff,report:{eventId:'1',teams:new Map([['CHA',[]],['CLE',[{player_id:null,source_player_id:'synthetic-espn',name:'Synthetic offered actor',status:'out',position:'G',injury_type:null,expected_return_at:null,reported_at:cutoff}]]])}}]);
assert.equal(playerParticipationEligibility(medical,medical.players[0]).blocked,true,'Current same-fixture Out must not be hidden by an old played-team association');
console.log('Current explicit full-name identity: unpriced actor retained with zero invented heads; absent current team stays held despite historical association; all reader hashes remain stable.');

import{nbaIndependentProbabilityEvent}from'../lib/playerPropsAi/nbaSourceIdentity';
import{independentPriorEvent}from'../lib/playerPropsAi/priorEvents';
import type{NbaPlayerPropsMemberDecision}from'../lib/services/nba/nbaPlayerPropsProductContract';
const nativeRow={gameId,playerId:id,playerName:'Synthetic offered actor',team:'CHA',opponent:'CLE',market:'rebounds',line:6.5,side:'under',independentSide:'over',independentProbability:.8,independentProjection:8.4,evaluatedAt:past,modelRelease:'synthetic-native',role:[],production:[],matchup:[],lockedAt:null}as unknown as NbaPlayerPropsMemberDecision;
const modelSource:CachedExport={...source,nba:[{...source.nba[0],snapshot:{...source.nba[0].snapshot!,decisions:[nativeRow]}}]};
const modelInput=fromCachedExport(modelSource,window).packets[0],head=modelInput.players[0].evidence.find(e=>e.kind==='independent_model')!;
assert.deepEqual([independentPriorEvent(head).preferredOutcome,independentPriorEvent(head).overProbability,independentPriorEvent(head).underProbability],['over',.8,1-.8],'Actual adapter must not relabel independent Over probability as final Under probability');
for(const[side,probability,preferred]of [['over',.8,'over'],['under',.8,'under'],['over',.4,'under']]as const){const values=nbaIndependentProbabilityEvent({independentSide:side,independentProbability:probability});const event=independentPriorEvent({...head,value:{market:'rebounds',line:6.5,...values}});assert.equal(event.preferredOutcome,preferred,'Compare actual probabilities, not the reference label alone');}
const legacyNative={...nativeRow};delete legacyNative.independentSide;
const legacyBefore=digest(legacyNative),legacySource:CachedExport={...source,nba:[{...source.nba[0],snapshot:{...source.nba[0].snapshot!,decisions:[legacyNative]}}]};
const legacyHead=fromCachedExport(legacySource,window).packets[0].players[0].evidence.find(e=>e.kind==='independent_model')!;
assert.equal(independentPriorEvent(legacyHead).preferredOutcome,'unavailable');assert.equal(independentPriorEvent(legacyHead).probabilityOfReferenceSide,null);assert.equal((legacyHead.value as Record<string,unknown>).probabilityOfUnspecifiedIndependentSide,.8);assert.equal(digest(legacyNative),legacyBefore,'Missing legacy side stays missing; no reconstruction/reinterpretation');
console.log('Native prior event: opposite final side cannot reverse the independent event; missing legacy reference side stays unknown with original untyped probability retained.');
import{encodeNbaPlayerPropsPrivatePayload,decodeNbaPlayerPropsPrivatePayload}from'../lib/services/nba/nbaPlayerPropsPrivateStore';
const stored={decisions:[nativeRow,{...legacyNative,lockedAt:lock}]};const restored=decodeNbaPlayerPropsPrivatePayload<typeof stored>(encodeNbaPlayerPropsPrivatePayload(stored,'candidate_snapshot'),'candidate_snapshot');assert.deepEqual(restored,stored);assert(!Object.hasOwn(restored!.decisions[1],'independentSide'),'Lossless storage cannot fabricate legacy reference side');
