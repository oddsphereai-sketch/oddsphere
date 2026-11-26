/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic malformed source controls. */
import {digest} from '../lib/playerPropsAi/evidence';
import assert from 'node:assert/strict';
import {resolveNflPropSourcePlayer,sameNflPropActorName} from '../lib/playerPropsAi/nflPlayerIdentity';
import {liveNflPacket} from '../lib/playerPropsAi/liveSources';
import {packReaderSourceV3,unpackReaderSourceV3} from '../lib/playerPropsAi/sourceCodec';
import type {Json} from '../lib/playerPropsAi/evidenceContract';
import {gzipSync,gunzipSync} from 'node:zlib';
import {sourceInput} from '../lib/playerPropsAi/request';
globalThis.fetch=async()=>{throw Error('Offline NFL source proof forbids network');};
type IdentityArgs=Parameters<typeof resolveNflPropSourcePlayer>[0];
type LiveArgs=Parameters<typeof liveNflPacket>[0];
const at='2026-11-08T17:00:00Z',start='2026-11-08T21:00:00Z',lock='2026-11-08T20:00:00Z';
const game={id:'synthetic',start,away:'TB',home:'CHI'};
const quote={providerEventId:'synthetic-provider-event',homeTeam:'Chicago Bears',awayTeam:'Tampa Bay Buccaneers',providerObservationId:'secondary',canonicalGameId:game.id,scheduledStart:start,providerPlayerId:null,playerName:'Kenneth Gainwell',playerTeam:null,provider:'owls',market:'receptions',line:2.5,side:'over',sportsbook:'synthetic',americanPrice:-110,observedAt:at,receivedAt:at,fetchedAt:at,isOpening:false,isLive:false} as IdentityArgs['row'];
const native={...quote,provider:'balldontlie',providerObservationId:'primary',playerName:'Kenny Gainwell',providerPlayerId:'12',playerTeam:'TB'} as IdentityArgs['row'];
const stored={gameId:game.id,scheduledStart:start,lockAt:lock,providerPlayerId:'12',playerName:'Kenny Gainwell',team:'TB',opponent:'CHI',observedAt:at,forecastContext:{featureAsOf:at},state:'unlocked',grade:'Held',healthHolds:['historical_identity_unmatched']} as unknown as IdentityArgs['rows'][number];
const context={capturedAt:at,games:[{canonicalGameId:game.id,scheduledStart:start,awayTeam:'TB',homeTeam:'CHI',awayDepth:{team:'TB',capturedAt:at,roster:[{playerId:'12',name:'Kenny Gainwell'}]},homeDepth:{team:'CHI',capturedAt:at,roster:[]},injuries:{players:[]},weather:null}]} as unknown as IdentityArgs['context'];
const args={row:quote,rows:[stored],observations:[native],context,game,cutoff:at,observationsAvailableAt:at,storedAvailableAt:at};
assert.equal(resolveNflPropSourcePlayer(args)?.providerId,'12');
assert.equal(resolveNflPropSourcePlayer({...args,rows:[],observations:[]})?.providerId,'12','a unique exact roster ID is sufficient without a numerical-model row');
assert.equal(resolveNflPropSourcePlayer({...args,rows:[],context:{...context,games:[{...context.games[0],awayDepth:{team:'TB',capturedAt:at,roster:[]}}]} as never})?.providerId,'12','a current primary-provider identity is sufficient without a model or roster row');
assert.equal(resolveNflPropSourcePlayer({...args,row:{...native,playerName:null}})?.name,'Kenny Gainwell','a supplied ID can recover its exact roster name');
assert.equal(resolveNflPropSourcePlayer({...args,row:{...quote,canonicalGameId:'wrong'}}),null);
assert.equal(resolveNflPropSourcePlayer({...args,row:{...quote,scheduledStart:'2026-11-09T21:00:00Z'}}),null);
assert.throws(()=>resolveNflPropSourcePlayer({...args,row:{...native,playerTeam:'CHI'}}),/player-team identity/);
assert.throws(()=>resolveNflPropSourcePlayer({...args,row:{...native,providerPlayerId:'999'}}),/provider player identity/);
assert.throws(()=>resolveNflPropSourcePlayer({...args,context:{...context,games:[{...context.games[0],scheduledStart:'2026-11-09T21:00:00Z'}]} as never}),/roster game identity/);
for(const [a,b,id] of [['Marquise Brown','Hollywood Brown','666'],['Kevin Concepcion','KC Concepcion Jr.','33934397'],['Kenneth Gainwell','Kenny Gainwell','12'],['Chigoziem Okonkwo','Chig Okonkwo','734']]){
 assert.equal(sameNflPropActorName(a,b,id),true);assert.equal(sameNflPropActorName(a,b,'wrong'),false);assert.equal(sameNflPropActorName(a,'Unrelated Player',id),false);
}
const snapshot={week:9,generatedAt:at,board:{decisions:[stored]},memberDecisions:[]} as unknown as LiveArgs['snapshot'];
const history={updatedAt:at,games:[],stats:[],teamStats:[],playMetrics:[],release:'synthetic'} as unknown as LiveArgs['history'];
const orphan={...quote,playerName:'Unresolved historical actor',isOpening:true};
const packet=liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot,observations:{generatedAt:at,observations:[native,quote,orphan]} as never,history,context});

const fixtures=[{providerGameId:game.id,scheduledStart:start,season:2026,week:9,phase:'regular' as const,homeTeam:'CHI',awayTeam:'TB',homeTeamName:'Chicago Bears',awayTeamName:'Tampa Bay Buccaneers'}];
const reconciled={...quote,reconciledFixture:{release:'nfl_player_props_reconciled_fixture_2026_11_26_r1_unique_schedule',
 availableAt:at,providerScheduledStart:'2026-11-08T20:55:00Z',providerHomeTeam:'Chicago Bears',providerAwayTeam:'Tampa Bay Buccaneers',
 canonicalGameId:game.id,scheduledStart:start,homeTeam:'CHI',awayTeam:'TB'}};
const withBinding=liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot,
 observations:{generatedAt:at,games:fixtures,observations:[native,reconciled,orphan]} as never,history,context});
assert.notEqual(digest(packet),digest(withBinding),'Original provider binding must be retained in submitted packet');
assert(JSON.stringify(withBinding).includes('20:55:00'),'Original provider kickoff must survive successful source preparation');
assert.equal(withBinding.sourceLimitations.filter(x=>x.startsWith('Original provider fixture')).length,1);
assert.deepEqual(withBinding.quotes,packet.quotes,'Provenance is not price chronology or a changed quote');
const duplicated=liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot,
 observations:{generatedAt:at,games:fixtures,observations:[native,reconciled,{...reconciled,providerObservationId:'other'}]} as never,history,context});
assert.equal(duplicated.sourceLimitations.filter(x=>x.startsWith('Original provider fixture')).length,1,'One declaration across multiple actor/price rows');
assert(JSON.stringify(sourceInput(withBinding)).includes('20:55:00'),'Actual request source retains original provider time');
const packed=packReaderSourceV3(withBinding as unknown as Json);assert.deepEqual(unpackReaderSourceV3(packed),withBinding);
assert.deepEqual(JSON.parse(gunzipSync(gzipSync(Buffer.from(JSON.stringify(withBinding)))).toString()),withBinding);
for(const mutate of [(q:any)=>q.reconciledFixture.providerScheduledStart='2026-11-08T19:00:00Z',
 (q:any)=>q.reconciledFixture.availableAt='2026-11-08T18:00:00Z',
 (q:any)=>q.reconciledFixture.providerHomeTeam='Different Club',
 (q:any)=>q.reconciledFixture.canonicalGameId='different',
 (q:any)=>q.reconciledFixture.homeTeam='GB',
 (q:any)=>q.reconciledFixture.release='unknown']){
 const bad=structuredClone(reconciled);mutate(bad);assert.throws(()=>liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot,observations:{generatedAt:at,games:fixtures,observations:[native,bad]} as never,history,context}));
}
assert.throws(()=>liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot,observations:{generatedAt:at,games:[...fixtures,{...fixtures[0],providerGameId:'ambiguous'}],observations:[native,reconciled]} as never,history,context}));
console.log('NFL fixture provenance retained: successful packet digest, complete deduplicated original declaration, lossless source-table/gzip roundtrip, unchanged quotes/old inputs, malformed/future/wrong/ambiguous fixture rejections. No network.');
