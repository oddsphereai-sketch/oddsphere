// UI-only mock data for The Lab. Sport-scoped so adding NBA/NFL/NHL props
// later is a data-only change. MLB is the only sport with live data in
// Phase 1; other sports' metadata is stubbed so the architecture is in
// place.

export type Sport = "mlb" | "nba" | "nfl" | "cbb" | "cfb" | "nhl" | "ucl";

// Per-sport prop type unions. Note that "assists" and "points" intentionally
// collide between NBA and NHL — they're disambiguated at runtime by the
// sport context, not by the string alone.
export type MlbPropType =
  | "hits"
  | "home_runs"
  | "total_bases"
  | "strikeouts"
  | "er_allowed";
export type NbaPropType = "points" | "rebounds" | "assists" | "threes" | "pra";
export type NflPropType =
  | "passing_yards"
  | "rushing_yards"
  | "receiving_yards"
  | "receptions"
  | "tds";
export type NhlPropType = "goals" | "assists" | "shots" | "saves" | "points";

// Union of every defined prop type string. Duplicates dedupe naturally.
// Stored on PropEntry.propType as a string so it can be used across sports
// without TS gymnastics; meta lookup goes through getPropTypeMeta(sport, ...).
export type PropType =
  | MlbPropType
  | NbaPropType
  | NflPropType
  | NhlPropType;

export type Signal =
  | "hot"
  | "vs_lhp"
  | "vs_rhp"
  | "wind_out"
  | "wind_in"
  | "park"
  | "cold"
  | "warning"
  | "rest_advantage"
  | "platoon";

export type Player = {
  id: string;
  name: string;
  team: string;
  opponent: string;
  gameTime: string;
  position: string;
};

export type PropEntry = {
  id: string;
  sport: Sport;
  player: Player;
  propType: string;
  line: number;
  side: "over" | "under";
  odds: string;
  hitsLast10: number; // 0..10
  edge: number; // 0.28 = +28%
  signals: Signal[];
  recent10: boolean[]; // length 10
};

export const SPORT_META: Record<
  Sport,
  {
    label: string;
    icon: string;
    isLive: boolean;
    comingSoonLabel?: string;
  }
> = {
  mlb: { label: "MLB", icon: "⚾", isLive: true },
  nba: { label: "NBA", icon: "🏀", isLive: false, comingSoonLabel: "Coming soon" },
  nfl: { label: "NFL", icon: "🏈", isLive: false, comingSoonLabel: "Coming this season" },
  cbb: { label: "CBB", icon: "🏀", isLive: false, comingSoonLabel: "Coming soon" },
  cfb: { label: "CFB", icon: "🏈", isLive: false, comingSoonLabel: "Coming this season" },
  nhl: { label: "NHL", icon: "🏒", isLive: false, comingSoonLabel: "Coming soon" },
  ucl: { label: "UCL", icon: "⚽", isLive: false, comingSoonLabel: "Coming soon" },
};

type PropTypeMeta = {
  label: string;
  icon: string;
  unit: string;
  isPitcher: boolean; // MLB-only concept; false for non-MLB sports
};

// Keyed by sport so collisions like "assists" can carry different meta.
// Non-MLB sport meta is stubbed for architecture; not rendered in Phase 1.
export const PROP_TYPE_META: Record<Sport, Record<string, PropTypeMeta>> = {
  mlb: {
    hits:         { label: "Hits",         icon: "🎯", unit: "Hits", isPitcher: false },
    home_runs:    { label: "Home Runs",    icon: "💥", unit: "HR",   isPitcher: false },
    total_bases:  { label: "Total Bases",  icon: "🏃", unit: "TB",   isPitcher: false },
    strikeouts:   { label: "Strikeouts",   icon: "⚡", unit: "K",    isPitcher: true  },
    er_allowed:   { label: "ER Allowed",   icon: "🛡️", unit: "ER",   isPitcher: true  },
  },
  nba: {
    points:    { label: "Points",          icon: "🔥", unit: "PTS", isPitcher: false },
    rebounds:  { label: "Rebounds",        icon: "📏", unit: "REB", isPitcher: false },
    assists:   { label: "Assists",         icon: "🎯", unit: "AST", isPitcher: false },
    threes:    { label: "3-Pointers Made", icon: "🏀", unit: "3PM", isPitcher: false },
    pra:       { label: "PRA",             icon: "📊", unit: "PRA", isPitcher: false },
  },
  nfl: {
    passing_yards:    { label: "Passing Yards",    icon: "🎯", unit: "PASS YD",  isPitcher: false },
    rushing_yards:    { label: "Rushing Yards",    icon: "💨", unit: "RUSH YD",  isPitcher: false },
    receiving_yards:  { label: "Receiving Yards",  icon: "🏃", unit: "REC YD",   isPitcher: false },
    receptions:       { label: "Receptions",       icon: "🤝", unit: "REC",      isPitcher: false },
    tds:              { label: "Touchdowns",       icon: "💥", unit: "TD",       isPitcher: false },
  },
  nhl: {
    goals:    { label: "Goals",   icon: "🚨", unit: "G",  isPitcher: false },
    assists:  { label: "Assists", icon: "🎯", unit: "A",  isPitcher: false },
    shots:    { label: "Shots",   icon: "🏹", unit: "SOG", isPitcher: false },
    saves:    { label: "Saves",   icon: "🛡️", unit: "SV", isPitcher: false },
    points:   { label: "Points",  icon: "🔥", unit: "P",  isPitcher: false },
  },
  // CBB / CFB / UCL: no player-props surface area in Phase 2B-2. Stubs
  // exist so PROP_TYPE_META[sport] lookups don't crash when these sports
  // appear in the Daily Edge sport selector.
  cbb: {},
  cfb: {},
  ucl: {},
};

export function getPropTypeMeta(sport: Sport, propType: string): PropTypeMeta {
  const meta = PROP_TYPE_META[sport]?.[propType];
  if (!meta) {
    throw new Error(
      `Missing PROP_TYPE_META for ${sport}/${propType}. This is a bug — either the entry's sport/propType is wrong or the meta wasn't registered.`
    );
  }
  return meta;
}

export const SIGNAL_META: Record<
  Signal,
  { icon: string; short: string; explain: string }
> = {
  hot: {
    icon: "🔥",
    short: "Hot streak",
    explain: "Above his season hit rate over the last 10 games.",
  },
  vs_lhp: {
    icon: "💪",
    short: "vs LHP",
    explain: "Strong split vs. left-handed pitching this season.",
  },
  vs_rhp: {
    icon: "🎯",
    short: "vs RHP",
    explain: "Strong split vs. right-handed pitching this season.",
  },
  wind_out: {
    icon: "💨",
    short: "Wind out",
    explain: "Wind blowing out — favors fly-ball power.",
  },
  wind_in: {
    icon: "🌬️",
    short: "Wind in",
    explain: "Wind blowing in — suppresses fly-ball power.",
  },
  park: {
    icon: "🏟️",
    short: "Park",
    explain: "Park factor favors this prop based on venue history.",
  },
  cold: {
    icon: "❄️",
    short: "Cold",
    explain: "Below his season hit rate over the last 10 games.",
  },
  warning: {
    icon: "⚠️",
    short: "Warning",
    explain: "Schedule, travel, or matchup risk worth flagging.",
  },
  rest_advantage: {
    icon: "🛌",
    short: "Rest",
    explain: "Extra rest day — historically a small production bump.",
  },
  platoon: {
    icon: "🔀",
    short: "Platoon",
    explain: "Favorable platoon matchup based on splits.",
  },
};

const PLAYERS: Record<string, Player> = {
  judge:    { id: "judge",    name: "Aaron Judge",          team: "NYY", opponent: "vs BOS",   gameTime: "7:10 PM ET",  position: "RF" },
  soto:     { id: "soto",     name: "Juan Soto",            team: "NYM", opponent: "@ PHI",    gameTime: "7:10 PM ET",  position: "RF" },
  betts:    { id: "betts",    name: "Mookie Betts",         team: "LAD", opponent: "vs SD",    gameTime: "10:10 PM ET", position: "RF" },
  ohtani:   { id: "ohtani",   name: "Shohei Ohtani",        team: "LAD", opponent: "vs SD",    gameTime: "10:10 PM ET", position: "DH" },
  acuna:    { id: "acuna",    name: "Ronald Acuña Jr.",     team: "ATL", opponent: "@ MIA",    gameTime: "7:05 PM ET",  position: "RF" },
  vladdy:   { id: "vladdy",   name: "Vladimir Guerrero Jr.",team: "TOR", opponent: "@ CHW",    gameTime: "8:10 PM ET",  position: "1B" },
  yordan:   { id: "yordan",   name: "Yordan Alvarez",       team: "HOU", opponent: "vs SEA",   gameTime: "8:10 PM ET",  position: "DH" },
  witt:     { id: "witt",     name: "Bobby Witt Jr.",       team: "KC",  opponent: "vs MIN",   gameTime: "8:10 PM ET",  position: "SS" },
  freeman:  { id: "freeman",  name: "Freddie Freeman",      team: "LAD", opponent: "vs SD",    gameTime: "10:10 PM ET", position: "1B" },
  seager:   { id: "seager",   name: "Corey Seager",         team: "TEX", opponent: "vs OAK",   gameTime: "8:05 PM ET",  position: "SS" },
  ragans:   { id: "ragans",   name: "Cole Ragans",          team: "KC",  opponent: "vs MIN",   gameTime: "8:10 PM ET",  position: "SP" },
  wheeler:  { id: "wheeler",  name: "Zack Wheeler",         team: "PHI", opponent: "vs NYM",   gameTime: "7:10 PM ET",  position: "SP" },
  skubal:   { id: "skubal",   name: "Tarik Skubal",         team: "DET", opponent: "@ CLE",    gameTime: "7:10 PM ET",  position: "SP" },
  webb:     { id: "webb",     name: "Logan Webb",           team: "SF",  opponent: "@ COL",    gameTime: "8:40 PM ET",  position: "SP" },
  strider:  { id: "strider",  name: "Spencer Strider",      team: "ATL", opponent: "@ MIA",    gameTime: "7:05 PM ET",  position: "SP" },
  skenes:   { id: "skenes",   name: "Paul Skenes",          team: "PIT", opponent: "vs CIN",   gameTime: "7:05 PM ET",  position: "SP" },
};

const PATTERNS: Record<number, boolean[]> = {
  10: [true, true, true, true, true, true, true, true, true, true],
  9:  [true, true, true, true, false, true, true, true, true, true],
  8:  [false, true, true, true, true, true, false, true, true, true],
  7:  [true, false, true, true, true, false, true, true, false, true],
  6:  [true, true, false, true, false, true, true, false, true, true],
  5:  [true, false, true, false, true, true, false, true, false, true],
  4:  [false, true, false, true, false, true, false, true, false, true],
  3:  [true, false, false, true, false, false, true, false, false, false],
  2:  [false, true, false, false, false, false, true, false, false, false],
  1:  [false, false, false, true, false, false, false, false, false, false],
  0:  [false, false, false, false, false, false, false, false, false, false],
};

function r10(hits: number): boolean[] {
  return PATTERNS[hits] ?? PATTERNS[0];
}

type EntrySpec = {
  sport: Sport;
  player: keyof typeof PLAYERS;
  propType: string;
  line: number;
  side: "over" | "under";
  odds: string;
  hitsLast10: number;
  edge: number;
  signals: Signal[];
};

const SPECS: EntrySpec[] = [
  // HITS — 10 batters
  { sport: "mlb", player: "judge",   propType: "hits", line: 1.5, side: "over", odds: "-120", hitsLast10: 9, edge:  0.32, signals: ["hot", "park", "vs_lhp"] },
  { sport: "mlb", player: "soto",    propType: "hits", line: 1.5, side: "over", odds: "-140", hitsLast10: 8, edge:  0.18, signals: ["hot", "vs_rhp"] },
  { sport: "mlb", player: "ohtani",  propType: "hits", line: 1.5, side: "over", odds: "-130", hitsLast10: 8, edge:  0.14, signals: ["hot", "park"] },
  { sport: "mlb", player: "yordan",  propType: "hits", line: 1.5, side: "over", odds: "-135", hitsLast10: 8, edge:  0.12, signals: ["hot"] },
  { sport: "mlb", player: "betts",   propType: "hits", line: 1.5, side: "over", odds: "-110", hitsLast10: 7, edge:  0.08, signals: ["hot"] },
  { sport: "mlb", player: "witt",    propType: "hits", line: 1.5, side: "over", odds: "-125", hitsLast10: 7, edge:  0.06, signals: ["hot"] },
  { sport: "mlb", player: "vladdy",  propType: "hits", line: 1.5, side: "over", odds: "-110", hitsLast10: 7, edge:  0.04, signals: ["park"] },
  { sport: "mlb", player: "acuna",   propType: "hits", line: 1.5, side: "over", odds: "-120", hitsLast10: 6, edge:  0.02, signals: ["vs_lhp"] },
  { sport: "mlb", player: "freeman", propType: "hits", line: 1.5, side: "over", odds: "-115", hitsLast10: 5, edge: -0.03, signals: [] },
  { sport: "mlb", player: "seager",  propType: "hits", line: 1.5, side: "over", odds: "-130", hitsLast10: 4, edge: -0.12, signals: ["cold", "warning"] },

  // HOME RUNS — 10 batters
  { sport: "mlb", player: "judge",   propType: "home_runs", line: 0.5, side: "over", odds: "+180", hitsLast10: 5, edge:  0.28, signals: ["hot", "park", "wind_out"] },
  { sport: "mlb", player: "ohtani",  propType: "home_runs", line: 0.5, side: "over", odds: "+210", hitsLast10: 4, edge:  0.20, signals: ["park", "wind_out"] },
  { sport: "mlb", player: "yordan",  propType: "home_runs", line: 0.5, side: "over", odds: "+200", hitsLast10: 4, edge:  0.12, signals: ["hot", "park"] },
  { sport: "mlb", player: "vladdy",  propType: "home_runs", line: 0.5, side: "over", odds: "+240", hitsLast10: 3, edge:  0.06, signals: ["park"] },
  { sport: "mlb", player: "acuna",   propType: "home_runs", line: 0.5, side: "over", odds: "+260", hitsLast10: 3, edge:  0.04, signals: ["vs_lhp"] },
  { sport: "mlb", player: "soto",    propType: "home_runs", line: 0.5, side: "over", odds: "+220", hitsLast10: 3, edge:  0.02, signals: ["vs_rhp"] },
  { sport: "mlb", player: "betts",   propType: "home_runs", line: 0.5, side: "over", odds: "+320", hitsLast10: 2, edge: -0.04, signals: [] },
  { sport: "mlb", player: "witt",    propType: "home_runs", line: 0.5, side: "over", odds: "+350", hitsLast10: 2, edge: -0.02, signals: ["hot"] },
  { sport: "mlb", player: "freeman", propType: "home_runs", line: 0.5, side: "over", odds: "+400", hitsLast10: 1, edge: -0.14, signals: ["cold"] },
  { sport: "mlb", player: "seager",  propType: "home_runs", line: 0.5, side: "over", odds: "+280", hitsLast10: 2, edge: -0.08, signals: ["warning"] },

  // TOTAL BASES — 10 batters
  { sport: "mlb", player: "judge",   propType: "total_bases", line: 1.5, side: "over", odds: "-125", hitsLast10: 9, edge:  0.26, signals: ["hot", "park", "wind_out"] },
  { sport: "mlb", player: "ohtani",  propType: "total_bases", line: 1.5, side: "over", odds: "-130", hitsLast10: 8, edge:  0.16, signals: ["hot", "park"] },
  { sport: "mlb", player: "soto",    propType: "total_bases", line: 1.5, side: "over", odds: "-135", hitsLast10: 8, edge:  0.14, signals: ["hot", "vs_rhp"] },
  { sport: "mlb", player: "yordan",  propType: "total_bases", line: 1.5, side: "over", odds: "-140", hitsLast10: 8, edge:  0.10, signals: ["hot"] },
  { sport: "mlb", player: "vladdy",  propType: "total_bases", line: 1.5, side: "over", odds: "-115", hitsLast10: 7, edge:  0.06, signals: ["park"] },
  { sport: "mlb", player: "witt",    propType: "total_bases", line: 1.5, side: "over", odds: "-110", hitsLast10: 6, edge:  0.04, signals: ["hot"] },
  { sport: "mlb", player: "acuna",   propType: "total_bases", line: 1.5, side: "over", odds: "-120", hitsLast10: 6, edge:  0.02, signals: ["vs_lhp"] },
  { sport: "mlb", player: "betts",   propType: "total_bases", line: 1.5, side: "over", odds: "-105", hitsLast10: 5, edge: -0.02, signals: [] },
  { sport: "mlb", player: "freeman", propType: "total_bases", line: 1.5, side: "over", odds: "-125", hitsLast10: 4, edge: -0.08, signals: ["cold"] },
  { sport: "mlb", player: "seager",  propType: "total_bases", line: 1.5, side: "over", odds: "-130", hitsLast10: 4, edge: -0.16, signals: ["cold", "warning"] },

  // STRIKEOUTS — 6 pitchers
  { sport: "mlb", player: "skenes",  propType: "strikeouts", line: 7.5, side: "over", odds: "-130", hitsLast10: 9, edge:  0.22, signals: ["hot", "vs_rhp"] },
  { sport: "mlb", player: "ragans",  propType: "strikeouts", line: 6.5, side: "over", odds: "-110", hitsLast10: 8, edge:  0.14, signals: ["hot"] },
  { sport: "mlb", player: "skubal",  propType: "strikeouts", line: 7.5, side: "over", odds: "-120", hitsLast10: 7, edge:  0.10, signals: ["hot"] },
  { sport: "mlb", player: "strider", propType: "strikeouts", line: 8.5, side: "over", odds: "+110", hitsLast10: 6, edge:  0.06, signals: ["rest_advantage"] },
  { sport: "mlb", player: "wheeler", propType: "strikeouts", line: 6.5, side: "over", odds: "+100", hitsLast10: 6, edge:  0.04, signals: [] },
  { sport: "mlb", player: "webb",    propType: "strikeouts", line: 5.5, side: "over", odds: "-115", hitsLast10: 3, edge: -0.14, signals: ["cold", "warning"] },

  // EARNED RUNS ALLOWED — 6 pitchers
  { sport: "mlb", player: "skenes",  propType: "er_allowed", line: 2.5, side: "under", odds: "+115", hitsLast10: 8, edge:  0.16, signals: ["hot", "park"] },
  { sport: "mlb", player: "ragans",  propType: "er_allowed", line: 2.5, side: "under", odds: "+110", hitsLast10: 7, edge:  0.10, signals: ["hot"] },
  { sport: "mlb", player: "skubal",  propType: "er_allowed", line: 2.5, side: "under", odds: "+105", hitsLast10: 7, edge:  0.08, signals: ["hot"] },
  { sport: "mlb", player: "strider", propType: "er_allowed", line: 3.5, side: "under", odds: "-120", hitsLast10: 6, edge:  0.04, signals: [] },
  { sport: "mlb", player: "wheeler", propType: "er_allowed", line: 3.5, side: "under", odds: "-110", hitsLast10: 5, edge:  0.00, signals: [] },
  { sport: "mlb", player: "webb",    propType: "er_allowed", line: 2.5, side: "under", odds: "-120", hitsLast10: 3, edge: -0.18, signals: ["cold", "warning"] },
];

export const ALL_PROPS: PropEntry[] = SPECS.map((s, i) => ({
  id: `${s.sport}-${s.player}-${s.propType}-${i}`,
  sport: s.sport,
  player: PLAYERS[s.player],
  propType: s.propType,
  line: s.line,
  side: s.side,
  odds: s.odds,
  hitsLast10: s.hitsLast10,
  edge: s.edge,
  signals: s.signals,
  recent10: r10(s.hitsLast10),
}));

export function getPropsByType(sport: Sport, propType: string): PropEntry[] {
  return ALL_PROPS.filter((p) => p.sport === sport && p.propType === propType);
}

export function getPropsByPlayer(sport: Sport, playerId: string): PropEntry[] {
  return ALL_PROPS.filter((p) => p.sport === sport && p.player.id === playerId);
}

export function getPropCountForSport(sport: Sport): number {
  return ALL_PROPS.filter((p) => p.sport === sport).length;
}

export function getGlobalStats(sport: Sport) {
  const sportProps = ALL_PROPS.filter((p) => p.sport === sport);
  const games = new Set(
    sportProps.map((p) =>
      [p.player.team, p.player.opponent.replace(/^@\s*|^vs\s*/i, "")]
        .sort()
        .join("-")
    )
  );
  const positiveEdge = sportProps.filter((p) => p.edge > 0.1).length;
  return { games: games.size, props: sportProps.length, positiveEdge };
}
