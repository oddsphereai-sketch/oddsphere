import type { PlayerPropPreviewRow } from "@/app/mlb/props/components/PlayerPropsDashboard";

export const MLB_PROPS_BEST_ANGLE_PRICE_FLOOR = -200;
export const MLB_PROPS_ACTIONABLE_PRICE_FLOOR = -400;

export type MlbPropsPriceConfidenceReason =
  | "PRICE_CONFIDENCE_CAP_LEAN"
  | "PRICE_CONFIDENCE_CAP_WATCHLIST";

export function mlbPropsGradeAfterPriceConfidence(args: {
  grade: PlayerPropPreviewRow["playGrade"];
  price: number;
  offerContract?: PlayerPropPreviewRow["offerContract"];
  locked?: boolean;
}): {
  grade: PlayerPropPreviewRow["playGrade"];
  reasonCode: MlbPropsPriceConfidenceReason | null;
} {
  if (
    args.locked
    || args.offerContract === "milestone"
    || !Number.isFinite(args.price)
    || (args.grade !== "BEST_ANGLE" && args.grade !== "LEAN")
  ) return { grade: args.grade, reasonCode: null };

  if (args.price < MLB_PROPS_ACTIONABLE_PRICE_FLOOR) {
    return { grade: "WATCHLIST", reasonCode: "PRICE_CONFIDENCE_CAP_WATCHLIST" };
  }
  if (args.grade === "BEST_ANGLE" && args.price < MLB_PROPS_BEST_ANGLE_PRICE_FLOOR) {
    return { grade: "LEAN", reasonCode: "PRICE_CONFIDENCE_CAP_LEAN" };
  }
  return { grade: args.grade, reasonCode: null };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function applyMlbPropsPriceConfidenceCeilings(
  rows: PlayerPropPreviewRow[],
): PlayerPropPreviewRow[] {
  return rows.map((row) => {
    const result = mlbPropsGradeAfterPriceConfidence({
      grade: row.playGrade,
      price: row.odds,
      offerContract: row.offerContract,
      locked: row.lockStatus?.status === "locked",
    });
    if (result.grade === row.playGrade) return row;
    return {
      ...row,
      playGrade: result.grade,
      units: result.grade === "WATCHLIST" ? 0 : row.units,
      reasonCodes: result.reasonCode
        ? uniqueStrings([...row.reasonCodes, result.reasonCode])
        : row.reasonCodes,
    };
  });
}
