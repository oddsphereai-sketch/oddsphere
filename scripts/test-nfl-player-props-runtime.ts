import assert from "node:assert/strict";
import {
  NFL_PLAYER_PROPS_BOARD_RELEASE,
  NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
  NFL_PLAYER_PROPS_DECISION_RELEASE,
  NFL_PLAYER_PROPS_MODEL_RELEASE,
  NFL_PLAYER_PROPS_MARKET_COHERENT_PROJECTION_RELEASE,
  NFL_PLAYER_PROPS_QB_ROLE_FLOORS,
  NFL_PLAYER_PROPS_RUNTIME_RELEASE,
  nflPlayerPropsExpectedValue,
  nflPlayerPropsExpectedStarterPassingProjection,
  gradeNflPlayerPropsTouchdownCandidate,
  nflPlayerPropsMarketImpliedCenter,
  nflPlayerPropsOverProbability,
  nflPlayerPropsProbabilityCoherentProjection,
  nflPlayerPropsPassingYardsWatchlistEligible,
  nflPlayerPropsResidualProbability,
  nflPlayerPropsRuntimeMarketPolicy,
  nflPlayerPropsTouchdownPolicy,
  buildNflPlayerPropsRuntimeBoard,
  nflPlayerPropsProjectionRange,
  nflPlayerPropsProductionMarketLane,
  nflPlayerPropsRawMarketDivergenceImplausible,
  nflPlayerPropsStarterAdjustedParticipationProbability,
  nflPlayerPropsTransportedMarketProbability,
  primaryNflPlayerPropsOfferKeys,
  verifyNflPlayerPropsRuntimeParity,
} from "../lib/services/football/nflPlayerPropsRuntime";
import type { NflPlayerPropsExactOffer } from "../lib/services/football/nflPlayerPropsMarketBoard";

assert.equal(NFL_PLAYER_PROPS_RUNTIME_RELEASE, "nfl_player_props_runtime_2026_09_02_r9_qb_target_exclusion");
assert.deepEqual(NFL_PLAYER_PROPS_QB_ROLE_FLOORS, { confirmedStarter: 0.9, projectedStarter: 0.75 });
verifyNflPlayerPropsRuntimeParity(1e-9);

const receiving = nflPlayerPropsRuntimeMarketPolicy("receiving_yards");
assert.deepEqual(receiving, { weight: 0.2, qualified: false }, "historical lane qualification remains truthful under the owner-approved forward exception");
assert.equal(nflPlayerPropsRuntimeMarketPolicy("receptions")?.qualified, true);
assert.equal(nflPlayerPropsRuntimeMarketPolicy("passing_yards")?.qualified, false);
assert.deepEqual(nflPlayerPropsTouchdownPolicy(), { weight: 0.2, actionable: true, requiresSharpReference: true });
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
const coherentProjection = nflPlayerPropsProbabilityCoherentProjection({
  market: "receiving_yards", line: 70.5, calibratedOverProbability: 0.55, independentProjection: 35,
});
assert.ok(coherentProjection > 55, "market-calibrated probability repairs an implausibly low independent display projection");
assert.ok(Math.abs(nflPlayerPropsOverProbability("receiving_yards", coherentProjection, 70.5) - 0.55) <= 0.02,
  "published projection inverts back to the calibrated probability within empirical resolution");
assert.equal(NFL_PLAYER_PROPS_MARKET_COHERENT_PROJECTION_RELEASE,
  "nfl_player_props_market_coherent_projection_2026_09_01_r1_probability_inverse");

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
assert.ok(twoBooks.decisions.every((row) => row.decisionRelease === NFL_PLAYER_PROPS_DECISION_RELEASE));
assert.ok(twoBooks.decisions.every((row) => !row.healthHolds.includes("independent_same_line_confirmation_missing")));
assert.ok(twoBooks.decisions.every((row) => row.modelRelease === NFL_PLAYER_PROPS_MODEL_RELEASE));
assert.ok(twoBooks.decisions.every((row) => row.calibrationRelease === NFL_PLAYER_PROPS_CALIBRATION_RELEASE));
assert.ok(twoBooks.decisions.every((row) => row.projectionEvidence?.source === "probability_inverse_market_calibrated"));
assert.ok(twoBooks.decisions.every((row) => Math.abs(
  nflPlayerPropsOverProbability(row.market, row.projection!, row.line)
    - (row.side === "over" ? row.finalProbability : 1 - row.finalProbability),
) <= 0.02), "every ordinary published projection agrees with its market-calibrated probability");
assert.ok(twoBooks.decisions.every((row) => !row.modelRelease.includes("shadow") && !row.decisionRelease.includes("provisional")));
assert.ok(twoBooks.decisions.every((row) => row.provisional === false));
const quarterbackFeature = {
  ...feature,
  playerName: "Test Quarterback",
  position: "QB",
  expectedQuarterback: { name: "Test Quarterback", starterStatus: "projected" as const, capturedAt: feature.featureAsOf },
  features: {
    ...feature.features,
    position_qb: 1,
    position_wr: 0,
    prior_passing_yards_avg3: 240,
    prior_passing_yards_avg5: 230,
    prior_passing_yards_ewm: 235,
  },
};
assert.equal(nflPlayerPropsStarterAdjustedParticipationProbability(quarterbackFeature, 0.42), 0.75, "a matching projected starter receives the bounded starter floor");
assert.equal(nflPlayerPropsStarterAdjustedParticipationProbability({
  ...quarterbackFeature,
  expectedQuarterback: { ...quarterbackFeature.expectedQuarterback, starterStatus: "confirmed" as const },
}, 0.42), 0.9, "a matching confirmed starter receives the bounded starter floor");
assert.equal(nflPlayerPropsStarterAdjustedParticipationProbability({
  ...quarterbackFeature,
  availability: { ...quarterbackFeature.availability, status: "Doubtful" },
}, 0.42), 0.42, "an unavailable starter receives no participation floor");
const passingOffer: NflPlayerPropsExactOffer = {
  ...baseOffer,
  offerKey: "qb-book-a",
  playerName: "Test Quarterback",
  market: "passing_yards",
  line: 224.5,
  overNoVigProbability: 0.5,
  underNoVigProbability: 0.5,
};
const expectedStarterProjection = nflPlayerPropsExpectedStarterPassingProjection({
  feature: quarterbackFeature,
  modeledProjection: 110,
  offers: [passingOffer, { ...passingOffer, offerKey: "qb-book-b", sportsbook: "book-b", line: 226.5 }],
  evaluatedSportsbook: "book-a",
});
assert.ok(expectedStarterProjection, "a matching expected starter receives the market-dominant passing projection");
assert.equal(expectedStarterProjection?.evidence?.source, "market_dominant_expected_starter");
if (expectedStarterProjection?.evidence.source !== "market_dominant_expected_starter") throw new Error("passing projection evidence narrowed incorrectly");
const expectedStarterEvidence = expectedStarterProjection.evidence;
assert.equal(expectedStarterEvidence.books, 1);
assert.equal(expectedStarterEvidence.roleProjection, 235);
assert.ok((expectedStarterProjection?.projection ?? 0) > 215 && (expectedStarterProjection?.projection ?? 999) < 240,
  "the repaired projection is market-realistic while retaining bounded recent-role context");
assert.equal(nflPlayerPropsExpectedStarterPassingProjection({
  feature: { ...quarterbackFeature, expectedQuarterback: { ...quarterbackFeature.expectedQuarterback, name: "Other Quarterback" } },
  modeledProjection: 110,
  offers: [passingOffer],
  evaluatedSportsbook: "book-a",
}), null, "the projection never transfers across quarterback identities");
const oneBookStarterProjection = nflPlayerPropsExpectedStarterPassingProjection({
  feature: quarterbackFeature,
  modeledProjection: 110,
  offers: [passingOffer],
  evaluatedSportsbook: "book-a",
});
assert.equal(oneBookStarterProjection?.projection, 235,
  "an evaluation-only passing market falls back to the existing independent role projection");
assert.equal(oneBookStarterProjection?.evidence, undefined,
  "an evaluation-only quote cannot describe itself as point-consensus evidence");
const evaluationOnlyPassing = buildNflPlayerPropsRuntimeBoard({
  offers: [passingOffer],
  features: [quarterbackFeature],
  evaluatedAt: "2026-08-25T12:01:00.000Z",
});
assert.ok(evaluationOnlyPassing.decisions.length === 2);
assert.ok(evaluationOnlyPassing.decisions.every((row) => row.projection === 235),
  "an evaluation-only board publishes the existing independent role projection");
assert.ok(evaluationOnlyPassing.decisions.every((row) => row.marketProbability === row.rawModelProbability),
  "an evaluation-only quote cannot validate its own passing probability");
assert.ok(evaluationOnlyPassing.decisions.every((row) => row.grade === "No Play"),
  "the existing independent-book gate remains authoritative");
const targetExcludedProjection = nflPlayerPropsExpectedStarterPassingProjection({
  feature: quarterbackFeature,
  modeledProjection: 110,
  offers: [
    { ...passingOffer, line: 150.5, overNoVigProbability: 0.9 },
    { ...passingOffer, offerKey: "qb-independent", sportsbook: "book-b", line: 226.5 },
  ],
  evaluatedSportsbook: "book-a",
});
const independentOnlyProjection = nflPlayerPropsExpectedStarterPassingProjection({
  feature: quarterbackFeature,
  modeledProjection: 110,
  offers: [{ ...passingOffer, offerKey: "qb-independent", sportsbook: "book-b", line: 226.5 }],
  evaluatedSportsbook: "book-a",
});
assert.equal(targetExcludedProjection?.projection, independentOnlyProjection?.projection,
  "changing the evaluated offer cannot change its target-excluded QB point projection");
const primaryKeys = primaryNflPlayerPropsOfferKeys([
  passingOffer,
  { ...passingOffer, offerKey: "book-a-alternate", line: 230.5 },
  { ...passingOffer, offerKey: "book-b-primary", sportsbook: "book-b", line: 226.5 },
]);
assert.deepEqual([...primaryKeys].sort(), ["book-b-primary", "qb-book-a"], "one canonical line is selected per sportsbook for passing-market inference");
const sameLine = nflPlayerPropsTransportedMarketProbability({ projection: 225, sourceLine: 224.5, sourceOverProbability: 0.55, targetLine: 224.5 });
const higherLine = nflPlayerPropsTransportedMarketProbability({ projection: 225, sourceLine: 224.5, sourceOverProbability: 0.55, targetLine: 230.5 });
assert.ok(Math.abs(sameLine - 0.55) <= 0.03, "same-line transport preserves the independent no-vig probability within empirical resolution");
assert.ok(higherLine < sameLine, "a higher target line lowers the transported Over probability");
assert.ok(Math.abs(nflPlayerPropsMarketImpliedCenter({ referenceProjection: 225, line: 225.5, overProbability: 0.5 }) - 225.5) <= 8);
assert.equal(nflPlayerPropsPassingYardsWatchlistEligible({
  market: "passing_yards", commonHolds: [], primaryTarget: true, independentMarketBooks: 1,
  divergenceImplausible: false, movement: "support", expectedValue: 0.02, probabilityEdge: 0.005,
}), true);
assert.equal(nflPlayerPropsPassingYardsWatchlistEligible({
  market: "passing_yards", commonHolds: [], primaryTarget: true, independentMarketBooks: 1,
  divergenceImplausible: false, movement: "adverse", expectedValue: 0.20, probabilityEdge: 0.10,
}), false, "adverse movement cannot use the passing-yards Watchlist bridge");
const crossLinePassing = buildNflPlayerPropsRuntimeBoard({
  offers: [
    { ...passingOffer, offerKey: "qb-target", line: 200.5, overPrice: 100, underPrice: -120 },
    { ...passingOffer, offerKey: "qb-independent", sportsbook: "book-b", line: 210.5 },
  ],
  features: [{
    ...quarterbackFeature,
    features: {
      ...quarterbackFeature.features,
      prior_passing_yards_avg3: 300,
      prior_passing_yards_avg5: 300,
      prior_passing_yards_ewm: 300,
    },
  }],
  evaluatedAt: "2026-08-25T12:01:00.000Z",
});
const targetOver = crossLinePassing.decisions.find((row) => row.sportsbook === "book-a" && row.side === "over");
assert.equal(targetOver?.grade, "Watchlist", "positive target-book economics supported by another book at a different line are visible as Watchlist");
assert.equal(targetOver?.passingMarketEvidence?.source, "target_book_excluded_cross_line_transport");
assert.equal(targetOver?.modelRelease, NFL_PLAYER_PROPS_MODEL_RELEASE);
assert.equal(targetOver?.calibrationRelease, NFL_PLAYER_PROPS_CALIBRATION_RELEASE);
assert.equal(targetOver?.decisionRelease, NFL_PLAYER_PROPS_DECISION_RELEASE);
assert.ok(crossLinePassing.decisions.every((row) => !["Lean", "Best Angle"].includes(row.grade)),
  "different-line confirmation alone cannot authorize a passing-yards action grade");
const touchdownOffer: NflPlayerPropsExactOffer = {
  ...baseOffer,
  offerKey: "td-dk",
  sportsbook: "draftkings",
  market: "anytime_td",
  offerType: "milestone",
  line: 0.5,
  overPrice: null,
  underPrice: null,
  yesPrice: 1000,
  overNoVigProbability: null,
  underNoVigProbability: null,
  openingOverPrice: null,
  openingUnderPrice: null,
  openingYesPrice: 900,
};
const retailOnlyTouchdown = buildNflPlayerPropsRuntimeBoard({
  offers: [touchdownOffer, { ...touchdownOffer, offerKey: "td-fd", sportsbook: "fanduel", yesPrice: 900 }],
  features: [feature], evaluatedAt: "2026-08-25T12:01:00.000Z",
});
assert.ok(retailOnlyTouchdown.decisions.every((row) => !["Lean", "Best Angle"].includes(row.grade)),
  "two retail touchdown prices cannot impersonate a sharp reference or authorize an action");
assert.equal(gradeNflPlayerPropsTouchdownCandidate({
  commonHolds: [], independentBooks: 2, sharpReferenceBooks: 1, americanPrice: 425,
  expectedValue: 0.13, probabilityEdge: 0.04, participationProbability: 0.9,
}), "Best Angle", "a real sharp-reference touchdown quote can unlock the existing value ladder when all gates pass");
assert.equal(gradeNflPlayerPropsTouchdownCandidate({
  commonHolds: [], independentBooks: 2, sharpReferenceBooks: 0, americanPrice: 425,
  expectedValue: 0.13, probabilityEdge: 0.04, participationProbability: 0.9,
}), "Watchlist", "the same touchdown economics stay nonactionable when every observed book is retail");
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
