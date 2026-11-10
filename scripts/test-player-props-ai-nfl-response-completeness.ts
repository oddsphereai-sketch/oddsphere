/** Real collector→live source→strict request controls. Every HTTP response and
 * model boundary is synthetic; no environment file, provider or AI is accessed. */
import assert from 'node:assert/strict';
import {collectNflPlayerPropsObservations} from '../lib/services/football/nflPlayerPropsCollector';
import {buildTeamDepthSnapshot} from '../lib/services/football/balldontlieNflRoster';
import {buildNflPlayerPropsRuntimeBoard} from '../lib/services/football/nflPlayerPropsRuntime';
import {reconcileNflPlayerPropsProductionSnapshot} from '../lib/services/football/nflPlayerPropsProductionContract';
import type {NflPlayerPropsInferenceContext} from '../lib/services/football/nflPlayerPropsInferenceContext';
import {liveNflPacket} from '../lib/playerPropsAi/liveSources';
import {jointReviewRequest} from '../lib/playerPropsAi/request';
import {digest} from '../lib/playerPropsAi/evidence';

globalThis.fetch=async()=>{throw Error('Response completeness proof forbids real HTTP');};
const at='2026-11-11T00:14:00Z',start='2026-11-11T01:20:00Z',lock='2026-11-11T00:20:00Z';
const OriginalDate=Date;
class SyntheticDate extends Date{
 constructor(value?:string|number){super(value??at);}
 static now(){return OriginalDate.parse(at);}
}
type Capture={calls:string[];identityCalls:number;sourceBuilds:number;requests:number;mockCounts:number;mockGenerations:number};
type Options={target?:'current'|'opening';patch?:Record<string,unknown>;empty?:boolean;includeOpenings?:boolean;status?:number;games?:number};
const record=(id:number,gameId:string)=>({id,game_id:gameId,player_id:id,vendor:'synthetic-book',prop_type:'receptions',line_value:6.5,
 updated_at:at,opened_at:'2026-11-10T18:00:00Z',market:{type:'over_under',over_odds:-110,under_odds:-110}});
const player=(id:number)=>({id,first_name:'Synthetic',last_name:`Receiver${String.fromCharCode(65+Math.floor(id/26)%26)}${String.fromCharCode(65+id%26)}`,position:'WR',team:{abbreviation:'KC'}});
async function capture(options:Options,observed:Capture){
 const gameIds=Array.from({length:options.games??1},(_,i)=>`synthetic-${i}`);
 const ids=gameIds.flatMap((_,i)=>[666+i*2,667+i*2]);
 const currentRows=(gameId:string)=>options.empty?[]:[666+gameIds.indexOf(gameId)*2,667+gameIds.indexOf(gameId)*2].map(id=>record(id,gameId));
 const rawEnvelopes:Record<string,unknown>[]=[];
 const collected=await collectNflPlayerPropsObservations({season:2026,week:10,phase:'regular',ballDontLieApiKey:'synthetic-only',owlsInsightApiKey:'',includeOpenings:options.includeOpenings,
 fetchImpl:async url=>{
  const u=new URL(String(url)),path=u.pathname;observed.calls.push(path+u.search);
  assert.equal(u.hostname,'api.balldontlie.io','Only explicitly mocked collector URLs are permitted');
  if(path==='/nfl/v1/games')return Response.json({data:gameIds.map(id=>({id,season:2026,week:10,date:start,home_team:{abbreviation:'BUF',full_name:'Buffalo'},visitor_team:{abbreviation:'KC',full_name:'Kansas City'}}))});
  if(path==='/nfl/v1/players'){observed.identityCalls++;return Response.json({data:ids.map(player)});}
  assert(['/nfl/v1/odds/player_props','/nfl/v1/odds/player_props/opening'].includes(path));
  assert.deepEqual([...u.searchParams.keys()],['game_id'],'No unsupported per_page, cursor or new page request');
  const current=path.endsWith('/player_props'),target=current?options.target!=='opening':options.target==='opening';
  if(target&&options.status)return Response.json({error:'synthetic optional unavailable'},{status:options.status});
  const values=currentRows(u.searchParams.get('game_id')!);
  const envelope={data:values,meta:{per_page:values.length},...(target?options.patch:{})};rawEnvelopes.push(structuredClone(envelope));
  return Response.json(envelope);
 }});
 const before=digest(collected);
 const board=buildNflPlayerPropsRuntimeBoard({offers:[],features:[],evaluatedAt:at});
 const baseline=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:board,previous:null});
 const contexts=gameIds.map((id,i)=>({canonicalGameId:id,scheduledStart:start,awayTeam:'KC',homeTeam:'BUF',awayDepth:buildTeamDepthSnapshot({team:'KC',capturedAt:at,sourceSnapshotId:'synthetic',rows:[666+i*2,667+i*2].map(id=>({player:player(id)}))}),homeDepth:{provider:'balldontlie',team:'BUF',capturedAt:at,roster:[]},injuries:null,weather:null}));
 const context={capturedAt:at,games:contexts} as unknown as NflPlayerPropsInferenceContext;
 const packets=gameIds.map(id=>{
  observed.sourceBuilds++;
  const packet=liveNflPacket({game:{id,start,away:'KC',home:'BUF'},window:{gameId:id,stage:'final',cutoff:at,lock},snapshot:baseline,observations:collected.snapshot,
   history:{updatedAt:at,games:[],stats:[],teamStats:[],playMetrics:[]},context,emptyCurrentGame:collected.emptyCurrentGames.find(p=>p.gameId===id)} as never);
  const request=jointReviewRequest(packet,'gpt-6-luna',7000);observed.requests++;
  // Mock downstream accounting only: no token-count or generation function is invoked.
  observed.mockCounts++;observed.mockGenerations++;
  const inventory=request.text.format.schema.properties.players;
  assert(inventory&&typeof inventory==='object'&&'properties' in inventory);
  assert(inventory.properties&&typeof inventory.properties==='object');
  assert.equal(Object.keys(inventory.properties).length,2);
  assert.equal(packet.players.length,2);assert.equal(packet.executionQuotes?.length,4);
  assert(packet.players.every(p=>p.markets.join('|')==='receptions'));
  return packet;
 });
 assert.equal(digest(collected),before,'Pure source/request consumers preserve original collector bytes');
 return{collected,packets,rawEnvelopes};
}
const counters=():Capture=>({calls:[],identityCalls:0,sourceBuilds:0,requests:0,mockCounts:0,mockGenerations:0});
async function main(){
 globalThis.Date=SyntheticDate as DateConstructor;
 try{
  // Both complete actors survive actual normalization, schedule/ID binding,
  // live source construction and strict model-schema inventory.
  let healthyObservationHash:string|undefined;
  for(const patch of [{},{meta:undefined},{meta:null},{meta:{per_page:2}},{meta:{next_cursor:null,has_more:false}},{meta:{per_page:2,diagnostic:'unrelated value'},unrelated:{note:'not a completeness protocol'}}]){
   const seen=counters(),result=await capture({patch,includeOpenings:true},seen);
   assert.equal(result.collected.snapshot.collectionComplete,true);assert.equal(result.collected.emptyCurrentGames.length,0);
   assert.equal(result.collected.snapshot.observations.length,8,'Two raw props yield four current and four opening price legs');
   const hash=digest(result.collected.snapshot.observations);healthyObservationHash??=hash;assert.equal(hash,healthyObservationHash,'Accepted envelope metadata cannot change any native ID, source/receipt clock, event, side or price');
   assert(result.collected.snapshot.observations.every(q=>q.americanPrice===-110&&Date.parse(q.receivedAt!)===Date.parse(at)&&Date.parse(q.fetchedAt)===Date.parse(at)&&Date.parse(q.observedAt)===Date.parse(q.isOpening?'2026-11-10T18:00:00Z':at)));
   assert.equal(seen.identityCalls,1);assert.equal(seen.calls.length,4);assert.equal(seen.requests,1);
  }
  const full=counters(),slate=await capture({games:18,includeOpenings:true},full);
  assert.equal(slate.packets.reduce((n,p)=>n+p.players.length,0),36);assert.equal(full.requests,18);assert.equal(full.calls.length,38,'One schedule + eighteen current + eighteen opening + one bounded identity request');
  // Known contradictory continuation forms and malformed documented count
  // fields reject before normalization can contribute rows or request identities.
  const badPatches:Record<string,unknown>[]=[
   {next_cursor:'next'},{nextCursor:1},{pagination:{}},{has_more:true},{hasMore:true},
   {meta:{next_cursor:'next'}},{meta:{next_cursor:{unknown:true}}},{meta:{nextCursor:'next'}},{meta:{pagination:{}}},{meta:{has_more:true}},{meta:{hasMore:true}},{meta:{has_more:'false'}},
   {meta:'malformed'},{meta:[]},{meta:{per_page:'2'}},{meta:{per_page:null}},{meta:{per_page:-1}},{meta:{per_page:1.5}},{meta:{per_page:Number.MAX_SAFE_INTEGER+1}},{meta:{per_page:0}},{meta:{per_page:3}},
  ];
  for(const target of ['current','opening'] as const)for(const empty of [false,true])for(const patch of badPatches){
   // A count of zero is valid for the genuinely empty documented response.
   if(empty&&(patch.meta as {per_page?:unknown})?.per_page===0)continue;
   const seen=counters();
   await assert.rejects(capture({target,empty,patch,includeOpenings:true},seen),/complete single-response contract/);
   assert.equal(seen.identityCalls,0);assert.equal(seen.sourceBuilds+seen.requests+seen.mockCounts+seen.mockGenerations,0);
   assert.equal(seen.calls.length,target==='current'?2:3,'Refusal adds no provider request');
  }
  // Genuine complete emptiness is still a collection result/withdrawal proof,
  // never a fabricated offered actor. Optional errors do not attest withdrawal.
  for(const status of [undefined,404,422]){
   const seen=counters();
   // Observe the collector directly because an empty new board has no prior
   // identity from which a withdrawal-only packet could honestly be constructed.
   await assert.rejects(capture({empty:true,status,includeOpenings:false,patch:{meta:{per_page:0}}},seen),status?/no offered supported players/:/no exact available withdrawal identity/);
   assert.equal(seen.identityCalls,0);assert.equal(seen.requests+seen.mockCounts+seen.mockGenerations,0);
  }
  // Explicit successful empty proof and unavailable optional response are also
  // inspected directly through the real collector, without a synthetic prior.
  for(const status of [200,404,422]){
   const collected=await collectNflPlayerPropsObservations({season:2026,week:10,phase:'regular',ballDontLieApiKey:'synthetic-only',owlsInsightApiKey:'',fetchImpl:async url=>{
    const path=new URL(String(url)).pathname;
    if(path.endsWith('/games'))return Response.json({data:[{id:'empty',season:2026,week:10,date:start,home_team:{abbreviation:'BUF'},visitor_team:{abbreviation:'KC'}}]});
    assert(path.endsWith('/odds/player_props'));return Response.json(status===200?{data:[],meta:{per_page:0}}:{error:'unavailable'},{status});
   }});
   assert.equal(collected.snapshot.observations.length,0);assert.equal(collected.emptyCurrentGames.length,status===200?1:0);
  }
  console.log(`NFL response completeness passed: actual two-actor and full eighteen-game collector→packet→strict request success, documented raw counts/current-opening clocks, ${badPatches.length} contradictory/malformed envelope controls on empty/nonempty current/opening, refusal before identity/downstream work, unchanged requests and optional404/422 unavailable versus genuine complete empty. All HTTP/accounting synthetic; no provider/count/AI/DB calls.`);
 }finally{globalThis.Date=OriginalDate;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
