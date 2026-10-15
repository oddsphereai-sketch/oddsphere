/**
 * Pure NBA final-score reconciliation selected chronologically on 2024-25
 * and confirmed once on 2025-26. This module owns point projection only;
 * exact-price probability, target-book exclusion, and grading remain separate
 * downstream responsibilities.
 *
 * It is not activated by merely importing it. Production callers must supply
 * the qualified independent release plus a complete market state and preserve
 * locked-record precedence.
 */

export const NBA_UNIFIED_FINAL_PROJECTION_CANDIDATE_RELEASE =
  "nba_unified_final_projection_2026_10_15_r1_coherent_score" as const;

export const NBA_UNIFIED_FINAL_RECIPE = {
  marginIndependentWeight: 0.25,
  totalIndependentWeight: 0.25,
  spreadMovementThreshold: 2,
  minimumSpreadResidual: 0.25,
} as const;

export type NbaUnifiedFinalProjectionInput = {
  independentHomeScore: number;
  independentAwayScore: number;
  currentSpreadHome: number | null;
  currentTotal: number | null;
  openingSpreadHome: number | null;
};

export type NbaUnifiedFinalProjection = {
  release: typeof NBA_UNIFIED_FINAL_PROJECTION_CANDIDATE_RELEASE;
  homeScore: number;
  awayScore: number;
  marginHome: number;
  total: number;
  spreadResidual: number | null;
  movementApplied: boolean;
  marketApplied: {
    margin: boolean;
    total: boolean;
  };
  audit: {
    independentMarginHome: number;
    independentTotal: number;
    marketMarginHome: number | null;
    marketTotal: number | null;
    spreadMovementHomeSupport: number | null;
  };
};

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

/**
 * Reconciles exactly one margin and one total, then derives both team scores.
 * No market path is allowed to mutate a side independently of this score.
 */
export function buildNbaUnifiedFinalProjection(
  input: NbaUnifiedFinalProjectionInput,
): NbaUnifiedFinalProjection {
  if (!Number.isFinite(input.independentHomeScore) || !Number.isFinite(input.independentAwayScore)) {
    throw new Error("NBA unified projection requires finite independent team scores.");
  }
  const independentMargin = input.independentHomeScore - input.independentAwayScore;
  const independentTotal = input.independentHomeScore + input.independentAwayScore;
  const currentSpreadHome = finiteOrNull(input.currentSpreadHome);
  const currentTotal = finiteOrNull(input.currentTotal);
  const openingSpreadHome = finiteOrNull(input.openingSpreadHome);
  const marketMargin = currentSpreadHome === null ? null : -currentSpreadHome;

  let margin = independentMargin;
  if (marketMargin !== null) {
    margin =
      NBA_UNIFIED_FINAL_RECIPE.marginIndependentWeight * independentMargin +
      (1 - NBA_UNIFIED_FINAL_RECIPE.marginIndependentWeight) * marketMargin;
  }
  const total = currentTotal === null
    ? independentTotal
    : NBA_UNIFIED_FINAL_RECIPE.totalIndependentWeight * independentTotal +
      (1 - NBA_UNIFIED_FINAL_RECIPE.totalIndependentWeight) * currentTotal;

  const spreadSupport = openingSpreadHome === null || currentSpreadHome === null
    ? null
    : openingSpreadHome - currentSpreadHome;
  const movementApplied = spreadSupport !== null &&
    Math.abs(spreadSupport) >= NBA_UNIFIED_FINAL_RECIPE.spreadMovementThreshold &&
    marketMargin !== null;

  let spreadResidual: number | null = marketMargin === null ? null : margin - marketMargin;
  if (movementApplied && spreadResidual !== null && spreadSupport !== null) {
    const residualSize = Math.max(
      Math.abs(spreadResidual),
      NBA_UNIFIED_FINAL_RECIPE.minimumSpreadResidual,
    );
    spreadResidual = Math.sign(spreadSupport) * residualSize;
    margin = marketMargin! + spreadResidual;
  }

  return {
    release: NBA_UNIFIED_FINAL_PROJECTION_CANDIDATE_RELEASE,
    homeScore: (total + margin) / 2,
    awayScore: (total - margin) / 2,
    marginHome: margin,
    total,
    spreadResidual,
    movementApplied,
    marketApplied: {
      margin: marketMargin !== null,
      total: currentTotal !== null,
    },
    audit: {
      independentMarginHome: independentMargin,
      independentTotal,
      marketMarginHome: marketMargin,
      marketTotal: currentTotal,
      spreadMovementHomeSupport: spreadSupport,
    },
  };
}

