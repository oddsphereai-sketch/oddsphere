import assert from "node:assert/strict";
import type { CbbForecast, CbbGame, CbbQuote } from "../lib/cbb/types";
import { buildCbbProvisionalBoard } from "../lib/cbb/provisionalBoard";
import { cbbMemberGameForReader, readCbbMemberGame, writeCbbMemberGame } from "../lib/services/cbb/cbbMemberGameStore";
import { CBB_MEMBER_GAME_STORE_RELEASE } from "../lib/services/cbb/cbbMemberGameStore";
import { cbbDailyEdgeResponse } from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import { overlayCbbLockedMemberGames } from "../lib/services/cbb/cbbMemberReader";

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
  const first=await writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:before},db);
  assert.equal(first.written,true);assert.equal(writes,1);assert.equal(first.record.memberGame.cbbHomeCollege,"Villanova");
  const frozen=await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:"2026-11-01T18:00:00Z"},db);
  assert.equal(frozen.record.snapshot.lockedAt,"2026-11-01T18:00:00Z");assert.equal(writes,2);
  const exact=JSON.stringify(payload);
  const later=await writeCbbMemberGame({game,candidate:{...board,score:{...board.score,home:80,margin:12,total:148}},
    homeLogo:"https://example.com/new.png",awayLogo:null,now:"2026-11-01T18:30:00Z"},db);
  assert.equal(later.written,false);assert.equal(writes,2);assert.equal(JSON.stringify(payload),exact,"writer must not touch locked DTO");
  const read=cbbMemberGameForReader(later.record,{...game,status:"post",status_state:"final",home_score:80,away_score:72});
  assert.equal(read.projected.home,78);assert.equal(read.result?.markets.first_inning.pickResult,"win");
  assert.equal(JSON.stringify(payload),exact,"settlement cannot mutate lock payload");
  let officialGameDate="2026-11-01T19:00:00+00:00";
  const overlayDb={from:(table:string)=>table==="lab_response_snapshots"?{
    select:()=>({in:async()=>({data:[{snapshot_key:"cbb::member-game::777",payload:frozen.record}],error:null})})
  }:{select:()=>({eq:()=>({in:async()=>({data:[{external_id:777,status:"STATUS_FINAL",home_score:80,
    away_score:72,game_date:officialGameDate}],error:null})})})}} as unknown as Parameters<typeof overlayCbbLockedMemberGames>[1];
  const oldBoard=cbbDailyEdgeResponse("2026-11-01",[first.record.memberGame],before);
  const lockedBoard=await overlayCbbLockedMemberGames(oldBoard,overlayDb);
  assert.equal(lockedBoard.games[0].lockedAt,frozen.record.snapshot.lockedAt);
  assert.equal(lockedBoard.games[0].projected.home,78);
  assert.equal(lockedBoard.games[0].result?.markets.first_inning.pickResult,"win");
  assert.equal(oldBoard.games[0].lockedAt,null,"reader overlay must not mutate the stale board");
  officialGameDate="2026-11-01T19:01:00+00:00";
  await assert.rejects(overlayCbbLockedMemberGames(oldBoard,overlayDb),/locked result identity missing/);
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
