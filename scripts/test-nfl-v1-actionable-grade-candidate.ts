import assert from "node:assert/strict";
import type { NflPreviewBookOdds } from "../lib/services/football/balldontlieNflPreviewSlate";
import {
  NFL_R6_MONEYLINE_CALIBRATION_RELEASE,
  NFL_R6_MONEYLINE_DECISION_RELEASE,
  NFL_R6_MONEYLINE_MODEL_RELEASE,
  NFL_R6_RUNTIME_ARTIFACT_RELEASE,
  NFL_R6_SHADOW_DECISION_SCHEMA_RELEASE,
  NFL_R6_SOURCE_POINT_MODEL_RELEASE,
  type NflR6ShadowMoneylineDecision,
} from "../lib/services/football/nflR6MoneylineShadow";
import {
  applyNflV1LogitCorrection,
  getNflV1ActionableGradeCorrection,
  nflV1ActionableGradeArtifactMetadata,
  NFL_V1_SPREAD_HEAD_RELEASE,
  NFL_V1_TOTAL_HEAD_RELEASE,
} from "../lib/services/football/nflV1ActionableGradeCorrections";
import {
  buildNflV1ActionableGradeBundle,
  NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
} from "../lib/services/football/nflV1ActionableGradeCandidate";
import {
  getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities,
} from "../lib/services/football/nflV1WeekOneOutcome";

const providerGameId = "1392216";
const awayTeam = "NE";
const homeTeam = "SEA";
const gameStartsAt = "2026-09-10T00:20:00.000Z";
const evaluatedAt = "2026-08-25T11:21:34.519Z";
const current = quote("fanduel", -108, -112, -110, -110);
const comparableCurrentBooks = [
  current,
  quote("draftkings", -105, -115, -108, -112),
  quote("caesars", -110, -110, -108, -112),
  quote("betmgm", -107, -113, -106, -114),
  quote("fanatics", -106, -114, -105, -115),
  quote("betrivers", -109, -111, -107, -113),
];

const correction = getNflV1ActionableGradeCorrection({ providerGameId, awayTeam, homeTeam });
const outcome = getNflV1WeekOneOutcomeForecast({ providerGameId, awayTeam, homeTeam });
const reference = nflV1WeekOneLineProbabilities({
  forecast: outcome,
  homeSpread: -correction.referenceConsensusHomeMargin,
  totalLine: correction.referenceConsensusTotal,
});
assert.equal(reference.spread.homeCoverProbability.toFixed(9), correction.r10HomeCoverProbability.toFixed(9));
assert.equal(reference.total.overProbability.toFixed(9), correction.r10OverProbability.toFixed(9));
assert.equal(
  applyNflV1LogitCorrection(reference.spread.homeCoverProbability, correction.spreadHomeLogitCorrection).toFixed(9),
  correction.spreadHeadHomeCoverProbability.toFixed(9),
);
assert.equal(
  applyNflV1LogitCorrection(reference.total.overProbability, correction.totalOverLogitCorrection).toFixed(9),
  correction.totalHeadOverProbability.toFixed(9),
);
assert.equal(nflV1ActionableGradeArtifactMetadata().games, 16);

const candidate = buildNflV1ActionableGradeBundle({
  providerGameId,
  awayTeam,
  homeTeam,
  gameStartsAt,
  current,
  comparableCurrentBooks,
  shadowMoneyline: shadow(),
});
assert.equal(candidate.publicationEnabled, true);
assert.equal(candidate.trackingEnabled, false);
assert.equal(candidate.decisionRelease, NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE);
assert.equal(candidate.evaluatedBets.length, 3);
const moneyline = candidate.evaluatedBets.find((decision) => decision.market === "moneyline")!;
const spread = candidate.evaluatedBets.find((decision) => decision.market === "spread")!;
const total = candidate.evaluatedBets.find((decision) => decision.market === "total")!;
assert.equal(moneyline.grade, "Best Angle");
assert.equal(moneyline.side, "SEA");
assert.equal(spread.modelRelease, NFL_V1_SPREAD_HEAD_RELEASE);
assert.equal(spread.grade, "No Play");
assert.equal(total.modelRelease, NFL_V1_TOTAL_HEAD_RELEASE);
assert.equal(total.grade, "Lean");
assert.equal(total.side, "Over 44.5");
assert.equal(total.evaluatedQuote.sportsbook, "fanatics");
assert.equal(total.evaluatedQuote.price, -105);
assert.ok(total.expectedValue > 0.2);
assert.ok(total.modelProbability > total.marketFairProbability);
assert.equal(candidate.evaluatedBets.every((decision) => decision.evaluatedAt === evaluatedAt), true);
assert.equal(candidate.evaluatedBets.every((decision) => decision.lockedAt === null), true);

const held = buildNflV1ActionableGradeBundle({
  providerGameId,
  awayTeam,
  homeTeam,
  gameStartsAt,
  current,
  comparableCurrentBooks,
  shadowMoneyline: {
    ...shadow(),
    health: {
      blockingReasons: ["injury_report_unavailable"],
      quarterbackReasons: [],
      contextReasons: [],
    },
  },
});
assert.equal(held.evaluatedBets.length, 0);
assert.equal(held.publicationEnabled, true);
assert.equal(held.trackingEnabled, false);

console.log("NFL actionable grade release: correction parity, exact-price grades, Best Angle, and publication boundaries passed");

function quote(
  sportsbook: string,
  awaySpreadPrice: number,
  homeSpreadPrice: number,
  overPrice: number,
  underPrice: number,
): NflPreviewBookOdds {
  return {
    providerGameId,
    sportsbook,
    observedAt: evaluatedAt,
    moneyline: { awayPrice: 155, homePrice: -175 },
    spread: { awayLine: 3.5, homeLine: -3.5, awayPrice: awaySpreadPrice, homePrice: homeSpreadPrice },
    total: { line: 44.5, overPrice, underPrice },
  };
}

function shadow(): NflR6ShadowMoneylineDecision {
  return {
    schemaRelease: NFL_R6_SHADOW_DECISION_SCHEMA_RELEASE,
    decisionKind: "shadow_exact_price_bet",
    shadowOnly: true,
    publicationEligible: false,
    trackingEligible: false,
    providerGameId,
    market: "moneyline",
    grade: "Lean",
    side: "home",
    team: homeTeam,
    modelProbability: 0.65,
    otherBooksConsensusFairProbability: 0.60,
    targetBookFairProbability: 0.61,
    otherBookCount: 5,
    evaluatedQuote: { sportsbook: "draftkings", line: null, price: -160, observedAt: evaluatedAt },
    expectedValuePerUnit: 0.05,
    edgePercentagePoints: 5,
    decisionStage: "unlocked",
    evaluatedAt,
    gameStartsAt,
    lockedAt: null,
    reason: "uncapped_market_led_exact_price_candidate",
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
