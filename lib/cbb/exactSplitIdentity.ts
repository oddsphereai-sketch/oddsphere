import { cbbProviderInstitutionName as canonicalCbbTeamName } from "./providerInstitutionIdentity";

export const CBB_SHARP_SPLIT_MAPPING_RELEASE =
  "cbb_sharp_split_mapping_2026_11_03_r3_shared_market_identity" as const;

export type CbbSplitTeamIdentity = {
  homeTeamDisplayName?: string | null;
  awayTeamDisplayName?: string | null;
  cbbHomeCollege?: string | null;
  cbbAwayCollege?: string | null;
};

// Source-proven full names from the normal November 2 capture. Shared by
// market capture, quote/split qualification and unlocked reader identity.
const CBB_MARKET_FULL_NAME_ALIASES = new Map([
  ["Army Knights", "Army Black Knights"],
  ["Central Connecticut St Blue Devils", "Central Connecticut Blue Devils"],
  ["Arkansas-Little Rock Trojans", "Little Rock Trojans"],
  ["Boston Univ. Terriers", "Boston University Terriers"],
  ["LIU Sharks", "Long Island University Sharks"],
  ["Mt. St. Mary's Mountaineers", "Mount St. Mary's Mountaineers"],
  ["GW Revolutionaries", "George Washington Revolutionaries"],
  ["UMKC Kangaroos", "Kansas City Roos"],
  ["Loyola (Chi) Ramblers", "Loyola Chicago Ramblers"],
  ["Tenn-Martin Skyhawks", "UT Martin Skyhawks"],
  ["Gardner-Webb Bulldogs", "Gardner-Webb Runnin' Bulldogs"],
  ["Grand Canyon Antelopes", "Grand Canyon Lopes"],
  ["Long Beach St 49ers", "Long Beach State Beach"],
  ["Fort Wayne Mastodons", "Purdue Fort Wayne Mastodons"],
  ["Sam Houston St Bearkats", "Sam Houston Bearkats"],
  ["CSU Fullerton Titans", "Cal State Fullerton Titans"],
].map(([source, canonical]) => [canonicalCbbTeamName(source), canonicalCbbTeamName(canonical)]));

/** Exact institution/full name or the verified school's own complete mascot. */
export function cbbSplitTeamMatches(sourceName:string,game:CbbSplitTeamIdentity,side:"home"|"away"):boolean {
  const source=canonicalCbbTeamName(sourceName.replace(/^\s*(?:\(\d+\)|#\d+)\s*/,""));
  const observed=CBB_MARKET_FULL_NAME_ALIASES.get(source)??source;
  if(!observed)return false;
  const institution=canonicalCbbTeamName((side==="home"?game.cbbHomeCollege:game.cbbAwayCollege)??"");
  const full=canonicalCbbTeamName((side==="home"?game.homeTeamDisplayName:game.awayTeamDisplayName)??"");
  if(institution===observed||full===observed)return true;
  if(!institution||!full.startsWith(institution))return false;
  const mascot=full.slice(institution.length);
  return !!mascot&&observed.length>mascot.length&&observed.endsWith(mascot)&&
    canonicalCbbTeamName(observed.slice(0,-mascot.length))===institution;
}

/** Neutral-site feeds may reverse home/away. Reject a pair that fits both orientations. */
export function cbbSplitOrientation(
  sourceAway: string,
  sourceHome: string,
  game: CbbSplitTeamIdentity,
): "direct" | "reversed" | null {
  const direct = cbbSplitTeamMatches(sourceAway, game, "away") &&
    cbbSplitTeamMatches(sourceHome, game, "home");
  const reversed = cbbSplitTeamMatches(sourceAway, game, "home") &&
    cbbSplitTeamMatches(sourceHome, game, "away");
  return direct === reversed ? null : direct ? "direct" : "reversed";
}
