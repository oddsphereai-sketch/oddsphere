import assert from "node:assert/strict";
import {
  NFL_T60_MAX_CAPTURE_LAG_MINUTES,
  buildNflRegularEvaluatedBetDecision,
  buildNflRegularOutcomeConfidence,
  nflRegularQuoteDisposition,
} from "../lib/services/football/nflRegularDecisionEvidence";

const base = {
  providerGameId: "week1-ne-sea",
  market: "spread" as const,
  side: "SEA -3.5",
  modelProbability: 0.56,
  marketFairProbability: 0.515,
  evaluatedQuote: {
    sportsbook: "fanduel",
    line: -3.5,
    price: -108,
    observedAt: "2026-09-09T21:18:00.000Z",
  },
  grade: "LEAN",
  evaluatedAt: "2026-09-09T21:20:00.000Z",
  gameStartsAt: "2026-09-10T00:20:00.000Z",
  modelRelease: "nfl_model_shadow_r1",
  calibrationRelease: "nfl_calibration_shadow_r1",
  decisionRelease: "nfl_decision_shadow_r1",
};

const unlocked = buildNflRegularEvaluatedBetDecision({ ...base, stage: "unlocked" });
assert.equal(unlocked.decisionKind, "exact_price_bet");
assert.equal(unlocked.lockedAt, null);
assert.ok(unlocked.expectedValue > 0);
assert.equal(nflRegularQuoteDisposition({
  decision: unlocked,
  currentQuote: { ...base.evaluatedQuote, observedAt: "2026-09-09T21:25:00.000Z" },
}), "same_as_evaluated");
assert.equal(nflRegularQuoteDisposition({
  decision: unlocked,
  currentQuote: { ...base.evaluatedQuote, line: -4, price: -112, observedAt: "2026-09-09T21:25:00.000Z" },
}), "writer_refresh_required");

const lockedAt = "2026-09-09T23:20:00.000Z";
const locked = buildNflRegularEvaluatedBetDecision({
  ...base,
  stage: "t60_locked",
  evaluatedAt: lockedAt,
  evaluatedQuote: { ...base.evaluatedQuote, observedAt: lockedAt },
  lockedAt,
});
assert.equal(nflRegularQuoteDisposition({
  decision: locked,
  currentQuote: { ...base.evaluatedQuote, line: -4.5, observedAt: "2026-09-09T23:35:00.000Z" },
}), "context_only_after_t60");
assert.equal(NFL_T60_MAX_CAPTURE_LAG_MINUTES, 20);

const maximumOnTimeLock = "2026-09-09T23:40:00.000Z";
assert.doesNotThrow(() => buildNflRegularEvaluatedBetDecision({
  ...base,
  stage: "t60_locked",
  evaluatedAt: maximumOnTimeLock,
  evaluatedQuote: { ...base.evaluatedQuote, observedAt: maximumOnTimeLock },
  lockedAt: maximumOnTimeLock,
}));

const overMaximumLock = "2026-09-09T23:41:00.000Z";
assert.throws(() => buildNflRegularEvaluatedBetDecision({
  ...base,
  stage: "t60_locked",
  evaluatedAt: overMaximumLock,
  evaluatedQuote: { ...base.evaluatedQuote, observedAt: overMaximumLock },
  lockedAt: overMaximumLock,
}), /exceeds the 20-minute maximum T-60 capture lag/);

const thirtyMinutesBeforeKick = "2026-09-09T23:50:00.000Z";
assert.throws(() => buildNflRegularEvaluatedBetDecision({
  ...base,
  stage: "t60_locked",
  evaluatedAt: thirtyMinutesBeforeKick,
  evaluatedQuote: { ...base.evaluatedQuote, observedAt: thirtyMinutesBeforeKick },
  lockedAt: thirtyMinutesBeforeKick,
}), /exceeds the 20-minute maximum T-60 capture lag/);

const outcome = buildNflRegularOutcomeConfidence({
  market: "moneyline",
  likelySide: "SEA",
  probability: 0.61,
  evaluatedAt: base.evaluatedAt,
  modelRelease: base.modelRelease,
});
assert.equal(outcome.nonActionable, true);
assert.equal(outcome.decisionKind, "outcome_confidence");

assert.throws(() => buildNflRegularEvaluatedBetDecision({
  ...base,
  stage: "t60_locked",
  lockedAt: "2026-09-09T22:00:00.000Z",
}), /freeze the evaluated tuple/);

console.log("NFL evaluated-price tuple, refresh, T-60 freeze, and outcome-confidence tests passed.");
