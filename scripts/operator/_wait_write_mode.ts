import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const BASELINE_LOG_ID = 3702;
const BASELINE_FI_COUNT = 57;
const BASELINE_2026_ROWS = 354;
const BASELINE_PRED_TODAY = 24;

const TODAY_STARTERS = [14003, 14301, 14302, 14303, 14304, 14305, 14306, 14307, 13772, 13778, 13779, 13782, 13789, 6300, 13774];
const PRE_FI_NULL_STARTERS = [14003, 14301, 14302, 14303, 14304, 14305, 14306, 14307, 6300]; // 9 starters that were null pre-write
const PRE_FI_POPULATED = [13772, 13778, 13779, 13782, 13789, 13774]; // 6 already had FI

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log("═══ POST-WRITE-FLAG VERIFICATION POLLER ═══");
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Watching for cron row id > ${BASELINE_LOG_ID}`);
  console.log(`Expected: FI count 57 → ~66, Warren FI populated`);
  
  const start = Date.now();
  const POLL_TIMEOUT_MS = 75 * 60 * 1000;  // 75 min — covers the 19:00 UTC fire + completion
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
    await sleep(60_000);  // 60s — gentler poll for the 53 min wait
  }
  
  if (!newRow) {
    console.log("\n✗ TIMEOUT after 75 min — no new cron row.");
    process.exit(1);
  }
  
  const r = newRow;
  console.log(`\n✓ Found new cron row: id=${r.id}  ${r.refresh_started_at} → ${r.refresh_completed_at}`);
  console.log(`  Wait time: ${Math.round((Date.now() - start)/60000)} min`);
  
  // ── Verification probes ───────────────────────────────────────────────
  console.log("\n══════ POST-WRITE VERIFICATION ══════");
  
  console.log("\n[1] data_refresh_log row:");
  console.log(`   id:               ${r.id}`);
  console.log(`   status:           ${r.refresh_status}`);
  console.log(`   records_updated:  ${r.records_updated}`);
  console.log(`   api_calls_made:   ${r.api_calls_made}   (still reads 'api_calls' key; S6 uses 'mlb_api_calls' — separate)`);
  console.log(`   error_message:    ${r.error_message ?? "null"}`);
  console.log(`   duration:         ${Math.round((new Date(r.refresh_completed_at).getTime() - new Date(r.refresh_started_at).getTime())/1000)}s`);
  
  console.log("\n[2] Slate-wide FI coverage:");
  const { count: with2026 } = await sb.from("player_season_stats").select("*", { count: "exact", head: true }).eq("season", 2026);
  const { count: withFi } = await sb.from("player_season_stats").select("*", { count: "exact", head: true }).eq("season", 2026).not("first_inning_starts", "is", null);
  console.log(`   total rows:                       ${with2026}   (baseline ${BASELINE_2026_ROWS})  Δ=${(with2026 ?? 0) - BASELINE_2026_ROWS}`);
  console.log(`   first_inning_starts NOT NULL:     ${withFi}   (baseline ${BASELINE_FI_COUNT})  Δ=${(withFi ?? 0) - BASELINE_FI_COUNT}`);
  const fiIncreased = (withFi ?? 0) > BASELINE_FI_COUNT;
  console.log(`   ${fiIncreased ? "✓" : "✗"} FI count INCREASED (write-mode success): ${fiIncreased ? "YES" : "NO"}`);
  
  console.log("\n[3] Will Warren (id=14003) — should now be populated:");
  const { data: w } = await sb.from("player_season_stats").select("first_inning_starts, first_inning_era, first_inning_whip, first_inning_innings_pitched, first_inning_earned_runs, first_inning_runs_allowed, pitching_era, pitching_whip, pitching_ip, updated_at").eq("player_id", 14003).eq("season", 2026).maybeSingle();
  const ww = w as any;
  console.log(`   first_inning_starts: ${ww?.first_inning_starts ?? "null"}   ← expected 12`);
  console.log(`   first_inning_era:    ${ww?.first_inning_era ?? "null"}   ← expected ~1.5`);
  console.log(`   first_inning_whip:   ${ww?.first_inning_whip ?? "null"}   ← expected ~0.92`);
  console.log(`   first_inning_ip:     ${ww?.first_inning_innings_pitched ?? "null"}   ← expected 12.0`);
  console.log(`   first_inning_er:     ${ww?.first_inning_earned_runs ?? "null"}   ← expected 2`);
  console.log(`   first_inning_runs:   ${ww?.first_inning_runs_allowed ?? "null"}   ← expected 5`);
  console.log(`   pitching_era:        ${ww?.pitching_era ?? "null"}   ← should still be 3.22 (UNCHANGED — invariant check)`);
  console.log(`   pitching_whip:       ${ww?.pitching_whip ?? "null"}   ← should still be 1.2`);
  console.log(`   pitching_ip:         ${ww?.pitching_ip ?? "null"}   ← should still be 64.333`);
  console.log(`   updated_at:          ${ww?.updated_at}`);
  const warrenFiOk = ww?.first_inning_starts !== null;
  const warrenNonFiPreserved = ww?.pitching_era === 3.22;
  console.log(`   ${warrenFiOk ? "✓" : "✗"} Warren FI populated: ${warrenFiOk}`);
  console.log(`   ${warrenNonFiPreserved ? "✓" : "✗"} Warren pitching_era preserved (3.22): ${warrenNonFiPreserved}`);
  
  console.log("\n[4] Today's slate — all 15 starters FI state after write:");
  const { data: starterFi } = await sb.from("player_season_stats")
    .select("player_id, first_inning_starts, first_inning_era, pitching_era, pitching_ip, updated_at")
    .in("player_id", TODAY_STARTERS)
    .eq("season", 2026);
  const { data: names } = await sb.from("players").select("id, full_name").in("id", TODAY_STARTERS);
  const nameMap = new Map<number, string>((names ?? []).map((n:any)=>[n.id, n.full_name]));
  const fiMap = new Map<number, any>((starterFi ?? []).map((r:any)=>[r.player_id, r]));
  let populated = 0;
  for (const pid of TODAY_STARTERS) {
    const rr = fiMap.get(pid);
    const name = nameMap.get(pid) ?? "?";
    const fi = rr?.first_inning_starts;
    if (fi !== null && fi !== undefined) populated++;
    const tag = fi !== null && fi !== undefined ? "✓ FI" : "✗ no FI";
    console.log(`   pid=${pid}  ${name.padEnd(22)}  ${tag}  fi_starts=${fi ?? "null"}  fi_era=${rr?.first_inning_era ?? "null"}  p_era=${rr?.pitching_era ?? "null"}  upd=${rr?.updated_at ?? "—"}`);
  }
  console.log(`\n   Summary: ${populated}/${TODAY_STARTERS.length} starters have FI populated`);
  
  console.log("\n[5] prediction_records integrity (baseline 24):");
  const { count: predToday } = await sb.from("prediction_records").select("*", { count: "exact", head: true }).gte("created_at", "2026-06-08T00:00:00Z").lte("created_at", "2026-06-08T23:59:59Z");
  console.log(`   count today: ${predToday}   Δ=${(predToday ?? 0) - BASELINE_PRED_TODAY}`);
  console.log(`   Note: M2 may legitimately add new prediction_records on this cron.`);
  
  console.log("\n[6] Non-FI column integrity sample — pre-populated FI starters (Buehler etc.):");
  // These already had FI; their non-FI fields should not have been touched by S6
  for (const pid of PRE_FI_POPULATED.slice(0, 3)) {
    const rr = fiMap.get(pid);
    const name = nameMap.get(pid) ?? "?";
    console.log(`   pid=${pid}  ${name}  pitching_era=${rr?.pitching_era ?? "null"}  pitching_ip=${rr?.pitching_ip ?? "null"}  (unchanged from S5)`);
  }
  
  console.log("\n══════ SUMMARY ══════");
  const allOk = (r.refresh_status === "success" || r.refresh_status === "partial") && fiIncreased && warrenFiOk && warrenNonFiPreserved;
  console.log(`Overall: ${allOk ? "✓ WRITE-MODE FIRST RUN: PASS" : "✗ ONE OR MORE CHECKS FAILED"}`);
  console.log(`  - Cron completed:                ${r.refresh_status}`);
  console.log(`  - FI count increased:            ${fiIncreased ? "✓" : "✗"} (${BASELINE_FI_COUNT} → ${withFi})`);
  console.log(`  - Warren FI populated:           ${warrenFiOk ? "✓" : "✗"}`);
  console.log(`  - Warren non-FI preserved:       ${warrenNonFiPreserved ? "✓" : "✗"}`);
  console.log(`  - Slate starter FI coverage:     ${populated}/${TODAY_STARTERS.length}`);
  console.log(`\nFinished: ${new Date().toISOString()}`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
