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
  NFL_V1_RESIDUAL_HEAD_LOGIT_WEIGHT,
  NFL_V1_SHARP_SPLIT_MAX_SHIFT_POINTS,
  NFL_V1_WEAK_EVIDENCE_REVERSAL_MINIMUM_ADVANTAGE,
  nflV1WeekOneLineProbabilities,
} from "../lib/services/football/nflV1WeekOneOutcome";
import {
  resolveNflTargetExcludedMarketAnchor,
  resolveNflTargetExcludedProduction,
} from "../lib/services/football/nflTargetExcludedMarketOutcome";

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
const targetExcludedBooks = comparableCurrentBooks.map((book, index) => ({
  ...book,
  spread: { ...book.spread!, homeLine: [-3, -3.5, -3.5, -4, -4, -4.5][index]!, awayLine: -[-3, -3.5, -3.5, -4, -4, -4.5][index]! },
  total: { ...book.total!, line: [44, 44.5, 44.5, 45, 45, 45.5][index]! },
}));
assert.deepEqual(resolveNflTargetExcludedMarketAnchor({
  books: targetExcludedBooks,
  marginExcludedSportsbooks: ["fanduel", "draftkings"],
  totalExcludedSportsbooks: ["betmgm"],
  evaluatedAt,
}), {
  release: "nfl_target_excluded_market_outcome_2026_09_03_r1",
  homeMargin: 4,
  total: 44.5,
  marginFamilyCount: 4,
  totalFamilyCount: 5,
  marginExcludedSportsbooks: ["draftkings", "fanduel"],
  totalExcludedSportsbooks: ["betmgm"],
});
assert.equal(resolveNflTargetExcludedMarketAnchor({
  books: targetExcludedBooks,
  marginExcludedSportsbooks: ["fanduel", "draftkings", "caesars", "betmgm"],
  totalExcludedSportsbooks: [],
  evaluatedAt,
}), null, "fewer than three target-excluded margin families must use the independent PMF");
assert.equal(resolveNflTargetExcludedMarketAnchor({
  books: targetExcludedBooks,
  marginExcludedSportsbooks: [],
  totalExcludedSportsbooks: [],
  evaluatedAt: "2026-08-25T13:22:00.000Z",
}), null, "stale target-excluded landmarks cannot author the PMF");

const targetExcludedProduction = resolveNflTargetExcludedProduction({
  providerGameId,
  awayTeam,
  homeTeam,
  gameStartsAt,
  evaluatedAt,
  baseOutcome: getNflV1WeekOneOutcomeForecast({ providerGameId, awayTeam, homeTeam }),
  incumbentOutcome: getNflV1WeekOneOutcomeForecast({ providerGameId, awayTeam, homeTeam }),
  current: targetExcludedBooks[0]!,
  comparableCurrentBooks: targetExcludedBooks,
  shadowMoneyline: {
    ...shadow(),
    footballProjection: { openingHomeMargin: 3.5, independentCorrection: 0.75, projectedHomeMargin: 4.25 },
  },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
});
assert.equal(targetExcludedProduction.targetExclusion.status, "target_excluded_market");
assert.equal(targetExcludedProduction.production.evaluatedBets.length, 3);
for (const decision of targetExcludedProduction.production.evaluatedBets) {
  const family = decision.evaluatedQuote.sportsbook.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const excluded = decision.market === "total"
    ? targetExcludedProduction.targetExclusion.totalExcludedSportsbooks
    : targetExcludedProduction.targetExclusion.marginExcludedSportsbooks;
  assert.ok(excluded.includes(family), `final ${decision.market} target must be recorded as excluded`);
}
const targetExcludedFallback = resolveNflTargetExcludedProduction({
  providerGameId,
  awayTeam,
  homeTeam,
  gameStartsAt,
  evaluatedAt,
  baseOutcome: getNflV1WeekOneOutcomeForecast({ providerGameId, awayTeam, homeTeam }),
  incumbentOutcome: getNflV1WeekOneOutcomeForecast({ providerGameId, awayTeam, homeTeam }),
  current: targetExcludedBooks[0]!,
  comparableCurrentBooks: targetExcludedBooks.slice(0, 3),
  shadowMoneyline: {
    ...shadow(),
    footballProjection: { openingHomeMargin: 3.5, independentCorrection: 0.75, projectedHomeMargin: 4.25 },
  },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
});
assert.equal(targetExcludedFallback.targetExclusion.status, "incumbent_fallback");
assert.equal(targetExcludedFallback.outcome.expectedAwayScore, getNflV1WeekOneOutcomeForecast({ providerGameId, awayTeam, homeTeam }).expectedAwayScore);
assert.equal(targetExcludedFallback.outcome.expectedHomeScore, getNflV1WeekOneOutcomeForecast({ providerGameId, awayTeam, homeTeam }).expectedHomeScore);

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

const calibrated = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: outcome,
  footballHomeMargin: correction.referenceConsensusHomeMargin,
  current,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  evaluatedAt,
});
const calibratedProbabilities = nflV1WeekOneLineProbabilities({
  forecast: calibrated,
  homeSpread: current.spread!.homeLine,
  totalLine: current.total!.line,
});
assert.equal(calibrated.marketEvidence?.calibratedCore.source, "week_one_spread_total_residual_heads");
assert.equal(
  calibratedProbabilities.spread.homeCoverProbability.toFixed(9),
  calibrated.marketEvidence?.calibratedCore.calibratedHomeCoverProbability.toFixed(9),
);
assert.equal(
  calibratedProbabilities.total.overProbability.toFixed(9),
  calibrated.marketEvidence?.calibratedCore.calibratedOverProbability.toFixed(9),
);
assert.ok(!Number.isInteger(calibrated.expectedHomeScore * 2));

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
assert.equal(candidate.outcomeConfidence.find((decision) => decision.market === "moneyline")?.likelySide, "SEA");
assert.ok(outcome.expectedHomeScore > outcome.expectedAwayScore);
assert.ok(outcome.homeWinProbability > outcome.awayWinProbability);
assert.equal(moneyline.grade, "Best Angle");
assert.equal(moneyline.side, "NE");
assert.equal(moneyline.modelProbability, outcome.awayWinProbability);
assert.ok(moneyline.modelProbability < 0.5);
assert.ok(moneyline.expectedValue > 0);
assert.equal(spread.modelRelease, NFL_V1_EVENT_CONTAINED_SPREAD_MODEL_RELEASE);
assert.equal(spread.grade, "Lean");
assert.equal(spread.modelProbability, reference.spread.awayCoverProbability);
assert.equal(total.modelRelease, NFL_V1_MARKET_EVIDENCE_TOTAL_MODEL_RELEASE);
assert.equal(total.grade, "Best Angle");
assert.equal(total.side, "Over 44.5");
assert.equal(total.evaluatedQuote.sportsbook, "fanatics");
assert.equal(total.evaluatedQuote.price, -105);
assert.equal(total.modelProbability, reference.total.overProbability);
assert.ok(total.expectedValue > 0.15);
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
assert.equal(NFL_V1_MARKET_EVIDENCE_OUTCOME_RELEASE, "nfl_v1_market_evidence_outcome_2026_09_03_r3_target_excluded_forecast");
assert.equal(NFL_V1_MARKET_WEIGHT, 0.75);
assert.equal(NFL_V1_SHARP_SPLIT_MAX_SHIFT_POINTS, 1.5);
assert.equal(NFL_V1_PUBLIC_SPLIT_MAX_SHIFT_POINTS, 0.75);
assert.equal(NFL_V1_RESIDUAL_HEAD_LOGIT_WEIGHT, 0.5);
assert.equal(NFL_V1_WEAK_EVIDENCE_REVERSAL_MINIMUM_ADVANTAGE, 0.025);
assert.ok(marketOnly.homeWinProbability > marketOnly.awayWinProbability);
assert.equal(marketOnly.marketEvidence?.combinedHomeMarginShiftPoints, 0);
assert.equal(marketOnly.marketEvidence?.combinedTotalShiftPoints, 0);
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
const weakPublicMarketOnly = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: weeklyBase,
  footballHomeMargin: 4.25,
  current,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  evaluatedAt,
});
const weakPublicAway = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: weeklyBase,
  footballHomeMargin: 4.25,
  current,
  playbookLine: {
    capturedAt: evaluatedAt,
    homeSpread: -3.5,
    total: 44.5,
  },
  playbookSplits: splitSet({ homeMoneyPct: 20, homeBetsPct: 70 }),
  sharpSplits: null,
  evaluatedAt,
});
assert.equal(weakPublicAway.marketEvidence?.weakHomeMarginReversalRejected, true);
assert.equal(weakPublicAway.expectedHomeScore.toFixed(9), weakPublicMarketOnly.expectedHomeScore.toFixed(9));
assert.equal(weakPublicAway.expectedAwayScore.toFixed(9), weakPublicMarketOnly.expectedAwayScore.toFixed(9));
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
assert.equal(marketOnlyBundle.outcomeConfidence.find((decision) => decision.market === "moneyline")?.likelySide, homeTeam);
assert.equal(marketOnlyBundle.evaluatedBets.find((decision) => decision.market === "moneyline")?.side, awayTeam);
assert.ok(marketOnlyBundle.evaluatedBets.find((decision) => decision.market === "moneyline")!.modelProbability < 0.5);
assert.ok(["Best Angle", "Lean"].includes(
  marketOnlyBundle.evaluatedBets.find((decision) => decision.market === "moneyline")!.grade,
));
assert.equal(circaAwayBundle.evaluatedBets.find((decision) => decision.market === "moneyline")?.side, awayTeam);
assert.equal(circaAwayBundle.outcomeConfidence.find((decision) => decision.market === "moneyline")?.likelySide, awayTeam);
assert.ok(circaAway.expectedAwayScore > circaAway.expectedHomeScore);
assert.ok(circaAway.awayWinProbability > 0.5);
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
const underdogValueForecast = {
  ...marketOnly,
  awayWinProbability: 0.46,
  homeWinProbability: 0.54,
  tieProbability: 0,
};
const underdogValueBooks = flipBooks.map((book) => ({
  ...book,
  moneyline: { awayPrice: 150, homePrice: -170 },
}));
const underdogValueBundle = buildNflV1ActionableGradeBundle({
  providerGameId: "market-side-reselection-test",
  awayTeam,
  homeTeam,
  gameStartsAt,
  current: underdogValueBooks[0]!,
  comparableCurrentBooks: underdogValueBooks,
  shadowMoneyline: { ...shadow(), providerGameId: "market-side-reselection-test" },
  outcomeForecast: underdogValueForecast,
});
const underdogValueMoneyline = underdogValueBundle.evaluatedBets.find((decision) => decision.market === "moneyline")!;
assert.equal(underdogValueBundle.outcomeConfidence.find((decision) => decision.market === "moneyline")?.likelySide, homeTeam);
assert.ok(underdogValueForecast.expectedHomeScore > underdogValueForecast.expectedAwayScore);
assert.equal(underdogValueMoneyline.side, awayTeam);
assert.equal(underdogValueMoneyline.modelProbability, 0.46);
assert.equal(underdogValueMoneyline.grade, "Best Angle");
assert.ok(underdogValueMoneyline.expectedValue > 0);
assert.ok(underdogValueMoneyline.modelProbability > underdogValueMoneyline.marketFairProbability);
assert.equal(underdogValueForecast.marketEvidence?.sharp.homeMarginGapPp, null);
assert.equal(underdogValueForecast.marketEvidence?.publicConsensus.homeMarginGapPp, null);
const unqualifiedUnderdogBooks = flipBooks.map((book) => ({
  ...book,
  moneyline: { awayPrice: 100, homePrice: -180 },
}));
const unqualifiedUnderdogBundle = buildNflV1ActionableGradeBundle({
  providerGameId: "market-side-reselection-test",
  awayTeam,
  homeTeam,
  gameStartsAt,
  current: unqualifiedUnderdogBooks[0]!,
  comparableCurrentBooks: unqualifiedUnderdogBooks,
  shadowMoneyline: { ...shadow(), providerGameId: "market-side-reselection-test" },
  outcomeForecast: underdogValueForecast,
});
const unqualifiedUnderdogMoneyline = unqualifiedUnderdogBundle.evaluatedBets.find((decision) => decision.market === "moneyline")!;
assert.equal(unqualifiedUnderdogMoneyline.side, homeTeam);
assert.equal(unqualifiedUnderdogMoneyline.grade, "No Play");
assert.ok(unqualifiedUnderdogMoneyline.expectedValue < 0);
const openingQuote: NflPreviewBookOdds = {
  ...flipBooks[0]!,
  observedAt: "2026-08-25T09:21:34.519Z",
  spread: { ...flipBooks[0]!.spread!, awayLine: -4.5, homeLine: 4.5 },
  total: { ...flipBooks[0]!.total!, line: 40.5 },
};
const withMovement = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: weeklyBase,
  footballHomeMargin: 4.25,
  current: flipBooks[0]!,
  operationalOpening: { quote: openingQuote },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  evaluatedAt,
});
assert.equal(withMovement.marketEvidence?.movement.status, "available");
assert.ok((withMovement.marketEvidence?.movement.homeMarginShiftPoints ?? 0) > 0);
assert.ok((withMovement.marketEvidence?.movement.totalShiftPoints ?? 0) > 0);
assert.ok(withMovement.expectedHomeScore - withMovement.expectedAwayScore >
  marketOnly.expectedHomeScore - marketOnly.expectedAwayScore);
assert.ok(withMovement.expectedHomeScore + withMovement.expectedAwayScore >
  marketOnly.expectedHomeScore + marketOnly.expectedAwayScore);
const mismatchedOpening = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: weeklyBase,
  footballHomeMargin: 4.25,
  current: flipBooks[0]!,
  operationalOpening: { quote: { ...openingQuote, sportsbook: "draftkings" } },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  evaluatedAt,
});
assert.equal(mismatchedOpening.marketEvidence?.movement.status, "unavailable");
assert.equal(mismatchedOpening.expectedHomeScore.toFixed(9), marketOnly.expectedHomeScore.toFixed(9));
assert.equal(mismatchedOpening.expectedAwayScore.toFixed(9), marketOnly.expectedAwayScore.toFixed(9));
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

console.log("NFL actionable grade release: coherent-PMF identity, forecast flips, underdog value, exact-price grades, movement, weekly runtime, and publication boundaries passed");

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
