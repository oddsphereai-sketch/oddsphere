import assert from 'node:assert/strict';
import {__NFL_PLAYER_PROPS_COLLECTOR_TEST__ as collector} from '../lib/services/football/nflPlayerPropsCollector';
import {normalizeOwlsNflPlayerProps} from '../lib/services/football/nflPlayerPropsProviders';
import {createNflPacketActorResolver} from '../lib/playerPropsAi/nflPlayerIdentity';
import type {NflPlayerPropPriceObservation} from '../lib/services/football/nflPlayerPropsContract';
import {NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE,NFL_PLAYER_PROPS_RECONCILED_FIXTURE_RELEASE} from '../lib/services/football/nflPlayerPropsContract';
globalThis.fetch=async()=>{throw Error('Network blocked: synthetic fixture source only');};
const now='2026-11-26T17:21:22.128Z',fetched='2026-11-26T17:21:13.036Z',start='2026-11-27T01:20:00.000Z';
const game={season:2026,week:12,phase:'regular' as const,providerGameId:'synthetic-game',scheduledStart:start,
  homeTeam:'BUF',awayTeam:'KC',homeTeamName:'Buffalo Bills',awayTeamName:'Kansas City Chiefs'};
const original=normalizeOwlsNflPlayerProps({fetchedAt:fetched,values:[{gameId:'synthetic-provider-event',homeTeam:game.homeTeamName,
  awayTeam:game.awayTeamName,commenceTime:'2026-11-27T01:15:00.000Z',isLive:false,
  books:[{key:'novig',lastUpdate:fetched,props:[{playerName:'Synthetic Player',category:'receiving_yards',line:42.5,
    overPrice:-105,underPrice:-115,lastUpdate:fetched}]}]}]}).rows.map(row=>({...row,receivedAt:now}));
assert.equal(original.length,2);const before=JSON.stringify(original);
const fixed=collector.reconcileProviderRowsToSlate(original,[game],now);
assert.equal(fixed.unmatchedRows,0);assert.equal(fixed.rows.length,2);
for(const [i,row]of fixed.rows.entries()){
 assert.equal(row.scheduledStart,start);assert.equal(row.canonicalGameId,game.providerGameId);
 assert.deepEqual(row.reconciledFixture,{release:NFL_PLAYER_PROPS_RECONCILED_FIXTURE_RELEASE,availableAt:now,
  providerScheduledStart:original[i].scheduledStart,providerHomeTeam:game.homeTeamName,providerAwayTeam:game.awayTeamName,
  canonicalGameId:game.providerGameId,scheduledStart:start,homeTeam:'BUF',awayTeam:'KC'});
 const {canonicalGameId:_id,scheduledStart:_start,reconciledFixture:_proof,...actual}=row;
 const {canonicalGameId:_oldId,scheduledStart:_oldStart,...expected}=original[i];
 assert.equal(_id,game.providerGameId);assert.equal(_start,start);assert(_proof);assert.equal(_oldId,null);assert.equal(_oldStart,'2026-11-27T01:15:00.000Z');
 assert.deepEqual(actual,expected,'All offered actor/market/price and provider time fields remain exact');
}
const resolve=createNflPacketActorResolver({game:{id:game.providerGameId,start,home:'BUF',away:'KC'},cutoff:now,
 observationsAvailableAt:now,observations:fixed.rows,rows:[],context:{capturedAt:now,games:[{
 canonicalGameId:game.providerGameId,scheduledStart:start,homeTeam:'BUF',awayTeam:'KC',
 awayDepth:{team:'KC',capturedAt:fetched,roster:[{playerId:'synthetic-id',name:'Synthetic Player',position:'WR'}]},
 homeDepth:{team:'BUF',capturedAt:fetched,roster:[]}}]} as unknown as Parameters<typeof createNflPacketActorResolver>[0]['context']});
assert(original.every(row=>resolve(row)===null),'Original mismatched-clock rows remain rejected by unchanged exact guard');
assert(fixed.rows.every(row=>resolve(row)?.providerId==='synthetic-id'),'Same complete two-way offer now binds its exact canonical fixture');
assert.equal(JSON.stringify(original),before,'No historical observation is rewritten');
const result=(rows:NflPlayerPropPriceObservation[]=original,games=[game],at:string|undefined=now)=>collector.reconcileProviderRowsToSlate(rows,games,at);
assert.equal(result(original,[game,{...game,providerGameId:'ambiguous'}]).rows.length,0);
assert.equal(result(original,[{...game,homeTeam:'NE',homeTeamName:'New England Patriots'}]).rows.length,0);
assert.equal(result(original,[{...game,awayTeam:'NE',awayTeamName:'New England Patriots'}]).rows.length,0);
assert.equal(result(original,[{...game,scheduledStart:'2026-11-27T01:31:00.000Z'}]).rows.length,0);
assert.equal(result(original,[{...game,scheduledStart:'2026-11-28T01:20:00.000Z'}]).rows.length,0);
assert.equal(collector.reconcileProviderRowsToSlate(original,[game]).rows.length,0);
for(const bad of ['invalid','2026-11-26T17:21:22.129Z',fetched])assert.equal(result(original,[game],bad).rows.length,0);
for(const change of [(row:typeof original[number])=>({...row,isOpening:true}),
 (row:typeof original[number])=>({...row,isLive:true}),
 (row:typeof original[number])=>({...row,observedAt:'2026-11-26T17:22:00Z'}),
 (row:typeof original[number])=>({...row,fetchedAt:'2026-11-26T17:22:00Z'}),
 (row:typeof original[number])=>({...row,canonicalGameId:'already-bound'})])assert.equal(result(original.map(change)).rows.length,0);
assert.equal(result(fixed.rows).rows.length,2,'Exact canonical rows are stable and keep original binding proof');
const exact=original.map(row=>({...row,scheduledStart:start}));assert.deepEqual(result(exact).rows,exact.map(row=>({...row,canonicalGameId:game.providerGameId})));
const legacy=original.map(row=>({...row,provider:'sharpapi' as const}));assert.deepEqual(result(legacy).rows,legacy.map(row=>({...row,canonicalGameId:game.providerGameId})),'Legacy normalization stays exact');
assert.match(NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE,/r17_/);
console.log('NFL prospective fixture reconciliation passed: complete original OU inventory, exact prices/clocks, unique existing 15-minute mapping, independent canonical clock and retained provider provenance; unchanged identity guard/legacy inputs. No network.');
