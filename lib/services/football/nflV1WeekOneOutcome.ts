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
  "nfl_v1_weekly_market_anchored_outcome_2026_09_25_r7_current_season_raw_signal" as const;
export const NFL_V1_WEEKLY_OUTCOME_DISTRIBUTION_RELEASE =
  "nfl_pooled_discrete_residual_distribution_2026_09_25_r6_current_season_raw_signal" as const;
export const NFL_V1_WEEKLY_OUTCOME_PROBABILITY_RELEASE =
  "nfl_v1_weekly_pooled_discrete_probability_2026_09_25_r6_current_season_raw_signal" as const;
export const NFL_V1_MARKET_EVIDENCE_OUTCOME_RELEASE =
  "nfl_v1_market_evidence_outcome_2026_09_25_r7_current_season_raw_signal" as const;
export const NFL_V1_MARKET_EVIDENCE_REPRESENTATIVE_SCORE_RELEASE =
  "nfl_v1_market_evidence_representative_score_2026_09_25_r6_current_season_raw_signal" as const;
export const NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE =
  "nfl_weekly_raw_signal_2026_09_25_r2_current_season_possession" as const;
export const NFL_V1_WEEKLY_REPRESENTATIVE_SCORE_CENTER_WEIGHT = 0.2 as const;
export const NFL_V1_MARKET_WEIGHT = 0.75 as const;
export const NFL_V1_WEEKLY_RAW_MARGIN_MARKET_WEIGHT = 0.9 as const;
export const NFL_V1_SHARP_SPLIT_MAX_SHIFT_POINTS = 1.5 as const;
export const NFL_V1_PUBLIC_SPLIT_MAX_SHIFT_POINTS = 0.75 as const;
export const NFL_V1_RESIDUAL_HEAD_LOGIT_WEIGHT = 0.5 as const;
export const NFL_V1_WEAK_EVIDENCE_REVERSAL_MINIMUM_ADVANTAGE = 0.025 as const;
export const NFL_V1_PRICED_NEUTRAL_TOTAL_RELEASE =
  "nfl_v1_priced_neutral_total_2026_09_20_r1" as const;
export const NFL_V1_OPENING_MARKET_SPREAD_DIRECTION_RELEASE =
  "nfl_v1_opening_market_spread_direction_2026_09_21_r1" as const;

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
    release:
      | "nfl_target_excluded_market_outcome_2026_09_03_r1"
      | "nfl_target_excluded_market_outcome_2026_09_14_r2_prediction_owned_side"
      | "nfl_target_excluded_market_outcome_2026_09_20_r3_priced_neutral_total"
      | "nfl_target_excluded_market_outcome_2026_09_21_r4_opening_market_direction"
      | "nfl_target_excluded_market_outcome_2026_09_25_r5_current_season_raw_signal";
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
    weeklyRawSignal?: {
      release: typeof NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE;
      independentHomeMargin: number;
      marginMarketWeight: typeof NFL_V1_WEEKLY_RAW_MARGIN_MARKET_WEIGHT;
      totalMeanEvidencePolicy: "same_book_movement_only";
    };
    sharp: { homeMarginGapPp: number | null; overTotalGapPp: number | null; homeMarginShiftPoints: number; totalShiftPoints: number };
    publicConsensus: { homeMarginGapPp: number | null; overTotalGapPp: number | null; homeMarginShiftPoints: number; totalShiftPoints: number };
    movement: FootballOutcomeMarketMovement;
    spreadDirection?: {
      release: typeof NFL_V1_OPENING_MARKET_SPREAD_DIRECTION_RELEASE;
      status: "available" | "unavailable";
      side: "home" | "away" | null;
      reason: "move_home" | "move_away" | "flat_price" | null;
      openingHomeLine: number | null;
      currentHomeLine: number | null;
      homeFairProbability: number | null;
      preOrientationHomeCoverProbability: number;
      orientedHomeCoverProbability: number;
    };
    calibratedCore: {
      source: "week_one_spread_total_residual_heads" | typeof NFL_V1_PRICED_NEUTRAL_TOTAL_RELEASE | null;
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
  marketHomeCoverProbability?: number;
  marketOverProbability?: number;
  spreadDirectionCandidate?: boolean;
  /** Original same-book quote used only for movement after a synthetic target-free anchor replaces current. */
  movementCurrent?: NflPreviewBookOdds | null;
  weeklyRawSignal?: {
    release: typeof NFL_V1_WEEKLY_RAW_SIGNAL_RELEASE;
    independentHomeMargin: number;
  };
  evaluatedAt: string;
}): NflV1WeekOneOutcomeForecast {
  if (!args.current.spread || !args.current.total) return args.baseForecast;
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL market-evidence evaluatedAt is invalid.");
  const baseTotal = args.baseForecast.expectedAwayScore + args.baseForecast.expectedHomeScore;
  if (args.weeklyRawSignal && !Number.isFinite(args.weeklyRawSignal.independentHomeMargin)) {
    throw new Error("NFL weekly raw-signal margin is invalid.");
  }
  const rawTargetMargin = args.weeklyRawSignal
    ? (1 - NFL_V1_WEEKLY_RAW_MARGIN_MARKET_WEIGHT) * args.weeklyRawSignal.independentHomeMargin
      + NFL_V1_WEEKLY_RAW_MARGIN_MARKET_WEIGHT * -args.current.spread.homeLine
    : (1 - NFL_V1_MARKET_WEIGHT) * args.footballHomeMargin
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
    current: args.weeklyRawSignal ? args.movementCurrent ?? null : args.current,
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
  if (args.marketOverProbability !== undefined &&
      (!Number.isFinite(args.marketOverProbability) || args.marketOverProbability <= 0 || args.marketOverProbability >= 1)) {
    throw new Error("NFL priced-neutral Total probability must be between zero and one.");
  }
  if (args.marketHomeCoverProbability !== undefined &&
      (!Number.isFinite(args.marketHomeCoverProbability) || args.marketHomeCoverProbability <= 0 || args.marketHomeCoverProbability >= 1)) {
    throw new Error("NFL priced-neutral Spread probability must be between zero and one.");
  }
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
  const pricedNeutralOverProbability = args.marketOverProbability ?? rawOverProbability;
  const calibratedOverProbability = correction
    ? applyNflV1LogitCorrection(
        pricedNeutralOverProbability,
        NFL_V1_RESIDUAL_HEAD_LOGIT_WEIGHT * correction.totalOverLogitCorrection,
      )
    : pricedNeutralOverProbability;
  const calibratedHomeMargin = correction
    ? meanForSideProbability({
        source: args.baseForecast.marginDistribution,
        initialMean: rawTargetMargin,
        targetProbability: calibratedHomeCoverProbability,
        score: (margin) => margin + args.current.spread!.homeLine,
        nonNegative: false,
      })
    : rawTargetMargin;
  const calibratedTotal = correction || args.marketOverProbability !== undefined
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
    proposedMean: calibratedTotal + (args.weeklyRawSignal
      ? movement.totalShiftPoints
      : combinedTotalShiftPoints),
    score: (points) => points - args.current.total!.line,
    nonNegative: true,
    sharpShift: args.weeklyRawSignal ? 0 : sharpTotalShiftPoints,
    movementShift: movement.totalShiftPoints,
    publicShift: args.weeklyRawSignal ? 0 : publicTotalShiftPoints,
  });
  const preOrientationHomeCoverProbability = distributionSideProbability(
    shiftedDistribution(args.baseForecast.marginDistribution, guardedMargin.mean, false),
    (margin) => margin + args.current.spread!.homeLine,
  );
  const spreadDirection = args.spreadDirectionCandidate === true
    ? orientNflSpreadProbabilityToOpeningMarket({
        opening: args.operationalOpening?.quote ?? null,
        current: args.current,
        homeFairProbability: args.marketHomeCoverProbability ?? twoSidedFair(
          args.current.spread.homePrice,
          args.current.spread.awayPrice,
        ),
        preOrientationHomeCoverProbability,
        evaluatedAt: args.evaluatedAt,
      })
    : null;
  const finalHomeMargin = spreadDirection?.status === "available"
    ? meanForSideProbability({
        source: args.baseForecast.marginDistribution,
        initialMean: guardedMargin.mean,
        targetProbability: spreadDirection.orientedHomeCoverProbability,
        score: (margin) => margin + args.current.spread!.homeLine,
        nonNegative: false,
      })
    : guardedMargin.mean;
  return {
    ...outcomeFromDistributions({
    providerGameId: args.baseForecast.providerGameId,
    awayTeam: args.baseForecast.awayTeam,
    homeTeam: args.baseForecast.homeTeam,
    marginDistribution: shiftedDistribution(args.baseForecast.marginDistribution, finalHomeMargin, false),
    totalDistribution: shiftedDistribution(args.baseForecast.totalDistribution, guardedTotal.mean, true),
    }),
    marketEvidence: {
      release: NFL_V1_MARKET_EVIDENCE_OUTCOME_RELEASE,
      representativeScoreRelease: NFL_V1_MARKET_EVIDENCE_REPRESENTATIVE_SCORE_RELEASE,
      marketWeight: NFL_V1_MARKET_WEIGHT,
      ...(args.weeklyRawSignal ? {
        weeklyRawSignal: {
          release: args.weeklyRawSignal.release,
          independentHomeMargin: args.weeklyRawSignal.independentHomeMargin,
          marginMarketWeight: NFL_V1_WEEKLY_RAW_MARGIN_MARKET_WEIGHT,
          totalMeanEvidencePolicy: "same_book_movement_only" as const,
        },
      } : {}),
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
      ...(spreadDirection ? { spreadDirection } : {}),
      calibratedCore: {
        source: correction
          ? "week_one_spread_total_residual_heads"
          : args.marketOverProbability !== undefined
            ? NFL_V1_PRICED_NEUTRAL_TOTAL_RELEASE
            : null,
        rawHomeCoverProbability,
        calibratedHomeCoverProbability,
        rawOverProbability,
        calibratedOverProbability,
        calibratedHomeMargin,
        calibratedTotal,
      },
      combinedHomeMarginShiftPoints,
      combinedTotalShiftPoints,
      appliedHomeMarginShiftPoints: finalHomeMargin - calibratedHomeMargin,
      appliedTotalShiftPoints: guardedTotal.mean - calibratedTotal,
      weakHomeMarginReversalRejected: guardedMargin.reversalRejected,
      weakTotalReversalRejected: guardedTotal.reversalRejected,
    },
  };
}

function orientNflSpreadProbabilityToOpeningMarket(args: {
  opening: NflPreviewBookOdds | null;
  current: NflPreviewBookOdds;
  homeFairProbability: number;
  preOrientationHomeCoverProbability: number;
  evaluatedAt: string;
}): NonNullable<NonNullable<NflV1WeekOneOutcomeForecast["marketEvidence"]>["spreadDirection"]> {
  const unavailable = () => ({
    release: NFL_V1_OPENING_MARKET_SPREAD_DIRECTION_RELEASE,
    status: "unavailable" as const,
    side: null,
    reason: null,
    openingHomeLine: args.opening?.spread?.homeLine ?? null,
    currentHomeLine: args.current.spread?.homeLine ?? null,
    homeFairProbability: Number.isFinite(args.homeFairProbability) ? args.homeFairProbability : null,
    preOrientationHomeCoverProbability: args.preOrientationHomeCoverProbability,
    orientedHomeCoverProbability: args.preOrientationHomeCoverProbability,
  });
  if (!args.opening?.spread || !args.current.spread ||
      !Number.isFinite(args.homeFairProbability) || args.homeFairProbability <= 0 || args.homeFairProbability >= 1) {
    return unavailable();
  }
  const openingObservedAt = Date.parse(args.opening.observedAt);
  const currentObservedAt = Date.parse(args.current.observedAt);
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(openingObservedAt) || !Number.isFinite(currentObservedAt) ||
      !Number.isFinite(evaluatedAt) || openingObservedAt > currentObservedAt || currentObservedAt > evaluatedAt) {
    return unavailable();
  }
  const movement = args.current.spread.homeLine - args.opening.spread.homeLine;
  const side = movement <= -0.5
    ? "home" as const
    : movement >= 0.5
      ? "away" as const
      : args.homeFairProbability >= 0.5 ? "home" as const : "away" as const;
  const reason = movement <= -0.5
    ? "move_home" as const
    : movement >= 0.5
      ? "move_away" as const
      : "flat_price" as const;
  const confidence = Math.max(0.000001, Math.abs(args.preOrientationHomeCoverProbability - 0.5));
  return {
    release: NFL_V1_OPENING_MARKET_SPREAD_DIRECTION_RELEASE,
    status: "available",
    side,
    reason,
    openingHomeLine: args.opening.spread.homeLine,
    currentHomeLine: args.current.spread.homeLine,
    homeFairProbability: args.homeFairProbability,
    preOrientationHomeCoverProbability: args.preOrientationHomeCoverProbability,
    orientedHomeCoverProbability: side === "home" ? 0.5 + confidence : 0.5 - confidence,
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
    marginDistribution: args.marginDistribution,
    totalDistribution: args.totalDistribution,
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

function twoSidedFair(selectedPrice: number, opposingPrice: number): number {
  const selected = americanImplied(selectedPrice);
  const opposing = americanImplied(opposingPrice);
  return selected / (selected + opposing);
}

function americanImplied(price: number): number {
  if (!Number.isFinite(price) || price === 0) throw new Error("NFL spread direction price must be non-zero American odds.");
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
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
  marginDistribution: DiscreteDistribution;
  totalDistribution: DiscreteDistribution;
}): { away: number; home: number; probability: number } {
  const expectedMargin = args.expectedHomeScore - args.expectedAwayScore;
  const expectedTotal = args.expectedHomeScore + args.expectedAwayScore;
  let best = {
    away: 0,
    home: args.homeFavored ? 1 : 0,
    probability: 0,
    key: [Number.POSITIVE_INFINITY] as number[],
  };
  args.marginDistribution.values.forEach((margin, marginIndex) => {
    if (margin === 0 || (margin > 0) !== args.homeFavored) return;
    const marginProbability = args.marginDistribution.probabilities[marginIndex] ?? 0;
    if (!(marginProbability > 0)) return;
    args.totalDistribution.values.forEach((total, totalIndex) => {
      if (total < Math.abs(margin) || (total + margin) % 2 !== 0) return;
      const home = (total + margin) / 2;
      const away = (total - margin) / 2;
      if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home > 70 || away > 70) return;
      const totalProbability = args.totalDistribution.probabilities[totalIndex] ?? 0;
      if (!(totalProbability > 0)) return;
      const probability = marginProbability * totalProbability;
      const centerDistance = Math.abs(margin - expectedMargin) + Math.abs(total - expectedTotal);
      const key = [
        -Math.log(Math.max(probability, 1e-300)) + NFL_V1_WEEKLY_REPRESENTATIVE_SCORE_CENTER_WEIGHT * centerDistance,
        centerDistance,
        -probability,
        away,
        home,
      ];
      if (lexicographicallyBefore(key, best.key)) best = { away, home, probability, key };
    });
  });
  if (!(best.probability > 0)) {
    throw new Error("NFL weekly representative score has no valid marginally supported candidate.");
  }
  return { away: best.away, home: best.home, probability: best.probability };
}

function lexicographicallyBefore(candidate: number[], incumbent: number[]): boolean {
  for (let index = 0; index < Math.max(candidate.length, incumbent.length); index += 1) {
    const left = candidate[index] ?? 0;
    const right = incumbent[index] ?? 0;
    if (left < right) return true;
    if (left > right) return false;
  }
  return false;
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
