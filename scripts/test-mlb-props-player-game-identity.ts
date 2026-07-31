import assert from "node:assert/strict";
import {
  playerBelongsToMappedGame,
  resolveEventScopedPlayerTeam,
} from "../lib/mlb/props/liveBoard";
import type { MlbGameEntity, MlbProbablePitcher } from "../lib/mlb/props/providers";

const game: MlbGameEntity = {
  id: "mlbstats-game-824809",
  providerIds: { mlbstats: 824809 },
  season: 2026,
  gameDate: "2026-07-31",
  scheduledStart: "2026-07-31T23:05:00.000Z",
  awayTeamId: "mlbstats-team-143",
  homeTeamId: "mlbstats-team-110",
  gameStatus: "scheduled",
};

const probablePitchers: MlbProbablePitcher[] = [{
  gameId: game.id,
  teamId: game.homeTeamId,
  playerId: "mlbstats-player-999",
  status: "announced",
  asOfTimestamp: "2026-07-31T13:00:00.000Z",
  provider: "MLB Stats",
  rawPayload: { player_name: "Official Starter" },
}];

const belongs = (overrides: Partial<Parameters<typeof playerBelongsToMappedGame>[0]> = {}) => playerBelongsToMappedGame({
  game,
  marketFamily: "batter",
  playerName: "Test Batter",
  playerTeamAbbreviation: "PHI",
  probablePitchers,
  ...overrides,
});

assert.equal(belongs(), true, "away-team hitters remain eligible");
assert.equal(belongs({ playerTeamAbbreviation: "BAL" }), true, "home-team hitters remain eligible");
assert.equal(belongs({ playerTeamAbbreviation: "DET" }), false, "nonparticipant hitter rows fail closed");
assert.equal(belongs({ playerTeamAbbreviation: null }), false, "unresolved hitter teams fail closed");
assert.equal(belongs({ playerName: null }), false, "unresolved player identities fail closed");
assert.equal(belongs({
  marketFamily: "pitcher",
  playerName: "Official Starter",
  playerTeamAbbreviation: "DET",
}), true, "official probable-pitcher assignment overrides a stale provider team");
assert.equal(belongs({
  marketFamily: "pitcher",
  playerName: "Different Pitcher",
  playerTeamAbbreviation: "DET",
}), false, "a non-probable pitcher with a nonparticipant team fails closed");

const athleticsGame: MlbGameEntity = {
  ...game,
  id: "mlbstats-game-det-ath",
  awayTeamId: "mlbstats-team-116",
  homeTeamId: "mlbstats-team-133",
};
assert.equal(belongs({
  game: athleticsGame,
  playerTeamAbbreviation: "OAK",
}), true, "legacy OAK provider identity resolves to the current Athletics team");
assert.equal(resolveEventScopedPlayerTeam({
  game: athleticsGame,
  playerTeamId: 8,
  providerAwayTeamId: 8,
  providerHomeTeamId: 22,
})?.abbreviation, "DET", "event-scoped provider team ids resolve the away participant");
assert.equal(resolveEventScopedPlayerTeam({
  game: athleticsGame,
  playerTeamId: 999,
  providerAwayTeamId: 8,
  providerHomeTeamId: 22,
}), null, "provider team ids outside the event fail closed");

console.log("PASS MLB props player/game identity gate rejects phantom matchups");
