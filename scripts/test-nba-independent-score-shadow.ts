import assert from "node:assert/strict";
import { buildNbaIndependentScoreShadow } from "../lib/automodel/nba/nbaIndependentScoreShadow";
import { buildNbaProfessionalCandidate } from "../lib/services/nba/nbaProfessionalCandidate";
import { NBA_PROFESSIONAL_MODEL_ARTIFACT } from "../lib/automodel/nba/nbaProfessionalRuntimeArtifacts";

const incumbent = {
  homeScore: 112,
  awayScore: 108,
  marginHome: 4,
  total: 220,
};
const featureRow = {
  home_adjusted_offense: 118,
  home_adjusted_defense: 110,
  away_adjusted_offense: 113,
  away_adjusted_defense: 115,
  league_off_rating: 114,
  home_pace_15: 100,
  away_pace_15: 100,
  home_pace_prior: 100,
  away_pace_prior: 100,
};
const shadow = buildNbaIndependentScoreShadow({
  featureRow,
  ridgeBase: incumbent,
  trainingHomeAdvantage: 2,
});
assert.equal(shadow.productionAuthority, false);
assert.equal(shadow.available, true);
assert.equal(shadow.weights.ratingMargin, 0.30);
assert.equal(shadow.weights.ratingTotal, 0.20);
assert.deepEqual(shadow.ridgeBase, incumbent);
assert.ok(shadow.candidate);
assert.ok(shadow.rating);
assert.ok(Math.abs(shadow.rating.marginHome - 12) < 1e-12);
assert.ok(Math.abs(shadow.rating.total - 228) < 1e-12);
assert.ok(Math.abs(shadow.candidate.marginHome - 6.4) < 1e-12);
assert.ok(Math.abs(shadow.candidate.total - 221.6) < 1e-12);

const unavailable = buildNbaIndependentScoreShadow({
  featureRow: { ...featureRow, league_off_rating: null },
  ridgeBase: incumbent,
  trainingHomeAdvantage: 2,
});
assert.equal(unavailable.available, false);
assert.equal(unavailable.candidate, null);
assert.match(unavailable.unavailableReason ?? "", /league_off_rating/);

const overridden = buildNbaProfessionalCandidate({
  artifact: NBA_PROFESSIONAL_MODEL_ARTIFACT,
  featureRow,
  lines: [],
  history: [],
  externalGameId: 1,
  independentOverride: shadow.candidate!,
});
assert.deepEqual(overridden.independent, shadow.candidate);
assert.ok(Math.abs(overridden.final.marginHome - shadow.candidate!.marginHome) < 1e-12);
assert.ok(Math.abs(overridden.final.total - shadow.candidate!.total) < 1e-12);
assert.equal(overridden.readerDecisionAudit.spreadCorrectionApplied, false);
assert.equal(overridden.readerDecisionAudit.totalCorrectionApplied, false);

console.log("NBA independent score shadow: fixed recipe, fail-open capture, and reader isolation passed.");
