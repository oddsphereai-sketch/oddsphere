import { validateAdminAuth } from "@/lib/auth/admin";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MLB_PROP_MARKET_KEYS } from "@/lib/mlb/props/config";
import { loadLatestMlbPropsBoardSnapshot } from "@/lib/mlb/props/boardSnapshotStore";
import { easternSlateDate, mlbPropsSnapshotIsFresh } from "@/lib/mlb/props/liveBoard";
import { loadMlbPropsLaunchReadiness } from "@/lib/mlb/props/launchReadiness";

export async function GET(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  const today = easternSlateDate();
  const snapshot = await loadLatestMlbPropsBoardSnapshot(today).catch(() => null);
  const fresh = snapshot ? mlbPropsSnapshotIsFresh(snapshot) : false;
  const [persistedHealth, launchReadiness] = await Promise.all([
    readPersistedHealth(),
    loadMlbPropsLaunchReadiness(today),
  ]);
  return Response.json({
    ok: true,
    mode: "live_snapshot",
    provider_mode: "real",
    provider_health: {
      board: fresh ? "fresh" : snapshot ? "stale" : "unavailable",
      odds: snapshot && snapshot.validation.sourceRows > 0 ? "live" : "unavailable",
      schedule: snapshot?.data.slate?.matchups.length ? "live" : "unavailable",
      metadata: snapshot?.data.props.length ? "live" : "unavailable",
      lineups: snapshot?.data.props.some((row) => row.lineupStatus?.status === "confirmed" || row.lineupStatus?.status === "posted") ? "live" : "pending",
      weather: snapshot?.data.props.some((row) => row.environment?.weather.status === "available" || row.environment?.roofStatus === "dome") ? "live" : "pending",
      park_factors: snapshot?.data.props.some((row) => row.environment?.park.status === "available") ? "live" : "pending",
      historical_stats: snapshot?.data.props.some((row) => row.recentForm?.logs.length) ? "live" : "pending",
    },
    latest_snapshot_id: snapshot?.snapshotId ?? null,
    latest_snapshot_timestamp: snapshot?.asOfTimestamp ?? null,
    latest_odds_timestamp: snapshot?.data.props.map((row) => row.lastUpdated).sort().at(-1) ?? null,
    stale_odds_count: snapshot?.validation.staleOddsRows ?? 0,
    launch_validation: snapshot?.validation ?? null,
    launch_readiness: launchReadiness,
    last_movement: snapshot?.movement ?? null,
    unresolved_player_mappings: persistedHealth.unresolvedPlayerMappings,
    unmapped_players: persistedHealth.unresolvedPlayerMappings,
    failed_jobs: [],
    active_model_versions: [
      {
        model_name: "pitcher_strikeouts_baseline_v1",
        market_key: "pitcher_strikeouts",
        active: true,
      },
    ],
    latest_mock_or_real_scoring_run: persistedHealth.latestScoringRun,
    latest_backtest_run: persistedHealth.latestBacktestRun,
    latest_settlement_run: persistedHealth.latestSettlementRun,
    internal_tracking: launchReadiness.tracking,
    paper_trading_enabled: process.env.ODDSPHERE_PROPS_PAPER_TRADING_ENABLED === "true",
    real_publishing_enabled: process.env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true",
    display_enabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
    supported_markets: MLB_PROP_MARKET_KEYS,
    unsupported_detected_markets: [],
    table_availability: persistedHealth.tableAvailability,
    data_quality_event_counts_by_severity: persistedHealth.dataQualityEventCountsBySeverity,
    data_quality_alerts: persistedHealth.dataQualityAlerts,
    counts: {
      games: snapshot?.data.summary.gamesWithProps ?? 0,
      odds: snapshot?.validation.sourceRows ?? 0,
      players: new Set(snapshot?.data.props.map((row) => row.player) ?? []).size,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

async function readPersistedHealth() {
  const fallback = {
    unresolvedPlayerMappings: [] as unknown[],
    latestScoringRun: null as unknown,
    latestBacktestRun: null as unknown,
    latestSettlementRun: null as unknown,
    tableAvailability: {} as Record<string, boolean>,
    dataQualityEventCountsBySeverity: {} as Record<string, number>,
    dataQualityAlerts: [] as unknown[],
  };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return fallback;

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const [{ data: events }, { data: backtests }, { data: recommendations }, { data: settlements }, tableAvailability] = await Promise.all([
    supabase
      .from("data_quality_events")
      .select("severity,event_type,message,context_json,created_at")
      .eq("component", "mlb_props")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("backtest_runs").select("id,name,created_at").order("created_at", { ascending: false }).limit(1),
    supabase.from("recommended_bets").select("id,created_at,recommendation_status").order("created_at", { ascending: false }).limit(1),
    supabase.from("prop_settlement_runs").select("id,slate_date,status,created_at").order("created_at", { ascending: false }).limit(1),
    checkTables(supabase),
  ]);
  const alerts = events ?? [];
  const counts: Record<string, number> = {};
  for (const event of alerts as Array<{ severity?: string }>) {
    const severity = event.severity ?? "unknown";
    counts[severity] = (counts[severity] ?? 0) + 1;
  }
  return {
    unresolvedPlayerMappings: (alerts as Array<{ event_type?: string }>).filter((event) =>
      event.event_type === "unresolved_player_mapping" || event.event_type === "ambiguous_player_mapping",
    ),
    latestScoringRun: recommendations?.[0] ?? null,
    latestBacktestRun: backtests?.[0] ?? null,
    latestSettlementRun: settlements?.[0] ?? null,
    tableAvailability,
    dataQualityEventCountsBySeverity: counts,
    dataQualityAlerts: alerts.slice(0, 10),
  };
}

async function checkTables(supabase: SupabaseClient): Promise<Record<string, boolean>> {
  const tables = ["prop_scoring_runs", "provider_entity_mappings", "prop_settlement_runs", "recommended_bets"];
  const entries = await Promise.all(tables.map(async (table) => {
    const { error } = await supabase.from(table).select("*", { count: "exact", head: true });
    return [table, !error] as const;
  }));
  return Object.fromEntries(entries);
}
