/** Whole-response producer→actual source→strict request; all HTTP synthetic. */
import {assertCompleteBdlPropsResponse,assertCompleteOwlsPropsResponse,assertNoDeclaredContinuation,PlayerPropsResponseCompletenessError} from '../lib/providers/playerPropsResponseCompleteness';
import assert from 'node:assert/strict';
import {digest} from '../lib/playerPropsAi/evidence';
import {collectNflPlayerPropsObservations} from '../lib/services/football/nflPlayerPropsCollector';
import {collectNbaPlayerPropsLiveMarket} from '../lib/services/nba/nbaPlayerPropsLiveCollector';
import {liveNflPacket,liveNbaPacket} from '../lib/playerPropsAi/liveSources';
import {jointReviewRequest} from '../lib/playerPropsAi/request';
import {buildTeamDepthSnapshot} from '../lib/services/football/balldontlieNflRoster';
const at='2026-11-10T17:00:00Z',start='2026-11-11T01:20:00Z',lock='2026-11-11T00:20:00Z';
const OriginalDate=Date;class Clock extends Date{constructor(v?:string|number){super(v??at);}static now(){return OriginalDate.parse(at);}}globalThis.Date=Clock as DateConstructor;
const actor={id:666,first_name:'Synthetic',last_name:'Receiver',position:'WR',team_id:1,team:{abbreviation:'KC'}};
function owls(sport:'nba'|'nfl',patch:Record<string,unknown>){return{success:true,data:[{gameId:sport+':synthetic',homeTeam:sport==='nfl'?'BUF':'NYK',awayTeam:sport==='nfl'?'KC':'BOS',commenceTime:start,isLive:false,books:[{key:'pinnacle',lastUpdate:at,props:[{playerName:'Synthetic Receiver',team:sport==='nfl'?'KC':'BOS',category:sport==='nfl'?'receptions':'points',line:6.5,overPrice:-110,underPrice:-110,lastUpdate:at}]}]}],meta:{gamesReturned:1,propsReturned:1},...patch};}
async function nfl(patch:Record<string,unknown>,rejected=false){let calls=0;const c=await collectNflPlayerPropsObservations({season:2026,week:10,phase:'regular',ballDontLieApiKey:'synthetic',owlsInsightApiKey:'synthetic',fetchImpl:async url=>{calls++;const u=new URL(String(url));if(u.hostname==='api.owlsinsight.com')return Response.json(owls('nfl',patch));if(u.pathname.endsWith('/games'))return Response.json({data:[{id:'g',season:2026,week:10,date:start,home_team:{abbreviation:'BUF'},visitor_team:{abbreviation:'KC'}}]});if(u.pathname.endsWith('/players'))return Response.json({data:[actor]});return Response.json({data:[{id:1,game_id:'g',player_id:666,vendor:'draftkings',prop_type:'receptions',line_value:6.5,updated_at:at,market:{type:'over_under',over_odds:-110,under_odds:-110}}],meta:{per_page:1}});}});
 const context={capturedAt:at,games:[{canonicalGameId:'g',scheduledStart:start,awayTeam:'KC',homeTeam:'BUF',awayDepth:buildTeamDepthSnapshot({team:'KC',capturedAt:at,sourceSnapshotId:'synthetic',rows:[{player:actor}]}),homeDepth:{provider:'balldontlie',team:'BUF',capturedAt:at,roster:[]},injuries:null,weather:null}]};
 const p=liveNflPacket({game:{id:'g',start,away:'KC',home:'BUF'},window:{gameId:'g',stage:'early',cutoff:at,lock},snapshot:{week:10,generatedAt:at,board:{decisions:[]},memberDecisions:[]},observations:c.snapshot,context,history:{updatedAt:at,games:[],stats:[],teamStats:[],playMetrics:[]}} as never);jointReviewRequest(p,'gpt-6-luna',7000);assert.equal(p.players.length,1);assert.equal(p.executionQuotes?.filter(q=>q.provider==='owls').length,rejected?0:2);assert.equal(c.snapshot.collectionComplete,!rejected);assert.equal(c.snapshot.healthFindings.includes('OWLS_PLAYER_PROPS_CAPTURE_FAILED'),rejected);assert.equal(c.emptyCurrentGames.length,0);return{calls,rows:c.snapshot.observations.length,complete:c.snapshot.collectionComplete,players:p.players.length,sourceQuotes:p.executionQuotes?.length,quotesDigest:digest(p.executionQuotes)};}
async function nba(patch:Record<string,unknown>,rejected=false){let calls=0;const c=await collectNbaPlayerPropsLiveMarket({slateDate:'2026-11-10',ballDontLieApiKey:'synthetic',owlsInsightApiKey:'synthetic',includeOpenings:false,canonicalPlayersByName:{syntheticreceiver:'nba-bdl-player:666'},fetchImpl:async url=>{calls++;const u=new URL(String(url));if(u.hostname==='api.owlsinsight.com')return Response.json(owls('nba',patch));if(u.pathname.endsWith('/games'))return Response.json({data:[{id:77,date:start,home_team:{id:2,abbreviation:'NYK'},visitor_team:{id:1,abbreviation:'BOS'}}]});return Response.json({data:[{id:1,game_id:77,player_id:666,player:{...actor,team:{id:1}},vendor:'draftkings',prop_type:'points',line_value:6.5,updated_at:at,market:{type:'over_under',over_odds:-110,under_odds:-110}}],meta:{per_page:1}});}});
 const state={updatedAt:at,games:[{gameId:1,homeTeamId:1,awayTeamId:2,homeTeam:'BOS',awayTeam:'NYK',startTime:'2026-11-01T00:00:00Z'}],boxes:[],advanced:[],players:[]};
 const p=liveNbaPacket({game:{id:'nba-bdl:77',start,home:'NYK',away:'BOS'},window:{gameId:'nba-bdl:77',stage:'early',cutoff:at,lock},snapshot:{generatedAt:at,slateDate:'2026-11-10',games:[{gameId:'nba-bdl:77',scheduledStart:start,homeTeam:'NYK',awayTeam:'BOS'}],decisions:[]},market:{updatedAt:at,observations:c.observations},currentObservations:c.observations,prior:state,current:state}as never);jointReviewRequest(p,'gpt-6-luna',7000);assert.equal(p.players.length,1);assert.equal(p.executionQuotes?.filter(q=>q.provider==='owls').length,rejected?0:2);assert.equal(c.findings.includes('owls_player_props_capture_failed'),rejected);return{calls,rows:c.observations.length,players:p.players.length,sourceQuotes:p.executionQuotes?.length,quotesDigest:digest(p.executionQuotes)};}

const continuation:Record<string,unknown>[]=[
 {next_cursor:'next'},{nextCursor:1},{pagination:{}},{has_more:true},{hasMore:true},
 {meta:{next_cursor:'next'}},{meta:{next_cursor:{invalid:true}}},{meta:{nextCursor:'next'}},{meta:{pagination:{}}},{meta:{has_more:true}},{meta:{hasMore:true}},{meta:{has_more:'false'}},
];
const malformed:Record<string,unknown>[]=[{success:false},{success:'true'},{success:null},{data:null},{data:{}},{meta:'malformed'},{meta:[]}];
const owlsCounts:Record<string,unknown>[]=[{meta:{gamesReturned:2}},{meta:{gamesReturned:0}},{meta:{gamesReturned:-1}},{meta:{gamesReturned:1.5}},{meta:{gamesReturned:'1'}},{meta:{gamesReturned:null}},{meta:{gamesReturned:Number.MAX_SAFE_INTEGER+1}}];
const healthy:Record<string,unknown>[]=[{}, {meta:undefined},{meta:null},{meta:{}},{meta:{gamesReturned:1}},{meta:{gamesReturned:1,propsReturned:156,diagnostic:'unrelated metadata'}},{success:true,meta:{gamesReturned:1,next_cursor:null,hasMore:false}}];
function pureGuardControls(){
 for(const guard of [assertCompleteBdlPropsResponse,assertCompleteOwlsPropsResponse]){
  for(const patch of [...continuation,...malformed])assert.throws(()=>guard({data:[{}],...patch},'synthetic'),PlayerPropsResponseCompletenessError);
  for(const value of [null,[],{},'malformed'])assert.throws(()=>guard(value,'synthetic'),PlayerPropsResponseCompletenessError);
 }
 for(const count of [0,2,-1,1.5,'1',null,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>assertCompleteBdlPropsResponse({data:[{}],meta:{per_page:count}},'synthetic'),PlayerPropsResponseCompletenessError);
 for(const patch of healthy)assertCompleteOwlsPropsResponse({data:[{}],...patch},'synthetic');
 for(const value of [{data:[]},{data:[],meta:null},{data:[],meta:{per_page:0}},{data:[{}],meta:{per_page:1}},{success:true,data:[{}],meta:{per_page:1}}])assertCompleteBdlPropsResponse(value,'synthetic');
 // Schedule page size describes its bound, not how many fixtures are returned.
 assertNoDeclaredContinuation({data:[{}],meta:{per_page:100}},'synthetic schedule');
}
async function nflScheduleControls(){
 for(const patch of [{meta:{per_page:100}},...continuation]){
  let calls=0;
  const operation=collectNflPlayerPropsObservations({season:2026,week:10,phase:'regular',ballDontLieApiKey:'synthetic',owlsInsightApiKey:'',fetchImpl:async url=>{calls++;const u=new URL(String(url));
   if(u.pathname.endsWith('/games'))return Response.json({data:[{id:'g',season:2026,week:10,date:start,home_team:{abbreviation:'BUF'},visitor_team:{abbreviation:'KC'}}],...patch});
   assert(u.pathname.endsWith('/odds/player_props'));return Response.json({data:[],meta:{per_page:0}});
  }});
  if('meta' in patch&&Object.hasOwn(patch.meta!,'per_page')){const result=await operation;assert.equal(calls,2);assert.equal(result.emptyCurrentGames.length,1);}
  else{await assert.rejects(operation,PlayerPropsResponseCompletenessError);assert.equal(calls,1,'Refusal before props/identities/source/token requests');}
 }
}
async function failedOwlsCannotAttestEmpty(){
 for(const patch of [...continuation,...owlsCounts,{success:false},{meta:'malformed'}]){
  let calls=0;
  const result=await collectNflPlayerPropsObservations({season:2026,week:10,phase:'regular',ballDontLieApiKey:'synthetic',owlsInsightApiKey:'synthetic',fetchImpl:async url=>{calls++;const u=new URL(String(url));
   if(u.hostname==='api.owlsinsight.com')return Response.json(owls('nfl',patch));
   if(u.pathname.endsWith('/games'))return Response.json({data:[{id:'g',season:2026,week:10,date:start,home_team:{abbreviation:'BUF'},visitor_team:{abbreviation:'KC'}}]});
   assert(u.pathname.endsWith('/odds/player_props'));return Response.json({data:[],meta:{per_page:0}});
  }});
  assert.equal(calls,3);assert.equal(result.snapshot.observations.length,0);assert.equal(result.snapshot.collectionComplete,false);assert.equal(result.emptyCurrentGames.length,0);assert(result.snapshot.healthFindings.includes('OWLS_PLAYER_PROPS_CAPTURE_FAILED'));
 }
}
async function main(){try{
 pureGuardControls();
 for(const sport of ['nba','nfl'] as const){
  const run=sport==='nba'?nba:nfl,baseline=await run({});
  assert.equal(baseline.calls,4);assert.equal(baseline.rows,4);assert.equal(baseline.players,1);assert.equal(baseline.sourceQuotes,4);
  for(const patch of healthy)assert.deepEqual(await run(patch),baseline,'Healthy optional metadata retains native IDs/actor and exact current coverage');
  for(const patch of [...continuation,...malformed,...owlsCounts]){
   const result=await run(patch,true);assert.equal(result.calls,4,'No new paging or recovery requests');assert.equal(result.rows,2);assert.equal(result.sourceQuotes,2);assert.equal(result.players,1,'Healthy BDL actor remains independently supplied');
  }
  // Capacity rejection happens after raw extraction and must discard every row.
  const tooMany={data:Array.from({length:33},()=>owls(sport,{}).data[0]),meta:undefined};
  assert.equal((await run(tooMany,true)).rows,2);
 }
 await nflScheduleControls();await failedOwlsCannotAttestEmpty();
 console.log('Whole-source responses passed: shared BDL raw-count/whole-array, documented Owls event-count, malformed/failed/continued/capacity negatives, actual NBA/NFL collectors→current packet→strict request, healthy source IDs/coverage, failed secondary discarded/incomplete not withdrawal, exact NFL schedule page-size100 and pre-source refusal. All HTTP synthetic; zero provider/count/AI/DB.');
}finally{globalThis.Date=OriginalDate;}}
main().catch(error=>{console.error(error);process.exitCode=1;});
