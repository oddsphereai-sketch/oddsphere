/**
 * Leakage-safe NBA pregame feature construction from finalized historical rows.
 *
 * Every output row is emitted before that game's outcome updates team state.
 * The accompanying test mutates a target and proves that its own features do
 * not change while later games do.
 */

export const NBA_POINT_IN_TIME_FEATURE_RELEASE =
  "nba_point_in_time_features_2026_10_15_r11_invalid_odds_quarantine" as const;

export type NbaHistoricalGame = {
  gameId: number;
  season: number;
  startTime: string;
  homeTeamId: number;
  awayTeamId: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
};

export type NbaHistoricalPlayerBox = {
  rowId: number;
  gameId: number;
  teamId: number;
  playerId: number;
  minutes: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  pf: number;
  points: number;
  plusMinus: number;
};

export type NbaHistoricalPlayerAdvanced = {
  rowId: number;
  gameId: number;
  teamId: number;
  playerId: number;
  period: number;
  possessions: number | null;
  estimatedNetRating: number | null;
  usagePercentage: number | null;
  pointsPaint: number | null;
  pointsFastBreak: number | null;
  pointsSecondChance: number | null;
  pointsOffTurnovers: number | null;
  passes: number | null;
  touches: number | null;
  secondaryAssists: number | null;
  screenAssistPoints: number | null;
  deflections: number | null;
  contestedShots: number | null;
  defendedAtRimFga: number | null;
  defendedAtRimFgm: number | null;
  reboundChancesTotal: number | null;
  distance: number | null;
  speed: number | null;
  playerImpactEstimate?: number | null;
  assistPercentage?: number | null;
  turnoverRatio?: number | null;
  trueShootingPercentage?: number | null;
  threePointAttemptShare?: number | null;
  offensiveReboundPercentage?: number | null;
  defensiveReboundPercentage?: number | null;
  freeThrowAttemptRate?: number | null;
  foulsDrawn?: number | null;
  looseBallsRecovered?: number | null;
  chargesDrawn?: number | null;
  switchesOn?: number | null;
  contestedFgPct?: number | null;
  uncontestedFgPct?: number | null;
  matchupFgPct?: number | null;
  matchupThreePointPct?: number | null;
  screenAssists?: number | null;
  reboundChancesOff?: number | null;
  reboundChancesDef?: number | null;
};

type TeamBox = {
  teamId: number;
  minutes: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  pf: number;
  points: number;
  players: NbaHistoricalPlayerBox[];
};

type TeamObservation = {
  season: number;
  startMs: number;
  offRating: number;
  defRating: number;
  pace: number;
  margin: number;
  efg: number;
  turnoverRate: number;
  offensiveReboundRate: number;
  freeThrowRate: number;
  opponentEfg: number;
  opponentTurnoverRate: number;
  opponentOffensiveReboundRate: number;
  opponentFreeThrowRate: number;
  rotationPlayers: number;
  top3MinutesShare: number;
  top8MinutesShare: number;
  rotationMinutesEntropy: number;
  pointsPaintShare: number | null;
  pointsFastBreakShare: number | null;
  pointsSecondChanceShare: number | null;
  pointsOffTurnoversShare: number | null;
  passesPer100: number | null;
  touchesPer100: number | null;
  secondaryAssistsPer100: number | null;
  screenAssistPointsPer100: number | null;
  deflectionsPer100: number | null;
  contestedShotsPer100: number | null;
  defendedAtRimAttemptsPer100: number | null;
  defendedAtRimFgPct: number | null;
  reboundChancesPer100: number | null;
  rotationEstimatedNetRating: number | null;
  usageWeighted: number | null;
  usageMax: number | null;
  usageConcentration: number | null;
  distancePer48: number | null;
  speedWeighted: number | null;
  playerImpactEstimate: number | null;
  assistPercentage: number | null;
  turnoverRatio: number | null;
  trueShootingPercentage: number | null;
  threePointAttemptShare: number | null;
  offensiveReboundPercentage: number | null;
  defensiveReboundPercentage: number | null;
  freeThrowAttemptRate: number | null;
  foulsDrawnPer100: number | null;
  looseBallsRecoveredPer100: number | null;
  chargesDrawnPer100: number | null;
  switchesOnPer100: number | null;
  contestedFgPct: number | null;
  uncontestedFgPct: number | null;
  matchupFgPct: number | null;
  matchupThreePointPct: number | null;
  screenAssistsPer100: number | null;
  reboundChancesOffPer100: number | null;
  reboundChancesDefPer100: number | null;
  playerMinutes: Record<string, number>;
  venueLatitude: number | null;
  venueLongitude: number | null;
  venueTimeZoneBand: number | null;
  venueAltitudeFeet: number | null;
  isHome: boolean;
};

type AdjustedRating = { offense: number; defense: number };

type EloRating = number;

type PendingOutcome = {
  availableAtMs: number;
  homeTeamId: number;
  awayTeamId: number;
  homeObservation: TeamObservation;
  awayObservation: TeamObservation;
};

const CONSERVATIVE_RESULT_AVAILABILITY_HOURS = 5;
const ELO_INITIAL_RATING = 1500;
const ELO_HOME_ADVANTAGE = 65;
const ELO_K_FACTOR = 20;
const ELO_OFFSEASON_CARRY = 0.75;
const ADJUSTED_RATING_OFFSEASON_CARRY = 0.75;

type NbaVenue = {
  latitude: number;
  longitude: number;
  timeZoneBand: 0 | 1 | 2 | 3;
  altitudeFeet: number;
};

// Time-zone bands are Eastern=0 through Pacific=3. Coordinates are arena
// locations, not team centroids, so travel is measured from the last game's
// venue to the upcoming game's venue for both home and away teams.
const NBA_VENUES: Record<string, NbaVenue> = {
  ATL: { latitude: 33.7573, longitude: -84.3963, timeZoneBand: 0, altitudeFeet: 1050 },
  BOS: { latitude: 42.3662, longitude: -71.0621, timeZoneBand: 0, altitudeFeet: 20 },
  BKN: { latitude: 40.6826, longitude: -73.9754, timeZoneBand: 0, altitudeFeet: 35 },
  CHA: { latitude: 35.2251, longitude: -80.8392, timeZoneBand: 0, altitudeFeet: 750 },
  CHI: { latitude: 41.8807, longitude: -87.6742, timeZoneBand: 1, altitudeFeet: 595 },
  CLE: { latitude: 41.4965, longitude: -81.6882, timeZoneBand: 0, altitudeFeet: 650 },
  DAL: { latitude: 32.7905, longitude: -96.8103, timeZoneBand: 1, altitudeFeet: 430 },
  DEN: { latitude: 39.7487, longitude: -105.0077, timeZoneBand: 2, altitudeFeet: 5280 },
  DET: { latitude: 42.3410, longitude: -83.0550, timeZoneBand: 0, altitudeFeet: 600 },
  GSW: { latitude: 37.7680, longitude: -122.3877, timeZoneBand: 3, altitudeFeet: 10 },
  HOU: { latitude: 29.7508, longitude: -95.3621, timeZoneBand: 1, altitudeFeet: 45 },
  IND: { latitude: 39.7640, longitude: -86.1555, timeZoneBand: 0, altitudeFeet: 715 },
  LAC: { latitude: 33.9535, longitude: -118.3392, timeZoneBand: 3, altitudeFeet: 130 },
  LAL: { latitude: 34.0430, longitude: -118.2673, timeZoneBand: 3, altitudeFeet: 270 },
  MEM: { latitude: 35.1382, longitude: -90.0506, timeZoneBand: 1, altitudeFeet: 260 },
  MIA: { latitude: 25.7814, longitude: -80.1870, timeZoneBand: 0, altitudeFeet: 10 },
  MIL: { latitude: 43.0451, longitude: -87.9172, timeZoneBand: 1, altitudeFeet: 620 },
  MIN: { latitude: 44.9795, longitude: -93.2760, timeZoneBand: 1, altitudeFeet: 830 },
  NOP: { latitude: 29.9490, longitude: -90.0821, timeZoneBand: 1, altitudeFeet: 5 },
  NYK: { latitude: 40.7505, longitude: -73.9934, timeZoneBand: 0, altitudeFeet: 35 },
  OKC: { latitude: 35.4634, longitude: -97.5151, timeZoneBand: 1, altitudeFeet: 1200 },
  ORL: { latitude: 28.5392, longitude: -81.3839, timeZoneBand: 0, altitudeFeet: 90 },
  PHI: { latitude: 39.9012, longitude: -75.1720, timeZoneBand: 0, altitudeFeet: 20 },
  PHX: { latitude: 33.4457, longitude: -112.0712, timeZoneBand: 2, altitudeFeet: 1085 },
  POR: { latitude: 45.5316, longitude: -122.6668, timeZoneBand: 3, altitudeFeet: 50 },
  SAC: { latitude: 38.5802, longitude: -121.4997, timeZoneBand: 3, altitudeFeet: 30 },
  SAS: { latitude: 29.4270, longitude: -98.4375, timeZoneBand: 1, altitudeFeet: 650 },
  TOR: { latitude: 43.6435, longitude: -79.3791, timeZoneBand: 0, altitudeFeet: 250 },
  UTA: { latitude: 40.7683, longitude: -111.9011, timeZoneBand: 2, altitudeFeet: 4225 },
  WAS: { latitude: 38.8981, longitude: -77.0209, timeZoneBand: 0, altitudeFeet: 25 },
};

export type NbaPointInTimeFeatureRow = {
  release: typeof NBA_POINT_IN_TIME_FEATURE_RELEASE;
  game_id: number;
  season: number;
  feature_cutoff: string;
  home_team_id: number;
  away_team_id: number;
  home_team: string;
  away_team: string;
  [feature: string]: string | number | null;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonnegative(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number >= 0 ? number : null;
}

function optionalFinite(value: unknown): number | null {
  return value === null || value === undefined || value === "" ? null : finite(value);
}

function optionalNonnegative(value: unknown): number | null {
  const number = optionalFinite(value);
  return number !== null && number >= 0 ? number : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function minutes(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return null;
  const [whole, seconds] = value.split(":");
  const wholeMinutes = Number(whole);
  const secondsValue = seconds === undefined ? 0 : Number(seconds);
  if (!Number.isFinite(wholeMinutes) || !Number.isFinite(secondsValue) || secondsValue < 0 || secondsValue >= 60) {
    return null;
  }
  return wholeMinutes + secondsValue / 60;
}

export function normalizeNbaHistoricalGame(row: Record<string, unknown>): NbaHistoricalGame {
  const home = object(row.home_team);
  const away = object(row.visitor_team);
  const gameId = integer(row.id);
  const season = integer(row.season);
  const start = string(row.datetime);
  const startMs = start ? Date.parse(start) : Number.NaN;
  const homeTeamId = integer(home?.id);
  const awayTeamId = integer(away?.id);
  const homeTeam = string(home?.abbreviation);
  const awayTeam = string(away?.abbreviation);
  const homeScore = nonnegative(row.home_team_score);
  const awayScore = nonnegative(row.visitor_team_score);
  if (
    gameId === null || season === null || !start || !Number.isFinite(startMs) ||
    homeTeamId === null || awayTeamId === null || !homeTeam || !awayTeam ||
    homeScore === null || awayScore === null ||
    (row.status_state !== "final" && row.status !== "Final")
  ) {
    throw new Error("NBA historical feature input contains a malformed finalized game.");
  }
  return {
    gameId,
    season,
    startTime: new Date(startMs).toISOString(),
    homeTeamId,
    awayTeamId,
    homeTeam: homeTeam.toUpperCase(),
    awayTeam: awayTeam.toUpperCase(),
    homeScore,
    awayScore,
  };
}

export function normalizeNbaHistoricalPlayerBox(row: Record<string, unknown>): NbaHistoricalPlayerBox {
  const game = object(row.game);
  const team = object(row.team);
  const player = object(row.player);
  const normalized = {
    rowId: integer(row.id),
    gameId: integer(game?.id),
    teamId: integer(team?.id),
    playerId: integer(player?.id),
    minutes: minutes(row.min),
    fgm: nonnegative(row.fgm),
    fga: nonnegative(row.fga),
    fg3m: nonnegative(row.fg3m),
    fg3a: nonnegative(row.fg3a),
    ftm: nonnegative(row.ftm),
    fta: nonnegative(row.fta),
    oreb: nonnegative(row.oreb),
    dreb: nonnegative(row.dreb),
    ast: nonnegative(row.ast),
    stl: nonnegative(row.stl),
    blk: nonnegative(row.blk),
    turnover: nonnegative(row.turnover ?? row.tov),
    pf: nonnegative(row.pf),
    points: nonnegative(row.pts),
    plusMinus: finite(row.plus_minus),
  };
  if (Object.values(normalized).some((value) => value === null)) {
    throw new Error("NBA historical feature input contains a malformed player box row.");
  }
  return normalized as NbaHistoricalPlayerBox;
}

export function normalizeNbaHistoricalPlayerAdvanced(
  row: Record<string, unknown>,
): NbaHistoricalPlayerAdvanced {
  const game = object(row.game);
  const team = object(row.team);
  const player = object(row.player);
  const identity = {
    rowId: integer(row.id),
    gameId: integer(row.game_id) ?? integer(game?.id),
    teamId: integer(row.team_id) ?? integer(team?.id),
    playerId: integer(row.player_id) ?? integer(player?.id),
    period: integer(row.period),
  };
  if (Object.values(identity).some((value) => value === null) || identity.period !== 0) {
    throw new Error("NBA historical feature input contains a malformed full-game advanced row.");
  }
  return {
    ...(identity as { rowId: number; gameId: number; teamId: number; playerId: number; period: number }),
    possessions: optionalNonnegative(row.possessions),
    estimatedNetRating: optionalFinite(row.estimated_net_rating ?? row.net_rating),
    usagePercentage: optionalNonnegative(row.estimated_usage_percentage ?? row.usage_percentage),
    pointsPaint: optionalNonnegative(row.points_paint),
    pointsFastBreak: optionalNonnegative(row.points_fast_break),
    pointsSecondChance: optionalNonnegative(row.points_second_chance),
    pointsOffTurnovers: optionalNonnegative(row.points_off_turnovers),
    passes: optionalNonnegative(row.passes),
    touches: optionalNonnegative(row.touches),
    secondaryAssists: optionalNonnegative(row.secondary_assists),
    screenAssistPoints: optionalNonnegative(row.screen_assist_points),
    deflections: optionalNonnegative(row.deflections),
    contestedShots: optionalNonnegative(row.contested_shots),
    defendedAtRimFga: optionalNonnegative(row.defended_at_rim_fga),
    defendedAtRimFgm: optionalNonnegative(row.defended_at_rim_fgm),
    reboundChancesTotal: optionalNonnegative(row.rebound_chances_total),
    distance: optionalNonnegative(row.distance),
    speed: optionalNonnegative(row.speed),
    playerImpactEstimate: optionalFinite(row.pie),
    assistPercentage: optionalNonnegative(row.assist_percentage),
    turnoverRatio: optionalNonnegative(row.turnover_ratio),
    trueShootingPercentage: optionalNonnegative(row.true_shooting_percentage),
    threePointAttemptShare: optionalNonnegative(row.pct_fga_3pt),
    offensiveReboundPercentage: optionalNonnegative(row.offensive_rebound_percentage),
    defensiveReboundPercentage: optionalNonnegative(row.defensive_rebound_percentage),
    freeThrowAttemptRate: optionalNonnegative(row.free_throw_attempt_rate),
    foulsDrawn: optionalNonnegative(row.fouls_drawn),
    looseBallsRecovered: optionalNonnegative(row.loose_balls_recovered_total),
    chargesDrawn: optionalNonnegative(row.charges_drawn),
    switchesOn: optionalNonnegative(row.switches_on),
    contestedFgPct: optionalNonnegative(row.contested_fg_pct),
    uncontestedFgPct: optionalNonnegative(row.uncontested_fg_pct),
    matchupFgPct: optionalNonnegative(row.matchup_fg_pct),
    matchupThreePointPct: optionalNonnegative(row.matchup_3pt_pct),
    screenAssists: optionalNonnegative(row.screen_assists),
    reboundChancesOff: optionalNonnegative(row.rebound_chances_off),
    reboundChancesDef: optionalNonnegative(row.rebound_chances_def),
  };
}

function sum(boxes: NbaHistoricalPlayerBox[], key: keyof NbaHistoricalPlayerBox): number {
  return boxes.reduce((total, row) => total + (row[key] as number), 0);
}

function aggregateTeamBox(teamId: number, boxes: NbaHistoricalPlayerBox[]): TeamBox {
  const players = boxes.filter((row) => row.teamId === teamId);
  if (players.length === 0) throw new Error(`NBA historical game is missing box rows for team ${teamId}.`);
  return {
    teamId,
    minutes: sum(players, "minutes"),
    fgm: sum(players, "fgm"),
    fga: sum(players, "fga"),
    fg3m: sum(players, "fg3m"),
    fg3a: sum(players, "fg3a"),
    ftm: sum(players, "ftm"),
    fta: sum(players, "fta"),
    oreb: sum(players, "oreb"),
    dreb: sum(players, "dreb"),
    ast: sum(players, "ast"),
    stl: sum(players, "stl"),
    blk: sum(players, "blk"),
    turnover: sum(players, "turnover"),
    pf: sum(players, "pf"),
    points: sum(players, "points"),
    players,
  };
}

function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    throw new Error("NBA historical feature calculation encountered an invalid denominator.");
  }
  return numerator / denominator;
}

function possessionEstimate(box: TeamBox): number {
  return box.fga + 0.44 * box.fta - box.oreb + box.turnover;
}

function rotationFeatures(box: TeamBox): Pick<
  TeamObservation,
  "rotationPlayers" | "top3MinutesShare" | "top8MinutesShare" | "rotationMinutesEntropy"
> {
  const playerMinutes = box.players.map((row) => row.minutes).filter((value) => value > 0).sort((a, b) => b - a);
  const total = playerMinutes.reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new Error("NBA historical team box has no positive player minutes.");
  const shares = playerMinutes.map((value) => value / total);
  const entropy = shares.reduce((sum, share) => sum - share * Math.log(share), 0);
  return {
    rotationPlayers: playerMinutes.length,
    top3MinutesShare: playerMinutes.slice(0, 3).reduce((sum, value) => sum + value, 0) / total,
    top8MinutesShare: playerMinutes.slice(0, 8).reduce((sum, value) => sum + value, 0) / total,
    rotationMinutesEntropy: entropy,
  };
}

function availableSum(
  rows: NbaHistoricalPlayerAdvanced[],
  key: keyof NbaHistoricalPlayerAdvanced,
): number | null {
  const values = rows.map((row) => row[key]).filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
}

function minuteWeighted(
  rows: NbaHistoricalPlayerAdvanced[],
  minutesByPlayer: Map<number, number>,
  key: keyof NbaHistoricalPlayerAdvanced,
): number | null {
  const values = rows.flatMap((row) => {
    const value = row[key];
    const weight = minutesByPlayer.get(row.playerId) ?? 0;
    return typeof value === "number" && Number.isFinite(value) && weight > 0 ? [{ value, weight }] : [];
  });
  const weight = values.reduce((total, item) => total + item.weight, 0);
  return weight > 0
    ? values.reduce((total, item) => total + item.value * item.weight, 0) / weight
    : null;
}

function advancedFeatures(args: {
  rows: NbaHistoricalPlayerAdvanced[];
  box: TeamBox;
  possessions: number;
}): Pick<TeamObservation,
  | "pointsPaintShare"
  | "pointsFastBreakShare"
  | "pointsSecondChanceShare"
  | "pointsOffTurnoversShare"
  | "passesPer100"
  | "touchesPer100"
  | "secondaryAssistsPer100"
  | "screenAssistPointsPer100"
  | "deflectionsPer100"
  | "contestedShotsPer100"
  | "defendedAtRimAttemptsPer100"
  | "defendedAtRimFgPct"
  | "reboundChancesPer100"
  | "rotationEstimatedNetRating"
  | "usageWeighted"
  | "usageMax"
  | "usageConcentration"
  | "distancePer48"
  | "speedWeighted"
  | "playerImpactEstimate"
  | "assistPercentage"
  | "turnoverRatio"
  | "trueShootingPercentage"
  | "threePointAttemptShare"
  | "offensiveReboundPercentage"
  | "defensiveReboundPercentage"
  | "freeThrowAttemptRate"
  | "foulsDrawnPer100"
  | "looseBallsRecoveredPer100"
  | "chargesDrawnPer100"
  | "switchesOnPer100"
  | "contestedFgPct"
  | "uncontestedFgPct"
  | "matchupFgPct"
  | "matchupThreePointPct"
  | "screenAssistsPer100"
  | "reboundChancesOffPer100"
  | "reboundChancesDefPer100"
> {
  if (args.rows.length === 0) {
    return {
      pointsPaintShare: null,
      pointsFastBreakShare: null,
      pointsSecondChanceShare: null,
      pointsOffTurnoversShare: null,
      passesPer100: null,
      touchesPer100: null,
      secondaryAssistsPer100: null,
      screenAssistPointsPer100: null,
      deflectionsPer100: null,
      contestedShotsPer100: null,
      defendedAtRimAttemptsPer100: null,
      defendedAtRimFgPct: null,
      reboundChancesPer100: null,
      rotationEstimatedNetRating: null,
      usageWeighted: null,
      usageMax: null,
      usageConcentration: null,
      distancePer48: null,
      speedWeighted: null,
      playerImpactEstimate: null,
      assistPercentage: null,
      turnoverRatio: null,
      trueShootingPercentage: null,
      threePointAttemptShare: null,
      offensiveReboundPercentage: null,
      defensiveReboundPercentage: null,
      freeThrowAttemptRate: null,
      foulsDrawnPer100: null,
      looseBallsRecoveredPer100: null,
      chargesDrawnPer100: null,
      switchesOnPer100: null,
      contestedFgPct: null,
      uncontestedFgPct: null,
      matchupFgPct: null,
      matchupThreePointPct: null,
      screenAssistsPer100: null,
      reboundChancesOffPer100: null,
      reboundChancesDefPer100: null,
    };
  }
  const per100 = (value: number | null): number | null =>
    value === null ? null : 100 * value / args.possessions;
  const share = (value: number | null): number | null =>
    value === null || args.box.points <= 0 ? null : value / args.box.points;
  const minutesByPlayer = new Map(args.box.players.map((row) => [row.playerId, row.minutes]));
  const usages = args.rows.flatMap((row) => {
    const weight = minutesByPlayer.get(row.playerId) ?? 0;
    return row.usagePercentage !== null && weight > 0 ? [{ value: row.usagePercentage, weight }] : [];
  });
  const totalUsageWeight = usages.reduce((total, item) => total + item.weight, 0);
  const usageWeighted = totalUsageWeight > 0
    ? usages.reduce((total, item) => total + item.value * item.weight, 0) / totalUsageWeight
    : null;
  const usageConcentration = usageWeighted === null ? null : Math.sqrt(
    usages.reduce((total, item) => total + item.weight * (item.value - usageWeighted) ** 2, 0) /
      totalUsageWeight,
  );
  const defendedAtRimFga = availableSum(args.rows, "defendedAtRimFga");
  const defendedAtRimFgm = availableSum(args.rows, "defendedAtRimFgm");
  const distance = availableSum(args.rows, "distance");
  const totalMinutes = args.box.players.reduce((total, row) => total + row.minutes, 0);
  return {
    pointsPaintShare: share(availableSum(args.rows, "pointsPaint")),
    pointsFastBreakShare: share(availableSum(args.rows, "pointsFastBreak")),
    pointsSecondChanceShare: share(availableSum(args.rows, "pointsSecondChance")),
    pointsOffTurnoversShare: share(availableSum(args.rows, "pointsOffTurnovers")),
    passesPer100: per100(availableSum(args.rows, "passes")),
    touchesPer100: per100(availableSum(args.rows, "touches")),
    secondaryAssistsPer100: per100(availableSum(args.rows, "secondaryAssists")),
    screenAssistPointsPer100: per100(availableSum(args.rows, "screenAssistPoints")),
    deflectionsPer100: per100(availableSum(args.rows, "deflections")),
    contestedShotsPer100: per100(availableSum(args.rows, "contestedShots")),
    defendedAtRimAttemptsPer100: per100(defendedAtRimFga),
    defendedAtRimFgPct: defendedAtRimFga !== null && defendedAtRimFga > 0 && defendedAtRimFgm !== null
      ? defendedAtRimFgm / defendedAtRimFga
      : null,
    reboundChancesPer100: per100(availableSum(args.rows, "reboundChancesTotal")),
    rotationEstimatedNetRating: minuteWeighted(args.rows, minutesByPlayer, "estimatedNetRating"),
    usageWeighted,
    usageMax: usages.length > 0 ? Math.max(...usages.map((item) => item.value)) : null,
    usageConcentration,
    distancePer48: totalMinutes > 0 && distance !== null
      ? distance * 48 / totalMinutes
      : null,
    speedWeighted: minuteWeighted(args.rows, minutesByPlayer, "speed"),
    playerImpactEstimate: minuteWeighted(args.rows, minutesByPlayer, "playerImpactEstimate"),
    assistPercentage: minuteWeighted(args.rows, minutesByPlayer, "assistPercentage"),
    turnoverRatio: minuteWeighted(args.rows, minutesByPlayer, "turnoverRatio"),
    trueShootingPercentage: minuteWeighted(args.rows, minutesByPlayer, "trueShootingPercentage"),
    threePointAttemptShare: minuteWeighted(args.rows, minutesByPlayer, "threePointAttemptShare"),
    offensiveReboundPercentage: minuteWeighted(args.rows, minutesByPlayer, "offensiveReboundPercentage"),
    defensiveReboundPercentage: minuteWeighted(args.rows, minutesByPlayer, "defensiveReboundPercentage"),
    freeThrowAttemptRate: minuteWeighted(args.rows, minutesByPlayer, "freeThrowAttemptRate"),
    foulsDrawnPer100: per100(availableSum(args.rows, "foulsDrawn")),
    looseBallsRecoveredPer100: per100(availableSum(args.rows, "looseBallsRecovered")),
    chargesDrawnPer100: per100(availableSum(args.rows, "chargesDrawn")),
    switchesOnPer100: per100(availableSum(args.rows, "switchesOn")),
    contestedFgPct: minuteWeighted(args.rows, minutesByPlayer, "contestedFgPct"),
    uncontestedFgPct: minuteWeighted(args.rows, minutesByPlayer, "uncontestedFgPct"),
    matchupFgPct: minuteWeighted(args.rows, minutesByPlayer, "matchupFgPct"),
    matchupThreePointPct: minuteWeighted(args.rows, minutesByPlayer, "matchupThreePointPct"),
    screenAssistsPer100: per100(availableSum(args.rows, "screenAssists")),
    reboundChancesOffPer100: per100(availableSum(args.rows, "reboundChancesOff")),
    reboundChancesDefPer100: per100(availableSum(args.rows, "reboundChancesDef")),
  };
}

function observation(args: {
  season: number;
  startMs: number;
  score: number;
  opponentScore: number;
  team: TeamBox;
  opponent: TeamBox;
  possessions: number;
  advanced: NbaHistoricalPlayerAdvanced[];
  venue: NbaVenue | null;
  isHome: boolean;
}): TeamObservation {
  const teamPossessions = possessionEstimate(args.team);
  const opponentPossessions = possessionEstimate(args.opponent);
  return {
    season: args.season,
    startMs: args.startMs,
    offRating: 100 * ratio(args.score, args.possessions),
    defRating: 100 * ratio(args.opponentScore, args.possessions),
    pace: args.possessions,
    margin: args.score - args.opponentScore,
    efg: ratio(args.team.fgm + 0.5 * args.team.fg3m, args.team.fga),
    turnoverRate: ratio(args.team.turnover, teamPossessions),
    offensiveReboundRate: ratio(args.team.oreb, args.team.oreb + args.opponent.dreb),
    freeThrowRate: ratio(args.team.fta, args.team.fga),
    opponentEfg: ratio(args.opponent.fgm + 0.5 * args.opponent.fg3m, args.opponent.fga),
    opponentTurnoverRate: ratio(args.opponent.turnover, opponentPossessions),
    opponentOffensiveReboundRate: ratio(args.opponent.oreb, args.opponent.oreb + args.team.dreb),
    opponentFreeThrowRate: ratio(args.opponent.fta, args.opponent.fga),
    ...rotationFeatures(args.team),
    ...advancedFeatures({ rows: args.advanced, box: args.team, possessions: args.possessions }),
    playerMinutes: Object.fromEntries(args.team.players.map((row) => [String(row.playerId), row.minutes])),
    venueLatitude: args.venue?.latitude ?? null,
    venueLongitude: args.venue?.longitude ?? null,
    venueTimeZoneBand: args.venue?.timeZoneBand ?? null,
    venueAltitudeFeet: args.venue?.altitudeFeet ?? null,
    isHome: args.isHome,
  };
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function standardDeviation(values: number[]): number | null {
  const average = mean(values);
  if (average === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function windowMean(
  observations: TeamObservation[],
  key: keyof TeamObservation,
  count: number,
): number | null {
  return mean(observations.slice(-count).map((row) => row[key]).filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)));
}

function rotationOverlap(left: Record<string, number>, right: Record<string, number>): number | null {
  const leftTotal = Object.values(left).reduce((total, value) => total + value, 0);
  const rightTotal = Object.values(right).reduce((total, value) => total + value, 0);
  if (leftTotal <= 0 || rightTotal <= 0) return null;
  const players = new Set([...Object.keys(left), ...Object.keys(right)]);
  let overlap = 0;
  for (const player of players) {
    overlap += Math.min((left[player] ?? 0) / leftTotal, (right[player] ?? 0) / rightTotal);
  }
  return overlap;
}

function rotationHistoryFeatures(observations: TeamObservation[]): Record<string, number | null> {
  const recent = observations.slice(-5);
  if (recent.length === 0) {
    return {
      rotation_expected_players_5: null,
      rotation_expected_top1_minutes_5: null,
      rotation_continuity_5: null,
      rotation_latest_vs_recent_5: null,
    };
  }
  const expectedMinutes = new Map<string, number>();
  for (const row of recent) {
    for (const [player, playerMinutes] of Object.entries(row.playerMinutes)) {
      expectedMinutes.set(player, (expectedMinutes.get(player) ?? 0) + playerMinutes / recent.length);
    }
  }
  const consecutiveOverlaps = recent.slice(1).flatMap((row, index) => {
    const value = rotationOverlap(recent[index]!.playerMinutes, row.playerMinutes);
    return value === null ? [] : [value];
  });
  const prior = recent.slice(0, -1);
  const recentBeforeLatest: Record<string, number> = {};
  if (prior.length > 0) {
    for (const row of prior) {
      for (const [player, playerMinutes] of Object.entries(row.playerMinutes)) {
        recentBeforeLatest[player] = (recentBeforeLatest[player] ?? 0) + playerMinutes / prior.length;
      }
    }
  }
  return {
    rotation_expected_players_5: [...expectedMinutes.values()].filter((value) => value >= 5).length,
    rotation_expected_top1_minutes_5: Math.max(...expectedMinutes.values()),
    rotation_continuity_5: mean(consecutiveOverlaps),
    rotation_latest_vs_recent_5: prior.length > 0
      ? rotationOverlap(recent.at(-1)!.playerMinutes, recentBeforeLatest)
      : null,
  };
}

function radians(value: number): number {
  return value * Math.PI / 180;
}

function haversineMiles(left: TeamObservation, venue: NbaVenue): number | null {
  if (left.venueLatitude === null || left.venueLongitude === null) return null;
  const latitudeDelta = radians(venue.latitude - left.venueLatitude);
  const longitudeDelta = radians(venue.longitude - left.venueLongitude);
  const startLatitude = radians(left.venueLatitude);
  const endLatitude = radians(venue.latitude);
  const chord = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(chord));
}

function scheduleFeatures(
  observations: TeamObservation[],
  startMs: number,
  venue: NbaVenue | null,
  isHome: boolean,
): Record<string, number | null> {
  const priorStarts = observations.map((row) => row.startMs);
  const lastStart = priorStarts.at(-1);
  const hoursSinceLast = lastStart === undefined ? null : (startMs - lastStart) / 3_600_000;
  const lastObservation = observations.at(-1);
  const travelDistance = lastObservation && venue ? haversineMiles(lastObservation, venue) : null;
  const longitudeShift = lastObservation?.venueLongitude !== null &&
      lastObservation?.venueLongitude !== undefined && venue
    ? venue.longitude - lastObservation.venueLongitude
    : null;
  const zoneShift = lastObservation?.venueTimeZoneBand !== null &&
      lastObservation?.venueTimeZoneBand !== undefined && venue
    ? lastObservation.venueTimeZoneBand - venue.timeZoneBand
    : null;
  let consecutiveRoadGames = 0;
  if (!isHome) {
    for (let index = observations.length - 1; index >= 0 && !observations[index]!.isHome; index -= 1) {
      consecutiveRoadGames += 1;
    }
  }
  return {
    rest_days: hoursSinceLast === null ? null : Math.max(0, hoursSinceLast / 24 - 1),
    back_to_back: hoursSinceLast !== null && hoursSinceLast <= 30 ? 1 : 0,
    games_last_4_days: priorStarts.filter((time) => startMs - time <= 4 * 86_400_000).length,
    games_last_7_days: priorStarts.filter((time) => startMs - time <= 7 * 86_400_000).length,
    travel_distance_miles: travelDistance,
    eastward_travel_miles: travelDistance !== null && longitudeShift !== null && longitudeShift > 0 ? travelDistance : 0,
    westward_travel_miles: travelDistance !== null && longitudeShift !== null && longitudeShift < 0 ? travelDistance : 0,
    time_zones_eastward: zoneShift === null ? null : Math.max(0, zoneShift),
    time_zones_westward: zoneShift === null ? null : Math.max(0, -zoneShift),
    consecutive_road_games_before: consecutiveRoadGames,
    venue_altitude_feet: venue?.altitudeFeet ?? null,
    altitude_change_feet: venue && lastObservation?.venueAltitudeFeet !== null &&
        lastObservation?.venueAltitudeFeet !== undefined
      ? venue.altitudeFeet - lastObservation.venueAltitudeFeet
      : null,
  };
}

function teamFeatures(args: {
  observations: TeamObservation[];
  season: number;
  startMs: number;
  adjusted: AdjustedRating;
  venue: NbaVenue | null;
  isHome: boolean;
}): Record<string, number | null> {
  const current = args.observations.filter((row) => row.season === args.season);
  const priorSeasons = args.observations.filter((row) => row.season < args.season);
  const priorSeason = priorSeasons.length > 0 ? Math.max(...priorSeasons.map((row) => row.season)) : null;
  const prior = priorSeason === null ? [] : priorSeasons.filter((row) => row.season === priorSeason);
  const values: Record<string, number | null> = {
    current_games: current.length,
    prior_games: prior.length,
    adjusted_offense: args.adjusted.offense,
    adjusted_defense: args.adjusted.defense,
  };
  const keys: Array<keyof TeamObservation> = [
    "offRating",
    "defRating",
    "pace",
    "margin",
    "efg",
    "turnoverRate",
    "offensiveReboundRate",
    "freeThrowRate",
    "opponentEfg",
    "opponentTurnoverRate",
    "opponentOffensiveReboundRate",
    "opponentFreeThrowRate",
    "rotationPlayers",
    "top3MinutesShare",
    "top8MinutesShare",
    "rotationMinutesEntropy",
    "pointsPaintShare",
    "pointsFastBreakShare",
    "pointsSecondChanceShare",
    "pointsOffTurnoversShare",
    "passesPer100",
    "touchesPer100",
    "secondaryAssistsPer100",
    "screenAssistPointsPer100",
    "deflectionsPer100",
    "contestedShotsPer100",
    "defendedAtRimAttemptsPer100",
    "defendedAtRimFgPct",
    "reboundChancesPer100",
    "rotationEstimatedNetRating",
    "usageWeighted",
    "usageMax",
    "usageConcentration",
    "distancePer48",
    "speedWeighted",
    "playerImpactEstimate",
    "assistPercentage",
    "turnoverRatio",
    "trueShootingPercentage",
    "threePointAttemptShare",
    "offensiveReboundPercentage",
    "defensiveReboundPercentage",
    "freeThrowAttemptRate",
    "foulsDrawnPer100",
    "looseBallsRecoveredPer100",
    "chargesDrawnPer100",
    "switchesOnPer100",
    "contestedFgPct",
    "uncontestedFgPct",
    "matchupFgPct",
    "matchupThreePointPct",
    "screenAssistsPer100",
    "reboundChancesOffPer100",
    "reboundChancesDefPer100",
  ];
  for (const key of keys) {
    values[`${key}_5`] = windowMean(current, key, 5);
    values[`${key}_15`] = windowMean(current, key, 15);
    values[`${key}_prior`] = windowMean(prior, key, 20);
  }
  values.margin_sd_10 = standardDeviation(current.slice(-10).map((row) => row.margin));
  values.total_rating_sd_10 = standardDeviation(
    current.slice(-10).map((row) => row.offRating + row.defRating),
  );
  return {
    ...values,
    ...rotationHistoryFeatures(current.length > 0 ? current : prior),
    // Strength and rotation priors may carry across seasons, but schedule
    // state cannot: offseason time is not rest and the prior season's final
    // venue is not an opening-night travel origin.
    ...scheduleFeatures(current, args.startMs, args.venue, args.isHome),
  };
}

function numericFeature(
  values: Record<string, number | null>,
  key: string,
): number | null {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pairFeature(
  left: Record<string, number | null>,
  leftKey: string,
  right: Record<string, number | null>,
  rightKey: string,
  combine: (leftValue: number, rightValue: number) => number,
): number | null {
  const leftValue = numericFeature(left, leftKey);
  const rightValue = numericFeature(right, rightKey);
  return leftValue === null || rightValue === null ? null : combine(leftValue, rightValue);
}

/**
 * Predeclared basketball interactions. Raw home/away columns force a linear
 * learner to rediscover every matchup equation independently. These explicit
 * edges express offense-versus-opponent-defense, pace, style, and schedule
 * relationships while retaining the exact same point-in-time evidence.
 */
function matchupFeatures(args: {
  home: Record<string, number | null>;
  away: Record<string, number | null>;
  league: number;
}): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  const homeOffense = numericFeature(args.home, "adjusted_offense");
  const homeDefense = numericFeature(args.home, "adjusted_defense");
  const awayOffense = numericFeature(args.away, "adjusted_offense");
  const awayDefense = numericFeature(args.away, "adjusted_defense");
  result.baseline_expected_margin_pp100 =
    homeOffense === null || homeDefense === null || awayOffense === null || awayDefense === null
      ? null
      : homeOffense + awayDefense - awayOffense - homeDefense;
  result.baseline_expected_total_pp100 =
    homeOffense === null || homeDefense === null || awayOffense === null || awayDefense === null
      ? null
      : homeOffense + awayDefense + awayOffense + homeDefense - 2 * args.league;

  for (const window of ["5", "15", "prior"] as const) {
    result[`matchup_pace_mean_${window}`] = pairFeature(
      args.home, `pace_${window}`, args.away, `pace_${window}`,
      (home, away) => (home + away) / 2,
    );
    result[`matchup_pace_abs_delta_${window}`] = pairFeature(
      args.home, `pace_${window}`, args.away, `pace_${window}`,
      (home, away) => Math.abs(home - away),
    );
    result[`matchup_home_efg_edge_${window}`] = pairFeature(
      args.home, `efg_${window}`, args.away, `opponentEfg_${window}`,
      (offense, allowed) => offense - allowed,
    );
    result[`matchup_away_efg_edge_${window}`] = pairFeature(
      args.away, `efg_${window}`, args.home, `opponentEfg_${window}`,
      (offense, allowed) => offense - allowed,
    );
    result[`matchup_home_turnover_edge_${window}`] = pairFeature(
      args.away, `opponentTurnoverRate_${window}`, args.home, `turnoverRate_${window}`,
      (forced, committed) => forced - committed,
    );
    result[`matchup_away_turnover_edge_${window}`] = pairFeature(
      args.home, `opponentTurnoverRate_${window}`, args.away, `turnoverRate_${window}`,
      (forced, committed) => forced - committed,
    );
    result[`matchup_home_rebound_edge_${window}`] = pairFeature(
      args.home, `offensiveReboundRate_${window}`, args.away, `opponentOffensiveReboundRate_${window}`,
      (offense, allowed) => offense - allowed,
    );
    result[`matchup_away_rebound_edge_${window}`] = pairFeature(
      args.away, `offensiveReboundRate_${window}`, args.home, `opponentOffensiveReboundRate_${window}`,
      (offense, allowed) => offense - allowed,
    );
    result[`matchup_home_free_throw_edge_${window}`] = pairFeature(
      args.home, `freeThrowRate_${window}`, args.away, `opponentFreeThrowRate_${window}`,
      (offense, allowed) => offense - allowed,
    );
    result[`matchup_away_free_throw_edge_${window}`] = pairFeature(
      args.away, `freeThrowRate_${window}`, args.home, `opponentFreeThrowRate_${window}`,
      (offense, allowed) => offense - allowed,
    );
    for (const key of [
      "pointsPaintShare",
      "pointsFastBreakShare",
      "pointsSecondChanceShare",
      "pointsOffTurnoversShare",
      "passesPer100",
      "touchesPer100",
      "deflectionsPer100",
      "contestedShotsPer100",
      "defendedAtRimFgPct",
      "reboundChancesPer100",
      "usageConcentration",
      "playerImpactEstimate",
      "assistPercentage",
      "turnoverRatio",
      "trueShootingPercentage",
      "threePointAttemptShare",
      "offensiveReboundPercentage",
      "defensiveReboundPercentage",
      "freeThrowAttemptRate",
      "foulsDrawnPer100",
      "looseBallsRecoveredPer100",
      "chargesDrawnPer100",
      "switchesOnPer100",
      "contestedFgPct",
      "uncontestedFgPct",
      "matchupFgPct",
      "matchupThreePointPct",
      "screenAssistsPer100",
      "reboundChancesOffPer100",
      "reboundChancesDefPer100",
    ] as const) {
      result[`matchup_${key}_delta_${window}`] = pairFeature(
        args.home, `${key}_${window}`, args.away, `${key}_${window}`,
        (home, away) => home - away,
      );
    }
  }
  result.matchup_rest_days_edge = pairFeature(
    args.home, "rest_days", args.away, "rest_days", (home, away) => home - away,
  );
  result.matchup_games_last_4_days_edge = pairFeature(
    args.home, "games_last_4_days", args.away, "games_last_4_days", (home, away) => home - away,
  );
  result.matchup_games_last_7_days_edge = pairFeature(
    args.home, "games_last_7_days", args.away, "games_last_7_days", (home, away) => home - away,
  );
  result.matchup_margin_volatility_sum_10 = pairFeature(
    args.home, "margin_sd_10", args.away, "margin_sd_10", (home, away) => home + away,
  );
  result.matchup_total_volatility_sum_10 = pairFeature(
    args.home, "total_rating_sd_10", args.away, "total_rating_sd_10", (home, away) => home + away,
  );
  return result;
}

function prefixed(prefix: "home" | "away", values: Record<string, number | null>): Record<string, number | null> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [`${prefix}_${key}`, value]));
}

function leagueRating(observations: TeamObservation[]): number {
  return mean(observations.slice(-300).map((row) => row.offRating)) ?? 110;
}

function updateAdjustedRatings(args: {
  ratings: Map<number, AdjustedRating>;
  league: number;
  homeTeamId: number;
  awayTeamId: number;
  homeOffRating: number;
  awayOffRating: number;
}): void {
  const home = args.ratings.get(args.homeTeamId) ?? { offense: 0, defense: 0 };
  const away = args.ratings.get(args.awayTeamId) ?? { offense: 0, defense: 0 };
  const learningRate = 0.12;
  const homeResidual = args.homeOffRating - (args.league + home.offense + away.defense);
  const awayResidual = args.awayOffRating - (args.league + away.offense + home.defense);
  args.ratings.set(args.homeTeamId, {
    offense: home.offense + learningRate * homeResidual / 2,
    defense: home.defense + learningRate * awayResidual / 2,
  });
  args.ratings.set(args.awayTeamId, {
    offense: away.offense + learningRate * awayResidual / 2,
    defense: away.defense + learningRate * homeResidual / 2,
  });
}

function eloHomeWinProbability(home: EloRating, away: EloRating): number {
  return 1 / (1 + 10 ** (-(home + ELO_HOME_ADVANTAGE - away) / 400));
}

function updateEloRatings(args: {
  ratings: Map<number, EloRating>;
  homeTeamId: number;
  awayTeamId: number;
  homeMargin: number;
}): void {
  const home = args.ratings.get(args.homeTeamId) ?? ELO_INITIAL_RATING;
  const away = args.ratings.get(args.awayTeamId) ?? ELO_INITIAL_RATING;
  const expected = eloHomeWinProbability(home, away);
  const outcome = args.homeMargin > 0 ? 1 : 0;
  const adjustment = ELO_K_FACTOR * (outcome - expected);
  args.ratings.set(args.homeTeamId, home + adjustment);
  args.ratings.set(args.awayTeamId, away - adjustment);
}

export function buildNbaPointInTimeFeatures(args: {
  games: NbaHistoricalGame[];
  boxes: NbaHistoricalPlayerBox[];
  advanced?: NbaHistoricalPlayerAdvanced[];
}): NbaPointInTimeFeatureRow[] {
  const games = [...args.games].sort((left, right) =>
    Date.parse(left.startTime) - Date.parse(right.startTime) || left.gameId - right.gameId);
  const boxesByGame = new Map<number, NbaHistoricalPlayerBox[]>();
  for (const box of args.boxes) {
    const rows = boxesByGame.get(box.gameId) ?? [];
    rows.push(box);
    boxesByGame.set(box.gameId, rows);
  }
  const advancedByGame = new Map<number, NbaHistoricalPlayerAdvanced[]>();
  for (const advanced of args.advanced ?? []) {
    const rows = advancedByGame.get(advanced.gameId) ?? [];
    rows.push(advanced);
    advancedByGame.set(advanced.gameId, rows);
  }
  const observationsByTeam = new Map<number, TeamObservation[]>();
  const leagueObservations: TeamObservation[] = [];
  const adjustedRatings = new Map<number, AdjustedRating>();
  const eloRatings = new Map<number, EloRating>();
  const pendingOutcomes: PendingOutcome[] = [];
  const output: NbaPointInTimeFeatureRow[] = [];
  let activeStrengthSeason: number | null = null;

  for (const game of games) {
    const startMs = Date.parse(game.startTime);
    if (!Number.isFinite(startMs)) throw new Error(`NBA game ${game.gameId} has an invalid start time.`);
    while (pendingOutcomes[0] && pendingOutcomes[0].availableAtMs <= startMs) {
      const finalized = pendingOutcomes.shift()!;
      const homeHistory = observationsByTeam.get(finalized.homeTeamId) ?? [];
      const awayHistory = observationsByTeam.get(finalized.awayTeamId) ?? [];
      const league = leagueRating(leagueObservations);
      homeHistory.push(finalized.homeObservation);
      awayHistory.push(finalized.awayObservation);
      observationsByTeam.set(finalized.homeTeamId, homeHistory);
      observationsByTeam.set(finalized.awayTeamId, awayHistory);
      leagueObservations.push(finalized.homeObservation, finalized.awayObservation);
      updateAdjustedRatings({
        ratings: adjustedRatings,
        league,
        homeTeamId: finalized.homeTeamId,
        awayTeamId: finalized.awayTeamId,
        homeOffRating: finalized.homeObservation.offRating,
        awayOffRating: finalized.awayObservation.offRating,
      });
      updateEloRatings({
        ratings: eloRatings,
        homeTeamId: finalized.homeTeamId,
        awayTeamId: finalized.awayTeamId,
        homeMargin: finalized.homeObservation.margin,
      });
    }
    if (activeStrengthSeason !== game.season) {
      if (activeStrengthSeason !== null) {
        for (const [teamId, rating] of eloRatings) {
          eloRatings.set(
            teamId,
            ELO_INITIAL_RATING + (rating - ELO_INITIAL_RATING) * ELO_OFFSEASON_CARRY,
          );
        }
        for (const [teamId, rating] of adjustedRatings) {
          adjustedRatings.set(teamId, {
            offense: rating.offense * ADJUSTED_RATING_OFFSEASON_CARRY,
            defense: rating.defense * ADJUSTED_RATING_OFFSEASON_CARRY,
          });
        }
      }
      activeStrengthSeason = game.season;
    }
    const gameBoxes = boxesByGame.get(game.gameId) ?? [];
    const gameAdvanced = advancedByGame.get(game.gameId) ?? [];
    const homeBox = aggregateTeamBox(game.homeTeamId, gameBoxes);
    const awayBox = aggregateTeamBox(game.awayTeamId, gameBoxes);
    const homePossessions = possessionEstimate(homeBox);
    const awayPossessions = possessionEstimate(awayBox);
    const possessions = (homePossessions + awayPossessions) / 2;
    if (!Number.isFinite(possessions) || possessions <= 0) {
      throw new Error(`NBA game ${game.gameId} has invalid possession evidence.`);
    }

    const homeHistory = observationsByTeam.get(game.homeTeamId) ?? [];
    const awayHistory = observationsByTeam.get(game.awayTeamId) ?? [];
    const league = leagueRating(leagueObservations);
    const homeAdjusted = adjustedRatings.get(game.homeTeamId) ?? { offense: 0, defense: 0 };
    const awayAdjusted = adjustedRatings.get(game.awayTeamId) ?? { offense: 0, defense: 0 };
    const homeElo = eloRatings.get(game.homeTeamId) ?? ELO_INITIAL_RATING;
    const awayElo = eloRatings.get(game.awayTeamId) ?? ELO_INITIAL_RATING;
    const venue = NBA_VENUES[game.homeTeam] ?? null;
    const homeFeatureState = teamFeatures({
      observations: homeHistory,
      season: game.season,
      startMs,
      adjusted: {
        offense: league + homeAdjusted.offense,
        defense: league + homeAdjusted.defense,
      },
      venue,
      isHome: true,
    });
    const awayFeatureState = teamFeatures({
      observations: awayHistory,
      season: game.season,
      startMs,
      adjusted: {
        offense: league + awayAdjusted.offense,
        defense: league + awayAdjusted.defense,
      },
      venue,
      isHome: false,
    });
    output.push({
      release: NBA_POINT_IN_TIME_FEATURE_RELEASE,
      game_id: game.gameId,
      season: game.season,
      feature_cutoff: game.startTime,
      home_team_id: game.homeTeamId,
      away_team_id: game.awayTeamId,
      home_team: game.homeTeam,
      away_team: game.awayTeam,
      league_off_rating: league,
      elo_home_rating: homeElo,
      elo_away_rating: awayElo,
      elo_rating_delta: homeElo - awayElo,
      elo_home_win_probability: eloHomeWinProbability(homeElo, awayElo),
      ...prefixed("home", homeFeatureState),
      ...prefixed("away", awayFeatureState),
      ...matchupFeatures({ home: homeFeatureState, away: awayFeatureState, league }),
      target_home_score: game.homeScore,
      target_away_score: game.awayScore,
      target_home_margin: game.homeScore - game.awayScore,
      target_total: game.homeScore + game.awayScore,
      target_home_win: game.homeScore > game.awayScore ? 1 : 0,
    });

    const homeObservation = observation({
      season: game.season,
      startMs,
      score: game.homeScore,
      opponentScore: game.awayScore,
      team: homeBox,
      opponent: awayBox,
      possessions,
      advanced: gameAdvanced.filter((row) => row.teamId === game.homeTeamId),
      venue,
      isHome: true,
    });
    const awayObservation = observation({
      season: game.season,
      startMs,
      score: game.awayScore,
      opponentScore: game.homeScore,
      team: awayBox,
      opponent: homeBox,
      possessions,
      advanced: gameAdvanced.filter((row) => row.teamId === game.awayTeamId),
      venue,
      isHome: false,
    });
    pendingOutcomes.push({
      availableAtMs: startMs + CONSERVATIVE_RESULT_AVAILABILITY_HOURS * 3_600_000,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homeObservation,
      awayObservation,
    });
    pendingOutcomes.sort((left, right) => left.availableAtMs - right.availableAtMs);
  }
  return output;
}

export const __NBA_POINT_IN_TIME_FEATURE_TEST__ = {
  CONSERVATIVE_RESULT_AVAILABILITY_HOURS,
  minutes,
  possessionEstimate,
  rotationFeatures,
  rotationOverlap,
  matchupFeatures,
  eloHomeWinProbability,
};
