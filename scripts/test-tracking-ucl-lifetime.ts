import assert from "node:assert/strict";

import { buildLifetimeRecords } from "../app/lab/tracking/TrackingClient";

type Metrics = {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  win_pct: number | null;
};

const emptyMetrics = (): Metrics => ({
  picks: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
  voids: 0,
  pending: 0,
  win_pct: null,
});

const locked = (market: string, wins: number, losses: number, pending: number) => ({
  sport: "ucl",
  market,
  metrics: {
    picks: wins + losses + pending,
    wins,
    losses,
    pushes: 0,
    voids: 0,
    pending,
    win_pct: Number(((wins / (wins + losses)) * 100).toFixed(2)),
  },
  bestAngles: emptyMetrics(),
  leans: emptyMetrics(),
});

const records = buildLifetimeRecords(
  [],
  [
    {
      sport: "ucl",
      market: "moneyline",
      source_label: "UCL (ML)",
      lifetime_wins: 100,
      lifetime_total: 174,
      lifetime_pct: 57.5,
    },
    {
      sport: "ucl",
      market: "double_chance",
      source_label: "UCL (Double Chance)",
      lifetime_wins: 129,
      lifetime_total: 174,
      lifetime_pct: 74.1,
    },
  ],
  [
    locked("match_result", 38, 15, 1),
    locked("total", 37, 12, 5),
    locked("btts", 35, 14, 5),
    locked("double_chance", 40, 9, 5),
  ],
);

assert.deepEqual(
  records.map((record) => record.market),
  ["match_result", "total", "double_chance", "btts"],
  "UCL Lifetime must render every official released market exactly once",
);

const btts = records.find((record) => record.market === "btts");
assert.ok(btts, "UCL BTTS Lifetime record is present");
assert.equal(btts.source_type, "locked_lifetime");
assert.equal(btts.display_record, "35-14");
assert.equal(btts.pending, 5);
assert.equal(btts.historical_archive, undefined);

const matchResult = records.find((record) => record.market === "match_result");
assert.ok(matchResult, "UCL Match Result Lifetime record is present");
assert.equal(matchResult.historical_archive, "100/174 (57.5%)");
assert.equal(records.some((record) => record.market === "moneyline"), false);

const doubleChance = records.find((record) => record.market === "double_chance");
assert.ok(doubleChance, "UCL Double Chance Lifetime record is present");
assert.equal(doubleChance.historical_archive, "129/174 (74.1%)");

console.log("tracking UCL lifetime tests passed");
