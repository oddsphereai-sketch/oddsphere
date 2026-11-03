import {matchCbbVenue,canonicalCbbTeamName} from "./dataset";
import {cbbProviderInstitutionName} from "./providerInstitutionIdentity";
import type {EspnCbbEvent} from "./dataset";
import type {CbbGame} from "./types";

export const CBB_VENUE_IDENTITY_RELEASE="cbb_venue_identity_2026_11_03_r2_verified_new_orleans_espn_id" as const;

/** ESPN's St. Thomas id 2900 is the Minnesota D1 institution. Its shortened
 * display name alone cannot authorize a generic St. Thomas school join. */
export function matchCbbProviderVenue(game:CbbGame,events:EspnCbbEvent[],fetchedAt:string){
  const normalize=(value:string)=>cbbProviderInstitutionName(value);
  const team=(t:CbbGame["home_team"])=>({...t,full_name:normalize(t.full_name),college:t.college?normalize(t.college):null});
  const prepared=events.map(event=>({...event,competitions:event.competitions.map(comp=>({...comp,competitors:comp.competitors.map(c=>{
    const stThomas=[game.home_team,game.visitor_team].find(t=>t.id===332&&canonicalCbbTeamName(t.full_name)==="stthomasminnesotatommies");
    const newOrleans=[game.home_team,game.visitor_team].find(t=>t.id===317&&canonicalCbbTeamName(t.full_name)==="neworleansprivateers");
    const expected=stThomas&&c.team.id==="2900"&&canonicalCbbTeamName(c.team.displayName)==="stthomastommies"?stThomas:
      newOrleans&&c.team.id==="2443"&&canonicalCbbTeamName(c.team.displayName)==="lsuneworleansprivateers"?newOrleans:null;
    return {...c,team:{...c.team,displayName:normalize(expected?expected.full_name:c.team.displayName),location:normalize(expected?expected.college??expected.full_name:c.team.location??"")}};
  })}))}));
  return matchCbbVenue({...game,home_team:team(game.home_team),visitor_team:team(game.visitor_team)},prepared,fetchedAt);
}
