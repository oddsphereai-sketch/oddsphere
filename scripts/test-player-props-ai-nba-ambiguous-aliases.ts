/** Actual collector/source identity regression. All provider I/O is injected. */
import assert from 'node:assert/strict';
import {collectNbaPlayerPropsLiveMarket} from '../lib/services/nba/nbaPlayerPropsLiveCollector';
import {resolveNbaPlayerAliases} from '../lib/services/nba/nbaPlayerPropsPlayerIdentity';
import {liveNbaPacket} from '../lib/playerPropsAi/liveSources';

const RealDate=Date,at='2030-11-17T18:00:00Z',start='2030-11-17T21:00:00Z';
class Clock extends RealDate{constructor(value?:string|number){super(value??at);}static now(){return RealDate.parse(at);}}
globalThis.fetch=async()=>{throw Error('Only injected synthetic HTTP is allowed');};
const a='nba-bdl-player:10',b='nba-bdl-player:20';
assert.deepEqual(resolveNbaPlayerAliases([['Same Name',a],['same-name',b]]),{});
assert.deepEqual(resolveNbaPlayerAliases([['Same Name',b],['same-name',a]]),{});
assert.deepEqual(resolveNbaPlayerAliases([['Níkola Jokić',a],['Nikola Jokic',a]]),{nikolajokic:a});
assert.deepEqual(resolveNbaPlayerAliases([['Same Name',a],['Other Name',b],['Same Name',a]]),{othername:b,samename:a});

async function exercise(mode:'ambiguous'|'unique'|'history_ambiguous',odds:boolean){
 const calls:string[]=[];
 const rows=(mode==='history_ambiguous'?[20]:[10,20]).map(id=>({id:`bdl-${id}`,game_id:99,player_id:id,team_id:id===10?1:2,player:{id,first_name:id===20&&mode==='unique'?'Other':'Same',last_name:'Name',team_id:id===10?1:2},vendor:'fanduel',prop_type:'points',line_value:id===10?25.5:5.5,updated_at:at,market:{type:'over_under',over_odds:-110,under_odds:-110}}));
 const json=(body:unknown)=>Response.json(body);
 const fetchImpl:typeof fetch=async(input)=>{
  const url=String(input);calls.push(url);
  if(url.includes('/v1/games'))return json({data:url.includes('season_type=regular')?[{id:99,datetime:start,home_team:{id:1,abbreviation:'NYK'},visitor_team:{id:2,abbreviation:'BOS'}}]:[]});
  if(url.includes('/v2/odds/player_props'))return json({data:rows});
  if(url.includes('api.owlsinsight.com'))return json({data:[{gameId:'owls99',commenceTime:start,homeTeam:'NYK',awayTeam:'BOS',isLive:false,books:[{key:'pinnacle',lastUpdate:at,props:[{propId:'ref',category:'points',playerName:'Same Name',team:'NYK',line:25.5,overPrice:-110,underPrice:-110,lastUpdate:at}]}]}]});
  if(url.includes('/events?'))return json([{id:'odds99',commence_time:start,home_team:'NYK',away_team:'BOS'}]);
  if(url.includes('/events/odds99/odds'))return json({id:'odds99',commence_time:start,home_team:'NYK',away_team:'BOS',bookmakers:[{key:'draftkings',last_update:at,markets:[{key:'player_points',last_update:at,outcomes:[{name:'Over',description:'Same Name',point:25.5,price:180},{name:'Under',description:'Same Name',point:25.5,price:-220}]}]}]});
  throw Error('Unexpected injected route '+url);
 };
 const result=await collectNbaPlayerPropsLiveMarket({slateDate:'2030-11-17',ballDontLieApiKey:'synthetic',owlsInsightApiKey:'synthetic',theOddsApiKey:odds?'synthetic':null,includeOpenings:false,useTheOddsApiForGameIds:odds?new Set(['nba-bdl:99']):undefined,canonicalPlayersByName:mode==='history_ambiguous'?{samename:b}:{samename:a},canonicalPlayerIdentityEntries:mode==='history_ambiguous'?[['Same Name',a],['Same Name',b]]:[],fetchImpl});
 assert.equal(calls.length,odds?6:4,'Alias resolution makes zero extra source/provider requests');
 const references=result.observations.filter(q=>q.provider!=='balldontlie');
 assert.equal(references.length,odds?4:2);
 assert(references.every(q=>q.canonicalPlayerId===(mode==='unique'?a:null)),'Every name-only provider uses the same ambiguity-preserving union; no provider overlay restores a guessed ID');
 const bdl=result.observations.filter(q=>q.provider==='balldontlie');assert.equal(bdl.length,rows.length*2);assert(bdl.every(q=>q.canonicalPlayerId===`nba-bdl-player:${q.providerPlayerId}`),'Exact provider IDs remain offered and are not dropped with ambiguous aliases');
 const game={id:'nba-bdl:99',start,home:'NYK',away:'BOS'},state={updatedAt:at,games:[{gameId:1,startTime:'2030-11-16T01:00:00Z',homeTeamId:1,awayTeamId:2,homeTeam:'NYK',awayTeam:'BOS'}],boxes:[],advanced:[],players:[]};
 const args={game,window:{gameId:game.id,lock:'2030-11-17T20:00:00Z',cutoff:at,stage:'early'},snapshot:{generatedAt:at,slateDate:'2030-11-17',games:[{gameId:game.id,scheduledStart:start,homeTeam:'NYK',awayTeam:'BOS'}],decisions:[]},market:{updatedAt:at,observations:result.observations},prior:state,current:state,currentObservations:result.observations} as unknown as Parameters<typeof liveNbaPacket>[0];
 if(mode!=='unique'&&odds){assert.throws(()=>liveNbaPacket(args),/NBA retail offered-player identity incomplete/,'Unresolved retail identity cannot reach paid review or wrong-actor pricing');return;}
 const packet=liveNbaPacket(args);
 assert.equal(packet.players.length,rows.length);
 const pricedReferences=packet.executionQuotes!.filter(q=>q.provider!=='balldontlie');
 assert.equal(pricedReferences.length,mode==='unique'?(odds?4:2):0);
 assert(pricedReferences.every(q=>q.playerId===a));
 if(mode!=='unique')assert(packet.sourceLimitations.some(s=>s.includes('unresolved actor identity')),'Reference-only missing identity remains an explicit coverage limitation');
}
async function main(){globalThis.Date=Clock as DateConstructor;try{for(const mode of ['ambiguous','unique','history_ambiguous'] as const)for(const odds of [false,true])await exercise(mode,odds);console.log('NBA universal aliases passed: direct IDs preserved, same-name collisions across current/history/overlays unresolved, both reference providers cannot misbind execution, valid exact aliases recover and zero extra source requests. No real HTTP/model/token/SQL.');}finally{globalThis.Date=RealDate;}}
void main().catch(error=>{console.error(error);process.exitCode=1;});
