import {matchCbbVenue,canonicalCbbTeamName} from "./dataset";
import {cbbProviderInstitutionName} from "./providerInstitutionIdentity";
import type {EspnCbbEvent} from "./dataset";
import type {CbbGame} from "./types";

export const CBB_VENUE_IDENTITY_RELEASE="cbb_venue_identity_2026_11_02_r1_verified_external_ids" as const;

/** ESPN's St. Thomas id 2900 is the Minnesota D1 institution. Its shortened
 * display name alone cannot authorize a generic St. Thomas school join. */
export function matchCbbProviderVenue(game:CbbGame,events:EspnCbbEvent[],fetchedAt:string){
  const normalize=(value:string)=>cbbProviderInstitutionName(value);
  const team=(t:CbbGame["home_team"])=>({...t,full_name:normalize(t.full_name),college:t.college?normalize(t.college):null});
  const prepared=events.map(event=>({...event,competitions:event.competitions.map(comp=>({...comp,competitors:comp.competitors.map(c=>{
    const expected=[game.home_team,game.visitor_team].find(t=>t.id===332&&canonicalCbbTeamName(t.full_name)==="stthomasminnesotatommies");
    const verified=expected&&c.team.id==="2900"&&canonicalCbbTeamName(c.team.displayName)==="stthomastommies";
    return {...c,team:{...c.team,displayName:normalize(verified?expected.full_name:c.team.displayName),location:normalize(verified?expected.college??expected.full_name:c.team.location??"")}};
  })}))}));
  return matchCbbVenue({...game,home_team:team(game.home_team),visitor_team:team(game.visitor_team)},prepared,fetchedAt);
}
