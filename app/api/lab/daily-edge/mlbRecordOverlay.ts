function readRecordObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * An unlocked Moneyline prediction record can be older than a newer Total or
 * first-inning record from the same writer cycle family. The record remains
 * authoritative for its calibrated Moneyline pick, but its game-wide snapshot
 * must not replace newer current sport context (notably completeness, current
 * prices, posted lines, or the other markets' audits).
 *
 * Carry only the calibration audit needed to keep the calibrated Moneyline
 * from being recalculated at read time. Pick, confidence, probability, grade,
 * and exact-price fields are overlaid separately from the record columns.
 */
export function mergeUnlockedMlbMoneylineCalibrationContext(
  current: Record<string, unknown>,
  recordSnapshot: Record<string, unknown> | null,
): Record<string, unknown> {
  const pickCalibration = readRecordObject(recordSnapshot?.pick_calibration);
  if (pickCalibration?.applied !== true) return current;
  return {
    ...current,
    pick_calibration: pickCalibration,
  };
}
