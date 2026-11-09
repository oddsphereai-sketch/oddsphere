/** One authoritative identity path for the AI-assisted player-prop product. */
export const PROPS_AI_RELEASE = "player_props_ai_2026_11_09_r22_complete_sentences" as const;
export const PROPS_AI_ACCEPTED_RELEASES=[PROPS_AI_RELEASE,"player_props_ai_2026_11_09_r21_flex_capacity_alias","player_props_ai_2026_11_09_r20_rejection_evidence","player_props_ai_2026_11_09_r19_current_execution","player_props_ai_2026_11_09_r18_forecast_semantics","player_props_ai_2026_11_08_r17_nfl_input_status","player_props_ai_2026_11_08_r16_nfl_output_headroom","player_props_ai_2026_11_08_r15_review_window_handoff"] as const;
export const PROPS_AI_UNCHECKED_LEGACY_RELEASES:readonly string[]=["player_props_ai_2026_11_08_r17_nfl_input_status","player_props_ai_2026_11_08_r16_nfl_output_headroom","player_props_ai_2026_11_08_r15_review_window_handoff"];
export function propsReviewHasSemanticChecks(release:string){return (PROPS_AI_ACCEPTED_RELEASES as readonly string[]).includes(release)&&!PROPS_AI_UNCHECKED_LEGACY_RELEASES.includes(release);}
export const PROPS_AI_NFL_TARGET_ACTORS_PER_PART=4;
export const PROPS_AI_NFL_DECISION_RELEASE="player_props_ai_nfl_decision_2026_11_09_r9_current_execution" as const;
export const PROPS_AI_SELECTION_RELEASE="player_props_ai_selection_2026_11_09_r2_current_execution" as const;
export const PROPS_AI_NFL_EXACT_RECEIPT_RELEASES:readonly string[]=[PROPS_AI_NFL_DECISION_RELEASE,"player_props_ai_nfl_decision_2026_11_08_r8_player_scope_publication","player_props_ai_nfl_decision_2026_11_08_r7_verified_current_actors","player_props_ai_nfl_decision_2026_11_08_r6_exact_quote_receipts"];
export const PROPS_AI_ESTIMATE_RELEASE="player_props_ai_estimate_2026_11_07_r1_not_empirically_calibrated" as const;
export const PROPS_AI_LAW_RELEASE = "player_props_ai_law_2026_11_06_r1_integer_scenarios" as const;
export const PROPS_AI_GRADE_RELEASE = "player_props_ai_grade_2026_11_09_r2_current_price" as const;
export const PROPS_AI_SCHEDULE_RELEASE = "player_props_ai_schedule_2026_11_08_r3_no_late_early_purchase" as const;
export const PROPS_AI_BUDGET_RELEASE = "player_props_ai_budget_2026_11_08_r4_target_and_emergency" as const;
export const PROPS_AI_MONTHLY_TARGET_MICRO_USD = 50_000_000;
export const PROPS_AI_MONTHLY_CAP_MICRO_USD = 60_000_000;
export const PROPS_AI_RECOVERY_RESERVE_MICRO_USD = 3_000_000;
export const PROPS_AI_MAX_INPUT_PER_REQUEST = 145_000;
export const PROPS_AI_MAX_OUTPUT_PER_REQUEST = 7_000;
export const PROPS_AI_MAX_PARTS = 16;
export const PROPS_AI_PART_CONCURRENCY = 8;
export const PROPS_AI_MIN_REVIEW_WINDOW_MS = 120_000;
export const PROPS_AI_SCENARIOS = 16;
export const PROPS_AI_PRIMARY_MODEL = "gpt-6-luna" as const;
export const PROPS_AI_STRONG_MODEL = "gpt-6.1-terra" as const;
export type PropsAiModel = typeof PROPS_AI_PRIMARY_MODEL | typeof PROPS_AI_STRONG_MODEL;
