import assert from "node:assert/strict";
import fs from "node:fs";
import {gunzipSync} from "node:zlib";
import {CBB_FULL_D1_MARKET_MODEL_RELEASE,CBB_PREVIOUS_FULL_D1_MARKET_MODEL_RELEASE,CBB_FULL_D1_READER_RECEIPT_RELEASE,CBB_PREVIOUS_FULL_D1_READER_RECEIPT_RELEASE} from "../lib/cbb/fullDivisionOneReleases";
import {writeCbbMemberGame,cbbMemberGameForReader,type CbbStoredMemberGame} from "../lib/services/cbb/cbbMemberGameStore";
import {writeLockedCbbTracking} from "../lib/services/cbb/cbbTrackingWriter";
import type {CbbGame} from "../lib/cbb/types";
const read=(file:string)=>JSON.parse(gunzipSync(fs.readFileSync(new URL(`./fixtures/${file}.json.gz`,import.meta.url))).toString());
async function main(){
  // Actual saved R19/R15 publication; freeze only inside this in-memory harness.
  let stored=read("cbb-r19-member-20261105") as CbbStoredMemberGame;
  const game=(read("cbb-source-admission-20261105").games as CbbGame[]).find(g=>g.id===stored.snapshot.gameId)!;
  assert.ok(game);assert.equal(stored.snapshot.board.modelRelease,CBB_PREVIOUS_FULL_D1_MARKET_MODEL_RELEASE);
  assert.equal(stored.snapshot.board.marketContext.verifiedMarketRead?.release,CBB_PREVIOUS_FULL_D1_READER_RECEIPT_RELEASE);
  const tracked:Record<string,unknown>[]=[];
  const db={from:(table:string)=>{
    if(table==="lab_response_snapshots")return {select:()=>{const q={eq:()=>q,maybeSingle:async()=>({data:{payload:stored},error:null})};return q;},
      upsert:async(row:{payload:CbbStoredMemberGame})=>{stored=structuredClone(row.payload);return {error:null};}};
    if(table==="games")return {select:()=>{const q={eq:()=>q,maybeSingle:async()=>({data:{id:1,external_id:game.id,game_date:game.date,slate_date:"2026-11-05",home_team:{external_id:game.home_team.id,display_name:game.home_team.full_name},away_team:{external_id:game.visitor_team.id,display_name:game.visitor_team.full_name}},error:null})};return q;}};
    assert.equal(table,"prediction_records");return {select:()=>{const q={eq:()=>q,then:(resolve:(x:unknown)=>unknown)=>resolve({data:tracked,error:null})};return q;},
      insert:async(row:Record<string,unknown>)=>{tracked.push(structuredClone(row));return {error:null};}};
  }} as unknown as NonNullable<Parameters<typeof writeCbbMemberGame>[1]>;
  const lockAt=new Date(Date.parse(game.date)-3600_000).toISOString();
  const frozen=await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lockAt},db);
  assert.equal(frozen.record.snapshot.board.modelRelease,CBB_PREVIOUS_FULL_D1_MARKET_MODEL_RELEASE);
  const bytes=JSON.stringify(frozen.record);
  assert.equal(await writeLockedCbbTracking(frozen.record,db),3);
  assert.ok(tracked.every(r=>r.model_version===CBB_PREVIOUS_FULL_D1_MARKET_MODEL_RELEASE&&r.model_used==="cbb_r19_complete_d1_program_priors"));
  assert.equal(await writeLockedCbbTracking(frozen.record,db),0);
  const replacement=structuredClone(frozen.record.snapshot.board);replacement.modelRelease=CBB_FULL_D1_MARKET_MODEL_RELEASE;replacement.score.home=999;
  assert.equal((await writeCbbMemberGame({game,candidate:replacement,homeLogo:null,awayLogo:null,now:lockAt},db)).written,false);
  assert.deepEqual(cbbMemberGameForReader(stored,game),frozen.record.memberGame);
  assert.equal(JSON.stringify(stored),bytes,"new writer/reader/tracker preserve the original locked release and payload");
  const next=structuredClone(frozen.record);next.snapshot.board.modelRelease=CBB_FULL_D1_MARKET_MODEL_RELEASE;
  next.snapshot.board.marketContext.verifiedMarketRead!.modelRelease=CBB_FULL_D1_MARKET_MODEL_RELEASE;
  next.snapshot.board.marketContext.verifiedMarketRead!.release=CBB_FULL_D1_READER_RECEIPT_RELEASE;
  tracked.length=0;assert.equal(await writeLockedCbbTracking(next,db),3);
  assert.ok(tracked.every(r=>r.model_used==="cbb_r20_complete_source_admission"&&r.model_version===CBB_FULL_D1_MARKET_MODEL_RELEASE));
  const corrupt=structuredClone(frozen.record);corrupt.snapshot.board.score.home+=1;
  await assert.rejects(writeLockedCbbTracking(corrupt,db),/receipt differs/);
  console.log("PASS actual CBB R19/R15 continuity: future lock, exact reader/writer bytes, tracking idempotence, receipt guard, distinct R20 attribution.");
}void main().catch(error=>{console.error(error);process.exitCode=1;});
