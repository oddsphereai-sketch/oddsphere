import assert from "node:assert/strict";
import {
  NFL_PLAYER_PROPS_RUNTIME_RELEASE,
  nflPlayerPropsExpectedValue,
  nflPlayerPropsOverProbability,
  nflPlayerPropsResidualProbability,
  nflPlayerPropsRuntimeMarketPolicy,
  nflPlayerPropsTouchdownPolicy,
  buildNflPlayerPropsRuntimeBoard,
  verifyNflPlayerPropsRuntimeParity,
} from "../lib/services/football/nflPlayerPropsRuntime";
import type { NflPlayerPropsExactOffer } from "../lib/services/football/nflPlayerPropsMarketBoard";

assert.equal(NFL_PLAYER_PROPS_RUNTIME_RELEASE, "nfl_player_props_runtime_2026_08_25_r2_shared_context");
verifyNflPlayerPropsRuntimeParity(1e-9);

const receiving = nflPlayerPropsRuntimeMarketPolicy("receiving_yards");
assert.deepEqual(receiving, { weight: 0.2, qualified: true });
assert.equal(nflPlayerPropsRuntimeMarketPolicy("passing_yards")?.qualified, false);
assert.deepEqual(nflPlayerPropsTouchdownPolicy(), { weight: 0.2, actionable: false });

const over = nflPlayerPropsOverProbability("receiving_yards", 75, 70.5);
assert.ok(over > 0 && over < 1);
assert.throws(() => nflPlayerPropsOverProbability("touchdowns", 1, 0.5), /unsupported/);

const residual = nflPlayerPropsResidualProbability(0.7, 0.5, 0.2);
assert.ok(residual > 0.5 && residual < 0.7);
assert.ok(nflPlayerPropsExpectedValue(0.55, -110) > 0);
assert.ok(nflPlayerPropsExpectedValue(0.45, -110) < 0);

const baseOffer: NflPlayerPropsExactOffer = {
  release: "nfl_player_props_exact_market_board_2026_08_25_r1", offerKey: "test", canonicalGameId: "game",
  provider: "balldontlie", providerEventId: "game", providerPlayerId: "player", playerName: "Test Player", playerTeam: "NE",
  sportsbook: "book-a", market: "receptions", offerType: "over_under", line: 4.5,
  overPrice: -110, underPrice: -110, yesPrice: null, overNoVigProbability: 0.5, underNoVigProbability: 0.5,
  observedAt: "2026-08-25T12:00:00.000Z", fetchedAt: "2026-08-25T12:00:01.000Z", openingObservedAt: null,
  openingOverPrice: null, openingUnderPrice: null, openingYesPrice: null, scheduledStart: "2026-09-01T00:00:00.000Z",
  lockAt: "2026-08-31T23:00:00.000Z", state: "unlocked", exactPriceComplete: true, gradeEligibleMarket: true, healthHolds: [],
};
const feature = {
  gameId: "game", playerName: "Test Player", team: "NE", opponent: "NYJ", position: "WR", featureAsOf: "2026-08-25T12:00:00.000Z",
  roleFingerprint: "role", scoreEligible: true, healthHolds: [], teamImpliedPoints: 21, teamImpliedTouchdowns: 3,
  features: { is_home: 1, position_wr: 1, team_implied_touchdowns: 3 },
};
const oneBook = buildNflPlayerPropsRuntimeBoard({ offers: [baseOffer], features: [feature], evaluatedAt: "2026-08-25T12:01:00.000Z" });
assert.equal(oneBook.decisions.length, 0, "one-book outcomes are unavailable, not graded");
assert.equal(oneBook.counts.Held, 0, "market-data availability is not a role hold");
assert.equal(oneBook.diagnostics.unavailableNoIndependentBenchmark, 2);
const twoBooks = buildNflPlayerPropsRuntimeBoard({ offers: [baseOffer, { ...baseOffer, offerKey: "test-b", sportsbook: "book-b" }], features: [feature], evaluatedAt: "2026-08-25T12:01:00.000Z" });
assert.equal(twoBooks.counts.Held, 0, "a second exact-line book supplies the independent benchmark");
assert.equal(twoBooks.decisions.length, 2, "best target price is deduplicated by executable outcome");
assert.ok(twoBooks.decisions.every((row) => row.decisionRelease === "nfl_player_props_decision_2026_08_25_r2_exact_price_shared_context"), "tracking provenance uses the production exact-price lane release, not the residual calibration release");
assert.ok(twoBooks.decisions.every((row) => row.modelRelease === "nfl_player_props_distribution_model_2026_08_25_r2_shared_context"));
assert.ok(twoBooks.decisions.every((row) => row.calibrationRelease === "nfl_player_props_distribution_calibration_2026_08_25_r2_shared_context"));
assert.ok(twoBooks.decisions.every((row) => !row.modelRelease.includes("shadow") && !row.decisionRelease.includes("provisional")));
assert.ok(twoBooks.decisions.every((row) => row.provisional === false));
const roleHeld = buildNflPlayerPropsRuntimeBoard({ offers: [baseOffer, { ...baseOffer, offerKey: "test-b", sportsbook: "book-b" }], features: [{ ...feature, healthHolds: ["role_ambiguous"] }], evaluatedAt: "2026-08-25T12:01:00.000Z" });
assert.equal(roleHeld.counts.Held, 2, "genuine role ambiguity remains a Held decision");
assert.equal(roleHeld.diagnostics.roleOrIdentityHeld, 2);
const stale = buildNflPlayerPropsRuntimeBoard({ offers: [baseOffer, { ...baseOffer, offerKey: "test-b", sportsbook: "book-b" }], features: [feature], evaluatedAt: "2026-08-26T12:01:00.000Z" });
assert.equal(stale.decisions.length, 0, "stale outcomes are excluded from the graded board");
assert.equal(stale.diagnostics.unavailableStaleQuotes, 2);

console.log("NFL player-props portable runtime parity and decision primitives passed.");
