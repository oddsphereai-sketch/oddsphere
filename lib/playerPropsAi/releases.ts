/** One authoritative identity path for the AI-assisted player-prop product. */
export const PROPS_AI_RELEASE = "player_props_ai_2026_11_07_r11_bounded_physical_rows" as const;
export const PROPS_AI_LAW_RELEASE = "player_props_ai_law_2026_11_06_r1_integer_scenarios" as const;
export const PROPS_AI_GRADE_RELEASE = "player_props_ai_grade_2026_11_06_r1_confidence_price" as const;
export const PROPS_AI_SCHEDULE_RELEASE = "player_props_ai_schedule_2026_11_06_r1_two_windows" as const;
export const PROPS_AI_BUDGET_RELEASE = "player_props_ai_budget_2026_11_07_r2_bounded_output" as const;
export const PROPS_AI_MONTHLY_CAP_MICRO_USD = 50_000_000;
export const PROPS_AI_RECOVERY_RESERVE_MICRO_USD = 3_000_000;
export const PROPS_AI_PRIMARY_SLOT_BY_SPORT = { nba: 32_000, nfl: 24_000, mlb: 38_000 } as const;
export const PROPS_AI_MAX_INPUT_PER_REQUEST = 145_000;
export const PROPS_AI_MAX_OUTPUT_PER_REQUEST = 7_000;
export const PROPS_AI_SCENARIOS = 16;
export const PROPS_AI_PRIMARY_MODEL = "gpt-6-luna" as const;
export const PROPS_AI_STRONG_MODEL = "gpt-6.1-terra" as const;
export type PropsAiModel = typeof PROPS_AI_PRIMARY_MODEL | typeof PROPS_AI_STRONG_MODEL;
