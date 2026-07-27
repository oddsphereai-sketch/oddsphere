/**
 * First Inning prediction_records.edge is stored as a probability delta (for
 * example, 0.069 means 6.9 percentage points). Moneyline and Total records
 * already store percentage points and must not pass through this conversion.
 */
export function predictionRecordFirstInningEdgeToPercentagePoints(
  edge: number | null | undefined,
): number | null {
  if (typeof edge !== "number" || !Number.isFinite(edge)) return null;
  return +(edge * 100).toFixed(2);
}
