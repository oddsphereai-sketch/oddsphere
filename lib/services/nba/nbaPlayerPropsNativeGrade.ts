import type { NbaPlayerPropsMemberGrade } from "./nbaPlayerPropsProductContract";

export const NBA_PLAYER_PROPS_NATIVE_GRADE_CALIBRATION_RELEASE =
  "nba_player_props_exact_price_grade_2026_11_23_r17_best_value" as const;
export const NBA_PLAYER_PROPS_NATIVE_GRADE_DECISION_RELEASE =
  "nba_player_props_forward_decision_2026_11_23_r16_best_value" as const;

export function assertNativeNbaGradePolicyLineage(source: {
  modelRelease: string;
  calibrationRelease: string;
}) {
  if (source.modelRelease !== "nba_player_props_model_tournament_2026_10_28_r16_owls_sharp_market_reader"
    || source.calibrationRelease !== "nba_player_props_exact_price_grade_2026_10_28_r15_owls_sharp_market_reader") {
    throw new Error("Native NBA grade policy requires its exact original fitted model and calibration.");
  }
}

/** Restore the shared Best Angle positive-value meaning after native ranking.
 * Confidence-led Leans and every other original native qualification are unchanged.
 * No cross-sport probability/price threshold or new candidate eligibility is added.
 * Only fresh production scoring calls this; readers never regrade stored rows.
 */
export function nativeNbaBestPriceGrade(
  candidate: NbaPlayerPropsMemberGrade,
  probability: number,
  americanPrice: number,
  expectedValue: number,
): NbaPlayerPropsMemberGrade {
  if (candidate !== "Best Angle") return candidate;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1
    || !Number.isSafeInteger(americanPrice) || Math.abs(americanPrice) < 100
    || !Number.isFinite(expectedValue)) {
    throw new Error("Native Best Angle requires a valid forecast probability and exact offered price.");
  }
  const breakEven = americanPrice > 0
    ? 100 / (americanPrice + 100)
    : -americanPrice / (-americanPrice + 100);
  // The published EV is independently rounded. A rounded probability must not
  // turn an encoded zero/negative EV into a new Best Angle through float dust.
  return probability > breakEven && expectedValue > 0 ? candidate : "Lean";
}
