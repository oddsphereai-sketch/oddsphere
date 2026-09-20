import assert from "node:assert/strict";
import {
  CFB_ESPN_REFERENCE_LINE_RELEASE,
  fetchCfbEspnReferenceLines,
  normalizeCfbEspnOpeningLine,
} from "../lib/services/football/cfbEspnReferenceLine";
import type { NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";

const game: NcaafGame = {
  providerGameId: "458941",
  providerWeek: 4,
  season: 2026,
  scheduledStart: "2026-09-19T16:00:00.000Z",
  status: "scheduled",
  awayScore: null,
  homeScore: null,
  away: { id: 1, conferenceId: null, abbreviation: "VILL", name: "Villanova Wildcats", fbs: false },
  home: { id: 2, conferenceId: null, abbreviation: "LIU", name: "Long Island University Sharks", fbs: false },
};
const tcuGame: NcaafGame = {
  ...game,
  providerGameId: "457287",
  scheduledStart: "2026-09-26T19:30:00.000Z",
  away: { ...game.away, abbreviation: "TCU", name: "TCU Horned Frogs" },
  home: { ...game.home, abbreviation: "UCF", name: "UCF Knights" },
};

const pickcenter = {
  pickcenter: [{
    provider: { name: "DraftKings" },
    pointSpread: {
      home: { open: { line: "+18.5", odds: "-110" } },
      away: { open: { line: "-18.5", odds: "-113" } },
    },
    total: {
      over: { open: { line: "o45.5", odds: "-110" } },
      under: { open: { line: "u45.5", odds: "-113" } },
    },
  }],
};

const normalized = normalizeCfbEspnOpeningLine(pickcenter, "401867908", "2026-09-19T12:00:00.000Z");
assert.deepEqual(normalized, {
  release: CFB_ESPN_REFERENCE_LINE_RELEASE,
  provider: "espn",
  sportsbook: "DraftKings",
  providerEventId: "401867908",
  capturedAt: "2026-09-19T12:00:00.000Z",
  lineType: "opening",
  homeSpread: 18.5,
  awaySpread: -18.5,
  total: 45.5,
});
assert.equal(normalizeCfbEspnOpeningLine({ pickcenter: [{ ...pickcenter.pickcenter[0], total: null }] }, "1", "2026-09-19T12:00:00Z"), null);

async function main(): Promise<void> {
let requests = 0;
const fetchImpl = (async (input: string | URL | Request) => {
  requests += 1;
  const url = String(input);
  const payload = url.includes("/summary?") ? pickcenter : {
    events: [{
      id: "401867908",
      date: "2026-09-19T16:30:00.000Z",
      competitions: [{ competitors: [
        { homeAway: "away", team: { id: "222" } },
        { homeAway: "home", team: { id: "2341" } },
      ] }],
    }, {
      id: "401856815",
      date: tcuGame.scheduledStart,
      competitions: [{ competitors: [
        { homeAway: "away", team: { id: "2628" } },
        { homeAway: "home", team: { id: "2116" } },
      ] }],
    }],
  };
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
const result = await fetchCfbEspnReferenceLines({ games: [game], capturedAt: "2026-09-19T12:00:00.000Z", fetchImpl });
assert.equal(result.matchedGames, 1);
assert.equal(result.attemptedGames, 1);
assert.equal(result.linesByGame[game.providerGameId]?.total, 45.5);
assert.equal(result.requests, requests);
assert.ok(result.requests <= 5, "one game is bounded to duplicate-group scoreboards plus one summary");
const overrideIdentity = await fetchCfbEspnReferenceLines({ games: [tcuGame], capturedAt: "2026-09-20T12:00:00.000Z", fetchImpl });
assert.equal(overrideIdentity.matchedGames, 1, "the verified TCU ESPN identity override must match the exact scheduled event");

const ambiguousFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes("/summary?")) return new Response(JSON.stringify(pickcenter), { status: 200 });
  const event = {
    id: url.includes("groups=80") ? "one" : "two",
    date: game.scheduledStart,
    competitions: [{ competitors: [
      { homeAway: "away", team: { id: "222" } },
      { homeAway: "home", team: { id: "2341" } },
    ] }],
  };
  return new Response(JSON.stringify({ events: [event] }), { status: 200 });
}) as typeof fetch;
const ambiguous = await fetchCfbEspnReferenceLines({ games: [game], capturedAt: "2026-09-19T12:00:00.000Z", fetchImpl: ambiguousFetch });
assert.equal(ambiguous.matchedGames, 0);
assert.equal(ambiguous.failuresByGame[game.providerGameId], "strict_event_ambiguous");

console.log("CFB ESPN reference line: strict identity, opening normalization, schedule tolerance, and request bounds passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
