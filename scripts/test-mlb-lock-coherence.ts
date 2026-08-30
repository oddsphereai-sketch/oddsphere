import { assessMlbLockCoherence } from "../lib/services/mlbLockCoherence";

const expected = [{
  game_id: 31215,
  market: "moneyline",
  pick: "away",
  side: "away",
  odds_american: 104,
  confidence: 56,
  play_grade: "market_aligned",
  best_angle: false,
  no_bet: false,
  line_value: null,
  model_probability: 0.56,
  market_probability: 0.51,
  edge: 0.05,
  published_at: "2026-08-30T15:21:20.363Z",
  snapshot_json: {
    ml_evaluation_price: {
      evaluated_book: "Saba",
      evaluated_odds: 104,
      evaluated_observed_at: "2026-08-30T15:20:00.000Z",
    },
  },
}];

const coherent = assessMlbLockCoherence({ gameIds: [31215], expectedRows: expected, storedRows: expected });
if (coherent.coherentGameIds[0] !== 31215 || coherent.errors.length !== 0) {
  throw new Error("FAIL: matching model/member rows should pass the lock gate");
}

const stale = assessMlbLockCoherence({
  gameIds: [31215],
  expectedRows: expected,
  storedRows: [{ ...expected[0], pick: "home", side: "home", odds_american: -125, no_bet: true }],
});
if (stale.blockedGameIds[0] !== 31215 || stale.errors.length < 3) {
  throw new Error("FAIL: stale member row should block the game from locking");
}

const missing = assessMlbLockCoherence({ gameIds: [31215], expectedRows: expected, storedRows: [] });
if (missing.blockedGameIds[0] !== 31215 || !missing.errors.some((error) => error.includes("missing stored markets"))) {
  throw new Error("FAIL: missing member rows should block the game from locking");
}

const heldFirstInning = {
  ...expected[0],
  market: "first_inning",
  pick: "Toss-Up",
  side: null,
  odds_american: null,
  confidence: null,
  play_grade: null,
  best_angle: false,
  no_bet: true,
};
const safeHeldExtra = assessMlbLockCoherence({
  gameIds: [31215],
  expectedRows: expected,
  storedRows: [...expected, heldFirstInning],
});
if (safeHeldExtra.coherentGameIds[0] !== 31215 || safeHeldExtra.errors.length !== 0) {
  throw new Error("FAIL: a held first-inning Toss-Up should not block coherent ML/total rows from locking");
}

const actionableExtra = assessMlbLockCoherence({
  gameIds: [31215],
  expectedRows: expected,
  storedRows: [...expected, { ...heldFirstInning, pick: "NRFI", side: "nrfi", no_bet: false }],
});
if (actionableExtra.blockedGameIds[0] !== 31215 || !actionableExtra.errors.some((error) => error.includes("unexpected stored market"))) {
  throw new Error("FAIL: an extra actionable first-inning row must still block the lock");
}

const pendingStored = {
  ...expected[0],
  odds_american: -119,
  confidence: 51,
  play_grade: null,
  no_bet: true,
  model_probability: 0.51,
  market_probability: 0.5,
  edge: 0.01,
  published_at: "2026-08-30T15:08:15.051Z",
  snapshot_json: {
    action_promotion_stability_v1: {
      contractRelease: "daily_edge_action_promotion_stability_2026_08_29_r1",
      status: "pending",
    },
    action_promotion_candidate_v1: {
      candidate_grade: "lean",
      selected_side: "away",
      line_value: null,
      odds_american: 104,
      model_probability: 0.56,
      market_probability: 0.51,
      edge: 0.05,
      published_at: "2026-08-30T15:21:20.363Z",
      evaluation_price: {
        evaluated_book: "Saba",
        evaluated_odds: 104,
        evaluated_observed_at: "2026-08-30T15:20:00.000Z",
      },
    },
    decision_pipeline: { transition_reason: "promotion_pending_confirmation" },
  },
};
const pendingExpected = [{ ...expected[0], play_grade: "lean" }];
const pendingPromotion = assessMlbLockCoherence({ gameIds: [31215], expectedRows: pendingExpected, storedRows: [pendingStored] });
if (pendingPromotion.coherentGameIds[0] !== 31215 || pendingPromotion.errors.length !== 0) {
  throw new Error(`FAIL: an exact pending promotion should lock the retained public tuple: ${pendingPromotion.errors.join(" | ")}`);
}

const mismatchedCandidate = assessMlbLockCoherence({
  gameIds: [31215],
  expectedRows: pendingExpected,
  storedRows: [{
    ...pendingStored,
    snapshot_json: {
      ...pendingStored.snapshot_json,
      action_promotion_candidate_v1: {
        ...pendingStored.snapshot_json.action_promotion_candidate_v1,
        odds_american: 105,
      },
    },
  }],
});
if (mismatchedCandidate.blockedGameIds[0] !== 31215 || mismatchedCandidate.errors.length === 0) {
  throw new Error("FAIL: a mismatched pending candidate must remain fail-closed");
}

const changedSide = assessMlbLockCoherence({
  gameIds: [31215],
  expectedRows: pendingExpected,
  storedRows: [{ ...pendingStored, pick: "home", side: "home" }],
});
if (changedSide.blockedGameIds[0] !== 31215 || !changedSide.errors.some((error) => error.includes("moneyline.side"))) {
  throw new Error("FAIL: a pending promotion cannot excuse a changed model side");
}

console.log("  ✓ matching final model/member rows may lock");
console.log("  ✓ stale pick, price, or actionability blocks lock");
console.log("  ✓ missing member records block lock");
console.log("  ✓ held first-inning Toss-Up does not block coherent ML/total locks");
console.log("  ✓ extra actionable first-inning records remain fail-closed");
console.log("  ✓ exact pending promotions lock the retained public tuple");
console.log("  ✓ candidate or side mismatches remain fail-closed");
