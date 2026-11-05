import membership from "./artifacts/division-one-membership-2026-r1.json";
import type { CbbTeam } from "./types";

export const CBB_DIVISION_ONE_MEMBERSHIP_RELEASE=membership.release;
const members=new Map(membership.members.map(row=>[row.bdl,row]));
export function cbbDivisionOneTeamIds(season:number):ReadonlySet<number>{
  if(season!==membership.season)throw Error("CBB Division I membership season needs renewal");
  return new Set(members.keys());
}

/** Season-specific NCAA men's-basketball census, including reclassifying D1
 * programs. Neither a missing model rating nor a null provider conference is
 * division evidence. The 365 exact school IDs are bound to the source census. */
export function isCbbDivisionOneTeam(team:Pick<CbbTeam,"id"|"full_name">,season:number):boolean{
  if(season!==membership.season)throw Error("CBB Division I membership season needs renewal");
  const row=members.get(team.id);
  if(row&&row.bdlName!==team.full_name)throw Error(`CBB Division I school identity changed: ${team.id}`);
  return !!row;
}
export function cbbDivisionOneFixture(game:{season:number;home_team:CbbTeam;visitor_team:CbbTeam}){
  const home=isCbbDivisionOneTeam(game.home_team,game.season),away=isCbbDivisionOneTeam(game.visitor_team,game.season);
  return {home,away,eligible:home||away,crossDivision:home!==away};
}
