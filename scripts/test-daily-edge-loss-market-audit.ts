import assert from "node:assert/strict";

import {
  compactAuditRow,
  decisionRelease,
  marketEvidenceBallot,
  rankCounterfactualEvidenceReviews,
  summarizeReleaseCohorts,
  summarizeEvidenceBallots,
  summarizeSignalCohorts,
} from "./operator/audit-daily-edge-loss-market-evidence";

const releaseA = "cfb_v1_daily_edge_decision_test_a";
const releaseB = "cfb_v1_daily_edge_decision_test_b";

assert.equal(
  decisionRelease({ decision_tuple: { decisionRelease: releaseA } }),
  releaseA,
  "decision tuple release must be authoritative",
);
assert.equal(
  decisionRelease({ model_layer_versions: { decision_release_id: releaseB } }),
  releaseB,
  "model-layer fallback release must remain readable",
);
assert.equal(decisionRelease({}), "unknown", "missing release must be explicit, not blended");

function row(id: number, release: string, result: "win" | "loss", noBet: boolean) {
  return compactAuditRow({
    id,
    sport: "cfb",
    slate_date: "2026-09-03",
    matchup: "AWAY @ HOME",
    market: "spread",
    pick: "HOME -3.5",
    side: "home",
    line_value: -3.5,
    odds_american: -110,
    model_probability: 0.56,
    market_probability: 0.5238,
    edge: 3.62,
    play_grade: noBet ? "watchlist" : "lean",
    no_bet: noBet,
    locked_at: "2026-09-03T16:00:00.000Z",
    snapshot_json: {
      decision_tuple: { decisionRelease: release, expectedValue: noBet ? -0.03 : 0.04 },
      public_splits: { conflict: true, picked_bets_pct: 68, picked_money_pct: 43 },
    },
    prediction_grades: { result, win: result === "win", loss: result === "loss" },
  });
}

const cohorts = summarizeReleaseCohorts([
  row(1, releaseA, "loss", false),
  row(2, releaseA, "win", true),
  row(3, releaseB, "win", false),
]);

assert.equal(cohorts.length, 3, "release and grade cohorts must never be blended");
assert.equal(
  cohorts.find((cohort) => cohort.key === `${releaseA}|spread|lean`)?.actionableLosses,
  1,
  "actionable loss counts must exclude held predictions",
);
assert.equal(
  cohorts.find((cohort) => cohort.key === `${releaseA}|spread|watchlist`)?.actionableRecords,
  0,
  "Watchlists must remain outside actionable results",
);
assert.equal(
  summarizeSignalCohorts([
    row(1, releaseA, "loss", false),
    row(2, releaseB, "win", false),
  ]).length,
  2,
  "market-signal summaries must stay separated by release",
);

const resistedLoss = row(4, releaseA, "loss", false);
const supportedWinner = compactAuditRow({
  ...({
    id: 5,
    sport: "cfb",
    slate_date: "2026-09-03",
    matchup: "AWAY @ HOME",
    market: "spread",
    pick: "HOME -3.5",
    side: "home",
    line_value: -3.5,
    odds_american: -110,
    model_probability: 0.56,
    market_probability: 0.5238,
    edge: 3.62,
    play_grade: "lean",
    no_bet: false,
    locked_at: "2026-09-03T16:00:00.000Z",
    snapshot_json: {
      decision_tuple: {
        decisionRelease: releaseA,
        gradeAdjustment: {
          movementDirection: "support",
          sharpDirection: "support",
          publicDirection: "neutral",
        },
      },
    },
    prediction_grades: { result: "win", win: true, loss: false },
  }),
});

assert.deepEqual(
  marketEvidenceBallot(resistedLoss),
  {
    availableChannels: 1,
    supportVotes: 0,
    resistanceVotes: 1,
    netSupportVotes: -1,
    supportedBy: [],
    opposedBy: ["public"],
    mixed: false,
  },
  "public conflict must be an explicit opposition vote",
);
assert.equal(
  rankCounterfactualEvidenceReviews([supportedWinner, resistedLoss])[0]?.id,
  resistedLoss.id,
  "counterfactual review must rank opposition without filtering out winners from comparison",
);
assert.equal(
  summarizeEvidenceBallots([supportedWinner, resistedLoss]).reduce((sum, cohort) => sum + cohort.records, 0),
  2,
  "evidence ballots must include both wins and losses",
);

console.log("daily-edge loss market audit tests passed");
