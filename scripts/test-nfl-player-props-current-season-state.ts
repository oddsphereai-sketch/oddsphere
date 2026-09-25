import assert from "node:assert/strict";
import {
  NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE,
  readNflPlayerPropsCurrentSeasonState,
  refreshNflPlayerPropsCurrentSeasonState,
  type NflPlayerPropsCurrentSeasonStat,
} from "../lib/services/football/nflPlayerPropsCurrentSeasonState";
import { applyNflPlayerPropsCurrentSeasonFeatures } from "../lib/services/football/nflPlayerPropsRuntime";

const requested: URL[] = [];
const fetchImpl: typeof fetch = async (request) => {
  const url = new URL(String(request));
  requested.push(url);
  if (url.pathname.endsWith("/games")) {
    assert.deepEqual(url.searchParams.getAll("weeks[]"), ["1"]);
    assert.deepEqual(url.searchParams.getAll("season_type[]"), ["2"]);
    return json({
      data: [
        game(10, "BUF", "NYJ", 27, 20, "2026-09-10T00:00:00.000Z"),
        game(11, "KC", "LAR", 24, 17, "2026-09-11T00:00:00.000Z"),
      ],
      meta: {},
    });
  }
  if (url.pathname.endsWith("/team_stats")) {
    assert.deepEqual(url.searchParams.getAll("game_ids[]"), ["10", "11"]);
    return json({ data: [
      teamStat(10, "BUF", { total_yards: 386, yards_per_play: 6.1, rushing_yards: 140, red_zone_scores: 3, red_zone_attempts: 4, possession_time: "31:42" }),
      teamStat(10, "NYJ", { total_yards: 341, yards_per_play: 5.2, red_zone_scores: 2, red_zone_attempts: 3, possession_time: "28:18" }),
      teamStat(11, "KC", { total_yards: 374, yards_per_play: 5.8, red_zone_scores: 3, red_zone_attempts: 4, possession_time: "32:11" }),
      teamStat(11, "LAR", { total_yards: 329, yards_per_play: 5.0, red_zone_scores: 2, red_zone_attempts: 4, possession_time: "27:49" }),
    ], meta: {} });
  }
  assert.equal(url.pathname.endsWith("/stats"), true);
  assert.deepEqual(url.searchParams.getAll("game_ids[]"), ["10", "11"]);
  return json({ data: [stat(10, 5, "Test Runner", "BUF", { rushing_attempts: 12, rushing_yards: 61, receiving_targets: 4, receptions: 3, receiving_yards: 28, rushing_touchdowns: 1 }), stat(10, 6, "Test Quarterback", "BUF", { passing_attempts: 30, passing_completions: 20, passing_yards: 250 }), stat(10, 7, "Opponent Quarterback", "NYJ", { passing_attempts: 35, passing_completions: 24, passing_yards: 270 }), stat(11, 8, "Second Game Player", "KC", { rushing_attempts: 7, rushing_yards: 33 })], meta: {} });
};

async function main(): Promise<void> {
  const refreshed = await refreshNflPlayerPropsCurrentSeasonState({
    season: 2026,
    week: 2,
    now: "2026-09-16T12:00:00.000Z",
    apiKey: "test",
    fetchImpl,
  });
  assert.equal(refreshed.state.release, NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE);
  assert.equal(refreshed.state.completeThroughWeek, 1);
  assert.equal(refreshed.gamesAdded, 2);
  assert.deepEqual(refreshed.state.games, [
    { gameId: "10", season: 2026, week: 1, scheduledStart: "2026-09-10T00:00:00.000Z", status: "final", homeTeam: "BUF", awayTeam: "NYJ", homeScore: 27, awayScore: 20 },
    { gameId: "11", season: 2026, week: 1, scheduledStart: "2026-09-11T00:00:00.000Z", status: "final", homeTeam: "KC", awayTeam: "LA", homeScore: 24, awayScore: 17 },
  ]);
  assert.equal(refreshed.statsAdded, 4);
  assert.equal(refreshed.teamStatsAdded, 4);
  assert.equal(refreshed.state.teamStats.length, 4);
  assert.deepEqual(refreshed.state.teamStats.find((row) => row.gameId === "10" && row.team === "BUF"), {
    gameId: "10", season: 2026, week: 1, scheduledStart: "2026-09-10T00:00:00.000Z",
    team: "BUF", opponent: "NYJ", home: true, pointsFor: 27, pointsAgainst: 20,
    firstDowns: 22, thirdDownConversions: 6, thirdDownAttempts: 12,
    fourthDownConversions: 1, fourthDownAttempts: 1, totalOffensivePlays: 63,
    totalYards: 386, yardsPerPlay: 6.1, netPassingYards: 246, passingAttempts: 31,
    sacksAllowed: 2, rushingYards: 140, rushingAttempts: 30, redZoneScores: 3,
    redZoneAttempts: 4, turnovers: 1, fumblesLost: 0, interceptionsThrown: 1,
    possessionTimeSeconds: 1902,
  });
  assert.equal(refreshed.state.teamStats.find((row) => row.gameId === "11" && row.team === "LA")?.opponent, "KC");
  assert.equal(refreshed.apiCalls, 3);
  assert.equal(requested.length, 3);

  const cached = await refreshNflPlayerPropsCurrentSeasonState({
    season: 2026,
    week: 2,
    now: "2026-09-16T13:00:00.000Z",
    apiKey: "test",
    previous: refreshed.state,
    fetchImpl: async () => { throw new Error("complete cached state must not call the provider"); },
  });
  assert.equal(cached.apiCalls, 0);
  assert.equal(cached.state, refreshed.state);

  const legacyState = {
    release: "nfl_player_props_current_season_state_2026_09_16_r1_prior_final_games",
    season: 2026,
    completeThroughWeek: 1,
    updatedAt: "2026-09-16T12:00:00.000Z",
    stats: refreshed.state.stats,
  };
  const legacyClient = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { payload: legacyState }, error: null }) }),
      }),
    }),
  };
  const migrated = await readNflPlayerPropsCurrentSeasonState({
    client: legacyClient as never,
    season: 2026,
  });
  assert.equal(migrated?.release, NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE);
  assert.equal(migrated?.completeThroughWeek, 0);
  assert.deepEqual(migrated?.games, []);
  assert.deepEqual(migrated?.teamStats, []);
  assert.equal(migrated?.stats.length, 4);
  const migrationRequests: URL[] = [];
  const migrationRefresh = await refreshNflPlayerPropsCurrentSeasonState({
    season: 2026,
    week: 2,
    now: "2026-09-16T14:00:00.000Z",
    apiKey: "test",
    previous: migrated,
    fetchImpl: async (request) => {
      const url = new URL(String(request));
      migrationRequests.push(url);
      if (url.pathname.endsWith("/games")) {
        return json({ data: [game(10, "BUF", "NYJ", 27, 20, "2026-09-10T00:00:00.000Z"), game(11, "KC", "LAR", 24, 17, "2026-09-11T00:00:00.000Z")], meta: {} });
      }
      assert.equal(url.pathname.endsWith("/team_stats"), true);
      return json({ data: [teamStat(10, "BUF"), teamStat(10, "NYJ"), teamStat(11, "KC"), teamStat(11, "LAR")], meta: {} });
    },
  });
  assert.equal(migrationRefresh.apiCalls, 2);
  assert.equal(migrationRefresh.statsAdded, 0);
  assert.equal(migrationRefresh.teamStatsAdded, 4);
  assert.equal(migrationRefresh.gamesAdded, 2);
  assert.equal(migrationRequests.length, 2);

  await assert.rejects(
    refreshNflPlayerPropsCurrentSeasonState({
      season: 2026,
      week: 2,
      now: "2026-09-16T15:00:00.000Z",
      apiKey: "test",
      fetchImpl: async () => json({
        data: [{ id: 12, season: 2026, week: 1, date: "2026-09-12T00:00:00.000Z", status_state: "final" }],
        meta: {},
      }),
    }),
    /missing team or score identity for 1 final games/,
  );

  const features: Record<string, number | null> = {
    prior_rushing_attempts_avg3: 9,
    prior_rushing_attempts_avg5: 8,
    prior_rushing_attempts_ewm: 7,
    prior_rushing_attempts_season_avg: null,
    prior_rush_attempt_share_avg3: 0.3,
    prior_rush_attempt_share_avg5: 0.25,
    prior_rush_attempt_share_ewm: 0.2,
    prior_rush_attempt_share_season_avg: null,
    prior_anytime_td_avg5: 0.2,
    prior_anytime_td_ewm: 0.1,
    prior_team_rush_attempts_avg3: 25,
    prior_team_rush_attempts_avg5: 24,
    prior_team_rush_attempts_ewm: 23,
    prior_opponent_allowed_pass_attempts_avg3: 31,
    prior_opponent_allowed_pass_attempts_avg5: 30,
    prior_opponent_allowed_pass_attempts_ewm: 29,
  };
  applyNflPlayerPropsCurrentSeasonFeatures({
    features,
    playerStats: refreshed.state.stats.filter((row) => row.playerId === "5"),
    teamGames: [{ gameId: "10", week: 1, team: "BUF", opponent: "NYJ", team_pass_attempts: 30, team_completions: 20, team_passing_yards: 250, team_rush_attempts: 12, team_rushing_yards: 61, team_targets: 4, team_offensive_plays: 42, team_touchdowns: 1 }],
    opponentAllowedGames: [{ gameId: "10", week: 1, team: "BUF", opponent: "NYJ", team_pass_attempts: 30, team_completions: 20, team_passing_yards: 250, team_rush_attempts: 12, team_rushing_yards: 61, team_targets: 4, team_offensive_plays: 42, team_touchdowns: 1 }],
  });
  assert.equal(features.prior_rushing_attempts_lag1, 12);
  assert.equal(features.prior_rushing_attempts_avg3, 10);
  assert.equal(features.prior_rushing_attempts_ewm, 8.75);
  assert.equal(features.prior_rushing_attempts_season_avg, 12);
  assert.equal(features.prior_rush_attempt_share_lag1, 1);
  assert.equal(features.prior_anytime_td_avg5, 0.36);
  assert.equal(features.prior_team_rush_attempts_avg3, 62 / 3);
  assert.equal(features.prior_opponent_allowed_pass_attempts_avg3, 92 / 3);
  console.log("NFL player-props current-season state refresh and rolling feature overlay passed.");
}

function stat(gameId: number, playerId: number, playerName: string, team: string, values: Record<string, number>): Record<string, unknown> {
  const [first_name, ...last] = playerName.split(" ");
  return {
    game: { id: gameId }, player: { id: playerId, first_name, last_name: last.join(" ") }, team: { abbreviation: team },
    passing_attempts: 0, passing_completions: 0, passing_yards: 0, rushing_attempts: 0, rushing_yards: 0,
    receptions: 0, receiving_yards: 0, receiving_targets: 0, rushing_touchdowns: 0, receiving_touchdowns: 0,
    kick_return_touchdowns: 0, punt_return_touchdowns: 0, fumbles_touchdowns: 0, ...values,
  };
}
function teamStat(gameId: number, team: string, values: Record<string, number | string> = {}): Record<string, unknown> {
  return {
    game: { id: gameId }, team: { abbreviation: team },
    first_downs: 22, third_down_conversions: 6, third_down_attempts: 12,
    fourth_down_conversions: 1, fourth_down_attempts: 1, total_offensive_plays: 63,
    total_yards: 350, yards_per_play: 5.6, net_passing_yards: 246, passing_attempts: 31,
    sacks: 2, rushing_yards: 104, rushing_attempts: 30, red_zone_scores: 2,
    red_zone_attempts: 4, turnovers: 1, fumbles_lost: 0, interceptions_thrown: 1,
    possession_time: "30:00", ...values,
  };
}
function game(id: number, home: string, away: string, homeScore: number, awayScore: number, date: string): Record<string, unknown> {
  return {
    id, season: 2026, week: 1, date, status_state: "final",
    home_team_score: homeScore, visitor_team_score: awayScore,
    home_team: { abbreviation: home }, visitor_team: { abbreviation: away },
  };
}
function json(value: unknown): Promise<Response> { return Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })); }

void main().catch((error) => { console.error(error); process.exitCode = 1; });
