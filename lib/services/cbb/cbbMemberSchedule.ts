import {unstable_cache} from "next/cache";
import type {DailyEdgeResponse} from "@/app/lab/lib/labTypes";
import {applyCbbScheduleCoverage,excludeAnalyzedCbbScheduleGames,loadCbbRollingSchedule,type CbbRollingSchedule} from "./cbbRollingSchedule";

// Cache only the canonical schedule, never a member forecast or locked DTO.
// Cache Components are not enabled in this application; this is the supported
// existing Data Cache API and bounds the extra read without provider polling.
const readCachedSchedule=unstable_cache(loadCbbRollingSchedule,["cbb-member-schedule-r1"],{revalidate:120});

/** Display-only attachment. Admission comes from the sole writer's coverage;
 * schedule membership never fabricates a projection, grade, price or lock. */
export async function attachCbbMemberSchedule(snapshot:DailyEdgeResponse,
 load:(anchorDate:string)=>Promise<CbbRollingSchedule>=readCachedSchedule):Promise<DailyEdgeResponse>{
 if(snapshot.sport!=="cbb"||!snapshot.cbbScheduleCoverage)return snapshot;
 const schedule=applyCbbScheduleCoverage(await load(snapshot.date),snapshot.cbbScheduleCoverage);
 const pending=excludeAnalyzedCbbScheduleGames(schedule,snapshot.games.map(game=>game.external_id));
 return {...snapshot,cbbRollingSchedule:pending};
}
