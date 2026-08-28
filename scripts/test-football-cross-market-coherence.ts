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

const nearTossupHomeWinProbability = 0.49448767833981844;
const nearTossupExpectedMargin = 0.1757457846952022;
const nearTossupTieMass = 2 * (3 * nearTossupHomeWinProbability - 1 - nearTossupExpectedMargin);
const nearTossupHomeWinMass = nearTossupHomeWinProbability - 0.5 * nearTossupTieMass;
const nearTossupAwayWinMass = 1 - nearTossupHomeWinMass - nearTossupTieMass;
const nearTossup = auditFootballCrossMarketCoherence({
  sport: "cfb",
  providerGameId: "458220",
  awayTeam: "AWY",
  homeTeam: "HME",
  forecast: {
    expectedAwayPoints: 20 + nearTossupAwayWinMass,
    expectedHomePoints: 20 + 2 * nearTossupHomeWinMass,
    representativeScore: { away: 21, home: 20 },
    awayWinProbability: 1 - nearTossupHomeWinProbability,
    homeWinProbability: nearTossupHomeWinProbability,
    pmf: [
      { away: 20, home: 22, probability: nearTossupHomeWinMass },
      { away: 20, home: 20, probability: nearTossupTieMass },
      { away: 21, home: 20, probability: nearTossupAwayWinMass },
    ],
  },
  decisions: [],
  allowWholeGameOperationalHold: true,
});
assert.equal(nearTossup.passed, true, "a PMF-verified sub-half-point/sub-one-percentage-point toss-up cannot block the entire slate");

const unverifiedNearTossup = auditFootballCrossMarketCoherence({
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
assert.equal(unverifiedNearTossup.fatalIssues.some((row) => row.code === "forecast_winner_score_disagreement"), true, "the toss-up exception requires a checkable distribution identity");

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
