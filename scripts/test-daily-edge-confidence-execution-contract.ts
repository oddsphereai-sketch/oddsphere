import assert from "node:assert/strict";
import {
  confidenceGradeFromScore,
  executionStatusForQuote,
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

const grade = confidenceGradeFromScore(55.88);
executionStatusForQuote({ americanPrice: -145, expectedValue: -0.08, quoteFresh: true, quoteCoherent: true });
assert.equal(grade, "Lean", "price execution must not mutate the confidence grade");

console.log("Daily Edge confidence/execution contract tests passed.");
