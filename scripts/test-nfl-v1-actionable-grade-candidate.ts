import assert from "node:assert/strict";
import type { NflPreviewBookOdds } from "../lib/services/football/balldontlieNflPreviewSlate";
import { NFL_PAID_PROJECTION_SHADOW_RELEASE } from "../lib/services/football/balldontlieNflWeeklyProjectionShadow";
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
  gradeNflV1SpreadTotalMarket,
  NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
  NFL_V1_EVENT_CONTAINED_SPREAD_MODEL_RELEASE,
  NFL_V1_MARKET_EVIDENCE_TOTAL_MODEL_RELEASE,
} from "../lib/services/football/nflV1ActionableGradeCandidate";
import { NFL_V1_PRODUCTION_MODEL_RELEASE } from "../lib/services/football/nflV1ProductionDecision";
import {
  buildNflPaidTeamScoreBaseForecast,
  buildNflMarketEvidenceOutcomeForecast,
  getNflV1WeekOneOutcomeForecast,
  NFL_V1_MARKET_EVIDENCE_OUTCOME_RELEASE,
  NFL_V1_MARKET_EVIDENCE_REPRESENTATIVE_SCORE_RELEASE,
  NFL_V1_PAID_TEAM_SCORE_MODEL_RELEASE,
  NFL_V1_MARKET_WEIGHT,
  NFL_V1_PUBLIC_SPLIT_MAX_SHIFT_POINTS,
  NFL_V1_RESIDUAL_HEAD_LOGIT_WEIGHT,
  NFL_V1_SHARP_SPLIT_MAX_SHIFT_POINTS,
  NFL_V1_WEAK_EVIDENCE_REVERSAL_MINIMUM_ADVANTAGE,
  resolveNflCrossMarketWinnerCoherence,
  NFL_V1_WEEKLY_OUTCOME_MODEL_RELEASE,
  NFL_V1_WEEKLY_RAW_MARGIN_MARKET_WEIGHT,
  NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE,
  NFL_V1_WEEKLY_REPRESENTATIVE_SCORE_CENTER_WEIGHT,
  nflV1WeekOneLineProbabilities,
} from "../lib/services/football/nflV1WeekOneOutcome";
import {
  NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE,
  resolveNflTargetExcludedMarketAnchor,
  resolveNflTargetExcludedProduction,
} from "../lib/services/football/nflTargetExcludedMarketOutcome";
import {
  NFL_NAMED_MARKET_SEQUENCE_RELEASE,
  type NflNamedMarketSequenceAuthority,
} from "../lib/services/football/nflNamedMarketSequence";

const providerGameId = "1392216";
const awayTeam = "NE";
const homeTeam = "SEA";
const gameStartsAt = "2026-09-10T00:20:00.000Z";
const evaluatedAt = "2026-08-25T11:21:34.519Z";

function namedSequenceAuthority(args: {
  moneylineSide?: "home" | "away" | null;
  spreadSide?: "home" | "away" | null;
}): NflNamedMarketSequenceAuthority {
  const metadata = {
    namedLeadCompletedAt: null,
    followerDelaysMinutes: [] as number[],
    resistance: "none" as const,
    sharpSplitSource: null,
    stateRelease: "nfl_market_state_2026_10_09_r1_truthful_signal_identity" as const,
    numberMoveSources: [] as string[],
    priceOnlyMoveSources: [] as string[],
  };
  const unavailable = {
    status: "unavailable" as const,
    side: null,
    reason: "insufficient_named_sources" as const,
    namedSources: [],
    followerSources: [],
    firstNamedMoveAt: null,
    ...metadata,
  };
  const read = (side: "home" | "away" | null) => side ? {
    status: "qualified" as const,
    side,
    reason: "named_lead_retail_follow" as const,
    namedSources: ["circa", "pinnacle"],
    followerSources: ["fanduel", "draftkings", "caesars"],
    firstNamedMoveAt: "2026-08-25T09:00:00.000Z",
    ...metadata,
  } : unavailable;
  return {
    release: NFL_NAMED_MARKET_SEQUENCE_RELEASE,
    evaluatedAt,
    moneylineSide: args.moneylineSide ?? null,
    spreadSide: args.spreadSide ?? null,
    totalSide: null,
    reads: {
      moneyline: read(args.moneylineSide ?? null),
      spread: read(args.spreadSide ?? null),
      total: { ...unavailable, reason: "not_validated_for_production" },
    },
  };
}
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
const targetExcludedAnchor = resolveNflTargetExcludedMarketAnchor({
  books: targetExcludedBooks,
  marginExcludedSportsbooks: ["fanduel", "draftkings"],
  totalExcludedSportsbooks: ["betmgm"],
  evaluatedAt,
});
assert.deepEqual(targetExcludedAnchor && {
  ...targetExcludedAnchor,
  spreadHomeFairProbability: undefined,
  totalOverFairProbability: undefined,
}, {
  release: NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE,
  homeMargin: 4,
  spreadHomeFairProbability: undefined,
  total: 44.5,
  totalOverFairProbability: undefined,
  marginFamilyCount: 4,
  totalFamilyCount: 5,
  marginExcludedSportsbooks: ["draftkings", "fanduel"],
  totalExcludedSportsbooks: ["betmgm"],
});
assert.ok(targetExcludedAnchor && targetExcludedAnchor.totalOverFairProbability > 0.48 &&
  targetExcludedAnchor.totalOverFairProbability < 0.51);
assert.ok(targetExcludedAnchor && targetExcludedAnchor.spreadHomeFairProbability > 0.49 &&
  targetExcludedAnchor.spreadHomeFairProbability < 0.52);
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
assert.equal(resolveNflTargetExcludedMarketAnchor({
  books: targetExcludedBooks,
  marginExcludedSportsbooks: [],
  totalExcludedSportsbooks: [],
  evaluatedAt,
  requireSameLineTotalPrices: true,
}), null, "priced-neutral totals require three target-excluded books at the exact consensus line");

const pricedNeutralBooks = comparableCurrentBooks.slice(0, 4).map((book) => ({
  ...book,
  total: { ...book.total!, line: 44.5 },
}));
const pricedNeutralAnchor = resolveNflTargetExcludedMarketAnchor({
  books: pricedNeutralBooks,
  marginExcludedSportsbooks: [],
  totalExcludedSportsbooks: [],
  evaluatedAt,
  requireSameLineTotalPrices: true,
});
assert.ok(pricedNeutralAnchor);
const pricedNeutralForecast = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: getNflV1WeekOneOutcomeForecast({
    providerGameId: "priced-neutral-test",
    awayTeam,
    homeTeam,
    weeklyFallback: { projectedHomeMargin: 3.5, marketTotal: 44.5 },
  }),
  footballHomeMargin: 3.5,
  current: pricedNeutralBooks[0]!,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  marketOverProbability: pricedNeutralAnchor.totalOverFairProbability,
  evaluatedAt,
});
const pricedNeutralProbability = nflV1WeekOneLineProbabilities({
  forecast: pricedNeutralForecast,
  homeSpread: pricedNeutralBooks[0]!.spread!.homeLine,
  totalLine: 44.5,
}).total.overProbability;
assert.ok(Math.abs(pricedNeutralProbability - pricedNeutralAnchor.totalOverFairProbability) < 0.000002);

const observedSequenceExclusions: Array<Record<"moneyline" | "spread" | "total", string[]>> = [];
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
  operationalOpening: {
    provenance: "provider_opening",
    capturedAt: "2026-08-25T09:21:34.519Z",
    quote: {
      ...targetExcludedBooks[0]!,
      observedAt: "2026-08-25T09:21:34.519Z",
      spread: { ...targetExcludedBooks[0]!.spread!, homeLine: -3, awayLine: 3 },
    },
  },
  shadowMoneyline: {
    ...shadow(),
    footballProjection: { openingHomeMargin: 3.5, independentCorrection: 0.75, projectedHomeMargin: 4.25 },
  },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  namedSequenceAuthorityFactory: (excludedFamiliesByMarket) => {
    observedSequenceExclusions.push(excludedFamiliesByMarket);
    return namedSequenceAuthority({});
  },
});
assert.equal(targetExcludedProduction.targetExclusion.status, "target_excluded_market");
assert.equal(targetExcludedProduction.production.evaluatedBets.length, 3);
assert.equal(targetExcludedProduction.outcome.marketEvidence?.spreadDirection?.status, "available");
assert.equal(targetExcludedProduction.outcome.marketEvidence?.spreadDirection?.side, "home");
for (const decision of targetExcludedProduction.production.evaluatedBets) {
  const family = decision.evaluatedQuote.sportsbook.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const excluded = decision.market === "total"
    ? targetExcludedProduction.targetExclusion.totalExcludedSportsbooks
    : targetExcludedProduction.targetExclusion.marginExcludedSportsbooks;
  assert.ok(excluded.includes(family), `final ${decision.market} target must be recorded as excluded`);
}
assert.ok(observedSequenceExclusions.length > 0, "named authority must be rebuilt inside target exclusion");
assert.ok(observedSequenceExclusions.every((value) =>
  value.moneyline.length > 0 && value.spread.length > 0 && value.total.length > 0 &&
  JSON.stringify(value.moneyline) === JSON.stringify(value.spread)),
"each evaluated target family must be removed from the corresponding sequence authority");
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
assert.equal(moneyline.grade, "No Play");
assert.equal(moneyline.side, "SEA");
assert.equal(moneyline.modelProbability, outcome.homeWinProbability);
assert.equal(moneyline.modelRelease, NFL_V1_PRODUCTION_MODEL_RELEASE);
assert.ok(moneyline.modelProbability > 0.5);
assert.equal(spread.modelRelease, NFL_V1_EVENT_CONTAINED_SPREAD_MODEL_RELEASE);
assert.equal(spread.grade, "Watchlist");
assert.equal(spread.modelProbability, reference.spread.awayCoverProbability);
assert.equal(total.modelRelease, NFL_V1_MARKET_EVIDENCE_TOTAL_MODEL_RELEASE);
assert.equal(total.grade, "Watchlist", "a Total without verified same-book direction must not be actionable");
assert.equal(total.side, "Over 44.5");
assert.equal(total.evaluatedQuote.sportsbook, "fanatics");
assert.equal(total.evaluatedQuote.price, -105);
assert.equal(total.modelProbability, reference.total.overProbability);
assert.ok(total.expectedValue > 0.15);
assert.ok(total.modelProbability > total.marketFairProbability);
assert.equal(candidate.evaluatedBets.every((decision) => decision.evaluatedAt === evaluatedAt), true);
assert.equal(candidate.evaluatedBets.every((decision) => decision.lockedAt === null), true);

const spreadGradeArgs = {
  market: "spread" as const,
  expectedValue: 0.05,
  edgePercentagePoints: 5,
  cushion: 2,
  penalty: 0,
  totalDirectionAvailable: false,
};
assert.equal(gradeNflV1SpreadTotalMarket({ ...spreadGradeArgs, probability: 0.5649 }), "Watchlist");
assert.equal(gradeNflV1SpreadTotalMarket({ ...spreadGradeArgs, probability: 0.565 }), "Lean");
assert.equal(gradeNflV1SpreadTotalMarket({ ...spreadGradeArgs, probability: 0.5899 }), "Lean");
assert.equal(gradeNflV1SpreadTotalMarket({ ...spreadGradeArgs, probability: 0.59 }), "Best Angle");

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
assert.equal(NFL_V1_WEEKLY_OUTCOME_MODEL_RELEASE, "nfl_v1_weekly_paid_team_score_2026_10_09_r15_provider_feed_continuity");
assert.equal(NFL_V1_MARKET_EVIDENCE_REPRESENTATIVE_SCORE_RELEASE, "nfl_v1_market_evidence_representative_score_2026_10_09_r14_provider_feed_continuity");
assert.equal(NFL_V1_WEEKLY_REPRESENTATIVE_SCORE_CENTER_WEIGHT, 0.2);
const representativeMargin = weeklyBase.representativeHomeScore - weeklyBase.representativeAwayScore;
const representativeTotal = weeklyBase.representativeHomeScore + weeklyBase.representativeAwayScore;
const marginIndex = weeklyBase.marginDistribution.values.indexOf(representativeMargin);
const totalIndex = weeklyBase.totalDistribution.values.indexOf(representativeTotal);
assert.ok(marginIndex >= 0 && totalIndex >= 0, "the displayed score must be supported by both released marginal distributions");
assert.ok((weeklyBase.marginDistribution.probabilities[marginIndex] ?? 0) > 0);
assert.ok((weeklyBase.totalDistribution.probabilities[totalIndex] ?? 0) > 0);
assert.ok(Math.abs(weeklyBase.representativeScoreProbability -
  (weeklyBase.marginDistribution.probabilities[marginIndex] ?? 0) *
  (weeklyBase.totalDistribution.probabilities[totalIndex] ?? 0)) < 1e-15);
assert.equal(
  weeklyBase.representativeHomeScore > weeklyBase.representativeAwayScore,
  weeklyBase.homeWinProbability > weeklyBase.awayWinProbability,
  "the marginal-likelihood score must preserve the released winner",
);
const closeScoreCandidate = getNflV1WeekOneOutcomeForecast({
  providerGameId: "marginal-likelihood-close-score-test",
  awayTeam,
  homeTeam,
  weeklyFallback: { projectedHomeMargin: -2.5, marketTotal: 35.5 },
});
assert.deepEqual(
  [closeScoreCandidate.representativeAwayScore, closeScoreCandidate.representativeHomeScore],
  [19, 16],
  "the selected supported football score must replace the independently rounded 19-17 mean summary",
);
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
assert.equal(NFL_V1_MARKET_EVIDENCE_OUTCOME_RELEASE, "nfl_v1_market_evidence_outcome_2026_10_09_r15_provider_feed_continuity");
assert.equal(NFL_V1_MARKET_WEIGHT, 0.75);
assert.equal(NFL_V1_SHARP_SPLIT_MAX_SHIFT_POINTS, 1.5);
assert.equal(NFL_V1_PUBLIC_SPLIT_MAX_SHIFT_POINTS, 0.75);
assert.equal(NFL_V1_RESIDUAL_HEAD_LOGIT_WEIGHT, 0.5);
assert.equal(NFL_V1_WEAK_EVIDENCE_REVERSAL_MINIMUM_ADVANTAGE, 0.025);
assert.ok(marketOnly.homeWinProbability > marketOnly.awayWinProbability);
assert.equal(marketOnly.marketEvidence?.combinedHomeMarginShiftPoints, 0);
assert.equal(marketOnly.marketEvidence?.combinedTotalShiftPoints, 0);
assert.ok(circaAway.homeWinProbability > circaAway.awayWinProbability);
assert.ok(
  Math.abs(
    (circaAway.expectedHomeScore - circaAway.expectedAwayScore) -
    (marketOnly.expectedHomeScore - marketOnly.expectedAwayScore)
  ) < 0.1,
  "an uncorroborated winner reversal must return to the independent calibrated margin",
);
assert.ok(
  circaAway.marketEvidence?.winnerCoherence?.status === "rejected",
  "a split-only margin signal must not silently replace the independent Moneyline winner",
);
const rejectedWinnerFlip = resolveNflCrossMarketWinnerCoherence({
  independentHomeMargin: 2.5,
  proposedHomeMargin: -3.5,
  moneylineHomeFairProbabilityDeltaPp: -2,
  publicMoneylineGapPp: -5,
  sharpMoneylineGapPp: null,
});
assert.equal(rejectedWinnerFlip.status, "rejected");
assert.equal(rejectedWinnerFlip.finalHomeMargin, 2.5);
const authorizedWinnerFlip = resolveNflCrossMarketWinnerCoherence({
  independentHomeMargin: 2.5,
  proposedHomeMargin: -3.5,
  moneylineHomeFairProbabilityDeltaPp: -2,
  publicMoneylineGapPp: -9,
  sharpMoneylineGapPp: null,
});
assert.equal(authorizedWinnerFlip.status, "authorized");
assert.equal(authorizedWinnerFlip.finalHomeMargin, -3.5);
const vetoedWinnerFlip = resolveNflCrossMarketWinnerCoherence({
  independentHomeMargin: 2.5,
  proposedHomeMargin: -3.5,
  moneylineHomeFairProbabilityDeltaPp: -2,
  publicMoneylineGapPp: -9,
  sharpMoneylineGapPp: 12,
});
assert.equal(vetoedWinnerFlip.status, "rejected");
assert.equal(vetoedWinnerFlip.sharpVeto, true);
const sequenceAuthorizedWinnerFlip = resolveNflCrossMarketWinnerCoherence({
  independentHomeMargin: 2.5,
  proposedHomeMargin: -3.5,
  moneylineHomeFairProbabilityDeltaPp: null,
  publicMoneylineGapPp: null,
  sharpMoneylineGapPp: null,
  namedSequenceCrossMarketConfirmed: true,
});
assert.equal(sequenceAuthorizedWinnerFlip.status, "authorized");
assert.equal(sequenceAuthorizedWinnerFlip.finalHomeMargin, -3.5);
const sequenceVetoedWinnerFlip = resolveNflCrossMarketWinnerCoherence({
  independentHomeMargin: 2.5,
  proposedHomeMargin: -3.5,
  moneylineHomeFairProbabilityDeltaPp: null,
  publicMoneylineGapPp: null,
  sharpMoneylineGapPp: 12,
  namedSequenceCrossMarketConfirmed: true,
});
assert.equal(sequenceVetoedWinnerFlip.status, "rejected", "opposing fresh sharp flow remains a winner-flip veto");
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
  shadowMoneyline: {
    ...shadow(),
    providerGameId: "market-side-reselection-test",
    grade: "Held",
    reason: "exact_price_does_not_clear_candidate_thresholds",
  },
  outcomeForecast: marketOnly,
});
const circaAwayBundle = buildNflV1ActionableGradeBundle({
  providerGameId: "market-side-reselection-test",
  awayTeam,
  homeTeam,
  gameStartsAt,
  current: flipBooks[0]!,
  comparableCurrentBooks: flipBooks,
  shadowMoneyline: {
    ...shadow(),
    providerGameId: "market-side-reselection-test",
    grade: "Held",
    reason: "exact_price_does_not_clear_candidate_thresholds",
  },
  outcomeForecast: circaAway,
});
assert.equal(marketOnlyBundle.evaluatedBets.find((decision) => decision.market === "spread")?.side, homeTeam);
assert.equal(marketOnlyBundle.outcomeConfidence.find((decision) => decision.market === "moneyline")?.likelySide, homeTeam);
assert.equal(marketOnlyBundle.evaluatedBets.find((decision) => decision.market === "moneyline")?.side, homeTeam);
assert.ok(marketOnlyBundle.evaluatedBets.find((decision) => decision.market === "moneyline")!.modelProbability > 0.5);
assert.ok(["Best Angle", "Lean", "Watchlist", "No Play"].includes(
  marketOnlyBundle.evaluatedBets.find((decision) => decision.market === "moneyline")!.grade,
));
assert.equal(circaAwayBundle.evaluatedBets.find((decision) => decision.market === "moneyline")?.side, homeTeam);
assert.equal(circaAwayBundle.outcomeConfidence.find((decision) => decision.market === "moneyline")?.likelySide, homeTeam);
assert.ok(circaAway.expectedHomeScore > circaAway.expectedAwayScore);
assert.ok(circaAway.homeWinProbability > 0.5);
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
const weeklyRawSignal = {
  release: NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE,
  independentHomeMargin: -6,
  directionHomeCoverProbability: 0.55,
  directionHomeMarginCorrection: 1,
};
const rawSignalBaseline = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: weeklyBase,
  footballHomeMargin: 4.25,
  current,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  weeklyRawSignal,
  evaluatedAt,
});
const rawSignalWithSplits = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: weeklyBase,
  footballHomeMargin: 4.25,
  current,
  playbookLine: { capturedAt: evaluatedAt, homeSpread: -3.5, total: 44.5 },
  playbookSplits: splitSet({ homeMoneyPct: 80, homeBetsPct: 20 }),
  sharpSplits: sharpSplitSet({ homeMoneyPct: 80, homeBetsPct: 20 }),
  weeklyRawSignal,
  evaluatedAt,
});
const rawSignalWithMovement = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: weeklyBase,
  footballHomeMargin: 4.25,
  current,
  operationalOpening: {
    quote: {
      ...current,
      observedAt: "2026-08-25T09:21:34.519Z",
      total: { ...current.total!, line: 42.5 },
    },
  },
  movementCurrent: current,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  weeklyRawSignal,
  evaluatedAt,
});
assert.equal(NFL_V1_WEEKLY_RAW_MARGIN_MARKET_WEIGHT, 0.9);
assert.equal(rawSignalBaseline.marketEvidence?.weeklyRawSignal?.release, NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE);
assert.equal(rawSignalBaseline.marketEvidence?.weeklyRawSignal?.independentHomeMargin, -6);
assert.equal(rawSignalBaseline.marketEvidence?.weeklyRawSignal?.directionHomeCoverProbability, 0.55);
assert.equal(rawSignalBaseline.marketEvidence?.weeklyRawSignal?.directionHomeMarginCorrection, 1);
assert.equal(rawSignalBaseline.marketEvidence?.weeklyRawSignal?.totalMeanEvidencePolicy, "same_book_movement_only");
assert.equal(
  (rawSignalWithSplits.expectedHomeScore + rawSignalWithSplits.expectedAwayScore).toFixed(9),
  (rawSignalBaseline.expectedHomeScore + rawSignalBaseline.expectedAwayScore).toFixed(9),
  "money/ticket splits must not rewrite the released raw Total mean",
);
assert.ok(
  rawSignalWithMovement.expectedHomeScore + rawSignalWithMovement.expectedAwayScore >
    rawSignalBaseline.expectedHomeScore + rawSignalBaseline.expectedAwayScore,
  "eligible same-book Total movement must remain available after target-free anchoring",
);
assert.throws(() => buildNflMarketEvidenceOutcomeForecast({
  baseForecast: weeklyBase,
  footballHomeMargin: 4.25,
  current,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  weeklyRawSignal: { ...weeklyRawSignal, independentHomeMargin: Number.NaN },
  evaluatedAt,
}), /weekly raw-signal margin is invalid/);
const paidTeamScore = {
  release: NFL_PAID_PROJECTION_SHADOW_RELEASE,
  providerGameId: weeklyBase.providerGameId,
  awayTeam,
  homeTeam,
  providerCollectedAt: "2026-08-25T10:00:00.000Z",
  projectedHomeMargin: 6,
  projectedTotal: 44,
};
const paidBase = buildNflPaidTeamScoreBaseForecast({ baseForecast: weeklyBase, paidTeamScore });
assert.ok(Math.abs(paidBase.expectedAwayScore - 19) < 0.1);
assert.ok(Math.abs(paidBase.expectedHomeScore - 25) < 0.1);
const paidMarriage = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: paidBase,
  footballHomeMargin: 4.25,
  current,
  operationalOpening: {
    quote: {
      ...current,
      observedAt: "2026-08-25T09:00:00.000Z",
      spread: { ...current.spread!, awayLine: 1.5, homeLine: -1.5 },
      total: { ...current.total!, line: 42.5 },
    },
  },
  movementCurrent: current,
  playbookLine: { capturedAt: evaluatedAt, homeSpread: -3.5, total: 44.5 },
  playbookSplits: splitSet({ homeMoneyPct: 80, homeBetsPct: 20 }),
  sharpSplits: sharpSplitSet({ homeMoneyPct: 80, homeBetsPct: 20 }),
  spreadDirectionCandidate: true,
  paidTeamScore,
  evaluatedAt,
});
assert.equal(paidMarriage.marketEvidence?.paidTeamScore?.release, NFL_V1_PAID_TEAM_SCORE_MODEL_RELEASE);
assert.equal(paidMarriage.marketEvidence?.paidTeamScore?.inputRelease, NFL_PAID_PROJECTION_SHADOW_RELEASE);
assert.equal(paidMarriage.marketEvidence?.paidTeamScore?.totalEvidencePolicy,
  "verified_same_book_direction_from_independent_score");
assert.ok(
  paidMarriage.expectedHomeScore - paidMarriage.expectedAwayScore >
    paidBase.expectedHomeScore - paidBase.expectedAwayScore,
  "verified same-book movement and corroborating fresh margin evidence must adjust the paid score coherently",
);
assert.ok(Math.abs(paidMarriage.expectedHomeScore + paidMarriage.expectedAwayScore - 44) < 0.1,
  "failed Total movement/split evidence must not overwrite the paid independent Total center");
assert.equal(paidMarriage.homeWinProbability > 0.5,
  paidMarriage.expectedHomeScore > paidMarriage.expectedAwayScore);

const paidNamedSequenceAway = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: paidBase,
  footballHomeMargin: 4.25,
  current,
  operationalOpening: {
    quote: {
      ...current,
      observedAt: "2026-08-25T09:00:00.000Z",
      spread: { ...current.spread!, awayLine: 1.5, homeLine: -1.5 },
    },
  },
  movementCurrent: current,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  spreadDirectionCandidate: true,
  totalDirectionCandidate: true,
  paidTeamScore,
  namedSequenceAuthority: namedSequenceAuthority({ spreadSide: "away" }),
  evaluatedAt,
});
const paidNamedSequenceMargin = paidNamedSequenceAway.expectedHomeScore - paidNamedSequenceAway.expectedAwayScore;
assert.equal(paidNamedSequenceAway.marketEvidence?.namedSequence?.release, NFL_NAMED_MARKET_SEQUENCE_RELEASE);
assert.equal(paidNamedSequenceAway.marketEvidence?.spreadDirection?.reason, "named_sequence_away");
assert.ok(paidNamedSequenceMargin < -current.spread!.homeLine,
  "qualified named sequence must move the projected score across the current Spread");
assert.ok(paidNamedSequenceMargin > 0,
  "Spread-only sequence evidence must preserve the independent outright winner");
assert.ok(Math.abs(paidNamedSequenceAway.expectedHomeScore + paidNamedSequenceAway.expectedAwayScore - 44) < 0.1,
  "a Spread sequence correction must preserve the independent Total");

const paidTotalMoveOver = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: paidBase,
  footballHomeMargin: 4.25,
  current,
  operationalOpening: {
    quote: {
      ...current,
      observedAt: "2026-08-25T09:00:00.000Z",
      total: { ...current.total!, line: 43.5 },
    },
  },
  movementCurrent: current,
  playbookLine: { capturedAt: evaluatedAt, homeSpread: -3.5, total: 44.5 },
  playbookSplits: splitSet({ homeMoneyPct: 50, homeBetsPct: 50 }),
  sharpSplits: sharpSplitSet({ homeMoneyPct: 50, homeBetsPct: 50 }),
  spreadDirectionCandidate: true,
  totalDirectionCandidate: true,
  paidTeamScore,
  evaluatedAt,
});
assert.equal(paidTotalMoveOver.marketEvidence?.totalDirection?.status, "available");
assert.equal(paidTotalMoveOver.marketEvidence?.totalDirection?.side, "over");
assert.ok(paidTotalMoveOver.expectedHomeScore + paidTotalMoveOver.expectedAwayScore > 44.5,
  "verified upward Total movement must be able to flip an independent Under into an Over");
assert.ok(
  !Number.isInteger(paidTotalMoveOver.expectedAwayScore * 2) ||
    !Number.isInteger(paidTotalMoveOver.expectedHomeScore * 2),
  "market-married expected scores must remain continuous rather than quantized to whole or half points",
);
assert.ok(nflV1WeekOneLineProbabilities({
  forecast: paidTotalMoveOver,
  homeSpread: current.spread!.homeLine,
  totalLine: current.total!.line,
}).total.overProbability > 0.5);

const paidOverTeamScore = { ...paidTeamScore, projectedTotal: 46 };
const paidOverBase = buildNflPaidTeamScoreBaseForecast({
  baseForecast: weeklyBase,
  paidTeamScore: paidOverTeamScore,
});
const paidTotalMoveUnder = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: paidOverBase,
  footballHomeMargin: 4.25,
  current,
  operationalOpening: {
    quote: {
      ...current,
      observedAt: "2026-08-25T09:00:00.000Z",
      total: { ...current.total!, line: 45.5 },
    },
  },
  movementCurrent: current,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  spreadDirectionCandidate: true,
  totalDirectionCandidate: true,
  paidTeamScore: paidOverTeamScore,
  evaluatedAt,
});
assert.equal(paidTotalMoveUnder.marketEvidence?.totalDirection?.status, "available");
assert.equal(paidTotalMoveUnder.marketEvidence?.totalDirection?.side, "under");
assert.ok(paidTotalMoveUnder.expectedHomeScore + paidTotalMoveUnder.expectedAwayScore < 44.5,
  "verified downward Total movement must be able to flip an independent Over into an Under");
assert.ok(nflV1WeekOneLineProbabilities({
  forecast: paidTotalMoveUnder,
  homeSpread: current.spread!.homeLine,
  totalLine: current.total!.line,
}).total.underProbability > 0.5);

const paidTotalFlat = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: paidOverBase,
  footballHomeMargin: 4.25,
  current,
  operationalOpening: {
    quote: { ...current, observedAt: "2026-08-25T09:00:00.000Z" },
  },
  movementCurrent: current,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  spreadDirectionCandidate: true,
  totalDirectionCandidate: true,
  paidTeamScore: paidOverTeamScore,
  evaluatedAt,
});
assert.equal(paidTotalFlat.marketEvidence?.totalDirection?.status, "unavailable");
assert.ok(Math.abs(paidTotalFlat.expectedHomeScore + paidTotalFlat.expectedAwayScore - 46) < 0.1,
  "missing or flat Total movement must leave the independent paid Total center intact");
assert.ok(Math.abs(paidOverBase.expectedHomeScore + paidOverBase.expectedAwayScore - 46) < 0.1,
  "opposing market replays must always recompute from the immutable independent base");

const favorableTotalBooks = comparableCurrentBooks.map((book) => ({
  ...book,
  total: { ...book.total!, line: 44.5, overPrice: -140, underPrice: 120 },
}));
const unfavorableTotalBooks = comparableCurrentBooks.map((book) => ({
  ...book,
  total: { ...book.total!, line: 44.5, overPrice: 160, underPrice: -180 },
}));
const favorableTotalBundle = buildNflV1ActionableGradeBundle({
  providerGameId,
  awayTeam,
  homeTeam,
  gameStartsAt,
  current: favorableTotalBooks[0]!,
  comparableCurrentBooks: favorableTotalBooks,
  shadowMoneyline: shadow(),
  outcomeForecast: paidTotalMoveUnder,
});
const unfavorableTotalBundle = buildNflV1ActionableGradeBundle({
  providerGameId,
  awayTeam,
  homeTeam,
  gameStartsAt,
  current: unfavorableTotalBooks[0]!,
  comparableCurrentBooks: unfavorableTotalBooks,
  shadowMoneyline: shadow(),
  outcomeForecast: paidTotalMoveUnder,
});
const favorableTotalDecision = favorableTotalBundle.evaluatedBets.find((decision) => decision.market === "total")!;
const unfavorableTotalDecision = unfavorableTotalBundle.evaluatedBets.find((decision) => decision.market === "total")!;
assert.equal(favorableTotalDecision.side, unfavorableTotalDecision.side);
assert.equal(favorableTotalDecision.modelProbability, unfavorableTotalDecision.modelProbability);
assert.equal(favorableTotalDecision.side, "Under 44.5");
assert.notEqual(favorableTotalDecision.grade, unfavorableTotalDecision.grade,
  "price-aware play grades may change only after the forecast side and probability are frozen");
assert.equal(paidTotalMoveUnder.expectedHomeScore + paidTotalMoveUnder.expectedAwayScore,
  paidTotalMoveUnder.expectedHomeScore + paidTotalMoveUnder.expectedAwayScore,
  "play-grade evaluation must not mutate the released score forecast");
assert.throws(() => buildNflMarketEvidenceOutcomeForecast({
  baseForecast: paidBase,
  footballHomeMargin: 4.25,
  current,
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  weeklyRawSignal,
  paidTeamScore,
  evaluatedAt,
}), /cannot both own the score center/);
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
  shadowMoneyline: {
    ...shadow(),
    providerGameId: "market-side-reselection-test",
    grade: "Held",
    reason: "exact_price_does_not_clear_candidate_thresholds",
  },
  outcomeForecast: underdogValueForecast,
});
const underdogValueMoneyline = underdogValueBundle.evaluatedBets.find((decision) => decision.market === "moneyline")!;
assert.equal(underdogValueBundle.outcomeConfidence.find((decision) => decision.market === "moneyline")?.likelySide, homeTeam);
assert.ok(underdogValueForecast.expectedHomeScore > underdogValueForecast.expectedAwayScore);
assert.equal(underdogValueMoneyline.side, homeTeam);
assert.equal(underdogValueMoneyline.modelProbability, 0.54);
assert.equal(underdogValueMoneyline.grade, "No Play");
assert.ok(underdogValueMoneyline.expectedValue < 0);
assert.ok(underdogValueMoneyline.modelProbability < underdogValueMoneyline.marketFairProbability);
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
  shadowMoneyline: {
    ...shadow(),
    providerGameId: "market-side-reselection-test",
    grade: "Held",
    reason: "exact_price_does_not_clear_candidate_thresholds",
  },
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
const directionCandidate = buildNflMarketEvidenceOutcomeForecast({
  baseForecast: weeklyBase,
  footballHomeMargin: 4.25,
  current: flipBooks[0]!,
  operationalOpening: {
    quote: {
      ...flipBooks[0]!,
      observedAt: "2026-08-25T09:21:34.519Z",
      spread: { ...flipBooks[0]!.spread!, awayLine: -0, homeLine: 0 },
    },
  },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
  marketHomeCoverProbability: 0.49,
  spreadDirectionCandidate: true,
  evaluatedAt,
});
const directionProbability = nflV1WeekOneLineProbabilities({
  forecast: directionCandidate,
  homeSpread: flipBooks[0]!.spread!.homeLine,
  totalLine: flipBooks[0]!.total!.line,
}).spread;
assert.equal(directionCandidate.marketEvidence?.spreadDirection?.status, "available");
assert.equal(directionCandidate.marketEvidence?.spreadDirection?.reason, "move_away");
assert.equal(directionCandidate.marketEvidence?.winnerCoherence?.status, "rejected");
assert.ok(directionProbability.homeCoverProbability > directionProbability.awayCoverProbability);
assert.ok(directionCandidate.expectedHomeScore > directionCandidate.expectedAwayScore,
  "Spread-only movement must not replace the independent Moneyline winner");
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
