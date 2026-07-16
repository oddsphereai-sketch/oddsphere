import { BallDontLieProvider } from "../lib/providers/real_api/BallDontLieProvider";
import { BallDontLieResearchClient } from "../lib/mlb/props/ballDontLieResearch";
import { BallDontLieMlbPropsClient } from "../lib/mlb/props/providerClients";

const originalFetch = globalThis.fetch;
const calls: string[] = [];

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  calls.push(`${url.pathname}${url.search}`);
  const playerIds = url.searchParams.getAll("player_ids[]").map(Number);
  const gameIds = url.searchParams.getAll("game_ids[]").map(Number);
  if (url.pathname.endsWith("/players")) {
    return json(playerIds.map((id) => ({
      id,
      full_name: `Player ${id}`,
      bats_throws: "R/R",
      position: "OF",
      team: { abbreviation: "NYM" },
    })));
  }
  if (url.pathname.endsWith("/pitcher_pitch_type_season_stats")) {
    return json(playerIds.map((id) => pitchRow(id, true)));
  }
  if (url.pathname.endsWith("/hitter_pitch_type_season_stats")) {
    return json(playerIds.map((id) => pitchRow(id, false)));
  }
  if (url.pathname.endsWith("/lineups")) {
    return json(gameIds.map((id) => ({
      game_id: id,
      team: { id: id * 10 },
      player: { id: id * 100 },
      batting_order: 1,
      position: "CF",
      is_confirmed: true,
    })));
  }
  if (url.pathname.endsWith("/odds/player_props/opening")) {
    const gameId = Number(url.searchParams.get("game_id"));
    return json([{
      id: gameId * 1000,
      game_id: gameId,
      player_id: gameId * 100,
      vendor: "draftkings",
      prop_type: "hits",
      line_value: "0.5",
      market: { type: "over_under", over_odds: -115, under_odds: -105 },
      opened_at: "2026-07-16T12:00:00.000Z",
    }]);
  }
  return new Response(JSON.stringify({ data: [] }), { status: 404 });
};

async function main() {
try {
  const fullSlatePlayers = range(1, 320);
  const fullSlatePitchers = range(1, 40);
  const fullSlateHitters = range(1, 280);
  const fullSlateGames = range(1, 16);
  const research = new BallDontLieResearchClient("test-key");
  const players = await research.getPlayersByIds(fullSlatePlayers);
  const pitcherPitches = await research.getPitcherPitchTypesForPlayers({ playerIds: fullSlatePitchers, season: 2026 });
  const hitterPitches = await research.getHitterPitchTypesForPlayers({ playerIds: fullSlateHitters, season: 2026 });
  assert(players.size === 320, "16-game fixture retains every player identity");
  assert(pitcherPitches.size === 40, "16-game fixture retains every pitcher profile");
  assert(hitterPitches.size === 280, "16-game fixture retains every hitter profile");
  assert(research.getClient().getRequestCount() === 13, "16-game research fixture stays within 13 BDL requests");

  const lineupProvider = new BallDontLieProvider("test-key");
  const lineups = await lineupProvider.getLineupsForGames(fullSlateGames);
  assert(lineups.length === 16, "16-game fixture retains every lineup");
  assert(lineupProvider.getClient().getRequestCount() === 1, "16-game lineups stay within one BDL request");

  const oddsProvider = new BallDontLieMlbPropsClient("test-key");
  const openingOdds = await oddsProvider.getOpeningPropOdds({ gameIds: fullSlateGames.map(String) });
  assert(openingOdds.length === 32, "16-game opening feed retains both sides for every game");
  assert(oddsProvider.getClient().getRequestCount() === 16, "16-game opening feed uses one request per game");

  console.log(JSON.stringify({
    passed: 8,
    researchRequests: research.getClient().getRequestCount(),
    lineupRequests: lineupProvider.getClient().getRequestCount(),
    openingOddsRequests: oddsProvider.getClient().getRequestCount(),
    totalRequests: calls.length,
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function pitchRow(playerId: number, pitcher: boolean) {
  return {
    player_id: playerId,
    pitch_type: "FF",
    pitch_name: "4-Seam Fastball",
    pitch_count: 100,
    pitch_usage_percent: pitcher ? 50 : undefined,
    last_game_date: "2026-07-14",
  };
}

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { next_cursor: null, per_page: 100 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}
