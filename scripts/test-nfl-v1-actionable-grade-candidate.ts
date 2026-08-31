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
} from "../lib/services/football/nflV1ActionableGradeCorrections";
import {
  buildNflV1ActionableGradeBundle,
  NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
  NFL_V1_EVENT_CONTAINED_SPREAD_MODEL_RELEASE,
  NFL_V1_MARKET_EVIDENCE_TOTAL_MODEL_RELEASE,
} from "../lib/services/football/nflV1ActionableGradeCandidate";
import {
  buildNflMarketEvidenceOutcomeForecast,
  getNflV1WeekOneOutcomeForecast,
  NFL_V1_MARKET_EVIDENCE_OUTCOME_RELEASE,
  NFL_V1_MARKET_WEIGHT,
  NFL_V1_PUBLIC_SPLIT_MAX_SHIFT_POINTS,
  NFL_V1_SHARP_SPLIT_MAX_SHIFT_POINTS,
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
assert.equal(spread.modelRelease, NFL_V1_EVENT_CONTAINED_SPREAD_MODEL_RELEASE);
assert.equal(spread.grade, "No Play");
assert.equal(total.modelRelease, NFL_V1_MARKET_EVIDENCE_TOTAL_MODEL_RELEASE);
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

const weekly = buildNflV1ActionableGradeBundle({
  providerGameId: "week-two-runtime-test",
  awayTeam,
  homeTeam,
  gameStartsAt,
  current,
  comparableCurrentBooks,
  shadowMoneyline: {
    ...shadow(),
    providerGameId: "week-two-runtime-test",
    footballProjection: { openingHomeMargin: 3.5, independentCorrection: 0.75, projectedHomeMargin: 4.25 },
  },
});
assert.equal(weekly.evaluatedBets.length, 3);
assert.equal(weekly.outcomeConfidence.length, 3);
assert.equal(weekly.evaluatedBets.every((decision) => decision.providerGameId === "week-two-runtime-test"), true);

const flipBooks = comparableCurrentBooks.map((book) => ({
  ...book,
  spread: book.spread ? { ...book.spread, awayLine: -0.5, homeLine: 0.5 } : null,
}));
const weeklyBase = getNflV1WeekOneOutcomeForecast({
  providerGameId: "market-side-reselection-test",
  awayTeam,
  homeTeam,
  weeklyFallback: { projectedHomeMargin: 4.25, marketTotal: 44.5 },
});
const marketOnly = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: weeklyBase,
  footballHomeMargin: 4.25,
  current: flipBooks[0]!,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  evaluatedAt,
});
const circaAway = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: weeklyBase,
  footballHomeMargin: 4.25,
  current: flipBooks[0]!,
  playbookLine: {
    capturedAt: evaluatedAt,
    homeSpread: 0.5,
    total: 44.5,
  },
  playbookSplits: splitSet({ homeMoneyPct: 80, homeBetsPct: 30 }),
  sharpSplits: sharpSplitSet({ homeMoneyPct: 20, homeBetsPct: 70 }),
  evaluatedAt,
});
assert.equal(NFL_V1_MARKET_EVIDENCE_OUTCOME_RELEASE, "nfl_v1_market_evidence_outcome_2026_08_31_r1_circa_public_bounded");
assert.equal(NFL_V1_MARKET_WEIGHT, 0.75);
assert.equal(NFL_V1_SHARP_SPLIT_MAX_SHIFT_POINTS, 1.5);
assert.equal(NFL_V1_PUBLIC_SPLIT_MAX_SHIFT_POINTS, 0.75);
assert.ok(marketOnly.homeWinProbability > marketOnly.awayWinProbability);
assert.ok(circaAway.awayWinProbability > circaAway.homeWinProbability);
assert.ok(
  circaAway.expectedHomeScore - circaAway.expectedAwayScore <
  marketOnly.expectedHomeScore - marketOnly.expectedAwayScore,
  "fresh Circa money-over-bets resistance must move the forecast toward the away side",
);
assert.ok(
  circaAway.expectedHomeScore - circaAway.expectedAwayScore < 0,
  "opposing lower-strength public evidence must not reverse a qualifying Circa direction",
);
const marketOnlyBundle = buildNflV1ActionableGradeBundle({
  providerGameId: "market-side-reselection-test",
  awayTeam,
  homeTeam,
  gameStartsAt,
  current: flipBooks[0]!,
  comparableCurrentBooks: flipBooks,
  shadowMoneyline: { ...shadow(), providerGameId: "market-side-reselection-test" },
  outcomeForecast: marketOnly,
});
const circaAwayBundle = buildNflV1ActionableGradeBundle({
  providerGameId: "market-side-reselection-test",
  awayTeam,
  homeTeam,
  gameStartsAt,
  current: flipBooks[0]!,
  comparableCurrentBooks: flipBooks,
  shadowMoneyline: { ...shadow(), providerGameId: "market-side-reselection-test" },
  outcomeForecast: circaAway,
});
assert.equal(marketOnlyBundle.evaluatedBets.find((decision) => decision.market === "spread")?.side, homeTeam);
assert.equal(circaAwayBundle.evaluatedBets.find((decision) => decision.market === "spread")?.side, awayTeam);
assert.ok(["Best Angle", "Lean", "Watchlist", "No Play"].includes(
  circaAwayBundle.evaluatedBets.find((decision) => decision.market === "spread")!.grade,
));
const staleCirca = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: weeklyBase,
  footballHomeMargin: 4.25,
  current: flipBooks[0]!,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: sharpSplitSet({
    homeMoneyPct: 20,
    homeBetsPct: 70,
    capturedAt: "2026-08-25T08:00:00.000Z",
    providerFetchedAt: "2026-08-25T08:00:00.000Z",
  }),
  evaluatedAt,
});
assert.equal(staleCirca.expectedHomeScore.toFixed(9), marketOnly.expectedHomeScore.toFixed(9));
assert.equal(staleCirca.expectedAwayScore.toFixed(9), marketOnly.expectedAwayScore.toFixed(9));
const fragmentedBooks = flipBooks.map((book, index) => ({
  ...book,
  spread: book.spread ? {
    ...book.spread,
    awayLine: -(0.5 + Math.floor(index / 2)),
    homeLine: 0.5 + Math.floor(index / 2),
  } : null,
  total: book.total ? { ...book.total, line: 44.5 + Math.floor(index / 2) } : null,
}));
const fragmented = buildNflV1ActionableGradeBundle({
  providerGameId: "market-side-reselection-test",
  awayTeam,
  homeTeam,
  gameStartsAt,
  current: fragmentedBooks[0]!,
  comparableCurrentBooks: fragmentedBooks,
  shadowMoneyline: { ...shadow(), providerGameId: "market-side-reselection-test" },
  outcomeForecast: marketOnly,
});
assert.equal(fragmented.evaluatedBets.length, 3, "two-book exact-line cohorts must not blank a game");
assert.equal(fragmented.evaluatedBets.some((decision) => decision.market !== "moneyline" &&
  ["Best Angle", "Lean"].includes(decision.grade)), false,
"one target-excluded same-line comparator cannot authorize an actionable spread/total grade");

console.log("NFL actionable grade release: correction parity, exact-price grades, market-led side reselection, weekly runtime, Best Angle, and publication boundaries passed");

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

function splitSet(args: {
  homeMoneyPct: number;
  homeBetsPct: number;
  capturedAt?: string;
}) {
  const market = {
    capturedAt: args.capturedAt ?? evaluatedAt,
    homeMoneyPct: args.homeMoneyPct,
    homeBetsPct: args.homeBetsPct,
    overMoneyPct: 50,
    overBetsPct: 50,
  };
  return { moneyline: market, spread: market, total: market };
}

function sharpSplitSet(args: {
  homeMoneyPct: number;
  homeBetsPct: number;
  capturedAt?: string;
  providerFetchedAt?: string;
}) {
  const market = {
    ...splitSet(args).spread,
    sourceSportsbook: "Circa",
    providerFetchedAt: args.providerFetchedAt ?? evaluatedAt,
  };
  return { moneyline: market, spread: market, total: market };
}
