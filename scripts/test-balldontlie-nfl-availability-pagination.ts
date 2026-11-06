import assert from "node:assert/strict";
import {
  __BALLDONTLIE_NFL_AVAILABILITY_TEST__,
  fetchBalldontlieNflSlateAvailability,
  mergeNflAvailabilityWithPrior,
  nflAvailabilityRequestBudgetMaximum,
  NFL_AVAILABILITY_TRANSIENT_RETRIES_PER_BATCH,
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
  assert.equal(NFL_AVAILABILITY_TRANSIENT_RETRIES_PER_BATCH, 2);
  const matchup = {
    id: "nfl-1392280",
    awayTeam: "TB",
    homeTeam: "DAL",
    awayTeamId: 28,
    homeTeamId: 19,
  };
  assert.equal(nflAvailabilityRequestBudgetMaximum([matchup]), 20);

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

  const partialBatchMatchups = Array.from({ length: 5 }, (_, index) => ({
    id: `partial-${index}`,
    awayTeam: `A${index}`,
    homeTeam: `H${index}`,
    awayTeamId: index * 2 + 1,
    homeTeamId: index * 2 + 2,
  }));
  const partialBatchCalls: string[][] = [];
  const partialBatchFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const teamIds = url.searchParams.getAll("team_ids[]");
    partialBatchCalls.push([url.pathname, ...teamIds]);
    if (url.pathname.endsWith("/player_designations") && teamIds.includes("9")) {
      return new Response("rate limited", { status: 429, headers: { "content-type": "text/plain" } });
    }
    return jsonResponse({ data: [], meta: { next_cursor: null } });
  };
  const partialBatch = await fetchBalldontlieNflSlateAvailability(partialBatchMatchups, {
    apiKey: "test",
    fetchImpl: partialBatchFetch,
    season: 2026,
    week: 5,
    seasonType: 2,
  });
  assert.equal(partialBatch?.length, 5,
    "one failed designation batch must fall back only for its unresolved games instead of invalidating the slate");
  assert.deepEqual(partialBatchCalls, [
    ["/nfl/v1/player_designations", "1", "2", "3", "4", "5", "6", "7", "8"],
    ["/nfl/v1/player_designations", "9", "10"],
    ["/nfl/v1/player_designations", "9", "10"],
    ["/nfl/v1/player_designations", "9", "10"],
    ["/nfl/v1/player_injuries", "9", "10"],
  ], "provider batches must be sequential and unresolved teams alone use the legacy fallback");

  let transientAttempts = 0;
  const transientRetry = await fetchBalldontlieNflSlateAvailability([matchup], {
    apiKey: "test",
    season: 2026,
    week: 5,
    seasonType: 2,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/player_injuries")) {
        throw new Error("legacy fallback must not run after a recovered designation request");
      }
      transientAttempts += 1;
      if (transientAttempts === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "content-type": "text/plain", "retry-after": "0" },
        });
      }
      return jsonResponse({
        data: [designationRow({
          gameId: 1392280,
          team: "TB",
          teamName: "Tampa Bay Buccaneers",
          firstName: "Baker",
          lastName: "Mayfield",
          gameStatus: "out",
          updatedAt: "2026-10-15T21:30:05.381Z",
        })],
        meta: { next_cursor: null },
      });
    },
  });
  assert.equal(transientAttempts, 2, "a transient designation failure receives a bounded retry");
  assert.equal(transientRetry?.length, 1);
  assert.equal(transientRetry?.[0]?.teams[0]?.players[0]?.name, "Baker Mayfield");

  const clearReport = __BALLDONTLIE_NFL_AVAILABILITY_TEST__.normalizeNflDesignationGames([
    designationRow({
      gameId: 1392280,
      team: "TB",
      teamName: "Tampa Bay Buccaneers",
      firstName: "Healthy",
      lastName: "Player",
      practiceStatus: "full",
      updatedAt: "2026-10-15T21:30:05.381Z",
    }),
    designationRow({
      gameId: 1392280,
      team: "DAL",
      teamName: "Dallas Cowboys",
      firstName: "Another Healthy",
      lastName: "Player",
      practiceStatus: "full",
      updatedAt: "2026-10-15T21:30:05.381Z",
    }),
  ], [matchup]);
  assert.equal(clearReport[0]?.verifiedClear, true);
  assert.equal(clearReport[0]?.reportUpdatedAt, "2026-10-15T21:30:05.381Z");
  assert.equal(clearReport[0]?.teams.reduce((sum, team) => sum + team.players.length, 0), 0);
  const oneSidedClearReport = __BALLDONTLIE_NFL_AVAILABILITY_TEST__.normalizeNflDesignationGames([
    designationRow({
      gameId: 1392280,
      team: "TB",
      teamName: "Tampa Bay Buccaneers",
      firstName: "Healthy",
      lastName: "Player",
      practiceStatus: "full",
      updatedAt: "2026-10-15T21:30:05.381Z",
    }),
  ], [matchup]);
  assert.equal(oneSidedClearReport[0]?.verifiedClear, false,
    "a one-team provider omission cannot verify the entire matchup clear");

  const currentPracticeOverridesAmbiguousActive = __BALLDONTLIE_NFL_AVAILABILITY_TEST__.normalizeNflDesignationGames([
    designationRow({
      gameId: 1392280,
      team: "TB",
      teamName: "Tampa Bay Buccaneers",
      firstName: "Expected",
      lastName: "Starter",
      injury: "Elbow",
      practiceStatus: "limited",
      active: false,
      updatedAt: "2026-10-15T21:30:05.381Z",
    }),
  ], [matchup]);
  assert.equal(currentPracticeOverridesAmbiguousActive[0]?.teams[0]?.players[0]?.status, "Limited",
    "a current exact-game practice designation must not be replaced by the provider's ambiguous active=false field");
  const explicitGameStatusWins = __BALLDONTLIE_NFL_AVAILABILITY_TEST__.normalizeNflDesignationGames([
    designationRow({
      gameId: 1392280,
      team: "TB",
      teamName: "Tampa Bay Buccaneers",
      firstName: "Unavailable",
      lastName: "Starter",
      injury: "Elbow",
      gameStatus: "out",
      practiceStatus: "limited",
      active: false,
      updatedAt: "2026-10-15T21:30:05.381Z",
    }),
  ], [matchup]);
  assert.equal(explicitGameStatusWins[0]?.teams[0]?.players[0]?.status, "Out");
  const activeFallback = __BALLDONTLIE_NFL_AVAILABILITY_TEST__.normalizeNflDesignationGames([
    designationRow({
      gameId: 1392280,
      team: "TB",
      teamName: "Tampa Bay Buccaneers",
      firstName: "Inactive",
      lastName: "Fallback",
      active: false,
      updatedAt: "2026-10-15T21:30:05.381Z",
    }),
  ], [matchup]);
  assert.equal(activeFallback[0]?.teams[0]?.players[0]?.status, "Inactive",
    "active=false remains a conservative fallback when no current game or practice status exists");

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
  const verifiedClear = {
    ...partial,
    verifiedClear: true,
    teams: partial.teams.map((team) => ({ ...team, players: [] })),
  };
  assert.deepEqual(
    mergeNflAvailabilityWithPrior(verifiedClear, prior),
    verifiedClear,
    "exact-game designation rows that verify a clear report replace an older non-clear report",
  );
  assert.deepEqual(
    mergeNflAvailabilityWithPrior(verifiedClear, null),
    verifiedClear,
    "a verified clear report remains available even without a prior non-empty report",
  );
  const merged = mergeNflAvailabilityWithPrior(partial, prior);
  assert.equal(merged?.teams[0]?.players[0]?.name, "Current Buc");
  assert.equal(merged?.teams[0]?.players.find(player => player.name === "Prior Buc")?.status, "Out",
    "another teammate's fresh injury must not erase an omitted player from a non-empty team report");
  assert.equal(merged?.teams[1]?.players[0]?.name, "Prior Cowboy", "a partial team omission retains that team's prior unit");
  assert.equal(merged?.reportUpdatedAt, "2026-10-08T13:00:00.000Z");
  assert.deepEqual(mergeNflAvailabilityWithPrior({ ...verifiedClear, reportUpdatedAt: "2026-10-08T09:00:00.000Z" }, prior), prior,
    "an older whole-game clear cannot erase newer injuries");
  assert.equal(mergeNflAvailabilityWithPrior(prior, verifiedClear)?.teams.flatMap(team => team.players).length, 0,
    "older injury rows cannot resurrect after a newer verified legacy whole-game clear");
  const afterLegacyClear = mergeNflAvailabilityWithPrior(prior, verifiedClear)!;
  assert.equal(mergeNflAvailabilityWithPrior(prior, afterLegacyClear)?.teams.flatMap(team => team.players).length, 0,
    "the original legacy clearance clock must survive repeated stale refreshes");
  const staleStatus = { ...partial, teams: [{ ...partial.teams[0]!, players: [{ ...prior.teams[0]!.players[0]!,
    status: "Questionable", reportedAt: "2026-10-08T09:00:00.000Z" }] }, partial.teams[1]!] };
  assert.equal(mergeNflAvailabilityWithPrior(staleStatus, prior)?.teams[0]?.players[0]?.status, "Out",
    "a later fetch cannot replace a player's newer native report with an older status");
  const clearOnePlayer: DailyEdgeGameAvailability = {
    ...partial,
    playerClearances: [{ teamAbbreviation: "TB", name: "Prior Buc", reportedAt: "2026-10-08T14:00:00.000Z" }],
  };
  const individuallyCleared = mergeNflAvailabilityWithPrior(clearOnePlayer, prior)!;
  assert.equal(individuallyCleared.teams[0]?.players.some(player => player.name === "Prior Buc"), false,
    "a newer exact-player clearance releases that player's prior injury without pinning it forever");
  assert.equal(individuallyCleared.teams[1]?.players[0]?.name, "Prior Cowboy",
    "one clearance cannot clear a different team or player");
  assert.equal(mergeNflAvailabilityWithPrior(staleStatus, individuallyCleared)?.teams[0]?.players.some(player => player.name === "Prior Buc"), false,
    "an old injury cannot reappear after a newer stored exact-player clearance");
  const newOut = { ...staleStatus, teams: [{ ...staleStatus.teams[0]!, players: [{ ...staleStatus.teams[0]!.players[0]!,
    status: "Out", reportedAt: "2026-10-08T15:00:00.000Z" }] }, staleStatus.teams[1]!] };
  assert.equal(mergeNflAvailabilityWithPrior(newOut, individuallyCleared)?.teams[0]?.players[0]?.status, "Out",
    "a genuine later injury supersedes an earlier clearance");
  const unrelatedClear = { ...verifiedClear, playerClearances: clearReport[0]!.playerClearances };
  assert.equal(mergeNflAvailabilityWithPrior(unrelatedClear, prior)?.teams.flatMap(team => team.players).length, 2,
    "healthy rows for unrelated teammates do not clear omitted previously injured players");
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
  active?: boolean;
  didNotPlay?: boolean;
  updatedAt: string;
}): Record<string, unknown> {
  return {
    game_id: args.gameId,
    player: { first_name: args.firstName, last_name: args.lastName, position_abbreviation: "QB" },
    team: { abbreviation: args.team, full_name: args.teamName },
    practice_reports: args.practiceStatus ? [{ date: "2026-10-07", status: args.practiceStatus }] : [],
    injury: args.injury ?? null,
    game_status: args.gameStatus ?? null,
    active: args.active ?? null,
    did_not_play: args.didNotPlay ?? null,
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
