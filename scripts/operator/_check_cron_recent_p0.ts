import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Recent cron runs by data_refresh_log
  const { data: logs } = await sb.from("data_refresh_log")
    .select("id, data_source, sport, refresh_status, records_updated, api_calls_made, refresh_started_at, refresh_completed_at, error_message")
    .order("refresh_started_at", { ascending: false })
    .limit(20);
  console.log("Recent cron runs (any source):");
  for (const r of logs ?? []) {
    console.log(`  ${r.refresh_started_at?.slice(11,19)}Z ${r.data_source?.padEnd(28)} sport=${r.sport ?? "-"} status=${r.refresh_status} updates=${r.records_updated ?? 0} err=${r.error_message?.slice(0,60) ?? "-"}`);
  }
  // Show MIA/PIT game_predictions updated_at
  const { data: gp } = await sb.from("game_predictions").select("game_id, predicted_ou_side, predicted_total, ou_confidence, ou_grade, locked_at, computed_at, sport_specific").eq("game_id", 15764);
  console.log("\nMIA/PIT game_predictions:");
  for (const g of gp ?? []) {
    const sp = (g.sport_specific ?? {}) as Record<string, unknown>;
    console.log(`  computed_at=${g.computed_at}`);
    console.log(`  predicted_ou_side=${g.predicted_ou_side} predicted_total=${g.predicted_total} ou_confidence=${g.ou_confidence} ou_grade=${g.ou_grade}`);
    console.log(`  model_used=${sp.model_used} model_version=${sp.model_version}`);
    console.log(`  total_projection_reconciliation PRESENT? ${"total_projection_reconciliation" in sp ? "YES" : "NO"}`);
    if ("total_projection_reconciliation" in sp) {
      const r = sp.total_projection_reconciliation as Record<string, unknown>;
      console.log(`    reconciled_total_side=${r.reconciled_total_side} reconciled_confidence_pct=${r.reconciled_confidence_pct} grade_cap=${r.grade_cap}`);
      console.log(`    holistic_side=${r.holistic_side} side_selection_reason=${r.side_selection_reason}`);
    }
  }
}
main().then(() => process.exit(0), (e) => { console.error("FATAL:", e); process.exit(1); });
