import assert from "node:assert/strict";
import {
  MLB_UNIFIED_TOTAL_SCORE_GAP_SLOPE,
  buildMlbUnifiedGameDistribution,
  mlbUnifiedOverProbability,
} from "../lib/automodel/mlbUnifiedGameDistribution";
import {
  attachMlbUnifiedFinalForecast,
  resolveMlbUnifiedTotalGrade,
} from "../lib/services/predictionRecordService";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";

const homeFavorite = buildMlbUnifiedGameDistribution({
  expectedTotal: 8.7,
  expectedHomeMargin: 1.2,
  marginReferenceHomeRuns: 4.95,
  marginReferenceAwayRuns: 3.75,
  listedTotal: 8.5,
});
assert.equal(homeFavorite.invariants.passed, true);
assert.ok(Math.abs(homeFavorite.expected.home_runs + homeFavorite.expected.away_runs - 8.7) < 1e-9);
assert.ok(Math.abs(homeFavorite.expected.home_runs - homeFavorite.expected.away_runs - 1.2) < 1e-9);
assert.ok(homeFavorite.margin_axis.home_win_probability >= 0.5);
assert.ok(
  homeFavorite.margin_axis.home_minus_1_5_probability <=
    homeFavorite.margin_axis.home_win_probability,
);
assert.ok(
  homeFavorite.margin_axis.away_plus_1_5_probability >=
    homeFavorite.margin_axis.away_win_probability,
);

const awayFavorite = buildMlbUnifiedGameDistribution({
  expectedTotal: 7.9,
  expectedHomeMargin: -1.1,
  marginReferenceHomeRuns: 3.4,
  marginReferenceAwayRuns: 4.5,
  listedTotal: 8,
});
assert.equal(awayFavorite.invariants.passed, true);
assert.ok(awayFavorite.margin_axis.away_win_probability >= 0.5);
assert.ok(
  awayFavorite.margin_axis.away_minus_1_5_probability <=
    awayFavorite.margin_axis.away_win_probability,
);
assert.ok(
  awayFavorite.margin_axis.home_plus_1_5_probability >=
    awayFavorite.margin_axis.home_win_probability,
);

assert.equal(MLB_UNIFIED_TOTAL_SCORE_GAP_SLOPE, 0.096289);
assert.ok(mlbUnifiedOverProbability(9, 7.5) > mlbUnifiedOverProbability(9, 8.5));
assert.ok(mlbUnifiedOverProbability(9, 8.5) > mlbUnifiedOverProbability(9, 9.5));

const bestAngle = resolveMlbUnifiedTotalGrade({
  enabled: true,
  invariantPassed: true,
  writerGrade: "market_aligned",
  statisticalGrade: "best_angle",
  noBet: false,
  provisional: false,
  modelProbability: 0.54,
  projectionGapAbs: 0.8,
  edgePp: 2,
  americanOdds: -125,
});
assert.equal(bestAngle.finalGrade, "best_angle");
assert.equal(bestAngle.bestAngle, true);

const lean = resolveMlbUnifiedTotalGrade({
  enabled: true,
  invariantPassed: true,
  writerGrade: "market_aligned",
  statisticalGrade: "market_aligned",
  noBet: false,
  provisional: false,
  modelProbability: 0.51,
  projectionGapAbs: 0.5,
  edgePp: 0,
  americanOdds: -150,
});
assert.equal(lean.finalGrade, "lean");
assert.equal(lean.bestAngle, false);

const capped = resolveMlbUnifiedTotalGrade({
  enabled: true,
  invariantPassed: true,
  writerGrade: "lean",
  statisticalGrade: "best_angle",
  noBet: false,
  provisional: false,
  modelProbability: 0.7,
  projectionGapAbs: 2,
  edgePp: 10,
  americanOdds: 110,
});
assert.equal(capped.finalGrade, "market_aligned", "legacy action sleeves are not inherited");
assert.equal(capped.bestAngle, false);

const locked = [{
  game_id: 1,
  market: "moneyline",
  locked_at: "2026-10-16T12:00:00.000Z",
  snapshot_json: { legacy: true },
}] as unknown as PredictionRecordRow[];
const lockedResult = attachMlbUnifiedFinalForecast(locked);
assert.strictEqual(lockedResult, locked, "locked bundle must be returned by reference without mutation");
assert.deepEqual(lockedResult[0]?.snapshot_json, { legacy: true });

const unlocked = [
  {
    game_id: 2,
    market: "moneyline",
    side: "home",
    model_probability: 0.58,
    market_probability: 0.55,
    play_grade: "lean",
    best_angle: false,
    no_bet: false,
    locked_at: null,
    snapshot_json: {},
  },
  {
    game_id: 2,
    market: "total",
    side: "over",
    line_value: 8.5,
    model_probability: 0.53,
    market_probability: 0.51,
    play_grade: "lean",
    best_angle: false,
    no_bet: false,
    locked_at: null,
    snapshot_json: {
      predicted_scores_at_lock: { home: 4.9, away: 4.1 },
      v2_2_audit: { unified_game_distribution: { ...homeFavorite, enabled: true } },
    },
  },
] as unknown as PredictionRecordRow[];
const attached = attachMlbUnifiedFinalForecast(unlocked);
assert.notStrictEqual(attached, unlocked);
const attachedForecast0 = (
  attached[0]?.snapshot_json as Record<string, unknown>
).mlb_unified_final_forecast as Record<string, unknown>;
const attachedForecast1 = (
  attached[1]?.snapshot_json as Record<string, unknown>
).mlb_unified_final_forecast as Record<string, unknown>;
const attachedInvariants = attachedForecast0.invariants as Record<string, unknown>;
assert.equal(
  attachedInvariants.passed,
  true,
);
assert.deepEqual(
  attachedForecast0,
  attachedForecast1,
  "every market record must carry the same game-level final forecast",
);

const incoherent = structuredClone(unlocked);
incoherent[0]!.side = "away";
const failedClosed = attachMlbUnifiedFinalForecast(incoherent);
assert.equal(failedClosed[0]?.no_bet, true, "a final Moneyline/score contradiction must fail closed");
assert.equal(failedClosed[1]?.no_bet, true, "a game invariant failure must fail closed as one bundle");

const mixedLock = [unlocked[0]!, locked[0]!];
const mixedLockBefore = structuredClone(mixedLock);
const mixedLockResult = attachMlbUnifiedFinalForecast(mixedLock);
assert.strictEqual(mixedLockResult, mixedLock, "one lock freezes the complete game bundle");
assert.deepEqual(mixedLockResult, mixedLockBefore, "locked bundle bytes must remain unchanged");

console.log("MLB unified game distribution tests passed");
