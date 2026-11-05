import membership from "./artifacts/division-one-membership-2026-r1.json";
import knownSchools from "./artifacts/cross-division-known-schools-r1.json";
import {cbbDivisionOneFixture} from "./divisionOneMembership";
import type { CbbGame } from "./types";
import type { EspnCbbEvent } from "./dataset";
import { cbbProviderInstitutionName as name } from "./providerInstitutionIdentity";

export const CBB_CROSS_DIVISION_IDENTITY_RELEASE="cbb_cross_division_identity_2026_11_05_r1_paired_official_schools" as const;
// Exact school IDs in captured paired official fixtures. These are not global
// mascot aliases: provider ID, provider name, official ID/name, D1 opponent,
// orientation and exact confirmed kickoff must all agree in the same event.
const aliases:Array<[number,string,string,string]>=[
  [790,"Kings (PA) Monarchs","247","King's Monarchs"],
  [722,"Oaks","2381","Menlo Oaks"],
  [723,"Boll Weevils","2028","Arkansas Monticello Boll Weevils"],
  [946,"Colonels","2121","Centre Colonels"],
  [732,"Argonauts","2697","West Florida Argonauts"],
  [1172,"Scots","2800","Alma Scots"],
  [905,"Britons","2790","Albion Britons"],
  [481,"Allen University Yellow Jackets","2019","Allen Yellow Jackets"],
  [1219,"Terriers","2274","Hiram Terriers"],
  [640,"Newman University Jets","580","Newman Jets"],
  [804,"Bobcats","2327","Lees McRae Bobcats"],
  [832,"PANHANDLE ST","2824","Oklahoma Panhandle PANHANDLE ST"],
  [1381,"Pioneers","2970","William Paterson Pioneers"],
  [981,"Scots","2359","Macalester Scots"],
];
type OfficialTeam={id?:string;displayName:string;location?:string};
function matches(team:CbbGame["home_team"],official:OfficialTeam):boolean{
  if(team.id===317&&name(team.full_name)==="neworleansprivateers"&&official.id==="2443"&&name(official.displayName)==="lsuneworleansprivateers")return true;
  if(team.id===332&&name(team.full_name)==="stthomasminnesotatommies"&&official.id==="2900"&&name(official.displayName)==="stthomastommies")return true;
  if(knownSchools.schools.some(s=>s.bdlId===team.id&&s.bdlName===team.full_name&&s.espnId===official.id&&s.espnName===official.displayName))return true;
  if(aliases.some(([id,provider,espn,full])=>team.id===id&&team.full_name===provider&&official.id===espn&&official.displayName===full))return true;
  const own=[team.full_name,team.college].filter((x):x is string=>!!x).map(name);
  return [official.displayName,official.location].some(x=>!!x&&own.includes(name(x)));
}

export function cbbOfficialD1FixtureContext(game:CbbGame,events:EspnCbbEvent[],fetchedAt:string){
  const {home:h,away:a}=cbbDivisionOneFixture(game);
  if(!h&&!a||game.season!==2026||!Number.isFinite(Date.parse(fetchedAt)))return null;
  const found=events.filter(event=>{const c=event.competitions?.[0],home=c?.competitors.find(t=>t.homeAway==="home")?.team,
    away=c?.competitors.find(t=>t.homeAway==="away")?.team;
    return c?.timeValid===true&&typeof c.neutralSite==="boolean"&&Date.parse(event.date)===Date.parse(game.date)&&home&&away&&
      /^[1-9]\d*$/.test(home.id??"")&&/^[1-9]\d*$/.test(away.id??"")&&home.id!==away.id&&
      matches(game.home_team,home)&&matches(game.visitor_team,away);});
  if(found.length!==1)return null;
  const event=found[0],comp=event.competitions[0];
  const home=comp.competitors.find(t=>t.homeAway==="home")!.team,away=comp.competitors.find(t=>t.homeAway==="away")!.team;
  return {release:CBB_CROSS_DIVISION_IDENTITY_RELEASE,divisionOneId:h?game.home_team.id:game.visitor_team.id,
    opponentId:h?game.visitor_team.id:game.home_team.id,espnEventId:event.id,neutral:comp.neutralSite!,timeConfirmed:true,
    homeEspnId:home.id!,awayEspnId:away.id!,homeAbbreviation:home.abbreviation??null,awayAbbreviation:away.abbreviation??null,
    homeLogo:home.logo??null,awayLogo:away.logo??null,
    venue:comp.venue?.fullName??null,source:"espn_scoreboard" as const,fetchedAt,catalogSourceHash:membership.sourceHash};
}
export function cbbCrossDivisionContext(game:CbbGame,events:EspnCbbEvent[],fetchedAt:string){
  if(!cbbDivisionOneFixture(game).crossDivision)return null;
  return cbbOfficialD1FixtureContext(game,events,fetchedAt);
}
