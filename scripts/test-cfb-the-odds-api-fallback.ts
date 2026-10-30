import assert from "node:assert/strict";
import type { NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";
import type { CfbForwardStoredEvidence } from "../lib/services/football/cfbForwardEvidence";
import { buildCfbNamedBookPriceHierarchy, retainLatestCfbNamedBookMarkets } from "../lib/services/football/cfbSharpApiOdds";
import {
  CFB_THE_ODDS_API_CREDIT_RESERVE,
  CFB_THE_ODDS_API_CONSERVATIVE_NEXT_REQUEST_CREDITS,
  CFB_THE_ODDS_API_CREDITS_PER_PULL,
  CFB_THE_ODDS_API_FAR_REFRESH_MINUTES,
  CFB_THE_ODDS_API_HISTORICAL_CREDITS_PER_PULL,
  CFB_THE_ODDS_API_NEAR_REFRESH_MINUTES,
  CFB_THE_ODDS_API_ORDINARY_WEEKLY_CREDIT_LIMIT,
  CFB_THE_ODDS_API_ORDINARY_WEEKLY_PULL_LIMIT,
  CFB_THE_ODDS_API_REGIONS,
  CFB_THE_ODDS_API_WEEKLY_PULL_LIMIT,
  CFB_THE_ODDS_API_WEEKLY_CREDIT_LIMIT,
  fetchCfbTheOddsApiFallback,
  fetchCfbTheOddsApiHistoricalOpenings,
  shouldFetchCfbTheOddsApiFallback,
  shouldFetchCfbTheOddsApiHistoricalOpening,
} from "../lib/services/football/cfbTheOddsApiFallback";

const capturedAt = "2026-10-08T12:00:00.000Z";
const liu = game("g-liu", "Long Island University Sharks", "Duquesne Dukes", "2026-10-10T16:00:00.000Z");
const citadel = game("g-cit", "The Citadel Bulldogs", "VMI Keydets", "2026-10-10T17:00:00.000Z");

async function main(): Promise<void> {
  let liveRequests = 0;
const response = await fetchCfbTheOddsApiFallback({
  games: [liu, citadel],
  capturedAt,
  apiKey: "test-secret",
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v4/sports") {
      return Response.json([], {
        headers: {
          "x-requests-last": "0",
          "x-requests-remaining": "491",
        },
      });
    }
    liveRequests += 1;
    assert.equal(url.searchParams.get("markets"), "h2h,spreads,totals");
    assert.equal(url.searchParams.get("regions"), CFB_THE_ODDS_API_REGIONS);
    assert.equal(url.searchParams.get("bookmakers"), null);
    return new Response(JSON.stringify([
      event("e-liu", "LIU Sharks", "Duquesne Dukes", liu.scheduledStart, capturedAt,
        ["fanduel", "betrivers", "williamhill_us", "betonlineag"]),
      event("e-cit", "Citadel Bulldogs", "VMI Keydets", citadel.scheduledStart, capturedAt, ["bovada"]),
    ]), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-requests-last": String(CFB_THE_ODDS_API_CREDITS_PER_PULL),
        "x-requests-remaining": "491",
      },
    });
  },
});

assert.equal(response.requests, 2);
assert.equal(response.quotaRequests, 1);
assert.equal(response.oddsRequests, 1);
assert.equal(liveRequests, 1);
assert.equal(response.creditsUsed, 6);
assert.equal(response.creditsRemaining, 491);
assert.equal(response.matchedGames, 1);
assert.equal(response.displayMatchedGames, 2);
assert.equal(response.failuresByGame["g-cit"], "approved_named_book_unavailable");
assert.equal(response.booksByGame["g-cit"], undefined);
assert.equal(response.displayBooksByGame["g-cit"]?.[0]?.sportsbook, "bovada");
assert.equal(response.displayBooksByGame["g-cit"]?.[0]?.targetEligible, false);
assert.equal(response.displayBooksByGame["g-cit"]?.[0]?.marketReadingEligible, false);
const book = response.booksByGame["g-liu"]?.[0];
assert.ok(book);
assert.equal(book.provider, "theoddsapi");
assert.equal(book.sportsbook, "fanduel");
assert.deepEqual(book.moneyline, { awayPrice: 210, homePrice: -260 });
assert.deepEqual(book.spread, { awayLine: 6.5, awayPrice: -108, homeLine: -6.5, homePrice: -112 });
assert.deepEqual(book.total, { line: 48.5, overPrice: -105, underPrice: -115 });
assert.equal(response.booksByGame["g-liu"]?.find((candidate) => candidate.sportsbook === "betrivers")?.targetEligible, false);
assert.equal(response.booksByGame["g-liu"]?.find((candidate) => candidate.sportsbook === "caesars")?.targetEligible, false);
assert.equal(response.booksByGame["g-liu"]?.find((candidate) => candidate.sportsbook === "betonline")?.targetEligible, false);
assert.equal(response.booksByGame["g-liu"]?.find((candidate) => candidate.sportsbook === "betrivers")?.marketReadingEligible, false);

let reserveOddsRequests = 0;
const quotaReserve = await fetchCfbTheOddsApiFallback({
  games: [liu],
  capturedAt,
  apiKey: "test-secret",
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v4/sports") {
      return Response.json([], {
        headers: {
          "x-requests-last": "0",
          "x-requests-remaining": String(CFB_THE_ODDS_API_CREDIT_RESERVE + CFB_THE_ODDS_API_CONSERVATIVE_NEXT_REQUEST_CREDITS - 1),
        },
      });
    }
    reserveOddsRequests += 1;
    return Response.json([]);
  },
});
assert.equal(quotaReserve.requests, 1);
assert.equal(quotaReserve.quotaRequests, 1);
assert.equal(quotaReserve.oddsRequests, 0);
assert.equal(quotaReserve.creditsUsed, 0);
assert.equal(quotaReserve.failuresByGame["g-liu"], "credit_reserve");
assert.equal(reserveOddsRequests, 0, "the free quota probe must block the paid odds request below the shared floor");

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
    assert.equal(url.searchParams.get("regions"), CFB_THE_ODDS_API_REGIONS);
    assert.equal(url.searchParams.get("bookmakers"), null);
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
assert.equal(historical.creditsUsed, 2 * CFB_THE_ODDS_API_HISTORICAL_CREDITS_PER_PULL);
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
assert.equal(opening.cadenceMinutes, CFB_THE_ODDS_API_FAR_REFRESH_MINUTES);
assert.equal(CFB_THE_ODDS_API_WEEKLY_PULL_LIMIT * CFB_THE_ODDS_API_CREDITS_PER_PULL, 1_152);
assert.equal(CFB_THE_ODDS_API_CREDIT_RESERVE, 250, "shared account floor must remain available to other products");
assert.equal(CFB_THE_ODDS_API_CONSERVATIVE_NEXT_REQUEST_CREDITS, 12);

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

const farCadenceDue = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: [stored("2026-10-08T00:00:00.000Z", 19_993)],
  now: capturedAt,
});
assert.equal(farCadenceDue.fetch, true);
assert.equal(farCadenceDue.reason, "gap_refresh_due");

const nearGame = game("g-near", "LIU Sharks", "Duquesne Dukes", "2026-10-09T12:00:00.000Z");
const nearCadence = shouldFetchCfbTheOddsApiFallback({
  games: [nearGame],
  existing: [stored("2026-10-08T08:00:00.000Z", 19_993)],
  now: capturedAt,
});
assert.equal(nearCadence.fetch, true);
assert.equal(nearCadence.cadenceMinutes, CFB_THE_ODDS_API_NEAR_REFRESH_MINUTES);

const monthEndContinuity = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: [stored("2026-10-08T00:00:00.000Z", 900)],
  now: capturedAt,
});
assert.equal(monthEndContinuity.fetch, true, "a paid balance above the shared floor plus a conservative next request must remain usable");
assert.equal(monthEndContinuity.reason, "gap_refresh_due");

const historicalOnlyDoesNotPostponeCurrent = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: [],
  attemptHistory: [historyStored("2026-10-08T11:59:00.000Z", 19_993, { current: 0, historical: 2 })],
  now: capturedAt,
});
assert.equal(historicalOnlyDoesNotPostponeCurrent.fetch, true);
assert.equal(historicalOnlyDoesNotPostponeCurrent.reason, "opening_gap_seed");

const compactHistoryCurrentAttemptControlsCadence = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: [],
  attemptHistory: [historyStored("2026-10-08T11:59:00.000Z", 19_993, { current: 1, historical: 0 })],
  now: capturedAt,
});
assert.equal(compactHistoryCurrentAttemptControlsCadence.fetch, false);
assert.equal(compactHistoryCurrentAttemptControlsCadence.reason, "cadence_not_due");

assert.equal(shouldFetchCfbTheOddsApiHistoricalOpening({
  game: liu,
  existing: [],
  evidenceRelease: "current-release",
}), true);
assert.equal(shouldFetchCfbTheOddsApiHistoricalOpening({
  game: liu,
  existing: [historicalStored({ operationalOpening: { quote: { provider: "collegefootballdata" } }, historicalRequests: 0 })],
  evidenceRelease: "current-release",
}), false, "a valid opening from another provider already satisfies opening continuity");
assert.equal(shouldFetchCfbTheOddsApiHistoricalOpening({
  game: liu,
  existing: [historicalStored({ operationalOpening: null, historicalRequests: 0 })],
  attemptHistory: [historyStored("2026-10-08T11:59:00.000Z", 19_993, { current: 0, historical: 2 })],
  evidenceRelease: "current-release",
}), false, "an unavailable historical archive is attempted only once per transition release");

const priorWeekAttemptsDoNotConsumeThisWeek = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: [
    ...Array.from({ length: CFB_THE_ODDS_API_WEEKLY_PULL_LIMIT }, (_, index) =>
      stored(new Date(Date.parse("2026-09-30T00:00:00.000Z") + index * 60_000).toISOString(), 19_993 - index * CFB_THE_ODDS_API_CREDITS_PER_PULL)),
    stored("2026-10-08T00:00:00.000Z", 19_417),
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
  existing: [stored("2026-10-07T00:00:00.000Z", CFB_THE_ODDS_API_CREDIT_RESERVE + CFB_THE_ODDS_API_CONSERVATIVE_NEXT_REQUEST_CREDITS - 1)],
  now: capturedAt,
});
assert.equal(reserve.fetch, false);
assert.equal(reserve.reason, "credit_reserve");

const deduplicatedReceipts = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: [
    stored("2026-10-08T05:00:00.000Z", 2_262, { current: 1 }, 80),
    stored("2026-10-08T05:00:00.000Z", 2_262, { current: 1 }, 80),
  ],
  now: capturedAt,
});
assert.equal(deduplicatedReceipts.weeklyPulls, 1, "one slate request copied to multiple game rows must count once");
assert.equal(deduplicatedReceipts.weeklyCredits, 80, "one slate receipt copied to multiple game rows must count once");
assert.equal(deduplicatedReceipts.estimatedNextCredits, 80);

const ordinaryCreditCappedRows = Array.from({ length: CFB_THE_ODDS_API_ORDINARY_WEEKLY_CREDIT_LIMIT / CFB_THE_ODDS_API_CREDITS_PER_PULL }, (_, index) =>
  stored(new Date(Date.parse("2026-10-06T04:00:00.000Z") + index * 60_000).toISOString(), 5_000));
const ordinaryCreditCapped = shouldFetchCfbTheOddsApiFallback({ games: [liu], existing: ordinaryCreditCappedRows, now: capturedAt });
assert.equal(ordinaryCreditCapped.fetch, false);
assert.equal(ordinaryCreditCapped.reason, "ordinary_weekly_credit_limit");

const emergencyCreditCappedRows = Array.from({ length: CFB_THE_ODDS_API_WEEKLY_CREDIT_LIMIT / CFB_THE_ODDS_API_CREDITS_PER_PULL }, (_, index) =>
  stored(new Date(Date.parse("2026-10-06T04:00:00.000Z") + index * 60_000).toISOString(), 5_000));
const emergencyCreditCapped = shouldFetchCfbTheOddsApiFallback({
  games: [liu],
  existing: emergencyCreditCappedRows,
  now: capturedAt,
  forceT60: true,
});
assert.equal(emergencyCreditCapped.fetch, false);
assert.equal(emergencyCreditCapped.reason, "weekly_credit_limit");

const ordinaryCappedRows = Array.from({ length: CFB_THE_ODDS_API_ORDINARY_WEEKLY_PULL_LIMIT }, (_, index) =>
  stored(new Date(Date.parse("2026-10-06T04:00:00.000Z") + index * 60_000).toISOString(), 19_993, { current: 1 }, 0));
const ordinaryCapped = shouldFetchCfbTheOddsApiFallback({ games: [liu], existing: ordinaryCappedRows, now: capturedAt });
assert.equal(ordinaryCapped.fetch, false);
assert.equal(ordinaryCapped.reason, "ordinary_pull_limit_lock_reserve");
const reservedLock = shouldFetchCfbTheOddsApiFallback({ games: [liu], existing: ordinaryCappedRows, now: capturedAt, forceT60: true });
assert.equal(reservedLock.fetch, true);
assert.equal(reservedLock.reason, "t60_lock_refresh");

const cappedRows = Array.from({ length: CFB_THE_ODDS_API_WEEKLY_PULL_LIMIT }, (_, index) =>
  stored(new Date(Date.parse("2026-10-06T04:00:00.000Z") + index * 60_000).toISOString(), 19_993, { current: 1 }, 0));
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

function event(
  id: string,
  away: string,
  home: string,
  commenceTime: string,
  observedAt = capturedAt,
  bookKeys: string[] = ["fanduel"],
): unknown {
  return {
    id,
    sport_key: "americanfootball_ncaaf_fcs",
    commence_time: commenceTime,
    away_team: away,
    home_team: home,
    bookmakers: bookKeys.map((key) => ({
      key,
      title: key,
      last_update: observedAt,
      markets: [
        { key: "h2h", last_update: observedAt, outcomes: [{ name: away, price: 210 }, { name: home, price: -260 }] },
        { key: "spreads", last_update: observedAt, outcomes: [{ name: away, price: -108, point: 6.5 }, { name: home, price: -112, point: -6.5 }] },
        { key: "totals", last_update: observedAt, outcomes: [{ name: "Over", price: -105, point: 48.5 }, { name: "Under", price: -115, point: 48.5 }] },
      ],
    })),
  };
}

function stored(
  at: string,
  remaining: number,
  requests: { current?: number; historical?: number } = { current: 1 },
  currentCredits = (requests.current ?? 0) * CFB_THE_ODDS_API_CREDITS_PER_PULL,
): CfbForwardStoredEvidence {
  return {
    capturedAt: at,
    payload: { requestBudget: {
      theOddsApi: (requests.current ?? 0) + (requests.historical ?? 0),
      theOddsApiCurrent: requests.current ?? 0,
      theOddsApiCurrentAttemptedAt: (requests.current ?? 0) > 0 ? at : null,
      theOddsApiHistorical: requests.historical ?? 0,
      theOddsApiHistoricalAttemptedAt: (requests.historical ?? 0) > 0 ? at : null,
      theOddsApiCredits: currentCredits + (requests.historical ?? 0) * CFB_THE_ODDS_API_HISTORICAL_CREDITS_PER_PULL,
      theOddsApiCurrentCredits: currentCredits,
      theOddsApiHistoricalCredits: (requests.historical ?? 0) * CFB_THE_ODDS_API_HISTORICAL_CREDITS_PER_PULL,
      theOddsApiRemainingCredits: remaining,
    } },
  } as unknown as CfbForwardStoredEvidence;
}

function historicalStored(args: { operationalOpening: unknown; historicalRequests: number }): CfbForwardStoredEvidence {
  return {
    providerGameId: liu.providerGameId,
    payload: {
      schemaRelease: "current-release",
      market: { operationalOpening: args.operationalOpening },
      requestBudget: { theOddsApiHistorical: args.historicalRequests },
    },
  } as unknown as CfbForwardStoredEvidence;
}

function historyStored(
  at: string,
  remaining: number,
  requests: { current: number; historical: number },
) {
  return {
    id: `history-${at}`,
    providerGameId: liu.providerGameId,
    stage: "unlocked",
    capturedAt: at,
    gameStartAt: liu.scheduledStart,
    payloadSha256: "0".repeat(64),
    payload: {
      schemaRelease: "current-release",
      market: {
        current: null,
        currentBooks: [],
        displayBooks: [],
        providerOpening: null,
        operationalOpening: null,
        playbookSplits: null,
        sharpApiSplits: [],
      },
      requestBudget: {
        theOddsApi: requests.current + requests.historical,
        theOddsApiCurrent: requests.current,
        theOddsApiCurrentAttemptedAt: requests.current > 0 ? at : null,
        theOddsApiHistorical: requests.historical,
        theOddsApiHistoricalAttemptedAt: requests.historical > 0 ? at : null,
        theOddsApiCredits:
          requests.current * CFB_THE_ODDS_API_CREDITS_PER_PULL +
          requests.historical * CFB_THE_ODDS_API_HISTORICAL_CREDITS_PER_PULL,
        theOddsApiCurrentCredits: requests.current * CFB_THE_ODDS_API_CREDITS_PER_PULL,
        theOddsApiHistoricalCredits: requests.historical * CFB_THE_ODDS_API_HISTORICAL_CREDITS_PER_PULL,
        theOddsApiRemainingCredits: remaining,
      },
    },
  } as never;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
