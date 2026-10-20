/**
 * Pure NBA independent-first final-score reconciliation. The score model owns
 * the starting margin and total. Separately qualified categorical reads may
 * re-orient only their decisions against the current lines; no fixed
 * market-consensus weight is allowed. When a read changes a decision, the
 * projection moves only as far as necessary to keep the Moneyline, Spread,
 * Total, and displayed score coherent instead of mirroring the entire
 * independent residual across the market line.
 *
 * It is not activated by merely importing it. Production callers must supply
 * the qualified independent release plus a complete market state and preserve
 * locked-record precedence.
 */

export const NBA_UNIFIED_FINAL_PROJECTION_CANDIDATE_RELEASE =
  "nba_unified_final_projection_2026_10_20_r4_minimum_coherent_crossing" as const;

export const NBA_UNIFIED_FINAL_RECIPE = {
  marginIndependentWeight: 1,
  totalIndependentWeight: 1,
  spreadMovementThreshold: 2,
  minimumSpreadResidual: 0.25,
  totalMovementThreshold: 5,
  minimumTotalResidual: 5,
  minimumDecisionSeparation: 0.25,
} as const;

export type NbaQualifiedSpreadRead = {
  side: "home" | "away";
  magnitudePoints: number;
};

export type NbaQualifiedTotalRead = {
  side: "over" | "under";
  magnitudePoints: number;
};

export type NbaUnifiedFinalProjectionInput = {
  independentHomeScore: number;
  independentAwayScore: number;
  currentSpreadHome: number | null;
  currentTotal: number | null;
  openingSpreadHome: number | null;
  qualifiedSpreadRead?: NbaQualifiedSpreadRead | null;
  qualifiedTotalRead?: NbaQualifiedTotalRead | null;
};

export type NbaUnifiedFinalProjection = {
  release: typeof NBA_UNIFIED_FINAL_PROJECTION_CANDIDATE_RELEASE;
  homeScore: number;
  awayScore: number;
  marginHome: number;
  total: number;
  spreadResidual: number | null;
  movementQualified: boolean;
  movementApplied: boolean;
  totalResidual: number | null;
  totalMovementQualified: boolean;
  totalMovementApplied: boolean;
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

function minimumCoherentMargin(args: {
  independentMargin: number;
  incumbentMargin: number;
  marketMargin: number;
  spreadDirection: -1 | 1;
}): number {
  const separation = NBA_UNIFIED_FINAL_RECIPE.minimumDecisionSeparation;
  let lower = Number.NEGATIVE_INFINITY;
  let upper = Number.POSITIVE_INFINITY;

  if (args.incumbentMargin >= 0) lower = Math.max(lower, separation);
  else upper = Math.min(upper, -separation);

  if (args.spreadDirection > 0) lower = Math.max(lower, args.marketMargin + separation);
  else upper = Math.min(upper, args.marketMargin - separation);

  // Executable NBA Spreads are whole or half points, so the interval should
  // be feasible. Preserve the incumbent projection if malformed input ever
  // makes the two decision constraints incompatible.
  if (lower > upper) return args.incumbentMargin;
  return Math.min(Math.max(args.independentMargin, lower), upper);
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
  let total = independentTotal;

  const spreadSupport = openingSpreadHome === null || currentSpreadHome === null
    ? null
    : openingSpreadHome - currentSpreadHome;
  const qualifiedSpreadRead = input.qualifiedSpreadRead ?? null;
  const movementQualified = qualifiedSpreadRead !== null &&
    Number.isFinite(qualifiedSpreadRead.magnitudePoints) &&
    qualifiedSpreadRead.magnitudePoints >= NBA_UNIFIED_FINAL_RECIPE.spreadMovementThreshold &&
    marketMargin !== null;

  let spreadResidual: number | null = marketMargin === null ? null : margin - marketMargin;
  let movementApplied = false;
  if (movementQualified && spreadResidual !== null && qualifiedSpreadRead !== null) {
    const direction = qualifiedSpreadRead.side === "home" ? 1 : -1;
    const residualSize = Math.max(
      Math.abs(spreadResidual),
      NBA_UNIFIED_FINAL_RECIPE.minimumSpreadResidual,
    );
    const incumbentResidual = direction * residualSize;
    const incumbentMargin = marketMargin! + incumbentResidual;
    movementApplied = Math.sign(spreadResidual) !== direction;
    if (movementApplied) {
      margin = minimumCoherentMargin({
        independentMargin,
        incumbentMargin,
        marketMargin: marketMargin!,
        spreadDirection: direction,
      });
      spreadResidual = margin - marketMargin!;
    }
  }

  let totalResidual: number | null = currentTotal === null ? null : total - currentTotal;
  const qualifiedTotalRead = input.qualifiedTotalRead ?? null;
  const totalMovementQualified = qualifiedTotalRead !== null &&
    Number.isFinite(qualifiedTotalRead.magnitudePoints) &&
    qualifiedTotalRead.magnitudePoints >= NBA_UNIFIED_FINAL_RECIPE.totalMovementThreshold &&
    currentTotal !== null && totalResidual !== null &&
    Math.abs(totalResidual) >= NBA_UNIFIED_FINAL_RECIPE.minimumTotalResidual;
  let totalMovementApplied = false;
  if (totalMovementQualified && totalResidual !== null && qualifiedTotalRead !== null) {
    const direction = qualifiedTotalRead.side === "over" ? 1 : -1;
    totalMovementApplied = Math.sign(totalResidual) !== direction;
    if (totalMovementApplied) {
      totalResidual = direction * NBA_UNIFIED_FINAL_RECIPE.minimumDecisionSeparation;
      total = currentTotal! + totalResidual;
    }
  }

  return {
    release: NBA_UNIFIED_FINAL_PROJECTION_CANDIDATE_RELEASE,
    homeScore: (total + margin) / 2,
    awayScore: (total - margin) / 2,
    marginHome: margin,
    total,
    spreadResidual,
    movementQualified,
    movementApplied,
    totalResidual,
    totalMovementQualified,
    totalMovementApplied,
    marketApplied: {
      margin: movementApplied,
      total: totalMovementApplied,
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
