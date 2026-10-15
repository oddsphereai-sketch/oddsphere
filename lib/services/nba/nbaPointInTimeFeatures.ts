/**
 * Leakage-safe NBA pregame feature construction from finalized historical rows.
 *
 * Every output row is emitted before that game's outcome updates team state.
 * The accompanying test mutates a target and proves that its own features do
 * not change while later games do.
 */

export const NBA_POINT_IN_TIME_FEATURE_RELEASE =
  "nba_point_in_time_features_2026_10_15_r1" as const;

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
};

type AdjustedRating = { offense: number; defense: number };

type PendingOutcome = {
  availableAtMs: number;
  homeTeamId: number;
  awayTeamId: number;
  homeObservation: TeamObservation;
  awayObservation: TeamObservation;
};

const CONSERVATIVE_RESULT_AVAILABILITY_HOURS = 5;

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

function observation(args: {
  season: number;
  startMs: number;
  score: number;
  opponentScore: number;
  team: TeamBox;
  opponent: TeamBox;
  possessions: number;
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
  return mean(observations.slice(-count).map((row) => row[key] as number));
}

function scheduleFeatures(observations: TeamObservation[], startMs: number): Record<string, number | null> {
  const priorStarts = observations.map((row) => row.startMs);
  const lastStart = priorStarts.at(-1);
  const hoursSinceLast = lastStart === undefined ? null : (startMs - lastStart) / 3_600_000;
  return {
    rest_days: hoursSinceLast === null ? null : Math.max(0, hoursSinceLast / 24 - 1),
    back_to_back: hoursSinceLast !== null && hoursSinceLast <= 30 ? 1 : 0,
    games_last_4_days: priorStarts.filter((time) => startMs - time <= 4 * 86_400_000).length,
    games_last_7_days: priorStarts.filter((time) => startMs - time <= 7 * 86_400_000).length,
  };
}

function teamFeatures(args: {
  observations: TeamObservation[];
  season: number;
  startMs: number;
  adjusted: AdjustedRating;
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
  return { ...values, ...scheduleFeatures(args.observations, args.startMs) };
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

export function buildNbaPointInTimeFeatures(args: {
  games: NbaHistoricalGame[];
  boxes: NbaHistoricalPlayerBox[];
}): NbaPointInTimeFeatureRow[] {
  const games = [...args.games].sort((left, right) =>
    Date.parse(left.startTime) - Date.parse(right.startTime) || left.gameId - right.gameId);
  const boxesByGame = new Map<number, NbaHistoricalPlayerBox[]>();
  for (const box of args.boxes) {
    const rows = boxesByGame.get(box.gameId) ?? [];
    rows.push(box);
    boxesByGame.set(box.gameId, rows);
  }
  const observationsByTeam = new Map<number, TeamObservation[]>();
  const leagueObservations: TeamObservation[] = [];
  const adjustedRatings = new Map<number, AdjustedRating>();
  const pendingOutcomes: PendingOutcome[] = [];
  const output: NbaPointInTimeFeatureRow[] = [];

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
    }
    const gameBoxes = boxesByGame.get(game.gameId) ?? [];
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
      ...prefixed("home", teamFeatures({
        observations: homeHistory,
        season: game.season,
        startMs,
        adjusted: {
          offense: league + homeAdjusted.offense,
          defense: league + homeAdjusted.defense,
        },
      })),
      ...prefixed("away", teamFeatures({
        observations: awayHistory,
        season: game.season,
        startMs,
        adjusted: {
          offense: league + awayAdjusted.offense,
          defense: league + awayAdjusted.defense,
        },
      })),
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
    });
    const awayObservation = observation({
      season: game.season,
      startMs,
      score: game.awayScore,
      opponentScore: game.homeScore,
      team: awayBox,
      opponent: homeBox,
      possessions,
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
};
