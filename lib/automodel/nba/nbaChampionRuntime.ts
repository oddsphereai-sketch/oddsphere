export const NBA_MODEL_RELEASE =
  "nba_professional_unified_2026_10_21_r14_rating_identity_verified_availability" as const;
export const NBA_MARKET_MARRIAGE_RELEASE =
  "nba_market_marriage_2026_10_21_r16_complete_team_rating_inputs" as const;
export const NBA_GRADE_POLICY_RELEASE =
  "nba_grade_policy_2026_10_21_r8_rating_identity_no_count_cap" as const;
export const NBA_PREDICTION_RECORD_RELEASE = NBA_MODEL_RELEASE;

export function assertNbaChampionRuntime(): void {
  if (NBA_PREDICTION_RECORD_RELEASE !== NBA_MODEL_RELEASE) {
    throw new Error("NBA runtime release mismatch");
  }
}
