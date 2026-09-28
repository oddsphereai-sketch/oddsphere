import assert from "node:assert/strict";
import {
  fetchBalldontlieNflWeeklyProjectionShadows,
  NFL_PAID_PROJECTION_SHADOW_RELEASE,
} from "../lib/services/football/balldontlieNflWeeklyProjectionShadow";
import type { NflPreviewGame } from "../lib/services/football/balldontlieNflPreviewSlate";

const game: NflPreviewGame = {
  providerGameId: "7001",
  providerWeek: 4,
  season: 2026,
  scheduledStart: "2026-10-01T00:15:00.000Z",
  status: "scheduled",
  away: { id: 1, abbreviation: "BUF", name: "Buffalo Bills" },
  home: { id: 2, abbreviation: "HOU", name: "Houston Texans" },
};

function row(args: {
  id: number;
  teamId: number;
  team: string;
  position: string;
  stats: Record<string, number>;
}) {
  return {
    id: args.id,
    season: 2026,
    week: 4,
    date: null,
    collected_at: "2026-09-30T23:15:00.000Z",
    position: args.position,
    team: { id: args.teamId, abbreviation: args.team },
    game: {
      id: 7001,
      date: game.scheduledStart,
      visitor_team: { id: 1, abbreviation: "BUF" },
      home_team: { id: 2, abbreviation: "HOU" },
    },
    stats: { games_played: 1, ...args.stats },
  };
}

const rows = [
  row({ id: 1, teamId: 1, team: "BUF", position: "QB", stats: { passing_touchdowns: 1.5, rushing_touchdowns: 0.2 } }),
  row({ id: 2, teamId: 1, team: "BUF", position: "K", stats: { extra_points_made: 2, field_goals_made: 1 } }),
  row({ id: 3, teamId: 1, team: "BUF", position: "DST", stats: { points_allowed: 24, total_return_touchdowns: 0.1, defensive_safeties: 0 } }),
  row({ id: 4, teamId: 2, team: "HOU", position: "QB", stats: { passing_touchdowns: 2, rushing_touchdowns: 0.3 } }),
  row({ id: 5, teamId: 2, team: "HOU", position: "K", stats: { extra_points_made: 2.5, field_goals_made: 1.2 } }),
  row({ id: 6, teamId: 2, team: "HOU", position: "DST", stats: { points_allowed: 20, total_return_touchdowns: 0.05, defensive_safeties: 0 } }),
];

const urls: string[] = [];
const fetchImpl: typeof fetch = async (input) => {
  const url = String(input);
  urls.push(url);
  const cursor = new URL(url).searchParams.get("cursor");
  return new Response(JSON.stringify(cursor
    ? { data: rows.slice(3), meta: { per_page: 100 } }
    : { data: rows.slice(0, 3), meta: { next_cursor: 3, per_page: 100 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

async function main(): Promise<void> {
const result = await fetchBalldontlieNflWeeklyProjectionShadows({
  apiKey: "test-key",
  season: 2026,
  week: 4,
  games: [game],
  fetchedAt: "2026-09-30T23:30:00.000Z",
  fetchImpl,
});

assert.equal(result.release, NFL_PAID_PROJECTION_SHADOW_RELEASE);
assert.equal(result.requests, 2);
assert.equal(result.rows, 6);
assert.equal(result.gamesComplete, 1);
assert.deepEqual(result.incompleteGameIds, []);
assert.equal(new URL(urls[0]!).searchParams.get("per_page"), "100");
assert.equal(new URL(urls[1]!).searchParams.get("cursor"), "3");
const shadow = result.byGame[game.providerGameId]!;
assert.equal(shadow.awayComponentScore, 15.8);
assert.equal(shadow.homeComponentScore, 20.2);
assert.equal(shadow.awayOpponentDstScore, 20);
assert.equal(shadow.homeOpponentDstScore, 24);
assert.equal(shadow.expectedAwayScore, 20);
assert.equal(shadow.expectedHomeScore, 24);
assert.equal(shadow.projectedHomeMargin, 4);
assert.equal(shadow.projectedTotal, 44);
assert.deepEqual(shadow.positions, ["DST", "K", "QB"]);

const postKickoffRows = rows.map((value) => ({ ...value, collected_at: "2026-10-01T00:16:00.000Z" }));
const postKickoff = await fetchBalldontlieNflWeeklyProjectionShadows({
  apiKey: "test-key",
  season: 2026,
  week: 4,
  games: [game],
  fetchedAt: "2026-10-01T00:17:00.000Z",
  fetchImpl: async () => new Response(JSON.stringify({ data: postKickoffRows, meta: { per_page: 100 } }), { status: 200 }),
});
assert.equal(postKickoff.gamesComplete, 0);
assert.deepEqual(postKickoff.incompleteGameIds, [game.providerGameId]);

console.log("BALLDONTLIE NFL weekly projection shadow pagination, scoring, identity, and pregame boundary passed.");
}

void main();
