import assert from "node:assert/strict";

import {
  buildPublicTrackingCategoryWindows,
  type PublicTrackingFoundationSnapshot,
} from "../lib/services/tracking/publicTrackingCategoryWindows";

function metrics(wins: number, losses: number, pending = 0) {
  const decided = wins + losses;
  return {
    picks: decided + pending,
    wins,
    losses,
    pushes: 0,
    voids: 0,
    pending,
    win_pct: decided > 0 ? (wins / decided) * 100 : null,
  };
}

const snapshot: PublicTrackingFoundationSnapshot = {
  generatedAt: "2026-08-30T13:33:42.468Z",
  baselines: [
    { sport: "mlb", market: "moneyline", lifetime_wins: 40, lifetime_total: 70, lifetime_pct: 57.1 },
    { sport: "mlb", market: "nrfi", lifetime_wins: 20, lifetime_total: 34, lifetime_pct: 58.8 },
    { sport: "mlb", market: "yrfi", lifetime_wins: 7, lifetime_total: 12, lifetime_pct: 58.3 },
  ],
  bySportMarket: [
    { sport: "mlb", market: "moneyline", metrics: metrics(4, 2) },
    { sport: "mlb", market: "first_inning", metrics: metrics(27, 19) },
    { sport: "mlb", market: "nrfi", metrics: metrics(2, 1) },
    { sport: "mlb", market: "yrfi", metrics: metrics(1, 1) },
    { sport: "cfb", market: "moneyline", metrics: metrics(4, 2) },
    { sport: "cfb", market: "total", metrics: metrics(1, 6) },
    { sport: "cfb", market: "spread", metrics: metrics(3, 4) },
  ],
  thisWeek: {
    from: "2026-08-24",
    to: "2026-08-30",
    bySportMarket: [
      { sport: "mlb", market: "moneyline", metrics: metrics(44, 35) },
      { sport: "mlb", market: "first_inning", metrics: metrics(27, 19) },
      { sport: "mlb", market: "nrfi", metrics: metrics(20, 14) },
      { sport: "mlb", market: "yrfi", metrics: metrics(7, 5) },
      { sport: "cfb", market: "moneyline", metrics: metrics(4, 2) },
      { sport: "cfb", market: "total", metrics: metrics(1, 6) },
      { sport: "cfb", market: "spread", metrics: metrics(3, 4) },
    ],
  },
  thisMonth: {
    from: "2026-08-01",
    to: "2026-08-30",
    bySportMarket: [
      { sport: "cfb", market: "moneyline", metrics: metrics(4, 2) },
      { sport: "cfb", market: "total", metrics: metrics(1, 6) },
      { sport: "cfb", market: "spread", metrics: metrics(3, 4) },
    ],
  },
};

const windows = buildPublicTrackingCategoryWindows(snapshot);
assert.deepEqual(windows.map((window) => window.key), ["weekly", "monthly", "lifetime"]);
assert.equal(windows[0]?.rangeLabel, "Aug 24 → Aug 30");
assert.equal(windows[1]?.rangeLabel, "Aug 1 → Aug 30");

const weekly = windows[0]?.rows ?? [];
assert.equal(weekly.some((row) => row.market === "first_inning"), false, "rolled-up first inning must not double-count NRFI/YRFI");
assert.deepEqual(
  weekly.filter((row) => row.sport === "cfb").map((row) => [row.market, row.metrics.wins, row.metrics.losses]),
  [["moneyline", 4, 2], ["total", 1, 6], ["spread", 3, 4]],
  "the homepage must carry the same three settled CFB categories as member Tracking",
);

const lifetime = windows[2]?.rows ?? [];
const mergedMlbMoneyline = lifetime.find((row) => row.sport === "mlb" && row.market === "moneyline");
assert.equal(mergedMlbMoneyline?.detail, "Lifetime · live +6");
assert.equal(mergedMlbMoneyline?.metrics.wins, 44);
assert.equal(mergedMlbMoneyline?.metrics.losses, 32);
assert.equal(lifetime.some((row) => row.sport === "mlb" && row.market === "first_inning"), false);
assert.equal(lifetime.find((row) => row.sport === "cfb" && row.market === "spread")?.detail, "Since launch");

const unavailable = buildPublicTrackingCategoryWindows(null);
assert.equal(unavailable.length, 3);
assert.equal(unavailable.every((window) => window.rows.length === 0), true);

console.log("homepage category tracker: passed");
