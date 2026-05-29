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
  | "ARI" | "ATL" | "BAL" | "BOS" | "CHC" | "CWS" | "CIN" | "CLE" | "COL"
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
  // OAK
  "oakland athletics": "OAK",
  "athletics": "OAK",
  "oakland": "OAK",
  "oak": "OAK",
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
