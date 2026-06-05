/**
 * Phase 4.2.C.1.R-17 Step 2B — BDL ↔ SharpAPI slate reconciliation.
 *
 * Compares the BDL slate (the authoritative game listing) against the
 * SharpAPI `/opportunities/ev` canonical event list. Surfaces missing
 * games on either side and a status that gates write eligibility in the
 * orchestrator.
 *
 * Pure function — no DB, no network, no service-layer dependencies.
 *
 * Threshold semantics:
 *   • ok          overlap ≥ 80% (configurable via opts.okThreshold)
 *   • warn        50% ≤ overlap < 80%
 *   • fail_closed overlap < 50% OR either side is empty
 *
 * The orchestrator hard-blocks all write steps on `fail_closed`. There
 * is intentionally NO override flag in this commit (Step 2B): the goal
 * is safety, not flexibility. A manual override is a future feature
 * gated behind an explicit, audited operator path.
 *
 * Matching is by normalized abbreviation matchup `${away}@${home}`.
 * Both sides are expected to provide already-normalized abbreviations
 * (BDL via its team table; SharpAPI via `normalizeMlbTeamName` in the
 * discovery helper). Case is irrelevant — we uppercase both sides
 * defensively before keying.
 */

export type SlateReconciliationStatus = "ok" | "warn" | "fail_closed";

/** Minimal shape consumed from BDL slate rows. */
export type BdlSlateRowInput = {
  away_abbr: string;
  home_abbr: string;
};

/** Minimal shape consumed from SharpAPI canonical events. */
export type SharpEventInput = {
  away: string;
  home: string;
};

export type SlateReconciliationReport = {
  bdlCount: number;
  sharpEvCount: number;
  matchedCount: number;
  /** Overlap percentage as a 0..100 number, rounded to 1 decimal. */
  overlapPct: number;
  /** BDL matchups not present in SharpAPI events (`away@home` strings,
   *  abbreviation-cased). */
  bdlOnlyMatchups: string[];
  /** SharpAPI matchups not present in BDL (`away@home` strings). */
  sharpOnlyMatchups: string[];
  status: SlateReconciliationStatus;
  reason: string;
};

export type SlateReconciliationOpts = {
  /** Overlap fraction at which status is `ok`. Default 0.80. */
  okThreshold?: number;
  /** Overlap fraction below which status is `fail_closed`. Default 0.50. */
  failClosedThreshold?: number;
};

const DEFAULT_OK_THRESHOLD = 0.8;
const DEFAULT_FAIL_CLOSED_THRESHOLD = 0.5;

function matchupKey(away: string, home: string): string {
  return `${away.trim().toUpperCase()}@${home.trim().toUpperCase()}`;
}

/**
 * Build a sorted, deduped matchup list from a set of `away@home` strings.
 * Sort is stable + alphabetical so reports are reproducible across runs.
 */
function sortedMatchups(set: Set<string>): string[] {
  return [...set].sort();
}

/**
 * Compare a BDL slate against a SharpAPI EV canonical event list and
 * return a reconciliation report.
 *
 * Behavior:
 *   • Empty BDL slate    → fail_closed (no slate to apply against)
 *   • Empty SharpAPI EV  → fail_closed (no odds source for any game)
 *   • Both non-empty     → compute overlap against the LARGER side
 *                          (denominator = max(bdl, sharp) so a stale
 *                          SharpAPI-only event also drags overlap down)
 *
 * Using max() as denominator (instead of min(bdl, sharp) or just bdl)
 * gives a single number that responds to BOTH missing-from-sharp AND
 * extra-in-sharp asymmetries. A 15/15 perfect match gives 100%. A
 * 15-BDL / 9-SharpEV / 1-overlap case gives 1/15 = 6.7%, well below
 * fail_closed. A 15-BDL / 9-SharpEV / 9-overlap case (all sharp events
 * are valid but only 9 of 15 covered) gives 9/15 = 60%, which lands
 * warn — operator sees coverage gap without auto-blocking.
 */
export function reconcileBdlVsSharpEv(
  bdlSlate: BdlSlateRowInput[],
  sharpEvents: SharpEventInput[],
  opts?: SlateReconciliationOpts
): SlateReconciliationReport {
  const okThreshold = opts?.okThreshold ?? DEFAULT_OK_THRESHOLD;
  const failClosedThreshold =
    opts?.failClosedThreshold ?? DEFAULT_FAIL_CLOSED_THRESHOLD;

  const bdlSet = new Set<string>();
  for (const g of bdlSlate) {
    if (!g.away_abbr || !g.home_abbr) continue;
    bdlSet.add(matchupKey(g.away_abbr, g.home_abbr));
  }
  const sharpSet = new Set<string>();
  for (const e of sharpEvents) {
    if (!e.away || !e.home) continue;
    sharpSet.add(matchupKey(e.away, e.home));
  }

  const bdlCount = bdlSet.size;
  const sharpEvCount = sharpSet.size;

  if (bdlCount === 0) {
    return {
      bdlCount: 0,
      sharpEvCount,
      matchedCount: 0,
      overlapPct: 0,
      bdlOnlyMatchups: [],
      sharpOnlyMatchups: sortedMatchups(sharpSet),
      status: "fail_closed",
      reason:
        "BDL slate is empty — no canonical games to reconcile against.",
    };
  }
  if (sharpEvCount === 0) {
    return {
      bdlCount,
      sharpEvCount: 0,
      matchedCount: 0,
      overlapPct: 0,
      bdlOnlyMatchups: sortedMatchups(bdlSet),
      sharpOnlyMatchups: [],
      status: "fail_closed",
      reason:
        "SharpAPI /opportunities/ev returned zero events — no odds source for any BDL game.",
    };
  }

  const matched = new Set<string>();
  for (const m of bdlSet) {
    if (sharpSet.has(m)) matched.add(m);
  }
  const matchedCount = matched.size;
  const denominator = Math.max(bdlCount, sharpEvCount);
  const overlap = matchedCount / denominator;
  const overlapPct = Math.round(overlap * 1000) / 10;

  const bdlOnly = new Set<string>();
  for (const m of bdlSet) if (!matched.has(m)) bdlOnly.add(m);
  const sharpOnly = new Set<string>();
  for (const m of sharpSet) if (!matched.has(m)) sharpOnly.add(m);

  let status: SlateReconciliationStatus;
  let reason: string;
  if (overlap >= okThreshold) {
    status = "ok";
    reason = `BDL ${bdlCount} ↔ SharpAPI ${sharpEvCount}: ${matchedCount} matched (${overlapPct}% overlap; ≥ ${(okThreshold * 100).toFixed(0)}% required).`;
  } else if (overlap >= failClosedThreshold) {
    status = "warn";
    reason = `Partial coverage: ${matchedCount}/${denominator} matchups overlap (${overlapPct}%). BDL-only=${bdlOnly.size}, SharpAPI-only=${sharpOnly.size}. Apply allowed but inspect missing matchups.`;
  } else {
    status = "fail_closed";
    reason = `Slate reconciliation failed: only ${matchedCount}/${denominator} matchups overlap (${overlapPct}%, below ${(failClosedThreshold * 100).toFixed(0)}% hard-block threshold). BDL-only=${bdlOnly.size}, SharpAPI-only=${sharpOnly.size}. Likely cause: SharpAPI stale slate or wrong endpoint upstream.`;
  }

  return {
    bdlCount,
    sharpEvCount,
    matchedCount,
    overlapPct,
    bdlOnlyMatchups: sortedMatchups(bdlOnly),
    sharpOnlyMatchups: sortedMatchups(sharpOnly),
    status,
    reason,
  };
}
