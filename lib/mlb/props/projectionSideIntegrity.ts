import type { PropModelPrediction } from "./models";

export const PROJECTION_SIDE_CONTRADICTION = "PROJECTION_SIDE_CONTRADICTION" as const;

type ProjectionActionabilityRow = {
  market: string;
  offerContract?: string | null;
  side: "over" | "under";
  line: number;
  projection: number | null | undefined;
  playGrade: string;
  units: number;
  reasonCodes: string[];
  lockStatus?: { status?: string | null } | null;
};

export type ProjectionSideIntegrity = {
  status: "coherent" | "contradiction" | "unavailable";
  projection: number | null;
};

export function checkProjectionSideIntegrity(args: {
  side: "over" | "under";
  line: number;
  projection: number | null | undefined;
}): ProjectionSideIntegrity {
  if (typeof args.projection !== "number" || !Number.isFinite(args.projection) || !Number.isFinite(args.line)) {
    return { status: "unavailable", projection: null };
  }

  const coherent = args.side === "over"
    ? args.projection > args.line
    : args.projection < args.line;

  return {
    status: coherent ? "coherent" : "contradiction",
    projection: args.projection,
  };
}

/**
 * Final fail-closed actionability check for the fully calibrated member row.
 *
 * Probability and projection calibration deliberately remain independent of
 * exact-price grade policy. Once both are final, however, an ordinary
 * two-sided offer cannot retain an actionable grade when its displayed
 * expected count points through the evaluated line in the opposite direction.
 * One-sided 1+ Home Run milestone offers keep their intentional event-value
 * semantics, and immutable locked rows are never reinterpreted.
 */
export function applyMlbPropsProjectionSideActionability<
  Row extends ProjectionActionabilityRow,
>(rows: readonly Row[]): Row[] {
  return rows.map((row) => {
    if (row.lockStatus?.status === "locked") return row;
    if (row.playGrade !== "BEST_ANGLE" && row.playGrade !== "LEAN") return row;
    const oneSidedHomeRunMilestone = row.market === "batter_home_runs"
      && row.offerContract === "milestone";
    if (oneSidedHomeRunMilestone) return row;
    const integrity = checkProjectionSideIntegrity({
      side: row.side,
      line: row.line,
      projection: row.projection,
    });
    if (integrity.status !== "contradiction") return row;
    return {
      ...row,
      playGrade: "WATCHLIST",
      units: 0,
      reasonCodes: [...new Set([...row.reasonCodes, PROJECTION_SIDE_CONTRADICTION])],
    } as Row;
  });
}

export function projectionFromPrediction(prediction: PropModelPrediction): number | null {
  const explanation = prediction.explanation;
  const directKeys = ["projectedValue", "projectedStrikeouts", "projectedOuts"];
  for (const key of directKeys) {
    const value = explanation[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  const distribution = explanation.distribution;
  if (!distribution || typeof distribution !== "object") return null;
  for (const key of directKeys) {
    const value = (distribution as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function predictionProjectionSideIntegrity(prediction: PropModelPrediction): ProjectionSideIntegrity {
  return checkProjectionSideIntegrity({
    side: prediction.side,
    line: prediction.line,
    projection: projectionFromPrediction(prediction),
  });
}
