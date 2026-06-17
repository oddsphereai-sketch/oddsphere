/**
 * Phase 6B.20 + tracking lifecycle diagnostic. Read-only.
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  console.log(`\n=== Tracking Lifecycle Diagnostic (slate ${today}, yesterday ${yesterday}) ===\n`);

  // 1) Last 10 tracking_refresh log rows
  console.log("── data_refresh_log: last 10 tracking_refresh ──");
  const { data: runs } = await sb
    .from("data_refresh_log")
    .select("id, data_source, sport, refresh_status, refresh_started_at, refresh_completed_at, records_updated, error_message")
    .eq("data_source", "tracking_refresh")
    .order("refresh_started_at", { ascending: false })
    .limit(10);
  for (const r of runs ?? []) {
    console.log(
      `  #${r.id} start=${r.refresh_started_at} end=${r.refresh_completed_at ?? "—"} | ${r.refresh_status} | rec=${r.records_updated ?? 0}${r.error_message ? ` | err=${r.error_message.slice(0, 80)}` : ""}`,
    );
  }

  console.log("\n── data_refresh_log: last 4 slate_cycle ──");
  const { data: sruns } = await sb
    .from("data_refresh_log")
    .select("id, refresh_status, refresh_started_at, refresh_completed_at, records_updated")
    .eq("data_source", "slate_cycle")
    .order("refresh_started_at", { ascending: false })
    .limit(4);
  for (const r of sruns ?? []) {
    console.log(`  #${r.id} ${r.refresh_started_at} → ${r.refresh_completed_at ?? "—"} | ${r.refresh_status} | rec=${r.records_updated ?? 0}`);
  }

  // 2) Today's prediction_records by market
  console.log("\n── prediction_records: today by market ──");
  const { data: trecs } = await sb
    .from("prediction_records")
    .select("id, market, pick, side, prediction_type, no_bet, locked_at, launch_day, game_id")
    .eq("sport", "mlb")
    .eq("slate_date", today);
  const byMarket: Record<string, { total: number; locked: number; no_bet: number; toss: number; launch: number }> = {};
  for (const r of trecs ?? []) {
    const m = (r as any).market ?? "unknown";
    if (!byMarket[m]) byMarket[m] = { total: 0, locked: 0, no_bet: 0, toss: 0, launch: 0 };
    byMarket[m].total++;
    if ((r as any).locked_at) byMarket[m].locked++;
    if ((r as any).no_bet) byMarket[m].no_bet++;
    if ((r as any).prediction_type === "toss_up") byMarket[m].toss++;
    if ((r as any).launch_day) byMarket[m].launch++;
  }
  for (const [m, c] of Object.entries(byMarket)) {
    console.log(`  ${m.padEnd(13)} total=${c.total} locked=${c.locked} no_bet=${c.no_bet} toss=${c.toss} launch=${c.launch}`);
  }

  // 3) FI detailed
  console.log("\n── FI rows detail ──");
  const fiRecs = (trecs ?? []).filter((r: any) => r.market === "first_inning");
  for (const r of fiRecs) {
    const tag = (r as any).no_bet ? "[TOSS]" : "[ACT ]";
    console.log(`  ${tag} rec=${(r as any).id} pick=${(r as any).pick} side=${(r as any).side ?? "-"} type=${(r as any).prediction_type ?? "-"} no_bet=${(r as any).no_bet}`);
  }

  // 4) prediction_grades for today's rec_ids
  console.log("\n── prediction_grades for today's rec_ids ──");
  const recIds = (trecs ?? []).map((r: any) => r.id);
  const { data: grades } = await sb
    .from("prediction_grades")
    .select("prediction_record_id, market, result, win, loss, push, void, pending, actual_first_inning_runs, actual_home_score, actual_away_score, graded_at, grade_source, grade_notes")
    .in("prediction_record_id", recIds)
    .order("graded_at", { ascending: false });
  const byMkt: Record<string, Record<string, number>> = {};
  for (const g of grades ?? []) {
    const m = (g as any).market ?? "unknown";
    if (!byMkt[m]) byMkt[m] = {};
    byMkt[m][(g as any).result] = (byMkt[m][(g as any).result] ?? 0) + 1;
  }
  for (const [m, dist] of Object.entries(byMkt)) {
    console.log(`  ${m.padEnd(13)} ${JSON.stringify(dist)}`);
  }
  console.log(`  Total grades today: ${(grades ?? []).length}`);
  for (const g of (grades ?? []).slice(0, 20)) {
    const recRow = (trecs ?? []).find((r: any) => r.id === (g as any).prediction_record_id);
    const tag = (recRow as any)?.no_bet ? "[TOSS]" : "[ACT ]";
    const gg = g as any;
    console.log(
      `  ${tag} rec=${gg.prediction_record_id} mkt=${gg.market} → ${gg.result} (W=${gg.win} L=${gg.loss} V=${gg.void}) fi=${gg.actual_first_inning_runs ?? "-"} h=${gg.actual_home_score ?? "-"} a=${gg.actual_away_score ?? "-"} graded=${gg.graded_at?.slice(0, 19)} note="${(gg.grade_notes ?? "").slice(0, 60)}"`,
    );
  }

  // 5) games table — first_inning_runs / scores for today
  console.log("\n── games: today's status + first_inning_runs ──");
  const fiGameIds = Array.from(new Set((trecs ?? []).filter((r: any) => r.market === "first_inning").map((r: any) => r.game_id).filter(Boolean)));
  if (fiGameIds.length === 0) {
    console.log("  (no FI game_ids)");
  } else {
    const { data: games } = await sb
      .from("games")
      .select("id, away_team, home_team, status, home_score, away_score, first_inning_runs, updated_at")
      .in("id", fiGameIds)
      .order("id");
    let withFi = 0, withoutFi = 0;
    for (const g of games ?? []) {
      const gg = g as any;
      if (gg.first_inning_runs !== null) withFi++;
      else withoutFi++;
      console.log(`  g=${gg.id} ${gg.away_team}@${gg.home_team} status=${gg.status} score=${gg.away_score ?? "-"}-${gg.home_score ?? "-"} fi=${gg.first_inning_runs ?? "-"} upd=${gg.updated_at?.slice(0, 19)}`);
    }
    console.log(`  totals: with_fi=${withFi} / without_fi=${withoutFi}`);
  }

  // 6) Simulated public W/L FI tally for today
  console.log("\n── Simulated FI public tally (today) ──");
  const gradeByRec = new Map<number, any>();
  for (const g of grades ?? []) gradeByRec.set((g as any).prediction_record_id, g);
  let pubW = 0, pubL = 0, pubP = 0, pubV = 0, pubPen = 0, excluded = 0;
  for (const r of fiRecs) {
    const rr = r as any;
    if (rr.launch_day === true) { excluded++; continue; }
    if (rr.no_bet === true) { excluded++; continue; }
    const g = gradeByRec.get(rr.id);
    if (!g) { pubPen++; continue; }
    if (g.win) pubW++;
    else if (g.loss) pubL++;
    else if (g.push) pubP++;
    else if (g.void) pubV++;
    else pubPen++;
  }
  console.log(`  W=${pubW}  L=${pubL}  Push=${pubP}  Void=${pubV}  Pending=${pubPen}  Excluded=${excluded}`);
  console.log(`  EXPECTED: W=5  L=1  Pending=3  Excluded=6`);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
