import assert from "node:assert/strict";
import type { NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";
import type { CfbForwardStoredEvidence } from "../lib/services/football/cfbForwardEvidence";
import { buildCfbNamedBookPriceHierarchy, retainLatestCfbNamedBookMarkets } from "../lib/services/football/cfbSharpApiOdds";
import {
  CFB_THE_ODDS_API_CREDIT_RESERVE,
  CFB_THE_ODDS_API_CREDITS_PER_PULL,
  CFB_THE_ODDS_API_HISTORICAL_CREDITS_PER_PULL,
  CFB_THE_ODDS_API_ORDINARY_WEEKLY_PULL_LIMIT,
  CFB_THE_ODDS_API_WEEKLY_PULL_LIMIT,
  fetchCfbTheOddsApiFallback,
  fetchCfbTheOddsApiHistoricalOpenings,
  shouldFetchCfbTheOddsApiFallback,
} from "../lib/services/football/cfbTheOddsApiFallback";

const capturedAt = "2026-10-08T12:00:00.000Z";
const liu = game("g-liu", "Long Island University Sharks", "Duquesne Dukes", "2026-10-10T16:00:00.000Z");
const citadel = game("g-cit", "The Citadel Bulldogs", "VMI Keydets", "2026-10-10T17:00:00.000Z");

async function main(): Promise<void> {
const response = await fetchCfbTheOddsApiFallback({
  games: [liu, citadel],
  capturedAt,
  apiKey: "test-secret",
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("markets"), "h2h,spreads,totals");
    assert.equal(url.searchParams.get("bookmakers"), "fanduel,draftkings,rebet");
    return new Response(JSON.stringify([
      event("e-liu", "LIU Sharks", "Duquesne Dukes", liu.scheduledStart),
      // Reversed orientation must not match The Citadel.
      event("e-cit-wrong", "VMI Keydets", "Citadel Bulldogs", citadel.scheduledStart),
    ]), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-requests-last": "3",
        "x-requests-remaining": "491",
      },
    });
  },
});

assert.equal(response.requests, 1);
assert.equal(response.creditsUsed, 3);
assert.equal(response.creditsRemaining, 491);
assert.equal(response.matchedGames, 1);
assert.equal(response.failuresByGame["g-cit"], "strict_event_not_found");
const book = response.booksByGame["g-liu"]?.[0];
assert.ok(book);
assert.equal(book.provider, "theoddsapi");
assert.equal(book.sportsbook, "fanduel");
assert.deepEqual(book.moneyline, { awayPrice: 210, homePrice: -260 });
assert.deepEqual(book.spread, { awayLine: 6.5, awayPrice: -108, homeLine: -6.5, homePrice: -112 });
assert.deepEqual(book.total, { line: 48.5, overPrice: -105, underPrice: -115 });

const paidDraftKings = {
  ...book,
  sportsbook: "draftkings",
  provider: "balldontlie" as const,
  observedAt: "2026-10-08T11:55:00.000Z",
  marketObservedAt: { moneyline: "2026-10-08T11:55:00.000Z" },
  moneyline: { awayPrice: 205, homePrice: -255 },
  spread: null,
  total: null,
};
const fallbackDraftKings = {
  ...book,
  sportsbook: "draftkings",
  provider: "theoddsapi" as const,
};
const fallbackFanDuel = { ...book, sportsbook: "fanduel", provider: "theoddsapi" as const };
const hierarchy = buildCfbNamedBookPriceHierarchy(
  [paidDraftKings],
  [fallbackDraftKings, fallbackFanDuel],
);
assert.equal(hierarchy.find((candidate) => candidate.sportsbook === "draftkings")?.provider, "balldontlie");
assert.equal(hierarchy.find((candidate) => candidate.sportsbook === "fanduel")?.provider, "theoddsapi");
assert.equal(hierarchy.length, 2, "fallback fills an absent named book without replacing the primary same book");

const retainedTrail = retainLatestCfbNamedBookMarkets(
  [{ ...fallbackFanDuel, observedAt: "2026-10-08T12:00:00.000Z" }],
  [{
    ...fallbackFanDuel,
    observedAt: "2026-10-07T12:00:00.000Z",
    marketObservedAt: {
      moneyline: "2026-10-07T12:00:00.000Z",
      spread: "2026-10-07T12:00:00.000Z",
      total: "2026-10-07T12:00:00.000Z",
    },
  }],
);
assert.equal(retainedTrail[0]?.provider, "theoddsapi");
assert.equal(retainedTrail[0]?.moneyline?.homePrice, -260);
assert.equal(retainedTrail[0]?.spread?.homeLine, -6.5);
assert.equal(retainedTrail[0]?.total?.line, 48.5);

const historical = await fetchCfbTheOddsApiHistoricalOpenings({
  games: [liu, citadel],
  apiKey: "test-secret",
  snapshotDates: ["2026-10-07T12:00:00.000Z", "2026-10-07T18:45:00.000Z"],
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    assert.match(url.pathname, /\/historical\/sports\/americanfootball_ncaaf_fcs\/odds$/);
    assert.equal(url.searchParams.get("markets"), "h2h,spreads,totals");
    assert.equal(url.searchParams.get("bookmakers"), "fanduel,draftkings,rebet");
    const first = url.searchParams.get("date") === "2026-10-07T12:00:00Z";
    return new Response(JSON.stringify({
      timestamp: first ? "2026-10-07T11:55:36.000Z" : "2026-10-07T18:40:36.000Z",
      data: first
        ? [event("e-liu-opening", "LIU Sharks", "Duquesne Dukes", liu.scheduledStart, "2026-10-07T11:55:00.000Z")]
        : [event("e-cit-opening", "Citadel Bulldogs", "VMI Keydets", citadel.scheduledStart, "2026-10-07T18:40:00.000Z")],
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-requests-last": String(CFB_THE_ODDS_API_HISTORICAL_CREDITS_PER_PULL),
        "x-requests-remaining": first ? "470" : "440",
      },
    });
  },
});
assert.equal(historical.requests, 2);
assert.equal(historical.creditsUsed, 60);
assert.equal(historical.creditsRemaining, 440);
assert.equal(historical.matchedGames, 2);
assert.equal(historical.booksByGame["g-liu"]?.[0]?.providerEventId, "e-liu-opening");
assert.equal(historical.booksByGame["g-cit"]?.[0]?.providerEventId, "e-cit-opening");
assert.deepEqual(historical.failuresByGame, {});

const futureDatedHistorical = await fetchCfbTheOddsApiHistoricalOpenings({
  games: [liu],
  apiKey: "test-secret",
  snapshotDates: ["2026-10-07T12:00:00.000Z"],
  fetchImpl: async () => Response.json({
    timestamp: "2026-10-07T12:00:00.000Z",
    data: [event("e-liu-future", "LIU Sharks", "Duquesne Dukes", liu.scheduledStart, "2026-10-07T12:00:01.000Z")],
  }),
});
assert.equal(futureDatedHistorical.matchedGames, 0);
assert.equal(futureDatedHistorical.failuresByGame["g-liu"], "historical_opening_not_found");

const opening = shouldFetchCfbTheOddsApiFallback({ games: [liu], existing: [], now: capturedAt });
assert.equal(opening.fetch, true);
assert.equal(opening.reason, "opening_gap_seed");
assert.equal(opening.cadenceMinutes, 60);
assert.equal(CFB_THE_ODDS_API_WEEKLY_PULL_LIMIT * CFB_THE_ODDS_API_CREDITS_PER_PULL, 576);

const newGameSeed = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: [stored("2026-10-08T11:59:00.000Z", 19_993)],
  now: capturedAt,
  forceOpeningSeed: true,
});
assert.equal(newGameSeed.fetch, true);
assert.equal(newGameSeed.reason, "new_gap_opening_seed");

const recent = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: [stored("2026-10-08T11:01:00.000Z", 19_993)],
  now: capturedAt,
});
assert.equal(recent.fetch, false);
assert.equal(recent.reason, "cadence_not_due");

const hourlyDue = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: [stored("2026-10-08T11:00:00.000Z", 19_993)],
  now: capturedAt,
});
assert.equal(hourlyDue.fetch, true);
assert.equal(hourlyDue.reason, "gap_refresh_due");

const priorWeekAttemptsDoNotConsumeThisWeek = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: [
    ...Array.from({ length: CFB_THE_ODDS_API_WEEKLY_PULL_LIMIT }, (_, index) =>
      stored(new Date(Date.parse("2026-09-30T00:00:00.000Z") + index * 60_000).toISOString(), 19_993 - index * 3)),
    stored("2026-10-08T11:00:00.000Z", 19_417),
  ],
  now: capturedAt,
});
assert.equal(priorWeekAttemptsDoNotConsumeThisWeek.fetch, true);
assert.equal(priorWeekAttemptsDoNotConsumeThisWeek.reason, "gap_refresh_due");
assert.equal(priorWeekAttemptsDoNotConsumeThisWeek.weeklyPulls, 1);

const lockRefresh = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: [stored("2026-10-08T11:59:00.000Z", 19_993)],
  now: capturedAt,
  forceT60: true,
});
assert.equal(lockRefresh.fetch, true);
assert.equal(lockRefresh.reason, "t60_lock_refresh");

const reserve = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: [stored("2026-10-07T00:00:00.000Z", CFB_THE_ODDS_API_CREDIT_RESERVE + CFB_THE_ODDS_API_CREDITS_PER_PULL - 1)],
  now: capturedAt,
});
assert.equal(reserve.fetch, false);
assert.equal(reserve.reason, "credit_reserve");

const ordinaryCappedRows = Array.from({ length: CFB_THE_ODDS_API_ORDINARY_WEEKLY_PULL_LIMIT }, (_, index) =>
  stored(new Date(Date.parse("2026-10-06T04:00:00.000Z") + index * 60_000).toISOString(), 19_993 - index * 3));
const ordinaryCapped = shouldFetchCfbTheOddsApiFallback({ games: [liu], existing: ordinaryCappedRows, now: capturedAt });
assert.equal(ordinaryCapped.fetch, false);
assert.equal(ordinaryCapped.reason, "ordinary_pull_limit_lock_reserve");
const reservedLock = shouldFetchCfbTheOddsApiFallback({ games: [liu], existing: ordinaryCappedRows, now: capturedAt, forceT60: true });
assert.equal(reservedLock.fetch, true);
assert.equal(reservedLock.reason, "t60_lock_refresh");

const cappedRows = Array.from({ length: CFB_THE_ODDS_API_WEEKLY_PULL_LIMIT }, (_, index) =>
  stored(new Date(Date.parse("2026-10-06T04:00:00.000Z") + index * 60_000).toISOString(), 19_993 - index * 3));
const capped = shouldFetchCfbTheOddsApiFallback({ games: [liu], existing: cappedRows, now: capturedAt });
assert.equal(capped.fetch, false);
assert.equal(capped.reason, "weekly_pull_limit");

console.log("CFB The Odds API gap fallback tests passed.");
}

function game(providerGameId: string, awayName: string, homeName: string, scheduledStart: string): NcaafGame {
  return {
    providerGameId,
    providerWeek: 6,
    season: 2026,
    scheduledStart,
    status: "Scheduled",
    awayScore: null,
    homeScore: null,
    away: { id: 1, conferenceId: null, abbreviation: "AWY", name: awayName, fbs: false },
    home: { id: 2, conferenceId: null, abbreviation: "HME", name: homeName, fbs: false },
  };
}

function event(id: string, away: string, home: string, commenceTime: string, observedAt = capturedAt): unknown {
  return {
    id,
    sport_key: "americanfootball_ncaaf_fcs",
    commence_time: commenceTime,
    away_team: away,
    home_team: home,
    bookmakers: [{
      key: "fanduel",
      title: "FanDuel",
      last_update: observedAt,
      markets: [
        { key: "h2h", last_update: observedAt, outcomes: [{ name: away, price: 210 }, { name: home, price: -260 }] },
        { key: "spreads", last_update: observedAt, outcomes: [{ name: away, price: -108, point: 6.5 }, { name: home, price: -112, point: -6.5 }] },
        { key: "totals", last_update: observedAt, outcomes: [{ name: "Over", price: -105, point: 48.5 }, { name: "Under", price: -115, point: 48.5 }] },
      ],
    }],
  };
}

function stored(at: string, remaining: number): CfbForwardStoredEvidence {
  return {
    capturedAt: at,
    payload: { requestBudget: { theOddsApi: 1, theOddsApiRemainingCredits: remaining } },
  } as unknown as CfbForwardStoredEvidence;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
