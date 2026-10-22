export const NBA_MODEL_RELEASE =
  "nba_professional_unified_2026_10_22_r17_roster_winner_confirmation" as const;
export const NBA_MARKET_MARRIAGE_RELEASE =
  "nba_market_marriage_2026_10_22_r19_roster_winner_confirmation" as const;
export const NBA_GRADE_POLICY_RELEASE =
  "nba_grade_policy_2026_10_22_r11_roster_winner_confirmation" as const;
export const NBA_PREDICTION_RECORD_RELEASE = NBA_MODEL_RELEASE;

export function assertNbaChampionRuntime(): void {
  if (NBA_PREDICTION_RECORD_RELEASE !== NBA_MODEL_RELEASE) {
    throw new Error("NBA runtime release mismatch");
  }
}
