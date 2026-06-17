/**
 * Phase 6B.23 — Tracking Lifecycle Audit. Read-only.
 *
 * Single comprehensive probe: cron logs + games + prediction_records +
 * prediction_grades + cross-reference, all in one pass. Designed so the
 * output answers the user's audit checklist without multiple round-trips.
 */
import { createClient } from "@supabase/supabase-js";
import { computeTrackingAggregate } from "../../lib/services/trackingAggregateService";

const ET_TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log(`\n═══════════ Tracking Lifecycle Audit · ${ET_TODAY} (ET) ═══════════\n`);

  // 1. CRON LOGS ─────────────────────────────────────────────────────
  console.log("── 1. tracking_refresh cron (last 10 runs) ──");
  const { data: runs } = await sb
    .from("data_refresh_log")
    .select("id, refresh_status, refresh_started_at, refresh_completed_at, records_updated, error_message")
    .eq("data_source", "tracking_refresh")
    .order("refresh_started_at", { ascending: false })
    .limit(10);
  for (const r of runs ?? []) {
    const r0 = r as any;
    console.log(`  #${r0.id} ${r0.refresh_started_at} → ${r0.refresh_completed_at ?? "—"} | ${r0.refresh_status} | rec=${r0.records_updated ?? 0}${r0.error_message ? ` | err=${r0.error_message.slice(0,80)}` : ""}`);
  }

  console.log("\n── post_game_results / score ingest (last 5 runs) ──");
  const { data: pgRuns } = await sb
    .from("data_refresh_log")
    .select("id, data_source, refresh_status, refresh_started_at, refresh_completed_at, records_updated, error_message")
    .in("data_source", ["post_game_results", "score_ingest", "tracking_refresh"])
    .order("refresh_started_at", { ascending: false })
    .limit(8);
  for (const r of pgRuns ?? []) {
    const r0 = r as any;
    console.log(`  ${r0.data_source.padEnd(20)} #${r0.id} ${r0.refresh_started_at} → ${r0.refresh_completed_at ?? "—"} | ${r0.refresh_status}`);
  }

  // 2. GAMES TODAY ───────────────────────────────────────────────────
  console.log("\n── 2. Today's MLB games — status, scores, first_inning ──");
  // Pull game_ids first from prediction_records
  const { data: prRows } = await sb
    .from("prediction_records")
    .select("game_id")
    .eq("sport", "mlb")
    .eq("slate_date", ET_TODAY);
  const gameIds = Array.from(new Set((prRows ?? []).map((r: any) => r.game_id))).filter((x): x is number => typeof x === "number");

  const { data: games } = await sb
    .from("games")
    .select("id, external_id, status, home_team_id, away_team_id, home_score, away_score, first_inning_runs, total_runs, game_date, updated_at")
    .in("id", gameIds)
    .order("game_date");

  const { data: teamRows } = await sb
    .from("teams")
    .select("id, abbreviation")
    .in("id", Array.from(new Set([
      ...(games ?? []).map((g: any) => g.home_team_id),
      ...(games ?? []).map((g: any) => g.away_team_id),
    ])));
  const teamAbbrev = new Map<number, string>((teamRows ?? []).map((t: any) => [t.id, t.abbreviation]));

  const statusCounts: Record<string, number> = {};
  const finalGameIds: number[] = [];
  for (const g of (games ?? []) as any[]) {
    statusCounts[g.status] = (statusCounts[g.status] ?? 0) + 1;
    const isFinal = g.status === "final" || g.status === "STATUS_FINAL" || g.status === "Final" || g.status === "post" || g.status === "completed";
    if (isFinal) finalGameIds.push(g.id);
    const away = teamAbbrev.get(g.away_team_id) ?? "?";
    const home = teamAbbrev.get(g.home_team_id) ?? "?";
    const finalSig = isFinal ? "[FINAL]" : g.status === "STATUS_IN_PROGRESS" ? "[LIVE ]" : "[     ]";
    const fiOk = g.first_inning_runs !== null ? "fi✓" : "fi—";
    const scoresOk = g.home_score !== null && g.away_score !== null ? "score✓" : "score—";
    console.log(`  ${finalSig} g=${g.id} ${away}@${home} status=${g.status} score=${g.away_score ?? "-"}-${g.home_score ?? "-"} fi=${g.first_inning_runs ?? "-"} total=${g.total_runs ?? "-"} ${fiOk} ${scoresOk} upd=${g.updated_at?.slice(11,19)}`);
  }
  console.log(`\n  status counts: ${JSON.stringify(statusCounts)}`);
  console.log(`  ${finalGameIds.length} games look FINAL (status string match) of ${(games ?? []).length} total`);

  // 3. PREDICTION_RECORDS BREAKDOWN ──────────────────────────────────
  console.log("\n── 3. prediction_records counts (today) ──");
  const { data: recs } = await sb
    .from("prediction_records")
    .select("id, game_id, market, pick, side, line_value, odds_american, confidence, play_grade, prediction_type, best_angle, no_bet, locked_at")
    .eq("sport", "mlb")
    .eq("slate_date", ET_TODAY);
  const byMarket: Record<string, any> = {};
  for (const r of (recs ?? []) as any[]) {
    const m = r.market;
    if (!byMarket[m]) byMarket[m] = { total: 0, locked: 0, no_bet: 0, best_angle: 0, by_play_grade: {}, actionable: 0 };
    byMarket[m].total++;
    if (r.locked_at) byMarket[m].locked++;
    if (r.no_bet) byMarket[m].no_bet++;
    else byMarket[m].actionable++;
    if (r.best_angle) byMarket[m].best_angle++;
    const pg = r.play_grade ?? "(none)";
    byMarket[m].by_play_grade[pg] = (byMarket[m].by_play_grade[pg] ?? 0) + 1;
  }
  for (const [m, c] of Object.entries(byMarket)) {
    const cc = c as any;
    console.log(`  ${m.padEnd(13)} total=${cc.total} locked=${cc.locked} actionable=${cc.actionable} no_bet=${cc.no_bet} best_angle=${cc.best_angle}`);
    console.log(`                play_grade: ${JSON.stringify(cc.by_play_grade)}`);
  }

  // 4. PREDICTION_GRADES BREAKDOWN ───────────────────────────────────
  console.log("\n── 4. prediction_grades by market/result (today) ──");
  const recIds = (recs ?? []).map((r: any) => r.id);
  const { data: grades } = await sb
    .from("prediction_grades")
    .select("prediction_record_id, market, result, win, loss, push, void, pending, graded_at, grade_notes, actual_home_score, actual_away_score, actual_total, actual_first_inning_runs")
    .in("prediction_record_id", recIds);
  const byMR: Record<string, Record<string, number>> = {};
  const gradeByRec = new Map<number, any>();
  for (const g of (grades ?? []) as any[]) {
    gradeByRec.set(g.prediction_record_id, g);
    const m = g.market;
    if (!byMR[m]) byMR[m] = {};
    byMR[m][g.result] = (byMR[m][g.result] ?? 0) + 1;
  }
  for (const [m, dist] of Object.entries(byMR)) {
    console.log(`  ${m.padEnd(13)} ${JSON.stringify(dist)}`);
  }
  // Also show records without ANY grade row
  const recsWithoutGrade = (recs ?? []).filter((r: any) => !gradeByRec.has(r.id));
  console.log(`  records without ANY grade row: ${recsWithoutGrade.length}`);

  // 5. PER-FINAL-GAME CROSS-REFERENCE ────────────────────────────────
  console.log("\n── 5. Cross-ref: games with status=FINAL — are ML/OU/FI graded? ──");
  for (const gid of finalGameIds) {
    const g = (games ?? []).find((x: any) => x.id === gid) as any;
    const away = teamAbbrev.get(g.away_team_id) ?? "?";
    const home = teamAbbrev.get(g.home_team_id) ?? "?";
    const totalRuns = (g.home_score ?? 0) + (g.away_score ?? 0);
    console.log(`\n  ${away}@${home} g=${gid} status=${g.status} score=${g.away_score}-${g.home_score} fi=${g.first_inning_runs} total=${totalRuns}`);
    const gameRecs = (recs ?? []).filter((r: any) => r.game_id === gid) as any[];
    for (const r of gameRecs) {
      const gr = gradeByRec.get(r.id);
      const grTag = !gr ? "[NO GRADE]" : gr.pending ? "[PENDING] " : gr.win ? "[WIN]     " : gr.loss ? "[LOSS]    " : gr.push ? "[PUSH]    " : gr.void ? "[VOID]    " : `[${gr.result}]`;
      const noBetTag = r.no_bet ? " (no_bet)" : "";
      console.log(`    ${grTag} rec=${r.id} mkt=${r.market} pick=${r.pick} line=${r.line_value ?? "-"} odds=${r.odds_american ?? "-"}${noBetTag}${gr?.grade_notes ? ` — ${gr.grade_notes.slice(0,80)}` : ""}`);
    }
  }

  // 6. Status string distribution + raw values seen ──────────────────
  console.log("\n── 6. Distinct status strings seen on today's games ──");
  console.log(`  ${JSON.stringify(statusCounts)}`);
  console.log("  Grader's recognized statuses:");
  console.log("    final → \"final\", \"STATUS_FINAL\"");
  console.log("    pending → \"scheduled\", \"STATUS_SCHEDULED\", \"in_progress\", \"STATUS_IN_PROGRESS\", \"live\", \"suspended\"");
  console.log("    void → \"postponed\", \"canceled\", \"cancelled\"");

  // 7. Tracking aggregate (public-facing simulation) ─────────────────
  console.log("\n── 7. Public /lab/tracking-foundation snapshot (computed locally) ──");
  const agg = await computeTrackingAggregate({ supabase: sb as any, sport: "mlb", includeLaunchDay: false });
  console.log(`  overall: picks=${agg.overall.picks} wins=${agg.overall.wins} losses=${agg.overall.losses} pushes=${agg.overall.pushes} voids=${agg.overall.voids} pending=${agg.overall.pending}`);
  console.log(`  yesterday: ${agg.yesterday.date} → ${JSON.stringify({W: agg.yesterday.overall.wins, L: agg.yesterday.overall.losses, pen: agg.yesterday.overall.pending})}`);
  console.log(`  thisWeek: ${agg.thisWeek.from}→${agg.thisWeek.to} → ${JSON.stringify({W: agg.thisWeek.overall.wins, L: agg.thisWeek.overall.losses, pen: agg.thisWeek.overall.pending})}`);
  console.log(`  recentlySettled: ${agg.recentlySettled.length}`);
  console.log(`  by sport-market:`);
  for (const b of agg.bySportMarket) {
    console.log(`    ${b.sport}-${b.market}: ${b.metrics.picks} picks → W:${b.metrics.wins} L:${b.metrics.losses} pen:${b.metrics.pending} void:${b.metrics.voids}`);
  }
  console.log(`  bestAngles: picks=${agg.bestAngles.picks} W:${agg.bestAngles.wins} L:${agg.bestAngles.losses}`);
  console.log(`  leans: picks=${agg.leans.picks} W:${agg.leans.wins} L:${agg.leans.losses}`);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
