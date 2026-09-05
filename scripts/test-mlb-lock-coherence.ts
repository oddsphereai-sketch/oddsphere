import assert from "node:assert/strict";
import {
  canonicalActionPromotionIdentity,
  expectedValueAtAmericanOdds,
} from "../lib/services/dailyEdge/actionPromotionStability";
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

const forecastRelease = "mlb_moneyline_coherent_probability_test";
const failedEconomicsExpected = {
  ...expected[0],
  line_value: null as number | null,
  play_grade: "best_angle",
  best_angle: true,
  no_bet: false,
  snapshot_json: {
    ml_evaluation_price: {
      evaluated_book: null as string | null,
      evaluated_odds: 104,
      evaluated_observed_at: null as string | null,
    },
    model_layer_versions: {
      active_probability_head: forecastRelease,
    },
    decision_pipeline: {
      final_side: "away",
      original_side: "away",
      action_rule_id: "test_best_angle_rule",
      grade_source: "additive_rule",
    },
  },
};
const failedEconomicsExpectedValue = expectedValueAtAmericanOdds(
  failedEconomicsExpected.model_probability,
  failedEconomicsExpected.odds_american,
);
const failedEconomicsStored = {
  ...failedEconomicsExpected,
  play_grade: null as string | null,
  best_angle: false,
  no_bet: true,
  snapshot_json: {
    ...failedEconomicsExpected.snapshot_json,
    action_promotion_stability_v1: {
      contractRelease: "daily_edge_action_promotion_stability_2026_08_29_r1",
      canonicalIdentity: canonicalActionPromotionIdentity({
        sport: "mlb",
        gameId: failedEconomicsExpected.game_id,
        market: "moneyline",
        selectedSide: failedEconomicsExpected.side,
        evaluatedLine: failedEconomicsExpected.line_value,
        forecastRelease,
      }),
      candidateGrade: "best_angle",
      qualifyingCycleIds: [],
      firstQualifiedAt: null,
      lastQualifiedAt: null,
      status: "failed_economics",
      exactPriceExpectedValue: failedEconomicsExpectedValue,
      minimumExpectedValue: null,
    },
    action_promotion_candidate_v1: null as Record<string, unknown> | null,
    decision_pipeline: {
      ...failedEconomicsExpected.snapshot_json.decision_pipeline,
      board_action: "no_play",
      actionable_grade: null,
      transition_candidate_grade: "best_angle",
      transition_final_grade: "no_play",
      transition_reason: "incoherent_exact_price",
    },
  },
};

function expectFailedEconomicsBlocked(
  label: string,
  storedRow: typeof failedEconomicsStored,
): void {
  const result = assessMlbLockCoherence({
    gameIds: [31215],
    expectedRows: [failedEconomicsExpected],
    storedRows: [storedRow],
  });
  assert.deepEqual(result.coherentGameIds, [], `${label}: must not pass`);
  assert.deepEqual(result.blockedGameIds, [31215], `${label}: must fail closed`);
  assert.ok(result.errors.length > 0, `${label}: must report the mismatch`);
}

const exactFailedEconomics = assessMlbLockCoherence({
  gameIds: [31215],
  expectedRows: [failedEconomicsExpected],
  storedRows: [failedEconomicsStored],
});
assert.deepEqual(exactFailedEconomics.coherentGameIds, [31215]);
assert.deepEqual(exactFailedEconomics.errors, []);

expectFailedEconomicsBlocked("different side", {
  ...failedEconomicsStored,
  pick: "home",
  side: "home",
});
expectFailedEconomicsBlocked("different price", {
  ...failedEconomicsStored,
  odds_american: 105,
});
expectFailedEconomicsBlocked("different evaluated book", {
  ...failedEconomicsStored,
  snapshot_json: {
    ...failedEconomicsStored.snapshot_json,
    ml_evaluation_price: {
      ...failedEconomicsStored.snapshot_json.ml_evaluation_price,
      evaluated_book: "Saba",
    },
  },
});
expectFailedEconomicsBlocked("different evaluated time", {
  ...failedEconomicsStored,
  snapshot_json: {
    ...failedEconomicsStored.snapshot_json,
    ml_evaluation_price: {
      ...failedEconomicsStored.snapshot_json.ml_evaluation_price,
      evaluated_observed_at: "2026-08-30T15:20:00.000Z",
    },
  },
});
expectFailedEconomicsBlocked("different evaluated odds", {
  ...failedEconomicsStored,
  snapshot_json: {
    ...failedEconomicsStored.snapshot_json,
    ml_evaluation_price: {
      ...failedEconomicsStored.snapshot_json.ml_evaluation_price,
      evaluated_odds: 105,
    },
  },
});
expectFailedEconomicsBlocked("different status", {
  ...failedEconomicsStored,
  snapshot_json: {
    ...failedEconomicsStored.snapshot_json,
    action_promotion_stability_v1: {
      ...failedEconomicsStored.snapshot_json.action_promotion_stability_v1,
      status: "pending",
    },
  },
});
expectFailedEconomicsBlocked("different reason", {
  ...failedEconomicsStored,
  snapshot_json: {
    ...failedEconomicsStored.snapshot_json,
    decision_pipeline: {
      ...failedEconomicsStored.snapshot_json.decision_pipeline,
      transition_reason: "promotion_pending_confirmation",
    },
  },
});
expectFailedEconomicsBlocked("different candidate grade", {
  ...failedEconomicsStored,
  snapshot_json: {
    ...failedEconomicsStored.snapshot_json,
    action_promotion_stability_v1: {
      ...failedEconomicsStored.snapshot_json.action_promotion_stability_v1,
      candidateGrade: "lean",
    },
  },
});
expectFailedEconomicsBlocked("nonterminal candidate payload", {
  ...failedEconomicsStored,
  snapshot_json: {
    ...failedEconomicsStored.snapshot_json,
    action_promotion_candidate_v1: {
      candidate_grade: "best_angle",
    },
  },
});
expectFailedEconomicsBlocked("non-No-Play", {
  ...failedEconomicsStored,
  play_grade: "lean",
  no_bet: false,
});

const thresholdExpected = {
  ...failedEconomicsExpected,
  odds_american: -110,
  snapshot_json: {
    ...failedEconomicsExpected.snapshot_json,
    ml_evaluation_price: {
      evaluated_book: "Saba",
      evaluated_odds: -110,
      evaluated_observed_at: "2026-08-30T15:20:00.000Z",
    },
  },
};
const thresholdExpectedValue = expectedValueAtAmericanOdds(
  thresholdExpected.model_probability,
  thresholdExpected.odds_american,
);
const thresholdStored = {
  ...failedEconomicsStored,
  odds_american: -110,
  snapshot_json: {
    ...failedEconomicsStored.snapshot_json,
    ml_evaluation_price: thresholdExpected.snapshot_json.ml_evaluation_price,
    action_promotion_stability_v1: {
      ...failedEconomicsStored.snapshot_json.action_promotion_stability_v1,
      exactPriceExpectedValue: thresholdExpectedValue,
      minimumExpectedValue: 0.08,
    },
    decision_pipeline: {
      ...failedEconomicsStored.snapshot_json.decision_pipeline,
      transition_reason: "exact_price_economics_failed",
    },
  },
};
const exactThresholdFailure = assessMlbLockCoherence({
  gameIds: [31215],
  expectedRows: [thresholdExpected],
  storedRows: [thresholdStored],
});
assert.deepEqual(exactThresholdFailure.coherentGameIds, [31215]);
assert.deepEqual(exactThresholdFailure.errors, []);

expectFailedEconomicsBlocked("different canonical identity", {
  ...failedEconomicsStored,
  snapshot_json: {
    ...failedEconomicsStored.snapshot_json,
    action_promotion_stability_v1: {
      ...failedEconomicsStored.snapshot_json.action_promotion_stability_v1,
      canonicalIdentity: "mlb::wrong",
    },
  },
});
expectFailedEconomicsBlocked("different forecast release", {
  ...failedEconomicsStored,
  snapshot_json: {
    ...failedEconomicsStored.snapshot_json,
    model_layer_versions: {
      ...failedEconomicsStored.snapshot_json.model_layer_versions,
      active_probability_head: "different_probability_release",
    },
  },
});
expectFailedEconomicsBlocked("different exact-price EV", {
  ...failedEconomicsStored,
  snapshot_json: {
    ...failedEconomicsStored.snapshot_json,
    action_promotion_stability_v1: {
      ...failedEconomicsStored.snapshot_json.action_promotion_stability_v1,
      exactPriceExpectedValue: (failedEconomicsExpectedValue ?? 0) + 0.01,
    },
  },
});
expectFailedEconomicsBlocked("different probability", {
  ...failedEconomicsStored,
  model_probability: 0.57,
});
expectFailedEconomicsBlocked("different market probability", {
  ...failedEconomicsStored,
  market_probability: 0.52,
});
expectFailedEconomicsBlocked("different line", {
  ...failedEconomicsStored,
  line_value: 0,
});
expectFailedEconomicsBlocked("different confidence", {
  ...failedEconomicsStored,
  confidence: 55,
});
expectFailedEconomicsBlocked("different edge", {
  ...failedEconomicsStored,
  edge: 0.04,
});
const regeneratedTimestamp = assessMlbLockCoherence({
  gameIds: [31215],
  expectedRows: [failedEconomicsExpected],
  storedRows: [{
  ...failedEconomicsStored,
  published_at: "2026-08-30T15:22:20.363Z",
  }],
});
assert.deepEqual(
  regeneratedTimestamp.coherentGameIds,
  [31215],
  "the second dry-run writer invocation must not block the first finalized row solely because it generated a later published_at",
);

const pendingRegeneratedTimestamp = assessMlbLockCoherence({
  gameIds: [31215],
  expectedRows: [{ ...pendingExpected[0], published_at: "2026-08-30T15:22:20.363Z" }],
  storedRows: [pendingStored],
});
assert.deepEqual(
  pendingRegeneratedTimestamp.coherentGameIds,
  [31215],
  "a pending promotion candidate remains coherent across two otherwise identical writer invocations",
);
expectFailedEconomicsBlocked("different action rule", {
  ...failedEconomicsStored,
  snapshot_json: {
    ...failedEconomicsStored.snapshot_json,
    decision_pipeline: {
      ...failedEconomicsStored.snapshot_json.decision_pipeline,
      action_rule_id: "different_rule",
    },
  },
});

console.log("  ✓ matching final model/member rows may lock");
console.log("  ✓ stale pick, price, or actionability blocks lock");
console.log("  ✓ missing member records block lock");
console.log("  ✓ held first-inning Toss-Up does not block coherent ML/total locks");
console.log("  ✓ extra actionable first-inning records remain fail-closed");
console.log("  ✓ exact pending promotions lock the retained public tuple");
console.log("  ✓ candidate or side mismatches remain fail-closed");
console.log("  ✓ exact failed-economics No Play tuples may lock");
console.log("  ✓ failed-economics side/price/book/time/status/reason/grade mismatches fail closed");
