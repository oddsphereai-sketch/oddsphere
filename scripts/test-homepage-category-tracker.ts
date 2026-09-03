import assert from "node:assert/strict";

import {
  buildPublicTrackingCategoryWindows,
  type PublicTrackingFoundationSnapshot,
} from "../lib/services/tracking/publicTrackingCategoryWindows";
import { applyPublicUclTrackingVisibility } from "../lib/services/tracking/publicTrackRecordSummary";
import type { TrackingResponse } from "../app/lab/lib/labTypes";

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

const uclMetric = metrics(2, 1);
const storedFoundation: PublicTrackingFoundationSnapshot = {
  ...snapshot,
  baselines: [...(snapshot.baselines ?? []), { sport: "ucl", market: "match_result", lifetime_wins: 100, lifetime_total: 174, lifetime_pct: 57.5 }],
  bySportMarket: [...(snapshot.bySportMarket ?? []), { sport: "ucl", market: "match_result", metrics: uclMetric }],
  thisWeek: { ...snapshot.thisWeek!, bySportMarket: [...snapshot.thisWeek!.bySportMarket, { sport: "ucl", market: "match_result", metrics: uclMetric }] },
  thisMonth: { ...snapshot.thisMonth!, bySportMarket: [...snapshot.thisMonth!.bySportMarket, { sport: "ucl", market: "match_result", metrics: uclMetric }] },
};
const storedCurrent = {
  as_of: "2026-09-03T12:00:00Z", sportOrder: ["mlb", "ucl"],
  yesterdayRecap: { date: "2026-09-02", label: "Sep 2", isYesterday: true, results: [
    { sport: "mlb", market: "ML", wins: 1, losses: 0, pushes: 0, total: 1 },
    { sport: "ucl", market: "Match Result", wins: 2, losses: 1, pushes: 0, total: 3 },
  ], totalPicks: 4, totalWins: 3, totalLosses: 1, hitRate: 0.75 },
  weeklyAggregate: { weekStart: "2026-08-31", weekEnd: "2026-09-06", weekStartLabel: "Aug 31", weekEndLabel: "Sep 6", totalPicks: 10, wins: 7, losses: 3, pushes: 0, hitRate: 0.7 },
  last30Days: { days: [], aggregate: { picks: 20, wins: 12, losses: 8, hitRate: 0.6 }, bestDay: null, worstDay: null, mostPicks: null },
  allTimeAggregate: { totalPredictions: 30, wins: 18, losses: 12, pushes: 0, hitRate: 0.6 },
  streak: { type: "W", count: 2, description: "two" }, tallies: [
    { sport: "mlb", market: "ML", lifetime: { wins: 16, losses: 11, pushes: 0, total: 27, hitRate: 16 / 27 }, currentSeason: null, weekly: null },
    { sport: "ucl", market: "Match Result", lifetime: { wins: 2, losses: 1, pushes: 0, total: 3, hitRate: 2 / 3 }, currentSeason: null, weekly: null },
  ],
} as TrackingResponse;
const rollbackVisible = applyPublicUclTrackingVisibility({ current: storedCurrent, foundation: storedFoundation, includeUcl: false });
assert.equal(rollbackVisible.foundation?.baselines?.some((row) => row.sport === "ucl"), false, "disabled public summary removes stored UCL foundation baselines");
assert.equal(rollbackVisible.foundation?.bySportMarket?.some((row) => row.sport === "ucl"), false);
assert.equal(rollbackVisible.foundation?.thisWeek?.bySportMarket.some((row) => row.sport === "ucl"), false);
assert.equal(rollbackVisible.foundation?.thisMonth?.bySportMarket.some((row) => row.sport === "ucl"), false);
assert.equal(rollbackVisible.current, null, "a mixed current snapshot fails closed because its monthly/lifetime UCL contribution is inseparable");
for (const degradedFoundation of [
  null,
  { ...storedFoundation, bySportMarket: [] },
  { ...storedFoundation, thisWeek: { ...storedFoundation.thisWeek!, bySportMarket: [] } },
  { ...storedFoundation, thisMonth: { ...storedFoundation.thisMonth!, bySportMarket: [] } },
]) {
  assert.equal(
    applyPublicUclTrackingVisibility({ current: storedCurrent, foundation: degradedFoundation, includeUcl: false }).current,
    null,
    "empty, partial, or mismatched foundation data cannot expose a mixed current composite",
  );
}
const enabledVisible = applyPublicUclTrackingVisibility({ current: storedCurrent, foundation: storedFoundation, includeUcl: true });
assert.equal(enabledVisible.current, storedCurrent, "enabled UCL retains the exact stored public snapshot");
assert.equal(enabledVisible.foundation, storedFoundation);
const alreadyIsolatedCurrent: TrackingResponse = {
  ...storedCurrent,
  yesterdayRecap: { ...storedCurrent.yesterdayRecap, results: storedCurrent.yesterdayRecap.results.filter((row) => row.sport !== "ucl") },
  tallies: storedCurrent.tallies.map((row) => row.sport === "ucl" ? {
    ...row,
    lifetime: { wins: 0, losses: 0, pushes: 0, total: 0, hitRate: 0 },
  } : row),
};
assert.deepEqual(
  applyPublicUclTrackingVisibility({ current: alreadyIsolatedCurrent, foundation: storedFoundation, includeUcl: false }).current?.allTimeAggregate,
  alreadyIsolatedCurrent.allTimeAggregate,
  "an already UCL-isolated public aggregate is not reduced a second time",
);

console.log("homepage category tracker: passed");
