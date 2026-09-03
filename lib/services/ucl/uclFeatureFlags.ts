export type UclFeatureEnvironment = Record<string, string | undefined>;

const on = (env: UclFeatureEnvironment, key: string) => env[key] === "true";

/** One fail-closed contract for every UCL surface. The master switch is a
 * necessary condition for providers, writes, publication, settlement, API
 * reads, and navigation. Sub-switches can narrow scope but never bypass it. */
export function resolveUclFeatureFlags(env: UclFeatureEnvironment = process.env) {
  const enabled = on(env, "UCL_PIPELINE_ENABLED");
  const writes = enabled && on(env, "UCL_DB_WRITES_ENABLED");
  const member = enabled && on(env, "CHAMPIONS_LEAGUE_DAILY_EDGE_ENABLED");
  return {
    enabled,
    refresh: enabled && on(env, "UCL_CRON_ENABLED"),
    lock: enabled && on(env, "UCL_LOCK_CRON_ENABLED"),
    writes,
    publication: writes && member && on(env, "UCL_PUBLICATION_ENABLED"),
    settlement: writes,
    member,
    foundationWrites: writes && on(env, "UCL_FOUNDATION_CACHE_WRITES_ENABLED"),
  } as const;
}

export function resolveUclSettlementGradingPlan(sport: string, settlementEnabled: boolean) {
  return {
    excludeFromGeneric: sport === "soccer" ? "uefa_champions_league" as const : undefined,
    runExactUclPass: sport === "soccer" && settlementEnabled,
  } as const;
}

export function resolveUclTrackingVisibility(sport: string | undefined, memberEnabled: boolean) {
  const canContainUcl = sport === undefined || sport === "soccer" || sport === "ucl";
  return {
    directUclDenied: sport === "ucl" && !memberEnabled,
    mayReadStoredSnapshot: memberEnabled || !canContainUcl,
    includeUcl: memberEnabled,
  } as const;
}
