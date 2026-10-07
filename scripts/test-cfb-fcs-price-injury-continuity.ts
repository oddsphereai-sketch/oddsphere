import assert from "node:assert/strict";
import { fetchCfbCollegeFootballDataLines } from "../lib/services/football/cfbCollegeFootballDataLines";
import { buildCfbGameAvailability } from "../lib/services/football/cfbGameAvailability";
import { parseCfbOfficialConferenceAvailability } from "../lib/services/football/cfbOfficialConferenceAvailability";
import { shouldFetchCfbCollegeFootballDataLines, shouldFetchCfbOfficialConferenceAvailability } from "../lib/services/football/cfbForwardEvidenceWriter";
import { addCfbFallbackBooksWithoutReplacement, buildCfbNamedBookPriceHierarchy } from "../lib/services/football/cfbSharpApiOdds";
import type { NcaafBookOdds, NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";

const game: NcaafGame = {
  providerGameId: "fcs-1",
  providerWeek: 6,
  season: 2026,
  scheduledStart: "2026-10-10T19:30:00.000Z",
  status: "scheduled",
  awayScore: null,
  homeScore: null,
  away: { id: 901, conferenceId: null, abbreviation: "ALP", name: "Alpha Wolves", fbs: false },
  home: { id: 902, conferenceId: null, abbreviation: "BET", name: "Beta Bears", fbs: false },
};

async function main(): Promise<void> {
const cfbd = await fetchCfbCollegeFootballDataLines({
  games: [game],
  capturedAt: "2026-10-07T16:00:00.000Z",
  apiKey: "test",
  fetchImpl: async () => Response.json([{
    id: 123,
    season: 2026,
    week: 6,
    startDate: game.scheduledStart,
    awayTeam: "Alpha",
    homeTeam: "Beta",
    lines: [{
      provider: "DraftKings",
      spread: -3.5,
      spreadOpen: -2.5,
      overUnder: 48.5,
      overUnderOpen: 47.5,
      awayMoneyline: 135,
      homeMoneyline: -155,
    }],
  }]),
});
assert.equal(cfbd.requests, 1);
assert.equal(cfbd.matchedGames, 1);
assert.deepEqual(cfbd.moneylineBooksByGame[game.providerGameId]?.[0]?.moneyline, { awayPrice: 135, homePrice: -155 });
assert.equal(cfbd.moneylineBooksByGame[game.providerGameId]?.[0]?.targetEligible, true);
assert.deepEqual(cfbd.contextLineByGame[game.providerGameId], {
  provider: "collegefootballdata",
  sportsbook: "DraftKings",
  providerEventId: "123",
  capturedAt: "2026-10-07T16:00:00.000Z",
  awayMoneyline: 135,
  homeMoneyline: -155,
  awaySpread: 3.5,
  homeSpread: -3.5,
  total: 48.5,
  awaySpreadOpen: 2.5,
  homeSpreadOpen: -2.5,
  totalOpen: 47.5,
});

const paidBook: NcaafBookOdds = {
  providerGameId: game.providerGameId,
  sportsbook: "DraftKings",
  observedAt: "2026-10-07T15:00:00.000Z",
  provider: "balldontlie",
  targetEligible: true,
  moneyline: { awayPrice: 140, homePrice: -160 },
  spread: null,
  total: null,
};
const preserved = addCfbFallbackBooksWithoutReplacement(
  [paidBook],
  cfbd.moneylineBooksByGame[game.providerGameId] ?? [],
);
assert.equal(preserved.length, 1);
assert.equal(preserved[0]?.provider, "balldontlie");
assert.deepEqual(preserved[0]?.moneyline, paidBook.moneyline, "fallback must not replace the paid provider's same book");
const sharpBook: NcaafBookOdds = {
  ...paidBook,
  sportsbook: "Pinnacle",
  provider: "sharpapi",
  observedAt: "2026-10-07T15:05:00.000Z",
};
const hierarchy = buildCfbNamedBookPriceHierarchy(
  [paidBook],
  [sharpBook, { ...paidBook, provider: "sharpapi", observedAt: "2026-10-07T15:05:00.000Z" }],
  cfbd.moneylineBooksByGame[game.providerGameId] ?? [],
);
assert.deepEqual(Object.fromEntries(hierarchy.map((book) => [book.sportsbook, book.provider])), {
  DraftKings: "balldontlie",
  Pinnacle: "sharpapi",
}, "paid, SharpAPI, and CFBD fallback authority must be stable");

const official = parseCfbOfficialConferenceAvailability({
  games: [game],
  capturedAt: "2026-10-07T23:30:00.000Z",
  sourceUrl: "https://conference.test/reports",
  json: {
    report1: {
      ReportType: "Initial",
      conferenceTimeZone: "ET",
      publishDate: "2026-10-07",
      postedTime: "19:10:00",
      footer: { date: "2026-10-10", time: "15:30:00" },
      games: [
        { teamDisplayName: "Alpha Wolves", teamName: "Alpha Wolves", rows: [
          { name: "QB #12 Alex Able", status: "Questionable" },
          { name: "WR #2 Wyatt Well", status: "Available" },
        ] },
        { teamDisplayName: "Beta Bears", teamName: "Beta Bears", rows: [
          { name: "LT #71 Ben Block", status: "Out" },
          { name: "LB #5 Eli Exempt", status: "Exempt" },
        ] },
      ],
    },
    pending: {
      ReportType: "Report Pending",
      footer: { date: "2026-10-10" },
      games: [{ teamDisplayName: "Alpha Wolves", rows: [] }, { teamDisplayName: "Beta Bears", rows: [] }],
    },
  },
});
assert.equal(Object.keys(official).length, 1);
assert.equal(official[game.providerGameId]?.teams[0]?.players[0]?.name, "Alex Able");
assert.equal(official[game.providerGameId]?.teams[0]?.players[0]?.position, "QB");
assert.equal(official[game.providerGameId]?.teams[1]?.players[0]?.status, "Out");
assert.equal(official[game.providerGameId]?.teams[0]?.players.length, 1, "available full-roster rows must not populate the injury panel");

const retained = buildCfbGameAvailability({
  game,
  capturedAt: "2026-10-07T23:30:00.000Z",
  playbookRows: [],
  conferenceReport: official[game.providerGameId],
  previous: null,
});
assert.equal(retained?.source, "Conference");

const playbook = buildCfbGameAvailability({
  game,
  capturedAt: "2026-10-07T23:30:00.000Z",
  playbookRows: [
    { teamId: 901, teamAbbr: "ALP", updatedAt: "2026-10-07T23:25:00.000Z", players: [{ name: "Alex Able", status: "Out", reason: "Knee" }] },
    { teamId: 902, teamAbbr: "BET", updatedAt: "2026-10-07T23:25:00.000Z", players: [{ name: "Ben Block", status: "Questionable", reason: "Ankle" }] },
  ] as never,
  conferenceReport: official[game.providerGameId],
  previous: retained,
});
assert.equal(playbook?.source, "Playbook", "the paid Playbook report must retain source precedence");

assert.equal(shouldFetchCfbOfficialConferenceAvailability({ games: [game], existing: [], now: "2026-10-07T16:00:00.000Z" }), true);
assert.equal(shouldFetchCfbOfficialConferenceAvailability({
  games: [game],
  now: "2026-10-07T17:00:00.000Z",
  existing: [{ capturedAt: "2026-10-07T16:30:00.000Z", payload: { requestBudget: { officialAvailability: 4 } } }] as never,
}), false, "the conference endpoint must not be polled repeatedly inside its bounded cadence");
assert.equal(shouldFetchCfbOfficialConferenceAvailability({
  games: [{ ...game, scheduledStart: "2026-10-07T19:30:00.000Z" }],
  now: "2026-10-07T18:00:00.000Z",
  existing: [{ capturedAt: "2026-10-07T16:30:00.000Z", payload: { requestBudget: { officialAvailability: 4 } } }] as never,
}), true, "a scheduled pregame refresh must pick up the final official report");

assert.equal(shouldFetchCfbCollegeFootballDataLines({ games: [game], existing: [], now: "2026-10-07T16:00:00.000Z" }), true);
assert.equal(shouldFetchCfbCollegeFootballDataLines({
  games: [game],
  now: "2026-10-07T21:59:00.000Z",
  existing: [{ capturedAt: "2026-10-07T16:00:00.000Z", payload: { requestBudget: { collegeFootballData: 1 } } }] as never,
}), false);
assert.equal(shouldFetchCfbCollegeFootballDataLines({
  games: [game],
  now: "2026-10-07T22:00:00.000Z",
  existing: [{ capturedAt: "2026-10-07T16:00:00.000Z", payload: { requestBudget: { collegeFootballData: 1 } } }] as never,
}), true, "CFBD must be capped at one season/week request per six hours");

console.log("CFB FCS price and official injury continuity tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
