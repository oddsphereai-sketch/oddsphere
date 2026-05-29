/**
 * Phase 4B — pure helper deriving the directional reading of a per-pick
 * grade for stale-detection rule 10 (Phase 4A planning §4.1 row 10).
 *
 * Grade vocabulary lives in lib/types/domain/Grade.ts. This module maps
 * each Grade value into one of three directions used by the stale
 * detector:
 *
 *   support:   model + market are aligned → the pick is being
 *              REINFORCED by sharp market behavior
 *                best_signal | sharp_confirmed | market_led
 *
 *   conflict:  sharps disagree with the model → the pick is being
 *              CHALLENGED by sharp market behavior
 *                sharp_conflict
 *
 *   neutral:   no strong directional signal either way
 *                model_only | market_watch | public_smoke
 *
 * The `MarketSignal` value "market_resistance" (an intermediate Layer 3
 * signal) is NOT a Grade — it only appears on the per-pick
 * ml_market_signal / ou_market_signal / nrfi_market_signal columns. This
 * helper intentionally only maps the FINAL Grade, since stale rule 10
 * compares prior vs current final grade direction.
 *
 * Pure module. No I/O. No env. No DB.
 */

/**
 * Map one Grade value (or null) to a direction. Null in → null out.
 * Unknown strings → null (defensive — keeps callers from crashing if a
 * new Grade lands without this helper being updated).
 */
export function deriveSharpGradeDirection(
  grade: string | null | undefined
): "support" | "conflict" | "neutral" | null {
  if (grade === null || grade === undefined) return null;
  switch (grade) {
    case "best_signal":
    case "sharp_confirmed":
    case "market_led":
      return "support";
    case "sharp_conflict":
      return "conflict";
    case "model_only":
    case "market_watch":
    case "public_smoke":
      return "neutral";
    default:
      return null;
  }
}

/**
 * Aggregate the three per-pick grades on a prediction row into a single
 * directional reading. Used by the stale detector to characterize the
 * row's overall sharp grade direction at prior-run time.
 *
 * Aggregation rule (priority order):
 *   1. If ANY of the 3 picks is "support" → row direction is "support"
 *   2. Else if ANY is "conflict"          → "conflict"
 *   3. Else if ANY is "neutral"           → "neutral"
 *   4. Else (all three null)              → null
 *
 * Rationale: a row with one supporting pick is a "supporting" row for
 * stale comparison; if subsequent sharp action flips that one pick to
 * conflict, rule 10 fires even if the other two picks were already
 * neutral. Pinning to the strongest direction preserves the operator's
 * intuition that "this row was sharp-aligned; now it's sharp-opposed."
 */
export function deriveRowSharpGradeDirection(row: {
  ml_grade?: string | null;
  ou_grade?: string | null;
  nrfi_grade?: string | null;
}): "support" | "conflict" | "neutral" | null {
  const dirs = [
    deriveSharpGradeDirection(row.ml_grade),
    deriveSharpGradeDirection(row.ou_grade),
    deriveSharpGradeDirection(row.nrfi_grade),
  ];
  if (dirs.includes("support")) return "support";
  if (dirs.includes("conflict")) return "conflict";
  if (dirs.includes("neutral")) return "neutral";
  return null;
}
