/**
 * Total-line selection priority (Fix 7.2.5), extracted as a PURE function so the
 * contract is verified deterministically by a unit test instead of by mutating
 * production data in the live smoke. The prior smoke deleted/inserted `lines`
 * rows and read them back through the live route, which (a) mutated prod and
 * (b) could not isolate `sportsbookTotalLine`'s LKG / line_history sources — so
 * it failed at random as live data shifted.
 *
 * Priority:
 *   1. sportsbook line (lines table, Pinnacle-preferred) — most current
 *   2. operator-entered listed_line (sport_specific) — manual fallback
 *   3. null — NEVER substitute predicted_total (it would look like a market line)
 *
 * Uses `??` (not `||`) so a legitimate 0 is preserved rather than coalesced.
 */
export function selectTotalLine(
  sportsbookTotalLine: number | null,
  manualListedLine: number | null,
): number | null {
  return sportsbookTotalLine ?? manualListedLine ?? null;
}
