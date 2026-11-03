import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyDraftKingsNetworkSplitFallback,fetchDraftKingsNetworkSplits,UCL_PUBLIC_SPLIT_IDENTITY_RELEASE,type DraftKingsNetworkSplitFeed} from '../lib/providers/draftkings/draftKingsNetworkSplits';
import {populateStoredUclPublicSplits,refreshScheduledUclPublicSplits,captureStoredUclPublicSplits} from '../lib/services/ucl/uclPublicSplitSource';
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
 for(const sport of ['ucl','cbb'] as const){
  const options:RequestInit[]=[];
  await fetchDraftKingsNetworkSplits({sport,fetchImpl:async(_url,init)=>{options.push(init??{});return new Response('',{status:200,headers:{date:'Tue, 03 Nov 2026 16:00:00 GMT'}});}});
  assert.equal(options.length,2,'same bounded source seed pages, no extra collection');
  for(const init of options){if(sport==='ucl'){assert.equal(init.cache,'no-store');assert.equal('next'in init,false,'due UCL collector cannot reuse a stale HTTP cache capture');}
   else{assert.equal(init.cache,undefined);assert.ok('next'in init,'other sports retain their existing HTTP cache policy');}}
 }
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
 const prior:DailyEdgeResponse={...structuredClone(board),games:[structuredClone(board.games[0]!)]};
 prior.games[0]!.soccerCompetitionContext={competition:'uefa_champions_league'} as DailyEdgeGameDto['soccerCompetitionContext'];
 prior.games[0]!.scheduledLockAt='2026-11-03T16:45:00Z';prior.games[0]!.markets.moneyline.sportsbookSplits=null;
 const preFeed=structuredClone(source);preFeed.fetchedAt='2026-11-03T16:40:00Z';for(const g of preFeed.games)g.markets.moneyline!.observedAt=preFeed.fetchedAt;
 const preNumeric=numerical(prior);
 await captureStoredUclPublicSplits(prior,null,{now:new Date(preFeed.fetchedAt),readFeed:async()=>preFeed});
 const saved=structuredClone(prior.games[0]!.markets.moneyline.sportsbookSplits!);
 assert.equal(saved.memberCapturedAt,new Date(preFeed.fetchedAt).toISOString());assert.equal(numerical(prior),preNumeric);
 const due=()=>{const b=structuredClone(prior);b.games[0]!.lockState='locking';b.games[0]!.markets.moneyline.sportsbookSplits=null;return b;};
 const postFeed=structuredClone(preFeed);postFeed.fetchedAt='2026-11-03T16:46:00Z';for(const g of postFeed.games){g.markets.moneyline!.observedAt=postFeed.fetchedAt;g.markets.moneyline!.sides[0]!.moneyPct=50;}
 const locking=due(),priorBytes=JSON.stringify(prior);
 const carried=await captureStoredUclPublicSplits(locking,prior,{now:new Date(postFeed.fetchedAt),readFeed:async()=>postFeed});
 assert.equal(carried.carriedPrelockMarkets,1);assert.deepEqual(locking.games[0]!.markets.moneyline.sportsbookSplits,saved,'postcutoff source cannot replace the exact published prelock section');
 assert.equal(JSON.stringify(prior),priorBytes,'carry cannot mutate prior published evidence');
 const betweenRefreshes=structuredClone(prior),earlier=betweenRefreshes.games[0]!.markets.moneyline.sportsbookSplits!;
 earlier.sourceObservedAt='2026-11-03T16:15:00Z';earlier.memberCapturedAt='2026-11-03T16:17:00Z';earlier.captureRelease='ucl_public_split_source_2026_11_03_r2_capture_before_lock';
 const quarterHour=due();await captureStoredUclPublicSplits(quarterHour,betweenRefreshes,{now:new Date(postFeed.fetchedAt),readFeed:async()=>postFeed});
 assert.deepEqual(quarterHour.games[0]!.markets.moneyline.sportsbookSplits,earlier,':17 publication survives :45 lock without inventing a newer source clock, including genuine R2 receipts');
 for(const corrupt of ['postcapture','postquote','stale','stalecapture','wrongfixture','wrongteam','wrongfullname','wrongid','wrongcompetition','lockedprior'] as const){
  const bad=structuredClone(prior),g=bad.games[0]!,s=g.markets.moneyline.sportsbookSplits!;
  if(corrupt==='postcapture')s.memberCapturedAt=postFeed.fetchedAt;
  if(corrupt==='postquote')s.sourceObservedAt=postFeed.fetchedAt;
  if(corrupt==='stale'){s.sourceObservedAt='2026-11-03T12:00:00Z';s.memberCapturedAt='2026-11-03T12:02:00Z';}
  if(corrupt==='stalecapture')s.sourceObservedAt='2026-11-03T16:00:00Z';
  if(corrupt==='wrongfixture')g.gameStartAt='2026-11-04T17:45:00Z';
  if(corrupt==='wrongteam')g.homeTeam='OTHER';
  if(corrupt==='wrongfullname')g.homeTeamDisplayName='Other club with the same abbreviation';
  if(corrupt==='wrongid')g.id='wrong-game';
  if(corrupt==='wrongcompetition')g.soccerCompetitionContext={competition:'english_premier_league'} as unknown as DailyEdgeGameDto['soccerCompetitionContext'];
  if(corrupt==='lockedprior'){g.lockState='locked';g.lockedAt='2026-11-03T16:44:00Z';}
  const candidate=due();await captureStoredUclPublicSplits(candidate,bad,{now:new Date(postFeed.fetchedAt),readFeed:async()=>postFeed});
  assert.equal(candidate.games[0]!.markets.moneyline.sportsbookSplits,null,corrupt+' cannot fill a new lock');
 }
 const frozen=due();frozen.games[0]!.lockState='locked';frozen.games[0]!.lockedAt='2026-11-03T16:45:00Z';const frozenBytes=JSON.stringify(frozen);
 await captureStoredUclPublicSplits(frozen,prior,{now:new Date(postFeed.fetchedAt),readFeed:async()=>postFeed});assert.equal(JSON.stringify(frozen),frozenBytes,'already locked empty evidence is immutable');
 const route=readFileSync('app/api/lab/daily-edge/route.ts','utf8');const ucl=route.slice(route.indexOf('if (sport === "ucl")'),route.indexOf('// Member reads must never rebuild',route.indexOf('if (sport === "ucl")')));
 assert.match(ucl,/populateStoredUclPublicSplits/);assert.doesNotMatch(ucl,/populateDailyEdgeDraftKingsFallback\(/,'UCL API consumes existing data only');
 console.log('PASS UCL public splits: actual18 home-first fixtures, exact aliases/opponents/date, unchanged numerical decisions, locked bytes, scheduled refresh/cadence and no paid-provider requests.');
}
