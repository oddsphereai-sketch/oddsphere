import assert from "node:assert/strict";
import { normalCdf } from "../lib/cbb/model";
import { buildCbbGameForecastBoard } from "../lib/cbb/gameForecastBoard";
import { CBB_FULL_D1_SCORE_RELEASE } from "../lib/cbb/fullDivisionOneReleases";
import type { CbbForecast, CbbGame } from "../lib/cbb/types";
import { adaptCbbProvisionalGame } from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import { advanceCbbProvisionalSnapshot } from "../lib/cbb/provisionalLifecycle";
import { CBB_MEMBER_GAME_STORE_RELEASE, cbbMemberGameForReader, type CbbStoredMemberGame } from "../lib/services/cbb/cbbMemberGameStore";
import { cbbTrackingEvidenceSha256 } from "../lib/services/cbb/cbbTrackingWriter";
import { buildCbbMissedLockRecovery } from "../lib/services/cbb/cbbMissedLockRecovery";
const before="2026-11-12T20:00:00Z",start="2026-11-12T22:00:00Z",recoveredAt="2026-11-13T12:00:00Z";
const team=(id:number)=>({id,abbreviation:`T${id}`,full_name:`School ${id}`,name:`School ${id}`,college:null,conference_id:1});
const game:CbbGame={id:777,date:start,season:2026,status:"pre",period:0,home_score:0,away_score:0,home_team:team(1),visitor_team:team(2)};
const sd=11,margin=10,zero=normalCdf((.5-margin)/sd)-normalCdf((-.5-margin)/sd);
const f:CbbForecast={release:CBB_FULL_D1_SCORE_RELEASE,gameId:777,asOf:before,homeId:1,awayId:2,homeScore:78,awayScore:68,margin,total:146,possessions:69,
  homeWinProbability:(1-normalCdf((.5-margin)/sd))/(1-zero),inputStatus:"complete",issues:[],uncertainty:{marginSd:sd,totalSd:16,marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:3000}};
const board=buildCbbGameForecastBoard(f,{kind:"d1_newcomer",inputs:{synthetic:true}} as Parameters<typeof buildCbbGameForecastBoard>[1],[]);
const snapshot=advanceCbbProvisionalSnapshot({existing:null,candidate:board,startsAt:start,now:before});
const original:CbbStoredMemberGame={release:CBB_MEMBER_GAME_STORE_RELEASE,snapshot,memberGame:adaptCbbProvisionalGame({game,snapshot,homeLogo:null,awayLogo:null,now:before})};
let reads=0;const db={from:(table:string)=>{reads++;if(table==="games")return{select:()=>{const q={eq:()=>q,maybeSingle:async()=>({data:{id:12,external_id:777,game_date:start,slate_date:"2026-11-12",home_team:{external_id:1,display_name:"School 1"},away_team:{external_id:2,display_name:"School 2"}},error:null})};return q;}};assert.equal(table,"prediction_records");return{select:()=>{const q={eq:()=>q,then:(resolve:(v:unknown)=>unknown)=>resolve({data:[],error:null})};return q;},insert:()=>{throw Error("Real write forbidden");}};}} as unknown as Parameters<typeof buildCbbMissedLockRecovery>[0]["db"];
async function main(){
  const bytes=JSON.stringify(original),hash=cbbTrackingEvidenceSha256(original);
  const rows=await buildCbbMissedLockRecovery({original,approvedSha256:hash,recoveredAt,db});
  assert.equal(rows.length,1,"A saved unpriced winner cannot invent spread/total picks");
  const r=rows[0];assert.equal(r.market,"moneyline");assert.equal(r.pick,"home");assert.equal(r.odds_american,null);assert.equal(r.play_grade,"no_play");
  assert.equal(r.locked_at,recoveredAt,"Actual recovery time, never a backdated T-60 lock");
  assert.equal(r.snapshot_json?.evidence_payload_sha256,hash);assert.equal(r.snapshot_json?.original_member_snapshot_locked_at,null);
  assert.equal(r.snapshot_json?.on_time_t60_lock,false);assert.equal(r.snapshot_json?.original_forecast_captured_at,before);
  assert.equal(JSON.stringify(original),bytes,"The original member snapshot is unchanged");
  const read=cbbMemberGameForReader(original,game);assert.equal(read.lockedAt,null);assert.deepEqual(read.markets,original.memberGame.markets,"Recovery cannot reinterpret reader history");
  await assert.rejects(buildCbbMissedLockRecovery({original,approvedSha256:"0".repeat(64),recoveredAt,db}),/source\/hash\/clock/);
  const afterCutoff=structuredClone(original);afterCutoff.snapshot.capturedAt="2026-11-12T21:01:00Z";
  await assert.rejects(buildCbbMissedLockRecovery({original:afterCutoff,approvedSha256:cbbTrackingEvidenceSha256(afterCutoff),recoveredAt,db}),/source\/hash\/clock/);
  const locked=structuredClone(original);locked.snapshot.lockedAt=before;locked.memberGame.lockedAt=before;
  await assert.rejects(buildCbbMissedLockRecovery({original:locked,approvedSha256:cbbTrackingEvidenceSha256(locked),recoveredAt,db}),/source\/hash\/clock/);
  assert(reads>0);console.log("PASS CBB owner-approved missed-lock recovery: exact pregame winner, honest actual recovery clock, no invented lines, source hash binding, original writer/reader payload precedence; zero real IO");
}
main().catch(e=>{console.error(e);process.exitCode=1});
