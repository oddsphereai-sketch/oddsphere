import assert from "node:assert/strict";
import {
  DAILY_EDGE_CONFIDENCE_EXECUTION_CONTRACT_RELEASE,
  confidenceGradeFromScore,
  executionStatusForQuote,
  resolveDailyEdgeConfidenceExecutionDecision,
  stableConfidenceGrade,
} from "@/lib/services/dailyEdge/confidenceExecutionContract";

assert.equal(confidenceGradeFromScore(55.88), "Lean");
assert.equal(confidenceGradeFromScore(60.1), "Best Angle");

assert.equal(stableConfidenceGrade({ score: 54.8, previousGrade: "Lean" }), "Lean");
assert.equal(stableConfidenceGrade({ score: 54.4, previousGrade: "Lean" }), "Watchlist");
assert.equal(stableConfidenceGrade({ score: 55.2, previousGrade: "Watchlist" }), "Watchlist");
assert.equal(stableConfidenceGrade({ score: 55.6, previousGrade: "Watchlist" }), "Lean");

assert.equal(executionStatusForQuote({ americanPrice: -109, expectedValue: 0.0254, quoteFresh: true, quoteCoherent: true }), "bet");
assert.equal(executionStatusForQuote({ americanPrice: -145, expectedValue: -0.08, quoteFresh: true, quoteCoherent: true }), "shop");
assert.equal(executionStatusForQuote({ americanPrice: null, expectedValue: null, quoteFresh: true, quoteCoherent: true }), "unavailable");
assert.equal(executionStatusForQuote({ americanPrice: -109, expectedValue: 0.0254, quoteFresh: false, quoteCoherent: true }), "unavailable");

const bet = resolveDailyEdgeConfidenceExecutionDecision({ confidenceScore: 55.88, americanPrice: -109, expectedValue: 0.0254, quoteFresh: true, quoteCoherent: true });
assert.equal(bet.contractRelease, DAILY_EDGE_CONFIDENCE_EXECUTION_CONTRACT_RELEASE);
assert.equal(bet.confidenceGrade, "Lean");
assert.equal(bet.recommendationStatus, "bet");
assert.equal(bet.actionableAtDisplayedQuote, true);
assert.equal(bet.noBet, false);

const shop = resolveDailyEdgeConfidenceExecutionDecision({ confidenceScore: 55.88, americanPrice: -145, expectedValue: -0.08, quoteFresh: true, quoteCoherent: true });
assert.equal(shop.confidenceGrade, bet.confidenceGrade, "price and EV cannot mutate confidence");
assert.equal(shop.recommendationStatus, "shop");
assert.equal(shop.actionableAtDisplayedQuote, false);
assert.equal(shop.noBetReason, "displayed_quote_negative_expected_value_shop");

const monitor = resolveDailyEdgeConfidenceExecutionDecision({ confidenceScore: 53, americanPrice: 110, expectedValue: 0.12, quoteFresh: true, quoteCoherent: true });
assert.equal(monitor.confidenceGrade, "Watchlist");
assert.equal(monitor.recommendationStatus, "monitor", "positive EV cannot promote a weak confidence read");

const held = resolveDailyEdgeConfidenceExecutionDecision({ confidenceScore: 70, hardHoldReason: "team_identity_unresolved", americanPrice: -110, expectedValue: 0.2, quoteFresh: true, quoteCoherent: true });
assert.equal(held.confidenceGrade, "No Play");
assert.equal(held.recommendationStatus, "unavailable");
assert.equal(held.noBetReason, "team_identity_unresolved");

for (const expectedValue of [-0.5, -0.01, 0, 0.01, 0.5]) {
  assert.equal(
    resolveDailyEdgeConfidenceExecutionDecision({ confidenceScore: 61, americanPrice: -110, expectedValue, quoteFresh: true, quoteCoherent: true }).confidenceGrade,
    "Best Angle",
    "EV perturbations never alter confidence grade",
  );
}

const grade = confidenceGradeFromScore(55.88);
executionStatusForQuote({ americanPrice: -145, expectedValue: -0.08, quoteFresh: true, quoteCoherent: true });
assert.equal(grade, "Lean", "price execution must not mutate the confidence grade");

console.log("Daily Edge confidence/execution contract tests passed.");
