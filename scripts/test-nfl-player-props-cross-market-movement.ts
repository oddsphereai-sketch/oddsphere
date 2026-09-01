import assert from "node:assert/strict";
import {
  gradeNflPlayerPropsCrossMarketCandidate,
  NFL_PLAYER_PROPS_MATERIAL_PRICE_MOVEMENT_PP,
  nflPlayerPropsSameBookMovement,
} from "../lib/services/football/nflPlayerPropsRuntime";
import type { NflPlayerPropsExactOffer } from "../lib/services/football/nflPlayerPropsMarketBoard";

const offer: NflPlayerPropsExactOffer = {
  release: "nfl_player_props_exact_market_board_2026_09_01_r2_cross_line_opening",
  offerKey: "movement",
  canonicalGameId: "game",
  provider: "balldontlie",
  providerEventId: "game",
  providerPlayerId: "player",
  playerName: "Player",
  playerTeam: "SEA",
  sportsbook: "fanduel",
  market: "receiving_yards",
  offerType: "over_under",
  line: 61.5,
  overPrice: -110,
  underPrice: -110,
  yesPrice: null,
  overNoVigProbability: 0.5,
  underNoVigProbability: 0.5,
  observedAt: "2026-09-01T12:00:00.000Z",
  fetchedAt: "2026-09-01T12:00:01.000Z",
  openingObservedAt: "2026-08-25T12:00:00.000Z",
  openingLine: 60.5,
  openingOverPrice: -110,
  openingUnderPrice: -110,
  openingYesPrice: null,
  scheduledStart: "2026-09-10T00:20:00.000Z",
  lockAt: "2026-09-09T23:20:00.000Z",
  state: "unlocked",
  exactPriceComplete: true,
  gradeEligibleMarket: true,
  healthHolds: [],
};

assert.equal(NFL_PLAYER_PROPS_MATERIAL_PRICE_MOVEMENT_PP, 0.025);
assert.equal(nflPlayerPropsSameBookMovement(offer, "over"), "support");
assert.equal(nflPlayerPropsSameBookMovement(offer, "under"), "adverse");
assert.equal(nflPlayerPropsSameBookMovement({ ...offer, openingLine: offer.line, openingOverPrice: -100 }, "over"), "neutral");
assert.equal(nflPlayerPropsSameBookMovement({ ...offer, openingLine: offer.line, openingOverPrice: 110 }, "over"), "support");
assert.equal(nflPlayerPropsSameBookMovement({ ...offer, openingLine: offer.line, openingOverPrice: -135, overPrice: -105 }, "over"), "adverse");
assert.equal(nflPlayerPropsSameBookMovement({ ...offer, openingLine: null, openingObservedAt: null }, "over"), "neutral");

const standardLean = {
  minimumEv: 0.04,
  minimumProbabilityEdge: 0.02,
  minimumParticipationProbability: 0.70,
  minimumIndependentBooks: 1,
};
const standardBest = {
  minimumEv: 0.08,
  minimumProbabilityEdge: 0.035,
  minimumParticipationProbability: 0.85,
  minimumIndependentBooks: 1,
};
const markets = [
  "passing_attempts",
  "passing_completions",
  "passing_yards",
  "rushing_attempts",
  "rushing_yards",
  "receptions",
  "receiving_yards",
] as const;
for (const market of markets) {
  for (const side of ["over", "under"] as const) {
    const grade = gradeNflPlayerPropsCrossMarketCandidate({
      commonHolds: [],
      independentBooks: 1,
      divergenceImplausible: false,
      eligibleSide: true,
      marketResidualQualified: true,
      bestAngleEnabled: true,
      leanEnabled: true,
      watchlistEnabled: true,
      expectedValue: 0.05,
      probabilityEdge: 0.025,
      participationProbability: 0.80,
      movement: "neutral",
      leanThresholds: standardLean,
      bestAngleThresholds: standardBest,
    });
    assert.equal(grade, "Lean", `${market} ${side} can qualify through the shared exact-economics ladder`);
  }
}

const supportedLean = gradeNflPlayerPropsCrossMarketCandidate({
  commonHolds: [], independentBooks: 1, divergenceImplausible: false, eligibleSide: true,
  marketResidualQualified: true, bestAngleEnabled: true, leanEnabled: true, watchlistEnabled: true,
  expectedValue: 0.031, probabilityEdge: 0.016, participationProbability: 0.75, movement: "support",
  leanThresholds: { ...standardLean, minimumEv: 0.03, minimumProbabilityEdge: 0.015 },
  bestAngleThresholds: { ...standardBest, minimumEv: 0.07, minimumProbabilityEdge: 0.03 },
});
assert.equal(supportedLean, "Lean", "material same-book support uses the bounded lower Lean threshold");

const adverseCap = gradeNflPlayerPropsCrossMarketCandidate({
  commonHolds: [], independentBooks: 1, divergenceImplausible: false, eligibleSide: true,
  marketResidualQualified: true, bestAngleEnabled: true, leanEnabled: true, watchlistEnabled: true,
  expectedValue: 0.12, probabilityEdge: 0.06, participationProbability: 0.92, movement: "adverse",
  leanThresholds: standardLean, bestAngleThresholds: standardBest,
});
assert.equal(adverseCap, "Watchlist", "material adverse same-book movement caps rather than erases a positive signal");

const missingIndependent = gradeNflPlayerPropsCrossMarketCandidate({
  commonHolds: [], independentBooks: 0, divergenceImplausible: false, eligibleSide: true,
  marketResidualQualified: true, bestAngleEnabled: true, leanEnabled: true, watchlistEnabled: true,
  expectedValue: 0.20, probabilityEdge: 0.10, participationProbability: 0.95, movement: "support",
  leanThresholds: standardLean, bestAngleThresholds: standardBest,
});
assert.equal(missingIndependent, "No Play");

const roleHold = gradeNflPlayerPropsCrossMarketCandidate({
  commonHolds: ["role_ambiguous"], independentBooks: 2, divergenceImplausible: false, eligibleSide: true,
  marketResidualQualified: true, bestAngleEnabled: true, leanEnabled: true, watchlistEnabled: true,
  expectedValue: 0.20, probabilityEdge: 0.10, participationProbability: 0.95, movement: "support",
  leanThresholds: standardLean, bestAngleThresholds: standardBest,
});
assert.equal(roleHold, "Held");

console.log("NFL props cross-market movement: seven markets, both sides, exact economics, adverse cap, and safety gates passed.");
