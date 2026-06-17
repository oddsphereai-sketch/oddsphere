import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  const { data, error } = await sb.from("data_refresh_log")
    .select("id, data_source, sport, refresh_status, records_updated, api_calls_made, refresh_started_at, refresh_completed_at, error_message")
    .eq("data_source", "tracking_refresh")
    .order("refresh_started_at", { ascending: false })
    .limit(8);
  if (error) { console.error("ERR", error.message); process.exit(1); }
  console.log("Recent tracking_refresh runs:");
  for (const r of data ?? []) {
    console.log(`  id=${r.id} status=${r.refresh_status} rec=${r.records_updated ?? 0} started=${r.refresh_started_at?.slice(0,19)} completed=${r.refresh_completed_at?.slice(0,19) ?? "-"} err=${r.error_message ?? "-"}`);
  }
  console.log("\nRecent grades (graded_at):");
  const { data: g } = await sb.from("prediction_grades")
    .select("prediction_record_id, grade, graded_at")
    .order("graded_at", { ascending: false })
    .limit(8);
  for (const r of g ?? []) console.log(`  rec=${r.prediction_record_id} grade=${r.grade} graded_at=${r.graded_at?.slice(0,19)}`);
}
main();
