/**
 * Canonical WNBA team map — 2026-06-23.
 *
 * The single source of truth that maps a BallDontLie team id → canonical
 * abbreviation, display name, and ESPN logo URL. Built by matching BDL's
 * `/wnba/v1/teams` to ESPN's WNBA teams endpoint (15/15 real franchises
 * matched exactly; BDL abbreviations equal ESPN abbreviations). This is the
 * mapping the hard UI requirement demands: card logos/colors keyed by BDL id
 * → canonical abbrev → asset, NEVER fragile team-name text.
 *
 * Only the 15 real franchises live here. BDL also returns All-Star squads
 * (Team Wilson/Collier/etc.), national exhibition teams (Brazil/Japan), and
 * TBD placeholders — none have a canonical abbr, so any game involving them
 * resolves to null here and is dropped from the WNBA slate (correct: those
 * are not Daily Edge games).
 *
 * Includes the 2025 expansion Golden State Valkyries (GS) and the 2026
 * expansion Portland (POR) + Toronto (TOR) clubs — all three confirmed to
 * have ESPN logos + colors.
 */

export type WnbaTeamMeta = {
  /** Canonical abbreviation (ESPN === BDL form). */
  abbr: string;
  /** Member-facing full club name. */
  name: string;
};

/** BDL team id → canonical metadata. The authoritative key is the BDL id. */
export const WNBA_TEAMS_BY_BDL_ID: Record<number, WnbaTeamMeta> = {
  1:  { abbr: "NY",  name: "New York Liberty" },
  2:  { abbr: "CON", name: "Connecticut Sun" },
  3:  { abbr: "IND", name: "Indiana Fever" },
  4:  { abbr: "ATL", name: "Atlanta Dream" },
  5:  { abbr: "WSH", name: "Washington Mystics" },
  6:  { abbr: "CHI", name: "Chicago Sky" },
  7:  { abbr: "MIN", name: "Minnesota Lynx" },
  8:  { abbr: "LV",  name: "Las Vegas Aces" },
  9:  { abbr: "SEA", name: "Seattle Storm" },
  10: { abbr: "PHX", name: "Phoenix Mercury" },
  11: { abbr: "DAL", name: "Dallas Wings" },
  12: { abbr: "LA",  name: "Los Angeles Sparks" },
  13: { abbr: "GS",  name: "Golden State Valkyries" },
  30: { abbr: "TOR", name: "Toronto Tempo" },
  31: { abbr: "POR", name: "Portland Fire" },
};

/** True for real franchises only (drops All-Star / national / TBD squads). */
export function isRealWnbaTeam(bdlId: number): boolean {
  return bdlId in WNBA_TEAMS_BY_BDL_ID;
}

export function wnbaAbbr(bdlId: number): string | null {
  return WNBA_TEAMS_BY_BDL_ID[bdlId]?.abbr ?? null;
}

export type WnbaMoneylineSide = "home" | "away";

function normalizeTeamIdentity(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizedTeamAliases(abbr: string): Set<string> {
  const normalizedAbbr = abbr.trim().toUpperCase();
  const meta = Object.values(WNBA_TEAMS_BY_BDL_ID).find(
    (team) => team.abbr === normalizedAbbr,
  );
  const aliases = new Set<string>([normalizeTeamIdentity(normalizedAbbr)]);
  if (!meta) return aliases;

  const fullName = meta.name.trim();
  aliases.add(normalizeTeamIdentity(fullName));
  const words = fullName.split(/\s+/);
  const nickname = words.at(-1);
  if (nickname) aliases.add(normalizeTeamIdentity(nickname));
  if (words.length > 1) aliases.add(normalizeTeamIdentity(words.slice(0, -1).join(" ")));
  return aliases;
}

/** Resolve provider/model club labels through canonical WNBA identities. */
export function resolveWnbaMoneylineSide(
  side: string | null | undefined,
  homeAbbr: string,
  awayAbbr: string,
): WnbaMoneylineSide | null {
  if (!side) return null;
  const normalizedSide = normalizeTeamIdentity(side);
  const homeMatch = normalizedTeamAliases(homeAbbr).has(normalizedSide);
  const awayMatch = normalizedTeamAliases(awayAbbr).has(normalizedSide);
  if (homeMatch === awayMatch) return null;
  return homeMatch ? "home" : "away";
}

/** ESPN WNBA logo CDN — keyed by lowercase canonical abbreviation. */
export function wnbaLogoUrl(abbr: string): string {
  return `https://a.espncdn.com/i/teamlogos/wnba/500/${abbr.toLowerCase()}.png`;
}
