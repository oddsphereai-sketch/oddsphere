/**
 * Soccer provider status — WC-2.
 *
 * Pure module — composes per-provider statuses into one snapshot the
 * WC-3 model writer and the WC-5 auditor will both read. Single source
 * of truth for "do we have what we need to lock?" / "is splits empty
 * as of probe?" / "should the auditor block or just inform?".
 *
 * Splits status is binding per the WC launch contract:
 *   • SPLITS_PRESENT             → ingest, use, display
 *   • SPLITS_ENDPOINT_EXISTS_EMPTY → don't use, but re-check
 *   • SPLITS_PROVIDER_ERROR      → don't use; emit operator signal
 */

import type { SoccerSplitsStatus } from "./SharpApiSoccerOddsProvider";

export type SoccerProviderStatus = {
  /** True if BDL returned at least one usable WC odds row this refresh. */
  bdl_odds_available: boolean;
  /** True if SharpAPI returned at least one usable WC odds row this refresh. */
  sharpapi_odds_available: boolean;
  /** True if SharpAPI EV/Kelly substrate was retrievable. */
  sharpapi_opportunities_available: boolean;
  /** Splits status — see SharpApiSoccerOddsProvider.probeSplits. */
  splits: SoccerSplitsStatus;
  /** Counters for diagnostics. */
  counts: {
    bdl_normalized_odds_records: number;
    sharpapi_normalized_odds_records: number;
    sharpapi_normalized_opportunities: number;
  };
  /** ISO timestamp when this status snapshot was assembled. */
  snapshot_at: string;
};

/**
 * Compose a SoccerProviderStatus from per-provider counts and a splits
 * status. Pure — no side effects.
 */
export function composeSoccerProviderStatus(input: {
  bdlNormalizedCount: number;
  sharpapiNormalizedCount: number;
  sharpapiOpportunitiesCount: number;
  sharpapiOpportunitiesError: boolean;
  splits: SoccerSplitsStatus;
}): SoccerProviderStatus {
  return {
    bdl_odds_available: input.bdlNormalizedCount > 0,
    sharpapi_odds_available: input.sharpapiNormalizedCount > 0,
    sharpapi_opportunities_available:
      !input.sharpapiOpportunitiesError && input.sharpapiOpportunitiesCount >= 0,
    splits: input.splits,
    counts: {
      bdl_normalized_odds_records: input.bdlNormalizedCount,
      sharpapi_normalized_odds_records: input.sharpapiNormalizedCount,
      sharpapi_normalized_opportunities: input.sharpapiOpportunitiesCount,
    },
    snapshot_at: new Date().toISOString(),
  };
}

/**
 * Translate the status into the auditor severity per binding contract:
 *   • splits empty_as_of_probe                   → INFO only
 *   • splits PRESENT but no rows displayed       → WARN/HIGH (callers'
 *                                                    responsibility — this
 *                                                    helper only describes
 *                                                    the status; the auditor
 *                                                    correlates display)
 *   • splits SPLITS_PROVIDER_ERROR               → WARN (transient)
 *   • bdl_odds_available=false + sharpapi=false  → HIGH (no source — block)
 *   • bdl_odds_available=false XOR sharpapi=false → WARN (single source)
 *   • both available                              → INFO
 *
 * Returns the recommended severity for the slate-level integrity block.
 */
export function deriveSlateSeverity(status: SoccerProviderStatus): "HIGH" | "WARN" | "INFO" {
  if (!status.bdl_odds_available && !status.sharpapi_odds_available) {
    return "HIGH"; // no odds source at all — slate must block
  }
  if (status.splits.classification === "SPLITS_PROVIDER_ERROR") {
    return "WARN"; // transient; safe to proceed but flag
  }
  if (!status.bdl_odds_available || !status.sharpapi_odds_available) {
    return "WARN"; // single-source degraded mode
  }
  // splits empty_as_of_probe with both providers healthy is INFO per
  // the binding contract — splits are nice-to-have, not a safety gate.
  return "INFO";
}
