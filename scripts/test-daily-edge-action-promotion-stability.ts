import assert from "node:assert/strict";
import {
  canonicalActionPromotionIdentity,
  expectedValueAtAmericanOdds,
  resolveActionPromotionStability,
} from "../lib/services/dailyEdge/actionPromotionStability";

const baseIdentity = {
  sport: "mlb",
  gameId: 56018,
  market: "moneyline",
  selectedSide: "home",
  evaluatedLine: null,
  forecastRelease: "mlb_probability_head_v1",
};
const config = { requiredDistinctCycles: 2, minimumElapsedMs: 10 * 60_000, minimumExpectedValue: 0 };
const coherent = { exactPriceCoherent: true };

assert.equal(canonicalActionPromotionIdentity(baseIdentity), canonicalActionPromotionIdentity({ ...baseIdentity }));
assert.ok(Math.abs((expectedValueAtAmericanOdds(0.579234, -148) ?? 0) - (-0.029392)) < 0.00001);

const first = resolveActionPromotionStability({
  ...config,
  ...coherent,
  identity: baseIdentity,
  cycle: { id: "cycle-a", capturedAt: "2026-08-29T17:15:00.000Z" },
  candidateGrade: "best_angle",
  currentlyPublishedGrade: "no_play",
  currentModelProbability: 0.62,
  currentAmericanOdds: -140,
  previousState: null,
});
assert.equal(first.finalGrade, "no_play");
assert.equal(first.promotionPending, true);

const retry = resolveActionPromotionStability({
  ...config,
  ...coherent,
  identity: baseIdentity,
  cycle: { id: "cycle-a", capturedAt: "2026-08-29T17:15:00.000Z" },
  candidateGrade: "best_angle",
  currentlyPublishedGrade: "no_play",
  currentModelProbability: 0.62,
  currentAmericanOdds: -139,
  previousState: first.state,
});
assert.equal(retry.finalGrade, "no_play");
assert.deepEqual(retry.state.qualifyingCycleIds, ["cycle-a"]);

// Sportsbook is intentionally absent from identity. A coherent book rotation
// confirms the same prediction when its own exact economics still qualify.
const second = resolveActionPromotionStability({
  ...config,
  ...coherent,
  identity: baseIdentity,
  cycle: { id: "cycle-b", capturedAt: "2026-08-29T17:30:00.000Z" },
  candidateGrade: "best_angle",
  currentlyPublishedGrade: "no_play",
  currentModelProbability: 0.62,
  currentAmericanOdds: -142,
  previousState: retry.state,
});
assert.equal(second.finalGrade, "best_angle");
assert.deepEqual(second.state.qualifyingCycleIds, ["cycle-a", "cycle-b"]);

const tooSoon = resolveActionPromotionStability({
  ...config,
  ...coherent,
  identity: baseIdentity,
  cycle: { id: "cycle-c", capturedAt: "2026-08-29T17:20:00.000Z" },
  candidateGrade: "best_angle",
  currentlyPublishedGrade: "no_play",
  currentModelProbability: 0.62,
  currentAmericanOdds: -140,
  previousState: first.state,
});
assert.equal(tooSoon.finalGrade, "no_play");

const changedSide = resolveActionPromotionStability({
  ...config,
  ...coherent,
  identity: { ...baseIdentity, selectedSide: "away" },
  cycle: { id: "cycle-b", capturedAt: "2026-08-29T17:30:00.000Z" },
  candidateGrade: "best_angle",
  currentlyPublishedGrade: "no_play",
  currentModelProbability: 0.62,
  currentAmericanOdds: -140,
  previousState: first.state,
});
assert.equal(changedSide.finalGrade, "no_play");
assert.deepEqual(changedSide.state.qualifyingCycleIds, ["cycle-b"]);

const failedEconomics = resolveActionPromotionStability({
  ...config,
  ...coherent,
  identity: baseIdentity,
  cycle: { id: "cycle-c", capturedAt: "2026-08-29T17:45:00.000Z" },
  candidateGrade: "best_angle",
  currentlyPublishedGrade: "best_angle",
  currentModelProbability: 0.579234,
  currentAmericanOdds: -148,
  previousState: second.state,
});
assert.equal(failedEconomics.finalGrade, "no_play");
assert.equal(failedEconomics.immediateDemotion, true);

const safetyDemotion = resolveActionPromotionStability({
  ...config,
  ...coherent,
  identity: baseIdentity,
  cycle: { id: "cycle-c", capturedAt: "2026-08-29T17:45:00.000Z" },
  candidateGrade: "no_play",
  currentlyPublishedGrade: "best_angle",
  currentModelProbability: 0.62,
  currentAmericanOdds: -140,
  previousState: second.state,
});
assert.equal(safetyDemotion.finalGrade, "no_play");
assert.equal(safetyDemotion.immediateDemotion, true);

const incoherent = resolveActionPromotionStability({
  ...config,
  identity: baseIdentity,
  cycle: { id: "cycle-c", capturedAt: "2026-08-29T17:45:00.000Z" },
  candidateGrade: "best_angle",
  currentlyPublishedGrade: "best_angle",
  currentModelProbability: 0.62,
  currentAmericanOdds: -140,
  exactPriceCoherent: false,
  previousState: second.state,
});
assert.equal(incoherent.finalGrade, "no_play");
assert.equal(incoherent.reason, "incoherent_exact_price");

console.log("daily-edge action promotion stability tests passed");
