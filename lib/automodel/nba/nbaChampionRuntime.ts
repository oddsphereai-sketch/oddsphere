export const NBA_MODEL_RELEASE =
  "nba_professional_unified_2026_10_16_r5_market_specific_grades" as const;
export const NBA_MARKET_MARRIAGE_RELEASE =
  "nba_market_marriage_2026_10_16_r4_independent_first_total_disagreement" as const;
export const NBA_GRADE_POLICY_RELEASE =
  "nba_grade_policy_2026_10_16_r5_market_specific_accuracy" as const;
export const NBA_PREDICTION_RECORD_RELEASE = NBA_MODEL_RELEASE;

export function assertNbaChampionRuntime(): void {
  if (NBA_PREDICTION_RECORD_RELEASE !== NBA_MODEL_RELEASE) {
    throw new Error("NBA runtime release mismatch");
  }
}
