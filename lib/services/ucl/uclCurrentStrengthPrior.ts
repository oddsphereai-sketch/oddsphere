import { normalizeUclEloClub } from "./uclClubIdentity";
import type { UclOfficialStrength } from "./uclOfficialStrengthSource";

export const UCL_CURRENT_STRENGTH_PRIOR_RELEASE = "ucl_strength_score_prior_2026_11_04_r1_original_dated_ratings" as const;
/** Frozen strictly pre-match original-source rating/goal fit. Reproducible inputs,
 * missing-pair coverage and provenance: docs/model-audits/2026-11-04-ucl-strength-prior-fit.json.
 * This is a goal-rate slope, not a bookmaker blend or calibrated confidence. */
export const UCL_STRENGTH_SCORE_COEFFICIENT = 0.6748444915670129;
export type UclCurrentStrengthPrior = {
  release: typeof UCL_CURRENT_STRENGTH_PRIOR_RELEASE;
  coefficientPer400: number;
  source: Pick<UclOfficialStrength,"release"|"sourceUrl"|"asOfDay"|"capturedAt"|"sourceHash">;
  ratings: Map<number,number>;
};
const sourceSlugs: Record<string,string> = {
  bayern:"bayern", atletico:"ath madrid", sporting:"sp lisbon", brugge:"club brugge",
  bodoeglimt:"bodoe glimt", slovanbratislava:"slovan bratislava",
};
export function normalizeUclStrengthClub(name:string) {
  const key=normalizeUclEloClub(name.replace(/ø/g,"oe").replace(/Ø/g,"Oe"));
  return ({"rb salzburg":"salzburg","red bull salzburg":"salzburg","sk sturm graz":"sturm graz","bayern munchen":"bayern"} as Record<string,string>)[key]??key;
}
/** ClubElo source slugs disambiguate short names (e.g. Slovan versus Liberec).
 * Unknown historical clubs stay explicit cohort priors; required current clubs
 * cannot silently receive a fabricated/stale rating. */
export function buildUclCurrentStrengthPrior(source:UclOfficialStrength,teamNames:ReadonlyMap<number,string>,required:readonly number[]):UclCurrentStrengthPrior {
  const clubs=new Map<string,number>();
  const occurrences=new Map<string,number>();
  for(const c of source.clubs){const key=normalizeUclStrengthClub(c.name);occurrences.set(key,(occurrences.get(key)??0)+1);}
  for(const c of source.clubs){const name=normalizeUclStrengthClub(c.name);
    const key=sourceSlugs[c.slug.toLowerCase()]??(occurrences.get(name)===1?name:normalizeUclStrengthClub(c.slug)), prior=clubs.get(key);
    if(prior!==undefined&&prior!==c.elo)throw Error(`Conflicting current UCL strength identity ${key}`);
    clubs.set(key,c.elo);}
  const ratings=new Map<number,number>();
  for(const [id,name] of teamNames){const value=clubs.get(normalizeUclStrengthClub(name));if(value!==undefined)ratings.set(id,value);}
  for(const id of required)if(!ratings.has(id))throw Error(`Current UCL strength source missing exact club ${teamNames.get(id)??id}`);
  const {release,sourceUrl,asOfDay,capturedAt,sourceHash}=source;
  return {release:UCL_CURRENT_STRENGTH_PRIOR_RELEASE,coefficientPer400:UCL_STRENGTH_SCORE_COEFFICIENT,
    source:{release,sourceUrl,asOfDay,capturedAt,sourceHash},ratings};
}
