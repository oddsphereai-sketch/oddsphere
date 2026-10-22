import type {
  NbaHistoricalGame,
  NbaHistoricalPlayerAdvanced,
  NbaHistoricalPlayerBox,
  NbaUpcomingGame,
} from "./nbaPointInTimeFeatures";
import { buildNbaPointInTimeFeatures } from "./nbaPointInTimeFeatures";

export const NBA_PLAYER_PROPS_POINT_IN_TIME_FEATURE_RELEASE =
  "nba_player_props_point_in_time_features_2026_10_22_r6_active_role_integrity" as const;

const RESULT_AVAILABILITY_HOURS = 5;

export type NbaPlayerPropCandidate = {
  gameId: number;
  playerId: number;
  playerName: string | null;
  teamId: number;
};

export type NbaPlayerPropFeatureRow = {
  release: typeof NBA_PLAYER_PROPS_POINT_IN_TIME_FEATURE_RELEASE;
  game_id: number;
  season: number;
  feature_cutoff: string;
  player_id: number;
  player_name: string | null;
  team_id: number;
  opponent_team_id: number;
  is_home: number;
  player_games_prior: number;
  team_games_prior: number;
  participation_rate_10: number | null;
  participation_sample_10: number;
  same_team_games_10: number;
  changed_team_since_last_game: number | null;
  days_rest: number | null;
  minutes_mean_3: number | null;
  minutes_mean_5: number | null;
  minutes_mean_10: number | null;
  minutes_mean_season: number | null;
  minutes_sd_10: number | null;
  minutes_p25_10: number | null;
  minutes_p75_10: number | null;
  points_per_minute_10: number | null;
  rebounds_per_minute_10: number | null;
  rebounds_per_minute_20: number | null;
  rebounds_per_minute_season: number | null;
  assists_per_minute_10: number | null;
  assists_per_minute_20: number | null;
  assists_per_minute_season: number | null;
  threes_per_minute_10: number | null;
  threes_per_minute_20: number | null;
  threes_per_minute_season: number | null;
  blocks_per_minute_10: number | null;
  steals_per_minute_10: number | null;
  turnovers_per_minute_10: number | null;
  fga_per_minute_10: number | null;
  fg3a_per_minute_10: number | null;
  fg3a_per_minute_20: number | null;
  fg3a_per_minute_season: number | null;
  fta_per_minute_10: number | null;
  usage_mean_5: number | null;
  touches_per_minute_5: number | null;
  passes_per_minute_5: number | null;
  rebound_chances_per_minute_5: number | null;
  rebound_chances_off_per_minute_5: number | null;
  rebound_chances_def_per_minute_5: number | null;
  rebound_capture_rate_5: number | null;
  offensive_rebound_percentage_mean_5: number | null;
  defensive_rebound_percentage_mean_5: number | null;
  fg3_percentage_10: number | null;
  fg3_percentage_20: number | null;
  fg3_percentage_season: number | null;
  three_point_attempt_share_mean_5: number | null;
  true_shooting_mean_5: number | null;
  assist_percentage_mean_5: number | null;
  points_share_mean_5: number | null;
  fga_share_mean_5: number | null;
  game_pace_mean_5: number | null;
  game_pace_mean_15: number | null;
  team_adjusted_offense: number | null;
  opponent_adjusted_defense: number | null;
  team_efg_5: number | null;
  opponent_efg_allowed_5: number | null;
  team_assist_percentage_5: number | null;
  opponent_deflections_per100_5: number | null;
  team_offensive_rebound_rate_5: number | null;
  opponent_defensive_rebound_percentage_5: number | null;
  opponent_rebound_chances_per100_5: number | null;
  opponent_rebound_chances_off_per100_5: number | null;
  opponent_rebound_chances_def_per100_5: number | null;
  opponent_offensive_rebound_percentage_5: number | null;
  team_three_point_attempt_share_5: number | null;
  opponent_three_point_attempt_share_5: number | null;
  opponent_matchup_three_point_pct_5: number | null;
  opponent_contested_shots_per100_5: number | null;
  team_rest_days: number | null;
  team_back_to_back: number | null;
  opponent_rest_days: number | null;
  team_rotation_expected_players_5: number | null;
  team_rotation_expected_top1_minutes_5: number | null;
  team_rotation_continuity_5: number | null;
  team_rotation_latest_vs_recent_5: number | null;
  opponent_rotation_expected_players_5: number | null;
  opponent_rotation_expected_top1_minutes_5: number | null;
  opponent_rotation_continuity_5: number | null;
  opponent_rotation_latest_vs_recent_5: number | null;
  target_minutes: number | null;
  target_points: number | null;
  target_rebounds: number | null;
  target_assists: number | null;
  target_threes: number | null;
  target_blocks: number | null;
  target_steals: number | null;
  target_turnovers: number | null;
  target_points_rebounds_assists: number | null;
  target_points_rebounds: number | null;
  target_points_assists: number | null;
  target_rebounds_assists: number | null;
};

type PlayerObservation = {
  season: number;
  startMs: number;
  teamId: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  blocks: number;
  steals: number;
  turnovers: number;
  fga: number;
  fg3a: number;
  fta: number;
  usage: number | null;
  touches: number | null;
  passes: number | null;
  reboundChances: number | null;
  reboundChancesOff: number | null;
  reboundChancesDef: number | null;
  offensiveReboundPercentage: number | null;
  defensiveReboundPercentage: number | null;
  threePointAttemptShare: number | null;
  trueShooting: number | null;
  assistPercentage: number | null;
  pointsShare: number | null;
  fgaShare: number | null;
};

type PendingGame = {
  availableAtMs: number;
  game: NbaHistoricalGame;
  observations: Array<{ playerId: number; row: PlayerObservation }>;
};

export function buildNbaPlayerPropsPointInTimeFeatures(args: {
  games: readonly NbaHistoricalGame[];
  upcomingGames?: readonly NbaUpcomingGame[];
  boxes: readonly NbaHistoricalPlayerBox[];
  advanced?: readonly NbaHistoricalPlayerAdvanced[];
  candidates: readonly NbaPlayerPropCandidate[];
  emitGameIds?: ReadonlySet<number>;
}): NbaPlayerPropFeatureRow[] {
  const games: Array<NbaHistoricalGame | NbaUpcomingGame> = [
    ...args.games,
    ...(args.upcomingGames ?? []),
  ].sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime) || left.gameId - right.gameId);
  const boxesByGame = group(args.boxes, (row) => row.gameId);
  const advancedByGamePlayer = new Map<string, NbaHistoricalPlayerAdvanced>();
  for (const row of args.advanced ?? []) {
    if (row.period === 0) advancedByGamePlayer.set(`${row.gameId}:${row.playerId}`, row);
  }
  const candidatesByGame = group(args.candidates, (row) => row.gameId);
  const gameContextById = new Map(buildNbaPointInTimeFeatures({
    games: [...args.games],
    upcomingGames: [...(args.upcomingGames ?? [])],
    boxes: [...args.boxes],
    advanced: [...(args.advanced ?? [])],
    emitGameIds: args.emitGameIds,
  }).map((row) => [row.game_id, row]));
  const playerHistory = new Map<number, PlayerObservation[]>();
  const teamGameStarts = new Map<number, number[]>();
  const pending: PendingGame[] = [];
  const output: NbaPlayerPropFeatureRow[] = [];

  for (const game of games) {
    const startMs = timestamp(game.startTime);
    while (pending[0] && pending[0].availableAtMs <= startMs) {
      const ready = pending.shift()!;
      for (const teamId of [ready.game.homeTeamId, ready.game.awayTeamId]) {
        teamGameStarts.set(teamId, [...(teamGameStarts.get(teamId) ?? []), Date.parse(ready.game.startTime)]);
      }
      for (const observation of ready.observations) {
        playerHistory.set(observation.playerId, [...(playerHistory.get(observation.playerId) ?? []), observation.row]);
      }
    }

    if (args.emitGameIds === undefined || args.emitGameIds.has(game.gameId)) {
      const gameBoxes = boxesByGame.get(game.gameId) ?? [];
      const targetByPlayer = new Map(gameBoxes.map((row) => [row.playerId, row]));
      for (const candidate of candidatesByGame.get(game.gameId) ?? []) {
        if (candidate.teamId !== game.homeTeamId && candidate.teamId !== game.awayTeamId) {
          throw new Error(`NBA props candidate ${candidate.playerId} is not on game ${game.gameId}.`);
        }
        const opponentTeamId = candidate.teamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
        const history = (playerHistory.get(candidate.playerId) ?? []).filter((row) => row.startMs < startMs);
        const teamStarts = (teamGameStarts.get(candidate.teamId) ?? []).filter((value) => value < startMs);
        const target = targetByPlayer.get(candidate.playerId) ?? null;
        output.push(buildFeatureRow({
          game,
          candidate,
          opponentTeamId,
          history,
          teamStarts,
          target,
          gameContext: gameContextById.get(game.gameId) ?? null,
        }));
      }
    }

    if (!("homeScore" in game)) continue;
    const gameBoxes = boxesByGame.get(game.gameId) ?? [];
    const totalsByTeam = new Map<number, { points: number; fga: number }>();
    for (const box of gameBoxes) {
      const totals = totalsByTeam.get(box.teamId) ?? { points: 0, fga: 0 };
      totals.points += box.points;
      totals.fga += box.fga;
      totalsByTeam.set(box.teamId, totals);
    }
    const observations = gameBoxes.map((box) => {
      const advanced = advancedByGamePlayer.get(`${game.gameId}:${box.playerId}`) ?? null;
      const totals = totalsByTeam.get(box.teamId) ?? { points: 0, fga: 0 };
      return {
        playerId: box.playerId,
        row: observation(game, box, advanced, totals),
      };
    });
    pending.push({
      availableAtMs: startMs + RESULT_AVAILABILITY_HOURS * 3_600_000,
      game,
      observations,
    });
    pending.sort((left, right) => left.availableAtMs - right.availableAtMs);
  }
  return output.sort((left, right) => left.game_id - right.game_id || left.player_id - right.player_id);
}

function buildFeatureRow(args: {
  game: NbaHistoricalGame | NbaUpcomingGame;
  candidate: NbaPlayerPropCandidate;
  opponentTeamId: number;
  history: PlayerObservation[];
  teamStarts: number[];
  target: NbaHistoricalPlayerBox | null;
  gameContext: ReturnType<typeof buildNbaPointInTimeFeatures>[number] | null;
}): NbaPlayerPropFeatureRow {
  // A zero-minute box row is availability evidence, not an appearance. Preserve
  // the incumbent role windows for ordinary histories, but when DNPs dominate
  // the latest ten observations use actual appearances for conditional role.
  // This prevents a season boundary, team change, or injury return from turning
  // a genuine 20-30 minute role into a near-zero forecast while leaving normal
  // in-season windows and their qualified calibration unchanged.
  const activeHistory = args.history.filter((row) => row.minutes > 0);
  const rawRecent10 = args.history.slice(-10);
  const lastActive = activeHistory.at(-1) ?? null;
  const rawDaysRest = lastActive
    ? (Date.parse(args.game.startTime) - lastActive.startMs) / 86_400_000
    : null;
  const dnpDominated = rawRecent10.length >= 3
    && rawRecent10.filter((row) => row.minutes <= 0).length / rawRecent10.length >= 0.5;
  const crossesLongLayoff = rawDaysRest !== null && rawDaysRest > 30;
  const currentSeasonActiveHistory = activeHistory.filter((row) => row.season === args.game.season);
  const earlySeasonDnpContamination = currentSeasonActiveHistory.length > 0
    && currentSeasonActiveHistory.length <= 3
    && rawRecent10.some((row) => row.minutes <= 0);
  const roleHistory = dnpDominated || crossesLongLayoff || earlySeasonDnpContamination
    ? activeHistory
    : args.history;
  const seasonHistory = roleHistory.filter((row) => row.season === args.game.season);
  const recent10 = roleHistory.slice(-10);
  const recent20 = roleHistory.slice(-20);
  const recent5 = roleHistory.slice(-5);
  const sameTeamGames = recent10.filter((row) => row.teamId === args.candidate.teamId).length;
  const lastOtherTeamAppearance = activeHistory.findLast((row) => row.teamId !== args.candidate.teamId) ?? null;
  const currentTeamTenureHistory = activeHistory.filter((row) =>
    row.teamId === args.candidate.teamId
    && (lastOtherTeamAppearance === null || row.startMs > lastOtherTeamAppearance.startMs));
  const firstCurrentTeamAppearance = currentTeamTenureHistory[0] ?? null;
  const teamTenureRecent10 = firstCurrentTeamAppearance === null
    ? []
    : args.teamStarts.filter((value) => value >= firstCurrentTeamAppearance.startMs).slice(-10);
  const appearancesInTeamWindow = currentTeamTenureHistory.filter((row) =>
    teamTenureRecent10.includes(row.startMs)).length;
  const target = args.target;
  const rebounds = target ? target.oreb + target.dreb : null;
  const teamPrefix = args.candidate.teamId === args.game.homeTeamId ? "home" : "away";
  const opponentPrefix = teamPrefix === "home" ? "away" : "home";
  const context = args.gameContext;
  const contextNumber = (key: string): number | null => {
    const value = context?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  return {
    release: NBA_PLAYER_PROPS_POINT_IN_TIME_FEATURE_RELEASE,
    game_id: args.game.gameId,
    season: args.game.season,
    feature_cutoff: args.game.startTime,
    player_id: args.candidate.playerId,
    player_name: args.candidate.playerName,
    team_id: args.candidate.teamId,
    opponent_team_id: args.opponentTeamId,
    is_home: args.candidate.teamId === args.game.homeTeamId ? 1 : 0,
    player_games_prior: args.history.length,
    team_games_prior: args.teamStarts.length,
    participation_rate_10: teamTenureRecent10.length > 0
      ? appearancesInTeamWindow / teamTenureRecent10.length
      : null,
    participation_sample_10: teamTenureRecent10.length,
    same_team_games_10: sameTeamGames,
    changed_team_since_last_game: lastActive ? Number(lastActive.teamId !== args.candidate.teamId) : null,
    // Rest effects saturate; an offseason cannot be extrapolated as 190 daily
    // rest increments through a linear minute/count model trained in-season.
    days_rest: rawDaysRest === null ? null : Math.min(7, rawDaysRest),
    minutes_mean_3: mean(roleHistory.slice(-3).map((row) => row.minutes)),
    minutes_mean_5: mean(recent5.map((row) => row.minutes)),
    minutes_mean_10: mean(recent10.map((row) => row.minutes)),
    minutes_mean_season: mean(seasonHistory.map((row) => row.minutes)),
    minutes_sd_10: standardDeviation(recent10.map((row) => row.minutes)),
    minutes_p25_10: quantile(recent10.map((row) => row.minutes), 0.25),
    minutes_p75_10: quantile(recent10.map((row) => row.minutes), 0.75),
    points_per_minute_10: perMinute(recent10, "points"),
    rebounds_per_minute_10: perMinute(recent10, "rebounds"),
    rebounds_per_minute_20: perMinute(recent20, "rebounds"),
    rebounds_per_minute_season: perMinute(seasonHistory, "rebounds"),
    assists_per_minute_10: perMinute(recent10, "assists"),
    assists_per_minute_20: perMinute(recent20, "assists"),
    assists_per_minute_season: perMinute(seasonHistory, "assists"),
    threes_per_minute_10: perMinute(recent10, "threes"),
    threes_per_minute_20: perMinute(recent20, "threes"),
    threes_per_minute_season: perMinute(seasonHistory, "threes"),
    blocks_per_minute_10: perMinute(recent10, "blocks"),
    steals_per_minute_10: perMinute(recent10, "steals"),
    turnovers_per_minute_10: perMinute(recent10, "turnovers"),
    fga_per_minute_10: perMinute(recent10, "fga"),
    fg3a_per_minute_10: perMinute(recent10, "fg3a"),
    fg3a_per_minute_20: perMinute(recent20, "fg3a"),
    fg3a_per_minute_season: perMinute(seasonHistory, "fg3a"),
    fta_per_minute_10: perMinute(recent10, "fta"),
    usage_mean_5: mean(nonNull(recent5.map((row) => row.usage))),
    touches_per_minute_5: optionalPerMinute(recent5, "touches"),
    passes_per_minute_5: optionalPerMinute(recent5, "passes"),
    rebound_chances_per_minute_5: optionalPerMinute(recent5, "reboundChances"),
    rebound_chances_off_per_minute_5: optionalPerMinute(recent5, "reboundChancesOff"),
    rebound_chances_def_per_minute_5: optionalPerMinute(recent5, "reboundChancesDef"),
    rebound_capture_rate_5: optionalRatio(recent5, "rebounds", "reboundChances"),
    offensive_rebound_percentage_mean_5: mean(nonNull(recent5.map((row) => row.offensiveReboundPercentage))),
    defensive_rebound_percentage_mean_5: mean(nonNull(recent5.map((row) => row.defensiveReboundPercentage))),
    fg3_percentage_10: ratioOfSums(recent10, "threes", "fg3a"),
    fg3_percentage_20: ratioOfSums(recent20, "threes", "fg3a"),
    fg3_percentage_season: ratioOfSums(seasonHistory, "threes", "fg3a"),
    three_point_attempt_share_mean_5: mean(nonNull(recent5.map((row) => row.threePointAttemptShare))),
    true_shooting_mean_5: mean(nonNull(recent5.map((row) => row.trueShooting))),
    assist_percentage_mean_5: mean(nonNull(recent5.map((row) => row.assistPercentage))),
    points_share_mean_5: mean(nonNull(recent5.map((row) => row.pointsShare))),
    fga_share_mean_5: mean(nonNull(recent5.map((row) => row.fgaShare))),
    game_pace_mean_5: contextNumber("matchup_pace_mean_5"),
    game_pace_mean_15: contextNumber("matchup_pace_mean_15"),
    team_adjusted_offense: contextNumber(`${teamPrefix}_adjusted_offense`),
    opponent_adjusted_defense: contextNumber(`${opponentPrefix}_adjusted_defense`),
    team_efg_5: contextNumber(`${teamPrefix}_efg_5`),
    opponent_efg_allowed_5: contextNumber(`${opponentPrefix}_opponentEfg_5`),
    team_assist_percentage_5: contextNumber(`${teamPrefix}_assistPercentage_5`),
    opponent_deflections_per100_5: contextNumber(`${opponentPrefix}_deflectionsPer100_5`),
    team_offensive_rebound_rate_5: contextNumber(`${teamPrefix}_offensiveReboundRate_5`),
    opponent_defensive_rebound_percentage_5: contextNumber(`${opponentPrefix}_defensiveReboundPercentage_5`),
    opponent_rebound_chances_per100_5: contextNumber(`${opponentPrefix}_reboundChancesPer100_5`),
    opponent_rebound_chances_off_per100_5: contextNumber(`${opponentPrefix}_reboundChancesOffPer100_5`),
    opponent_rebound_chances_def_per100_5: contextNumber(`${opponentPrefix}_reboundChancesDefPer100_5`),
    opponent_offensive_rebound_percentage_5: contextNumber(`${opponentPrefix}_offensiveReboundPercentage_5`),
    team_three_point_attempt_share_5: contextNumber(`${teamPrefix}_threePointAttemptShare_5`),
    opponent_three_point_attempt_share_5: contextNumber(`${opponentPrefix}_threePointAttemptShare_5`),
    opponent_matchup_three_point_pct_5: contextNumber(`${opponentPrefix}_matchupThreePointPct_5`),
    opponent_contested_shots_per100_5: contextNumber(`${opponentPrefix}_contestedShotsPer100_5`),
    team_rest_days: contextNumber(`${teamPrefix}_rest_days`),
    team_back_to_back: contextNumber(`${teamPrefix}_back_to_back`),
    opponent_rest_days: contextNumber(`${opponentPrefix}_rest_days`),
    team_rotation_expected_players_5: contextNumber(`${teamPrefix}_rotation_expected_players_5`),
    team_rotation_expected_top1_minutes_5: contextNumber(`${teamPrefix}_rotation_expected_top1_minutes_5`),
    team_rotation_continuity_5: contextNumber(`${teamPrefix}_rotation_continuity_5`),
    team_rotation_latest_vs_recent_5: contextNumber(`${teamPrefix}_rotation_latest_vs_recent_5`),
    opponent_rotation_expected_players_5: contextNumber(`${opponentPrefix}_rotation_expected_players_5`),
    opponent_rotation_expected_top1_minutes_5: contextNumber(`${opponentPrefix}_rotation_expected_top1_minutes_5`),
    opponent_rotation_continuity_5: contextNumber(`${opponentPrefix}_rotation_continuity_5`),
    opponent_rotation_latest_vs_recent_5: contextNumber(`${opponentPrefix}_rotation_latest_vs_recent_5`),
    target_minutes: target?.minutes ?? null,
    target_points: target?.points ?? null,
    target_rebounds: rebounds,
    target_assists: target?.ast ?? null,
    target_threes: target?.fg3m ?? null,
    target_blocks: target?.blk ?? null,
    target_steals: target?.stl ?? null,
    target_turnovers: target?.turnover ?? null,
    target_points_rebounds_assists: target && rebounds !== null ? target.points + rebounds + target.ast : null,
    target_points_rebounds: target && rebounds !== null ? target.points + rebounds : null,
    target_points_assists: target ? target.points + target.ast : null,
    target_rebounds_assists: target && rebounds !== null ? rebounds + target.ast : null,
  };
}

function observation(
  game: NbaHistoricalGame,
  box: NbaHistoricalPlayerBox,
  advanced: NbaHistoricalPlayerAdvanced | null,
  totals: { points: number; fga: number },
): PlayerObservation {
  return {
    season: game.season,
    startMs: Date.parse(game.startTime),
    teamId: box.teamId,
    minutes: box.minutes,
    points: box.points,
    rebounds: box.oreb + box.dreb,
    assists: box.ast,
    threes: box.fg3m,
    blocks: box.blk,
    steals: box.stl,
    turnovers: box.turnover,
    fga: box.fga,
    fg3a: box.fg3a,
    fta: box.fta,
    usage: advanced?.usagePercentage ?? null,
    touches: advanced?.touches ?? null,
    passes: advanced?.passes ?? null,
    reboundChances: advanced?.reboundChancesTotal ?? null,
    reboundChancesOff: advanced?.reboundChancesOff ?? null,
    reboundChancesDef: advanced?.reboundChancesDef ?? null,
    offensiveReboundPercentage: advanced?.offensiveReboundPercentage ?? null,
    defensiveReboundPercentage: advanced?.defensiveReboundPercentage ?? null,
    threePointAttemptShare: advanced?.threePointAttemptShare ?? null,
    trueShooting: advanced?.trueShootingPercentage ?? null,
    assistPercentage: advanced?.assistPercentage ?? null,
    pointsShare: totals.points > 0 ? box.points / totals.points : null,
    fgaShare: totals.fga > 0 ? box.fga / totals.fga : null,
  };
}

function group<T>(values: readonly T[], key: (value: T) => number): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const value of values) grouped.set(key(value), [...(grouped.get(key(value)) ?? []), value]);
  return grouped;
}

function mean(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function standardDeviation(values: readonly number[]): number | null {
  const average = mean(values);
  if (average === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1));
}

function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

function perMinute(rows: readonly PlayerObservation[], key: keyof PlayerObservation): number | null {
  const minutes = rows.reduce((total, row) => total + row.minutes, 0);
  if (minutes <= 0) return null;
  return rows.reduce((total, row) => total + (row[key] as number), 0) / minutes;
}

function optionalPerMinute(
  rows: readonly PlayerObservation[],
  key: "touches" | "passes" | "reboundChances" | "reboundChancesOff" | "reboundChancesDef",
): number | null {
  const available = rows.filter((row) => row[key] !== null);
  const minutes = available.reduce((total, row) => total + row.minutes, 0);
  if (minutes <= 0) return null;
  return available.reduce((total, row) => total + (row[key] ?? 0), 0) / minutes;
}

function optionalRatio(
  rows: readonly PlayerObservation[],
  numeratorKey: "rebounds",
  denominatorKey: "reboundChances",
): number | null {
  const available = rows.filter((row) => row[denominatorKey] !== null);
  const denominator = available.reduce((total, row) => total + (row[denominatorKey] ?? 0), 0);
  if (denominator <= 0) return null;
  return available.reduce((total, row) => total + row[numeratorKey], 0) / denominator;
}

function ratioOfSums(
  rows: readonly PlayerObservation[],
  numeratorKey: "threes",
  denominatorKey: "fg3a",
): number | null {
  const denominator = rows.reduce((total, row) => total + row[denominatorKey], 0);
  if (denominator <= 0) return null;
  return rows.reduce((total, row) => total + row[numeratorKey], 0) / denominator;
}

function nonNull(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`NBA props received invalid game timestamp ${value}.`);
  return parsed;
}

export const __NBA_PLAYER_PROPS_POINT_IN_TIME_TEST__ = { RESULT_AVAILABILITY_HOURS };
