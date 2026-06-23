// UI presentation lookups for The Lab. Sport-scoped so adding NBA/NFL/NHL
// props later is a data-only change. MLB is the only sport with live data
// today; other sports' metadata is stubbed so the layout is in place.
//
// Phase 5C dropped the SPECS/PLAYERS/PATTERNS/ALL_PROPS/getPropsByType mock
// machinery — entries now come from /api/lab/player-props and the wire-shape
// types live in /app/lab/lib/labTypes.ts. Everything that remains here is
// pure presentation: icons, labels, signal-tag explanations.

// 2026-06-11 — WC-1: added "soccer" mirroring the canonical Sport union
// in lib/types/domain/Sport.ts. Per the broader audit-doc decision, soccer
// is the umbrella key and per-competition (FIFA WC, UCL, leagues) is
// distinguished by a `games.competition` field at the DB layer. Here in
// the lab UI mock-data layer, soccer just needs SPORT_META + PROP_TYPE_META
// entries so the sport selector renders without crashing.
export type Sport = "mlb" | "nba" | "nfl" | "cbb" | "cfb" | "nhl" | "ucl" | "soccer" | "wnba";

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

// Union of every defined prop type string. Stored on PlayerPropDto.propType
// as a string so it can be used across sports without TS gymnastics; meta
// lookup goes through getPropTypeMeta(sport, ...).
export type PropType = MlbPropType | NbaPropType | NflPropType | NhlPropType;

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
  nba: { label: "NBA", icon: "🏀", isLive: true },
  nfl: { label: "NFL", icon: "🏈", isLive: false, comingSoonLabel: "Coming this season" },
  cbb: { label: "CBB", icon: "🏀", isLive: false, comingSoonLabel: "Coming soon" },
  cfb: { label: "CFB", icon: "🏈", isLive: false, comingSoonLabel: "Coming this season" },
  nhl: { label: "NHL", icon: "🏒", isLive: false, comingSoonLabel: "Coming soon" },
  ucl: { label: "UCL", icon: "⚽", isLive: false, comingSoonLabel: "Coming soon" },
  // WC-4 — soccer tab goes live as "World Cup". Internal sport key stays
  // `soccer` (matches the WC-3 TrackedSport contract). All member-facing
  // copy reads "World Cup". Empty-state messaging is sport-specific so the
  // tab renders honestly when no fixtures or no published rows exist yet.
  soccer: { label: "World Cup", icon: "⚽", isLive: true },
  wnba: { label: "WNBA", icon: "🏀", isLive: false, comingSoonLabel: "Coming soon" },
};

type PropTypeMeta = {
  label: string;
  icon: string;
  unit: string;
  isPitcher: boolean; // MLB-only concept; false for non-MLB sports
};

// Keyed by sport so collisions like "assists" can carry different meta.
// Non-MLB sport meta is stubbed for architecture; not rendered live in V1.
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
  // CBB / CFB / UCL / soccer: no player-props surface area in V1. Stubs
  // exist so PROP_TYPE_META[sport] lookups don't crash when these sports
  // appear in the Daily Edge sport selector. WC build adds Daily Edge
  // markets (match_result/total/btts) but no player props at launch.
  cbb: {},
  cfb: {},
  ucl: {},
  soccer: {},
  wnba: {},
};

export function getPropTypeMeta(sport: Sport, propType: string): PropTypeMeta {
  const meta = PROP_TYPE_META[sport]?.[propType];
  if (!meta) {
    // Soft fallback rather than throwing — the DB can return a prop_market
    // we haven't mapped yet (e.g., "batter_rbis"). Caller still renders.
    return {
      label: propType.replace(/_/g, " "),
      icon: "🎯",
      unit: propType.toUpperCase(),
      isPitcher: false,
    };
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
