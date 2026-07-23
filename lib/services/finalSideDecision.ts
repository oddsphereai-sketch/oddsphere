export type DailyEdgeBinaryMarket = "moneyline" | "total";

type Row = Record<string, unknown>;

function record(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null;
}

function side(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value.toLowerCase() : null;
}

/**
 * A correction helper can fire and then be reversed by a later calibration
 * layer. Only the side finally written to prediction_records is official.
 */
export function didFinalSideChange(originalSide: unknown, finalSide: unknown): boolean {
  const original = side(originalSide);
  const final = side(finalSide);
  return original !== null && final !== null && original !== final;
}

export function snapshotHasFinalSideCorrection(
  snapshot: unknown,
  market: DailyEdgeBinaryMarket,
): boolean {
  const root = record(snapshot);
  if (root === null) return false;

  const decision = record(root.decision_pipeline);
  if (decision !== null && decision.market === market) {
    if (typeof decision.final_side_changed === "boolean") {
      return decision.final_side_changed;
    }
    const original = decision.original_side ?? decision.original_pick;
    const final = decision.final_side ?? decision.final_pick;
    if (side(original) !== null && side(final) !== null) {
      return didFinalSideChange(original, final);
    }
  }

  const flip = record(root[market === "moneyline" ? "ml_flip" : "ou_flip"]);
  if (flip !== null) {
    const original =
      flip.original_side ??
      flip.original_probability_side ??
      flip.original_pick;
    const final =
      flip.final_side ??
      flip.final_pick ??
      flip.flipped_side ??
      flip.flipped_pick;
    if (side(original) !== null && side(final) !== null) {
      return didFinalSideChange(original, final);
    }
    return flip.flipped === true;
  }

  const correction = record(root.market_aware_side_correction);
  if (correction !== null && correction.market === market) {
    const original = correction.original_side ?? correction.original_pick;
    const final = correction.corrected_side ?? correction.corrected_pick;
    if (side(original) !== null && side(final) !== null) {
      return didFinalSideChange(original, final);
    }
    return correction.applied === true;
  }

  return false;
}

/** True only for the ML inversion rule, not pick-calibration or market-aware corrections. */
export function snapshotHasTrueMoneylineInversion(snapshot: unknown): boolean {
  const root = record(snapshot);
  if (root === null) return false;
  const decision = record(root.decision_pipeline);
  if (
    decision !== null &&
    decision.market === "moneyline" &&
    decision.inversion_triggered === true
  ) {
    return decision.final_side_changed === true ||
      didFinalSideChange(decision.original_side, decision.final_side);
  }
  return record(root.ml_flip) !== null &&
    snapshotHasFinalSideCorrection(root, "moneyline");
}
