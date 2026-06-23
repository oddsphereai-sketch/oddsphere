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
/**
 * NHL primary brand colors — Phase 7L. All 32 franchises keyed by the
 * canonical 3-letter abbreviation we store in `teams.abbreviation` for
 * sport='nhl' (matches the SharpAPI / NHL API / MoneyPuck normalized
 * form). Values are documented primary jersey/logo colors.
 */
export const NHL_TEAM_COLORS: Record<string, TeamColorEntry> = {
  ANA: { primary: "#F47A38" }, BOS: { primary: "#FFB81C" },
  BUF: { primary: "#002654" }, CGY: { primary: "#C8102E" },
  CAR: { primary: "#CC0000" }, CHI: { primary: "#CF0A2C" },
  COL: { primary: "#6F263D" }, CBJ: { primary: "#002654" },
  DAL: { primary: "#006847" }, DET: { primary: "#CE1126" },
  EDM: { primary: "#041E42" }, FLA: { primary: "#041E42" },
  LAK: { primary: "#111111" }, MIN: { primary: "#154734" },
  MTL: { primary: "#AF1E2D" }, NSH: { primary: "#FFB81C" },
  NJD: { primary: "#CE1126" }, NYI: { primary: "#00539B" },
  NYR: { primary: "#0038A8" }, OTT: { primary: "#C52032" },
  PHI: { primary: "#F74902" }, PIT: { primary: "#FCB514" },
  SJS: { primary: "#006D75" }, SEA: { primary: "#001628" },
  STL: { primary: "#002F87" }, TBL: { primary: "#002868" },
  TOR: { primary: "#00205B" }, UTA: { primary: "#71AFE5" },
  VAN: { primary: "#00205B" }, VGK: { primary: "#B4975A" },
  WSH: { primary: "#C8102E" }, WPG: { primary: "#041E42" },
};

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
 * WC-4 Phase G — country / national-team primary display colors. Keyed
 * by FIFA / ISO alpha-3 country codes (matches `teams.abbreviation`
 * for sport='soccer').
 *
 * What this map represents: the single hex color we use for the card
 * top-edge accent. The chosen hue prioritizes safe visual recognition
 * for the customer — most entries match the national team's home-kit
 * color or the dominant flag field; a few (notably KOR=red, AUS=green)
 * intentionally use the kit/identity color over the most-pixels-on-the-
 * flag color because that's what the customer associates with the
 * national team. This is NOT a strict "biggest band of the flag" lookup.
 *
 * Why a static map: country identity colors are public, stable, and
 * small. Pure constant lookup keeps the same pattern as MLB/NBA/NHL —
 * no I/O, no DB seeding, no licensing concerns.
 *
 * Coverage: 45 of the most likely 2026 FIFA World Cup participants plus
 * the 4 confirmed friendlies we ship tonight (CZE, KOR, MEX, RSA).
 * Unknown codes fall back to FALLBACK_TEAM_COLOR.
 */
export const SOCCER_TEAM_COLORS: Record<string, TeamColorEntry> = {
  // ── 2026-06-11 confirmed (tonight's slate) ──
  MEX: { primary: "#006847" }, // Mexico — flag green
  RSA: { primary: "#007749" }, // South Africa — flag green
  CZE: { primary: "#D7141A" }, // Czechia — flag red
  KOR: { primary: "#CD2E3A" }, // South Korea — flag red (Taegukgi)

  // ── 2026-06-12 confirmed (tomorrow's slate) ──
  BIH: { primary: "#002F6C" }, // Bosnia & Herzegovina — flag blue

  // ── Hosts ──
  USA: { primary: "#3C3B6E" }, // USA — flag navy
  CAN: { primary: "#FF0000" }, // Canada — flag red

  // ── Major European participants ──
  ENG: { primary: "#CE1124" }, // England — St. George's red
  FRA: { primary: "#0055A4" }, // France — flag blue
  GER: { primary: "#DD0000" }, // Germany — flag red
  ESP: { primary: "#C60B1E" }, // Spain — flag red
  ITA: { primary: "#009246" }, // Italy — flag green
  POR: { primary: "#FF0000" }, // Portugal — flag red
  NED: { primary: "#FF9B00" }, // Netherlands — Oranje
  BEL: { primary: "#EF3340" }, // Belgium — flag red
  POL: { primary: "#DC143C" }, // Poland — flag red
  DEN: { primary: "#C8102E" }, // Denmark — flag red
  SUI: { primary: "#FF0000" }, // Switzerland — flag red
  CRO: { primary: "#FF0000" }, // Croatia — flag red
  SRB: { primary: "#C6363C" }, // Serbia — flag red
  AUT: { primary: "#ED2939" }, // Austria — flag red
  SWE: { primary: "#005293" }, // Sweden — flag blue
  NOR: { primary: "#BA0C2F" }, // Norway — flag red
  HUN: { primary: "#CE2939" }, // Hungary — flag red
  TUR: { primary: "#E30A17" }, // Turkey — flag red
  SCO: { primary: "#0065BD" }, // Scotland — flag blue
  WAL: { primary: "#D30731" }, // Wales — flag red
  UKR: { primary: "#0057B7" }, // Ukraine — flag blue

  // ── South America ──
  BRA: { primary: "#009C3B" }, // Brazil — flag green
  ARG: { primary: "#74ACDF" }, // Argentina — flag light blue
  URU: { primary: "#0093DD" }, // Uruguay — flag blue
  COL: { primary: "#FCD116" }, // Colombia — flag yellow
  ECU: { primary: "#FFD100" }, // Ecuador — flag yellow
  PER: { primary: "#D91023" }, // Peru — flag red
  PAR: { primary: "#DC241F" }, // Paraguay — flag red
  VEN: { primary: "#FFE600" }, // Venezuela — flag yellow

  // ── CONCACAF (other) ──
  CRC: { primary: "#CE1126" }, // Costa Rica — flag red
  PAN: { primary: "#DA121A" }, // Panama — flag red

  // ── Africa ──
  GHA: { primary: "#CE1126" }, // Ghana — flag red
  SEN: { primary: "#00853F" }, // Senegal — flag green
  NGA: { primary: "#008751" }, // Nigeria — flag green
  MAR: { primary: "#C1272D" }, // Morocco — flag red
  TUN: { primary: "#E70013" }, // Tunisia — flag red
  EGY: { primary: "#CE1126" }, // Egypt — flag red

  // ── Asia / Oceania / Middle East ──
  JPN: { primary: "#BC002D" }, // Japan — flag red disc
  AUS: { primary: "#00843D" }, // Australia — gold/green; using flag-aligned green
  IRN: { primary: "#239F40" }, // Iran — flag green
  QAT: { primary: "#8B1A2B" }, // Qatar — flag maroon
  UAE: { primary: "#00732F" }, // UAE — flag green
  FIJ: { primary: "#69BCE5" }, // Fiji — sky blue (Pacific qualifier)
};

/**
 * WNBA team primary colors — 2026-06-23. All 15 franchises keyed by the
 * canonical abbreviation (ESPN === BDL form, see lib/services/wnba/wnbaTeams.ts).
 * Values start from ESPN's official `color` but a few are swapped to the more
 * saturated/recognizable brand color so the dark-UI accent line never reads as
 * washed-out/blank (the gate explicitly forbids near-white accents): ESPN ships
 * POR/LV/GS as near-white primaries, so those use the club's identity hue.
 * Includes 2025 expansion GS (Valkyries) + 2026 expansion POR/TOR.
 */
export const WNBA_TEAM_COLORS: Record<string, TeamColorEntry> = {
  ATL: { primary: "#E31837" }, // Dream — red
  CHI: { primary: "#418FDE" }, // Sky — sky blue
  CON: { primary: "#F05023" }, // Sun — orange
  DAL: { primary: "#0C2340" }, // Wings — navy
  GS:  { primary: "#5B2D8E" }, // Valkyries — Bay violet (ESPN primary is near-white)
  IND: { primary: "#002D62" }, // Fever — navy
  LA:  { primary: "#552583" }, // Sparks — purple
  LV:  { primary: "#BA0C2F" }, // Aces — red (ESPN primary is silver)
  MIN: { primary: "#266092" }, // Lynx — blue
  NY:  { primary: "#86CEBC" }, // Liberty — seafoam (their real identity color)
  PHX: { primary: "#3C286E" }, // Mercury — purple
  POR: { primary: "#E03A3E" }, // Fire — flame red (ESPN primary is near-white)
  SEA: { primary: "#2C5235" }, // Storm — green
  TOR: { primary: "#33476D" }, // Tempo — navy
  WSH: { primary: "#E03A3E" }, // Mystics — red
};

/**
 * Lookup helper with fallback. Pure, deterministic.
 *
 * Phase 7F: optional `sport` discriminator. Default "mlb" keeps the
 * existing MLB call-sites byte-identical (no signature change needed
 * at any MLB caller). NBA callers pass `sport="nba"` to hit the NBA
 * brand map. WC-4 Phase G: soccer callers pass `sport="soccer"` to
 * hit the SOCCER_TEAM_COLORS map.
 */
export function teamPrimaryColor(
  abbreviation: string | null | undefined,
  sport: "mlb" | "nba" | "nfl" | "nhl" | "cbb" | "cfb" | "ucl" | "soccer" | "wnba" = "mlb",
): string {
  if (!abbreviation) return FALLBACK_TEAM_COLOR;
  if (sport === "wnba") {
    return WNBA_TEAM_COLORS[abbreviation]?.primary ?? FALLBACK_TEAM_COLOR;
  }
  if (sport === "nba") {
    return NBA_TEAM_COLORS[abbreviation]?.primary ?? FALLBACK_TEAM_COLOR;
  }
  if (sport === "nhl") {
    return NHL_TEAM_COLORS[abbreviation]?.primary ?? FALLBACK_TEAM_COLOR;
  }
  if (sport === "soccer" || sport === "ucl") {
    return SOCCER_TEAM_COLORS[abbreviation]?.primary ?? FALLBACK_TEAM_COLOR;
  }
  return MLB_TEAM_COLORS[abbreviation]?.primary ?? FALLBACK_TEAM_COLOR;
}
