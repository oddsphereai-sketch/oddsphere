import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  const { data } = await sb.from("data_refresh_log")
    .select("data_source, refresh_status, refresh_started_at, refresh_completed_at, records_updated, error_message")
    .order("refresh_started_at", { ascending: false }).limit(20);
  for (const r of (data ?? []) as any[]) {
    console.log(`${r.data_source.padEnd(25)} ${r.refresh_status.padEnd(8)} started=${r.refresh_started_at?.slice(0,19)} rec=${r.records_updated ?? 0} err=${r.error_message ?? "-"}`);
  }
}
main();
