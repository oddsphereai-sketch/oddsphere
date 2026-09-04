import assert from "node:assert/strict";
import {
  DAILY_EDGE_FULL_GAME_CONFIDENCE_CANDIDATE_RELEASE,
  confidenceBandsFor,
  resolveFullGameConfidenceDecision,
} from "@/lib/services/dailyEdge/fullGameConfidenceSemantics";

const supported = resolveFullGameConfidenceDecision({
  sport: "cfb",
  market: "spread",
  modelProbability: 0.5348,
  evidenceAdjustmentPoints: 2.4,
  americanPrice: -109,
  expectedValue: 0.025,
  quoteFresh: true,
  quoteCoherent: true,
});
assert.equal(supported.candidateRelease, DAILY_EDGE_FULL_GAME_CONFIDENCE_CANDIDATE_RELEASE);
assert.equal(supported.confidenceGrade, "Lean");
assert.equal(supported.recommendationStatus, "bet");

const expensive = resolveFullGameConfidenceDecision({
  sport: "cfb",
  market: "spread",
  modelProbability: 0.5348,
  evidenceAdjustmentPoints: 2.4,
  americanPrice: -160,
  expectedValue: -0.08,
  quoteFresh: true,
  quoteCoherent: true,
});
assert.equal(expensive.confidenceGrade, supported.confidenceGrade);
assert.equal(expensive.confidenceScore, supported.confidenceScore);
assert.equal(expensive.recommendationStatus, "shop");

const weakPositiveEv = resolveFullGameConfidenceDecision({
  sport: "mlb",
  market: "moneyline",
  modelProbability: 0.52,
  americanPrice: 150,
  expectedValue: 0.3,
  quoteFresh: true,
  quoteCoherent: true,
});
assert.equal(weakPositiveEv.confidenceGrade, "Watchlist");
assert.equal(weakPositiveEv.recommendationStatus, "monitor");

const missingPrice = resolveFullGameConfidenceDecision({
  sport: "nfl",
  market: "total",
  modelProbability: 0.62,
  americanPrice: null,
  expectedValue: null,
  quoteFresh: false,
  quoteCoherent: false,
});
assert.equal(missingPrice.confidenceGrade, "Best Angle");
assert.equal(missingPrice.recommendationStatus, "unavailable");
assert.equal(missingPrice.actionableAtDisplayedQuote, false);

const hardHold = resolveFullGameConfidenceDecision({
  sport: "wnba",
  market: "spread",
  modelProbability: 0.7,
  hardHoldReason: "injury_identity_unresolved",
  americanPrice: -110,
  expectedValue: 0.2,
  quoteFresh: true,
  quoteCoherent: true,
});
assert.equal(hardHold.confidenceGrade, "No Play");
assert.equal(hardHold.recommendationStatus, "unavailable");

assert.deepEqual(confidenceBandsFor("soccer", "match_result"), { bestAngle: 55, lean: 48, watchlist: 40 });
assert.deepEqual(confidenceBandsFor("ucl", "double_chance"), { bestAngle: 72, lean: 66, watchlist: 58 });
assert.throws(() => resolveFullGameConfidenceDecision({ sport: "cbb", market: "moneyline", modelProbability: 0.6, americanPrice: -110, expectedValue: 0.1, quoteFresh: true, quoteCoherent: true }), /no active Daily Edge champion/);
assert.throws(() => resolveFullGameConfidenceDecision({ sport: "nhl", market: "total", modelProbability: 0.6, evidenceAdjustmentPoints: 4.1, americanPrice: -110, expectedValue: 0.1, quoteFresh: true, quoteCoherent: true }), /\[-4,4\]/);

console.log("Daily Edge full-game confidence semantic tests passed.");
