/**
 * Phase 4.2.C.1.R-17 Step 1 — Provider date alignment preflight.
 *
 * Read-only helper that confirms SharpAPI's /splits endpoint is still
 * serving the requested slate date BEFORE any write step runs. If
 * SharpAPI has rolled forward to the next day's slate (observed
 * 2026-06-04 evening — only 1 of 10 /splits rows still carried the
 * target date), running a V2 lines refresh would either preserve
 * stale data (with the R-16D per-game guard) or — without that guard
 * — silently wipe good data and replace with the wrong slate's. The
 * orchestrator uses this check to ABORT a cycle when the provider
 * has clearly moved on.
 *
 * Pure, no DB writes, no module-level side effects. Takes an injected
 * SharpApiClient for testability.
 */

import type { Sport } from "../types/domain/Sport";
import { SharpApiClient } from "../providers/real_api/_sharpApiClient";
import { discoverEventsFromSplits } from "../providers/real_api/_splitsDiscovery";

export type ProviderDateAlignmentStatus = "ok" | "warn" | "fail_closed";

export type ProviderDateAlignmentReport = {
  sport: Sport;
  expected_date: string;
  /** Total /splits rows fetched (kept, skipped, all reasons). */
  provider_rows_total: number;
  /** Rows whose event_id date parses to the expected date. */
  matched: number;
  /** Rows whose event_id date parses to a different date. */
  wrong_date: number;
  /** Rows whose event_id date couldn't be parsed at all. */
  date_unparseable: number;
  /** Rows skipped because league wasn't mlb. */
  non_mlb: number;
  /** Rows skipped because home/away team string didn't resolve. */
  team_unresolved: number;
  /** Threshold computed for this slate (ceil(ratio * slate_size)). */
  threshold: number;
  /** Slate size used to compute threshold. */
  slate_size: number;
  /** Threshold ratio (default 0.85). */
  threshold_ratio: number;
  /** Final aligned-yes-or-no decision. */
  status: ProviderDateAlignmentStatus;
  /** Human-readable reason for the status. */
  reason: string;
  assessed_at: string;
};

export type AlignmentOpts = {
  /**
   * Slate size = number of games we're checking against. Default 9
   * (typical MLB Wed/Thu slate). Threshold scales with this — bigger
   * slates need more matches.
   */
  slate_size?: number;
  /**
   * Fraction of slate_size required to pass. Default 0.85 — for a
   * 9-game slate that's ceil(0.85 * 9) = 8 matches required.
   */
  threshold_ratio?: number;
};

const DEFAULT_THRESHOLD_RATIO = 0.85;

export async function assessProviderDateAlignment(
  client: SharpApiClient,
  sport: Sport,
  expectedDate: string,
  opts?: AlignmentOpts
): Promise<ProviderDateAlignmentReport> {
  const slateSize = opts?.slate_size ?? 9;
  const ratio = opts?.threshold_ratio ?? DEFAULT_THRESHOLD_RATIO;
  const threshold = Math.ceil(ratio * slateSize);
  const assessedAt = new Date().toISOString();

  if (sport !== "mlb") {
    return {
      sport,
      expected_date: expectedDate,
      provider_rows_total: 0,
      matched: 0,
      wrong_date: 0,
      date_unparseable: 0,
      non_mlb: 0,
      team_unresolved: 0,
      threshold,
      slate_size: slateSize,
      threshold_ratio: ratio,
      status: "fail_closed",
      reason: `Provider date alignment only implemented for sport=mlb; got ${sport}.`,
      assessed_at: assessedAt,
    };
  }

  // Reuse the R-16D /splits discovery helper. It already parses event_id
  // dates and applies the same date-guard logic. We just need the stats.
  const splitsResult = await discoverEventsFromSplits(client, sport, expectedDate);
  const stats = splitsResult.stats;
  const matched = stats.keptRows;
  const wrongDate = stats.skippedWrongDate;
  const dateUnparseable = stats.skippedDateUnparseable;
  const nonMlb = stats.skippedNonMlb;
  const teamUnresolved = stats.skippedTeamUnresolved;

  // Decision tree:
  //   • matched >= threshold AND wrong_date is small → ok
  //   • matched >= threshold AND wrong_date is significant → warn
  //     (mixed slate; provider transitioning. Operator should be cautious.)
  //   • matched < threshold AND wrong_date dominates → fail_closed
  //     (rolled forward; preserving good data is critical)
  //   • matched < threshold but no clear rollover → fail_closed
  //     (something else is wrong; safer to abort)
  let status: ProviderDateAlignmentStatus;
  let reason: string;

  if (matched >= threshold) {
    if (wrongDate === 0) {
      status = "ok";
      reason = `Provider aligned: ${matched}/${slateSize} events on ${expectedDate} (threshold ${threshold}).`;
    } else {
      status = "warn";
      reason = `Provider partially aligned: ${matched}/${slateSize} events on ${expectedDate} (threshold ${threshold}). ${wrongDate} event(s) on a different date — provider may be transitioning.`;
    }
  } else if (wrongDate > matched) {
    status = "fail_closed";
    reason = `Provider rolled forward: ${wrongDate} event(s) on the wrong date vs ${matched} on ${expectedDate} (need ${threshold}). SharpAPI has moved on; do not run writes against the stale slate.`;
  } else {
    status = "fail_closed";
    reason = `Provider date alignment below threshold: only ${matched}/${slateSize} events on ${expectedDate} (need ${threshold}). Mixed reasons: ${wrongDate} wrong-date, ${dateUnparseable} date-unparseable, ${teamUnresolved} team-unresolved, ${nonMlb} non-mlb.`;
  }

  return {
    sport,
    expected_date: expectedDate,
    provider_rows_total: stats.totalRows,
    matched,
    wrong_date: wrongDate,
    date_unparseable: dateUnparseable,
    non_mlb: nonMlb,
    team_unresolved: teamUnresolved,
    threshold,
    slate_size: slateSize,
    threshold_ratio: ratio,
    status,
    reason,
    assessed_at: assessedAt,
  };
}
