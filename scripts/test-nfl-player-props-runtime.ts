import assert from "node:assert/strict";
import {
  NFL_PLAYER_PROPS_BOARD_RELEASE,
  NFL_PLAYER_PROPS_RUNTIME_RELEASE,
  nflPlayerPropsExpectedValue,
  nflPlayerPropsOverProbability,
  nflPlayerPropsResidualProbability,
  nflPlayerPropsRuntimeMarketPolicy,
  nflPlayerPropsTouchdownPolicy,
  buildNflPlayerPropsRuntimeBoard,
  nflPlayerPropsProjectionRange,
  nflPlayerPropsProductionMarketLane,
  nflPlayerPropsRawMarketDivergenceImplausible,
  verifyNflPlayerPropsRuntimeParity,
} from "../lib/services/football/nflPlayerPropsRuntime";
import type { NflPlayerPropsExactOffer } from "../lib/services/football/nflPlayerPropsMarketBoard";

assert.equal(NFL_PLAYER_PROPS_RUNTIME_RELEASE, "nfl_player_props_runtime_2026_09_01_r6_cross_market_movement");
verifyNflPlayerPropsRuntimeParity(1e-9);

const receiving = nflPlayerPropsRuntimeMarketPolicy("receiving_yards");
assert.deepEqual(receiving, { weight: 0.2, qualified: false }, "historical lane qualification remains truthful under the owner-approved forward exception");
assert.equal(nflPlayerPropsRuntimeMarketPolicy("receptions")?.qualified, true);
assert.equal(nflPlayerPropsRuntimeMarketPolicy("passing_yards")?.qualified, false);
assert.deepEqual(nflPlayerPropsTouchdownPolicy(), { weight: 0.2, actionable: false });
assert.equal(nflPlayerPropsProductionMarketLane("receiving_yards")?.lean, true);
assert.equal(nflPlayerPropsProductionMarketLane("receptions")?.lean, true);
assert.deepEqual(nflPlayerPropsProductionMarketLane("passing_yards")?.eligibleSides, ["over", "under"]);
assert.equal(nflPlayerPropsRawMarketDivergenceImplausible(0.98, 0.50), false, "the frozen p99 boundary itself remains eligible");
assert.equal(nflPlayerPropsRawMarketDivergenceImplausible(0.981, 0.50), true, "only grossly implausible divergence is rejected");

const over = nflPlayerPropsOverProbability("receiving_yards", 75, 70.5);
assert.ok(over > 0 && over < 1);
const range = nflPlayerPropsProjectionRange("receiving_yards", 75);
assert.ok(range.lower < 75 && range.upper > 75);
assert.equal(range.centralCoverage, 0.8);
assert.throws(() => nflPlayerPropsOverProbability("touchdowns", 1, 0.5), /unsupported/);

const residual = nflPlayerPropsResidualProbability(0.7, 0.5, 0.2);
assert.ok(residual > 0.5 && residual < 0.7);
assert.ok(nflPlayerPropsExpectedValue(0.55, -110) > 0);
assert.ok(nflPlayerPropsExpectedValue(0.45, -110) < 0);

const baseOffer: NflPlayerPropsExactOffer = {
  release: "nfl_player_props_exact_market_board_2026_09_01_r2_cross_line_opening", offerKey: "test", canonicalGameId: "game",
  provider: "balldontlie", providerEventId: "game", providerPlayerId: "player", playerName: "Test Player", playerTeam: "NE",
  sportsbook: "book-a", market: "receptions", offerType: "over_under", line: 4.5,
  overPrice: -110, underPrice: -110, yesPrice: null, overNoVigProbability: 0.5, underNoVigProbability: 0.5,
  observedAt: "2026-08-25T12:00:00.000Z", fetchedAt: "2026-08-25T12:00:01.000Z", openingObservedAt: "2026-08-25T08:00:00.000Z",
  openingLine: 4.5, openingOverPrice: -115, openingUnderPrice: -105, openingYesPrice: null, scheduledStart: "2026-09-01T00:00:00.000Z",
  lockAt: "2026-08-31T23:00:00.000Z", state: "unlocked", exactPriceComplete: true, gradeEligibleMarket: true, healthHolds: [],
};
const feature = {
  gameId: "game", playerName: "Test Player", team: "NE", opponent: "NYJ", position: "WR", featureAsOf: "2026-08-25T12:00:00.000Z",
  roleFingerprint: "role", scoreEligible: true, healthHolds: [], teamImpliedPoints: 21, teamImpliedTouchdowns: 3,
  expectedQuarterback: { name: "Test Quarterback", starterStatus: "projected" as const, capturedAt: "2026-08-25T12:00:00.000Z" },
  availability: { listed: false, status: null, detail: null, reportedAt: null, reportUpdatedAt: "2026-08-25T10:00:00.000Z", source: "BALLDONTLIE" as const },
  features: {
    is_home: 1, position_wr: 1, team_implied_touchdowns: 3,
    prior_receptions_lag1: 6, prior_receptions_avg3: 5.3, prior_receptions_avg5: 4.8, prior_receptions_ewm: 5.1,
    prior_targets_lag1: 9, prior_targets_avg3: 8.0, prior_targets_avg5: 7.6, prior_targets_ewm: 7.4,
    prior_target_share_lag1: 0.25, prior_target_share_avg3: 0.23, prior_target_share_avg5: 0.21, prior_target_share_ewm: 0.22,
    prior_offense_snap_pct_lag1: 0.81, prior_offense_snap_pct_avg3: 0.79, prior_offense_snap_pct_avg5: 0.76, prior_offense_snap_pct_ewm: 0.78,
    prior_opponent_allowed_targets_avg3: 30.8, prior_opponent_allowed_targets_avg5: 30.5, prior_opponent_allowed_targets_ewm: 31.2,
  },
};
const oneBook = buildNflPlayerPropsRuntimeBoard({ offers: [baseOffer], features: [feature], evaluatedAt: "2026-08-25T12:01:00.000Z" });
assert.equal(oneBook.decisions.length, 2, "complete one-book outcomes remain visible as evaluated reads");
assert.equal(oneBook.counts["No Play"], 2, "one-book outcomes cannot become actionable without independent same-line confirmation");
assert.equal(oneBook.counts.Held, 0, "missing market confirmation is not a role hold");
assert.equal(oneBook.diagnostics.completedEvaluations, 2);
assert.ok(oneBook.decisions.every((row) => row.healthHolds.includes("independent_same_line_confirmation_missing")));
assert.equal(oneBook.diagnostics.unavailableNoIndependentBenchmark, 2);
const twoBooks = buildNflPlayerPropsRuntimeBoard({ offers: [baseOffer, { ...baseOffer, offerKey: "test-b", sportsbook: "book-b" }], features: [feature], evaluatedAt: "2026-08-25T12:01:00.000Z" });
assert.equal(twoBooks.release, NFL_PLAYER_PROPS_BOARD_RELEASE);
assert.equal(twoBooks.counts.Held, 0, "a second exact-line book supplies the independent benchmark");
assert.equal(twoBooks.decisions.length, 2, "best target price is deduplicated by executable outcome");
assert.ok(twoBooks.decisions.every((row) => row.opponent === "NYJ" && row.scheduledStart === baseOffer.scheduledStart));
assert.ok(twoBooks.decisions.every((row) => row.bookEvidence.length === 2), "winning outcomes retain all competing exact-book evidence");
assert.deepEqual(twoBooks.decisions[0]?.bookEvidence.map((row) => row.sportsbook), ["book-a", "book-b"]);
assert.equal(twoBooks.decisions.find((row) => row.side === "over")?.bookEvidence[0]?.openingAmericanPrice, -115, "same-book opening evidence survives best-price selection");
assert.equal(twoBooks.decisions.find((row) => row.side === "over")?.bookEvidence[0]?.openingLine, 4.5, "cross-line opening context survives best-price selection");
assert.ok(twoBooks.decisions.every((row) => row.projectionRange?.centralCoverage === 0.8), "volume decisions retain empirical forecast uncertainty");
assert.ok(twoBooks.decisions.every((row) => row.forecastContext.expectedQuarterback?.name === "Test Quarterback"));
assert.equal(twoBooks.decisions[0]?.forecastContext.recentProduction?.label, "Recent receptions");
assert.deepEqual(twoBooks.decisions[0]?.forecastContext.roleOpportunity.map((item) => item.label), ["Recent targets", "Target share", "Offensive snap share"]);
assert.equal(twoBooks.decisions[0]?.forecastContext.opponentAllowance?.value, 31.2);
assert.deepEqual(twoBooks.decisions[0]?.forecastContext.modelInputTrends?.find((trend) => trend.label === "Recent receptions")?.points, [
  { window: "last_game", value: 6, modelInput: true },
  { window: "last_3_average", value: 5.3, modelInput: true },
  { window: "last_5_average", value: 4.8, modelInput: true },
  { window: "model_weighted", value: 5.1, modelInput: true },
], "the member context exposes the exact timestamped trend inputs without changing the score");
const noOpening = buildNflPlayerPropsRuntimeBoard({
  offers: [baseOffer, { ...baseOffer, offerKey: "test-b", sportsbook: "book-b" }].map((offer) => ({
    ...offer, openingObservedAt: null, openingLine: null, openingOverPrice: null, openingUnderPrice: null, openingYesPrice: null,
  })),
  features: [feature], evaluatedAt: "2026-08-25T12:01:00.000Z",
});
assert.deepEqual(
  twoBooks.decisions.map(withoutBookEvidence),
  noOpening.decisions.map(withoutBookEvidence),
  "opening presentation evidence changes zero decisions, probabilities, projections, or grades",
);
assert.ok(twoBooks.decisions.every((row) => row.decisionRelease === "nfl_player_props_decision_2026_09_01_r6_cross_market_movement"), "tracking provenance uses the current production cross-market decision release");
assert.ok(twoBooks.decisions.every((row) => !row.healthHolds.includes("independent_same_line_confirmation_missing")));
assert.ok(twoBooks.decisions.every((row) => row.modelRelease === "nfl_player_props_distribution_model_2026_09_01_r3_active_role"));
assert.ok(twoBooks.decisions.every((row) => row.calibrationRelease === "nfl_player_props_distribution_calibration_2026_09_01_r3_active_role"));
assert.ok(twoBooks.decisions.every((row) => !row.modelRelease.includes("shadow") && !row.decisionRelease.includes("provisional")));
assert.ok(twoBooks.decisions.every((row) => row.provisional === false));
const roleHeld = buildNflPlayerPropsRuntimeBoard({ offers: [baseOffer, { ...baseOffer, offerKey: "test-b", sportsbook: "book-b" }], features: [{ ...feature, healthHolds: ["role_ambiguous"] }], evaluatedAt: "2026-08-25T12:01:00.000Z" });
assert.equal(roleHeld.counts.Held, 2, "genuine role ambiguity remains a Held decision");
assert.equal(roleHeld.diagnostics.roleOrIdentityHeld, 2);
assert.equal(roleHeld.diagnostics.completedEvaluations, 0, "operational exceptions do not count as completed evaluations");
assert.equal(roleHeld.diagnostics.operationalExceptions, 2);
assert.equal(roleHeld.diagnostics.recoveryEligibleOperationalExceptions, 2, "unlocked identity/role exceptions remain eligible for a coherent later evaluation");
const stale = buildNflPlayerPropsRuntimeBoard({ offers: [baseOffer, { ...baseOffer, offerKey: "test-b", sportsbook: "book-b" }], features: [feature], evaluatedAt: "2026-08-26T12:01:00.000Z" });
assert.equal(stale.decisions.length, 0, "stale outcomes are excluded from the graded board");
assert.equal(stale.diagnostics.unavailableStaleQuotes, 2);
const divergent = buildNflPlayerPropsRuntimeBoard({
  offers: [baseOffer, { ...baseOffer, offerKey: "test-b", sportsbook: "book-b" }].map((offer) => ({
    ...offer,
    line: 100,
    overNoVigProbability: 0.999,
    underNoVigProbability: 0.001,
  })),
  features: [feature],
  evaluatedAt: "2026-08-25T12:01:00.000Z",
});
assert.ok(divergent.decisions.length > 0);
assert.ok(divergent.decisions.every((row) => row.grade === "No Play"), "gross model/market disagreement cannot become actionable");
assert.ok(divergent.decisions.every((row) => row.healthHolds.includes("model_market_divergence_implausible")));
assert.equal(divergent.counts.Held, 0, "gross divergence remains a completed No Play prediction rather than suppressing the row");

function withoutBookEvidence<T extends { bookEvidence: unknown }>(row: T): Omit<T, "bookEvidence"> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "bookEvidence")) as Omit<T, "bookEvidence">;
}

console.log("NFL player-props portable runtime parity and decision primitives passed.");
