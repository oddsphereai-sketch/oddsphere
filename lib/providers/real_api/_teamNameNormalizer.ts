/**
 * MLB team name normalizer.
 *
 * Used by SharpAPI providers to resolve SharpAPI's team strings (full names,
 * city + nickname, sometimes nickname alone) to the 3-letter abbreviations
 * already stored in the `teams.abbreviation` column. Once resolved, callers
 * use the abbreviation to find the BDL `external_id` for the same game.
 *
 * V1 strategy: hard-coded lookup table. Zero DB round-trips at provider
 * construction; deterministic; covers every observed variant from Gate A
 * probe samples plus common synonyms. If SharpAPI introduces a new variant,
 * `normalizeMlbTeamName` returns null and the caller logs + skips the
 * event — no silent matching of the wrong team.
 *
 * Ambiguity guard: "NY" alone is NOT mapped (could be Yankees or Mets).
 * Callers must pass the full team string SharpAPI returned.
 */

export type MlbTeamAbbrev =
  | "ARI" | "ATH" | "ATL" | "BAL" | "BOS" | "CHC" | "CWS" | "CIN" | "CLE" | "COL"
  | "DET" | "HOU" | "KC"  | "LAA" | "LAD" | "MIA" | "MIL" | "MIN" | "NYM"
  | "NYY" | "OAK" | "PHI" | "PIT" | "SD"  | "SEA" | "SF"  | "STL" | "TB"
  | "TEX" | "TOR" | "WSH";

/**
 * Variants → canonical abbreviation. All keys lowercased + trimmed at
 * lookup time. Multiple keys mapping to the same abbreviation are
 * intentional — operator-observed variants from Gate A samples + common
 * synonyms (full name, nickname-only, city-only where unambiguous, the
 * abbreviation itself for round-trip safety).
 */
const TEAM_VARIANTS: Record<string, MlbTeamAbbrev> = {
  // ARI
  "arizona diamondbacks": "ARI",
  "diamondbacks": "ARI",
  "arizona": "ARI",
  "ari": "ARI",
  // ATL
  "atlanta braves": "ATL",
  "braves": "ATL",
  "atlanta": "ATL",
  "atl": "ATL",
  // BAL
  "baltimore orioles": "BAL",
  "orioles": "BAL",
  "baltimore": "BAL",
  "bal": "BAL",
  // BOS
  "boston red sox": "BOS",
  "red sox": "BOS",
  "boston": "BOS",
  "bos": "BOS",
  // CHC
  "chicago cubs": "CHC",
  "cubs": "CHC",
  "chc": "CHC",
  // CWS
  "chicago white sox": "CWS",
  "white sox": "CWS",
  "cws": "CWS",
  "chw": "CWS",
  // CIN
  "cincinnati reds": "CIN",
  "reds": "CIN",
  "cincinnati": "CIN",
  "cin": "CIN",
  // CLE
  "cleveland guardians": "CLE",
  "guardians": "CLE",
  "cleveland": "CLE",
  "cle": "CLE",
  // COL
  "colorado rockies": "COL",
  "rockies": "COL",
  "colorado": "COL",
  "col": "COL",
  // DET
  "detroit tigers": "DET",
  "tigers": "DET",
  "detroit": "DET",
  "det": "DET",
  // HOU
  "houston astros": "HOU",
  "astros": "HOU",
  "houston": "HOU",
  "hou": "HOU",
  // KC
  "kansas city royals": "KC",
  "royals": "KC",
  "kansas city": "KC",
  "kc": "KC",
  "kcr": "KC",
  // LAA
  "los angeles angels": "LAA",
  "angels": "LAA",
  "la angels": "LAA",
  "laa": "LAA",
  "ana": "LAA",
  // LAD
  "los angeles dodgers": "LAD",
  "dodgers": "LAD",
  "la dodgers": "LAD",
  "lad": "LAD",
  // MIA
  "miami marlins": "MIA",
  "marlins": "MIA",
  "miami": "MIA",
  "mia": "MIA",
  "fla": "MIA",
  // MIL
  "milwaukee brewers": "MIL",
  "brewers": "MIL",
  "milwaukee": "MIL",
  "mil": "MIL",
  // MIN
  "minnesota twins": "MIN",
  "twins": "MIN",
  "minnesota": "MIN",
  "min": "MIN",
  // NYM
  "new york mets": "NYM",
  "ny mets": "NYM",
  "mets": "NYM",
  "nym": "NYM",
  // NYY
  "new york yankees": "NYY",
  "ny yankees": "NYY",
  "yankees": "NYY",
  "nyy": "NYY",
  // Athletics — post-2025 franchise relocation. Our teams table uses the
  // new abbreviation `ATH`; SharpAPI continues to emit "Athletics" and
  // "Oakland Athletics" as the away/home team strings on 2026 events.
  //
  // Phase 4.2.C.1.R-16C (fix): every "Athletics" / "Oakland" / variant
  // now normalizes to ATH so the SharpAPI event matcher can resolve
  // these games to our `games` row. Pre-R-16C, "Athletics" → "OAK"
  // caused 100% of Athletics-game market data (lines + sharp_signals)
  // to be silently dropped at the resolver step, because the games row
  // is keyed on ATH.
  //
  // `oak` (the bare abbreviation) is kept mapping to ATH too for
  // round-trip safety — any code path holding the legacy abbreviation
  // string now resolves to the same canonical ATH. The MlbTeamAbbrev
  // type retains "OAK" for historical / pre-relocation rows.
  "oakland athletics": "ATH",
  "athletics": "ATH",
  "oakland": "ATH",
  "oak": "ATH",
  "ath": "ATH",
  "athletics (sacramento)": "ATH",
  "athletics (las vegas)": "ATH",
  "sacramento athletics": "ATH",
  "las vegas athletics": "ATH",
  // PHI
  "philadelphia phillies": "PHI",
  "phillies": "PHI",
  "philadelphia": "PHI",
  "phi": "PHI",
  // PIT
  "pittsburgh pirates": "PIT",
  "pirates": "PIT",
  "pittsburgh": "PIT",
  "pit": "PIT",
  // SD
  "san diego padres": "SD",
  "padres": "SD",
  "san diego": "SD",
  "sd": "SD",
  "sdp": "SD",
  // SEA
  "seattle mariners": "SEA",
  "mariners": "SEA",
  "seattle": "SEA",
  "sea": "SEA",
  // SF
  "san francisco giants": "SF",
  "giants": "SF",
  "san francisco": "SF",
  "sf": "SF",
  "sfg": "SF",
  // STL
  "st. louis cardinals": "STL",
  "st louis cardinals": "STL",
  "cardinals": "STL",
  "st. louis": "STL",
  "st louis": "STL",
  "stl": "STL",
  // TB
  "tampa bay rays": "TB",
  "rays": "TB",
  "tampa bay": "TB",
  "tampa": "TB",
  "tb": "TB",
  "tbr": "TB",
  // TEX
  "texas rangers": "TEX",
  "rangers": "TEX",
  "texas": "TEX",
  "tex": "TEX",
  // TOR
  "toronto blue jays": "TOR",
  "blue jays": "TOR",
  "toronto": "TOR",
  "tor": "TOR",
  // WSH
  "washington nationals": "WSH",
  "nationals": "WSH",
  "washington": "WSH",
  "wsh": "WSH",
  "was": "WSH",
};

/**
 * Phase 4.2.C.1.R-15 — static MLB Stats team-id map.
 *
 * MLB Stats team IDs are stable across seasons. Hard-coding here avoids
 * a DB round-trip and decouples bullpen ingestion from the `teams`
 * table's `provider_ids.mlb_stats.id` column (which is currently null
 * for all teams). When that column is backfilled, callers can switch
 * to it — until then, lookups go through this map.
 *
 * `OAK` and `ATH` resolve to the same MLB Stats id (133) — MLB never
 * reissued the franchise's id when the team relocated.
 */
export const MLB_STATS_TEAM_IDS: Record<MlbTeamAbbrev, number> = {
  ARI: 109,
  ATH: 133, // post-relocation Athletics — same MLB Stats id as OAK
  ATL: 144,
  BAL: 110,
  BOS: 111,
  CHC: 112,
  CWS: 145,
  CIN: 113,
  CLE: 114,
  COL: 115,
  DET: 116,
  HOU: 117,
  KC:  118,
  LAA: 108,
  LAD: 119,
  MIA: 146,
  MIL: 158,
  MIN: 142,
  NYM: 121,
  NYY: 147,
  OAK: 133, // legacy abbreviation — same id as ATH
  PHI: 143,
  PIT: 134,
  SD:  135,
  SEA: 136,
  SF:  137,
  STL: 138,
  TB:  139,
  TEX: 140,
  TOR: 141,
  WSH: 120,
};

/**
 * Look up an MLB Stats team id by abbreviation. Returns `null` for an
 * abbreviation outside the 30-team set, including `null`/`undefined`
 * input (callers should log + skip rather than guess).
 */
export function mlbStatsTeamIdFromAbbr(
  abbr: string | null | undefined
): number | null {
  if (typeof abbr !== "string") return null;
  const upper = abbr.trim().toUpperCase();
  if (upper.length === 0) return null;
  return (MLB_STATS_TEAM_IDS as Record<string, number | undefined>)[upper] ?? null;
}

/**
 * Normalize a SharpAPI team string to a 3-letter MLB abbreviation.
 * Returns null when no variant matches — callers should log and skip the
 * event. NEVER returns a "best guess" abbreviation.
 *
 * Examples:
 *   "New York Yankees"  → "NYY"
 *   "Yankees"           → "NYY"
 *   "  yankees  "       → "NYY"
 *   "Tampa Bay Rays"    → "TB"
 *   "Unknown FC"        → null
 *   "NY"                → null   (ambiguous: Yankees or Mets)
 */
export function normalizeMlbTeamName(input: unknown): MlbTeamAbbrev | null {
  if (typeof input !== "string") return null;
  const key = input.trim().toLowerCase();
  if (key.length === 0) return null;
  return TEAM_VARIANTS[key] ?? null;
}
