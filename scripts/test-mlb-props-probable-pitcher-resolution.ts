import assert from "node:assert/strict";
import { resolveMlbPropsProbablePitchers } from "../lib/mlb/props/probablePitcherResolution";
import type { MlbGameEntity, MlbProbablePitcher } from "../lib/mlb/props/providers";

const game: MlbGameEntity = {
  id: "mlbstats-game-1",
  providerIds: { mlbstats: 1 },
  season: 2026,
  gameDate: "2026-08-11",
  scheduledStart: "2026-08-11T23:05:00.000Z",
  awayTeamId: "mlbstats-team-112",
  homeTeamId: "mlbstats-team-120",
  gameStatus: "scheduled",
};

function probable(teamId: string, playerId: string | null, name?: string): MlbProbablePitcher {
  return {
    gameId: game.id,
    teamId,
    playerId,
    status: playerId ? "announced" : "unannounced",
    asOfTimestamp: "2026-08-11T14:00:00.000Z",
    provider: "mlbstats",
    rawPayload: name ? { probablePitcher: { fullName: name } } : {},
  };
}

const espn = async () => new Map([["CHC@WSH", {
  espnEventId: 401816480,
  homeTeamAbbr: "WSH",
  awayTeamAbbr: "CHC",
  home: { fullName: "Jake Irvin", espnAthleteId: 41290 },
  away: { fullName: "Shota Imanaga", espnAthleteId: 5134630 },
}]]);

const roster = async (teamId: number) => teamId === 120
  ? [{ personId: 663623, fullName: "Jake Irvin", positionAbbreviation: "P", positionType: "Pitcher", status: "Active" }]
  : [{ personId: 684007, fullName: "Shota Imanaga", positionAbbreviation: "P", positionType: "Pitcher", status: "Active" }];

async function main() {
const filled = await resolveMlbPropsProbablePitchers({
  games: [game],
  mlbStatsProbablePitchers: [
    probable(game.awayTeamId, "mlbstats-player-684007", "Shota Imanaga"),
    probable(game.homeTeamId, null),
  ],
  slateDate: "2026-08-11",
  asOfTimestamp: "2026-08-11T14:05:00.000Z",
  dependencies: { fetchEspn: espn, loadRoster: roster, resolveBdlPlayerId: async () => 555 },
});
assert.equal(filled.fallbackAssignments.length, 1);
assert.deepEqual(filled.fallbackAssignments[0], {
  gameId: game.id,
  teamId: game.homeTeamId,
  playerId: "mlbstats-player-663623",
  playerName: "Jake Irvin",
  provider: "espn_scoreboard",
});
assert.equal(filled.probablePitchers.find((row) => row.teamId === game.homeTeamId)?.provider, "espn_scoreboard");
assert.equal((filled.probablePitchers.find((row) => row.teamId === game.homeTeamId)?.rawPayload as { bdl_player_id?: number }).bdl_player_id, 555);

const disabled = await resolveMlbPropsProbablePitchers({
  games: [game],
  mlbStatsProbablePitchers: [probable(game.awayTeamId, null), probable(game.homeTeamId, null)],
  slateDate: "2026-08-11",
  asOfTimestamp: "2026-08-11T14:07:00.000Z",
  fallbackEnabled: false,
  dependencies: { fetchEspn: espn, loadRoster: roster },
});
assert.equal(disabled.fallbackAssignments.length, 0, "operator kill switch preserves the official-only slate");

const recoveredHost = await resolveMlbPropsProbablePitchers({
  games: [game],
  mlbStatsProbablePitchers: [probable(game.awayTeamId, "mlbstats-player-684007", "Shota Imanaga"), probable(game.homeTeamId, null)],
  slateDate: "2026-08-11",
  asOfTimestamp: "2026-08-11T14:08:00.000Z",
  dependencies: {
    fetchEspn: async () => new Map(),
    fetchAlternativeEspn: espn,
    loadRoster: roster,
    resolveBdlPlayerId: async () => 555,
  },
});
assert.equal(recoveredHost.fallbackAssignments.length, 1, "equivalent official ESPN host recovers an empty primary response");
assert.equal(filled.probablePitchers.find((row) => row.teamId === game.awayTeamId)?.provider, "mlbstats");

let fallbackFetches = 0;
const confirmed = await resolveMlbPropsProbablePitchers({
  games: [game],
  mlbStatsProbablePitchers: [
    probable(game.awayTeamId, "mlbstats-player-684007", "Shota Imanaga"),
    probable(game.homeTeamId, "mlbstats-player-663623", "Jake Irvin"),
  ],
  slateDate: "2026-08-11",
  asOfTimestamp: "2026-08-11T14:10:00.000Z",
  dependencies: {
    fetchEspn: async () => {
      fallbackFetches++;
      return new Map();
    },
    loadRoster: roster,
  },
});
assert.equal(fallbackFetches, 0, "MLB Stats coverage bypasses the fallback fetch");
assert.equal(confirmed.fallbackAssignments.length, 0);
assert.ok(confirmed.probablePitchers.every((row) => row.provider === "mlbstats"));

const ambiguous = await resolveMlbPropsProbablePitchers({
  games: [game],
  mlbStatsProbablePitchers: [probable(game.awayTeamId, null), probable(game.homeTeamId, null)],
  slateDate: "2026-08-11",
  asOfTimestamp: "2026-08-11T14:15:00.000Z",
  dependencies: {
    fetchEspn: espn,
    loadRoster: async () => [
      { personId: 1, fullName: "Jake Irvin", positionAbbreviation: "P", positionType: "Pitcher", status: "Active" },
      { personId: 2, fullName: "Jake Irvin", positionAbbreviation: "P", positionType: "Pitcher", status: "Active" },
    ],
  },
});
assert.equal(ambiguous.fallbackAssignments.length, 0, "ambiguous roster mappings fail closed");

const doubleheader = await resolveMlbPropsProbablePitchers({
  games: [game, { ...game, id: "mlbstats-game-2", scheduledStart: "2026-08-12T02:05:00.000Z" }],
  mlbStatsProbablePitchers: [probable(game.awayTeamId, null), probable(game.homeTeamId, null)],
  slateDate: "2026-08-11",
  asOfTimestamp: "2026-08-11T14:20:00.000Z",
  dependencies: { fetchEspn: espn, loadRoster: roster },
});
assert.equal(doubleheader.fallbackAssignments.length, 0, "team-pair fallback never guesses between doubleheader games");

console.log("MLB props probable-pitcher resolution: 10 checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
