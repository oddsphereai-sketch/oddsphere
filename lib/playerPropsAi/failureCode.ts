/** Allowlisted operational codes only: never log raw API bodies, keys or inputs. */
export const PROPS_AI_DIAGNOSTIC_RELEASE="player_props_ai_operations_2026_11_09_r2_private_failure_evidence" as const;
const known:Readonly<Record<string,string>>={
 "Conflicting NFL provider player identity":"nfl_provider_identity_conflict",
 "Conflicting NFL player-team identity":"nfl_player_team_conflict",
 "Ambiguous NFL captured player":"nfl_captured_player_ambiguous",
 "NFL complete source has no offered supported players":"nfl_no_offered_players",
 "NBA retail offered-player identity incomplete":"nba_retail_player_identity_incomplete",
 "NBA player/team matchup identity incomplete":"nba_player_team_identity_incomplete",
 "NBA live game missing from captured source":"nba_captured_game_missing",
 "Duplicate/unattributed evidence":"duplicate_or_unattributed_evidence",
 "Duplicate/empty player identity":"duplicate_or_empty_player_identity",
 "Quote outside declared player/market scope":"quote_scope_mismatch",
 "Invalid line/odds":"invalid_line_or_price",
 "Future/reversed quote chronology":"quote_chronology_invalid",
 "Only game-day reviews permitted":"not_game_day",
 "complete_player_evidence_exceeds_bounded_partition_capacity":"partition_capacity_exceeded",
 "single_player_evidence_exceeds_request_bound":"single_player_capacity_exceeded",
 "partition_player_coverage_mismatch":"partition_player_coverage_mismatch",
 "input_outside_actual_review_window":"input_outside_actual_review_window",
 "job_input_identity_mismatch":"job_input_identity_mismatch",
 "invalid_input_token_count":"invalid_input_token_count",
 "fetch failed":"transport_failure",
};
export function propsAiFailureCode(error:unknown):string{
 if(!(error instanceof Error))return "unclassified";
 if(known[error.message])return known[error.message];
 if(/^input_count_http_[1-5][0-9]{2}$/.test(error.message))return error.message;
 if(/^NFL offered-player identity coverage incomplete:[0-9]+$/.test(error.message))return "nfl_offered_player_identity_incomplete";
 if(error.message.startsWith("Future evidence: "))return "future_evidence";
 if(error.name==="TimeoutError"||error.name==="AbortError")return "source_or_preparation_timeout";
 return "unclassified";
}
