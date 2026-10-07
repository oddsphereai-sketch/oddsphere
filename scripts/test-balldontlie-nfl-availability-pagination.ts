import assert from "node:assert/strict";
import {
  __BALLDONTLIE_NFL_AVAILABILITY_TEST__,
  fetchBalldontlieNflSlateAvailability,
  mergeNflAvailabilityWithPrior,
  NFL_INJURY_MAX_PAGES,
} from "../lib/services/football/balldontlieNflAvailability";
import type { DailyEdgeGameAvailability } from "../lib/services/dailyEdge/gameAvailability";

const calls: string[] = [];
const fetchImpl: typeof fetch = async (input) => {
  const url = new URL(String(input));
  calls.push(url.toString());
  const cursor = Number(url.searchParams.get("cursor") ?? "0");
  const page = cursor + 1;
  const hasNext = page < 5;
  const row = {
    player: {
      first_name: `Player${page}`,
      last_name: "Test",
      position_abbreviation: "WR",
      team: { abbreviation: page % 2 === 0 ? "BUF" : "DET", full_name: "Test Team" },
    },
    status: "Questionable",
    date: "2026-09-16T12:00:00.000Z",
  };
  return new Response(JSON.stringify({ data: [row], meta: { next_cursor: hasNext ? page : null } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

async function main(): Promise<void> {
  assert.equal(NFL_INJURY_MAX_PAGES, 8);
  const result = await fetchBalldontlieNflSlateAvailability([{
    id: "1392232",
    awayTeam: "DET",
    homeTeam: "BUF",
    awayTeamId: 8,
    homeTeamId: 4,
  }], { apiKey: "test", fetchImpl });

  assert.ok(result);
  assert.equal(calls.length, 5, "a valid fifth injury page must be consumed");
  assert.equal(result?.[0]?.eventId, "1392232");
  assert.deepEqual(result?.[0]?.teams.map((team) => team.abbreviation), ["DET", "BUF"]);
  assert.equal(result?.[0]?.teams.reduce((sum, team) => sum + team.players.length, 0), 5);

  const normalized = __BALLDONTLIE_NFL_AVAILABILITY_TEST__.normalizeNflInjuryTeams([
    {
      player: { first_name: "Alex", last_name: "Example", team: { abbreviation: "DET" } },
      status: "Questionable",
      date: "2026-09-16T10:00:00.000Z",
    },
    {
      player: { first_name: "Alex", last_name: "Example", team: { abbreviation: "DET" } },
      status: "Out",
      date: "2026-09-16T12:00:00.000Z",
    },
  ], new Set(["DET"]));
  assert.equal(normalized[0]?.players.length, 1);
  assert.equal(normalized[0]?.players[0]?.status, "Out", "the newest duplicate player status must win");

  const prior: DailyEdgeGameAvailability = {
    eventId: "1392232",
    awayTeam: "DET",
    homeTeam: "BUF",
    source: "BALLDONTLIE",
    sourceLabel: "BALLDONTLIE NFL injury report",
    sourceUrl: null,
    reportUpdatedAt: "2026-09-16T11:00:00.000Z",
    teams: [
      { abbreviation: "DET", teamName: "Detroit Lions", players: [{ name: "Prior Lion", status: "Out", detail: null, position: "WR", reportedAt: "2026-09-16T11:00:00.000Z" }] },
      { abbreviation: "BUF", teamName: "Buffalo Bills", players: [{ name: "Prior Bill", status: "Questionable", detail: null, position: "QB", reportedAt: "2026-09-16T10:00:00.000Z" }] },
    ],
  };
  const partial: DailyEdgeGameAvailability = {
    ...prior,
    reportUpdatedAt: "2026-09-16T13:00:00.000Z",
    teams: [
      { abbreviation: "DET", teamName: "Detroit Lions", players: [{ name: "Current Lion", status: "Questionable", detail: null, position: "RB", reportedAt: "2026-09-16T13:00:00.000Z" }] },
      { abbreviation: "BUF", teamName: "Buffalo Bills", players: [] },
    ],
  };
  assert.deepEqual(mergeNflAvailabilityWithPrior(null, prior), prior);
  assert.deepEqual(
    mergeNflAvailabilityWithPrior({ ...partial, teams: partial.teams.map((team) => ({ ...team, players: [] })) }, prior),
    prior,
    "a successful empty response must not erase the last verified exact-game report",
  );
  const merged = mergeNflAvailabilityWithPrior(partial, prior);
  assert.equal(merged?.teams[0]?.players[0]?.name, "Current Lion");
  assert.equal(merged?.teams[1]?.players[0]?.name, "Prior Bill", "a partial team omission retains that team's prior unit");
  assert.equal(merged?.reportUpdatedAt, "2026-09-16T13:00:00.000Z");
  assert.equal(
    mergeNflAvailabilityWithPrior({ ...partial, eventId: "different" }, prior)?.eventId,
    "different",
    "continuity must not cross exact game identity",
  );

  console.log("BALLDONTLIE NFL availability: bounded pagination, newest-status selection, and exact-game omission continuity verified.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
