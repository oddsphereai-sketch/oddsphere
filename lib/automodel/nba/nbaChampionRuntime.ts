export const NBA_MODEL_RELEASE =
  "nba_professional_unified_2026_11_23_r39_request_scoped_roster" as const;
export const NBA_PREVIOUS_MODEL_RELEASE =
  "nba_professional_unified_2026_11_20_r38_event_scoped_split_evidence" as const;
/** Exact compatible input-only predecessors; never an arbitrary release search. */
export const NBA_COMPATIBLE_KNOWLEDGE_MODEL_RELEASES = [NBA_PREVIOUS_MODEL_RELEASE,
  "nba_professional_unified_2026_11_20_r37_event_scoped_evidence",
  "nba_professional_unified_2026_11_04_r36_paid_consumer_book_coverage",
  "nba_professional_unified_2026_11_04_r35_native_consumer_pairs",
  "nba_professional_unified_2026_11_04_r34_own_book_pressure"] as const;
export const NBA_MARKET_MARRIAGE_RELEASE =
  "nba_market_marriage_2026_11_23_r41_request_scoped_roster" as const;
export const NBA_GRADE_POLICY_RELEASE =
  "nba_grade_policy_2026_11_06_r31_moneyline_wager_price_boundaries" as const;
export const NBA_PREDICTION_RECORD_RELEASE = NBA_MODEL_RELEASE;

export function assertNbaChampionRuntime(): void {
  if (NBA_PREDICTION_RECORD_RELEASE !== NBA_MODEL_RELEASE) {
    throw new Error("NBA runtime release mismatch");
  }
}
