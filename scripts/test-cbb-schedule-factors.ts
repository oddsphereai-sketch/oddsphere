import assert from "node:assert/strict";
import { enrichScheduleFactors, scheduleAdjustedFactors } from "../lib/cbb/scheduleFactorResearch";
import type { CbbScoreFeatureRow } from "../lib/cbb/scoreResearch";
import type { CbbFourFactors, CbbTrainingGame } from "../lib/cbb/types";

const factor = (efg: number): CbbFourFactors => ({ efg, turnoverRate: 0.18, offensiveReboundRate: 0.28, freeThrowRate: 0.3 });
const game = (id: number, date: string, homeId: number, awayId: number, homeEfg: number, awayEfg: number): CbbTrainingGame => ({
  id, date, season: 2024, homeId, awayId, homeScore: 80, awayScore: 70, homeRegulation: 80, awayRegulation: 70,
  overtime: false, possessions: 70, tempo: 70, neutral: false, homeFactors: factor(homeEfg), awayFactors: factor(awayEfg),
});
const history = [
  game(1, "2024-11-01T18:00:00.000Z", 1, 2, 0.6, 0.4),
  game(2, "2024-11-02T18:00:00.000Z", 3, 4, 0.5, 0.5),
];
const at = "2024-11-02T01:00:00.000Z";
const fit = scheduleAdjustedFactors(history, 2024, at);
assert.equal(fit.games, 1, "six-hour receipt lag excludes same-day unreceived game");
const futureChanged = [...history];
futureChanged[1] = game(2, "2024-11-02T18:00:00.000Z", 3, 4, 0.99, 0.01);
assert.deepEqual(scheduleAdjustedFactors(futureChanged, 2024, at), fit, "future score and factors cannot affect fit");
const row = {
  game: game(3, "2024-11-03T18:00:00.000Z", 1, 2, 0.5, 0.5),
  forecast: { asOf: at }, features: Array(19).fill(0),
} as CbbScoreFeatureRow;
const [enriched] = enrichScheduleFactors([row], history);
assert.equal(enriched.features.length, row.features.length);
assert.equal(enriched.features[0], row.features[0], "unrelated features unchanged");
assert.ok(enriched.features[7] > 0, "stronger observed shooting side retains directional feature");
const [swapped] = enrichScheduleFactors([{ ...row, game: { ...row.game, homeId: 2, awayId: 1 } }], history);
for (let i = 0; i < 4; i++) {
  assert.ok(Math.abs(enriched.features[7 + i] + swapped.features[7 + i]) < 1e-12, "difference flips on swap");
  assert.ok(Math.abs(enriched.features[11 + i] - swapped.features[11 + i]) < 1e-12, "sum invariant on swap");
}
console.log("CBB schedule-factor temporal and symmetry tests passed");
