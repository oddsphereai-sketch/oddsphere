import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { DailyEdgeGameDto, MarketEdgeDto } from "../app/lab/lib/labTypes";
import {
  nflBoardProjectionRetainsReleasedMarket,
  projectNflSnapshotForInitialBoard,
} from "../lib/services/football/nflMemberBoardProjection";

const market = {
  pick: "HOME",
  modelProb: 0.61,
  marketPrediction: {
    status: "available",
    label: "HOME",
    line: -2.5,
    probability: 0.61,
    source: "model_at_exact_book_line",
    sportsbook: "fanduel",
    observedAt: "2026-10-29T12:00:00.000Z",
    freshnessCheckedAt: "2026-10-29T12:00:00.000Z",
    reason: "full stored evidence",
  },
  verdict: { key: "best_angle", label: "Best Angle" },
  currentPriceAmerican: -110,
  currentPriceSportsbook: "fanduel",
  line: -2.5,
  keyStats: [{
    label: "Decision-model input · Team strength",
    awayValue: "1",
    homeValue: "2",
    source: "feature_snapshot",
  }],
  oddsTrail: [{
    american: -105,
    line: -2.5,
    observedAt: "2026-10-29T10:00:00.000Z",
    sportsbook: "fanduel",
    source: "line_history",
    label: "first",
  }],
  lineTrail: [{
    american: -105,
    line: -2.5,
    observedAt: "2026-10-29T10:00:00.000Z",
    sportsbook: "fanduel",
    source: "line_history",
    label: "first",
  }],
  publicSplits: [],
  capReasons: [],
  reviewFlags: [],
  guidedGuide: "guide",
  guidedWatchOut: "watch",
  whyLine: "why",
  riskLine: "risk",
} as unknown as MarketEdgeDto;

const game = {
  id: "nfl-1",
  lockedAt: "2026-10-29T12:00:00.000Z",
  breakdown: {
    verdict: { key: "best_angle", label: "Best Angle" },
    sharpRead: { sentence: "stored sentence" },
    modelBreakdown: { release: "stored" },
  },
  sharpSignals: [{ market: "ML" }],
  recommendationDecision: { release: "stored" },
  markets: {
    moneyline: structuredClone(market),
    total: structuredClone(market),
    first_inning: structuredClone(market),
  },
} as unknown as DailyEdgeGameDto;

const original = structuredClone(game);
const result = projectNflSnapshotForInitialBoard({
  snapshot: { games: [game] } as never,
  fullReaderGameId: null,
});
const projected = result.snapshot.games[0]!;

assert.deepEqual(game, original, "board projection must not mutate the stored fixture or any locked field");
assert.deepEqual(result.deferredGameIds, ["nfl-1"]);
assert.equal(nflBoardProjectionRetainsReleasedMarket(game, projected), true);
assert.equal(projected.lockedAt, game.lockedAt, "locked timestamp remains exact on the board projection");
assert.equal(projected.markets.moneyline.keyStats.length, 0);
assert.equal(projected.markets.moneyline.oddsTrail?.length, 0);
assert.equal(projected.markets.moneyline.marketPrediction?.reason, null);
assert.equal(game.markets.moneyline.marketPrediction?.reason, "full stored evidence");

const retained = projectNflSnapshotForInitialBoard({
  snapshot: { games: [game] } as never,
  fullReaderGameId: "nfl-1",
});
assert.equal(retained.snapshot.games[0], game, "a directly requested reader receives the exact stored game DTO");
assert.deepEqual(retained.deferredGameIds, []);

const page = readFileSync("app/lab/daily-edge/CandidateDailyEdgePage.tsx", "utf8");
const reader = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");
const detailRoute = readFileSync("app/api/lab/nfl-game-detail/route.ts", "utf8");
assert.match(page, /projectNflSnapshotForInitialBoard/);
assert.match(page, /deferredNflGameIds=\{nflBoardProjection\?\.deferredGameIds\}/);
assert.match(reader, /"\/api\/lab\/nfl-game-detail"/);
assert.match(detailRoute, /hasMemberSession/);
assert.match(detailRoute, /readCachedNflMemberFixture/);
assert.match(detailRoute, /resolveNflForwardWeek/);
assert.match(detailRoute, /\{ game, availability: fixture\.availability\?\.\[game\.id\] \?\? null \}/);

console.log("NFL member navigation defers unopened evidence while preserving released board and locked values exactly.");
