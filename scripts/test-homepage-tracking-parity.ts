import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildPublicTrackingCategoryWindows,
  type PublicTrackingFoundationSnapshot,
} from "../lib/services/tracking/publicTrackingCategoryWindows";
import { buildLifetimeRecords } from "../app/lab/tracking/TrackingClient";
import type {
  AlternateLineCategory,
  AlternateLineMetrics,
  AlternateLinePerformance,
} from "../lib/services/tracking/alternateLinePerformance";

function aggregateMetrics(wins: number, losses: number, pushes = 0) {
  const decided = wins + losses;
  return {
    picks: decided + pushes,
    wins,
    losses,
    pushes,
    voids: 0,
    pending: 0,
    win_pct: decided > 0 ? (wins / decided) * 100 : null,
  };
}

function alternateMetrics(wins: number, losses: number, pushes = 0): AlternateLineMetrics {
  const decided = wins + losses;
  return {
    wins,
    losses,
    pushes,
    settled: wins + losses + pushes,
    winPct: decided > 0 ? Math.round((wins / decided) * 10_000) / 100 : null,
  };
}

function alternateCategory(input: {
  sport: AlternateLineCategory["sport"];
  market: AlternateLineCategory["market"];
  source?: AlternateLineCategory["source"];
  sourceLabel?: string;
  from: string;
  to: string;
  original: AlternateLineMetrics;
  delta: number;
  label: string;
  adjusted: AlternateLineMetrics;
  excludedRows?: number;
}): AlternateLineCategory {
  return {
    sport: input.sport,
    market: input.market,
    source: input.source ?? "current_release",
    sourceLabel: input.sourceLabel ?? "Line-level history",
    coverageFrom: input.from,
    coverageTo: input.to,
    original: input.original,
    adjustments: [{ delta: input.delta, label: input.label, metrics: input.adjusted }],
    excludedRows: input.excludedRows ?? 0,
  };
}

const weekly = alternateCategory({
  sport: "cfb",
  market: "spread",
  from: "2026-10-13",
  to: "2026-10-17",
  original: alternateMetrics(51, 45, 3),
  delta: 3,
  label: "+3 POINTS",
  adjusted: alternateMetrics(65, 34),
});
const monthly = alternateCategory({
  sport: "nfl",
  market: "total",
  from: "2026-09-20",
  to: "2026-10-18",
  original: alternateMetrics(43, 31, 1),
  delta: 6,
  label: "+6 POINTS",
  adjusted: alternateMetrics(52, 22, 1),
});
const lifetime = alternateCategory({
  sport: "mlb",
  market: "total",
  from: "2026-06-07",
  to: "2026-10-18",
  original: alternateMetrics(746, 724, 17),
  delta: 2,
  label: "+2 RUNS",
  adjusted: alternateMetrics(1004, 468, 15),
  excludedRows: 11,
});
const archive = alternateCategory({
  sport: "ucl",
  market: "total",
  source: "prior_release",
  sourceLabel: "Prior locked release",
  from: "2026-09-08",
  to: "2026-09-10",
  original: alternateMetrics(10, 3),
  delta: 1,
  label: "+1 GOAL",
  adjusted: alternateMetrics(11, 2),
  excludedRows: 5,
});

const alternateLinePerformance: AlternateLinePerformance = {
  weekly: { from: "2026-10-13", to: "2026-10-19", rows: [weekly] },
  monthly: { from: "2026-09-20", to: "2026-10-19", rows: [monthly] },
  lifetime: { from: "2026-06-07", to: "2026-10-19", rows: [lifetime] },
  archives: [archive],
};

const snapshot: PublicTrackingFoundationSnapshot = {
  generatedAt: "2026-10-19T14:34:38.887Z",
  baselines: [],
  bySportMarket: [
    { sport: "mlb", market: "total", metrics: aggregateMetrics(746, 724, 17) },
    { sport: "ucl", market: "total", metrics: aggregateMetrics(13, 5) },
  ],
  thisWeek: {
    from: "2026-10-13",
    to: "2026-10-19",
    bySportMarket: [{ sport: "cfb", market: "spread", metrics: aggregateMetrics(51, 45, 3) }],
  },
  thisMonth: {
    from: "2026-09-20",
    to: "2026-10-19",
    bySportMarket: [{ sport: "nfl", market: "total", metrics: aggregateMetrics(43, 31, 1) }],
  },
  alternateLinePerformance,
};

const windows = buildPublicTrackingCategoryWindows(snapshot);
const publicRows = Object.fromEntries(windows.map((window) => [window.key, window.alternateRows]));
const memberRows = {
  weekly: alternateLinePerformance.weekly.rows,
  monthly: alternateLinePerformance.monthly.rows,
  lifetime: [...alternateLinePerformance.lifetime.rows, ...alternateLinePerformance.archives],
};

assert.deepEqual(publicRows, memberRows, "homepage and member surfaces must consume the same alternate-line snapshot rows");
assert.deepEqual(publicRows.weekly[0]?.original, weekly.original, "weekly original-line wins, losses, pushes, sample, and percentage stay exact");
assert.deepEqual(publicRows.monthly[0]?.adjustments, monthly.adjustments, "monthly adjustment labels and records stay exact");
assert.deepEqual(publicRows.lifetime[0], lifetime, "lifetime current-release coverage and excluded-row metadata stay exact");
assert.deepEqual(publicRows.lifetime[1], archive, "prior-release archives remain separate and labeled");

const withoutAlternate = buildPublicTrackingCategoryWindows({ ...snapshot, alternateLinePerformance: undefined });
assert.equal(withoutAlternate.every((window) => window.alternateRows.length === 0), true, "an older incomplete snapshot never invents alternate-line rows");

const homepageBoard = readFileSync("app/components/HomepageTrackingCategoryBoard.tsx", "utf8");
const homepage = readFileSync("app/page.tsx", "utf8");
const summary = readFileSync("lib/services/tracking/publicTrackRecordSummary.ts", "utf8");
assert.match(homepageBoard, /Same tracked picks at adjusted lines\. Prices excluded; not additional independent picks or betting returns\./);
assert.match(homepageBoard, /row\.source === "prior_release"/);
assert.match(homepageBoard, /row\.original\.settled\.toLocaleString\(\)/);
assert.match(homepageBoard, /formatShortDate\(row\.coverageFrom\)/);
assert.match(homepageBoard, /adjustment\.label/);
assert.match(homepage, /Showing the latest available delayed tracking snapshot/);
assert.match(homepage, /Alternate-line results are unavailable from this incomplete snapshot/);
assert.match(summary, /categorySnapshot\.cacheState === "DB_SNAPSHOT"/);
assert.match(summary, /hasCompleteAlternateLinePerformance/);

console.log("homepage/member tracking parity: passed");

// Every model shares the main-category policy too, including a release rollover
// with zero current UCL rows, legacy aliases, pending results, pushes and voids.
const models = ["mlb", "nba", "cbb", "wnba", "nfl", "cfb", "nhl", "epl", "soccer", "ucl"];
const bucket = (sport: string, market: string, wins: number, losses: number) => ({
  sport, market,
  metrics: { ...aggregateMetrics(wins, losses, 2), picks: wins + losses + 6, pending: 3, voids: 1 },
  bestAngles: aggregateMetrics(1, 1), leans: aggregateMetrics(2, 1),
});
const mainSnapshot = {
  bySportMarket: models.filter(sport => sport !== "ucl").map(sport => bucket(sport, "total", 12, 8)),
  baselines: models.map(sport => ({ sport, market: sport === "ucl" ? "moneyline" : "total",
    lifetime_wins: 100, lifetime_total: 174, lifetime_pct: 57.5 })),
  actionableHistory: { bySportMarket: [
    ...models.filter(sport => sport !== "ucl").map(sport => bucket(sport, "total", 12, 8)),
    ...["match_result", "total", "double_chance", "btts"].map(market => bucket("ucl", market, 51, 16)),
  ] },
  thisWeek: { from: "2026-10-30", to: "2026-11-05", bySportMarket: models.map(sport => bucket(sport, "total", 2, 1)) },
  thisMonth: { from: "2026-10-07", to: "2026-11-05", bySportMarket: models.map(sport => bucket(sport, "total", 10, 5)) },
};
const beforeMain = structuredClone(mainSnapshot);
for (const currentUcl of [[], [bucket("ucl", "total", 9, 0)]]) {
  const fixture = { ...mainSnapshot, bySportMarket: [...mainSnapshot.bySportMarket, ...currentUcl] };
  const mainWindows = buildPublicTrackingCategoryWindows(fixture);
  const memberLifetime = buildLifetimeRecords(fixture.bySportMarket, fixture.baselines, fixture.actionableHistory.bySportMarket);
  for (const [index, source] of [fixture.thisWeek.bySportMarket, fixture.thisMonth.bySportMarket].entries()) {
    for (const row of mainWindows[index].rows) {
      const exact = source.find(b => b.sport === row.sport && b.market === row.market)!;
      const { win_pct, ...counts } = exact.metrics;
      assert.deepEqual(row.metrics, { ...counts, winPct: win_pct }, `${row.sport} calendar window remains exact`);
    }
  }
  const publicLifetime = mainWindows[2].rows;
  assert.equal(new Set(publicLifetime.map(r => `${r.sport}:${r.market}`)).size, publicLifetime.length, "no duplicate lifetime categories");
  assert.equal(publicLifetime.length, memberLifetime.length);
  for (const member of memberLifetime) {
    const row = publicLifetime.find(r => r.sport === member.sport && r.market === member.market)!;
    const { win_pct, ...counts } = member.metrics;
    assert.deepEqual(row.metrics, { ...counts, winPct: win_pct }, `${member.sport}:${member.market} public/member exact main parity`);
    if (member.sport !== "ucl") {
      assert.equal(row.metrics.wins, 112, "existing non-UCL baseline merge stays exact");
      assert.equal(row.metrics.losses, 82);
    } else {
      assert.equal(row.metrics.wins, 51, "all locked releases survive a new current release");
      assert.equal(row.metrics.losses, 16);
      assert.equal(row.metrics.pending, 3);
      assert.match(row.detail!, /Locked lifetime · all released locks/);
      assert.equal(row.metrics.pushes, 2);
      assert.equal(row.metrics.voids, 1);
    }
  }
  const matchResult = publicLifetime.find(r => r.sport === "ucl" && r.market === "match_result")!;
  assert.match(matchResult.detail!, /earlier archive 100\/174/);
  assert.equal(publicLifetime.some(r => r.sport === "ucl" && r.market === "moneyline"), false);
}
assert.deepEqual(mainSnapshot, beforeMain, "readers cannot change a frozen source, grade cut, baseline or stored result");
console.log("all ten models: main window parity, rollover continuity, legacy archive separation and immutable inputs passed");
