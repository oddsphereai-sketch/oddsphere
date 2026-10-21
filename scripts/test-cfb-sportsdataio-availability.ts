import assert from "node:assert/strict";
import { fetchCfbSportsDataIoAvailability, parseCfbSportsDataIoAvailability } from "../lib/services/football/cfbSportsDataIoAvailability";
import type { NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";

const game: NcaafGame = {
  providerGameId: "south-alabama-marshall",
  providerWeek: 9,
  season: 2026,
  scheduledStart: "2026-10-21T23:00:00.000Z",
  status: "scheduled",
  awayScore: null,
  homeScore: null,
  away: { id: 1, conferenceId: 10, abbreviation: "USA", name: "South Alabama Jaguars", fbs: true },
  home: { id: 2, conferenceId: 10, abbreviation: "MRSH", name: "Marshall Thundering Herd", fbs: true },
};

async function main(): Promise<void> {
const parsed = parseCfbSportsDataIoAvailability({
  games: [game],
  capturedAt: "2026-10-21T12:00:00.000Z",
  teams: [
    { TeamID: 101, Key: "USA", School: "South Alabama", Name: "Jaguars", Active: true },
    { TeamID: 102, Key: "MRSH", School: "Marshall", Name: "Thundering Herd", Active: true },
  ],
  injuredPlayers: [
    { PlayerID: 500, TeamID: 102, FirstName: "John", LastName: "Quarterback", Position: "QB", InjuryStatus: "Out", InjuryBodyPart: "Shoulder", InjuryNotes: "Will not play", Updated: "2026-10-21T11:30:00Z" },
  ],
  requests: 2,
});
assert.equal(parsed.requests, 2);
assert.equal(parsed.unmatchedTeams.length, 0);
assert.equal(parsed.reportsByGame[game.providerGameId]?.source, "SportsDataIO");
assert.equal(parsed.reportsByGame[game.providerGameId]?.verifiedClear, false);
assert.equal(parsed.reportsByGame[game.providerGameId]?.teams[0]?.players.length, 0);
assert.equal(parsed.reportsByGame[game.providerGameId]?.teams[1]?.players[0]?.status, "Out");

const clear = parseCfbSportsDataIoAvailability({
  games: [game],
  capturedAt: "2026-10-21T12:00:00.000Z",
  teams: [
    { TeamID: 101, Key: "USA", School: "South Alabama", Active: true },
    { TeamID: 102, Key: "MRSH", School: "Marshall", Active: true },
  ],
  injuredPlayers: [],
});
assert.equal(clear.reportsByGame[game.providerGameId]?.verifiedClear, true);

const incompleteCatalog = parseCfbSportsDataIoAvailability({
  games: [game],
  capturedAt: "2026-10-21T12:00:00.000Z",
  teams: [{ TeamID: 101, Key: "USA", School: "South Alabama", Active: true }],
  injuredPlayers: [],
});
assert.equal(incompleteCatalog.reportsByGame[game.providerGameId], undefined);
assert.deepEqual(incompleteCatalog.unmatchedTeams, ["MRSH:Marshall Thundering Herd"]);

const requested: string[] = [];
const fetched = await fetchCfbSportsDataIoAvailability({
  games: [game],
  capturedAt: "2026-10-21T12:00:00.000Z",
  apiKey: "test-key",
  fetchImpl: (async (input, init) => {
    requested.push(String(input));
    assert.equal(new Headers(init?.headers).get("Ocp-Apim-Subscription-Key"), "test-key");
    const body = String(input).endsWith("/Teams")
      ? [{ TeamID: 101, Key: "USA", School: "South Alabama", Active: true }, { TeamID: 102, Key: "MRSH", School: "Marshall", Active: true }]
      : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch,
});
assert.equal(requested.length, 2);
assert.equal(fetched.reportsByGame[game.providerGameId]?.verifiedClear, true);

console.log("CFB SportsDataIO national availability tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
