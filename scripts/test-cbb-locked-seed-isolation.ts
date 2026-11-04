import assert from "node:assert/strict";
import { seedCbbGames } from "../lib/services/cbb/seedCbbGamesService";
import type { CbbGame } from "../lib/cbb/types";
const home={id:2,conference_id:1,name:"Owls",college:"Temple",full_name:"Temple Owls",abbreviation:"TEM"};
const away={id:3,conference_id:1,name:"Blue Devils",college:"Central Connecticut",full_name:"Central Connecticut Blue Devils",abbreviation:"CCSU"};
const game={id:1,date:"2026-11-02T23:30:00Z",season:2026,status:"pre",status_state:"scheduled",period:0,home_score:0,away_score:0,home_team:away,visitor_team:home}as CbbGame;
const fixture={id:100,external_id:1,status:"STATUS_SCHEDULED",game_date:game.date,home_team_id:20,away_team_id:30};
const writes:unknown[]=[];
const db={from:(table:string)=>({select:()=>{const q={eq:()=>q,in:()=>q,not:()=>q,then:(resolve:(value:unknown)=>unknown)=>resolve({error:null,data:table==="teams"?[{id:20,external_id:2,display_name:home.full_name},{id:30,external_id:3,display_name:away.full_name}]:table==="games"?[fixture]:table==="prediction_records"?[]:[{snapshot_key:"cbb::member-game::1",payload:{snapshot:{gameId:1,lockedAt:"2026-11-02T22:30:00Z"}}}]})};return q;},upsert:async(payload:unknown)=>{writes.push(payload);return{error:null};}})}as unknown as NonNullable<Parameters<typeof seedCbbGames>[0]["db"]>;
async function main(){const before=JSON.stringify(fixture);const r=await seedCbbGames({slateDate:"2026-11-02",season:2026,apiKey:"fixture-only",dryRun:false,capturedGames:[game],db});assert.deepEqual(r.preservedLockedConflicts,[1]);assert.equal(writes.length,0);assert.equal(JSON.stringify(fixture),before);
const terminalWrites:Array<Record<string,unknown>>=[];
const terminalFixture={...fixture,season:2026,home_score:null,away_score:null};
const terminalDb={from:(table:string)=>{
  const base=db.from(table);
  if(table!=="games")return base;
  return {select:()=>{const q={eq:()=>q,in:()=>q,then:(resolve:(value:unknown)=>unknown)=>resolve({error:null,data:[terminalFixture]})};return q;},
    update:(values:Record<string,unknown>)=>{terminalWrites.push(values);const matches:Record<string,unknown>={};const q={eq:(key:string,value:unknown)=>{matches[key]=value;return q;},select:()=>q,maybeSingle:async()=>{assert.equal(matches.game_date,terminalFixture.game_date);assert.equal(matches.home_team_id,20);assert.equal(matches.away_team_id,30);return{error:null,data:{id:100}};}};return q;},
    upsert:async()=>{throw new Error("The conflicting locked fixture must never be upserted");}};
}}as unknown as NonNullable<Parameters<typeof seedCbbGames>[0]["db"]>;
const fixed=await seedCbbGames({slateDate:"2026-11-02",season:2026,apiKey:"fixture-only",dryRun:false,
  capturedGames:[{...game,date:"2026-11-03T00:00:00Z",status:"post",status_state:"final",period:2,home_score:70,away_score:90}],db:terminalDb});
assert.deepEqual(fixed.preservedLockedConflicts,[]);assert.deepEqual(fixed.terminalScoresMappedToLockedIdentity,[1]);
assert.deepEqual(terminalWrites,[{status:"STATUS_FINAL",home_score:90,away_score:70,period:2}]);
assert.equal(JSON.stringify(fixture),before,"the exact original fixture and member lock remain unchanged except the separately written terminal facts");
console.log("CBB seed: live identity conflicts stay held; exact final team scores settle without changing locked identity.");}void main();
