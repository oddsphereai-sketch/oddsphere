import assert from "node:assert/strict";
import {
  FOOTBALL_CROSS_MARKET_COHERENCE_RELEASE,
  auditFootballCrossMarketCoherence,
  constrainHomeCoverProbability,
  type FootballCoherenceDecision,
  type FootballCoherenceForecast,
} from "../lib/services/football/footballCrossMarketCoherence";

const forecast: FootballCoherenceForecast = {
  expectedAwayPoints: 20.4,
  expectedHomePoints: 21.2,
  representativeScore: { away: 20, home: 24 },
  awayWinProbability: 0.4,
  homeWinProbability: 0.6,
  pmf: [
    { away: 20, home: 24, probability: 0.6 },
    { away: 21, home: 17, probability: 0.4 },
  ],
};

assert.equal(constrainHomeCoverProbability({ homeWinProbability: 0.38, homeCoverProbability: 0.49, homeSpread: -3.5 }), 0.38);
assert.equal(constrainHomeCoverProbability({ homeWinProbability: 0.62, homeCoverProbability: 0.55, homeSpread: 3.5 }), 0.62);
assert.equal(constrainHomeCoverProbability({ homeWinProbability: 0.57, homeCoverProbability: 0.52, homeSpread: 0 }), 0.57);
assert.equal(
  constrainHomeCoverProbability({ homeWinProbability: 0.62, homeCoverProbability: 0.65, homeSpread: -3, pushProbability: 0.04 }),
  (0.62 - 0.04) / 0.96,
);
assert.equal(
  constrainHomeCoverProbability({ homeWinProbability: 0.38, homeCoverProbability: 0.39, homeSpread: 3, pushProbability: 0.04 }),
  0.38 / 0.96,
);

const hawaiiLike = auditFootballCrossMarketCoherence({
  sport: "cfb",
  providerGameId: "haw-stan",
  awayTeam: "HAW",
  homeTeam: "STAN",
  forecast,
  decisions: [
    decision({ market: "moneyline", side: "HAW", probability: 0.4, fair: 0.395, price: 152, grade: "Lean" }),
    decision({ market: "spread", side: "HAW +4", probability: 0.48, fair: 0.52, price: -110, line: 4, grade: "No Play" }),
    decision({ market: "total", side: "Under 44.5", probability: 0.54, fair: 0.5, price: -105, line: 44.5, grade: "Lean" }),
  ],
});
assert.equal(hawaiiLike.release, FOOTBALL_CROSS_MARKET_COHERENCE_RELEASE);
assert.equal(hawaiiLike.passed, true, "a plus-money ML Lean and -110 spread No Play can be coherent");
assert.deepEqual(hawaiiLike.explanations.map((row) => row.code), ["price_or_threshold_divergence"]);

const impossible = auditFootballCrossMarketCoherence({
  sport: "nfl",
  providerGameId: "mia-lv",
  awayTeam: "MIA",
  homeTeam: "LV",
  forecast,
  decisions: [
    decision({ market: "moneyline", side: "MIA", probability: 0.62, fair: 0.5, price: 155, grade: "No Play" }),
    decision({ market: "spread", side: "MIA", probability: 0.51, fair: 0.5, price: -110, line: 3.5, grade: "Watchlist" }),
    decision({ market: "total", side: "Over 44.5", probability: 0.51, fair: 0.5, price: -110, line: 44.5, grade: "No Play" }),
  ],
});
assert.equal(impossible.passed, false);
assert.equal(impossible.fatalIssues.some((row) => row.code === "ml_spread_event_containment"), true);

const correctedAwayCover = 1 - constrainHomeCoverProbability({
  homeWinProbability: 0.38,
  homeCoverProbability: 0.49,
  homeSpread: -3.5,
});
const corrected = auditFootballCrossMarketCoherence({
  sport: "nfl",
  providerGameId: "mia-lv-corrected",
  awayTeam: "MIA",
  homeTeam: "LV",
  forecast,
  decisions: [
    decision({ market: "moneyline", side: "MIA", probability: 0.62, fair: 0.5, price: 155, grade: "No Play" }),
    decision({ market: "spread", side: "MIA", probability: correctedAwayCover, fair: 0.5, price: -110, line: 3.5, grade: "Lean" }),
    decision({ market: "total", side: "Over 44.5", probability: 0.51, fair: 0.5, price: -110, line: 44.5, grade: "No Play" }),
  ],
});
assert.equal(corrected.passed, true);

const scoreMismatch = auditFootballCrossMarketCoherence({
  sport: "nfl",
  providerGameId: "score-mismatch",
  awayTeam: "AWY",
  homeTeam: "HME",
  forecast: { ...forecast, expectedAwayPoints: 24, expectedHomePoints: 20 },
  decisions: [],
  allowWholeGameOperationalHold: true,
});
assert.equal(scoreMismatch.fatalIssues.some((row) => row.code === "forecast_winner_score_disagreement"), true);
assert.equal(scoreMismatch.fatalIssues.some((row) => row.code === "forecast_expected_score_identity"), true);

const directionCrossHomeWinProbability = 0.49448767833981844;
const directionCrossExpectedMargin = 0.1757457846952022;
const directionCrossTieMass = 2 * (3 * directionCrossHomeWinProbability - 1 - directionCrossExpectedMargin);
const directionCrossHomeWinMass = directionCrossHomeWinProbability - 0.5 * directionCrossTieMass;
const directionCrossAwayWinMass = 1 - directionCrossHomeWinMass - directionCrossTieMass;
const directionCross = auditFootballCrossMarketCoherence({
  sport: "cfb",
  providerGameId: "458220",
  awayTeam: "AWY",
  homeTeam: "HME",
  forecast: {
    expectedAwayPoints: 20 + directionCrossAwayWinMass,
    expectedHomePoints: 20 + 2 * directionCrossHomeWinMass,
    representativeScore: { away: 21, home: 20 },
    awayWinProbability: 1 - directionCrossHomeWinProbability,
    homeWinProbability: directionCrossHomeWinProbability,
    pmf: [
      { away: 20, home: 22, probability: directionCrossHomeWinMass },
      { away: 20, home: 20, probability: directionCrossTieMass },
      { away: 21, home: 20, probability: directionCrossAwayWinMass },
    ],
  },
  decisions: [],
  allowWholeGameOperationalHold: true,
});
assert.equal(directionCross.passed, false, "football never accepts a score/winner direction cross, even near an even game");
assert.equal(directionCross.fatalIssues.some((row) => row.code === "forecast_winner_score_disagreement"), true);

const unverifiedDirectionCross = auditFootballCrossMarketCoherence({
  sport: "cfb",
  providerGameId: "unverified-near-tossup",
  awayTeam: "AWY",
  homeTeam: "HME",
  forecast: {
    expectedAwayPoints: 20,
    expectedHomePoints: 20.2,
    representativeScore: { away: 21, home: 20 },
    awayWinProbability: 0.505,
    homeWinProbability: 0.495,
  },
  decisions: [],
  allowWholeGameOperationalHold: true,
});
assert.equal(unverifiedDirectionCross.fatalIssues.some((row) => row.code === "forecast_winner_score_disagreement"), true, "an unverified direction cross remains fatal");

const badAction = auditFootballCrossMarketCoherence({
  sport: "nfl",
  providerGameId: "bad-action",
  awayTeam: "AWY",
  homeTeam: "HME",
  forecast,
  decisions: [
    decision({ market: "moneyline", side: "HME", probability: 0.49, fair: 0.5, price: -110, grade: "Lean" }),
  ],
  unavailableMarkets: ["spread", "total"],
});
assert.equal(badAction.fatalIssues.some((row) => row.code === "actionable_nonpositive_value"), true);

const mismatchedLine = auditFootballCrossMarketCoherence({
  sport: "cfb",
  providerGameId: "mismatched-line",
  awayTeam: "AWY",
  homeTeam: "HME",
  forecast,
  decisions: [
    decision({ market: "moneyline", side: "HME", probability: 0.6, fair: 0.55, price: -120, grade: "Lean" }),
    decision({ market: "spread", side: "AWY +4", probability: 0.55, fair: 0.5, price: -110, line: 3.5, grade: "Lean" }),
    decision({ market: "total", side: "Under 44.5", probability: 0.55, fair: 0.5, price: -110, line: 45.5, grade: "Lean" }),
  ],
});
assert.equal(mismatchedLine.fatalIssues.filter((row) => row.code === "decision_side_identity").length, 2);

const tiedForecast = auditFootballCrossMarketCoherence({
  sport: "nfl",
  providerGameId: "coherent-tie",
  awayTeam: "AWY",
  homeTeam: "HME",
  forecast: {
    expectedAwayPoints: 21,
    expectedHomePoints: 21,
    representativeScore: { away: 21, home: 21 },
    awayWinProbability: 0.5,
    homeWinProbability: 0.5,
  },
  decisions: [],
  allowWholeGameOperationalHold: true,
});
assert.equal(tiedForecast.passed, true, "an exactly tied score and winner forecast is coherent");

const extremePmfForecast: FootballCoherenceForecast = {
  expectedAwayPoints: 7,
  expectedHomePoints: 63,
  representativeScore: { away: 7, home: 63 },
  awayWinProbability: 0,
  homeWinProbability: 1,
  pmf: [{ away: 7, home: 63, probability: 1 }],
};
const unqualifiedEndpoint = auditFootballCrossMarketCoherence({
  sport: "cfb",
  providerGameId: "extreme-without-proof-opt-in",
  awayTeam: "AWY",
  homeTeam: "HME",
  forecast: extremePmfForecast,
  decisions: [],
  allowWholeGameOperationalHold: true,
});
assert.equal(unqualifiedEndpoint.fatalIssues.some((row) => row.code === "forecast_probability_mass"), true,
  "the shared default continues rejecting exact endpoints");
const verifiedEndpoint = auditFootballCrossMarketCoherence({
  sport: "cfb",
  providerGameId: "extreme-with-pmf-proof",
  awayTeam: "AWY",
  homeTeam: "HME",
  forecast: extremePmfForecast,
  decisions: [],
  allowWholeGameOperationalHold: true,
  allowPmfVerifiedProbabilityEndpoints: true,
});
assert.equal(verifiedEndpoint.passed, true, "an exact endpoint is coherent only when its normalized PMF proves it");
const invalidEndpointPmf = auditFootballCrossMarketCoherence({
  sport: "cfb",
  providerGameId: "extreme-with-invalid-pmf",
  awayTeam: "AWY",
  homeTeam: "HME",
  forecast: { ...extremePmfForecast, pmf: [{ away: 7, home: 63, probability: 0.9 }] },
  decisions: [],
  allowWholeGameOperationalHold: true,
  allowPmfVerifiedProbabilityEndpoints: true,
});
assert.equal(invalidEndpointPmf.fatalIssues.some((row) => row.code === "forecast_distribution_mass"), true,
  "endpoint opt-in cannot bypass malformed PMF mass");

const alignedPublicForecast: FootballCoherenceForecast = {
  expectedAwayPoints: 18.88,
  expectedHomePoints: 22.7,
  representativeScore: { away: 20, home: 24 },
  awayWinProbability: 0.01,
  homeWinProbability: 0.99,
  pmf: [
    { away: 20, home: 24, probability: 0.59 },
    { away: 17, home: 21, probability: 0.4 },
    { away: 28, home: 14, probability: 0.01 },
  ],
};
const alignedPublicDecision = auditFootballCrossMarketCoherence({
  sport: "cfb",
  providerGameId: "public-side-aligned",
  awayTeam: "AWY",
  homeTeam: "HME",
  forecast: alignedPublicForecast,
  decisions: [
    decision({ market: "moneyline", side: "HME", probability: 0.7, fair: 0.55, price: -120, grade: "Lean" }),
    decision({ market: "spread", side: "HME -3.5", probability: 0.7, fair: 0.55, price: -110, line: -3.5, grade: "Lean" }),
    decision({ market: "total", side: "Under 44.5", probability: 0.7, fair: 0.55, price: -110, line: 44.5, grade: "Lean" }),
  ],
  requireDecisionSideFromForecast: true,
});
assert.equal(alignedPublicDecision.fatalIssues.some((row) => row.code === "decision_forecast_side_disagreement"), false);
const contradictoryPublicDecision = auditFootballCrossMarketCoherence({
  sport: "cfb",
  providerGameId: "public-side-conflict",
  awayTeam: "AWY",
  homeTeam: "HME",
  forecast: alignedPublicForecast,
  decisions: [
    decision({ market: "moneyline", side: "HME", probability: 0.7, fair: 0.55, price: -120, grade: "Lean" }),
    decision({ market: "spread", side: "HME -3.5", probability: 0.7, fair: 0.55, price: -110, line: -3.5, grade: "Lean" }),
    decision({ market: "total", side: "Over 44.5", probability: 0.7, fair: 0.55, price: -110, line: 44.5, grade: "Lean" }),
  ],
  requireDecisionSideFromForecast: true,
});
assert.equal(contradictoryPublicDecision.fatalIssues.some((row) => row.code === "decision_forecast_side_disagreement"), true, "the release gate must fail closed on a same-line score/PMF/decision contradiction");

console.log("Football cross-market coherence: score identity, event containment, price divergence, and actionable-value gates passed.");

function decision(args: {
  market: "moneyline" | "spread" | "total";
  side: string;
  probability: number;
  fair: number;
  price: number;
  line?: number | null;
  grade: string;
}): FootballCoherenceDecision {
  return {
    market: args.market,
    side: args.side,
    grade: args.grade,
    modelProbability: args.probability,
    marketFairProbability: args.fair,
    expectedValue: args.probability * profitOne(args.price) - (1 - args.probability),
    pushProbability: 0,
    evaluatedQuote: {
      sportsbook: "testbook",
      line: args.line ?? null,
      price: args.price,
      observedAt: "2026-08-28T12:00:00.000Z",
    },
  };
}

function profitOne(price: number): number {
  return price > 0 ? price / 100 : 100 / -price;
}
