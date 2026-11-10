/** Native current collector identity is independent of retained orphan history.
 * Reproduces the shape of the actual pending early review with synthetic rows.
 * No provider, model, token counter, database or network requests.
 */
import assert from 'node:assert/strict';
import {liveNbaPacket} from '../lib/playerPropsAi/liveSources';
import {CATALOG} from '../lib/playerPropsAi/evidenceContract';
import {digest} from '../lib/playerPropsAi/evidence';
import type {NbaPlayerPropPriceObservation as Observation} from '../lib/services/nba/nbaPlayerPropsContract';

globalThis.fetch=async()=>{throw Error('NBA current identity proof forbids network');};
const cutoff='2026-11-10T18:51:31Z',receipt='2026-11-10T18:51:22Z',old='2026-11-10T07:12:38Z',start='2026-11-11T02:00:00Z',lock='2026-11-11T01:00:00Z';
const game={id:'synthetic-native-game',start,home:'BOS',away:'NYK'},window={gameId:game.id,stage:'early' as const,cutoff,lock};
const state={updatedAt:old,games:[{gameId:1,homeTeamId:1,awayTeamId:2,homeTeam:'BOS',awayTeam:'NYK',startTime:'2026-11-01T00:00:00Z'}],boxes:[],advanced:[],players:[]};
const known=[0,1].flatMap(actor=>CATALOG.nba.required.flatMap(market=>(['over','under'] as const).map(side=>({release:'synthetic',provider:'balldontlie',providerObservationId:`current:${actor}:${market}:${side}`,providerEventId:'native-provider-event',canonicalGameId:game.id,canonicalPlayerId:`nba-bdl-player:${actor+1}`,providerPlayerId:String(actor+1),playerName:`Synthetic Current ${actor}`,playerTeam:String(actor+1),sportsbook:'synthetic-book',market,providerMarket:market,offerType:'over_under',side,line:market==='threes'?1.5:6.5,americanPrice:-110,observedAt:receipt,fetchedAt:receipt,receivedAt:receipt,isOpening:false,isLive:false,homeTeam:'BOS',awayTeam:'NYK',scheduledStart:start})))) as unknown as Observation[];
// Four supported stat markets, both sides, the same old unmatched retail name,
// and no source player/team ID. Do not guess a canonical alias for this record.
const orphans=['points','rebounds','threes','points_rebounds'].flatMap(market=>(['over','under'] as const).map(side=>({...known[0],provider:'the_odds_api',providerObservationId:`old-unresolved:${market}:${side}`,providerEventId:'old-gap-event',canonicalPlayerId:null,providerPlayerId:null,playerName:'Synthetic Historical Name',playerTeam:null,market,providerMarket:`player_${market}`,side,observedAt:old,fetchedAt:old,receivedAt:old}))) as Observation[];
const snapshot={generatedAt:receipt,slateDate:'2026-11-10',games:[{gameId:game.id,scheduledStart:start,homeTeam:'BOS',awayTeam:'NYK'}],decisions:[]};
const args={game,window,snapshot,market:{updatedAt:receipt,observations:[...orphans,...known]},prior:state,current:state,currentObservations:known} as unknown as Parameters<typeof liveNbaPacket>[0];
const frozen=digest(args),baseline=liveNbaPacket({...args,market:{...args.market,observations:known}}),recovered=liveNbaPacket(args);
assert.equal(orphans.length,8);assert.equal(recovered.players.length,2);assert.equal(recovered.players.reduce((n,p)=>n+p.markets.length,0),16);
assert.deepEqual(recovered.players,baseline.players,'Historical unknown retail labels cannot alter any current canonical actor or market scope');
assert.deepEqual(recovered.quotes,baseline.quotes);assert.deepEqual(recovered.executionQuotes,baseline.executionQuotes,'All current exact execution quotes remain unchanged');
assert.equal(recovered.executionQuotes?.length,known.length);
assert(recovered.sourceLimitations.some(s=>s.includes('8 retail records without verified actor IDs')));
assert(recovered.players.every(p=>p.evidence.every(e=>!JSON.stringify(e.value).includes('Synthetic Historical Name'))),'An unresolved historical actor is never relabeled as a known actor');
assert.equal(digest(args),frozen,'Original retained history/current/native source bytes remain exact');
const unknown={...orphans[0],providerObservationId:'new-unknown',receivedAt:receipt,fetchedAt:receipt,observedAt:receipt};
assert.throws(()=>liveNbaPacket({...args,currentObservations:[...known,unknown]}),/NBA retail offered-player identity incomplete/,'A genuinely current unknown supported retail actor holds the whole game');
assert.throws(()=>liveNbaPacket({...args,currentObservations:[...known,{...unknown,provider:'balldontlie'}]}),/NBA retail offered-player identity incomplete/);
// Current-set authority, not a freshness guess: an explicitly returned old-price
// unknown remains blocked if the collector actually supplies it as current.
assert.throws(()=>liveNbaPacket({...args,currentObservations:[...known,orphans[0]]}),/NBA retail offered-player identity incomplete/);
for(const extra of [{...unknown,isOpening:true},{...unknown,isLive:true},{...unknown,receivedAt:'2026-11-10T18:52:00Z'},{...unknown,canonicalGameId:'other-game'},{...unknown,market:'blocks'}] as Observation[]){
 const p=liveNbaPacket({...args,currentObservations:[...known,extra]});assert.deepEqual(p.players,recovered.players);assert.deepEqual(p.executionQuotes,recovered.executionQuotes,'Only qualifying exact-game supported prelock current quotes enter execution');
}
const openingArgs={...args,market:{...args.market,observations:[...known,...orphans.map(q=>({...q,isOpening:true}))]}};
assert.doesNotThrow(()=>liveNbaPacket(openingArgs),'Unresolved opening history alone is supplemental, never a current offered actor');
assert.equal(liveNbaPacket({...args,currentObservations:[]}).executionQuotes?.length,0,'An explicitly empty successful collection cannot resurrect retained execution offers');
for(const missing of [undefined,null,{}])assert.throws(()=>liveNbaPacket({...args,currentObservations:missing} as never),/current collector observations unavailable/,'Missing/failed current collections cannot be treated as empty');
assert.equal(digest(args),frozen);
console.log('NBA current identity passed: eight old orphan retail records do not block all current actors/scopes/quotes; explicit current unknowns remain fail-closed, opening/live/future/wrong-game/unsupported isolation, explicit-empty versus missing, honest source limitations and immutable raw history. Synthetic only; no network.');
