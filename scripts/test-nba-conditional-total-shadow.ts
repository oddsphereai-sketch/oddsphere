import assert from "node:assert/strict";
import { predictNbaConditionalTotalShadow } from "../lib/automodel/nba/nbaConditionalTotalShadow";
import { computeNbaMarketProbabilities, nbaEmpiricalTotalOverProbability } from "../lib/automodel/nba/nbaDistribution";
import type { NbaProfessionalMarketReader } from "../lib/services/nba/nbaProfessionalMarketReader";
import { buildNbaProfessionalCandidate } from "../lib/services/nba/nbaProfessionalCandidate";
import type { NbaPortableModelArtifact } from "../lib/automodel/nba/nbaPortableScoreModel";
const law = { marginSigma: 12.964104634449086, totalSigma: 18.251616651383458 };
const at = "2026-11-20T15:00:00Z";
function reader(current: number, opening: number, excluded: string[] = []): NbaProfessionalMarketReader {
  return { evaluatedAt: at, evidenceStatus: "complete", evidenceFamilies: { prices: "complete" }, reads: {
    moneyline: { status: "unavailable", trails: [] }, spread: { status: "unavailable", trails: [] },
    total: { excludedSportsbooks: excluded, trails: [{ provider: "owls", sourceClass: "named", sportsbook: "pinnacle",
      currentNumber: current, openingNumber: opening, currentFairFirstProbability: .5, openingFairFirstProbability: .5,
      currentCaptureAt: "2026-11-20T14:59:00Z", openingCaptureAt: "2026-11-20T12:00:00Z",
      currentAt: "2026-11-20T14:58:00Z", openingAt: "2026-11-20T11:59:00Z" }] },
  } } as unknown as NbaProfessionalMarketReader;
}
// Independent Python trainer parity, synthetic native contracts and training
// medians. These are not copies of paid observations or member picks.
for (const test of [
  { current: 225, opening: 224, independent: 228, line: 224.5, point: 228.27700932589383, mean: 227.44427175538112, probability: .5656401944894651 },
  { current: 250, opening: 240, independent: 242, line: 247.5, point: 253.27700932589383, mean: 252.44427175538112, probability: .5996758508914101 },
  { current: 212, opening: 213, independent: 215, line: 214.5, point: 215.23706938464548, mean: 214.40433181413277, probability: .5153970826580226 },
]) {
  const input = { independentTotal: test.independent, featureRow: {}, reader: reader(test.current, test.opening), evaluatedAt: at, law };
  const original = JSON.stringify(input);
  const result = predictNbaConditionalTotalShadow(input);
  assert.equal(JSON.stringify(input), original);
  assert.equal(result.status, "shadow_applied");
  if (result.status !== "shadow_applied") throw new Error("Shadow did not evaluate synthetic contract");
  assert.ok(Math.abs(result.representativeTotal - test.point) < 1e-10);
  assert.ok(Math.abs(result.expectedTotal - test.mean) < 1e-10);
  const p = nbaEmpiricalTotalOverProbability({ law: result.residualLaw, thresholdResidual: test.line - result.representativeTotal });
  assert.equal(p, test.probability);
  assert.equal(nbaEmpiricalTotalOverProbability({ law: result.residualLaw, thresholdResidual: 0 }), .5);
  let prior = 1;
  for (let threshold = -100; threshold <= 100; threshold += .5) {
    const next = nbaEmpiricalTotalOverProbability({ law: result.residualLaw, thresholdResidual: threshold });
    assert.ok(next <= prior && next > 0 && next < 1); prior = next;
  }
  const base = { projected_home_margin: 5, projected_total: result.representativeTotal, market_spread_home: -4.5,
    market_total: test.line, margin_sd_base: law.marginSigma, total_sd_base: result.sigma };
  const incumbent = computeNbaMarketProbabilities(base);
  assert.deepEqual(incumbent, computeNbaMarketProbabilities({ ...base, total_residual_empirical: undefined }));
  const after = computeNbaMarketProbabilities({ ...base, total_residual_empirical: result.residualLaw });
  assert.equal(after.ml_home_win_prob, incumbent.ml_home_win_prob);
  assert.equal(after.spread_home_cover_prob, incumbent.spread_home_cover_prob);
  assert.equal(after.total_over_prob, p);
  assert.equal(after.total_under_prob! + p, 1);
  assert.deepEqual(after, computeNbaMarketProbabilities(JSON.parse(JSON.stringify({ ...base, total_residual_empirical: result.residualLaw }))));
}
const fallback = predictNbaConditionalTotalShadow({ independentTotal: 228, featureRow: {}, reader: reader(225, 224, ["pinnacle"]), evaluatedAt: at, law });
assert.equal(fallback.status, "incumbent_fallback_missing_native_context");
assert.throws(() => nbaEmpiricalTotalOverProbability({ law: { release: "invalid", residuals: [1] }, thresholdResidual: 0 }));
assert.equal(predictNbaConditionalTotalShadow({ independentTotal: 228, featureRow: {}, reader: reader(225, 224), evaluatedAt: "2026-11-20T18:00:00Z", law }).status, "incumbent_fallback_missing_native_context");
const scoreArtifact: NbaPortableModelArtifact = {
  release: "fixture", featureRelease: "fixture", architecture: "margin_total", model: { family: "ridge", alpha: 1000 },
  design: { features: ["strength"], missingIndicatorColumns: [], rawFeatureMedians: [0], designMeans: [0],
    designStandardDeviations: [1], designColumns: 1, splineKnots: [] },
  coefficients: { target_home_margin: [1, 0], target_total: [0, 228] },
  distribution: { family: "normal_residual", marginSigma: law.marginSigma, totalSigma: law.totalSigma, calibratedOn: "fixture" },
};
const candidateInput = { artifact: scoreArtifact, featureRow: { strength: 4 }, lines: [], history: [], externalGameId: 1,
  marketReader: reader(225, 224) };
// Every ordinary caller remains on the incumbent. The explicit research opt-in
// stamps its own authority and never describes this fit as a causal reader flip.
const originalCandidate = buildNbaProfessionalCandidate(candidateInput);
assert.deepEqual(originalCandidate, buildNbaProfessionalCandidate({ ...candidateInput, conditionalTotalShadow: false }));
const shadowCandidate = buildNbaProfessionalCandidate({ ...candidateInput, conditionalTotalShadow: true });
assert.equal(shadowCandidate.conditionalTotal?.status, "shadow_applied");
assert.equal(shadowCandidate.final.release, shadowCandidate.conditionalTotal!.release);
assert.equal(shadowCandidate.readerDecisionAudit.effects.total, "evaluated_by_conditional_total_shadow");
assert.equal(shadowCandidate.final.totalMovementApplied, false);
assert.equal(shadowCandidate.final.marginHome, originalCandidate.final.marginHome);
assert.equal(shadowCandidate.probabilities.ml_home_win_prob, originalCandidate.probabilities.ml_home_win_prob);
assert.equal(shadowCandidate.probabilities.spread_home_cover_prob, originalCandidate.probabilities.spread_home_cover_prob);
console.log("NBA Total shadow Python parity, CDF monotonicity, median, exact-line serialization, default neutrality, unchanged margin and source exclusions passed.");
