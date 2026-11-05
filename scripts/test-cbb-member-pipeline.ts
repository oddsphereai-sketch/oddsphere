import assert from "node:assert/strict";
import type { CbbGame } from "../lib/cbb/types";
import type { CbbBallDontLieClient } from "../lib/cbb/ballDontLie";
import type { OwlsInsightClient } from "../lib/providers/owls/owlsInsightClient";
import type { DailyEdgeResponse } from "../app/lab/lib/labTypes";
import { buildCbbRollingSchedule, excludeAnalyzedCbbScheduleGames } from "../lib/services/cbb/cbbRollingSchedule";
import { seedCbbGames } from "../lib/services/cbb/seedCbbGamesService";
import { refreshCbbMemberBoard,selectCbbContextualPipelineTargets } from "../lib/services/cbb/cbbMemberPipeline";
import {readCbbCanonicalReaderHistory} from "../lib/services/cbb/cbbCanonicalReaderHistory";
import type {CbbCanonicalPriceRow} from "../lib/services/cbb/cbbCanonicalMarketEvidence";
import {makeCbbPipelineTestRuntime} from "./fixtures/cbb-contextual-pipeline-runtime";
import {readCbbContextualOutcomeEvidence,CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE} from "../lib/services/cbb/cbbContextualOutcomeRuntime";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";


const asOf="2026-10-29T22:00:00Z",start="2026-11-01T14:30:00Z";
const home={id:92,conference_id:1,name:"Wildcats",full_name:"Villanova Wildcats",college:"Villanova",abbreviation:"VILL"};
const away={id:11,conference_id:1,name:"Fighting Irish",full_name:"Notre Dame Fighting Irish",college:"Notre Dame",abbreviation:"ND"};
const game:CbbGame={id:10882407,date:start,season:2026,status:"pre",status_state:"scheduled",period:0,
  home_score:0,away_score:0,home_team:home,visitor_team:away};
const quote=(key:string,first:number,second:number,line?:number)=>({key,outcomes:key==="totals"?
  [{name:"Over",price:first,point:line},{name:"Under",price:second,point:line}]:
  [{name:"Villanova",price:first,point:line},{name:"Notre Dame",price:second,point:line===undefined?undefined:-line}]});
const odds={success:true,data:[{id:"ncaab:Notre Dame@Villanova-20261101",sport:"ncaab",commence_time:start,home_team:"Villanova",away_team:"Notre Dame",
  bookmakers:[{key:"fanduel",last_update:"2026-10-29T21:55:00Z",markets:[quote("h2h",-280,240),quote("spreads",-110,-110,-6.5),quote("totals",-110,-110,145.5)]}]}]};
const splits={sport:"ncaab",data:[],meta:{status:"partial"}};
const provider={calls:2,gamesForDates:async(dates:string[])=>dates.includes("2026-11-01")?[game]:[]} as unknown as CbbBallDontLieClient;
const owls={odds:async()=>({body:odds,status:200,rateLimit:{remainingMinute:null,remainingMonth:null}}),
  splits:async()=>({body:splits,status:200,rateLimit:{remainingMinute:null,remainingMonth:null}})} as unknown as OwlsInsightClient;
const schedule=buildCbbRollingSchedule({anchorDate:"2026-10-29",games:[{external_id:game.id,slate_date:"2026-11-01",
  game_date:"2026-11-01T14:30:00+00:00",status:"STATUS_SCHEDULED",away_team_id:11,home_team_id:92,venue:"Venue"}],
  teams:[{id:92,abbreviation:"VILL",display_name:home.full_name,logo_url:"https://a.espncdn.com/i/teamlogos/ncaa/500/222.png"},
    {id:11,abbreviation:"ND",display_name:away.full_name,logo_url:"https://a.espncdn.com/i/teamlogos/ncaa/500/87.png"}]});
const event={id:"espn-1",date:start,competitions:[{neutralSite:true,timeValid:true,
  competitors:[{homeAway:"home",team:{displayName:home.full_name,location:home.college}},
    {homeAway:"away",team:{displayName:away.full_name,location:away.college}}]}]};
const fetcher=(async()=>new Response(JSON.stringify({events:[event]}),{status:200,headers:{"Content-Type":"application/json"}})) as typeof fetch;
const stored=new Map<string,unknown>();
const tracked:Array<Record<string,unknown>>=[];
const db={from:(table:string)=>{
  if(table==="market_price_observations_v2"||table==="market_split_observations_v2")return {select:()=>{
    const q={eq:()=>q,in:()=>q,gte:()=>q,lte:()=>q,order:()=>q,limit:()=>q,abortSignal:()=>q,maybeSingle:async()=>({data:null,error:null})};return q;}};
  if(table==="games")return {select:()=>{const q={eq:()=>q,maybeSingle:async()=>({data:{id:1,external_id:game.id,game_date:"2026-11-01T14:30:00+00:00",slate_date:"2026-11-01",home_team:{external_id:home.id,display_name:home.full_name},away_team:{external_id:away.id,display_name:away.full_name}},error:null})};return q;}};
  if(table==="prediction_records")return {select:()=>{const q={eq:()=>q,then:(resolve:(value:unknown)=>unknown)=>resolve({data:tracked,error:null})};return q;},insert:async(row:Record<string,unknown>)=>{tracked.push(structuredClone(row));return {error:null};}};
  assert.equal(table,"lab_response_snapshots");return {
  select:()=>({in:async(_:string,keys:string[])=>({data:keys.filter(key=>stored.has(key)).map(key=>({snapshot_key:key,payload:stored.get(key)})),error:null}),
    eq:(_:string,key:string)=>({maybeSingle:async()=>({data:stored.has(key)?{payload:stored.get(key)}:null,error:null})})}),
  upsert:async(row:{snapshot_key:string;payload:unknown})=>{stored.set(row.snapshot_key,structuredClone(row.payload));return {error:null};},
};}} as unknown as Parameters<typeof refreshCbbMemberBoard>[0]["db"];
let published:DailyEdgeResponse|null=null;
const saveSnapshot=(async(input:{payload:DailyEdgeResponse})=>{published=structuredClone(input.payload);
  return {ok:true,snapshotKey:"test",expiresAt:asOf,staleUntil:asOf};}) as NonNullable<Parameters<typeof refreshCbbMemberBoard>[0]["saveSnapshot"]>;

const testRuntime=makeCbbPipelineTestRuntime();let runtimeLoads=0;const loadContextualRuntime=async()=>{runtimeLoads++;return testRuntime.runtime;};
async function main(){
  const noOdds={odds:async()=>({body:{success:true,data:[]},status:200,rateLimit:{remainingMinute:null,remainingMonth:null}}),
    splits:async()=>({body:splits,status:200,rateLimit:{remainingMinute:null,remainingMonth:null}})} as unknown as OwlsInsightClient;
  const pending=await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:asOf,bdlKey:"test",owlsKey:"test",
    trainingGames:[],provider,owls:noOdds,db,fetcher,loadSchedule:async()=>schedule,saveSnapshot});
  assert.equal(pending.sourceGames,0);
  assert.equal((published as DailyEdgeResponse | null)?.games.length,0);
  assert.equal(schedule.games.length,1,"the future fixture remains on the member slate while its market is unavailable");
  const wrongStart={...schedule,games:schedule.games.map(row=>({...row,gameStartAt:"2026-11-01T14:31:00+00:00"}))};
  await assert.rejects(refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:asOf,bdlKey:"test",owlsKey:"test",
    trainingGames:[],provider,owls,db,fetcher,loadSchedule:async()=>wrongStart,saveSnapshot}),/lost exact games/);
  assert.equal(stored.size,0,"a real start-time drift must not write a member game");
  const result=await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:asOf,bdlKey:"test",owlsKey:"test",
    trainingGames:[],provider,owls,db,fetcher,loadSchedule:async()=>schedule,saveSnapshot});
  assert.equal(result.sourceGames,1);assert.equal(result.published,1);assert.equal(result.written,1);
  assert.equal(result.trackingInserted,0);
  assert.ok(published);
  const priorRows=JSON.stringify([...stored]),priorPublished=JSON.stringify(published),priorTracked=JSON.stringify(tracked);
  for(const loadFailure of [true,false]){
    await assert.rejects(refreshCbbMemberBoard({anchorDate:"2026-10-29",season:2026,now:asOf,bdlKey:"test",owlsKey:"test",
      trainingGames:[],provider,owls,db,fetcher,loadSchedule:async()=>schedule,saveSnapshot,
      loadContextualRuntime:async()=>{if(loadFailure)throw Error("unit runtime load failed");return {evaluate:()=>{throw Error("unit runtime evaluate failed");}};}}),
      loadFailure?/unit runtime load failed/:/unit runtime evaluate failed/);
    assert.equal(JSON.stringify([...stored]),priorRows,"Runtime failure must precede every member write");
    assert.equal(JSON.stringify(published),priorPublished,"Runtime failure must preserve the published slate");
    assert.equal(JSON.stringify(tracked),priorTracked,"Runtime failure cannot create a tracking lock");
  }
  const actualTargets=testRuntime.evaluations.at(-1)!.input.targets;
  assert.equal(selectCbbContextualPipelineTargets([...actualTargets]).length,3);
  assert.ok(selectCbbContextualPipelineTargets([...actualTargets]).every((q,i)=>q===actualTargets[i]),"Target handoff preserves the original raw quote object");
  const partialTargets=[...actualTargets.filter(q=>q.market!=="total"),{...actualTargets.find(q=>q.market==="total")!,sportsbook:"draftkings"}];
  assert.deepEqual(selectCbbContextualPipelineTargets(partialTargets),partialTargets,"A missing book contract falls back by market without repricing");
  const member=(published as DailyEdgeResponse).games[0];
  assert.equal(member.cbbHomeCollege,"Villanova");assert.equal(member.homeTeamLogo,schedule.games[0].homeTeamLogo);
  assert.equal(member.markets.first_inning.line,-6.5);
  assert.equal(member.markets.moneyline.currentPriceSportsbook,"fanduel");
  assert.equal(member.projected.home+member.projected.away,member.markets.total.modelTotal);
  assert.equal(member.markets.moneyline.sportsbookSplits,null);
  assert.equal(excludeAnalyzedCbbScheduleGames(schedule,[member.external_id]).games.length,0,
    "the same fixture becomes an analyzed card, never a duplicate schedule card");
  assert.ok(result.problems.some(problem=>problem.includes("verified_splits_unavailable")));
  let synchronized=false;
  const reversed={...schedule,games:schedule.games.map(g=>({...g,homeTeam:g.awayTeam,awayTeam:g.homeTeam,
    homeTeamDisplayName:g.awayTeamDisplayName,awayTeamDisplayName:g.homeTeamDisplayName}))};
  const recovered=await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:asOf,bdlKey:"test",owlsKey:"test",
    trainingGames:[],provider,owls,db,fetcher,loadSchedule:async()=>synchronized?schedule:reversed,saveSnapshot,
    syncFixtures:async captured=>{assert.deepEqual(captured,[game]);synchronized=true;}});
  assert.equal(synchronized,true);assert.equal(recovered.published,1);
  const captureOnly=await seedCbbGames({slateDate:"2026-11-01",season:2026,apiKey:"test",dryRun:true,capturedGames:[game],
    client:{calls:0,gamesForDates:async()=>{throw new Error("duplicate provider request forbidden");}} as unknown as CbbBallDontLieClient});
  assert.equal(captureOnly.games,1);assert.equal(captureOnly.providerCalls,0,"intraday sync reuses the exact provider capture");
  const oneD1Provider={calls:2,gamesForDates:async()=>[{...game,home_team:{...home,conference_id:null}}]} as unknown as CbbBallDontLieClient;
  const oneD1=await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:asOf,bdlKey:"test",owlsKey:"test",trainingGames:[],provider:oneD1Provider,owls,db,fetcher,loadSchedule:async()=>schedule,saveSnapshot});
  assert.equal(oneD1.published,1,"one verified D1 participant plus actual model history and a graded quote remains eligible");
  const beforeEmpty=JSON.stringify([...stored]);
  await assert.rejects(refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:asOf,bdlKey:"test",owlsKey:"test",trainingGames:[],provider,owls:noOdds,db,fetcher,loadSchedule:async()=>schedule,saveSnapshot}),/current-evaluation coverage absent/);
  assert.equal(JSON.stringify([...stored]),beforeEmpty,"an empty source response cannot erase prior completed evaluations");
  const neitherProvider={calls:2,gamesForDates:async()=>[{...game,home_team:{...home,conference_id:null},visitor_team:{...away,conference_id:null}}]} as unknown as CbbBallDontLieClient;
  const neither=await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:asOf,bdlKey:"test",owlsKey:"test",trainingGames:[],provider:neitherProvider,owls,db,fetcher,loadSchedule:async()=>schedule,saveSnapshot});
  assert.equal(neither.published,0,"neither-D1 fixtures cannot enter the member board");
  const unknownGame={...game,id:10882515,home_team:{...home,id:332,full_name:"St. Thomas-Minnesota Tommies",college:"St. Thomas-Minnesota",abbreviation:"STMN"}};
  const unknownProvider={calls:2,gamesForDates:async()=>[unknownGame]} as unknown as CbbBallDontLieClient;
  const unknownOdds={success:true,data:[{id:"named-stthomas",sport:"ncaab",commence_time:start,home_team:unknownGame.home_team.college,away_team:away.college,bookmakers:[{key:"fanduel",last_update:asOf,markets:[{key:"h2h",outcomes:[{name:unknownGame.home_team.college,price:-110},{name:away.college,price:-110}]}]}]}]};
  const unknownOwls={...owls,odds:async()=>({body:unknownOdds}),splits:async()=>({body:splits})} as unknown as OwlsInsightClient;
  const unknownSchedule={...schedule,games:schedule.games.map(g=>({...g,externalId:unknownGame.id,id:`cbb-${unknownGame.id}`,homeTeam:"STMN",homeTeamDisplayName:unknownGame.home_team.full_name}))};
  const unknownFetcher=(async()=>new Response(JSON.stringify({events:[{...event,competitions:[{neutralSite:true,timeValid:true,competitors:[{homeAway:"home",team:{id:"2900",displayName:"St. Thomas Tommies",location:"St. Thomas"}},{homeAway:"away",team:{displayName:away.full_name,location:away.college}}]}]}]}))) as typeof fetch;
  const beforeUnknown=JSON.stringify([...stored]);
  const unknown=await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:asOf,bdlKey:"test",owlsKey:"test",trainingGames:[],provider:unknownProvider,owls:unknownOwls,db,fetcher:unknownFetcher,loadSchedule:async()=>unknownSchedule,saveSnapshot});
  assert.equal(unknown.sourceGames,1);assert.equal(unknown.published,1);assert.deepEqual(unknown.unpublishedIncomplete,[],"verified historical venue recovery supplies St Thomas's actual prior");
  assert.notEqual(JSON.stringify([...stored]),beforeUnknown);
  const recoveredRecord=stored.get(`cbb::member-game::${unknownGame.id}`) as {snapshot:{board:{modelRelease:string}}};
  assert.equal(recoveredRecord.snapshot.board.modelRelease,CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE);
  const absentId=999999,unmodeledGame={...unknownGame,id:absentId,home_team:{...unknownGame.home_team,id:absentId}};
  const beforeUnmodeled=JSON.stringify([...stored]);
  const unmodeled=await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:asOf,bdlKey:"test",owlsKey:"test",trainingGames:[],
    provider:{calls:2,gamesForDates:async()=>[unmodeledGame]} as unknown as CbbBallDontLieClient,owls:unknownOwls,db,fetcher:unknownFetcher,
    loadSchedule:async()=>({...unknownSchedule,games:unknownSchedule.games.map(g=>({...g,externalId:absentId,id:`cbb-${absentId}`}))}),saveSnapshot});
  assert.equal(unmodeled.published,0);
  assert.equal(JSON.stringify([...stored]),beforeUnmodeled,"a real quote cannot manufacture an absent team rating or overwrite an existing record");
  let priceCalls=0,splitCalls=0;
  const referenceRefresh=async(now:string,line:number,ml:number,opposing:number,canonicalHistoryReader?:Parameters<typeof refreshCbbMemberBoard>[0]["canonicalHistoryReader"])=>{
    const prices=structuredClone(odds);
    prices.data[0].bookmakers.push({key:"pinnacle",last_update:now,markets:[quote("h2h",ml,opposing),quote("spreads",-110,-110,line),quote("totals",-110,-110,145.5)]});
    const source={odds:async()=>{priceCalls++;return {body:prices};},splits:async()=>{splitCalls++;return {body:splits};}} as unknown as OwlsInsightClient;
    return refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now,bdlKey:"test",owlsKey:"test",trainingGames:[],provider,owls:source,db,fetcher,loadSchedule:async()=>schedule,saveSnapshot,canonicalHistoryReader});
  };
  const firstMarket=await referenceRefresh("2026-10-29T22:05:00Z",3.5,130,-150);
  const firstRead=stored.get(`cbb::member-game::${game.id}`) as import("../lib/services/cbb/cbbMemberGameStore").CbbStoredMemberGame;
  const firstEvidence=readCbbContextualOutcomeEvidence(firstRead.snapshot.board)!;
  const firstInput=firstEvidence.input,firstInputBytes=JSON.stringify(firstInput);
  assert.equal(firstMarket.contextualInputCounts.evaluated,1);
  assert.equal(firstEvidence.independent.release,CBB_CURRENT_SCORE_RELEASE);
  assert.equal(firstInput.independent.margin,firstEvidence.independent.margin);
  assert.ok(firstInput.currentQuotes.some(q=>q.sportsbook==="pinnacle"));
  assert.equal(firstMarket.owlsCalls,2);
  assert.deepEqual(firstRead.snapshot.board.score,testRuntime.evaluations.at(-1)!.board.score,"Sole writer copies upstream joint-law scores without old source-law takeover");
  assert.deepEqual(firstRead.snapshot.board.rows,testRuntime.evaluations.at(-1)!.board.rows,"Sole writer does not reprice or regrade contextual output");
  assert.ok(Math.abs(firstRead.memberGame.projected.home-firstRead.memberGame.projected.away-firstRead.snapshot.board.score.margin)<1e-10);
  await referenceRefresh("2026-10-29T22:10:00Z",4.5,150,-170);
  const secondRead=stored.get(`cbb::member-game::${game.id}`) as typeof firstRead;
  const secondEvidence=readCbbContextualOutcomeEvidence(secondRead.snapshot.board)!;
  assert.equal(secondEvidence.independent.margin,firstEvidence.independent.margin,"A prior market-conditioned score never becomes the independent input");
  assert.deepEqual(secondEvidence.input.sourceBaselineQuotes,firstInput.sourceBaselineQuotes,"Original whole price endpoints survive later refreshes");
  const secondScore=structuredClone(secondRead.snapshot.board.score);
  await referenceRefresh("2026-10-29T22:10:00Z",4.5,150,-170);
  assert.deepEqual((stored.get(`cbb::member-game::${game.id}`) as typeof firstRead).snapshot.board.score,secondScore,"Identical source and original independent input cannot recursively accumulate a correction");
  assert.equal(priceCalls,3);assert.equal(splitCalls,3,"one slate-level price and split request per existing refresh; no per-game refresh");
  // The actual writer consumes native ambiguity BEFORE score/grade creation,
  // and carries it across later refreshes even when a clean current pair exists.
  const nativePair=(id:number,sourceAt:string,line:number):CbbCanonicalPriceRow[]=>["home","away"].map((side,index)=>({
    id:id+index,provider:"owls",provider_event_id:"ncaab:Notre Dame@Villanova-20261101",ingestion_run_id:"cbb:2026-10-29:2026-10-29T22:11:00Z",
    canonical_event_id:String(game.id),canonical_market_id:`${game.id}:spread`,league:"cbb",sportsbook:"pinnacle",sharp_book:true,market_type:"spread",
    selection_key:`${game.id}:spread:${side}`,american_price:-110,decimal_price:1+100/110,no_vig_probability:.5,line:side==="home"?line:-line,
    provider_timestamp:sourceAt,fetched_at:"2026-10-29T22:11:00Z",inserted_at:"2026-10-29T22:11:01Z",minutes_to_start:1000,raw_payload_hash:String(id+index).padStart(64,"a"),
  }));
  const nativeRows=[...nativePair(100,"2026-10-29T22:02:00Z",3.5),...nativePair(200,"2026-10-29T22:04:00Z",4),
    ...nativePair(300,"2026-10-29T22:04:00Z",4.5),...nativePair(400,"2026-10-29T22:08:00Z",4.5)];
  let historyCalls=0;
  const canonicalHistoryReader:NonNullable<Parameters<typeof refreshCbbMemberBoard>[0]["canonicalHistoryReader"]>=async args=>{
    historyCalls++;assert.deepEqual(args.gameIds,[game.id]);
    return {...await readCbbCanonicalReaderHistory({...args,gameIds:[]}),priceRows:nativeRows};
  };
  await referenceRefresh("2026-10-29T22:15:00Z",4.5,150,-170,canonicalHistoryReader);
  const nativeRead=stored.get(`cbb::member-game::${game.id}`) as typeof firstRead;
  const nativeEvidence=readCbbContextualOutcomeEvidence(nativeRead.snapshot.board)!;
  assert.ok(nativeEvidence.input.sourceStateEvidence.priceQuarantines.some(q=>q.book==="pinnacle"&&q.market==="spread"));
  assert.equal(JSON.stringify(firstInput),firstInputBytes,"Later recovered history cannot mutate an earlier stored input");
  assert.ok((nativeEvidence.input.sourceBaselineQuotes??[]).every(q=>Date.parse(q.knownBy)<=Date.parse(nativeEvidence.input.asOf)),"Recovered endpoint retains its actual availability before this evaluation");
  assert.equal(historyCalls,1);assert.equal(priceCalls,4);assert.equal(splitCalls,4);
  const conflictingCurrent=structuredClone(odds);
  for(const line of [4,4.5])conflictingCurrent.data[0].bookmakers.push({key:"pinnacle",last_update:"2026-10-29T22:20:00Z",markets:[quote("spreads",-110,-110,line)]});
  await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:"2026-10-29T22:20:30Z",bdlKey:"test",owlsKey:"test",
    trainingGames:[],provider,owls:{odds:async()=>({body:conflictingCurrent}),splits:async()=>({body:splits})} as unknown as OwlsInsightClient,
    db,fetcher,loadSchedule:async()=>schedule,saveSnapshot});
  const conflictedEvidence=readCbbContextualOutcomeEvidence((stored.get(`cbb::member-game::${game.id}`) as typeof firstRead).snapshot.board)!;
  assert.ok(conflictedEvidence.input.sourceStateEvidence.priceQuarantines.some(q=>q.book==="pinnacle"&&q.market==="spread"&&q.sourceAt==="2026-10-29T22:20:00Z"),"The actual rejected current source frame must reach the new input");
  assert.ok(!conflictedEvidence.input.currentQuotes.some(q=>q.sportsbook==="pinnacle"&&q.market==="spread"),"Older retained source cannot replace an arrived conflicting current frontier");
  const atLock=await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:"2026-11-01T13:30:00Z",bdlKey:"test",owlsKey:"test",
    trainingGames:[],provider,owls,db,fetcher,loadSchedule:async()=>schedule,saveSnapshot});
  assert.equal(atLock.locked,1);assert.equal(atLock.trackingInserted,3);
  assert.equal(atLock.contextualInputCounts.evaluated,0,"T-60 lock must not evaluate a new contextual model");
  assert.equal(runtimeLoads,testRuntime.evaluations.length,"Exactly one runtime load per eligible single-game batch, none at cutoff");
  const frozen=JSON.stringify([...stored.values()]);
  const lockedMember=structuredClone((published as DailyEdgeResponse).games[0]);
  const afterTip=await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:"2026-11-01T15:00:00Z",bdlKey:"test",owlsKey:"test",
    trainingGames:[],provider,owls,db,fetcher,loadSchedule:async()=>schedule,saveSnapshot});
  assert.equal(afterTip.published,1,"a started locked game cannot abort the rolling board refresh");
  assert.equal(afterTip.written,0);assert.equal(afterTip.trackingInserted,0);
  assert.equal(JSON.stringify([...stored.values()]),frozen,"post-tip refresh preserves every locked writer field");
  assert.deepEqual((published as DailyEdgeResponse).games[0].projected,lockedMember.projected,"the original locked forecast retains reader precedence");
  assert.deepEqual((published as DailyEdgeResponse).games[0].markets,lockedMember.markets,"the original locked prices and grades retain reader precedence");
  const flipped={...game,home_team:game.visitor_team,visitor_team:game.home_team};
  const conflictingProvider={calls:2,gamesForDates:async(dates:string[])=>dates.includes("2026-11-01")?[flipped]:[]} as unknown as CbbBallDontLieClient;
  const conflict=await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:"2026-11-01T15:00:00Z",bdlKey:"test",owlsKey:"test",
    trainingGames:[],provider:conflictingProvider,owls,db,fetcher,loadSchedule:async()=>schedule,saveSnapshot});
  assert.equal(conflict.published,1);assert.equal(conflict.written,0);
  assert.ok(conflict.problems.some(p=>p.includes("locked_provider_conflict_preserved")));
  assert.equal(JSON.stringify([...stored.values()]),frozen,"a provider reversal cannot rewrite the locked writer");
  assert.deepEqual((published as DailyEdgeResponse).games[0],lockedMember,"the exact stored locked reader wins over new provider orientation");
  console.log("CBB member pipeline: exact fixture, pending-to-analyzed card, source price, coherent score, published snapshot and honest split absence passed.");
}
void main();
