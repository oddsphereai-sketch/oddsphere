import assert from "node:assert/strict";
import {attachCbbMemberSchedule} from "../lib/services/cbb/cbbMemberSchedule";
import type {DailyEdgeGameDto,DailyEdgeResponse} from "../app/lab/lib/labTypes";
import type {CbbRollingSchedule} from "../lib/services/cbb/cbbRollingSchedule";
import {CBB_ROLLING_SLATE_RELEASE} from "../lib/cbb/rollingSlate";
import {readMemberDataWithDeadline} from "../lib/services/memberDataAvailability";

async function main(){
 const locked={id:"cbb-1",external_id:1,sport:"cbb",lockedAt:"2026-11-04T21:00:00Z",
  gameStartAt:"2026-11-04T22:00:00Z",markets:{moneyline:{modelProb:.62,priceAmerican:120,
   verdict:{label:"Lean"}}}} as unknown as DailyEdgeGameDto;
 const original={sport:"cbb",date:"2026-11-04",games:[locked],
  cbbScheduleCoverage:{eligibleGameIds:[1,2],modelEligibleGameIds:[1]}} as DailyEdgeResponse;
 const before=JSON.stringify(original);
 const schedule={release:CBB_ROLLING_SLATE_RELEASE,anchorDate:original.date,throughDate:"2026-11-06",games:[1,2,3].map(id=>({
  id:`schedule-${id}`,externalId:id,slateDate:original.date,gameStartAt:`2026-11-04T${21+id}:00:00Z`,
  status:"STATUS_SCHEDULED",homeTeam:`H${id}`,awayTeam:`A${id}`,homeTeamDisplayName:`Home ${id}`,
  awayTeamDisplayName:`Away ${id}`,homeTeamLogo:null,awayTeamLogo:null,venue:null}))} satisfies CbbRollingSchedule;
 let reads=0;
 const result=await attachCbbMemberSchedule(original,async anchor=>{reads++;assert.equal(anchor,original.date);return schedule;});
 assert.equal(reads,1);
 assert.deepEqual(result.cbbRollingSchedule?.games.map(g=>g.externalId),[2],"only writer-eligible, not-yet-analyzed fixtures may become pending cards");
 assert.equal(result.games,original.games);assert.equal(result.games[0],locked);
 assert.equal(JSON.stringify(original),before,"schedule attachment cannot reinterpret stored locked fields");
 assert.ok(!("markets" in result.cbbRollingSchedule!.games[0]),"a schedule row has no invented price/probability/grade");
 const noCoverage={...original,cbbScheduleCoverage:undefined};
 assert.equal(await attachCbbMemberSchedule(noCoverage,async()=>{throw Error("must not load without authoritative admission");}),noCoverage);
 const otherSport={...original,sport:"nba"} as DailyEdgeResponse;
 assert.equal(await attachCbbMemberSchedule(otherSport,async()=>{throw Error("must not load another sport");}),otherSport);
 const recovered=await readMemberDataWithDeadline({label:"test-cbb-optional-schedule",fallback:original,
  read:()=>attachCbbMemberSchedule(original,async()=>{throw Error("schedule unavailable");})});
 assert.equal(recovered.value,original);assert.equal(recovered.unavailable,true);
 assert.equal(JSON.stringify(original),before);
 console.log("PASS CBB member schedule: authoritative eligibility, analyzed deduplication, exact locked DTOs, no fabricated betting data and optional-read fallback");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
