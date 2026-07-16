import type { PropModelPrediction } from "./models";

export const PROJECTION_SIDE_CONTRADICTION = "PROJECTION_SIDE_CONTRADICTION" as const;

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
