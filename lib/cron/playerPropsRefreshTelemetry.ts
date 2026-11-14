import {propsAiRuntimeFailure,type PropsAiRuntimeHealth} from "../playerPropsAi/runtimeHealth";
import type { MlbPropsBoardRefreshResult } from "@/lib/mlb/props/liveBoard";
import type { NbaPlayerPropsPrivateWriterResult } from "@/lib/services/nba/nbaPlayerPropsPrivateWriter";

/** Report-only: retaining a board is successful continuity, not a fresh refresh. */
export function nbaPlayerPropsRefreshFailure(
  result: Pick<NbaPlayerPropsPrivateWriterResult, "status"|"aiReviewRuntime">,
): string | null {
  if(result.aiReviewRuntime?.status==='unavailable')return 'NBA player props AI process unavailable; scheduled review coverage unverified';
  if(result.aiReviewRuntime?.findings.some(f=>/^(?:source_or_review_unavailable:|lock_source_unavailable:|lock_prior_authority_unavailable|review_unavailable:|review_deferred_writer_|review_preparation_deferred_|calendar_identity_unavailable|pending_review_inventory_exceeds_two_slots_per_game|ai_unavailable:|due_review_read_failed|ai_operational_fallback_keep_independent|ai_process_finding_redacted)/.test(f)))return 'NBA player props AI preparation or review incomplete; scheduled coverage unverified';
  return result.status === "bootstrap_required" || result.status === "last_known_good_preserved"
    ? `NBA player props ${result.status}; fresh publication unavailable`
    : null;
}

/** The official schedule was read successfully by refreshMlbPropsBoard. Never
 * excuse a populated slate, mapping failure, or any additional validation error.
 * This only classifies telemetry: no candidate is published or rewritten. */
export function isInactiveMlbPropsRefresh(result: MlbPropsBoardRefreshResult): boolean {
  return !result.published
    && result.snapshot.data.slate?.matchups.length === 0
    && result.snapshot.data.props.length === 0
    && result.snapshot.validation.sourceRows === 0
    && result.snapshot.validation.errors.length === 1
    && result.snapshot.validation.errors[0] === "PROP_ODDS_UNAVAILABLE";
}

/** Native continuity is not evidence that a scheduled AI review completed. */
export function nflPlayerPropsRefreshFailure(result:{aiReviewRuntime?:PropsAiRuntimeHealth}):string|null{
 const failure=propsAiRuntimeFailure(result.aiReviewRuntime);
 return failure==='unavailable'?'NFL player props AI process unavailable; scheduled review coverage unverified':failure==='incomplete'?'NFL player props AI preparation or review incomplete; scheduled coverage unverified':null;
}
