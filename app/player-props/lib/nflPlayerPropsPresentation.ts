type NflPlayerPropsAvailabilityTimestamps = {
  reportedAt: string | null;
  reportUpdatedAt: string | null;
};

export const NFL_PLAYER_PROPS_PRESENTATION_RELEASE =
  "nfl_player_props_presentation_2026_10_06_r1_touchdown_opening_integrity" as const;

export function hasComparableNflPlayerPropsOpening(args: {
  market: string;
  line: number;
  openingObservedAt: string | null;
  openingLine: number | null;
  openingAmericanPrice: number | null;
}): boolean {
  if (!args.openingObservedAt || args.openingAmericanPrice === null) return false;
  return args.market !== "anytime_td" || args.openingLine === args.line;
}

export type NflPlayerPropsPredictionOutcome = "over" | "under" | "yes" | "no";

export type NflPlayerPropsPrediction<T> = {
  outcome: NflPlayerPropsPredictionOutcome;
  probability: number;
  projection: number | null;
  row: T;
  quotedSide: "over" | "under" | "yes" | null;
};

export type NflPlayerPropsActionableForecast<T> = {
  prediction: NflPlayerPropsPrediction<T>;
  row: T;
};

export {
  nflPlayerPropsOverUnderMarketKey,
  nflPlayerPropsTouchdownPlayerKey,
  selectNflPlayerPropsOverForecasts,
  selectNflPlayerPropsTouchdownScorers,
} from "@/lib/services/football/nflPlayerPropsPrediction";

/**
 * Resolves the board's forecast from the published projection and exact line.
 * Grade, expected value, and slate-level side prevalence deliberately do not
 * choose a different displayed prediction.
 */
export function resolveNflPlayerPropsPrediction<
  T extends {
    side: "over" | "under" | "yes";
    finalProbability: number;
    line: number;
    projection: number | null;
  },
>(rows: readonly T[], options?: { touchdownPositive?: boolean }): NflPlayerPropsPrediction<T> | null {
  const yes = rows.find((row) => row.side === "yes");
  if (yes) {
    const touchdownPositive = options?.touchdownPositive ?? yes.finalProbability >= 0.5;
    return touchdownPositive
      ? { outcome: "yes", probability: yes.finalProbability, projection: null, row: yes, quotedSide: "yes" }
      : { outcome: "no", probability: 1 - yes.finalProbability, projection: null, row: yes, quotedSide: null };
  }

  const over = rows.find((row) => row.side === "over");
  const under = rows.find((row) => row.side === "under");
  if (!over && !under) return null;

  const overProbability = over?.finalProbability ?? 1 - under!.finalProbability;
  const underProbability = under?.finalProbability ?? 1 - over!.finalProbability;
  const projections = rows
    .map((row) => row.projection)
    .filter((projection): projection is number => Number.isFinite(projection))
    .sort((left, right) => left - right);
  const midpoint = Math.floor(projections.length / 2);
  const projection = projections.length === 0
    ? null
    : projections.length % 2 === 1
      ? projections[midpoint]!
      : (projections[midpoint - 1]! + projections[midpoint]!) / 2;
  const line = rows[0]!.line;
  const overPositive = projection !== null
    ? projection > line || (projection === line && overProbability >= underProbability)
    : overProbability >= underProbability;
  if (overPositive) {
    return {
      outcome: "over",
      probability: overProbability,
      projection,
      row: over ?? under!,
      quotedSide: over ? "over" : null,
    };
  }
  return {
    outcome: "under",
    probability: underProbability,
    projection,
    row: under ?? over!,
    quotedSide: under ? "under" : null,
  };
}

/**
 * Returns an actionable exact-price row only when its side agrees with the
 * canonical projection resolved across the displayed market pair. This keeps
 * the radar and headline counts from promoting one quote-specific forecast
 * against the board's single player/market prediction.
 */
export function resolveNflPlayerPropsActionableForecast<
  T extends {
    side: "over" | "under" | "yes";
    finalProbability: number;
    line: number;
    projection: number | null;
    grade: string;
    expectedValue: number;
  },
>(rows: readonly T[], options?: { touchdownPositive?: boolean }): NflPlayerPropsActionableForecast<T> | null {
  const prediction = resolveNflPlayerPropsPrediction(rows, options);
  if (!prediction?.quotedSide) return null;
  const candidates = rows
    .filter((row) => row.side === prediction.quotedSide && (row.grade === "Best Angle" || row.grade === "Lean"))
    .sort((left, right) => actionableGradeRank(left.grade) - actionableGradeRank(right.grade)
      || right.expectedValue - left.expectedValue);
  return candidates[0] ? { prediction, row: candidates[0] } : null;
}

function actionableGradeRank(grade: string): number {
  return grade === "Best Angle" ? 0 : grade === "Lean" ? 1 : 2;
}


export function nflPlayerPropsAvailabilityAgeLabel(
  availability: NflPlayerPropsAvailabilityTimestamps,
  featureAsOf: string,
): string | null {
  const report = availability.reportedAt ?? availability.reportUpdatedAt;
  const ageHours = report ? (Date.parse(featureAsOf) - Date.parse(report)) / 3_600_000 : NaN;
  if (!Number.isFinite(ageHours) || ageHours < 0) return null;
  if (ageHours < 1) return "<1h old";
  if (ageHours < 48) return `${Math.floor(ageHours)}h old`;
  return `${Math.floor(ageHours / 24)}d old`;
}
