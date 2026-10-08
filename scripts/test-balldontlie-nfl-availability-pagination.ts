import assert from "node:assert/strict";
import {
  __BALLDONTLIE_NFL_AVAILABILITY_TEST__,
  fetchBalldontlieNflSlateAvailability,
  mergeNflAvailabilityWithPrior,
  nflAvailabilityRequestBudgetMaximum,
  NFL_DESIGNATION_MAX_PAGES_PER_BATCH,
  NFL_DESIGNATION_TEAM_BATCH_SIZE,
  NFL_INJURY_MAX_PAGES,
} from "../lib/services/football/balldontlieNflAvailability";
import type { DailyEdgeGameAvailability } from "../lib/services/dailyEdge/gameAvailability";

const designationCalls: string[] = [];
const designationFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  designationCalls.push(url.toString());
  assert.equal(url.pathname, "/nfl/v1/player_designations");
  assert.equal(url.searchParams.get("season"), "2026");
  assert.equal(url.searchParams.get("week"), "5");
  assert.deepEqual(url.searchParams.getAll("season_types[]"), ["2"]);
  assert.deepEqual(url.searchParams.getAll("team_ids[]"), ["28", "19"]);
  const secondPage = url.searchParams.get("cursor") === "next";
  const data = secondPage ? [
    designationRow({
      gameId: 1392280,
      team: "TB",
      teamName: "Tampa Bay Buccaneers",
      firstName: "Bucky",
      lastName: "Irving",
      practiceStatus: "full",
      updatedAt: "2026-10-08T20:00:43.000Z",
    }),
    designationRow({
      gameId: 999999,
      team: "DAL",
      teamName: "Dallas Cowboys",
      firstName: "Wrong",
      lastName: "Game",
      gameStatus: "out",
      updatedAt: "2026-10-08T20:00:44.000Z",
    }),
  ] : [
    designationRow({
      gameId: 1392280,
      team: "DAL",
      teamName: "Dallas Cowboys",
      firstName: "Jonathan",
      lastName: "Mingo",
      injury: "Illness",
      gameStatus: "questionable",
      practiceStatus: "did_not_participate",
      updatedAt: "2026-10-08T20:00:42.000Z",
    }),
    designationRow({
      gameId: 1392280,
      team: "TB",
      teamName: "Tampa Bay Buccaneers",
      firstName: "Baker",
      lastName: "Mayfield",
      injury: "Thumb",
      gameStatus: "out",
      practiceStatus: "did_not_participate",
      updatedAt: "2026-10-08T20:00:41.000Z",
    }),
  ];
  return jsonResponse({ data, meta: { next_cursor: secondPage ? null : "next" } });
};

async function main(): Promise<void> {
  assert.equal(NFL_INJURY_MAX_PAGES, 8);
  assert.equal(NFL_DESIGNATION_TEAM_BATCH_SIZE, 8);
  assert.equal(NFL_DESIGNATION_MAX_PAGES_PER_BATCH, 8);
  const matchup = {
    id: "nfl-1392280",
    awayTeam: "TB",
    homeTeam: "DAL",
    awayTeamId: 28,
    homeTeamId: 19,
  };
  assert.equal(nflAvailabilityRequestBudgetMaximum([matchup]), 16);

  const result = await fetchBalldontlieNflSlateAvailability([matchup], {
    apiKey: "test",
    fetchImpl: designationFetch,
    season: 2026,
    week: 5,
    seasonType: 2,
  });
  assert.ok(result);
  assert.equal(designationCalls.length, 2, "the game-scoped designation feed must consume its complete cursor chain");
  assert.equal(result?.[0]?.eventId, "nfl-1392280");
  assert.deepEqual(result?.[0]?.teams.map((team) => team.abbreviation), ["TB", "DAL"]);
  assert.equal(result?.[0]?.teams[0]?.players[0]?.name, "Baker Mayfield");
  assert.equal(result?.[0]?.teams[0]?.players[0]?.status, "Out");
  assert.equal(result?.[0]?.teams[0]?.players[0]?.detail, "Thumb");
  assert.equal(result?.[0]?.teams[1]?.players[0]?.name, "Jonathan Mingo");
  assert.equal(result?.[0]?.teams[1]?.players[0]?.status, "Questionable");
  assert.equal(result?.[0]?.teams.reduce((sum, team) => sum + team.players.length, 0), 2,
    "a full-practice row with no current injury or game designation must not be displayed as injured");
  assert.equal(result?.[0]?.reportUpdatedAt, "2026-10-08T20:00:43.000Z",
    "the exact-game feed timestamp remains available even when the newest roster row is not injured");

  const legacyCalls: string[] = [];
  const legacyFallback: typeof fetch = async (input) => {
    const url = new URL(String(input));
    legacyCalls.push(url.pathname);
    if (url.pathname.endsWith("/player_designations")) {
      return new Response("forbidden", { status: 403, headers: { "content-type": "text/plain" } });
    }
    assert.equal(url.pathname, "/nfl/v1/player_injuries");
    const cursor = Number(url.searchParams.get("cursor") ?? "0");
    const page = cursor + 1;
    return jsonResponse({
      data: [{
        player: {
          first_name: `Player${page}`,
          last_name: "Test",
          position_abbreviation: "WR",
          team: { abbreviation: page % 2 === 0 ? "DAL" : "TB", full_name: "Test Team" },
        },
        status: "Questionable",
        date: "2026-10-08T12:00:00.000Z",
      }],
      meta: { next_cursor: page < 5 ? page : null },
    });
  };
  const legacy = await fetchBalldontlieNflSlateAvailability([{ ...matchup, id: "1392280" }], {
    apiKey: "test",
    fetchImpl: legacyFallback,
    season: 2026,
    week: 5,
    seasonType: 2,
  });
  assert.ok(legacy);
  assert.equal(legacyCalls.filter((path) => path.endsWith("/player_designations")).length, 1);
  assert.equal(legacyCalls.filter((path) => path.endsWith("/player_injuries")).length, 5,
    "a valid fifth legacy page remains a silent fallback instead of a slate-wide failure");
  assert.equal(legacy?.[0]?.teams.reduce((sum, team) => sum + team.players.length, 0), 5);

  const normalized = __BALLDONTLIE_NFL_AVAILABILITY_TEST__.normalizeNflInjuryTeams([
    {
      player: { first_name: "Alex", last_name: "Example", team: { abbreviation: "TB" } },
      status: "Questionable",
      date: "2026-10-08T10:00:00.000Z",
    },
    {
      player: { first_name: "Alex", last_name: "Example", team: { abbreviation: "TB" } },
      status: "Out",
      date: "2026-10-08T12:00:00.000Z",
    },
  ], new Set(["TB"]));
  assert.equal(normalized[0]?.players.length, 1);
  assert.equal(normalized[0]?.players[0]?.status, "Out", "the newest duplicate player status must win");

  const prior: DailyEdgeGameAvailability = {
    eventId: "1392280",
    awayTeam: "TB",
    homeTeam: "DAL",
    source: "BALLDONTLIE",
    sourceLabel: "BALLDONTLIE NFL injury report",
    sourceUrl: null,
    reportUpdatedAt: "2026-10-08T11:00:00.000Z",
    teams: [
      { abbreviation: "TB", teamName: "Tampa Bay Buccaneers", players: [{ name: "Prior Buc", status: "Out", detail: null, position: "WR", reportedAt: "2026-10-08T11:00:00.000Z" }] },
      { abbreviation: "DAL", teamName: "Dallas Cowboys", players: [{ name: "Prior Cowboy", status: "Questionable", detail: null, position: "QB", reportedAt: "2026-10-08T10:00:00.000Z" }] },
    ],
  };
  const partial: DailyEdgeGameAvailability = {
    ...prior,
    reportUpdatedAt: "2026-10-08T13:00:00.000Z",
    teams: [
      { abbreviation: "TB", teamName: "Tampa Bay Buccaneers", players: [{ name: "Current Buc", status: "Questionable", detail: null, position: "RB", reportedAt: "2026-10-08T13:00:00.000Z" }] },
      { abbreviation: "DAL", teamName: "Dallas Cowboys", players: [] },
    ],
  };
  assert.deepEqual(mergeNflAvailabilityWithPrior(null, prior), prior);
  assert.deepEqual(
    mergeNflAvailabilityWithPrior({ ...partial, teams: partial.teams.map((team) => ({ ...team, players: [] })) }, prior),
    prior,
    "a successful empty response must not erase the last verified exact-game report",
  );
  const merged = mergeNflAvailabilityWithPrior(partial, prior);
  assert.equal(merged?.teams[0]?.players[0]?.name, "Current Buc");
  assert.equal(merged?.teams[1]?.players[0]?.name, "Prior Cowboy", "a partial team omission retains that team's prior unit");
  assert.equal(merged?.reportUpdatedAt, "2026-10-08T13:00:00.000Z");
  assert.equal(
    mergeNflAvailabilityWithPrior({ ...partial, eventId: "different" }, prior)?.eventId,
    "different",
    "continuity must not cross exact game identity",
  );

  console.log("BALLDONTLIE NFL availability: game-scoped designations, bounded legacy fallback, and exact-game omission continuity verified.");
}

function designationRow(args: {
  gameId: number;
  team: string;
  teamName: string;
  firstName: string;
  lastName: string;
  injury?: string;
  gameStatus?: string;
  practiceStatus?: string;
  updatedAt: string;
}): Record<string, unknown> {
  return {
    game_id: args.gameId,
    player: { first_name: args.firstName, last_name: args.lastName, position_abbreviation: "QB" },
    team: { abbreviation: args.team, full_name: args.teamName },
    practice_reports: args.practiceStatus ? [{ date: "2026-10-07", status: args.practiceStatus }] : [],
    injury: args.injury ?? null,
    game_status: args.gameStatus ?? null,
    active: null,
    did_not_play: null,
    updated_at: args.updatedAt,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
