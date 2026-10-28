import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DailyEdgeResponse, MarketEdgeDto } from "../app/lab/lib/labTypes";
import { marketSplitSectionIsStale } from "../app/lab/lib/dailyEdgeSplitFreshness";
import {
  applySharpApiCurrentSplitOverlay,
  sanitizeRetainedSharpSplitPresentation,
  validateSharpApiCurrentSplitFeed,
  __TEST__ as sharpApiCurrentTest,
} from "../lib/providers/real_api/sharpApiCurrentSplits";

const emptyMarket = (): MarketEdgeDto => ({
  publicSplits: [],
  sportsbookSplits: null,
  recommendationDecision: { sharpBookSplits: null },
} as unknown as MarketEdgeDto);

const response = (sport: "cfb" | "mlb" | "nhl", awayTeam: string, homeTeam: string, awayName: string, homeName: string) => ({
  as_of: "2026-09-20T20:00:00.000Z",
  sport,
  date: "2026-09-20",
  requested_date: "2026-09-20",
  games: [{
    id: `${sport}-1`, sport, external_id: 1,
    awayTeam, homeTeam,
    awayTeamDisplayName: awayName,
    homeTeamDisplayName: homeName,
    gameStartAt: "2026-09-20T23:00:00.000Z",
    markets: { moneyline: emptyMarket(), total: emptyMarket(), first_inning: emptyMarket() },
  }],
} as unknown as DailyEdgeResponse);

const complete = (league: string, sportsbook: string, away: string, home: string, fetchedAt: string) => ({
  event_id: `${league}_2026-09-20_${away}_${home}`,
  event_start_time: "2026-09-20T23:00:00.000Z",
  league,
  away_team: away,
  home_team: home,
  sportsbook,
  fetched_at: fetchedAt,
  moneyline: { handle_pct: { away: 61, home: 39 }, bets_pct: { away: 53, home: 47 } },
  spread: { handle_pct: { away: 58, home: 42 }, bets_pct: { away: 48, home: 52 } },
  total: { handle_pct: { over: 44, under: 56 }, bets_pct: { over: 49, under: 51 } },
});

const now = Date.parse("2026-09-20T20:05:00.000Z");
const cfb = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
const cfbResult = applySharpApiCurrentSplitOverlay(cfb, {
  source: "sharpapi_current_splits",
  release: "sharpapi_current_splits_2026_09_20_r1_durable_overlay",
  sport: "cfb",
  fetchedAt: "2026-09-20T20:04:00.000Z",
  rows: [
    complete("ncaaf", "draftkings", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T20:04:00.000Z"),
    complete("ncaaf", "circa", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T20:03:00.000Z"),
  ],
}, now);
assert.deepEqual(cfbResult, { matchedGames: 1, populatedMarkets: 3 });
for (const market of Object.values(cfb.games[0]!.markets)) {
  assert.equal(market?.sportsbookSplits?.label, "Sharp Book Splits", "current Circa must win each complete market");
  assert.equal(market?.sportsbookSplits?.rows.length, 2);
}
assert.equal(cfb.games[0]!.markets.moneyline.sportsbookSplits?.rows[0]?.moneyPct, 61);
assert.equal(cfb.games[0]!.markets.moneyline.recommendationDecision?.sharpBookSplits, null, "overlay stays display-only");

const mlb = response("mlb", "PHI", "NYM", "Philadelphia Phillies", "New York Mets");
const mlbFeed: NonNullable<Parameters<typeof applySharpApiCurrentSplitOverlay>[1]> = {
  source: "sharpapi_current_splits",
  release: "sharpapi_current_splits_2026_09_20_r1_durable_overlay",
  sport: "mlb",
  fetchedAt: "2026-09-20T20:04:00.000Z",
  rows: [complete("mlb", "draftkings", "Philadelphia Phillies", "New York Mets", "2026-09-20T20:04:00.000Z")],
};
const mlbResult = applySharpApiCurrentSplitOverlay(mlb, mlbFeed, now);
assert.deepEqual(mlbResult, { matchedGames: 1, populatedMarkets: 2 });
assert.equal(mlb.games[0]!.markets.first_inning.sportsbookSplits, null, "MLB full-game spread cannot populate first inning");

const nhl = response("nhl", "NYI", "TOR", "New York Islanders", "Toronto Maple Leafs");
const nhlRetail = complete("nhl", "betmgm", "New York Islanders", "Toronto Maple Leafs", "2026-09-20T20:04:30.000Z");
nhlRetail.moneyline.handle_pct = { away: 44, home: 56 };
nhlRetail.moneyline.bets_pct = { away: 41, home: 59 };
nhlRetail.spread.handle_pct = { away: 37, home: 63 };
nhlRetail.spread.bets_pct = { away: 46, home: 54 };
nhlRetail.total.handle_pct = { over: 52, under: 48 };
nhlRetail.total.bets_pct = { over: 55, under: 45 };
const nhlResult = applySharpApiCurrentSplitOverlay(nhl, {
  source: "sharpapi_current_splits",
  release: "sharpapi_current_splits_2026_09_20_r1_durable_overlay",
  sport: "nhl",
  fetchedAt: "2026-09-20T20:04:00.000Z",
  rows: [
    complete("nhl", "draftkings", "NY Islanders", "TOR Maple Leafs", "2026-09-20T20:04:00.000Z"),
    nhlRetail,
  ],
}, now);
assert.deepEqual(nhlResult, { matchedGames: 1, populatedMarkets: 3 }, "NHL provider names must resolve through the canonical team normalizer");
assert.equal(nhl.games[0]!.markets.moneyline.sportsbookSplits?.label, "Sharp Book Splits");
assert.equal(nhl.games[0]!.markets.first_inning.sportsbookSplits?.rows.length, 2);
assert.equal(nhl.games[0]!.markets.moneyline.sportsbookSplits?.sourceBook, "draftkings");
assert.equal(nhl.games[0]!.markets.moneyline.sportsbookSplits?.rows[0]?.moneyPct, 61, "DraftKings remains the Sharp Book fallback");
assert.equal(nhl.games[0]!.markets.moneyline.publicSplits[0]?.moneyPct, 44, "independent BetMGM retail splits fill the public lane");
assert.notDeepEqual(
  nhl.games[0]!.markets.moneyline.publicSplits,
  nhl.games[0]!.markets.moneyline.sportsbookSplits?.rows,
  "public and Sharp Book panels cannot reuse the same observation",
);

const nhlSingleSource = response("nhl", "NYI", "TOR", "New York Islanders", "Toronto Maple Leafs");
applySharpApiCurrentSplitOverlay(nhlSingleSource, {
  source: "sharpapi_current_splits",
  release: "sharpapi_current_splits_2026_09_20_r1_durable_overlay",
  sport: "nhl",
  fetchedAt: "2026-09-20T20:04:00.000Z",
  rows: [complete("nhl", "draftkings", "NY Islanders", "TOR Maple Leafs", "2026-09-20T20:04:00.000Z")],
}, now);
assert.deepEqual(
  nhlSingleSource.games[0]!.markets.moneyline.publicSplits,
  [],
  "one named-book source may populate Sharp Book Splits but cannot be duplicated as public fallback",
);

const legacyMlbSection = mlb.games[0]!.markets.moneyline.sportsbookSplits!;
legacyMlbSection.lastUpdated = mlbFeed.fetchedAt;
for (const row of legacyMlbSection.rows) {
  row.observedAt = mlbFeed.fetchedAt;
  row.staleAfterMinutes = 15;
}
const sanitizedMlb = applySharpApiCurrentSplitOverlay(mlb, mlbFeed, now);
assert.equal(sanitizedMlb.populatedMarkets, 1, "an equal-source SharpAPI section must shed cached stale-state presentation fields");
assert.equal(mlb.games[0]!.markets.moneyline.sportsbookSplits?.lastUpdated, null);
assert.equal(mlb.games[0]!.markets.moneyline.sportsbookSplits?.rows[0]?.observedAt, null);
assert.equal(mlb.games[0]!.markets.moneyline.sportsbookSplits?.rows[0]?.staleAfterMinutes, undefined);

const singleAxis = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
const singleAxisRow = complete("ncaaf", "betmgm", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T20:04:00.000Z");
singleAxisRow.total.handle_pct = { over: 44 } as typeof singleAxisRow.total.handle_pct;
const singleAxisResult = applySharpApiCurrentSplitOverlay(singleAxis, {
  source: "sharpapi_current_splits",
  release: "sharpapi_current_splits_2026_09_20_r1_durable_overlay",
  sport: "cfb",
  fetchedAt: "2026-09-20T20:04:00.000Z",
  rows: [singleAxisRow],
}, now);
assert.deepEqual(singleAxisResult, { matchedGames: 1, populatedMarkets: 3 }, "a complete paired ticket axis remains visible when handle is unavailable");
assert.deepEqual(
  singleAxis.games[0]!.markets.total.sportsbookSplits?.rows.map((row) => [row.moneyPct, row.betsPct]),
  [[null, 49], [null, 51]],
  "single-axis rows stay honest instead of inventing a handle split",
);
assert.equal(
  singleAxis.games[0]!.markets.total.recommendationDecision?.sharpBookSplits,
  null,
  "single-axis display evidence never becomes market-reader decision evidence",
);

const invalidAxes = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
const invalidAxesRow = complete("ncaaf", "betmgm", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T20:04:00.000Z");
invalidAxesRow.total.handle_pct = { over: 44 } as typeof invalidAxesRow.total.handle_pct;
invalidAxesRow.total.bets_pct = { over: 49 } as typeof invalidAxesRow.total.bets_pct;
const invalidAxesResult = applySharpApiCurrentSplitOverlay(invalidAxes, {
  source: "sharpapi_current_splits",
  release: "sharpapi_current_splits_2026_09_20_r1_durable_overlay",
  sport: "cfb",
  fetchedAt: "2026-09-20T20:04:00.000Z",
  rows: [invalidAxesRow],
}, now);
assert.deepEqual(invalidAxesResult, { matchedGames: 1, populatedMarkets: 2 }, "an unpaired axis still fails closed per market");
assert.equal(invalidAxes.games[0]!.markets.total.sportsbookSplits, null);

const stale = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
applySharpApiCurrentSplitOverlay(stale, {
  source: "sharpapi_current_splits",
  release: "sharpapi_current_splits_2026_09_20_r1_durable_overlay",
  sport: "cfb",
  fetchedAt: "2026-09-19T20:04:00.000Z",
  rows: [complete("ncaaf", "draftkings", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-19T20:04:00.000Z")],
}, now);
assert.equal(stale.games[0]!.markets.moneyline.sportsbookSplits?.rows[0]?.isStale, false, "last-known-good rows stay in the established panel without new stale-state copy");

const feed: NonNullable<Parameters<typeof applySharpApiCurrentSplitOverlay>[1]> = {
  source: "sharpapi_current_splits",
  release: "sharpapi_current_splits_2026_09_20_r1_durable_overlay",
  sport: "cfb",
  fetchedAt: "2026-09-20T20:04:00.000Z",
  rows: [complete("ncaaf", "circa", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T20:04:00.000Z")],
};
assert.ok(validateSharpApiCurrentSplitFeed(feed, "cfb"));
assert.equal(validateSharpApiCurrentSplitFeed({ ...feed, rows: [] }, "cfb"), null, "an empty provider response cannot erase durable coverage");
assert.equal(validateSharpApiCurrentSplitFeed({ ...feed, sport: "nfl" }, "cfb"), null, "durable coverage cannot cross sports");

const owlsFeed: NonNullable<Parameters<typeof applySharpApiCurrentSplitOverlay>[1]> = {
  source: "owls_current_splits",
  release: "owls_current_splits_2026_10_27_r1_complete_named_book",
  sport: "cfb",
  fetchedAt: "2026-09-20T20:04:00.000Z",
  rows: [complete("ncaaf", "circa", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T20:04:00.000Z")],
};
assert.ok(validateSharpApiCurrentSplitFeed(owlsFeed, "cfb"), "Owls durable named-book feed is accepted");
const transitionedFeed = sharpApiCurrentTest.mergeCurrentSplitFeeds(feed, owlsFeed);
assert.equal(transitionedFeed.rows.length, 1, "provider transition never mixes incompatible event identities");
assert.equal(transitionedFeed.source, "owls_current_splits", "Owls owns the new single-provider durable feed");

const locked = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
locked.games[0]!.lockState = "locked";
locked.games[0]!.lockedAt = "2026-09-20T20:00:15.000Z";
assert.deepEqual(
  applySharpApiCurrentSplitOverlay(locked, owlsFeed, now),
  { matchedGames: 0, populatedMarkets: 0 },
  "Owls overlays never mutate locked member snapshots",
);

const lockedPreLock = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
lockedPreLock.games[0]!.lockState = "locked";
lockedPreLock.games[0]!.lockedAt = "2026-09-20T20:00:15.000Z";
const lockedPreLockFeed = {
  ...owlsFeed,
  fetchedAt: "2026-09-20T19:59:00.000Z",
  rows: [complete("ncaaf", "circa", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T19:59:00.000Z")],
};
assert.deepEqual(
  applySharpApiCurrentSplitOverlay(lockedPreLock, lockedPreLockFeed, now, {
    reconstructMissingLockedPreLock: true,
  }),
  { matchedGames: 1, populatedMarkets: 3 },
  "an exact observation captured before lock may reconstruct only a missing display field",
);
for (const market of Object.values(lockedPreLock.games[0]!.markets)) {
  assert.equal(market?.sportsbookSplits?.evidenceContext, "locked_prelock_reconstruction");
  assert.equal(market?.sportsbookSplits?.lastUpdated, "2026-09-20T19:59:00.000Z");
  assert.equal(market?.recommendationDecision?.sharpBookSplits, null, "the immutable locked decision stays untouched");
}

const lockedPostLock = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
lockedPostLock.games[0]!.lockState = "locked";
lockedPostLock.games[0]!.lockedAt = "2026-09-20T20:00:15.000Z";
assert.deepEqual(
  applySharpApiCurrentSplitOverlay(lockedPostLock, owlsFeed, now, {
    reconstructMissingLockedPreLock: true,
  }),
  { matchedGames: 1, populatedMarkets: 0 },
  "a post-lock observation cannot be attached to an immutable card",
);
assert.equal(lockedPostLock.games[0]!.markets.moneyline.sportsbookSplits, null);

const lockedStored = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
lockedStored.games[0]!.lockState = "locked";
lockedStored.games[0]!.lockedAt = "2026-09-20T20:00:15.000Z";
lockedStored.games[0]!.markets.moneyline.recommendationDecision!.sharpBookSplits = {
  label: "Sharp Book Splits",
  rows: [
    { side: "away", label: "LIB", moneyPct: 55, betsPct: 51 },
    { side: "home", label: "CCU", moneyPct: 45, betsPct: 49 },
  ],
  signal: null,
  lastUpdated: "2026-09-20T19:58:00.000Z",
};
applySharpApiCurrentSplitOverlay(lockedStored, lockedPreLockFeed, now, {
  reconstructMissingLockedPreLock: true,
});
assert.equal(lockedStored.games[0]!.markets.moneyline.sportsbookSplits, null, "stored locked evidence keeps exact precedence");
assert.equal(lockedStored.games[0]!.markets.moneyline.recommendationDecision!.sharpBookSplits?.rows[0]?.moneyPct, 55);

assert.equal(sanitizeRetainedSharpSplitPresentation(lockedPreLock), 3);
assert.equal(
  lockedPreLock.games[0]!.markets.moneyline.sportsbookSplits?.lastUpdated,
  "2026-09-20T19:59:00.000Z",
  "the pre-lock proof timestamp remains visible",
);

const retainedComplete = complete("ncaaf", "circa", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T19:00:00.000Z");
const partialUpdate = complete("ncaaf", "circa", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T20:00:00.000Z");
partialUpdate.total.handle_pct = { over: null, under: null } as unknown as typeof partialUpdate.total.handle_pct;
const mergedFeed = sharpApiCurrentTest.mergeCurrentSplitFeeds({ ...feed, rows: [retainedComplete] }, { ...feed, fetchedAt: "2026-09-20T20:00:00.000Z", rows: [partialUpdate] });
const mergedCurrent = mergedFeed.rows.find((row) => row.fetched_at === partialUpdate.fetched_at);
assert.equal(mergedFeed.rows.length, 2, "the durable feed retains both sides of a future lock cutoff");
assert.deepEqual(mergedCurrent?.total, partialUpdate.total, "a newer single-axis observation remains timestamp-honest instead of borrowing an old handle axis");
assert.equal(mergedCurrent?.fetched_at, partialUpdate.fetched_at, "new row identity and fetch time remain current for unaffected markets");

const heldComplete = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
heldComplete.games[0]!.markets.total.sportsbookSplits = sharpApiCurrentTest.sectionFromRow(
  heldComplete.games[0]!,
  "total",
  "circa",
  retainedComplete,
);
applySharpApiCurrentSplitOverlay(heldComplete, { ...feed, fetchedAt: partialUpdate.fetched_at, rows: [partialUpdate] }, now);
assert.equal(
  heldComplete.games[0]!.markets.total.sportsbookSplits?.rows[0]?.moneyPct,
  44,
  "a current complete section survives a same-window single-axis update",
);

const freshPartialAfterGap = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
freshPartialAfterGap.games[0]!.markets.total.sportsbookSplits = sharpApiCurrentTest.sectionFromRow(
  freshPartialAfterGap.games[0]!,
  "total",
  "circa",
  retainedComplete,
);
applySharpApiCurrentSplitOverlay(
  freshPartialAfterGap,
  { ...feed, fetchedAt: partialUpdate.fetched_at, rows: [partialUpdate] },
  Date.parse("2026-09-20T22:30:00.000Z"),
);
assert.deepEqual(
  freshPartialAfterGap.games[0]!.markets.total.sportsbookSplits?.rows.map((row) => [row.moneyPct, row.betsPct]),
  [[null, 49], [null, 51]],
  "a fresh single-axis observation replaces an expired complete display without fabricating freshness",
);

const postLock = complete("ncaaf", "circa", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T20:01:00.000Z");
postLock.moneyline.handle_pct = { away: 70, home: 30 };
postLock.moneyline.bets_pct = { away: 60, home: 40 };
const historicalFeed = sharpApiCurrentTest.mergeCurrentSplitFeeds(
  { ...owlsFeed, fetchedAt: "2026-09-20T19:59:00.000Z", rows: lockedPreLockFeed.rows },
  { ...owlsFeed, fetchedAt: "2026-09-20T20:01:00.000Z", rows: [postLock] },
);
const lockedFromHistory = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
lockedFromHistory.games[0]!.lockState = "locked";
lockedFromHistory.games[0]!.lockedAt = "2026-09-20T20:00:15.000Z";
assert.deepEqual(
  applySharpApiCurrentSplitOverlay(lockedFromHistory, historicalFeed, now, { reconstructMissingLockedPreLock: true }),
  { matchedGames: 1, populatedMarkets: 3 },
  "a post-lock provider refresh cannot hide the newest retained pre-lock observation",
);
assert.equal(lockedFromHistory.games[0]!.markets.moneyline.sportsbookSplits?.rows[0]?.moneyPct, 61);

const openFromHistory = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
assert.deepEqual(
  applySharpApiCurrentSplitOverlay(openFromHistory, historicalFeed, now),
  { matchedGames: 1, populatedMarkets: 3 },
  "an open card still uses the newest provider observation",
);
assert.equal(openFromHistory.games[0]!.markets.moneyline.sportsbookSplits?.rows[0]?.moneyPct, 70);
assert.equal(stale.games[0]!.markets.moneyline.sportsbookSplits?.lastUpdated, null, "retained fallback adds no freshness copy");
assert.equal(stale.games[0]!.markets.moneyline.sportsbookSplits?.rows[0]?.observedAt, null, "retained fallback adds no stale timestamp label");
assert.equal(
  marketSplitSectionIsStale(stale.games[0]!.markets.moneyline.sportsbookSplits ?? null, Date.parse("2027-09-20T20:05:00.000Z")),
  false,
  "retained fallback never triggers member-facing stale or historical copy",
);

const shellSource = readFileSync("app/lab/components/daily-edge/DailyEdgeShell.tsx", "utf8");
assert.match(
  shellSource,
  /SourceAwareMarketPulse decision=\{decision\} sharpBookDisplayOverride=\{sharpBookSplits\}/,
  "source-aware cards must render the verified response-boundary display override",
);
assert.match(
  shellSource,
  /const sharpBookSplits = sharpBookDisplayOverride \?\? decision\.sharpBookSplits/,
  "the display override must not mutate the canonical market decision",
);

const retainedWriterSharp = response("cfb", "PIT", "NE", "Pittsburgh Panthers", "New England College");
const retainedMarket = retainedWriterSharp.games[0]!.markets.moneyline;
retainedMarket.recommendationDecision!.sharpBookSplits = {
  label: "Sharp Book Splits",
  rows: [{
    side: "away", label: "PIT", moneyPct: 62, betsPct: 55,
    observedAt: "2026-09-20T16:00:00.000Z",
    freshnessCheckedAt: "2026-09-20T16:00:00.000Z",
    staleAfterMinutes: 15,
    isStale: true,
  }, {
    side: "home", label: "NE", moneyPct: 38, betsPct: 45,
    observedAt: "2026-09-20T16:00:00.000Z",
    freshnessCheckedAt: "2026-09-20T16:00:00.000Z",
    staleAfterMinutes: 15,
    isStale: true,
  }],
  signal: null,
  lastUpdated: "2026-09-20T16:00:00.000Z",
};
retainedMarket.sharpBookAvailability = {
  status: "stale",
  message: "legacy warning",
  lastUpdated: "2026-09-20T16:00:00.000Z",
};
assert.equal(sanitizeRetainedSharpSplitPresentation(retainedWriterSharp), 1);
assert.equal(retainedMarket.recommendationDecision!.sharpBookSplits.lastUpdated, null);
assert.equal(retainedMarket.recommendationDecision!.sharpBookSplits.rows[0]?.observedAt, null);
assert.equal(retainedMarket.recommendationDecision!.sharpBookSplits.rows[0]?.freshnessCheckedAt, null);
assert.equal(retainedMarket.recommendationDecision!.sharpBookSplits.rows[0]?.staleAfterMinutes, undefined);
assert.equal(retainedMarket.recommendationDecision!.sharpBookSplits.rows[0]?.isStale, false);
assert.equal(retainedMarket.sharpBookAvailability, null);
assert.equal(
  marketSplitSectionIsStale(retainedMarket.recommendationDecision!.sharpBookSplits, Date.parse("2036-09-20T21:10:00.000Z")),
  false,
  "writer-captured retained Sharp panels never trigger stale or historical member copy",
);

console.log("SharpAPI current split overlay and durable continuity tests passed.");
