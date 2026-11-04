import type { MlbPropsBoardRefreshResult } from "@/lib/mlb/props/liveBoard";
import type { NbaPlayerPropsPrivateWriterResult } from "@/lib/services/nba/nbaPlayerPropsPrivateWriter";

/** Report-only: retaining a board is successful continuity, not a fresh refresh. */
export function nbaPlayerPropsRefreshFailure(
  result: Pick<NbaPlayerPropsPrivateWriterResult, "status">,
): string | null {
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
