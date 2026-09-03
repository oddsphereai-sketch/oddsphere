import artifactJson from "./modelArtifacts/nflV1WeekOneOutcome.json";
import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import {
  applyNflV1LogitCorrection,
  getNflV1ActionableGradeCorrection,
  hasNflV1ActionableGradeCorrection,
} from "./nflV1ActionableGradeCorrections";
import {
  combineFootballOutcomeEvidenceShift,
  readFootballOutcomeMarketMovement,
  type FootballOutcomeMarketMovement,
} from "./footballOutcomeMarketMovement";

export const NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE =
  "nfl_v1_week_one_outcome_artifact_2026_08_23_r2_discrete_joint" as const;
export const NFL_V1_OUTCOME_MODEL_RELEASE =
  "nfl_v1_discrete_drive_outcome_2026_08_23_r2" as const;
export const NFL_V1_OUTCOME_DISTRIBUTION_RELEASE =
  "nfl_discrete_drive_score_distribution_2026_08_23_r5" as const;
export const NFL_V1_OUTCOME_PROBABILITY_RELEASE =
  "nfl_v1_discrete_joint_probability_2026_08_23_r2" as const;
export const NFL_V1_REPRESENTATIVE_SCORE_POLICY_RELEASE =
  "nfl_v1_representative_score_2026_08_23_r2" as const;
export const NFL_V1_WEEKLY_OUTCOME_MODEL_RELEASE =
  "nfl_v1_weekly_market_anchored_outcome_2026_09_03_r3_target_excluded_forecast" as const;
export const NFL_V1_WEEKLY_OUTCOME_DISTRIBUTION_RELEASE =
  "nfl_pooled_discrete_residual_distribution_2026_09_03_r3_target_excluded_forecast" as const;
export const NFL_V1_WEEKLY_OUTCOME_PROBABILITY_RELEASE =
  "nfl_v1_weekly_pooled_discrete_probability_2026_09_03_r3_target_excluded_forecast" as const;
export const NFL_V1_MARKET_EVIDENCE_OUTCOME_RELEASE =
  "nfl_v1_market_evidence_outcome_2026_09_03_r3_target_excluded_forecast" as const;
export const NFL_V1_MARKET_EVIDENCE_REPRESENTATIVE_SCORE_RELEASE =
  "nfl_v1_market_evidence_representative_score_2026_09_03_r2_target_excluded_forecast" as const;
export const NFL_V1_MARKET_WEIGHT = 0.75 as const;
export const NFL_V1_SHARP_SPLIT_MAX_SHIFT_POINTS = 1.5 as const;
export const NFL_V1_PUBLIC_SPLIT_MAX_SHIFT_POINTS = 0.75 as const;
export const NFL_V1_RESIDUAL_HEAD_LOGIT_WEIGHT = 0.5 as const;
export const NFL_V1_WEAK_EVIDENCE_REVERSAL_MINIMUM_ADVANTAGE = 0.025 as const;

type DiscreteDistribution = {
  values: number[];
  probabilities: number[];
};

export type NflV1WeekOneOutcomeForecast = {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  expectedAwayScore: number;
  expectedHomeScore: number;
  representativeAwayScore: number;
  representativeHomeScore: number;
  representativeScoreProbability: number;
  awayWinProbability: number;
  homeWinProbability: number;
  tieProbability: number;
  marginDistribution: DiscreteDistribution;
  totalDistribution: DiscreteDistribution;
  sourceExpectedAwayScore: number;
  sourceExpectedHomeScore: number;
  targetExclusion?: {
    release: "nfl_target_excluded_market_outcome_2026_09_03_r1";
    status: "target_excluded_market" | "incumbent_fallback";
    reason: "stable_complete_tuple" | "insufficient_or_unstable_target_free_evidence";
    marginFamilyCount: number | null;
    totalFamilyCount: number | null;
    marginExcludedSportsbooks: string[];
    totalExcludedSportsbooks: string[];
  };
  marketEvidence?: {
    release: typeof NFL_V1_MARKET_EVIDENCE_OUTCOME_RELEASE;
    representativeScoreRelease: typeof NFL_V1_MARKET_EVIDENCE_REPRESENTATIVE_SCORE_RELEASE;
    marketWeight: typeof NFL_V1_MARKET_WEIGHT;
    sharp: { homeMarginGapPp: number | null; overTotalGapPp: number | null; homeMarginShiftPoints: number; totalShiftPoints: number };
    publicConsensus: { homeMarginGapPp: number | null; overTotalGapPp: number | null; homeMarginShiftPoints: number; totalShiftPoints: number };
    movement: FootballOutcomeMarketMovement;
    calibratedCore: {
      source: "week_one_spread_total_residual_heads" | null;
      rawHomeCoverProbability: number;
      calibratedHomeCoverProbability: number;
      rawOverProbability: number;
      calibratedOverProbability: number;
      calibratedHomeMargin: number;
      calibratedTotal: number;
    };
    combinedHomeMarginShiftPoints: number;
    combinedTotalShiftPoints: number;
    appliedHomeMarginShiftPoints: number;
    appliedTotalShiftPoints: number;
    weakHomeMarginReversalRejected: boolean;
    weakTotalReversalRejected: boolean;
  };
};

type Artifact = {
  artifactRelease: string;
  modelRelease: string;
  distributionRelease: string;
  probabilityRelease: string;
  representativeScorePolicyRelease: string;
  tournamentRelease: string;
  source: {
    featureRelease: string;
    featureSha256: string;
    forwardEvidenceRelease: string;
    forwardEvidenceSha256: string;
    pbpManifestSha256: string;
    r10ReportSha256: string;
  };
  games: NflV1WeekOneOutcomeForecast[];
};

const artifact = artifactJson as Artifact;
validateArtifact(artifact);
const forecasts = new Map(
  artifact.games.map((game) => [game.providerGameId, Object.freeze({ ...game })] as const),
);

export function getNflV1WeekOneOutcomeForecast(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  /**
   * Later-week runtime fallback. The current market-led Moneyline model owns
   * the home-margin anchor and the coherent current Total owns the points
   * anchor; the frozen Week 1 PMFs supply only centered residual shape.
   */
  weeklyFallback?: { projectedHomeMargin: number; marketTotal: number };
}): NflV1WeekOneOutcomeForecast {
  const forecast = forecasts.get(args.providerGameId);
  if (!forecast) {
    if (!args.weeklyFallback) throw new Error(`NFL v1 outcome forecast is missing game ${args.providerGameId}.`);
    return buildWeeklyOutcomeForecast({ ...args, ...args.weeklyFallback });
  }
  if (forecast.awayTeam !== normalizeTeam(args.awayTeam) || forecast.homeTeam !== normalizeTeam(args.homeTeam)) {
    throw new Error(
      `NFL v1 outcome identity mismatch for ${args.providerGameId}: ` +
      `${forecast.awayTeam}@${forecast.homeTeam} versus ${args.awayTeam}@${args.homeTeam}.`,
    );
  }
  return forecast;
}

export function hasNflV1WeekOneOutcomeForecast(providerGameId: string): boolean {
  return forecasts.has(providerGameId);
}

type SplitPercentages = {
  capturedAt: string;
  homeMoneyPct: number | null; homeBetsPct: number | null;
  overMoneyPct: number | null; overBetsPct: number | null;
};
type SharpSplitPercentages = SplitPercentages & {
  sourceSportsbook: string | null;
  providerFetchedAt: string | null;
};

export function buildNflMarketEvidenceOutcomeForecast(args: {
  baseForecast: NflV1WeekOneOutcomeForecast;
  footballHomeMargin: number;
  current: NflPreviewBookOdds;
  operationalOpening?: { quote: NflPreviewBookOdds } | null;
  playbookLine: { capturedAt: string; homeSpread: number | null; total: number | null } | null;
  playbookSplits: { spread: SplitPercentages; moneyline: SplitPercentages; total: SplitPercentages } | null;
  sharpSplits: { spread: SharpSplitPercentages; moneyline: SharpSplitPercentages; total: SharpSplitPercentages } | null;
  evaluatedAt: string;
}): NflV1WeekOneOutcomeForecast {
  if (!args.current.spread || !args.current.total) return args.baseForecast;
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL market-evidence evaluatedAt is invalid.");
  const baseTotal = args.baseForecast.expectedAwayScore + args.baseForecast.expectedHomeScore;
  const rawTargetMargin = (1 - NFL_V1_MARKET_WEIGHT) * args.footballHomeMargin
    + NFL_V1_MARKET_WEIGHT * -args.current.spread.homeLine;
  const rawTargetTotal = (1 - NFL_V1_MARKET_WEIGHT) * baseTotal
    + NFL_V1_MARKET_WEIGHT * args.current.total.line;
  const sharpMarginGap = firstFinite(
    freshCircaGap(args.sharpSplits?.spread, "home", evaluatedAt),
    freshCircaGap(args.sharpSplits?.moneyline, "home", evaluatedAt),
  );
  const sharpTotalGap = freshCircaGap(args.sharpSplits?.total, "over", evaluatedAt);
  const publicMarginGap = playbookLineMatches(args.playbookLine?.homeSpread, args.current.spread.homeLine)
    ? firstFinite(
        freshPublicGap(args.playbookSplits?.spread, "home", evaluatedAt),
        freshPublicGap(args.playbookSplits?.moneyline, "home", evaluatedAt),
      )
    : null;
  const publicTotalGap = playbookLineMatches(args.playbookLine?.total, args.current.total.line)
    ? freshPublicGap(args.playbookSplits?.total, "over", evaluatedAt)
    : null;
  const movement = readFootballOutcomeMarketMovement({
    opening: args.operationalOpening?.quote ?? null,
    current: args.current,
    evaluatedAt: args.evaluatedAt,
  });
  const sharpHomeMarginShiftPoints = splitShift(sharpMarginGap, 10, 20, NFL_V1_SHARP_SPLIT_MAX_SHIFT_POINTS);
  const sharpTotalShiftPoints = splitShift(sharpTotalGap, 10, 20, NFL_V1_SHARP_SPLIT_MAX_SHIFT_POINTS);
  const publicHomeMarginShiftPoints = splitShift(publicMarginGap, 8, 20, NFL_V1_PUBLIC_SPLIT_MAX_SHIFT_POINTS);
  const publicTotalShiftPoints = splitShift(publicTotalGap, 8, 20, NFL_V1_PUBLIC_SPLIT_MAX_SHIFT_POINTS);
  const combinedHomeMarginShiftPoints = combineFootballOutcomeEvidenceShift({
    sharpShift: sharpHomeMarginShiftPoints,
    movementShift: movement.homeMarginShiftPoints,
    publicShift: publicHomeMarginShiftPoints,
    maximum: NFL_V1_SHARP_SPLIT_MAX_SHIFT_POINTS,
  });
  const combinedTotalShiftPoints = combineFootballOutcomeEvidenceShift({
    sharpShift: sharpTotalShiftPoints,
    movementShift: movement.totalShiftPoints,
    publicShift: publicTotalShiftPoints,
    maximum: NFL_V1_SHARP_SPLIT_MAX_SHIFT_POINTS,
  });
  const rawMarginDistribution = shiftedDistribution(args.baseForecast.marginDistribution, rawTargetMargin, false);
  const rawTotalDistribution = shiftedDistribution(args.baseForecast.totalDistribution, rawTargetTotal, true);
  const rawHomeCoverProbability = distributionSideProbability(
    rawMarginDistribution,
    (margin) => margin + args.current.spread!.homeLine,
  );
  const rawOverProbability = distributionSideProbability(
    rawTotalDistribution,
    (points) => points - args.current.total!.line,
  );
  const correction = hasNflV1ActionableGradeCorrection(args.baseForecast.providerGameId)
    ? getNflV1ActionableGradeCorrection({
        providerGameId: args.baseForecast.providerGameId,
        awayTeam: args.baseForecast.awayTeam,
        homeTeam: args.baseForecast.homeTeam,
      })
    : null;
  const calibratedHomeCoverProbability = correction
    ? applyNflV1LogitCorrection(
        rawHomeCoverProbability,
        NFL_V1_RESIDUAL_HEAD_LOGIT_WEIGHT * correction.spreadHomeLogitCorrection,
      )
    : rawHomeCoverProbability;
  const calibratedOverProbability = correction
    ? applyNflV1LogitCorrection(
        rawOverProbability,
        NFL_V1_RESIDUAL_HEAD_LOGIT_WEIGHT * correction.totalOverLogitCorrection,
      )
    : rawOverProbability;
  const calibratedHomeMargin = correction
    ? meanForSideProbability({
        source: args.baseForecast.marginDistribution,
        initialMean: rawTargetMargin,
        targetProbability: calibratedHomeCoverProbability,
        score: (margin) => margin + args.current.spread!.homeLine,
        nonNegative: false,
      })
    : rawTargetMargin;
  const calibratedTotal = correction
    ? meanForSideProbability({
        source: args.baseForecast.totalDistribution,
        initialMean: rawTargetTotal,
        targetProbability: calibratedOverProbability,
        score: (points) => points - args.current.total!.line,
        nonNegative: true,
      })
    : rawTargetTotal;
  const guardedMargin = guardWeakEvidenceReversal({
    source: args.baseForecast.marginDistribution,
    calibratedMean: calibratedHomeMargin,
    proposedMean: calibratedHomeMargin + combinedHomeMarginShiftPoints,
    score: (margin) => margin + args.current.spread!.homeLine,
    nonNegative: false,
    sharpShift: sharpHomeMarginShiftPoints,
    movementShift: movement.homeMarginShiftPoints,
    publicShift: publicHomeMarginShiftPoints,
  });
  const guardedTotal = guardWeakEvidenceReversal({
    source: args.baseForecast.totalDistribution,
    calibratedMean: calibratedTotal,
    proposedMean: calibratedTotal + combinedTotalShiftPoints,
    score: (points) => points - args.current.total!.line,
    nonNegative: true,
    sharpShift: sharpTotalShiftPoints,
    movementShift: movement.totalShiftPoints,
    publicShift: publicTotalShiftPoints,
  });
  return {
    ...outcomeFromDistributions({
    providerGameId: args.baseForecast.providerGameId,
    awayTeam: args.baseForecast.awayTeam,
    homeTeam: args.baseForecast.homeTeam,
    marginDistribution: shiftedDistribution(args.baseForecast.marginDistribution, guardedMargin.mean, false),
    totalDistribution: shiftedDistribution(args.baseForecast.totalDistribution, guardedTotal.mean, true),
    }),
    marketEvidence: {
      release: NFL_V1_MARKET_EVIDENCE_OUTCOME_RELEASE,
      representativeScoreRelease: NFL_V1_MARKET_EVIDENCE_REPRESENTATIVE_SCORE_RELEASE,
      marketWeight: NFL_V1_MARKET_WEIGHT,
      sharp: {
        homeMarginGapPp: sharpMarginGap,
        overTotalGapPp: sharpTotalGap,
        homeMarginShiftPoints: sharpHomeMarginShiftPoints,
        totalShiftPoints: sharpTotalShiftPoints,
      },
      publicConsensus: {
        homeMarginGapPp: publicMarginGap,
        overTotalGapPp: publicTotalGap,
        homeMarginShiftPoints: publicHomeMarginShiftPoints,
        totalShiftPoints: publicTotalShiftPoints,
      },
      movement,
      calibratedCore: {
        source: correction ? "week_one_spread_total_residual_heads" : null,
        rawHomeCoverProbability,
        calibratedHomeCoverProbability,
        rawOverProbability,
        calibratedOverProbability,
        calibratedHomeMargin,
        calibratedTotal,
      },
      combinedHomeMarginShiftPoints,
      combinedTotalShiftPoints,
      appliedHomeMarginShiftPoints: guardedMargin.mean - calibratedHomeMargin,
      appliedTotalShiftPoints: guardedTotal.mean - calibratedTotal,
      weakHomeMarginReversalRejected: guardedMargin.reversalRejected,
      weakTotalReversalRejected: guardedTotal.reversalRejected,
    },
  };
}

function meanForSideProbability(args: {
  source: DiscreteDistribution;
  initialMean: number;
  targetProbability: number;
  score: (value: number) => number;
  nonNegative: boolean;
}): number {
  let low = args.initialMean - 24;
  let high = args.initialMean + 24;
  for (let iteration = 0; iteration < 70; iteration++) {
    const middle = (low + high) / 2;
    const probability = distributionSideProbability(
      shiftedDistribution(args.source, middle, args.nonNegative),
      args.score,
    );
    if (probability < args.targetProbability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function guardWeakEvidenceReversal(args: {
  source: DiscreteDistribution;
  calibratedMean: number;
  proposedMean: number;
  score: (value: number) => number;
  nonNegative: boolean;
  sharpShift: number;
  movementShift: number;
  publicShift: number;
}): { mean: number; reversalRejected: boolean } {
  const calibratedProbability = distributionSideProbability(
    shiftedDistribution(args.source, args.calibratedMean, args.nonNegative),
    args.score,
  );
  const proposedProbability = distributionSideProbability(
    shiftedDistribution(args.source, args.proposedMean, args.nonNegative),
    args.score,
  );
  const reversed = (calibratedProbability >= 0.5) !== (proposedProbability >= 0.5);
  const proposedAdvantage = Math.abs(proposedProbability - 0.5);
  const secondaryCorroborated = args.publicShift !== 0 && args.movementShift !== 0 &&
    Math.sign(args.publicShift) === Math.sign(args.movementShift);
  const strongEvidence = args.sharpShift !== 0 || secondaryCorroborated ||
    proposedAdvantage >= NFL_V1_WEAK_EVIDENCE_REVERSAL_MINIMUM_ADVANTAGE;
  return reversed && !strongEvidence
    ? { mean: args.calibratedMean, reversalRejected: true }
    : { mean: args.proposedMean, reversalRejected: false };
}

function distributionSideProbability(
  distribution: DiscreteDistribution,
  score: (value: number) => number,
): number {
  const split = splitDistribution(distribution, score);
  return split.positive / Math.max(split.positive + split.negative, 1e-12);
}

export function nflV1WeekOneOutcomeArtifactMetadata() {
  return {
    artifactRelease: artifact.artifactRelease,
    modelRelease: artifact.modelRelease,
    distributionRelease: artifact.distributionRelease,
    probabilityRelease: artifact.probabilityRelease,
    representativeScorePolicyRelease: artifact.representativeScorePolicyRelease,
    tournamentRelease: artifact.tournamentRelease,
    source: { ...artifact.source },
    games: artifact.games.length,
  };
}

export function nflV1WeekOneLineProbabilities(args: {
  forecast: NflV1WeekOneOutcomeForecast;
  homeSpread: number;
  totalLine: number;
}) {
  const spread = splitDistribution(args.forecast.marginDistribution, (margin) => margin + args.homeSpread);
  const total = splitDistribution(args.forecast.totalDistribution, (points) => points - args.totalLine);
  return {
    spread: {
      homeCoverProbability: spread.positive / Math.max(spread.positive + spread.negative, 1e-12),
      awayCoverProbability: spread.negative / Math.max(spread.positive + spread.negative, 1e-12),
      pushProbability: spread.push,
    },
    total: {
      overProbability: total.positive / Math.max(total.positive + total.negative, 1e-12),
      underProbability: total.negative / Math.max(total.positive + total.negative, 1e-12),
      pushProbability: total.push,
    },
  };
}

function validateArtifact(value: Artifact): void {
  if (value.artifactRelease !== NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE) {
    throw new Error(`NFL v1 outcome artifact release mismatch: ${value.artifactRelease}.`);
  }
  if (value.modelRelease !== NFL_V1_OUTCOME_MODEL_RELEASE ||
      value.distributionRelease !== NFL_V1_OUTCOME_DISTRIBUTION_RELEASE ||
      value.probabilityRelease !== NFL_V1_OUTCOME_PROBABILITY_RELEASE ||
      value.representativeScorePolicyRelease !== NFL_V1_REPRESENTATIVE_SCORE_POLICY_RELEASE) {
    throw new Error("NFL v1 outcome artifact model release mismatch.");
  }
  if (value.games.length !== 16 || new Set(value.games.map((game) => game.providerGameId)).size !== 16) {
    throw new Error(`NFL v1 Week 1 artifact must contain 16 unique games; found ${value.games.length}.`);
  }
  for (const game of value.games) {
    const numbers = [
      game.expectedAwayScore,
      game.expectedHomeScore,
      game.representativeAwayScore,
      game.representativeHomeScore,
      game.representativeScoreProbability,
      game.awayWinProbability,
      game.homeWinProbability,
      game.tieProbability,
      game.sourceExpectedAwayScore,
      game.sourceExpectedHomeScore,
    ];
    if (numbers.some((number) => !Number.isFinite(number))) {
      throw new Error(`NFL v1 outcome artifact contains a non-finite value for ${game.providerGameId}.`);
    }
    if (game.expectedAwayScore < 0 || game.expectedHomeScore < 0 ||
        !Number.isInteger(game.representativeAwayScore) || !Number.isInteger(game.representativeHomeScore) ||
        game.representativeAwayScore < 0 || game.representativeHomeScore < 0 ||
        game.representativeAwayScore === game.representativeHomeScore ||
        game.representativeScoreProbability <= 0 || game.representativeScoreProbability >= 1 ||
        game.awayWinProbability <= 0 || game.awayWinProbability >= 1 ||
        game.homeWinProbability <= 0 || game.homeWinProbability >= 1 ||
        game.tieProbability < 0 || game.tieProbability >= 1 ||
        Math.abs(game.awayWinProbability + game.homeWinProbability - 1) > 0.000002 ||
        (game.homeWinProbability > game.awayWinProbability) !== (game.representativeHomeScore > game.representativeAwayScore)) {
      throw new Error(`NFL v1 outcome artifact contains an invalid forecast for ${game.providerGameId}.`);
    }
    validateDistribution(game.marginDistribution, `${game.providerGameId} margin`);
    validateDistribution(game.totalDistribution, `${game.providerGameId} total`);
    const expectedMargin = distributionMean(game.marginDistribution);
    const expectedTotal = distributionMean(game.totalDistribution);
    const expectedAway = (expectedTotal - expectedMargin) / 2;
    const expectedHome = (expectedTotal + expectedMargin) / 2;
    const winnerSplit = splitDistribution(game.marginDistribution, (margin) => margin);
    const decidedProbability = Math.max(winnerSplit.positive + winnerSplit.negative, 1e-12);
    const homeWinProbability = winnerSplit.positive / decidedProbability;
    const awayWinProbability = winnerSplit.negative / decidedProbability;
    if (Math.abs(expectedAway - game.expectedAwayScore) > 0.000002 ||
        Math.abs(expectedHome - game.expectedHomeScore) > 0.000002 ||
        Math.abs(homeWinProbability - game.homeWinProbability) > 0.000002 ||
        Math.abs(awayWinProbability - game.awayWinProbability) > 0.000002 ||
        Math.abs(winnerSplit.push - game.tieProbability) > 0.000002 ||
        expectedHome === expectedAway ||
        (expectedHome > expectedAway) !== (game.homeWinProbability > game.awayWinProbability)) {
      throw new Error(`NFL v1 expected points or winner probabilities are not derived from the stored PMF for ${game.providerGameId}.`);
    }
  }
}

function distributionMean(distribution: DiscreteDistribution): number {
  return distribution.values.reduce(
    (sum, value, index) => sum + value * distribution.probabilities[index]!,
    0,
  );
}

function buildWeeklyOutcomeForecast(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  projectedHomeMargin: number;
  marketTotal: number;
}): NflV1WeekOneOutcomeForecast {
  if (!Number.isFinite(args.projectedHomeMargin) || !Number.isFinite(args.marketTotal) || args.marketTotal <= 0) {
    throw new Error(`NFL weekly outcome anchors are invalid for ${args.providerGameId}.`);
  }
  const marginDistribution = pooledShiftedDistribution(
    artifact.games.map((game) => game.marginDistribution),
    args.projectedHomeMargin,
    false,
  );
  const totalDistribution = pooledShiftedDistribution(
    artifact.games.map((game) => game.totalDistribution),
    args.marketTotal,
    true,
  );
  return outcomeFromDistributions({
    providerGameId: args.providerGameId,
    awayTeam: args.awayTeam,
    homeTeam: args.homeTeam,
    marginDistribution,
    totalDistribution,
  });
}

function outcomeFromDistributions(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  marginDistribution: DiscreteDistribution;
  totalDistribution: DiscreteDistribution;
}): NflV1WeekOneOutcomeForecast {
  const expectedMargin = distributionMean(args.marginDistribution);
  const expectedTotal = distributionMean(args.totalDistribution);
  const expectedAwayScore = Math.max(0, (expectedTotal - expectedMargin) / 2);
  const expectedHomeScore = Math.max(0, (expectedTotal + expectedMargin) / 2);
  const winner = splitDistribution(args.marginDistribution, (margin) => margin);
  const decided = Math.max(winner.positive + winner.negative, 1e-12);
  const homeWinProbability = winner.positive / decided;
  const awayWinProbability = winner.negative / decided;
  const representative = representativeScore({
    expectedAwayScore,
    expectedHomeScore,
    homeFavored: homeWinProbability > awayWinProbability,
  });
  return {
    providerGameId: args.providerGameId,
    awayTeam: normalizeTeam(args.awayTeam),
    homeTeam: normalizeTeam(args.homeTeam),
    expectedAwayScore,
    expectedHomeScore,
    representativeAwayScore: representative.away,
    representativeHomeScore: representative.home,
    representativeScoreProbability: representative.probability,
    awayWinProbability,
    homeWinProbability,
    tieProbability: winner.push,
    marginDistribution: args.marginDistribution,
    totalDistribution: args.totalDistribution,
    sourceExpectedAwayScore: expectedAwayScore,
    sourceExpectedHomeScore: expectedHomeScore,
  };
}

function freshCircaGap(value: SharpSplitPercentages | undefined, side: "home" | "over", evaluatedAt: number): number | null {
  if (!value || normalizeBook(value.sourceSportsbook) !== "circa") return null;
  const observedAt = Date.parse(value.providerFetchedAt ?? "");
  if (!Number.isFinite(observedAt) || observedAt > evaluatedAt || evaluatedAt - observedAt > 120 * 60_000) return null;
  return signedGap(value, side);
}

function freshPublicGap(value: SplitPercentages | undefined, side: "home" | "over", evaluatedAt: number): number | null {
  if (!value) return null;
  const observedAt = Date.parse(value.capturedAt);
  if (!Number.isFinite(observedAt) || observedAt > evaluatedAt || evaluatedAt - observedAt > 120 * 60_000) return null;
  return signedGap(value, side);
}

function signedGap(value: SplitPercentages, side: "home" | "over"): number | null {
  const money = side === "home" ? value.homeMoneyPct : value.overMoneyPct;
  const bets = side === "home" ? value.homeBetsPct : value.overBetsPct;
  return money === null || bets === null ? null : money - bets;
}

function splitShift(gap: number | null, threshold: number, fullStrength: number, cap: number): number {
  if (gap === null || Math.abs(gap) < threshold) return 0;
  const strength = Math.min(1, (Math.abs(gap) - threshold) / (fullStrength - threshold));
  return Math.sign(gap) * cap * strength;
}

function shiftedDistribution(source: DiscreteDistribution, targetMean: number, nonNegative: boolean): DiscreteDistribution {
  const sourceMean = distributionMean(source);
  const weights = new Map<number, number>();
  source.values.forEach((value, index) => {
    appendFractionalShift(weights, value - sourceMean + targetMean, source.probabilities[index]!, nonNegative);
  });
  const values = [...weights.keys()].sort((first, second) => first - second);
  const probabilities = values.map((value) => weights.get(value)!);
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  return { values, probabilities: probabilities.map((value) => value / total) };
}

function playbookLineMatches(value: number | null | undefined, current: number): boolean {
  return value !== null && value !== undefined && Math.abs(value - current) <= 0.5;
}

function firstFinite(...values: Array<number | null>): number | null {
  return values.find((value): value is number => value !== null && Number.isFinite(value)) ?? null;
}

function normalizeBook(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pooledShiftedDistribution(
  sources: DiscreteDistribution[],
  targetMean: number,
  nonNegative: boolean,
): DiscreteDistribution {
  const weights = new Map<number, number>();
  for (const source of sources) {
    const sourceMean = distributionMean(source);
    source.values.forEach((value, index) => {
      appendFractionalShift(
        weights,
        value - sourceMean + targetMean,
        source.probabilities[index]! / sources.length,
        nonNegative,
      );
    });
  }
  const values = [...weights.keys()].sort((a, b) => a - b);
  const raw = values.map((value) => weights.get(value)!);
  const total = raw.reduce((sum, value) => sum + value, 0);
  return { values, probabilities: raw.map((value) => value / total) };
}

function appendFractionalShift(
  weights: Map<number, number>,
  shiftedValue: number,
  probability: number,
  nonNegative: boolean,
): void {
  const lower = Math.floor(shiftedValue);
  const upper = Math.ceil(shiftedValue);
  const upperWeight = shiftedValue - lower;
  const append = (rawBucket: number, weight: number) => {
    if (weight <= 0) return;
    const bucket = nonNegative ? Math.max(0, rawBucket) : rawBucket;
    weights.set(bucket, (weights.get(bucket) ?? 0) + probability * weight);
  };
  if (lower === upper) {
    append(lower, 1);
    return;
  }
  append(lower, 1 - upperWeight);
  append(upper, upperWeight);
}

function representativeScore(args: {
  expectedAwayScore: number;
  expectedHomeScore: number;
  homeFavored: boolean;
}): { away: number; home: number; probability: number } {
  let best = { away: 0, home: 1, distance: Number.POSITIVE_INFINITY };
  for (let away = 0; away <= 70; away += 1) {
    for (let home = 0; home <= 70; home += 1) {
      if (away === home || (home > away) !== args.homeFavored) continue;
      const distance = Math.abs(away - args.expectedAwayScore) + Math.abs(home - args.expectedHomeScore);
      if (distance < best.distance) best = { away, home, distance };
    }
  }
  return { away: best.away, home: best.home, probability: 1 / (1 + best.distance + 100) };
}

function validateDistribution(value: DiscreteDistribution, label: string): void {
  if (value.values.length === 0 || value.values.length !== value.probabilities.length) {
    throw new Error(`NFL v1 ${label} distribution is incomplete.`);
  }
  if (value.values.some((entry, index) => !Number.isInteger(entry) || (index > 0 && entry <= value.values[index - 1]!)) ||
      value.probabilities.some((entry) => !Number.isFinite(entry) || entry < 0) ||
      Math.abs(value.probabilities.reduce((sum, entry) => sum + entry, 0) - 1) > 0.000002) {
    throw new Error(`NFL v1 ${label} distribution is invalid.`);
  }
}

function splitDistribution(
  distribution: DiscreteDistribution,
  difference: (value: number) => number,
): { positive: number; push: number; negative: number } {
  let positive = 0;
  let push = 0;
  let negative = 0;
  distribution.values.forEach((value, index) => {
    const probability = distribution.probabilities[index]!;
    const result = difference(value);
    if (result > 0) positive += probability;
    else if (result < 0) negative += probability;
    else push += probability;
  });
  return { positive, push, negative };
}

function normalizeTeam(team: string): string {
  const value = team.toUpperCase();
  return value === "WAS" ? "WSH" : value;
}
