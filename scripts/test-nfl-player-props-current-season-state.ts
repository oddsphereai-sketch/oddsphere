import assert from "node:assert/strict";
import {
  NFL_PLAYER_PROPS_CURRENT_SEASON_STATE_RELEASE,
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
        { id: 10, season: 2026, week: 1, date: "2026-09-10T00:00:00.000Z", status_state: "final" },
        { id: 11, season: 2026, week: 1, date: "2026-09-11T00:00:00.000Z", status_state: "final" },
      ],
      meta: {},
    });
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
  assert.equal(refreshed.statsAdded, 4);
  assert.equal(refreshed.apiCalls, 2);
  assert.equal(requested.length, 2);

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
function json(value: unknown): Promise<Response> { return Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })); }

void main().catch((error) => { console.error(error); process.exitCode = 1; });
