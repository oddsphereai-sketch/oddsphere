import assert from "node:assert/strict";
import type { NflR6ShadowMoneylineDecision } from "../lib/services/football/nflR6MoneylineShadow";
import {
  NFL_R6_MONEYLINE_CALIBRATION_RELEASE,
  NFL_R6_MONEYLINE_DECISION_RELEASE,
  NFL_R6_MONEYLINE_MODEL_RELEASE,
  NFL_R6_RUNTIME_ARTIFACT_RELEASE,
  NFL_R6_SHADOW_DECISION_SCHEMA_RELEASE,
  NFL_R6_SOURCE_POINT_MODEL_RELEASE,
} from "../lib/services/football/nflR6MoneylineShadow";
import { buildNflV1ProductionDecisionBundle } from "../lib/services/football/nflV1ProductionDecision";
import { getNflV1WeekOneOutcomeForecast } from "../lib/services/football/nflV1WeekOneOutcome";

const providerGameId = "1392216";
const awayTeam = "NE";
const homeTeam = "SEA";
const gameStartsAt = "2026-09-10T00:20:00.000Z";
const evaluatedAt = "2026-08-23T14:06:21.315Z";
const current = {
  providerGameId,
  sportsbook: "fanduel",
  observedAt: evaluatedAt,
  moneyline: { awayPrice: 162, homePrice: -194 },
  spread: { awayLine: 3.5, homeLine: -3.5, awayPrice: -108, homePrice: -112 },
  total: { line: 44.5, overPrice: -115, underPrice: -105 },
};
const outcome = getNflV1WeekOneOutcomeForecast({ providerGameId, awayTeam, homeTeam });
assert.ok(outcome.homeWinProbability > outcome.awayWinProbability);

const aligned = buildNflV1ProductionDecisionBundle({
  providerGameId, awayTeam, homeTeam, gameStartsAt, current,
  shadowMoneyline: shadow({ team: "SEA", side: "home", grade: "Lean", probability: 0.65, price: -180 }),
});
assert.equal(aligned.evaluatedBets.length, 3);
assert.equal(aligned.outcomeConfidence.length, 3);
assert.equal(aligned.evaluatedBets.find((decision) => decision.market === "moneyline")?.grade, "Lean");
assert.equal(aligned.evaluatedBets.find((decision) => decision.market === "moneyline")?.modelRelease, NFL_R6_MONEYLINE_MODEL_RELEASE);
assert.equal(aligned.evaluatedBets.filter((decision) => decision.grade === "No Play").length, 2);
assert.equal(aligned.trackingEnabled, false);

const opposed = buildNflV1ProductionDecisionBundle({
  providerGameId, awayTeam, homeTeam, gameStartsAt, current,
  shadowMoneyline: shadow({ team: "NE", side: "away", grade: "Lean", probability: 0.55, price: 162 }),
});
const opposedMoneyline = opposed.evaluatedBets.find((decision) => decision.market === "moneyline")!;
assert.equal(opposedMoneyline.grade, "Watchlist");
assert.equal(opposedMoneyline.side, "SEA");
assert.equal(opposedMoneyline.modelProbability, outcome.homeWinProbability);
assert.equal(opposedMoneyline.evaluatedQuote.sportsbook, "fanduel");

const nonqualifier = buildNflV1ProductionDecisionBundle({
  providerGameId, awayTeam, homeTeam, gameStartsAt, current,
  shadowMoneyline: shadow({ team: "SEA", side: "home", grade: "Held", probability: 0.595, price: -180, expectedValue: -0.005, edgePp: -0.5 }),
});
assert.equal(nonqualifier.evaluatedBets.find((decision) => decision.market === "moneyline")?.grade, "Watchlist");
assert.equal(nonqualifier.evaluatedBets.every((decision) => decision.side.length > 0), true);
assert.equal(nonqualifier.trackingEnabled, false);

const outsideBoundary = buildNflV1ProductionDecisionBundle({
  providerGameId, awayTeam, homeTeam, gameStartsAt, current,
  shadowMoneyline: shadow({ team: "SEA", side: "home", grade: "Held", probability: 0.57, price: -180, expectedValue: -0.03, edgePp: -3 }),
});
assert.equal(outsideBoundary.evaluatedBets.find((decision) => decision.market === "moneyline")?.grade, "No Play");

const unboundedPublicPrice = buildNflV1ProductionDecisionBundle({
  providerGameId, awayTeam, homeTeam, gameStartsAt,
  current: { ...current, moneyline: { awayPrice: 255, homePrice: -325 } },
  shadowMoneyline: shadow({ team: "NE", side: "away", grade: "Lean", probability: 0.55, price: 255 }),
});
assert.equal(unboundedPublicPrice.evaluatedBets.find((decision) => decision.market === "moneyline")?.grade, "No Play");

const trueHealthHold = buildNflV1ProductionDecisionBundle({
  providerGameId, awayTeam, homeTeam, gameStartsAt, current,
  shadowMoneyline: {
    ...shadow({ team: "SEA", side: "home", grade: "Held", probability: 0.61, price: -180 }),
    health: { blockingReasons: ["injury_report_unavailable"], quarterbackReasons: [], contextReasons: [] },
    reason: "shadow_evaluation_held",
  },
});
assert.equal(trueHealthHold.evaluatedBets.length, 0);
assert.equal(trueHealthHold.outcomeConfidence.length, 3);
assert.equal(trueHealthHold.publicationEnabled, true);
assert.equal(trueHealthHold.trackingEnabled, false);

console.log("NFL v1 decision bundle: r10 forecasts, r6 Leans, bounded Watchlists, No Plays, and true health Holds passed");

function shadow(args: {
  team: "NE" | "SEA";
  side: "away" | "home";
  grade: "Lean" | "Held";
  probability: number;
  price: number;
  expectedValue?: number;
  edgePp?: number;
}): NflR6ShadowMoneylineDecision {
  return {
    schemaRelease: NFL_R6_SHADOW_DECISION_SCHEMA_RELEASE,
    decisionKind: "shadow_exact_price_bet",
    shadowOnly: true,
    publicationEligible: false,
    trackingEligible: false,
    providerGameId,
    market: "moneyline",
    grade: args.grade,
    side: args.side,
    team: args.team,
    modelProbability: args.probability,
    otherBooksConsensusFairProbability: 0.6,
    targetBookFairProbability: 0.61,
    otherBookCount: 4,
    evaluatedQuote: { sportsbook: "draftkings", line: null, price: args.price, observedAt: evaluatedAt },
    expectedValuePerUnit: args.expectedValue ?? 0.02,
    edgePercentagePoints: args.edgePp ?? (args.probability - 0.6) * 100,
    decisionStage: "unlocked",
    evaluatedAt,
    gameStartsAt,
    lockedAt: null,
    reason: args.grade === "Lean" ? "uncapped_market_led_exact_price_candidate" : "exact_price_does_not_clear_candidate_thresholds",
    footballProjection: null,
    quarterbackContext: {
      away: { name: "Drake Maye", historyMatched: true, status: "projected" },
      home: { name: "Sam Darnold", historyMatched: true, status: "projected" },
    },
    health: {
      blockingReasons: [],
      quarterbackReasons: ["away_quarterback_projected_not_confirmed", "home_quarterback_projected_not_confirmed"],
      contextReasons: ["sharpapi_splits_unavailable"],
    },
    runtimeArtifactRelease: NFL_R6_RUNTIME_ARTIFACT_RELEASE,
    modelRelease: NFL_R6_MONEYLINE_MODEL_RELEASE,
    calibrationRelease: NFL_R6_MONEYLINE_CALIBRATION_RELEASE,
    decisionRelease: NFL_R6_MONEYLINE_DECISION_RELEASE,
    sourcePointModelRelease: NFL_R6_SOURCE_POINT_MODEL_RELEASE,
  };
}
