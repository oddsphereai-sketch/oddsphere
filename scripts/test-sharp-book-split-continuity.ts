import assert from "node:assert/strict";
import type { DailyEdgeResponse, MarketEdgeDto } from "../app/lab/lib/labTypes";
import type { MarketSplitDisplaySection } from "../lib/types/domain/RecommendationDecision";
import {
  applySharpBookSplitContinuity,
  reconcileDailyEdgeSharpBookSplitAuthority,
  sectionQuality,
  __TEST__,
} from "../lib/providers/sharpBookSplitContinuity";

const section = (label: MarketSplitDisplaySection["label"], at: string | null, money = [62, 38], bets = [54, 46], sourceBook: MarketSplitDisplaySection["sourceBook"] = null): MarketSplitDisplaySection => ({
  label,
  sourceBook,
  sourceObservedAt: at,
  signal: null,
  lastUpdated: at,
  rows: [
    { side: "away", label: "AWY", moneyPct: money[0]!, betsPct: bets[0]!, observedAt: at, freshnessCheckedAt: at, isStale: false },
    { side: "home", label: "HME", moneyPct: money[1]!, betsPct: bets[1]!, observedAt: at, freshnessCheckedAt: at, isStale: false },
  ],
});

const market = (): MarketEdgeDto => ({
  sportsbookSplits: null,
  recommendationDecision: { sharpBookSplits: null },
} as unknown as MarketEdgeDto);

const response = (): DailyEdgeResponse => ({
  as_of: "2026-09-20T20:10:00.000Z",
  sport: "cfb",
  date: "2026-09-20",
  requested_date: "2026-09-20",
  fallback_used: false,
  slateState: "current",
  slate_status: "published",
  last_slate_update_at: "2026-09-20T20:10:00.000Z",
  games: [{
    id: "game-1",
    sport: "cfb",
    awayTeam: "AWY",
    homeTeam: "HME",
    gameStartAt: "2026-09-20T23:00:00.000Z",
    markets: { moneyline: market(), total: market(), first_inning: market() },
  }],
} as unknown as DailyEdgeResponse);

const retained = {
  release: "sharp_book_split_continuity_2026_09_20_r1",
  sport: "cfb",
  slateDate: "2026-09-20",
  games: [{
    gameId: "game-1",
    gameStartAt: "2026-09-20T23:00:00.000Z",
    awayTeam: "AWY",
    homeTeam: "HME",
    markets: { moneyline: section("Sharp Book Splits", null, [62, 38], [54, 46], "draftkings_network") },
  }],
} as NonNullable<Parameters<typeof applySharpBookSplitContinuity>[1]>;

const restored = response();
assert.deepEqual(applySharpBookSplitContinuity(restored, retained), { matchedGames: 1, populatedMarkets: 1 });
assert.equal(restored.games[0]!.markets.moneyline.sportsbookSplits?.label, "Sharp Book Splits");
assert.equal(restored.games[0]!.markets.moneyline.sportsbookSplits?.sourceBook, "draftkings_network");
assert.equal(sectionQuality(restored.games[0]!.markets.moneyline.sportsbookSplits!), 2);

const noHop = response();
noHop.games[0]!.markets.moneyline.sportsbookSplits = section(
  "Sharp Book Splits",
  "2026-09-20T20:09:00.000Z",
  [55, 45],
  [52, 48],
  "betmgm",
);
const retainedWithinGrace = {
  ...retained,
  games: [{
    ...retained.games[0]!,
    markets: { moneyline: section("Sharp Book Splits", "2026-09-20T18:10:00.000Z", [62, 38], [54, 46], "draftkings_network") },
  }],
};
applySharpBookSplitContinuity(noHop, retainedWithinGrace, Date.parse("2026-09-20T20:10:00.000Z"));
assert.equal(noHop.games[0]!.markets.moneyline.sportsbookSplits?.sourceBook, "draftkings_network", "the last displayed source stays fixed during the three-hour grace window");
assert.equal(noHop.games[0]!.markets.moneyline.sportsbookSplits?.sourceObservedAt, "2026-09-20T18:10:00.000Z", "hidden source time survives while visible timestamps remain absent");

const wrongGame = response();
wrongGame.games[0]!.homeTeam = "OTHER";
assert.deepEqual(applySharpBookSplitContinuity(wrongGame, retained), { matchedGames: 0, populatedMarkets: 0 });

const authority = response();
authority.games[0]!.markets.moneyline.recommendationDecision!.sharpBookSplits = section(
  "Sharp Book Splits",
  "2026-09-20T16:00:00.000Z",
);
authority.games[0]!.markets.moneyline.sportsbookSplits = section(
  "Sharp Book Splits",
  "2026-09-20T20:09:00.000Z",
  [58, 42],
  [51, 49],
  "draftkings_network",
);
assert.equal(reconcileDailyEdgeSharpBookSplitAuthority(authority, Date.parse("2026-09-20T20:10:00.000Z")), 1);
assert.equal(authority.games[0]!.markets.moneyline.sportsbookSplits?.rows[0]?.moneyPct, 58, "fresh complete fallback silently replaces stale writer row");

const sticky = response();
sticky.games[0]!.markets.moneyline.recommendationDecision!.sharpBookSplits = section(
  "Sharp Book Splits",
  "2026-09-20T18:00:00.000Z",
);
sticky.games[0]!.markets.moneyline.sportsbookSplits = section(
  "Sharp Book Splits",
  "2026-09-20T20:09:00.000Z",
  [58, 42],
  [51, 49],
  "draftkings_network",
);
assert.equal(reconcileDailyEdgeSharpBookSplitAuthority(sticky, Date.parse("2026-09-20T20:10:00.000Z")), 0);
assert.equal(sticky.games[0]!.markets.moneyline.sportsbookSplits, null, "the active source remains sticky through a multi-hour update gap");

const primary = response();
primary.games[0]!.markets.moneyline.recommendationDecision!.sharpBookSplits = section(
  "Sharp Book Splits",
  "2026-09-20T20:09:00.000Z",
);
primary.games[0]!.markets.moneyline.sportsbookSplits = section(
  "Sharp Book Splits",
  "2026-09-20T18:00:00.000Z",
  [62, 38],
  [54, 46],
  "draftkings_network",
);
assert.equal(reconcileDailyEdgeSharpBookSplitAuthority(primary, Date.parse("2026-09-20T20:10:00.000Z")), 0);
assert.equal(primary.games[0]!.markets.moneyline.sportsbookSplits, null, "current writer row remains authoritative over old fallback");

const previousFeed = __TEST__.captureFeed(restored, "cfb", null);
const emptyRebuild = response();
const mergedFeed = __TEST__.captureFeed(emptyRebuild, "cfb", previousFeed);
assert.equal(mergedFeed.games[0]?.markets.moneyline?.rows.length, 2, "empty rebuild cannot erase a previously displayed exact-game section");

console.log("Sharp-book complete-pair continuity tests passed.");
