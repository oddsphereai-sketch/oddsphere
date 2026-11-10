/** Actual collector -> live packet -> strict request; all HTTP is injected. */
import assert from 'node:assert/strict';
import {collectNbaPlayerPropsLiveMarket} from '../lib/services/nba/nbaPlayerPropsLiveCollector';
import {liveNbaPacket} from '../lib/playerPropsAi/liveSources';
import {jointReviewRequest} from '../lib/playerPropsAi/request';
import {digest} from '../lib/playerPropsAi/evidence';
import {NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE,type NbaPlayerPropsCurrentState} from '../lib/services/nba/nbaPlayerPropsCurrentState';
import {buildNbaPlayerPropsMemberSnapshot} from '../lib/services/nba/nbaPlayerPropsProductContract';

globalThis.fetch=async()=>{throw Error('NBA completeness proof forbids real HTTP');};
const at='2026-11-10T22:00:00Z',start='2026-11-11T02:00:00Z',lock='2026-11-11T01:00:00Z';
const OriginalDate=Date;
class SyntheticDate extends OriginalDate{constructor(value?:string|number){super(value??at);}static now(){return OriginalDate.parse(at);}}
const raw=[1,2].map(id=>({id:100+id,game_id:77,player_id:id,vendor:'draftkings',prop_type:'points',line_value:20.5,updated_at:at,opened_at:'2026-11-10T18:00:00Z',market:{type:'over_under',over_odds:-110,under_odds:-110}}));
const names={'1':{playerName:'Synthetic One',playerTeam:'1'},'2':{playerName:'Synthetic Two',playerTeam:'2'}};
const owls={gameId:'reference-game',homeTeam:'BOS',awayTeam:'NYK',commenceTime:start,books:[{key:'pinnacle',lastUpdate:at,props:[{propId:'one',category:'points',playerName:'Synthetic One',team:'BOS',line:20.5,overPrice:-110,underPrice:-110}]}]};
type Target='current'|'opening'|'schedule'|'owls';
type Options={target?:Target;patch?:Record<string,unknown>;partial?:boolean;empty?:boolean;opening?:boolean;owls?:boolean};
type Seen={calls:string[];sources:number;requests:number};
const seen=():Seen=>({calls:[],sources:0,requests:0});
async function collect(options:Options,observed:Seen){
 const envelopes:unknown[]=[];
 const result=await collectNbaPlayerPropsLiveMarket({slateDate:'2026-11-10',ballDontLieApiKey:'synthetic',owlsInsightApiKey:options.owls?'synthetic':null,includeOpenings:options.opening??true,knownPlayerIdentitiesById:names,canonicalPlayersByName:{'synthetic one':'nba-bdl-player:1','synthetic two':'nba-bdl-player:2'},
  fetchImpl:async input=>{
   const u=new URL(String(input));observed.calls.push(u.pathname+u.search);
   if(u.hostname==='api.owlsinsight.com'){
    const body={data:[owls],meta:{gamesReturned:1},...(options.target==='owls'?options.patch:{})};envelopes.push(structuredClone(body));return Response.json(body);
   }
   assert.equal(u.hostname,'api.balldontlie.io');
   if(u.pathname==='/v1/games'){
    const games=u.searchParams.get('season_type')==='ist'?[]:[{id:77,datetime:start,home_team:{id:1,abbreviation:'BOS'},visitor_team:{id:2,abbreviation:'NYK'}}];
    return Response.json({data:games,meta:{per_page:100,next_cursor:null},...(options.target==='schedule'?options.patch:{})});
   }
   assert(['/v2/odds/player_props','/nba/v2/odds/player_props/opening'].includes(u.pathname));
   assert.deepEqual([...u.searchParams.keys()],['game_id'],'Props never gain pagination parameters or requests');
   const target=u.pathname.endsWith('/opening')?'opening':'current';
   const values=options.empty?[]:options.partial&&options.target===target?raw.slice(0,1):raw;
   const body={data:values,meta:{per_page:values.length},...(options.target===target?options.patch:{})};envelopes.push(structuredClone(body));return Response.json(body);
  }});
 return{result,envelopes};
}
function source(result:Awaited<ReturnType<typeof collect>>['result'],observed:Seen){
 const boxes=Array.from({length:10},(_,i)=>({rowId:i+1,gameId:1,teamId:i<5?1:2,playerId:i+10,minutes:48,fgm:i<5?8:7,fga:16,fg3m:0,fg3a:3,ftm:i<5?4:5,fta:6,oreb:2,dreb:6,ast:4,stl:1,blk:1,turnover:2,pf:3,points:i<5?20:19,plusMinus:i<5?5:-5}));
 const state:NbaPlayerPropsCurrentState={release:NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE,publicEnabled:false,season:2026,createdAt:at,updatedAt:at,games:[{gameId:1,season:2026,homeTeamId:1,awayTeamId:2,homeTeam:'BOS',awayTeam:'NYK',homeScore:100,awayScore:95,startTime:'2026-11-01T00:00:00Z'}],boxes,advanced:[],players:[]};
 const game={id:'nba-bdl:77',start,home:'BOS',away:'NYK'};
 const snapshot=buildNbaPlayerPropsMemberSnapshot({mode:'private_forward_candidate',generatedAt:at,slateDate:'2026-11-10',games:[{gameId:game.id,scheduledStart:start,homeTeam:'BOS',awayTeam:'NYK'}],decisions:[],inputRows:result.observations.length});
 observed.sources++;
 const packet=liveNbaPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot,market:{release:'synthetic',publicEnabled:false,slateDate:'2026-11-10',createdAt:at,updatedAt:at,observations:result.observations},prior:state,current:state,currentObservations:result.observations});
 const request=jointReviewRequest(packet,'gpt-6-luna',7000);observed.requests++;
 assert.equal(packet.players.length,2);assert.deepEqual(packet.players.map(p=>p.id).sort(),['nba-bdl-player:1','nba-bdl-player:2']);
 assert(packet.players.every(p=>p.markets.join('|')==='points'));
 const inventory=request.text.format.schema.properties.players;
 assert(inventory&&typeof inventory==='object'&&'properties' in inventory);
 assert(inventory.properties&&typeof inventory.properties==='object');
 assert.equal(Object.keys(inventory.properties).length,2);
 assert(request.input.includes('Synthetic One')&&request.input.includes('Synthetic Two'));
 return packet;
}
async function main(){
 globalThis.Date=SyntheticDate as DateConstructor;
 try{
  let healthyHash:string|undefined;
  for(const patch of [{},{meta:undefined},{meta:null},{meta:{per_page:2}},{meta:{next_cursor:null,has_more:false}},{meta:{per_page:2,diagnostic:'unrelated'}}]){
   const observed=seen(),{result}=await collect({patch,target:'current'},observed),before=digest(result),packet=source(result,observed);
   healthyHash??=digest(result.observations);assert.equal(digest(result.observations),healthyHash,'Healthy metadata cannot alter IDs, lines, prices or source/receipt clocks');
   assert.equal(result.observations.length,8);assert.equal(packet.executionQuotes?.length,4);assert.equal(observed.calls.length,4);assert.equal(digest(result),before);
  }
  const bad:Record<string,unknown>[]=[{next_cursor:'next'},{has_more:true},{meta:{next_cursor:'next'}},{meta:{next_cursor:{unknown:true}}},{meta:{has_more:true}},{meta:{hasMore:'false'}},{meta:'malformed'},{meta:[]},{meta:{per_page:'2'}},{meta:{per_page:null}},{meta:{per_page:-1}},{meta:{per_page:1.5}},{meta:{per_page:Number.MAX_SAFE_INTEGER+1}},{meta:{per_page:0}},{meta:{per_page:3}}];
  for(const target of ['current','opening'] as const)for(const empty of [false,true])for(const patch of bad){
   if(empty&&(patch.meta as {per_page?:unknown})?.per_page===0)continue;
   const observed=seen();await assert.rejects(collect({target,empty,patch},observed),/complete|response|continuation/i);assert.equal(observed.sources,0);assert.equal(observed.requests,0);
   assert.equal(observed.calls.length,target==='current'?3:4,'Reject without a new page or downstream identity/model request');
  }
  // Original failure: one of two actors cannot establish current/opening coverage.
  for(const target of ['current','opening'] as const)for(const patch of [{meta:{per_page:2}},{meta:{per_page:1,next_cursor:'second-actor'}}])await assert.rejects(collect({target,partial:true,patch},seen()),/complete|response|continuation/i);
  // Schedule per_page is a page-size setting, not the raw returned row count.
  for(const patch of [{meta:{per_page:100,next_cursor:'more'}},{has_more:true},{meta:'malformed'}]){
   const observed=seen();await assert.rejects(collect({target:'schedule',patch},observed),/complete|response|continuation/i);assert.equal(observed.calls.length,2,'Known schedule continuation rejects before any prop request');
  }
  const healthyOwls=await collect({owls:true},seen());assert.equal(healthyOwls.result.observations.filter(q=>q.provider==='owls').length,2);source(healthyOwls.result,seen());
  for(const patch of [{meta:{gamesReturned:2}},{meta:{gamesReturned:'1'}},{meta:{gamesReturned:-1}},{data:[],meta:{gamesReturned:1}},{meta:{next_cursor:'next'}},{has_more:true}]){
   const observed=seen(),{result}=await collect({owls:true,target:'owls',patch},observed);
   assert.equal(result.observations.filter(q=>q.provider==='owls').length,0);assert.equal(result.observations.filter(q=>q.provider==='balldontlie').length,8);
   assert(result.findings.includes('owls_player_props_capture_failed'));assert(!result.findings.includes('owls_player_props_empty_for_slate'));
   assert.equal(observed.calls.length,5);source(result,observed);
  }
  const empty=await collect({empty:true,opening:false},seen());assert.equal(empty.result.observations.length,0,'Genuine complete current-empty remains empty');
  console.log(`NBA complete-response proof passed: actual collector -> live source -> strict two-actor request; current/opening ${bad.length} malformed/continuation/count controls on empty/nonempty; schedule continuation with independent page-size semantics; healthy optional Owls and failed optional isolation; exact quote/clock preservation and unchanged requests. All I/O mocked, no model/token-count/database calls.`);
 }finally{globalThis.Date=OriginalDate;}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
