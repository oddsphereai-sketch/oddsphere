import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const BASELINE_LOG_ID = 3696;
const BASELINE_API_CALLS = 36;
const BASELINE_FI_COUNT = 57;
const BASELINE_2026_ROWS = 354;
const BASELINE_PRED_TODAY = 24;
const BASELINE_WARREN_FI = null;
const BASELINE_WARREN_UPDATED_AT = "2026-06-08T17:00:35.973+00:00";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log("═══ POST-CRON VERIFICATION POLLER ═══");
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Polling for slate_cycle_automation row with id > ${BASELINE_LOG_ID}...`);
  
  // Poll up to 12 minutes for a new cron row (covers 18:00 fire + ~3 min completion + buffer)
  const start = Date.now();
  const POLL_TIMEOUT_MS = 12 * 60 * 1000;
  let newRow: any = null;
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const { data } = await sb.from("data_refresh_log")
      .select("id, refresh_started_at, refresh_completed_at, refresh_status, records_updated, api_calls_made, error_message")
      .eq("data_source", "slate_cycle_automation")
      .gt("id", BASELINE_LOG_ID)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && (data as any).refresh_completed_at !== null) {
      newRow = data;
      break;
    }
    await sleep(30_000);
  }
  
  if (!newRow) {
    console.log("\n✗ TIMEOUT — no new slate_cycle_automation row appeared within 12 min.");
    console.log("  This could mean: (a) cron didn't fire, (b) deploy didn't land, (c) cron failed before logging.");
    process.exit(1);
  }
  
  console.log(`\n✓ Found new cron row: id=${newRow.id}  ${newRow.refresh_started_at} → ${newRow.refresh_completed_at}`);
  console.log(`  Detection took: ${Math.round((Date.now() - start)/1000)}s`);
  
  // ── Verification probes ───────────────────────────────────────────────
  const r = newRow;
  console.log("\n══════ POST-CRON VERIFICATION ══════");
  
  console.log("\n[1] data_refresh_log row:");
  console.log(`   id:                      ${r.id}`);
  console.log(`   refresh_status:          ${r.refresh_status}`);
  console.log(`   records_updated:         ${r.records_updated}   (baseline ${BASELINE_API_CALLS} prior cron had rec=150)`);
  console.log(`   api_calls_made:          ${r.api_calls_made}   (baseline ${BASELINE_API_CALLS}; expected ~52 if S6 fired ~16 calls)`);
  console.log(`   api_calls_delta:         ${(r.api_calls_made ?? 0) - BASELINE_API_CALLS}`);
  console.log(`   error_message:           ${r.error_message ?? "null"}`);
  
  const cronCleanly = r.refresh_status === "success" || r.refresh_status === "partial";
  const s6FiredLikely = (r.api_calls_made ?? 0) >= BASELINE_API_CALLS + 10;  // 10+ API call delta = strong signal
  console.log(`\n   ✓ Cron completed cleanly: ${cronCleanly ? "YES" : "NO"}`);
  console.log(`   ✓ S6 likely fired (api delta ≥ 10): ${s6FiredLikely ? "YES" : "NO"}`);
  
  console.log("\n[2] player_season_stats 2026 FI coverage (must be unchanged in dry-run):");
  const { count: with2026 } = await sb.from("player_season_stats").select("*", { count: "exact", head: true }).eq("season", 2026);
  const { count: withFiStarts } = await sb.from("player_season_stats").select("*", { count: "exact", head: true }).eq("season", 2026).not("first_inning_starts", "is", null);
  console.log(`   total rows:                       ${with2026}  (baseline ${BASELINE_2026_ROWS})  Δ=${(with2026 ?? 0) - BASELINE_2026_ROWS}`);
  console.log(`   first_inning_starts NOT NULL:     ${withFiStarts}  (baseline ${BASELINE_FI_COUNT})  Δ=${(withFiStarts ?? 0) - BASELINE_FI_COUNT}`);
  const fiUnchanged = withFiStarts === BASELINE_FI_COUNT;
  console.log(`   ${fiUnchanged ? "✓" : "✗"} FI count UNCHANGED (dry-run integrity): ${fiUnchanged ? "YES" : "NO"}`);
  
  console.log("\n[3] Will Warren (id=14003) FI state:");
  const { data: warren } = await sb.from("player_season_stats").select("first_inning_starts, first_inning_era, first_inning_whip, updated_at").eq("player_id", 14003).eq("season", 2026).maybeSingle();
  const w = warren as any;
  console.log(`   first_inning_starts: ${w?.first_inning_starts ?? "null"}  (baseline: null)`);
  console.log(`   first_inning_era:    ${w?.first_inning_era ?? "null"}`);
  console.log(`   updated_at:          ${w?.updated_at}`);
  console.log(`   baseline updated_at: ${BASELINE_WARREN_UPDATED_AT}`);
  const warrenFiUnchanged = w?.first_inning_starts === BASELINE_WARREN_FI;
  console.log(`   ${warrenFiUnchanged ? "✓" : "✗"} Warren FI still null: ${warrenFiUnchanged ? "YES" : "NO"}`);
  
  console.log("\n[4] prediction_records integrity (must be unchanged today):");
  const { count: predToday } = await sb.from("prediction_records").select("*", { count: "exact", head: true }).gte("created_at", "2026-06-08T00:00:00Z").lte("created_at", "2026-06-08T23:59:59Z");
  console.log(`   count today:  ${predToday}  (baseline ${BASELINE_PRED_TODAY})  Δ=${(predToday ?? 0) - BASELINE_PRED_TODAY}`);
  console.log(`   Note: M2 automodel may legitimately add new prediction_records; an increase is OK, but baseline integrity is what matters.`);
  
  console.log("\n[5] Most recently updated player_season_stats rows (after cron):");
  const { data: latestUpdate } = await sb.from("player_season_stats").select("player_id, updated_at, first_inning_starts").eq("season", 2026).order("updated_at", { ascending: false }).limit(5);
  for (const u of latestUpdate ?? []) {
    const uu = u as any;
    console.log(`   player_id=${uu.player_id}  updated_at=${uu.updated_at}  fi_starts=${uu.first_inning_starts ?? "null"}`);
  }
  const latestAfterCron = (latestUpdate?.[0] as any)?.updated_at as string | undefined;
  const cronEndTimeMs = new Date(r.refresh_completed_at).getTime();
  const latestUpdateMs = latestAfterCron ? new Date(latestAfterCron).getTime() : 0;
  // Note: S5 (season-pitching) DOES write to player_season_stats, so updated_at after the cron is normal.
  // What we care about: did first_inning_* fields specifically change? Covered by check [2].
  
  console.log("\n══════ SUMMARY ══════");
  const allOk = cronCleanly && fiUnchanged && warrenFiUnchanged;
  console.log(`Overall: ${allOk ? "✓ DRY-RUN INTEGRITY CONFIRMED" : "✗ ONE OR MORE CHECKS FAILED"}`);
  console.log(`  - Cron completed:        ${cronCleanly ? "✓" : "✗"}`);
  console.log(`  - S6 likely fired:       ${s6FiredLikely ? "✓" : "?"} (api_calls delta=${(r.api_calls_made ?? 0) - BASELINE_API_CALLS})`);
  console.log(`  - FI count unchanged:    ${fiUnchanged ? "✓" : "✗"}`);
  console.log(`  - Warren FI still null:  ${warrenFiUnchanged ? "✓" : "✗"}`);
  console.log(`\nFinished: ${new Date().toISOString()}`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
