import assert from "node:assert/strict";
import { nativeNbaBestPriceGrade, assertNativeNbaGradePolicyLineage } from "../lib/services/nba/nbaPlayerPropsNativeGrade";
import { buildNbaPlayerPropsPrivateTrackingRow } from "../lib/services/nba/nbaPlayerPropsPrivateTracking";
import { buildNbaPlayerPropsSettlementRevision } from "../lib/services/nba/nbaPlayerPropsSettlementStore";
import type { NbaHistoricalPlayerBox } from "../lib/services/nba/nbaPointInTimeFeatures";

const grade = (candidate: Parameters<typeof nativeNbaBestPriceGrade>[0], probability: number, price: number,
  ev = probability * (price > 0 ? price / 100 : 100 / -price) - (1 - probability)) =>
  nativeNbaBestPriceGrade(candidate, probability, price, ev);

const source = Object.freeze({
  modelRelease: "nba_player_props_model_tournament_2026_10_28_r16_owls_sharp_market_reader",
  calibrationRelease: "nba_player_props_exact_price_grade_2026_10_28_r15_owls_sharp_market_reader",
});
assert.doesNotThrow(() => assertNativeNbaGradePolicyLineage(source));
assert.throws(() => assertNativeNbaGradePolicyLineage({ ...source, modelRelease: "unknown" }));
assert.throws(() => assertNativeNbaGradePolicyLineage({ ...source, calibrationRelease: "unknown" }));
assert.equal(grade("Best Angle", 0.500113, -110), "Lean");
assert.equal(grade("Lean", 0.500113, -110), "Lean", "negative-value confidence Leans retain their original policy");
assert.equal(grade("Best Angle", 2 / 3, -200), "Lean", "zero value is not positive value");
assert.equal(grade("Best Angle", 0.5, 100), "Lean");
assert.equal(grade("Best Angle", 0.5, 101), "Best Angle");
assert.equal(grade("Best Angle", 0.619999, -110), "Best Angle", "no copied 62% native threshold");
assert.equal(grade("Best Angle", 0.70, -201), "Best Angle", "no copied -200 native threshold");
assert.equal(grade("Best Angle", 0.9, -1000), "Lean");
assert.equal(grade("Best Angle", 0.666667, -200, 0), "Lean", "published zero EV cannot be promoted by rounded probability");
assert.equal(grade("Best Angle", 0.5, -110, 0.1), "Lean", "positive stale EV cannot override the actual probability and price");
assert.equal(grade("Best Angle", 0.8, -110, -0.01), "Lean", "negative published EV stays honest");
assert.throws(() => grade("Best Angle", 0.8, -110, NaN));
assert.equal(grade("Watchlist", 0.99, 500), "Watchlist");
assert.equal(grade("No Play", 0.99, 500), "No Play");

let recoveryPromotions = 0;
for (const side of ["over", "under"] as const) {
  const original = Object.freeze({ side, candidate: "Best Angle" as const, probability: 0.70, americanPrice: -300 });
  assert.equal(grade(original.candidate, original.probability, original.americanPrice), "Lean");
  const fresh = Object.freeze({ ...original, americanPrice: -150 });
  assert.equal(grade(fresh.candidate, fresh.probability, fresh.americanPrice), "Best Angle");
  assert.equal(original.americanPrice, -300);
  // The same existing actionable outcome remains actionable. At a genuinely
  // improved quote, every possible unit return is unchanged or improved;
  // prediction probability/calibration and risk exposure do not change.
  const profit = (price: number) => price > 0 ? price / 100 : 100 / -price;
  for (const result of ["win", "loss", "push", "void"] as const) {
    const units = (price: number) => result === "win" ? profit(price) : result === "loss" ? -1 : 0;
    assert(units(fresh.americanPrice) >= units(original.americanPrice));
  }
  recoveryPromotions++;
}

let oracleCases = 0;
for (const candidate of ["Best Angle", "Lean", "Watchlist", "No Play"] as const) {
  for (const price of [-1000, -500, -201, -200, -150, -110, -100, 100, 101, 150, 200, 500]) {
    for (let n = 0; n <= 1000; n++) {
      const p = n / 1000, result = grade(candidate, p, price);
      const ev = p * (price > 0 ? price / 100 : 100 / -price) - (1 - p);
      if (result === "Best Angle") assert(candidate === "Best Angle" && ev > -1e-14);
      if (candidate !== "Best Angle") assert.equal(result, candidate);
      assert.equal(result === "Best Angle" || result === "Lean", candidate === "Best Angle" || candidate === "Lean",
        "the missing Best value guard cannot remove or create an actionable prediction");
      oracleCases++;
    }
  }
}
for (const p of [NaN, Infinity, -0.1, 1.1]) assert.throws(() => grade("Best Angle", p, -110));
for (const price of [0, 99, -99, NaN, Infinity, -110.5]) assert.throws(() => grade("Best Angle", 0.8, price));
let actualSettlementInvarianceCases = 0;
for (const side of ["over", "under"] as const) {
  const base = {
    gameId: "nba-bdl:1", playerId: "nba-bdl-player:10", playerName: "Synthetic native actor",
    team: "AAA", opponent: "BBB", scheduledStart: "2030-01-01T23:00:00.000Z",
    market: "points" as const, line: 10, side, sportsbook: "synthetic", americanPrice: -110,
    canonicalMainLine: true, independentProjection: 10.1, finalProjection: 10.1,
    independentProbability: 0.500113, marketProbability: 0.5, finalProbability: 0.500113,
    marketMovement: null, observedAt: "2030-01-01T20:00:00.000Z", lockedAt: "2030-01-01T22:00:00.000Z",
    modelRelease: source.modelRelease, calibrationRelease: source.calibrationRelease, decisionRelease: "original_synthetic",
  };
  // Independent hypothetical future locks under each policy, never an edit to a stored lock.
  const original = buildNbaPlayerPropsPrivateTrackingRow({ ...base, grade: "Best Angle" });
  const originalBytes = JSON.stringify(original);
  const prospective = buildNbaPlayerPropsPrivateTrackingRow({ ...base,
    grade: grade("Best Angle", base.finalProbability, base.americanPrice), decisionRelease: "prospective_synthetic" });
  for (const points of [8, 10, 12, null]) {
    const box: NbaHistoricalPlayerBox | null = points === null ? null : {
      rowId: 1, gameId: 1, teamId: 1, playerId: 10, minutes: 30, points,
      fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0,
      ast: 0, stl: 0, blk: 0, turnover: 0, pf: 0, plusMinus: 0,
    };
    const settle = (row: typeof original) => buildNbaPlayerPropsSettlementRevision({ row, box, prior: null,
      observedAt: "2030-01-02T03:00:00.000Z" }).revision;
    const a = settle(original), b = settle(prospective);
    assert.deepEqual([b.actual, b.result, b.unitReturn], [a.actual, a.result, a.unitReturn],
      "the actual official settlement path cannot change outcome or units through Best-to-Lean relabeling");
    actualSettlementInvarianceCases++;
  }
  assert.equal(JSON.stringify(original), originalBytes);
}
console.log(JSON.stringify({ nativeBestValueCoherence: true, oracleCases, bothSideRecoveryPromotions: recoveryPromotions,
  allActionableEligibilityPreserved: true, confidenceLeansUnchanged: true, noCopiedNativeThresholds: true,
  allOutcomeUnitReturnDominanceForGenuinePriceRecovery: true, actualSettlementInvarianceCases,
  noModelOrProviderCalls: true }));
