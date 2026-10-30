import assert from "node:assert/strict";
import { buildCbbProvisionalBoard } from "../lib/cbb/provisionalBoard";
import { advanceCbbProvisionalSnapshot } from "../lib/cbb/provisionalLifecycle";
import type { CbbForecast, CbbGame, CbbQuote } from "../lib/cbb/types";
import { adaptCbbProvisionalGame } from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import { CBB_MEMBER_GAME_STORE_RELEASE, type CbbStoredMemberGame } from "../lib/services/cbb/cbbMemberGameStore";
import { writeLockedCbbTracking } from "../lib/services/cbb/cbbTrackingWriter";
import { gradePrediction } from "../lib/services/predictionGrader";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";

const start="2026-11-01T19:00:00Z",asOf="2026-11-01T17:00:00Z",lock="2026-11-01T18:00:00Z";
const team=(id:number,name:string,abbr:string)=>({id,name,full_name:name,college:name,abbreviation:abbr,conference_id:1});
const game:CbbGame={id:777,date:start,season:2026,status:"pre",period:0,home_score:0,away_score:0,
  home_team:team(1,"Villanova Wildcats","VILL"),visitor_team:team(2,"Notre Dame Fighting Irish","ND")};
const forecast:CbbForecast={release:"test",gameId:777,asOf,homeId:1,awayId:2,homeScore:78,awayScore:68,margin:10,total:146,
  possessions:69,homeWinProbability:.8,inputStatus:"complete",issues:[],uncertainty:{marginSd:11,totalSd:16,marginTotalCorrelation:0,
    marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:3000}};
const quote:CbbQuote={gameId:777,sportsbook:"fanduel",market:"moneyline",line:null,firstPrice:-300,secondPrice:250,
  providerObservedAt:"2026-11-01T16:55:00Z",fetchedAt:"2026-11-01T16:56:00Z",phase:"current"};
const board=buildCbbProvisionalBoard(forecast,[quote,{...quote,market:"spread",line:-7.5,firstPrice:-105,secondPrice:-115},
  {...quote,market:"total",line:146.5,firstPrice:-110,secondPrice:-110}]);
const first=advanceCbbProvisionalSnapshot({existing:null,candidate:board,startsAt:start,now:asOf});
const snapshot=advanceCbbProvisionalSnapshot({existing:first,candidate:null,startsAt:start,now:lock});
const memberGame=adaptCbbProvisionalGame({game,snapshot,homeLogo:null,awayLogo:null,now:lock});
const record:CbbStoredMemberGame={release:CBB_MEMBER_GAME_STORE_RELEASE,snapshot,memberGame};
const rows:Array<Record<string,unknown>>=[];
const db={from:(table:string)=>{
  if(table==="games")return {select:()=>{const q={eq:()=>q,maybeSingle:async()=>({data:{id:44,external_id:777,game_date:start,slate_date:"2026-11-01"},error:null})};return q;}};
  assert.equal(table,"prediction_records");
  return {select:()=>{const q={eq:()=>q,then:(resolve:(value:unknown)=>unknown)=>resolve({data:rows,error:null})};return q;},
    insert:async(row:Record<string,unknown>)=>{rows.push(structuredClone(row));return {error:null};}};
}} as unknown as Parameters<typeof writeLockedCbbTracking>[1];

async function main(){
  assert.equal(await writeLockedCbbTracking({...record,snapshot:first,memberGame:{...memberGame,lockedAt:null}},db),0);
  assert.equal(await writeLockedCbbTracking(record,db),3);
  assert.deepEqual(rows.map(row=>row.market),["moneyline","spread","total"]);
  assert.deepEqual(rows.map(row=>row.side),["home","home","under"]);
  assert.equal(rows[1].line_value,-7.5);
  assert.equal(rows[1].locked_at,lock);
  assert.equal(rows.every(row=>row.provisional===true&&row.sport==="cbb"),true);
  const settled=rows.map(row=>gradePrediction({record:{...row,id:1} as PredictionRecordRow,
    game:{status:"STATUS_FINAL",home_score:80,away_score:72,first_inning_runs:null},source:"auto_score_ingest"}).result);
  assert.deepEqual(settled,["win","win","loss"]);
  assert.equal(await writeLockedCbbTracking(record,db),0,"replay must not replace a locked row");
  rows[0].odds_american=999;
  await assert.rejects(writeLockedCbbTracking(record,db),/conflicts with locked member/);
  console.log("CBB tracking writer: frozen three-market rows, selected-side spread, idempotence and immutable conflict passed.");
}
void main();
