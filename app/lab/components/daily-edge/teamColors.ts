/**
 * Phase 4.1.8.C-final (B+C Hybrid) — MLB team primary color table.
 *
 * Used by Featured card variants (HeroCard, CautionCard) to render the
 * subtle 3px top-edge gradient that anchors team identity per Daniel's
 * "team-color accent lines only" direction (D3 + Sub-D1).
 *
 * Values are each team's documented primary color (cap / road jersey).
 * Sourced from MLB's official team brand pages and SportsLogos.net
 * reference plates. One primary color per team is enough for the
 * accent line; secondary colors are out of scope for V1.
 *
 * Scope guardrails:
 *   • Pure constant table — no runtime extraction, no API calls, no
 *     dependency.
 *   • Keyed by the team `abbreviation` field used in the DTO (matches
 *     the strings in `awayTeam` / `homeTeam`).
 *   • Fallback color provided for unknown abbreviations.
 *
 * Editing: to adjust a team's color, change its `primary` field and
 * the Featured card top-edge gradient updates on next render.
 */

export type TeamColorEntry = {
  /** Primary brand color (hex), used for the team-color accent line. */
  primary: string;
};

/**
 * Fallback color used when a team abbreviation isn't in the table. Reads
 * as a neutral mid-gray that won't draw attention — if you see this color
 * on the accent line during browser review, an abbreviation is missing
 * from the table below.
 */
export const FALLBACK_TEAM_COLOR = "#4B5563"; // gray-600

export const MLB_TEAM_COLORS: Record<string, TeamColorEntry> = {
  // American League — East
  BAL: { primary: "#DF4601" }, // Orioles Orange
  BOS: { primary: "#BD3039" }, // Red Sox Red
  NYY: { primary: "#0C2340" }, // Yankees Navy
  TB:  { primary: "#092C5C" }, // Rays Navy
  TOR: { primary: "#134A8E" }, // Blue Jays Royal

  // American League — Central
  CWS: { primary: "#27251F" }, // White Sox Black
  CLE: { primary: "#0C2340" }, // Guardians Navy
  DET: { primary: "#0C2340" }, // Tigers Navy
  KC:  { primary: "#004687" }, // Royals Royal
  MIN: { primary: "#002B5C" }, // Twins Navy

  // American League — West
  HOU: { primary: "#002D62" }, // Astros Navy
  LAA: { primary: "#BA0021" }, // Angels Red
  ATH: { primary: "#003831" }, // Athletics Green (post-rebrand abbr)
  OAK: { primary: "#003831" }, // Athletics Green (legacy abbr)
  SEA: { primary: "#0C2C56" }, // Mariners Navy
  TEX: { primary: "#003278" }, // Rangers Blue

  // National League — East
  ATL: { primary: "#CE1141" }, // Braves Scarlet
  MIA: { primary: "#00A3E0" }, // Marlins Blue
  NYM: { primary: "#002D72" }, // Mets Royal Blue
  PHI: { primary: "#E81828" }, // Phillies Red
  WSH: { primary: "#AB0003" }, // Nationals Red

  // National League — Central
  CHC: { primary: "#0E3386" }, // Cubs Blue
  CIN: { primary: "#C6011F" }, // Reds Red
  MIL: { primary: "#12284B" }, // Brewers Navy
  PIT: { primary: "#FDB827" }, // Pirates Yellow
  STL: { primary: "#C41E3A" }, // Cardinals Red

  // National League — West
  ARI: { primary: "#A71930" }, // Diamondbacks Sedona Red
  COL: { primary: "#33006F" }, // Rockies Purple
  LAD: { primary: "#005A9C" }, // Dodgers Blue
  SD:  { primary: "#2F241D" }, // Padres Brown
  SF:  { primary: "#FD5A1E" }, // Giants Orange
};

/**
 * Phase 7F — NBA team primary colors. Same shape + lookup discipline
 * as MLB above. Keyed by ESPN abbreviation (e.g. "NY" for Knicks,
 * "SA" for Spurs). Sport-aware lookup below routes NBA games to this
 * map. MLB callers pass no sport (or sport="mlb") and hit MLB_TEAM_COLORS
 * unchanged — zero MLB regression.
 *
 * Why a separate map vs merging: MLB and NBA share some abbreviations
 * (e.g. "BOS" is Red Sox red in MLB but Celtics green in NBA). A
 * single-map approach would collide. Two maps + sport discriminator
 * keeps each league's brand colors intact.
 */
export const NBA_TEAM_COLORS: Record<string, TeamColorEntry> = {
  ATL: { primary: "#E03A3E" }, BOS: { primary: "#007A33" },
  BKN: { primary: "#000000" }, CHA: { primary: "#1D1160" },
  CHI: { primary: "#CE1141" }, CLE: { primary: "#860038" },
  DAL: { primary: "#00538C" }, DEN: { primary: "#0E2240" },
  DET: { primary: "#C8102E" }, GSW: { primary: "#1D428A" },
  HOU: { primary: "#CE1141" }, IND: { primary: "#002D62" },
  LAC: { primary: "#C8102E" }, LAL: { primary: "#552583" },
  MEM: { primary: "#5D76A9" }, MIA: { primary: "#98002E" },
  MIL: { primary: "#00471B" }, MIN: { primary: "#0C2340" },
  NOP: { primary: "#0C2340" }, NY:  { primary: "#006BB6" },
  NYK: { primary: "#006BB6" }, OKC: { primary: "#007AC1" },
  ORL: { primary: "#0077C0" }, PHI: { primary: "#006BB6" },
  PHX: { primary: "#1D1160" }, POR: { primary: "#E03A3E" },
  SAC: { primary: "#5A2D81" }, SA:  { primary: "#C4CED4" },
  SAS: { primary: "#C4CED4" }, TOR: { primary: "#CE1141" },
  UTA: { primary: "#002B5C" }, WAS: { primary: "#002B5C" },
};

/**
 * Lookup helper with fallback. Pure, deterministic.
 *
 * Phase 7F: optional `sport` discriminator. Default "mlb" keeps the
 * existing MLB call-sites byte-identical (no signature change needed
 * at any MLB caller). NBA callers pass `sport="nba"` to hit the NBA
 * brand map.
 */
export function teamPrimaryColor(
  abbreviation: string | null | undefined,
  sport: "mlb" | "nba" | "nfl" | "nhl" | "cbb" | "cfb" | "ucl" = "mlb",
): string {
  if (!abbreviation) return FALLBACK_TEAM_COLOR;
  if (sport === "nba") {
    return NBA_TEAM_COLORS[abbreviation]?.primary ?? FALLBACK_TEAM_COLOR;
  }
  return MLB_TEAM_COLORS[abbreviation]?.primary ?? FALLBACK_TEAM_COLOR;
}
