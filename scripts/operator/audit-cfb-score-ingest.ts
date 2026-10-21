#!/usr/bin/env tsx

/** SELECT/provider-only CFB final-score audit. Never writes database state. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { ingestCfbFinalScores } from "@/lib/services/football/cfbScoreIngestService";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const dates = process.argv.slice(2).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (dates.length === 0) throw new Error("Provide at least one YYYY-MM-DD slate date.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data: refreshRows, error: refreshError } = await supabase
    .from("data_refresh_log")
    .select("id,refresh_started_at,refresh_completed_at,refresh_status,records_updated,api_calls_made,error_message")
    .eq("data_source", "tracking_refresh")
    .eq("sport", "cfb")
    .order("refresh_started_at", { ascending: false })
    .limit(12);
  if (refreshError) throw new Error("CFB tracking-refresh log read failed: " + refreshError.message);
  const reports = [];
  for (const slateDate of dates) {
    reports.push({
      slateDate,
      ...(await ingestCfbFinalScores({ supabase, slateDate, apply: false })),
    });
  }
  console.log(JSON.stringify({
    mode: "select_and_provider_read_only_zero_writes",
    trackingRefreshRuns: refreshRows ?? [],
    reports,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
