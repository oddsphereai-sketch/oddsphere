/**
 * NHL team name normalizer.
 *
 * Maps the wide range of team name strings that NHL data sources emit
 * (full name, nickname, city-only, abbreviation, the SharpAPI variants
 * we observed in the probe: "VGK Golden Knights" / "VGS Golden Knights"
 * / "Vegas Golden Knights" / etc.) to the canonical 3-letter
 * abbreviation we use in `teams.abbreviation` for `sport='nhl'`.
 *
 * Used by:
 *   • SharpAPI NHL line ingest to resolve home_team/away_team strings
 *     to our games row's team_ids.
 *   • MoneyPuck CSV ingest to resolve team column → team_id.
 *   • NHL public API + ESPN scoreboards (which already use canonical
 *     abbreviations, but pass through the normalizer for safety).
 *
 * Ambiguity: there is none in the NHL — every abbreviation is unique
 * across the 32 franchises. The normalizer is therefore safe to apply
 * to any team string from any source.
 */

export type NhlTeamAbbrev =
  | "ANA" | "BOS" | "BUF" | "CGY" | "CAR" | "CHI" | "COL" | "CBJ" | "DAL"
  | "DET" | "EDM" | "FLA" | "LAK" | "MIN" | "MTL" | "NSH" | "NJD" | "NYI"
  | "NYR" | "OTT" | "PHI" | "PIT" | "SJS" | "SEA" | "STL" | "TBL" | "TOR"
  | "UTA" | "VAN" | "VGK" | "WSH" | "WPG";

const TEAM_VARIANTS: Record<string, NhlTeamAbbrev> = {
  // ANA — Anaheim Ducks
  "anaheim ducks": "ANA", "ducks": "ANA", "anaheim": "ANA", "ana": "ANA",
  // BOS — Boston Bruins
  "boston bruins": "BOS", "bruins": "BOS", "boston": "BOS", "bos": "BOS",
  // BUF — Buffalo Sabres
  "buffalo sabres": "BUF", "sabres": "BUF", "buffalo": "BUF", "buf": "BUF",
  // CGY — Calgary Flames
  "calgary flames": "CGY", "flames": "CGY", "calgary": "CGY", "cgy": "CGY",
  // CAR — Carolina Hurricanes
  "carolina hurricanes": "CAR", "hurricanes": "CAR", "canes": "CAR",
  "carolina": "CAR", "car": "CAR",
  // CHI — Chicago Blackhawks
  "chicago blackhawks": "CHI", "blackhawks": "CHI", "chicago": "CHI", "chi": "CHI",
  // COL — Colorado Avalanche
  "colorado avalanche": "COL", "avalanche": "COL", "avs": "COL",
  "colorado": "COL", "col": "COL",
  // CBJ — Columbus Blue Jackets
  "columbus blue jackets": "CBJ", "blue jackets": "CBJ", "jackets": "CBJ",
  "columbus": "CBJ", "cbj": "CBJ",
  // DAL — Dallas Stars
  "dallas stars": "DAL", "stars": "DAL", "dallas": "DAL", "dal": "DAL",
  // DET — Detroit Red Wings
  "detroit red wings": "DET", "red wings": "DET", "detroit": "DET", "det": "DET",
  // EDM — Edmonton Oilers
  "edmonton oilers": "EDM", "oilers": "EDM", "edmonton": "EDM", "edm": "EDM",
  // FLA — Florida Panthers
  "florida panthers": "FLA", "panthers": "FLA", "florida": "FLA",
  "fla": "FLA", "flr": "FLA",
  // LAK — Los Angeles Kings
  "los angeles kings": "LAK", "la kings": "LAK", "kings": "LAK",
  "lak": "LAK", "lak ": "LAK", "lakings": "LAK",
  // MIN — Minnesota Wild
  "minnesota wild": "MIN", "wild": "MIN", "minnesota": "MIN", "min": "MIN",
  // MTL — Montreal Canadiens
  "montreal canadiens": "MTL", "montréal canadiens": "MTL", "canadiens": "MTL",
  "habs": "MTL", "montreal": "MTL", "montréal": "MTL", "mtl": "MTL",
  // NSH — Nashville Predators
  "nashville predators": "NSH", "predators": "NSH", "preds": "NSH",
  "nashville": "NSH", "nsh": "NSH",
  // NJD — New Jersey Devils
  "new jersey devils": "NJD", "devils": "NJD", "new jersey": "NJD",
  "njd": "NJD", "nj": "NJD",
  // NYI — New York Islanders
  "new york islanders": "NYI", "ny islanders": "NYI", "islanders": "NYI",
  "isles": "NYI", "nyi": "NYI",
  // NYR — New York Rangers
  "new york rangers": "NYR", "ny rangers": "NYR", "rangers": "NYR", "nyr": "NYR",
  // OTT — Ottawa Senators
  "ottawa senators": "OTT", "senators": "OTT", "sens": "OTT",
  "ottawa": "OTT", "ott": "OTT",
  // PHI — Philadelphia Flyers
  "philadelphia flyers": "PHI", "flyers": "PHI", "philly": "PHI",
  "philadelphia": "PHI", "phi": "PHI",
  // PIT — Pittsburgh Penguins
  "pittsburgh penguins": "PIT", "penguins": "PIT", "pens": "PIT",
  "pittsburgh": "PIT", "pit": "PIT",
  // SJS — San Jose Sharks
  "san jose sharks": "SJS", "sharks": "SJS", "san jose": "SJS", "sjs": "SJS", "sj": "SJS",
  // SEA — Seattle Kraken
  "seattle kraken": "SEA", "kraken": "SEA", "seattle": "SEA", "sea": "SEA",
  // STL — St. Louis Blues
  "st. louis blues": "STL", "st louis blues": "STL", "blues": "STL",
  "st. louis": "STL", "st louis": "STL", "stl": "STL",
  // TBL — Tampa Bay Lightning
  "tampa bay lightning": "TBL", "lightning": "TBL", "bolts": "TBL",
  "tampa bay": "TBL", "tampa": "TBL", "tbl": "TBL", "tb": "TBL",
  // TOR — Toronto Maple Leafs
  "toronto maple leafs": "TOR", "maple leafs": "TOR", "leafs": "TOR",
  "toronto": "TOR", "tor": "TOR",
  // UTA — Utah Hockey Club (relocated Arizona Coyotes, 2024-25 onward)
  "utah hockey club": "UTA", "utah mammoth": "UTA", "utah": "UTA",
  "uta": "UTA", "uth": "UTA",
  // VAN — Vancouver Canucks
  "vancouver canucks": "VAN", "canucks": "VAN", "vancouver": "VAN", "van": "VAN",
  // VGK — Vegas Golden Knights (all the SharpAPI variants we observed)
  "vegas golden knights": "VGK", "golden knights": "VGK", "vegas": "VGK",
  "vgk": "VGK", "vgs": "VGK",
  "vgk golden knights": "VGK", "vgs golden knights": "VGK",
  "las vegas": "VGK", "las vegas golden knights": "VGK",
  // WSH — Washington Capitals
  "washington capitals": "WSH", "capitals": "WSH", "caps": "WSH",
  "washington": "WSH", "wsh": "WSH", "was": "WSH",
  // WPG — Winnipeg Jets
  "winnipeg jets": "WPG", "jets": "WPG", "winnipeg": "WPG", "wpg": "WPG", "win": "WPG",
};

/**
 * Resolve any team string to the canonical NHL abbreviation, or return
 * null when unknown. Returning null is intentional — the caller logs
 * the unknown variant + skips the row, preserving the "never match
 * the wrong team" guarantee from the MLB normalizer.
 */
export function normalizeNhlTeamName(raw: string | null | undefined): NhlTeamAbbrev | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key === "") return null;
  return TEAM_VARIANTS[key] ?? null;
}

/** Test-only helper. Exposes the variants table for assertions. */
export const NHL_TEAM_NORMALIZER_INTERNALS = { TEAM_VARIANTS };
