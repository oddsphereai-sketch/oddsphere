import assert from "node:assert/strict";
import {
  evaluateUpsetForecastRows,
  type UpsetForecastRow,
} from "./operator/lib/upsetForecastEvaluation";

const rows: UpsetForecastRow[] = [
  {
    identity: "correction",
    releaseId: "release-a",
    decisionAt: "2026-09-01T16:00:00.000Z",
    fairMarketUnderdogProbability: 0.42,
    independentUnderdogProbability: 0.46,
    finalUnderdogProbability: 0.54,
    underdogWon: true,
  },
  {
    identity: "harm",
    releaseId: "release-a",
    decisionAt: "2026-09-02T16:00:00.000Z",
    fairMarketUnderdogProbability: 0.41,
    independentUnderdogProbability: 0.49,
    finalUnderdogProbability: 0.53,
    underdogWon: false,
  },
  {
    identity: "tail-improvement-without-flip",
    releaseId: "release-b",
    decisionAt: "2026-09-03T16:00:00.000Z",
    fairMarketUnderdogProbability: 0.18,
    independentUnderdogProbability: 0.2,
    finalUnderdogProbability: 0.3,
    underdogWon: true,
  },
  {
    identity: "favorite-win",
    releaseId: "release-b",
    decisionAt: "2026-09-04T16:00:00.000Z",
    fairMarketUnderdogProbability: 0.12,
    independentUnderdogProbability: 0.16,
    finalUnderdogProbability: 0.1,
    underdogWon: false,
  },
];

const result = evaluateUpsetForecastRows(rows, {
  fairMarketBandEdges: [0, 0.2, 0.4, 0.5],
  alertRules: [{ name: "material-tail-lift", minimumFinalProbability: 0.25, minimumLiftOverFairMarket: 0.08 }],
});

assert.equal(result.rows, 4);
assert.deepEqual(result.releases, ["release-a", "release-b"]);
assert.equal(result.upsets, 2);
assert.deepEqual(result.winnerBoundaryInterventions, { changes: 2, corrections: 1, harms: 1, netRescues: 0 });
assert.equal(result.probabilityDirection.finalImprovedOnIndependent, 3);
assert.equal(result.probabilityDirection.finalHarmedIndependent, 1);
assert.equal(result.fairMarketBands.length, 2);
assert.deepEqual(result.alerts[0], {
  name: "material-tail-lift",
  rows: 3,
  upsets: 2,
  precision: 2 / 3,
  recall: 1,
  meanFinalProbability: (0.54 + 0.53 + 0.3) / 3,
  observedRate: 2 / 3,
});

assert.throws(() => evaluateUpsetForecastRows([{ ...rows[0]!, fairMarketUnderdogProbability: 0.51 }]), /market-defined underdog/);
assert.throws(() => evaluateUpsetForecastRows([rows[0]!, { ...rows[1]!, identity: "correction" }]), /identity must be unique/);

console.log("upset forecast evaluation tests passed");
