/**
 * Read-only probe — confirms the production disabled-path cron route
 * writes clean data_refresh_log rows (success, records_updated=0, no
 * error_message). Run after deploy verification.
 *
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/_probe_nba_cron_disabled_rows.ts
 */

import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from("data_refresh_log")
    .select(
      "id, data_source, sport, refresh_started_at, refresh_completed_at, refresh_status, records_updated, api_calls_made, error_message",
    )
    .eq("data_source", "nba_daily_refresh")
    .order("id", { ascending: false })
    .limit(5);
  if (error) {
    console.error("query failed:", error.message);
    process.exit(1);
  }
  console.log(`latest ${data?.length ?? 0} nba_daily_refresh rows:`);
  for (const r of data ?? []) {
    console.log(JSON.stringify(r, null, 2));
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
