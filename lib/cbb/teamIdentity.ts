import { canonicalCbbTeamName } from "./dataset";
import type { CbbTeam } from "./types";

/** ESPN's public men's college basketball team catalog, not a betting or roster feed. */
export type EspnCbbTeam = {
  id: string;
  displayName: string;
  abbreviation?: string;
  logos?: Array<{ href?: string }>;
};

export type CbbTeamIdentity = {
  bdlTeamId: number;
  bdlName: string;
  bdlAbbreviation: string;
  espnTeamId: string | null;
  espnAbbreviation: string | null;
  logoUrl: string | null;
  status: "verified_exact_name" | "unverified" | "ambiguous";
};

/** Never use an abbreviation as an identity key: CBB abbreviations collide across schools. */
export function resolveCbbTeamIdentities(bdlTeams: CbbTeam[], espnTeams: EspnCbbTeam[]) {
  const byName = new Map<string, EspnCbbTeam[]>();
  for (const team of espnTeams) {
    if (!/^\d+$/.test(team.id) || !team.displayName) continue;
    const name = canonicalCbbTeamName(team.displayName);
    byName.set(name, [...(byName.get(name) ?? []), team]);
  }
  const out = new Map<number, CbbTeamIdentity>();
  for (const team of bdlTeams) {
    if (out.has(team.id)) throw new Error(`duplicate BDL CBB team ID ${team.id}`);
    const matches = byName.get(canonicalCbbTeamName(team.full_name)) ?? [];
    const match = matches.length === 1 ? matches[0] : null;
    const logo = match?.logos?.find(item => typeof item.href === "string" &&
      /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/ncaa\//.test(item.href))?.href ?? null;
    out.set(team.id, {
      bdlTeamId: team.id, bdlName: team.full_name, bdlAbbreviation: team.abbreviation,
      espnTeamId: match?.id ?? null, espnAbbreviation: match?.abbreviation ?? null,
      logoUrl: logo, status: matches.length > 1 ? "ambiguous" : match ? "verified_exact_name" : "unverified",
    });
  }
  return out;
}
