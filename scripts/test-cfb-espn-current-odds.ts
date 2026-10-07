import assert from "node:assert/strict";
import { fetchCfbEspnCurrentOdds, normalizeCfbEspnCurrentOdds } from "../lib/services/football/cfbEspnCurrentOdds";
import type { NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";

async function main(): Promise<void> {
const capturedAt = "2026-10-07T17:40:00.000Z";
const game: NcaafGame = {
  providerGameId: "458387",
  providerWeek: 7,
  season: 2026,
  scheduledStart: "2026-10-10T17:00:00.000Z",
  status: "scheduled",
  awayScore: null,
  homeScore: null,
  away: { id: 1, conferenceId: 4, abbreviation: "ODU", name: "Old Dominion Monarchs", fbs: true },
  home: { id: 123, conferenceId: 4, abbreviation: "APP", name: "Appalachian State Mountaineers", fbs: true },
};

const event = {
  id: "401869843",
  date: game.scheduledStart,
  competitions: [{
    competitors: [
      { homeAway: "away", team: { id: "295" } },
      { homeAway: "home", team: { id: "2026" } },
    ],
    odds: [{
      provider: { name: "Draft Kings" },
      moneyline: { away: { close: { odds: "+295" } }, home: { close: { odds: "-375" } } },
      pointSpread: { away: { close: { line: "+9.5", odds: "-105" } }, home: { close: { line: "-9.5", odds: "-115" } } },
      total: { over: { close: { line: "o49.5", odds: "-115" } }, under: { close: { line: "u49.5", odds: "-105" } } },
    }],
  }],
};

const normalized = normalizeCfbEspnCurrentOdds(event, game.providerGameId, capturedAt);
assert.ok(normalized);
assert.equal(normalized.provider, "espn");
assert.equal(normalized.sportsbook, "DraftKings");
assert.deepEqual(normalized.moneyline, { awayPrice: 295, homePrice: -375 });
assert.deepEqual(normalized.spread, { awayLine: 9.5, awayPrice: -105, homeLine: -9.5, homePrice: -115 });
assert.deepEqual(normalized.total, { line: 49.5, overPrice: -115, underPrice: -105 });
assert.equal(normalized.marketQuotes?.length, 6);

const incoherentTotal = structuredClone(event);
incoherentTotal.competitions[0]!.odds[0]!.total.under.close.line = "u50.5";
assert.equal(normalizeCfbEspnCurrentOdds(incoherentTotal, game.providerGameId, capturedAt)?.total, null, "an incoherent total pair must not become a verified market");

let calls = 0;
const result = await fetchCfbEspnCurrentOdds({
  games: [game],
  capturedAt,
  fetchImpl: async () => {
    calls += 1;
    return new Response(JSON.stringify({ events: [event] }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
assert.equal(calls, 1);
assert.equal(result.requests, 1);
assert.equal(result.matchedGames, 1);
assert.equal(result.booksByGame[game.providerGameId]?.[0]?.moneyline?.homePrice, -375);

const wrongIdentity = structuredClone(event);
wrongIdentity.competitions[0]!.competitors[1]!.team.id = "999999";
const missing = await fetchCfbEspnCurrentOdds({
  games: [game],
  capturedAt,
  fetchImpl: async () => new Response(JSON.stringify({ events: [wrongIdentity] }), { status: 200 }),
});
assert.equal(missing.matchedGames, 0);
assert.equal(missing.failuresByGame[game.providerGameId], "strict_event_not_found");

const fcsOnly = { ...game, providerGameId: "fcs", away: { ...game.away, fbs: false }, home: { ...game.home, fbs: false } };
const skipped = await fetchCfbEspnCurrentOdds({
  games: [fcsOnly],
  capturedAt,
  fetchImpl: async () => { throw new Error("FCS-only fallback must not call ESPN"); },
});
assert.equal(skipped.requests, 0);
assert.equal(skipped.attemptedGames, 0);

console.log("CFB ESPN current-odds fallback tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
