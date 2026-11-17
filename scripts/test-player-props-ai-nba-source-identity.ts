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
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {readerCanonicalContextHash} from '../lib/playerPropsAi/readerContext';
import {readerAvailabilityContextHash} from '../lib/playerPropsAi/readerClaimFreshness';
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

// A current offered actor must not lose an already captured identity merely
// because this market has no priced native head. No forecast is donated.
const identityState={...state,release:NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE,season:2026,createdAt:past,publicEnabled:false,
 games:state.games.map(game=>({...game,season:2026,homeScore:85,awayScore:80})),
 players:[{playerId:9001,playerName:'Synthetic offered actor',latestTeamId:4,lastObservedAt:state.games[0].startTime}],
 boxes:[4,6].flatMap(teamId=>Array.from({length:5},(_,i)=>({rowId:teamId*10+i,gameId:1,teamId,playerId:teamId===4&&i===0?9001:teamId*10000+i,
  minutes:48,fgm:7,fga:12,fg3m:0,fg3a:1,ftm:teamId===4?3:2,fta:4,oreb:1,dreb:5,ast:3,stl:0,blk:0,turnover:1,pf:1,points:teamId===4?17:16,plusMinus:0}))),
} as NbaPlayerPropsCurrentState;
const teamlessMarket={...source.nba[0].market!,observations:source.nba[0].market!.observations.filter(q=>q.provider==='owls')};
const identityArgs={game:{id:gameId,start,home:'CHA',away:'CLE'},window,snapshot:source.nba[0].snapshot!,market:teamlessMarket,prior:source.priorNba,current:identityState,currentObservations:teamlessMarket.observations};
const identityBefore=digest(identityArgs),identified=liveNbaPacket(identityArgs),identityEvidence=identified.players[0].evidence.find(e=>e.id.endsWith(':captured-source-identity'))!;
assert.equal(identified.players[0].team,'CHA');assert(identityEvidence);assert.equal(identityEvidence.availableAt,identityState.updatedAt);assert(identityEvidence.source.includes('not a new forecast'));
assert.equal(identified.players[0].evidence.filter(e=>e.kind==='independent_model').length,0);assert(identified.players[0].missing.some(v=>v.includes('independent baseline missing')));
assert.equal(identified.players.length,1);assert.deepEqual(identified.players[0].markets,['rebounds']);assert.equal(digest(identityArgs),identityBefore);
for(const mutate of [
 (s:NbaPlayerPropsCurrentState)=>({...s,updatedAt:future}),
 (s:NbaPlayerPropsCurrentState)=>({...s,season:2025}),
 (s:NbaPlayerPropsCurrentState)=>({...s,release:'unknown-source' as typeof NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE}),
 (s:NbaPlayerPropsCurrentState)=>({...s,players:s.players.map(p=>({...p,playerName:'Different actor'}))}),
 (s:NbaPlayerPropsCurrentState)=>({...s,players:s.players.map(p=>({...p,lastObservedAt:future}))}),
 (s:NbaPlayerPropsCurrentState)=>({...s,players:[...s.players,...s.players]}),
 (s:NbaPlayerPropsCurrentState)=>({...s,players:[...s.players,{...s.players[0],playerId:9002}]}),
 (s:NbaPlayerPropsCurrentState)=>({...s,boxes:[]}),
 (s:NbaPlayerPropsCurrentState)=>({...s,boxes:s.boxes.map(b=>({...b,teamId:6}))}),
 (s:NbaPlayerPropsCurrentState)=>({...s,games:s.games.map(g=>({...g,homeTeamId:55}))}),
 (s:NbaPlayerPropsCurrentState)=>({...s,games:[...s.games,...s.games]}),
])assert.throws(()=>liveNbaPacket({...identityArgs,current:mutate(identityState)}),/NBA player\/team matchup identity incomplete/);
const wrongTeam=teamlessMarket.observations.map(q=>({...q,playerTeam:'6'}));assert.equal(liveNbaPacket({...identityArgs,currentObservations:wrongTeam,market:{...teamlessMarket,observations:wrongTeam}}).players[0].team,'CLE','Actual supplied current team owns identity; cache cannot override it');
const foreignTeam=teamlessMarket.observations.map(q=>({...q,playerTeam:'Chicago Bulls'}));assert.throws(()=>liveNbaPacket({...identityArgs,currentObservations:foreignTeam,market:{...teamlessMarket,observations:foreignTeam}}),/NBA player\/team matchup identity incomplete/);
const unrecognizedTeam=teamlessMarket.observations.map(q=>({...q,playerTeam:'unrecognized team'}));assert.throws(()=>liveNbaPacket({...identityArgs,currentObservations:unrecognizedTeam,market:{...teamlessMarket,observations:unrecognizedTeam}}),/NBA player\/team matchup identity incomplete/);
const fullName=teamlessMarket.observations.map(q=>({...q,playerTeam:'Charlotte Hornets'}));assert.equal(liveNbaPacket({...identityArgs,current:source.currentNba,currentObservations:fullName,market:{...teamlessMarket,observations:fullName}}).players[0].team,'CHA','Use the collector existing exact catalog, without a guessed identity or model head');
const repeatedIdentity=liveNbaPacket({...identityArgs,window:{...window,cutoff:'2026-11-09T22:44:00Z'}});assert.deepEqual(criticalContextHashes(repeatedIdentity),criticalContextHashes(identified),'Unchanged captured identity cannot invalidate a review merely because the refresh clock advanced');
assert.equal(readerCanonicalContextHash(repeatedIdentity,id),readerCanonicalContextHash(identified,id));assert.equal(readerAvailabilityContextHash(repeatedIdentity,id),readerAvailabilityContextHash(identified,id));
assert.equal(digest(identityArgs),identityBefore);console.log('Captured same-season identity without a priced head: positive full packet, source/conflict refusals and refresh-clock controls; source bytes and missing-head status preserved.');

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
