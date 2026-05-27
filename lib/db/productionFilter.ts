/**
 * productionFilter — runtime gate that excludes `source_type='mock'` rows
 * from member-facing query results.
 *
 * Framework reference: planning-docs/SHARP_SIGNAL_FRAMEWORK.md
 * §"Signal Source Quality":
 *   "mock data NEVER ships to production member surfaces. Production
 *    builds filter source_type='mock' rows from all daily edge / pick
 *    breakdown / Tonight's Board / Top Reads outputs."
 *
 * The framework calls out this rule as a hard product invariant: members
 * paying for OddSphere must not see mock-derived sharp signals labelled as
 * real reads. The filter lives at the read layer (route handlers + any
 * member-facing service) so a single env-var flip switches the deploy
 * between dev-data and live-data modes.
 *
 * MECHANISM — Fix 5.1 Flag C1 (fail-closed inversion):
 *   Filter is ACTIVE by default. Only an exact literal `ODDSPHERE_DATA_MODE
 *   === "development"` disables it. Any other value — including unset,
 *   empty string, "production", "Production", "dev", typos — leaves the
 *   filter active. This means production env-var omission or capitalization
 *   mistakes can no longer leak mock data; local dev must explicitly
 *   opt-out with `ODDSPHERE_DATA_MODE=development` in `.env.local`.
 *
 *   Pre-Fix-5.1 the semantics were inverted (`=== "production"` opted IN,
 *   default opted OUT) — that pattern failed OPEN on missing env. Fix 5.1
 *   inverted to fail CLOSED.
 *
 * APPLY SITES
 *   Two patterns ship in this file:
 *     • applyProductionSourceFilter(query) — chains `.neq("source_type",
 *       "mock")` onto a Supabase query builder. Use for SELECTs that hit
 *       prediction tables directly (prop_predictions, prediction_results,
 *       etc.).
 *     • filterMockSourceRows(rows, pick) — post-query array filter. Use for
 *       JOIN-style queries where the prediction table is reached via a
 *       nested FK expansion (e.g., games + game_predictions[]) and chaining
 *       .neq on the relation is awkward.
 *
 * NOT COVERED BY THIS HELPER
 *   `sharp_signals` rows have no `source_type` column today (audit Gap-25);
 *   they ride along with their parent game_predictions row, so filtering
 *   the prediction transitively suppresses surfacing of the signal. When
 *   Gap-25 lands and sharp_signals carries its own provenance, extend this
 *   helper rather than scattering the filter across routes.
 *
 *   `calibration_buckets` is pre-aggregated from prediction_results without
 *   carrying source_type forward. Filtering mock from calibration requires
 *   re-aggregating with the filter applied at compute time — a job-side
 *   concern, not a route-side one. Audit follow-up.
 */

/**
 * Returns true when the runtime should HIDE mock-sourced rows from
 * member-facing responses. Read this in code paths that need to branch
 * on the data-mode state (e.g., empty-state copy).
 *
 * Fix 5.1 Flag C1 (fail-closed inversion): default is `true` (filter
 * active) unless the env var is exactly the literal `"development"`.
 * Production fails CLOSED — a typo, capitalization mistake, or missing
 * env var leaves the filter active.
 */
export function isProductionDataMode(): boolean {
  return process.env.ODDSPHERE_DATA_MODE !== "development";
}

/**
 * Chain on a Supabase query builder to exclude mock rows when in production
 * data mode. No-op in dev / preview / unset modes.
 *
 *   const { data } = await applyProductionSourceFilter(
 *     supabase.from("prop_predictions").select("...")
 *   );
 *
 * The query builder type is generic so the call site stays strict.
 */
export function applyProductionSourceFilter<T>(query: T): T {
  if (!isProductionDataMode()) return query;
  return (query as { neq: (col: string, val: string) => T }).neq(
    "source_type",
    "mock"
  );
}

/**
 * Post-query array filter for nested-prediction JOIN queries. Drops rows
 * where the picked source_type is `'mock'` when in production data mode.
 * Returns the input array unchanged in dev / preview modes.
 *
 *   const visible = filterMockSourceRows(
 *     gamesWithPredictions,
 *     (g) => g.game_predictions?.[0]?.source_type
 *   );
 */
export function filterMockSourceRows<T>(
  rows: T[],
  pickSourceType: (row: T) => string | null | undefined
): T[] {
  if (!isProductionDataMode()) return rows;
  return rows.filter((r) => pickSourceType(r) !== "mock");
}
