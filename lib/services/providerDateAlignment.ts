/**
 * Phase 4.2.C.1.R-17 Step 1 — Provider date alignment preflight.
 * Phase 4.2.C.1.R-17 Step 2B — switched underlying discovery from
 * `/splits` to `/opportunities/ev`.
 *
 * Read-only helper that confirms SharpAPI's canonical event endpoint is
 * still serving the requested slate date BEFORE any write step runs.
 *
 * Step 2B rationale: the 2026-06-05 SharpAPI audit found `/splits` is
 * a consensus-splits aggregator, not a slate listing — it returned 9
 * events tagged with today's date but matching yesterday's slate. The
 * preflight using `/splits` reported "OK 9/9" on stale matchups (false
 * positive). `/opportunities/ev` is the correct canonical event source
 * — it returned all 15 of today's actual matchups, perfectly matching
 * BDL. This module now uses the EV-based discovery via
 * `_opportunitiesDiscovery.ts`; `_splitsDiscovery.ts` is retained for
 * splits enrichment merging in SharpAPISignalProvider only.
 *
 * Pure, no DB writes, no module-level side effects. Takes an injected
 * SharpApiClient for testability.
 */

import type { Sport } from "../types/domain/Sport";
import { SharpApiClient } from "../providers/real_api/_sharpApiClient";
import { discoverEventsFromOpportunities } from "../providers/real_api/_opportunitiesDiscovery";

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

  // R-17 Step 2B — use `/opportunities/ev`-based canonical discovery.
  // The helper parses event_id dates with the same semantics as the
  // pre-Step-2B `/splits` helper, but reads from SharpAPI's canonical
  // slate listing endpoint instead of the consensus-splits aggregator.
  const evResult = await discoverEventsFromOpportunities(
    client,
    sport,
    expectedDate
  );
  const stats = evResult.stats;
  const matched = stats.keptEvents;
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

  // R-17 Step 2B — reason strings no longer use the `matched/slate_size`
  // form. Under EV-based discovery, `matched` is the count of canonical
  // events on the expected date (which can EXCEED `slate_size` when the
  // slate_size parameter is a DB-derived fallback). Writing "15/9"
  // misleads operators into reading it as a ratio. The new strings
  // surface the kept count, the threshold, and the slate-size basis
  // separately so the numbers are unambiguous.
  if (matched >= threshold) {
    if (wrongDate === 0) {
      status = "ok";
      reason = `Provider aligned: ${matched} EV event(s) on ${expectedDate} (≥ threshold ${threshold}; slate-size basis ${slateSize}).`;
    } else {
      status = "warn";
      reason = `Provider partially aligned: ${matched} EV event(s) on ${expectedDate} (≥ threshold ${threshold}; slate-size basis ${slateSize}). ${wrongDate} event(s) on a different date — provider may be transitioning.`;
    }
  } else if (wrongDate > matched) {
    status = "fail_closed";
    reason = `Provider rolled forward: ${wrongDate} event(s) on the wrong date vs ${matched} on ${expectedDate} (need ${threshold}). SharpAPI has moved on; do not run writes against the stale slate.`;
  } else {
    status = "fail_closed";
    reason = `Provider date alignment below threshold: only ${matched} EV event(s) on ${expectedDate} (need ${threshold}; slate-size basis ${slateSize}). Mixed reasons: ${wrongDate} wrong-date, ${dateUnparseable} date-unparseable, ${teamUnresolved} team-unresolved, ${nonMlb} non-mlb.`;
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
