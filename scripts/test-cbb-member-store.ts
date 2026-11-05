import "./test-cbb-published-probability-comparison";
import assert from "node:assert/strict";
import type { CbbForecast, CbbGame, CbbQuote } from "../lib/cbb/types";
import { buildCbbProvisionalBoard } from "../lib/cbb/provisionalBoard";
import { cbbMemberGameForReader, readCbbMemberGame, writeCbbMemberGame } from "../lib/services/cbb/cbbMemberGameStore";
import { CBB_MEMBER_GAME_STORE_RELEASE } from "../lib/services/cbb/cbbMemberGameStore";
import { cbbDailyEdgeResponse } from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import { overlayCbbLockedMemberGames } from "../lib/services/cbb/cbbMemberReader";
import { projectCbbSnapshotForInitialBoard } from "../lib/services/cbb/cbbMemberBoardProjection";

const start="2026-11-01T19:00:00Z",before="2026-11-01T17:00:00Z";
const team=(id:number,abbr:string,name:string,college:string)=>({id,abbreviation:abbr,full_name:name,college,name,conference_id:1});
const game:CbbGame={id:777,date:start,season:2026,status:"pre",period:0,home_score:0,away_score:0,
  home_team:team(1,"VILL","Villanova Wildcats","Villanova"),visitor_team:team(2,"ND","Notre Dame Fighting Irish","Notre Dame")};
const forecast:CbbForecast={release:"test",gameId:777,asOf:before,homeId:1,awayId:2,homeScore:78,awayScore:68,margin:10,total:146,
  possessions:69,homeWinProbability:.8,inputStatus:"complete",issues:[],uncertainty:{marginSd:11,totalSd:16,marginTotalCorrelation:0,
    marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:3000}};
const base:CbbQuote={gameId:777,sportsbook:"fanduel",market:"moneyline",line:null,firstPrice:-300,secondPrice:250,
  providerObservedAt:"2026-11-01T16:55:00Z",fetchedAt:"2026-11-01T16:56:00Z",phase:"current"};
const board=buildCbbProvisionalBoard(forecast,[base,{...base,market:"spread",line:-7.5,firstPrice:-105,secondPrice:-115},
  {...base,market:"total",line:146.5,firstPrice:-110,secondPrice:-110}]);
let payload:unknown=null,writes=0,readError:string|null=null;
const db={from:(table:string)=>{assert.equal(table,"lab_response_snapshots");return {
  select:()=>({eq:(_:string,key:string)=>{assert.equal(key,"cbb::member-game::777");return {maybeSingle:async()=>({data:payload?{payload}:null,error:readError?{message:readError}:null})};}}),
  upsert:async(row:{payload:unknown})=>{writes++;payload=structuredClone(row.payload);return {error:null};},
};}} as unknown as Parameters<typeof writeCbbMemberGame>[1];
async function main(){
  const bookHistory={release:"owls_book_display_history_2026_10_29_r1",sport:"cbb",fetchedAt:before,eventsAt:before,events:[],rows:[{
    event:777,start,away:"ND",home:"VILL",kind:"spread",side:"home",book:"fanduel",providerEventId:"published:777",checkedAt:before,opening:null,
    quotes:[[Date.parse("2026-11-01T16:00:00Z"),-110,-8.5],[Date.parse(base.providerObservedAt),-105,-7.5]],observedQuotes:true,
  }]} as NonNullable<Parameters<typeof writeCbbMemberGame>[0]["bookHistory"]>;
  const splitEvidence={release:"cbb_split_evidence_2026_11_03_r4_shared_market_identity",eventId:"ncaab:ND@VILL-20261101",feedStatus:"ok",reason:"observed_no_prediction_authority",rows:[
    {market:"moneyline",selection:"first",sourceBook:"circa",observedAt:base.providerObservedAt,gameId:777,sourceLine:null,sourceEventId:"ncaab:ND@VILL-20261101",fetchedAt:before,orientationVerified:true,ticketsPct:.2,moneyPct:.4,moneyMinusTicketsPoints:20},
    {market:"moneyline",selection:"second",sourceBook:"circa",observedAt:base.providerObservedAt,gameId:777,sourceLine:null,sourceEventId:"ncaab:ND@VILL-20261101",fetchedAt:before,orientationVerified:true,ticketsPct:.8,moneyPct:.6,moneyMinusTicketsPoints:-20},
  ]} as NonNullable<Parameters<typeof writeCbbMemberGame>[0]["splitEvidence"]>;
  const first=await writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:before,bookHistory,splitEvidence},db);
  assert.deepEqual(first.record.memberGame.markets.first_inning.lineTrail?.map(s=>s.line),[-8.5,-7.5],"the real collector tape is persisted with the evaluated tuple");
  assert.deepEqual(first.record.memberGame.markets.moneyline.sportsbookSplits?.rows.map(r=>[r.betsPct,r.moneyPct]),[[20,40],[80,60]],"source fractions become member percentages exactly once");
  assert.equal(first.written,true);assert.equal(writes,1);assert.equal(first.record.memberGame.cbbHomeCollege,"Villanova");
  const frozen=await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:"2026-11-01T18:00:00Z"},db);
  assert.equal(frozen.record.snapshot.lockedAt,"2026-11-01T18:00:00Z");assert.equal(writes,2);
  assert.deepEqual(frozen.record.memberGame.markets.first_inning.lineTrail,first.record.memberGame.markets.first_inning.lineTrail,"future locks preserve the captured line history");
  assert.deepEqual(frozen.record.memberGame.markets.moneyline.sportsbookSplits,first.record.memberGame.markets.moneyline.sportsbookSplits,"future locks preserve actual split evidence");
  for(const key of ["moneyline","first_inning","total"] as const){
    for(const field of ["pick","priceAmerican","modelProb","line","verdict"] as const)
      assert.deepEqual(frozen.record.memberGame.markets[key][field],first.record.memberGame.markets[key][field],"freezing cannot reinterpret the published decision");
  }
  const exact=JSON.stringify(payload);
  const full=cbbDailyEdgeResponse("2026-11-01",[frozen.record.memberGame],before);
  const compact=projectCbbSnapshotForInitialBoard({snapshot:full,fullReaderGameId:null});
  assert.deepEqual(compact.deferredGameIds,["cbb-777"]);
  for(const key of ["moneyline","first_inning","total"] as const){
    for(const field of ["pick","priceAmerican","modelProb","line","verdict","marketPrediction"] as const)
      assert.deepEqual(compact.snapshot.games[0].markets[key][field],full.games[0].markets[key][field],"board compaction retains exact locked decisions");
  }
  assert.equal(compact.snapshot.games[0].markets.first_inning.lineTrail?.length,0,"unopened charts are deferred");
  assert.equal(projectCbbSnapshotForInitialBoard({snapshot:full,fullReaderGameId:"cbb-777"}).snapshot.games[0],full.games[0],"an opened legacy reader receives the complete original object");
  assert.equal(JSON.stringify(payload),exact,"compaction cannot change the stored evidence");
  const legacy=structuredClone(frozen.record);legacy.release="cbb_member_game_store_2026_10_29_r1_single_leased_writer";
  payload=legacy;const legacyBytes=JSON.stringify(payload);
  const legacyResult=await writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:"2026-11-01T18:10:00Z",bookHistory},db);
  assert.equal(legacyResult.written,false);assert.equal(JSON.stringify(legacyResult.record),legacyBytes,"legacy locked fields and reader precedence remain byte-exact");
  payload=structuredClone(frozen.record);
  const later=await writeCbbMemberGame({game,candidate:{...board,score:{...board.score,home:80,margin:12,total:148}},
    homeLogo:"https://example.com/new.png",awayLogo:null,now:"2026-11-01T18:30:00Z"},db);
  assert.equal(later.written,false);assert.equal(writes,2);assert.equal(JSON.stringify(payload),exact,"writer must not touch locked DTO");
  const read=cbbMemberGameForReader(later.record,{...game,status:"post",status_state:"final",home_score:80,away_score:72});
  assert.equal(read.projected.home,78);assert.equal(read.result?.markets.first_inning.pickResult,"win");
  assert.equal(JSON.stringify(payload),exact,"settlement cannot mutate lock payload");
  let officialHomeName=game.home_team.full_name;
  let officialGameDate="2026-11-01T19:00:00+00:00";
  const indexRow={snapshot_key:"cbb::member-game::777",storeRelease:frozen.record.release,gameId:"777",startsAt:start,
    lockedAt:frozen.record.snapshot.lockedAt as string|null,memberId:"cbb-777",memberExternalId:"777",memberStart:start,memberLock:frozen.record.snapshot.lockedAt as string|null};
  let missingIndex=false,fullReads=0;
  const overlayDb={from:(table:string)=>table==="lab_response_snapshots"?{
    select:(fields:string)=>({in:async()=>{if(fields.includes("storeRelease:"))return {data:missingIndex?[]:[indexRow],error:null};fullReads++;return {data:[{snapshot_key:"cbb::member-game::777",payload:frozen.record}],error:null};}})
  }:{select:()=>({eq:()=>({in:async()=>({data:[{external_id:777,status:"STATUS_FINAL",home_score:80,
    away_score:72,game_date:officialGameDate,home_team:{external_id:game.home_team.id,display_name:officialHomeName},
    away_team:{external_id:game.visitor_team.id,display_name:game.visitor_team.full_name}}],error:null})})})}} as unknown as Parameters<typeof overlayCbbLockedMemberGames>[1];
  const oldBoard=cbbDailyEdgeResponse("2026-11-01",[first.record.memberGame],before);
  const lockedBoard=await overlayCbbLockedMemberGames(oldBoard,overlayDb);
  assert.equal(lockedBoard.games[0].lockedAt,frozen.record.snapshot.lockedAt);
  assert.equal(lockedBoard.games[0].projected.home,78);
  assert.equal(lockedBoard.games[0].result?.markets.first_inning.pickResult,"win");
  assert.equal(oldBoard.games[0].lockedAt,null,"reader overlay must not mutate the stale board");
  assert.equal(fullReads,1,"only locked records need full evidence reads");
  const lock=indexRow.lockedAt;indexRow.lockedAt=null;indexRow.memberLock=null;
  await overlayCbbLockedMemberGames(oldBoard,overlayDb);
  assert.equal(fullReads,1,"unlocked metadata scan must not download reader histories");
  indexRow.lockedAt=lock;indexRow.memberLock=lock;
  missingIndex=true;
  await assert.rejects(overlayCbbLockedMemberGames(oldBoard,overlayDb),/missing member game record/);
  missingIndex=false;
  officialGameDate="2026-11-01T19:01:00+00:00";
  const correctedOfficial=await overlayCbbLockedMemberGames(oldBoard,overlayDb);
  assert.equal(correctedOfficial.games[0].gameStartAt,start,"official time correction cannot reinterpret the frozen public start");
  assert.equal(JSON.stringify(payload),exact);
  officialHomeName="Wrong school";
  await assert.rejects(overlayCbbLockedMemberGames(oldBoard,overlayDb),/school changed/);
  officialHomeName=game.home_team.full_name;
  officialGameDate="2026-11-01T19:00:00+00:00";
  payload=structuredClone(first.record);
  await assert.rejects(writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,
    now:"2026-11-01T19:01:00Z"},db),/missed pregame lock/);
  payload=structuredClone(frozen.record);
  readError="database unavailable";
  await assert.rejects(readCbbMemberGame(777,db),/read failed/);
  await assert.rejects(writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:before},db),/read failed/);
  assert.equal(writes,2,"read failure cannot become an absent lock");
  readError=null;payload={release:CBB_MEMBER_GAME_STORE_RELEASE,snapshot:{gameId:777}};
  await assert.rejects(readCbbMemberGame(777,db),/corrupt or legacy/);
  console.log("CBB store: single writer, T-60 lock, exact reader precedence, results-only settlement and fail-closed reads passed.");
}
void main();
