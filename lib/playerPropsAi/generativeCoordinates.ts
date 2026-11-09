/** Named prospective generative coordinates. Never reinterpret an accepted law. */
import type {GamePacket,Player} from "./evidenceContract";
import {primitives,validateLaw,type PlayerLaw} from "./law";
import {validateScenarioOpportunities} from "./forecastSanity";
import {invariant} from "./evidence";
import {PROPS_AI_SCENARIOS} from "./releases";
export const GENERATIVE_WIRE_RELEASE="props_scenario_named_2026_11_09_r4_generative_components" as const;
type Scope=Pick<Player,"markets">;
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
function coordinate(sport:GamePacket["sport"],key:string){
 if(sport==="nba"&&key==="points")return "points_excluding_made_threes";
 if(sport==="nfl"&&key==="passing_attempts")return "other_incomplete_passes";
 if(sport==="nfl"&&key==="passing_completions")return "non_touchdown_completions";
 if(sport==="nfl"&&key==="passing_yards")return "passing_yards_if_completion";
 if(sport==="mlb"&&key==="batter_runs_scored")return "batter_non_home_run_runs";
 if(sport==="mlb"&&key==="batter_rbis")return "batter_non_home_run_rbis";
 return key;
}
export function generativeStatistics(sport:GamePacket["sport"],player:Scope){return primitives(sport,player).map(k=>coordinate(sport,k));}
export function signedGenerativeStatistic(key:string){return key.endsWith("yards")||key==="passing_yards_if_completion";}
export const GENERATIVE_MEANING="All arrays share sixteen scenario indices. Non-three points plus three times made threes give total points. Non-touchdown completions plus passing TDs give completions; completions plus interceptions and other incomplete passes give attempts. passing_yards_if_completion is potential TOTAL net passing yards for that scenario if any completion occurs, NOT yards per completion; canonical passing yards are zero when completions are zero, otherwise that signed potential total. Unused potential values are not game observations. MLB non-home-run runs/RBIs plus home runs give total runs/RBIs. Other coordinates are named canonical statistics. Backend derives these definitions before all source checks, projections and prices.";
export function decodeGenerativeScenarioLaw(sport:GamePacket["sport"],player:Scope,value:unknown):PlayerLaw{
 const row=object(value),outcomes=object(row?.outcomes),keys=generativeStatistics(sport,player);
 invariant(row&&Object.keys(row).sort().join("|")==="outcomes|weights"&&outcomes,"Generative law fields mismatch");
 invariant(Object.keys(outcomes).sort().join("|")===keys.slice().sort().join("|"),"Generative named coordinates mismatch; canonical or positional drafts are not R4");
 const weights=row.weights;
 invariant(Array.isArray(weights)&&weights.length===PROPS_AI_SCENARIOS&&weights.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=10000)&&weights.some(n=>n>0),"Invalid generative relative weights");
 for(const key of keys){const a=outcomes[key];invariant(Array.isArray(a)&&a.length===PROPS_AI_SCENARIOS&&a.every(n=>Number.isSafeInteger(n)&&Math.abs(n)<=10000&&(signedGenerativeStatistic(key)||n>=0)),`Invalid generative integer units: ${key}`);}
 const v=(key:string,i:number)=>(outcomes[key] as number[])[i];
 const canonical=Object.fromEntries(primitives(sport,player).map(key=>[key,Array.from({length:PROPS_AI_SCENARIOS},(_,i)=>{
  if(sport==="nba"&&key==="points")return v("points_excluding_made_threes",i)+3*v("threes",i);
  if(sport==="nfl"&&key==="passing_completions")return v("non_touchdown_completions",i)+v("passing_tds",i);
  if(sport==="nfl"&&key==="passing_attempts")return v("non_touchdown_completions",i)+v("passing_tds",i)+v("interceptions",i)+v("other_incomplete_passes",i);
  if(sport==="nfl"&&key==="passing_yards")return v("non_touchdown_completions",i)+v("passing_tds",i)===0?0:v("passing_yards_if_completion",i);
  if(sport==="mlb"&&key==="batter_runs_scored")return v("batter_non_home_run_runs",i)+v("batter_home_runs",i);
  if(sport==="mlb"&&key==="batter_rbis")return v("batter_non_home_run_rbis",i)+v("batter_home_runs",i);
  return v(key,i);
 })]));
 const law={weights:[...weights],outcomes:canonical};const accepted=validateLaw(sport,player,law);validateScenarioOpportunities(sport,accepted);return law;
}
/** For valid canonical fixtures only. Cannot repair an impossible historical draft. */
export function encodeCanonicalScenarioLaw(sport:GamePacket["sport"],player:Scope,law:PlayerLaw):PlayerLaw{
 const accepted=validateLaw(sport,player,law);validateScenarioOpportunities(sport,accepted);
 const v=(key:string,i:number)=>law.outcomes[key][i];
 const outcomes=Object.fromEntries(primitives(sport,player).map(key=>[coordinate(sport,key),law.outcomes[key].map((value,i)=>{
  if(sport==="nba"&&key==="points")return value-3*v("threes",i);
  if(sport==="nfl"&&key==="passing_completions")return value-v("passing_tds",i);
  if(sport==="nfl"&&key==="passing_attempts")return value-v("passing_completions",i)-v("interceptions",i);
  if(sport==="mlb"&&(key==="batter_runs_scored"||key==="batter_rbis"))return value-v("batter_home_runs",i);
  return value;
 })]));return {weights:[...law.weights],outcomes};
}
