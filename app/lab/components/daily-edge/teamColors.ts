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

/** Lookup helper with fallback. Pure, deterministic. */
export function teamPrimaryColor(abbreviation: string | null | undefined): string {
  if (!abbreviation) return FALLBACK_TEAM_COLOR;
  return MLB_TEAM_COLORS[abbreviation]?.primary ?? FALLBACK_TEAM_COLOR;
}
