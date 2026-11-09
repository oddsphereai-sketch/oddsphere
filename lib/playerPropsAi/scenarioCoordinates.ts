/** Nonnegative physical coordinates, converted exactly into canonical stat units. */
import type {GamePacket,Player} from "./evidenceContract";
import {primitives,type PlayerLaw} from "./law";
import {invariant} from "./evidence";
import {PROPS_AI_SCENARIOS} from "./releases";
export const PROPS_AI_WIRE_RELEASE="props_scenario_named_2026_11_09_r3_canonical_statistics";
/** R2 remains an explicit historical decoder, never an interpretation of R3. */
export const PROPS_AI_LEGACY_WIRE_RELEASE="props_scenario_rows_2026_11_07_r2_physical_coordinates";
export function decodeNamedScenarioLaw(sport:GamePacket["sport"],player:Pick<Player,"markets"|"sourceEventContracts">,value:unknown):PlayerLaw{
  invariant(value!==null&&typeof value==="object"&&!Array.isArray(value),"Named scenario law required; positional rows are not R3");
  const law=value as PlayerLaw;
  invariant(Object.keys(law).sort().join("|")==="outcomes|weights"&&law.outcomes!==null&&typeof law.outcomes==="object"&&!Array.isArray(law.outcomes),"Named law fields mismatch");
  invariant(Object.keys(law.outcomes).sort().join("|")===primitives(sport,player).sort().join("|"),"Named scenario statistics mismatch");
  return law;
}
export function scenarioColumns(sport:GamePacket["sport"],player:Pick<Player,"markets"|"sourceEventContracts">){
  return ["relativeWeight",...primitives(sport,player).flatMap(key=>{
    if(sport==="nba"&&key==="points")return ["points_excluding_made_threes"];
    if(sport==="nfl"&&key==="passing_attempts")return ["other_incomplete_passes"];
    if(sport==="nfl"&&key==="passing_completions")return ["non_touchdown_completions"];
    if(key.endsWith("yards"))return [`${key}_gained`,`${key}_lost`];
    if(key==="batter_runs_scored")return ["batter_non_home_run_runs"];
    if(key==="batter_rbis")return ["batter_non_home_run_rbis"];
    return [key];
  })];
}
export function decodeScenarioRows(sport:GamePacket["sport"],player:Pick<Player,"markets"|"sourceEventContracts">,rows:number[][]):PlayerLaw{
  const columns=scenarioColumns(sport,player),keys=primitives(sport,player);
  invariant(Array.isArray(rows)&&rows.length===PROPS_AI_SCENARIOS&&rows.every(r=>Array.isArray(r)&&r.length===columns.length&&r.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=10000)),"Forecast scenario row dimensions/coordinates mismatch");
  const observations=rows.map(row=>{
    const v=Object.fromEntries(columns.map((k,i)=>[k,row[i]]));
    const result=Object.fromEntries(keys.map(k=>[k,v[k]]));
    if(sport==="nba")result.points=v.points_excluding_made_threes+3*v.threes;
    if(sport==="nfl"&&keys.includes("passing_attempts")){
      result.passing_completions=v.non_touchdown_completions+v.passing_tds;
      result.passing_attempts=result.passing_completions+v.interceptions+v.other_incomplete_passes;
    }
    for(const key of keys)if(key.endsWith("yards"))result[key]=v[`${key}_gained`]-v[`${key}_lost`];
    if(sport==="mlb"&&keys.includes("batter_home_runs")){
      result.batter_runs_scored=v.batter_non_home_run_runs+v.batter_home_runs;
      result.batter_rbis=v.batter_non_home_run_rbis+v.batter_home_runs;
    }
    return result;
  });
  return {weights:rows.map(r=>r[0]),outcomes:Object.fromEntries(keys.map(k=>[k,observations.map(v=>v[k])]))};
}
