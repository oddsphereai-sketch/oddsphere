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
 * MECHANISM
 *   `process.env.ODDSPHERE_DATA_MODE === 'production'` activates the filter.
 *   Decoupled from NODE_ENV so Vercel preview deploys (which run
 *   NODE_ENV='production' by default) can continue surfacing mock data for
 *   pre-launch QA. Set the var explicitly on the production environment
 *   to flip the gate on. Document in `.env.example`.
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
 * Returns true when the runtime is in production data mode and should hide
 * mock-sourced rows from member-facing responses. Read this in code paths
 * that need to branch on the data-mode state (e.g., empty-state copy).
 */
export function isProductionDataMode(): boolean {
  return process.env.ODDSPHERE_DATA_MODE === "production";
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
