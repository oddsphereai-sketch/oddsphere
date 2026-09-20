import assert from "node:assert/strict";
import type { DailyEdgeResponse, MarketEdgeDto } from "../app/lab/lib/labTypes";
import { marketSplitSectionIsStale } from "../app/lab/lib/dailyEdgeSplitFreshness";
import {
  applySharpApiCurrentSplitOverlay,
  sanitizeRetainedSharpSplitPresentation,
  validateSharpApiCurrentSplitFeed,
  __TEST__ as sharpApiCurrentTest,
} from "../lib/providers/real_api/sharpApiCurrentSplits";

const emptyMarket = (): MarketEdgeDto => ({
  sportsbookSplits: null,
  recommendationDecision: { sharpBookSplits: null },
} as unknown as MarketEdgeDto);

const response = (sport: "cfb" | "mlb", awayTeam: string, homeTeam: string, awayName: string, homeName: string) => ({
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

const incomplete = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
const incompleteRow = complete("ncaaf", "betmgm", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T20:04:00.000Z");
incompleteRow.total.handle_pct = { over: 44 } as typeof incompleteRow.total.handle_pct;
const incompleteResult = applySharpApiCurrentSplitOverlay(incomplete, {
  source: "sharpapi_current_splits",
  release: "sharpapi_current_splits_2026_09_20_r1_durable_overlay",
  sport: "cfb",
  fetchedAt: "2026-09-20T20:04:00.000Z",
  rows: [incompleteRow],
}, now);
assert.deepEqual(incompleteResult, { matchedGames: 1, populatedMarkets: 2 }, "partial metrics must fail closed per market");
assert.equal(incomplete.games[0]!.markets.total.sportsbookSplits, null);

const stale = response("cfb", "LIB", "CCU", "Liberty Flames", "Coastal Carolina Chanticleers");
applySharpApiCurrentSplitOverlay(stale, {
  source: "sharpapi_current_splits",
  release: "sharpapi_current_splits_2026_09_20_r1_durable_overlay",
  sport: "cfb",
  fetchedAt: "2026-09-19T20:04:00.000Z",
  rows: [complete("ncaaf", "draftkings", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-19T20:04:00.000Z")],
}, now);
assert.equal(stale.games[0]!.markets.moneyline.sportsbookSplits?.rows[0]?.isStale, false, "last-known-good rows stay in the established panel without new stale-state copy");

const feed = {
  source: "sharpapi_current_splits",
  release: "sharpapi_current_splits_2026_09_20_r1_durable_overlay",
  sport: "cfb",
  fetchedAt: "2026-09-20T20:04:00.000Z",
  rows: [complete("ncaaf", "circa", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T20:04:00.000Z")],
} as const;
assert.ok(validateSharpApiCurrentSplitFeed(feed, "cfb"));
assert.equal(validateSharpApiCurrentSplitFeed({ ...feed, rows: [] }, "cfb"), null, "an empty provider response cannot erase durable coverage");
assert.equal(validateSharpApiCurrentSplitFeed({ ...feed, sport: "nfl" }, "cfb"), null, "durable coverage cannot cross sports");

const retainedComplete = complete("ncaaf", "circa", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T19:00:00.000Z");
const partialUpdate = complete("ncaaf", "circa", "Liberty Flames", "Coastal Carolina Chanticleers", "2026-09-20T20:00:00.000Z");
partialUpdate.total.handle_pct = { over: null, under: null } as unknown as typeof partialUpdate.total.handle_pct;
const mergedFeed = sharpApiCurrentTest.mergeCurrentSplitFeeds({ ...feed, rows: [retainedComplete] }, { ...feed, fetchedAt: "2026-09-20T20:00:00.000Z", rows: [partialUpdate] });
assert.deepEqual(mergedFeed.rows[0]?.total, retainedComplete.total, "a newer partial provider row cannot erase the last complete market pair");
assert.equal(mergedFeed.rows[0]?.fetched_at, partialUpdate.fetched_at, "new row identity and fetch time remain current for unaffected markets");
assert.equal(stale.games[0]!.markets.moneyline.sportsbookSplits?.lastUpdated, null, "retained fallback adds no freshness copy");
assert.equal(stale.games[0]!.markets.moneyline.sportsbookSplits?.rows[0]?.observedAt, null, "retained fallback adds no stale timestamp label");
assert.equal(
  marketSplitSectionIsStale(stale.games[0]!.markets.moneyline.sportsbookSplits ?? null, Date.parse("2027-09-20T20:05:00.000Z")),
  false,
  "retained fallback never triggers member-facing stale or historical copy",
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
