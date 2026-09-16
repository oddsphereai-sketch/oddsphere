type NflPlayerPropsAvailabilityTimestamps = {
  reportedAt: string | null;
  reportUpdatedAt: string | null;
};

export type NflPlayerPropsPredictionOutcome = "over" | "under" | "yes" | "no";

export type NflPlayerPropsPrediction<T> = {
  outcome: NflPlayerPropsPredictionOutcome;
  probability: number;
  row: T;
  quotedSide: "over" | "under" | "yes" | null;
};

export {
  nflPlayerPropsOverUnderMarketKey,
  nflPlayerPropsTouchdownPlayerKey,
  selectNflPlayerPropsOverForecasts,
  selectNflPlayerPropsTouchdownScorers,
} from "@/lib/services/football/nflPlayerPropsPrediction";

/**
 * Resolves the board's forecast from the calibrated, market-aware probability.
 * Grade and expected value deliberately do not choose the displayed prediction.
 */
export function resolveNflPlayerPropsPrediction<
  T extends { side: "over" | "under" | "yes"; finalProbability: number },
>(rows: readonly T[], options?: { touchdownPositive?: boolean; overPositive?: boolean }): NflPlayerPropsPrediction<T> | null {
  const yes = rows.find((row) => row.side === "yes");
  if (yes) {
    const touchdownPositive = options?.touchdownPositive ?? yes.finalProbability >= 0.5;
    return touchdownPositive
      ? { outcome: "yes", probability: yes.finalProbability, row: yes, quotedSide: "yes" }
      : { outcome: "no", probability: 1 - yes.finalProbability, row: yes, quotedSide: null };
  }

  const over = rows.find((row) => row.side === "over");
  const under = rows.find((row) => row.side === "under");
  if (!over && !under) return null;

  const overProbability = over?.finalProbability ?? 1 - under!.finalProbability;
  const underProbability = under?.finalProbability ?? 1 - over!.finalProbability;
  if (options?.overPositive ?? overProbability >= underProbability) {
    return {
      outcome: "over",
      probability: overProbability,
      row: over ?? under!,
      quotedSide: over ? "over" : null,
    };
  }
  return {
    outcome: "under",
    probability: underProbability,
    row: under ?? over!,
    quotedSide: under ? "under" : null,
  };
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
