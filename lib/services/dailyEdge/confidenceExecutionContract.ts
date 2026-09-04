export const DAILY_EDGE_CONFIDENCE_EXECUTION_CONTRACT_RELEASE =
  "daily_edge_confidence_execution_contract_2026_09_04_r2_recommendation_resolution" as const;

export type DailyEdgeConfidenceGrade = "Best Angle" | "Lean" | "Watchlist" | "No Play";
export type DailyEdgeExecutionStatus = "bet" | "shop" | "unavailable";
export type DailyEdgeRecommendationStatus = DailyEdgeExecutionStatus | "monitor";

export type DailyEdgeConfidenceBands = {
  bestAngle: number;
  lean: number;
  watchlist: number;
};

export const DEFAULT_DAILY_EDGE_CONFIDENCE_BANDS: DailyEdgeConfidenceBands = {
  bestAngle: 60,
  lean: 55,
  watchlist: 51.5,
};

/**
 * The only categorical boundaries in the shared confidence contract. Sport
 * models still own their continuous score and may own calibrated bands.
 */
export function confidenceGradeFromScore(
  score: number,
  bands: DailyEdgeConfidenceBands = DEFAULT_DAILY_EDGE_CONFIDENCE_BANDS,
): DailyEdgeConfidenceGrade {
  assertScore(score);
  assertBands(bands);
  if (score >= bands.bestAngle) return "Best Angle";
  if (score >= bands.lean) return "Lean";
  if (score >= bands.watchlist) return "Watchlist";
  return "No Play";
}

/**
 * Optional display hysteresis for unlocked boards. It prevents a tiny input
 * nudge from repeatedly changing a tier while still allowing a material move
 * to pass through immediately. It never reads price or EV.
 */
export function stableConfidenceGrade(args: {
  score: number;
  previousGrade: DailyEdgeConfidenceGrade | null;
  bands?: DailyEdgeConfidenceBands;
  transitionBuffer?: number;
}): DailyEdgeConfidenceGrade {
  const bands = args.bands ?? DEFAULT_DAILY_EDGE_CONFIDENCE_BANDS;
  const desired = confidenceGradeFromScore(args.score, bands);
  const previous = args.previousGrade;
  if (previous === null || previous === desired) return desired;
  const buffer = args.transitionBuffer ?? 0.5;
  if (!Number.isFinite(buffer) || buffer < 0) throw new Error("Daily Edge transition buffer must be finite and non-negative.");
  const previousRank = gradeRank(previous);
  const desiredRank = gradeRank(desired);
  if (desiredRank > previousRank) {
    return args.score >= entryBoundary(desired, bands) + buffer ? desired : previous;
  }
  return args.score < entryBoundary(previous, bands) - buffer ? desired : previous;
}

/**
 * Exact-price economics are deliberately downstream of confidence. A valid
 * named-book quote is retained even when it is a Shop; an incoherent or stale
 * quote is unavailable rather than a fabricated wager.
 */
export function executionStatusForQuote(args: {
  americanPrice: number | null;
  expectedValue: number | null;
  quoteFresh: boolean;
  quoteCoherent: boolean;
}): DailyEdgeExecutionStatus {
  if (
    !args.quoteFresh ||
    !args.quoteCoherent ||
    args.americanPrice === null ||
    !Number.isFinite(args.americanPrice) ||
    args.americanPrice === 0 ||
    args.expectedValue === null ||
    !Number.isFinite(args.expectedValue)
  ) return "unavailable";
  return args.expectedValue >= 0 ? "bet" : "shop";
}

export type DailyEdgeConfidenceExecutionDecision = {
  contractRelease: typeof DAILY_EDGE_CONFIDENCE_EXECUTION_CONTRACT_RELEASE;
  confidenceScore: number;
  confidenceGrade: DailyEdgeConfidenceGrade;
  quoteStatus: DailyEdgeExecutionStatus;
  recommendationStatus: DailyEdgeRecommendationStatus;
  confidenceActionable: boolean;
  actionableAtDisplayedQuote: boolean;
  noBet: boolean;
  noBetReason: string | null;
};

/**
 * Resolves the product decision without allowing quote economics to mutate the
 * confidence label. Sport models own the score and bands. This layer owns only
 * stable category presentation and displayed-quote execution semantics.
 */
export function resolveDailyEdgeConfidenceExecutionDecision(args: {
  confidenceScore: number;
  previousConfidenceGrade?: DailyEdgeConfidenceGrade | null;
  bands?: DailyEdgeConfidenceBands;
  transitionBuffer?: number;
  hardHoldReason?: string | null;
  americanPrice: number | null;
  expectedValue: number | null;
  quoteFresh: boolean;
  quoteCoherent: boolean;
}): DailyEdgeConfidenceExecutionDecision {
  assertScore(args.confidenceScore);
  const hardHoldReason = cleanReason(args.hardHoldReason);
  const confidenceGrade = hardHoldReason
    ? "No Play"
    : stableConfidenceGrade({
        score: args.confidenceScore,
        previousGrade: args.previousConfidenceGrade ?? null,
        bands: args.bands,
        transitionBuffer: args.transitionBuffer,
      });
  const quoteStatus = executionStatusForQuote({
    americanPrice: args.americanPrice,
    expectedValue: args.expectedValue,
    quoteFresh: args.quoteFresh,
    quoteCoherent: args.quoteCoherent,
  });
  const confidenceActionable = !hardHoldReason && isConfidenceActionable(confidenceGrade);
  const recommendationStatus: DailyEdgeRecommendationStatus = hardHoldReason || quoteStatus === "unavailable"
    ? "unavailable"
    : confidenceActionable
      ? quoteStatus
      : "monitor";
  const actionableAtDisplayedQuote = recommendationStatus === "bet";
  const noBetReason = actionableAtDisplayedQuote
    ? null
    : hardHoldReason
      ?? (recommendationStatus === "shop"
        ? "displayed_quote_negative_expected_value_shop"
        : recommendationStatus === "unavailable"
          ? "fresh_coherent_named_book_quote_unavailable"
          : `confidence_grade_${confidenceGrade.toLowerCase().replace(/\s+/g, "_")}`);
  return {
    contractRelease: DAILY_EDGE_CONFIDENCE_EXECUTION_CONTRACT_RELEASE,
    confidenceScore: args.confidenceScore,
    confidenceGrade,
    quoteStatus,
    recommendationStatus,
    confidenceActionable,
    actionableAtDisplayedQuote,
    noBet: !actionableAtDisplayedQuote,
    noBetReason,
  };
}

export function isConfidenceActionable(grade: DailyEdgeConfidenceGrade): boolean {
  return grade === "Best Angle" || grade === "Lean";
}

function entryBoundary(grade: DailyEdgeConfidenceGrade, bands: DailyEdgeConfidenceBands): number {
  if (grade === "Best Angle") return bands.bestAngle;
  if (grade === "Lean") return bands.lean;
  if (grade === "Watchlist") return bands.watchlist;
  return 0;
}

function gradeRank(grade: DailyEdgeConfidenceGrade): number {
  return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0;
}

function assertScore(score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("Daily Edge confidence score must be within [0,100].");
}

function assertBands(bands: DailyEdgeConfidenceBands): void {
  if (
    !Number.isFinite(bands.bestAngle) ||
    !Number.isFinite(bands.lean) ||
    !Number.isFinite(bands.watchlist) ||
    bands.bestAngle <= bands.lean ||
    bands.lean <= bands.watchlist ||
    bands.watchlist < 0 ||
    bands.bestAngle > 100
  ) throw new Error("Daily Edge confidence bands must be finite, ordered, and within [0,100].");
}

function cleanReason(value: string | null | undefined): string | null {
  const reason = value?.trim();
  return reason ? reason : null;
}
