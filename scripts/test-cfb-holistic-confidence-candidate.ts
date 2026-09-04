import assert from "node:assert/strict";
import {
  CFB_HOLISTIC_CONFIDENCE_CANDIDATE_RELEASE,
  evaluateCfbHolisticConfidence,
  selectedSideMovementSupportPp,
  type CfbHolisticConfidenceInput,
} from "../lib/services/football/cfbHolisticConfidenceCandidate";

const umass: CfbHolisticConfidenceInput = {
  market: "spread",
  selectedSide: "away",
  modelProbability: 0.5347958920405678,
  exactPriceExpectedValue: 0.025434325105308853,
  evaluatedPrice: -109,
  evaluatedLine: 29.5,
  sharpMoneyMinusTicketsPp: 17,
  publicMoneyMinusTicketsPp: 4,
  selectedSideLineDelta: -0.5,
  selectedSideImpliedProbabilityDeltaPp: 0.46,
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

const resisted = evaluateCfbHolisticConfidence({
  ...umass,
  sharpMoneyMinusTicketsPp: -20,
  publicMoneyMinusTicketsPp: -20,
  selectedSideLineDelta: 1,
  selectedSideImpliedProbabilityDeltaPp: -2,
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
