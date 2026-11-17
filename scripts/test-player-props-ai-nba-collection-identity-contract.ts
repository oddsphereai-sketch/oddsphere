/** Actual ordinary collector/packet boundary. Every HTTP response is injected. */
import assert from 'node:assert/strict';
import {collectNbaPlayerPropsLiveMarket} from '../lib/services/nba/nbaPlayerPropsLiveCollector';
import {liveNbaPacket} from '../lib/playerPropsAi/liveSources';
import {digest} from '../lib/playerPropsAi/evidence';
import {validatedNbaScheduleRecords,validatedNbaQuoteRecords,validatedNbaPlayerRecords} from '../lib/services/nba/nbaPlayerPropsCurrentIdentityContract';
type Row=Record<string,unknown>;
const at='2030-11-17T18:00:00Z',start='2030-11-17T23:00:00Z',later='2030-11-18T23:00:00Z',RealDate=Date;
class Clock extends RealDate{constructor(value?:string|number){super(value??at);}static now(){return RealDate.parse(at);}}
globalThis.fetch=async()=>{throw Error('Real HTTP is forbidden');};
const player=(id:number)=>({id,first_name:'Raw',last_name:`Person${id}`,team_id:2});
const quote=(id:number):Row=>({id:`prop-${id}`,game_id:99,player_id:id,team_id:2,player:player(id),vendor:'fanduel',prop_type:'points',line_value:20.5,updated_at:at,opened_at:at,market:{type:'over_under',over_odds:-110,under_odds:-110}});
const game=(id=99)=>({id,datetime:start,date:'2030-11-17',home_team:{id:1,abbreviation:'NYK',full_name:'New York Knicks'},visitor_team:{id:2,abbreviation:'BOS',full_name:'Boston Celtics'}});
const owlProp=(id:number,propId=`owl-${id}`)=>({propId,playerName:`Raw Person${id}`,team:'BOS',category:'points',line:20.5,overPrice:-110,underPrice:-110,lastUpdate:at});
const owl=(clock=start)=>({gameId:'owls99',commenceTime:clock,homeTeam:'NYK',awayTeam:'BOS',isLive:false,books:[{key:'pinnacle',lastUpdate:at,props:[owlProp(10),owlProp(20)]}]});
const oddsEvent=(id='correct',clock=start)=>({id,commence_time:clock,home_team:'NYK',away_team:'BOS'});
const odds=(id='correct',clock=start)=>({...oddsEvent(id,clock),bookmakers:[{key:'draftkings',last_update:at,markets:[{key:'player_points',last_update:at,outcomes:[{name:'Over',description:'Raw Person10',point:20.5,price:-110},{name:'Under',description:'Raw Person10',point:20.5,price:-110}]}]}]});
function packet(collection:Awaited<ReturnType<typeof collectNbaPlayerPropsLiveMarket>>){const state={updatedAt:at,games:[{gameId:1,startTime:at,homeTeamId:1,awayTeamId:2,homeTeam:'NYK',awayTeam:'BOS'}],boxes:[],advanced:[],players:[]};return liveNbaPacket({game:{id:'nba-bdl:99',start,home:'NYK',away:'BOS'},window:{gameId:'nba-bdl:99',stage:'early',cutoff:at,lock:'2030-11-17T22:00:00Z'},snapshot:{generatedAt:at,slateDate:'2030-11-17',games:[{gameId:'nba-bdl:99',scheduledStart:start,homeTeam:'NYK',awayTeam:'BOS'}],decisions:[]},market:{updatedAt:at,observations:collection.observations},prior:state,current:state,currentObservations:collection.observations} as unknown as Parameters<typeof liveNbaPacket>[0]);}
type Options={rows?:Row[];regular?:unknown[];ist?:unknown[];metadata?:unknown[];owls?:unknown;oddsEvents?:unknown;oddsBoard?:unknown;useOdds?:boolean;opening?:Row[]};
async function collect(options:Options={}){const calls:string[]=[],rows=options.rows??[quote(10),quote(20)],sourceBefore=digest(options);
 const fetchImpl:typeof fetch=async input=>{const url=String(input);calls.push(url);const json=(v:unknown)=>Response.json(v);
  if(url.includes('/v1/games?'))return json({data:url.includes('season_type=regular')?(options.regular??[game()]):(options.ist??[])});
  if(url.includes('/nba/v2/odds/player_props/opening'))return json({data:options.opening??[]});
  if(url.includes('/v2/odds/player_props'))return json({data:rows});
  if(url.includes('/v1/players?'))return json({data:options.metadata??[player(10)]});
  if(url.includes('owlsinsight.com'))return json(options.owls??{data:[owl()]});
  if(url.includes('/events?'))return json(options.oddsEvents??[oddsEvent()]);
  if(url.includes('/events/'))return json(options.oddsBoard??odds());
  throw Error('Unexpected injected route');};
 const result=await collectNbaPlayerPropsLiveMarket({slateDate:'2030-11-17',ballDontLieApiKey:'synthetic',includeOpenings:options.opening!==undefined,owlsInsightApiKey:options.metadata?'':options.useOdds?'': 'synthetic',theOddsApiKey:options.useOdds?'synthetic':null,useTheOddsApiForGameIds:options.useOdds?new Set(['nba-bdl:99']):undefined,fetchImpl});
 assert.equal(digest(options),sourceBefore,'Original returned inputs must remain exact');return{result,calls};
}
async function main(){globalThis.Date=Clock as DateConstructor;let controls=0;
 try{
  const healthy=await collect();assert.equal(packet(healthy.result).executionQuotes?.length,8);assert.equal(healthy.calls.length,4);controls++;
  for(const reverse of [false,true]){
   for(const change of [(row:Row)=>{(row.player as Row).team_id=1;},(row:Row)=>{(row.player as Row).team={id:1};},(row:Row)=>{(row.player as Row).id=20;},(row:Row)=>{row.team_id=[];},(row:Row)=>{row.player=[];},(row:Row)=>{(row.player as Row).first_name=false;},(row:Row)=>{row.game_id=100;},(row:Row)=>{(row.player as Row).team='bad';}]){
    const rows=[quote(10),quote(20)];change(rows[0]);if(reverse)rows.reverse();await assert.rejects(()=>collect({rows}),/identity contract invalid/);controls++;
   }
   const duplicate=[quote(10),quote(20),{...quote(30),id:'prop-10'}];if(reverse)duplicate.reverse();await assert.rejects(()=>collect({rows:duplicate}),/duplicate observation identity/);controls++;
   await assert.rejects(()=>collect({regular:[game()],ist:[{...game(),datetime:later}]}),/duplicate game identity/);controls++;
  }
  for(const extra of [null,false,'bad',42,[],['nested']]){const rows=[quote(10)];delete rows[0].team_id;delete (rows[0].player as Row).team_id;const {result}=await collect({rows,metadata:[player(10),extra]});assert(result.findings.includes('balldontlie_player_identity_lookup_failed:1'));assert.throws(()=>packet(result),/NBA player\/team matchup identity incomplete/);controls++;}
  for(const metadata of [{...player(10),team:{id:2},team_id:1},{...player(10),team:{id:2},team_id:99},{...player(10),team:{id:2},team_id:[]},{...player(10),team:{id:[]}}, {...player(10),team:'bad'},{...player(10),first_name:false},{...player(10),last_name:[]}]){
   const rows=[quote(10)];delete rows[0].team_id;delete (rows[0].player as Row).team_id;const {result}=await collect({rows,metadata:[metadata]});assert(result.findings.includes('balldontlie_player_identity_lookup_failed:1'));assert(result.observations.every(q=>q.playerIdentityAvailableAt===undefined));assert.throws(()=>packet(result),/NBA player\/team matchup identity incomplete/);controls++;
  }
  const missing=[quote(10)];delete missing[0].team_id;delete (missing[0].player as Row).team_id;
  const repaired=await collect({rows:missing,metadata:[{...player(10),team:{id:2},team_id:'2'}]});assert.equal(packet(repaired.result).players[0].team,'BOS');assert.equal(packet(repaired.result).executionQuotes?.length,2);controls++;
  const invalidOwls=[{data:[owl(later),owl()]},{data:[{...owl(),books:[{key:'pinnacle',lastUpdate:at,props:[owlProp(10,'same'),owlProp(20,'same')]}]}]},{data:[{...owl(),books:'bad'}]}];
  for(const body of invalidOwls){const {result}=await collect({owls:body});assert(result.findings.includes('owls_player_props_capture_failed'));assert(!result.observations.some(q=>q.provider==='owls'));assert.equal(packet(result).executionQuotes?.length,4);assert(!result.findings.includes('owls_player_props_empty_for_slate'));controls++;}
  const twoBooks={data:[{...owl(),books:[{key:'pinnacle',lastUpdate:at,props:[owlProp(10,'shared')]},{key:'bet365',lastUpdate:at,props:[owlProp(10,'shared')]}]}]};
  const books=await collect({owls:twoBooks});assert.equal(books.result.observations.filter(q=>q.provider==='owls').length,4,'Same prop ID in two explicit books must retain both exact quote pairs');assert.equal(packet(books.result).executionQuotes?.length,8);controls++;
  for(const options of [{oddsBoard:odds('wrong')},{oddsBoard:{...odds(),home_team:'LAL',away_team:'MIA'}},{oddsBoard:odds('correct',later)},{oddsEvents:[oddsEvent(),oddsEvent('correct',later)]}]){const {result}=await collect({...options,useOdds:true});assert(result.findings.includes('the_odds_api_player_props_capture_failed'));assert(!result.observations.some(q=>q.provider==='the_odds_api'));assert.equal(packet(result).executionQuotes?.length,4);controls++;}
  const timeBound=await collect({useOdds:true,oddsEvents:[oddsEvent('future',later),oddsEvent()]});assert(!timeBound.calls.some(url=>url.includes('/events/future/')));assert.equal(packet(timeBound.result).executionQuotes?.length,6);controls++;
  const priceChanged=quote(10);priceChanged.market={type:'over_under',over_odds:120,under_odds:-130};await assert.rejects(()=>collect({rows:[quote(10),priceChanged,quote(20)]}),/same-clock quote price conflict/);controls++;
  const owlPrices=owl();owlPrices.books[0].props.push({...owlProp(10),overPrice:120,underPrice:-130});const badOwlPrice=await collect({owls:{data:[owlPrices]}});assert(badOwlPrice.result.findings.includes('owls_player_props_capture_failed'));assert.equal(packet(badOwlPrice.result).executionQuotes?.length,4);controls++;
  const oddsPrices=odds();oddsPrices.bookmakers[0].markets[0].outcomes.push({...oddsPrices.bookmakers[0].markets[0].outcomes[0],price:120});const badOddsPrice=await collect({useOdds:true,oddsBoard:oddsPrices});assert(badOddsPrice.result.findings.includes('the_odds_api_player_props_capture_failed'));assert.equal(packet(badOddsPrice.result).executionQuotes?.length,4);controls++;
  const consistent=await collect({regular:[game()],ist:[{...game(),datetime:'2030-11-17T23:00:00+00:00'}]});assert.equal(consistent.result.games.length,1);assert.equal(packet(consistent.result).executionQuotes?.length,8);controls++;
  const oldOpening={...quote(10),team_id:1,player:{...player(10),team_id:2}};const openingBefore=digest(oldOpening);const opened=await collect({opening:[oldOpening]});assert.equal(digest(oldOpening),openingBefore);assert.equal(opened.result.observations.filter(q=>q.isOpening).length,2);assert.equal(packet(opened.result).players.length,2);controls++;
  const p=packet(healthy.result),foreign=structuredClone(healthy.result);foreign.observations[0].scheduledStart=later;assert.throws(()=>packet(foreign),/current quote fixture clock/);assert.equal(p.players.length,2);controls++;
  for(const mutate of [(g:Row)=>{g.home_team=[];},(g:Row)=>{(g.home_team as Row).full_name='Boston Celtics';},(g:Row)=>{g.datetime=false;}]){const g=game() as Row;mutate(g);assert.throws(()=>validatedNbaScheduleRecords([{data:[g]}]),/identity contract invalid/);controls++;}
  assert.throws(()=>validatedNbaQuoteRecords({data:[quote(10),null]},'99'),/data record/);assert.throws(()=>validatedNbaPlayerRecords({data:[player(10),null]},['10']),/data record/);controls+=2;
  console.log(JSON.stringify({controls,actualCollectorToPacket:true,rawSourceInputsExact:true,validMetadataAndBooksRecover:true,mandatoryConflictThrowsWithoutDroppingActor:true,invalidOptionalFeedDiscardedNeverEmpty:true,legacyNormalizerUnchanged:true,noNetworkOrPaidOrSql:true}));
 }finally{globalThis.Date=RealDate;}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
