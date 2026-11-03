import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyDraftKingsNetworkSplitFallback,UCL_PUBLIC_SPLIT_IDENTITY_RELEASE,type DraftKingsNetworkSplitFeed} from '../lib/providers/draftkings/draftKingsNetworkSplits';
import {populateStoredUclPublicSplits,refreshScheduledUclPublicSplits} from '../lib/services/ucl/uclPublicSplitSource';
import type {DailyEdgeResponse,DailyEdgeGameDto} from '../app/lab/lib/labTypes';
const source=JSON.parse(readFileSync(new URL('./fixtures/ucl-draftkings-public-feed-20261103.json',import.meta.url),'utf8')).payload as DraftKingsNetworkSplitFeed;
const native=JSON.parse(readFileSync(new URL('./fixtures/ucl-current-native-inputs-20261103.json',import.meta.url),'utf8'));
const games=native.games.map((g:{id:number;home:string;away:string;kickoff:string})=>({id:`soccer-ucl-${g.id}`,external_id:g.id,sport:'soccer',awayTeam:'AWY',homeTeam:'HOM',awayTeamDisplayName:g.away,homeTeamDisplayName:g.home,gameStartAt:g.kickoff,lockState:'open',lockedAt:null,projected:{away:1.2,home:1.3},markets:Object.fromEntries(['moneyline','total','first_inning'].map(k=>[k,{pick:k==='moneyline'?'HOM':k==='total'?'Over':'Yes',modelProb:.6,priceAmerican:-110,verdict:{key:'lean',label:'Lean'},reviewFlags:[],sportsbookSplits:null}]))})) as DailyEdgeGameDto[];
const board={sport:'soccer',date:'2026-11-03',as_of:source.fetchedAt,games} as DailyEdgeResponse;
const numerical=(b:DailyEdgeResponse)=>JSON.stringify(b.games.map(g=>({score:g.projected,markets:Object.fromEntries(Object.entries(g.markets).map(([k,m])=>[k,{pick:m.pick,p:m.modelProb,price:m.priceAmerican,grade:m.verdict}]))})));
const before=numerical(board),result=applyDraftKingsNetworkSplitFallback(board,source);
assert.deepEqual(result,{matchedGames:18,populatedMarkets:18});assert.equal(numerical(board),before);
for(const game of board.games){const s=game.markets.moneyline.sportsbookSplits!;assert.equal(s.label,'DraftKings Splits');assert.equal(s.sourceBook,'draftkings_network');assert.equal(s.rows.length,2);assert.ok(game.markets.moneyline.reviewFlags.includes(UCL_PUBLIC_SPLIT_IDENTITY_RELEASE));assert.equal(s.sourceObservedAt,source.fetchedAt);}
const gala=board.games.find(g=>g.external_id===4243833)!;
assert.equal(gala.markets.moneyline.sportsbookSplits!.rows.find(r=>r.side==='home')?.moneyPct,90,'home-first provider row maps to actual Galatasaray, never the opponent');
for(const lockState of ['locked','locking','missed'] as const){const locked=structuredClone(board);locked.games[0]!.lockState=lockState;locked.games[0]!.lockedAt=source.fetchedAt;const original=JSON.stringify(locked.games[0]);applyDraftKingsNetworkSplitFallback(locked,source,{reconstructMissingLockedPreLock:true});assert.equal(JSON.stringify(locked.games[0]),original);}
const duplicate=structuredClone(board);duplicate.games.push({...structuredClone(duplicate.games[0]!),id:'duplicate'});assert.equal(applyDraftKingsNetworkSplitFallback(duplicate,source).matchedGames,17,'same-day duplicate fixture is ambiguous');
const wrong=structuredClone(board);wrong.games[0]!.homeTeamDisplayName='Manchester City';assert.equal(applyDraftKingsNetworkSplitFallback(wrong,source).matchedGames,17);
const future=structuredClone(board);future.games[0]!.gameStartAt='2027-11-03T17:45:00Z';assert.equal(applyDraftKingsNetworkSplitFallback(future,source).matchedGames,17,'month/day cannot match another year');
const futureQuote=structuredClone(source);futureQuote.games[0]!.markets.moneyline!.observedAt='2099-11-03T12:00:00Z';
const futureBoard=structuredClone(board);for(const game of futureBoard.games)game.markets.moneyline.sportsbookSplits=null;
assert.equal(applyDraftKingsNetworkSplitFallback(futureBoard,futureQuote).populatedMarkets,17,'future quote clocks are not observed evidence');

export async function testUclPublicSplitSource(){
 const now=new Date('2026-11-03T16:00:00Z');let requests=0;
 const fresh=structuredClone(source);fresh.fetchedAt=now.toISOString();for(const game of fresh.games)game.markets.moneyline!.observedAt=now.toISOString();
 const deps={now,readMember:async()=>board,readFeed:async()=>source,refreshFeed:async()=>{requests++;return fresh;}};
 const refreshed=await refreshScheduledUclPublicSplits(deps);assert.equal(refreshed.fresh,true);assert.equal(refreshed.refreshed,true);assert.equal(requests,1);assert.equal(refreshed.paidProviderRequests,0);
 const reuse=await refreshScheduledUclPublicSplits({...deps,readFeed:async()=>fresh});assert.equal(reuse.skipped,true);assert.equal(requests,1);
 const freshEnvelope={...source,fetchedAt:now.toISOString()};
 const partial=await refreshScheduledUclPublicSplits({...deps,readFeed:async()=>freshEnvelope});assert.equal(partial.fresh,false);assert.equal(partial.skipped,true);assert.equal(partial.freshMoneylineGames,0);assert.equal(requests,1,'partial recent envelope respects cadence without hiding old market clocks');
 const stale=await refreshScheduledUclPublicSplits({...deps,refreshFeed:async()=>source});assert.equal(stale.fresh,false);assert.equal(stale.fetchedAt,source.fetchedAt,'stale retained source cannot be called fresh or restamped');
 const locked=structuredClone(board);for(const g of locked.games){g.lockState='locked';g.lockedAt=now.toISOString();}
 const inactive=await refreshScheduledUclPublicSplits({...deps,readMember:async()=>locked});assert.equal(inactive.skipped,true);assert.equal(requests,1);
 const member=structuredClone(board);const original=numerical(member);await populateStoredUclPublicSplits(member,async()=>source);assert.equal(numerical(member),original);
 const route=readFileSync('app/api/lab/daily-edge/route.ts','utf8');const ucl=route.slice(route.indexOf('if (sport === "ucl")'),route.indexOf('if (sport === "soccer")'));
 assert.match(ucl,/populateStoredUclPublicSplits/);assert.doesNotMatch(ucl,/populateDailyEdgeDraftKingsFallback\(/,'UCL API consumes existing data only');
 console.log('PASS UCL public splits: actual18 home-first fixtures, exact aliases/opponents/date, unchanged numerical decisions, locked bytes, scheduled refresh/cadence and no paid-provider requests.');
}
