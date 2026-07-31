export type MlbTeamAlias = {
  id: string;
  abbreviation: string;
  name: string;
  aliases: string[];
};

const TEAM_ALIASES: MlbTeamAlias[] = [
  team("ari", "ARI", "Arizona Diamondbacks", ["arizona", "diamondbacks", "dbacks", "d backs", "az"]),
  team("ath", "ATH", "Athletics", ["athletics", "oakland athletics", "a's", "as", "oak", "oakland", "sacramento athletics"]),
  team("atl", "ATL", "Atlanta Braves", ["atlanta", "braves"]),
  team("bal", "BAL", "Baltimore Orioles", ["baltimore", "orioles", "os", "o's"]),
  team("bos", "BOS", "Boston Red Sox", ["boston", "red sox", "redsox"]),
  team("chc", "CHC", "Chicago Cubs", ["cubs", "chicago cubs"]),
  team("chw", "CWS", "Chicago White Sox", ["white sox", "whitesox", "chicago white sox", "cws", "chw"]),
  team("cin", "CIN", "Cincinnati Reds", ["cincinnati", "reds"]),
  team("cle", "CLE", "Cleveland Guardians", ["cleveland", "guardians"]),
  team("col", "COL", "Colorado Rockies", ["colorado", "rockies"]),
  team("det", "DET", "Detroit Tigers", ["detroit", "tigers"]),
  team("hou", "HOU", "Houston Astros", ["houston", "astros"]),
  team("kc", "KC", "Kansas City Royals", ["kansas city", "royals", "kcr"]),
  team("laa", "LAA", "Los Angeles Angels", ["angels", "los angeles angels", "la angels", "anaheim angels"]),
  team("lad", "LAD", "Los Angeles Dodgers", ["dodgers", "los angeles dodgers", "la dodgers"]),
  team("mia", "MIA", "Miami Marlins", ["miami", "marlins"]),
  team("mil", "MIL", "Milwaukee Brewers", ["milwaukee", "brewers"]),
  team("min", "MIN", "Minnesota Twins", ["minnesota", "twins"]),
  team("nym", "NYM", "New York Mets", ["mets", "ny mets", "new york mets"]),
  team("nyy", "NYY", "New York Yankees", ["yankees", "ny yankees", "new york yankees"]),
  team("phi", "PHI", "Philadelphia Phillies", ["philadelphia", "phillies"]),
  team("pit", "PIT", "Pittsburgh Pirates", ["pittsburgh", "pirates"]),
  team("sd", "SD", "San Diego Padres", ["san diego", "padres"]),
  team("sea", "SEA", "Seattle Mariners", ["seattle", "mariners"]),
  team("sf", "SF", "San Francisco Giants", ["san francisco", "giants", "sfg"]),
  team("stl", "STL", "St. Louis Cardinals", ["st louis", "st. louis", "cardinals", "cards"]),
  team("tb", "TB", "Tampa Bay Rays", ["tampa bay", "rays", "tampa"]),
  team("tex", "TEX", "Texas Rangers", ["texas", "rangers"]),
  team("tor", "TOR", "Toronto Blue Jays", ["toronto", "blue jays", "bluejays", "jays"]),
  team("wsh", "WSH", "Washington Nationals", ["washington", "nationals", "nats", "was"]),
];

const ALIAS_LOOKUP = new Map<string, MlbTeamAlias>();
const MLB_STATS_TEAM_ID_TO_ALIAS: Record<string, string> = {
  "108": "laa",
  "109": "ari",
  "110": "bal",
  "111": "bos",
  "112": "chc",
  "113": "cin",
  "114": "cle",
  "115": "col",
  "116": "det",
  "117": "hou",
  "118": "kc",
  "119": "lad",
  "120": "wsh",
  "121": "nym",
  "133": "ath",
  "134": "pit",
  "135": "sd",
  "136": "sea",
  "137": "sf",
  "138": "stl",
  "139": "tb",
  "140": "tex",
  "141": "tor",
  "142": "min",
  "143": "phi",
  "144": "atl",
  "145": "chw",
  "146": "mia",
  "147": "nyy",
  "158": "mil",
};
for (const entry of TEAM_ALIASES) {
  for (const value of [entry.id, entry.abbreviation, entry.name, ...entry.aliases]) {
    ALIAS_LOOKUP.set(normalizeMlbTeamName(value), entry);
  }
}

function team(id: string, abbreviation: string, name: string, aliases: string[]): MlbTeamAlias {
  return { id, abbreviation, name, aliases };
}

export function normalizeMlbTeamName(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

export function resolveMlbTeamAlias(value: string | null | undefined): MlbTeamAlias | null {
  const normalized = normalizeMlbTeamName(value);
  if (!normalized) return null;
  return ALIAS_LOOKUP.get(normalized) ?? null;
}

export function resolveMlbStatsTeamId(teamId: string | number | null | undefined): MlbTeamAlias | null {
  const raw = String(teamId ?? "").replace(/^mlbstats-team-/, "");
  const canonical = MLB_STATS_TEAM_ID_TO_ALIAS[raw];
  return canonical ? resolveMlbTeamAlias(canonical) : null;
}

export function mlbTeamAliases(): MlbTeamAlias[] {
  return TEAM_ALIASES.map((entry) => ({ ...entry, aliases: [...entry.aliases] }));
}
