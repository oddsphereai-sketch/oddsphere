import assert from "node:assert/strict";
import {
  CFB_HOLISTIC_CONFIDENCE_CANDIDATE_RELEASE,
  evaluateCfbHolisticConfidence,
  favoritePriceTierCeiling,
  selectedSideMovementSupportPp,
  type CfbHolisticConfidenceInput,
} from "../lib/services/football/cfbHolisticConfidenceCandidate";

const umass: CfbHolisticConfidenceInput = {
  market: "spread",
  selectedSide: "away",
  modelProbability: 0.5347958920405678,
  marketFairProbability: 0.52,
  decisionGrade: "Watchlist",
  exactPriceExpectedValue: 0.025434325105308853,
  evaluatedPrice: -109,
  evaluatedLine: 29.5,
  sharpMoneyMinusTicketsPp: 17,
  publicMoneyMinusTicketsPp: 4,
  selectedSideLineDelta: -0.5,
  selectedSideImpliedProbabilityDeltaPp: 0.46,
  sharpDirection: "support",
  movementDirection: "neutral",
  publicDirection: "neutral",
};

const umassCandidate = evaluateCfbHolisticConfidence(umass);
assert.equal(umassCandidate.candidateRelease, CFB_HOLISTIC_CONFIDENCE_CANDIDATE_RELEASE);
assert.equal(umassCandidate.probabilityGrade, "Watchlist");
assert.equal(umassCandidate.confidenceGrade, "Lean", "strong persistent Circa affirmation can continuously lift a 53.48% large-spread Watchlist");
assert.equal(umassCandidate.executionStatus, "bet");
assert.ok(umassCandidate.confidenceScore > 55);
assert.ok(umassCandidate.evidenceContributions.sharp > umassCandidate.evidenceContributions.public);
assert.ok(umassCandidate.evidenceContributions.movement > 0, "a favorite laying fewer points supports the selected underdog's team-strength read");

const badQuote = evaluateCfbHolisticConfidence({
  ...umass,
  evaluatedPrice: -145,
  exactPriceExpectedValue: -0.08,
});
assert.equal(badQuote.confidenceGrade, umassCandidate.confidenceGrade, "one sportsbook price cannot erase the confidence grade");
assert.equal(badQuote.confidenceScore, umassCandidate.confidenceScore);
assert.equal(badQuote.executionStatus, "shop", "negative exact-price EV changes execution rather than confidence");

const extremeLine = evaluateCfbHolisticConfidence({ ...umass, evaluatedLine: 42.5 });
assert.equal(extremeLine.confidenceGrade, "Lean", "absolute spread size is not an automatic confidence veto");

const highConfidenceMoneyline: CfbHolisticConfidenceInput = {
  ...umass,
  market: "moneyline",
  selectedSide: "home",
  modelProbability: 0.75,
  marketFairProbability: 0.75,
  decisionGrade: "Lean",
  exactPriceExpectedValue: -0.02,
  evaluatedLine: null,
  sharpMoneyMinusTicketsPp: 0,
  publicMoneyMinusTicketsPp: 0,
  selectedSideLineDelta: null,
  selectedSideImpliedProbabilityDeltaPp: 0,
  sharpDirection: "neutral",
  movementDirection: "neutral",
  publicDirection: "neutral",
};
const atBestAngleBoundary = evaluateCfbHolisticConfidence({ ...highConfidenceMoneyline, evaluatedPrice: -200 });
assert.equal(atBestAngleBoundary.uncappedConfidenceGrade, "Best Angle");
assert.equal(atBestAngleBoundary.confidenceGrade, "Best Angle", "-200 remains eligible for Best Angle");
assert.equal(atBestAngleBoundary.priceTierCeiling, null);

for (const evaluatedPrice of [-201, -499]) {
  const capped = evaluateCfbHolisticConfidence({ ...highConfidenceMoneyline, evaluatedPrice });
  assert.equal(capped.uncappedConfidenceGrade, "Best Angle");
  assert.equal(capped.confidenceGrade, "Lean", `${evaluatedPrice} cannot exceed Lean`);
  assert.equal(capped.priceTierCeiling, "Lean");
  assert.equal(capped.executionStatus, "shop", "the attached quote still controls execution status");
}

for (const evaluatedPrice of [-500, -4000]) {
  const capped = evaluateCfbHolisticConfidence({ ...highConfidenceMoneyline, evaluatedPrice });
  assert.equal(capped.uncappedConfidenceGrade, "Best Angle");
  assert.equal(capped.confidenceGrade, "Watchlist", `${evaluatedPrice} cannot exceed Watchlist`);
  assert.equal(capped.priceTierCeiling, "Watchlist");
  assert.notEqual(capped.confidenceGrade, "No Play", "price ceilings never veto a prediction");
}

const expensiveSpread = evaluateCfbHolisticConfidence({
  ...highConfidenceMoneyline,
  market: "spread",
  decisionGrade: "Best Angle",
  evaluatedPrice: -500,
  evaluatedLine: -3.5,
});
assert.equal(expensiveSpread.confidenceGrade, "Best Angle", "the favorite-price ceiling is moneyline-only");
assert.equal(favoritePriceTierCeiling("total", -4000), null, "totals cannot enter the favorite-price ceiling");

const unsupportedSpreadDisagreement = evaluateCfbHolisticConfidence({
  ...highConfidenceMoneyline,
  market: "spread",
  evaluatedPrice: -110,
  evaluatedLine: 34.5,
  modelProbability: 0.61,
  marketFairProbability: 0.46,
  sharpMoneyMinusTicketsPp: null,
  publicMoneyMinusTicketsPp: null,
  selectedSideLineDelta: null,
  selectedSideImpliedProbabilityDeltaPp: null,
});
assert.equal(unsupportedSpreadDisagreement.confidenceGrade, "Lean", "unsupported confidence cannot create a premium Spread tier even though market disagreement is not blended into a second model");
assert.equal(unsupportedSpreadDisagreement.confidenceScore, unsupportedSpreadDisagreement.modelConfidenceScore);

const exactDecisionCeiling = evaluateCfbHolisticConfidence({
  ...highConfidenceMoneyline,
  market: "spread",
  decisionGrade: "No Play",
  evaluatedPrice: -110,
  evaluatedLine: -3.5,
});
assert.equal(exactDecisionCeiling.confidenceGrade, "Watchlist", "a poor exact-price Spread foundation advances only one tier without multi-channel affirmation");

const multiChannelSpread = evaluateCfbHolisticConfidence({
  ...highConfidenceMoneyline,
  market: "spread",
  evaluatedPrice: -110,
  evaluatedLine: -3.5,
  decisionGrade: "Watchlist",
  sharpDirection: "support",
  movementDirection: "support",
  publicDirection: "neutral",
});
assert.equal(multiChannelSpread.confidenceGrade, "Best Angle", "two independent affirming channels preserve a tested premium Spread path");
assert.equal(multiChannelSpread.marketEvidenceBallot.multiChannelAffirmation, true);

const resisted = evaluateCfbHolisticConfidence({
  ...umass,
  sharpMoneyMinusTicketsPp: -20,
  publicMoneyMinusTicketsPp: -20,
  selectedSideLineDelta: 1,
  selectedSideImpliedProbabilityDeltaPp: -2,
  sharpDirection: "resistance",
  movementDirection: "resistance",
  publicDirection: "resistance",
});
assert.equal(resisted.confidenceGrade, "No Play", "aligned resistance lowers the same continuous confidence score without a one-channel veto");
assert.ok(resisted.evidenceConfidenceAdjustment < 0);

assert.equal(selectedSideMovementSupportPp({
  market: "spread",
  selectedSide: "home",
  selectedSideLineDelta: 0.5,
  selectedSideImpliedProbabilityDeltaPp: 0,
}), -0.5, "a favorite laying fewer points is market resistance for the favorite");
assert.equal(selectedSideMovementSupportPp({
  market: "spread",
  selectedSide: "away",
  selectedSideLineDelta: -0.5,
  selectedSideImpliedProbabilityDeltaPp: 0,
}), 0.5, "a favorite laying fewer points is market support for the underdog");

console.log("CFB holistic confidence shadow candidate tests passed.");
