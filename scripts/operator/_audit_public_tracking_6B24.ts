/**
 * Phase 6B.24 — Audit public-facing /lab/tracking rollup + lock lifecycle.
 * READ-ONLY.
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

  console.log(`\n════════════ Public Tracking + Lock Audit · ${ET_TODAY} ════════════\n`);

  // ── 1. tracking_baselines table ──────────────────────────────────
  console.log("── 1. tracking_baselines table (the historical lifetime numbers) ──");
  const { data: baselines } = await sb
    .from("tracking_baselines")
    .select("sport, market, source_label, model_family, lifetime_wins, lifetime_total, lifetime_pct, current_season_wins, current_season_total, current_season_pct");
  for (const b of (baselines ?? []) as any[]) {
    console.log(`  ${b.sport}/${b.market.padEnd(13)} lifetime=${b.lifetime_wins}/${b.lifetime_total} (${b.lifetime_pct}%) season=${b.current_season_wins ?? "-"}/${b.current_season_total ?? "-"} src=${b.source_label}`);
  }
  if ((baselines ?? []).length === 0) console.log("  (none)");

  // ── 2. Aggregator output today ───────────────────────────────────
  console.log("\n── 2. trackingAggregateService.bySportMarket (today's slate counts) ──");
  const agg = await computeTrackingAggregate({ supabase: sb as any, sport: "mlb", includeLaunchDay: false });
  for (const b of agg.bySportMarket) {
    console.log(`  ${b.sport}/${b.market.padEnd(13)} picks=${b.metrics.picks} W=${b.metrics.wins} L=${b.metrics.losses} P=${b.metrics.pushes} V=${b.metrics.voids} pen=${b.metrics.pending}`);
  }

  // ── 3. NRFI vs YRFI split — what would-be NRFI/YRFI buckets contain ─
  console.log("\n── 3. Today's FI records split by pick (NRFI / YRFI / Toss-Up) ──");
  const { data: fiRecs } = await sb
    .from("prediction_records")
    .select("id, matchup, pick, no_bet")
    .eq("sport", "mlb")
    .eq("slate_date", ET_TODAY)
    .eq("market", "first_inning");
  const fiIds = (fiRecs ?? []).map((r: any) => r.id);
  const { data: fiGrades } = await sb
    .from("prediction_grades")
    .select("prediction_record_id, result, win, loss")
    .in("prediction_record_id", fiIds);
  const gByRec = new Map<number, any>((fiGrades ?? []).map((g: any) => [g.prediction_record_id, g]));
  const nrfiW: any[] = [], nrfiL: any[] = [], nrfiPen: any[] = [];
  const yrfiW: any[] = [], yrfiL: any[] = [], yrfiPen: any[] = [];
  const tossExcluded: any[] = [];
  for (const r of (fiRecs ?? []) as any[]) {
    if (r.no_bet === true) { tossExcluded.push(r); continue; }
    const g = gByRec.get(r.id);
    if (!g || g.result === "pending") {
      if (r.pick === "NRFI") nrfiPen.push(r);
      else if (r.pick === "YRFI") yrfiPen.push(r);
      continue;
    }
    if (r.pick === "NRFI") {
      if (g.win) nrfiW.push(r); else if (g.loss) nrfiL.push(r);
    } else if (r.pick === "YRFI") {
      if (g.win) yrfiW.push(r); else if (g.loss) yrfiL.push(r);
    }
  }
  console.log(`  TODAY NRFI:    W=${nrfiW.length}  L=${nrfiL.length}  pen=${nrfiPen.length}`);
  console.log(`  TODAY YRFI:    W=${yrfiW.length}  L=${yrfiL.length}  pen=${yrfiPen.length}`);
  console.log(`  TODAY Toss-Up: excluded=${tossExcluded.length}`);

  // ── 4. What page builds: lifetime per-market source ──────────────
  console.log("\n── 4. Public page's per-category source (today) ──");
  const baselineKeys = new Set((baselines ?? []).map((b: any) => `${b.sport}:${b.market}`));
  const liveBuckets = new Map<string, any>(agg.bySportMarket.map((b) => [`${b.sport}:${b.market}`, b]));
  const allKeys = new Set<string>([...baselineKeys, ...liveBuckets.keys()]);
  for (const key of Array.from(allKeys).sort()) {
    const base = (baselines ?? []).find((b: any) => `${b.sport}:${b.market}` === key);
    const live = liveBuckets.get(key);
    const liveDecided = live ? live.metrics.wins + live.metrics.losses : 0;
    let source: string;
    let displayed: string;
    if (live && liveDecided > 0) {
      source = "AUTOMATED (today only — baseline NOT merged)";
      displayed = `${live.metrics.wins}-${live.metrics.losses}`;
    } else if (base) {
      source = "MAINTAINED baseline";
      displayed = `${base.lifetime_wins}/${base.lifetime_total} (${base.lifetime_pct}%)`;
    } else if (live && live.metrics.pending > 0) {
      source = "AUTOMATED pending only";
      displayed = `${live.metrics.pending} pending`;
    } else {
      continue;
    }
    console.log(`  ${key.padEnd(20)}  →  ${source}  →  "${displayed}"`);
  }

  // ── 5. NYM@SD lock-lifecycle audit ───────────────────────────────
  console.log("\n── 5. NYM @ SD lock lifecycle (game 14856) ──");
  const { data: nymsd } = await sb
    .from("prediction_records")
    .select("id, market, pick, side, line_value, odds_american, confidence, play_grade, prediction_type, best_angle, no_bet, no_bet_reason, locked_at, published_at, created_at, snapshot_json")
    .eq("game_id", 14856)
    .order("id");
  for (const r of (nymsd ?? []) as any[]) {
    console.log(`\n  rec=${r.id} market=${r.market}`);
    console.log(`    pick=${r.pick} side=${r.side} line=${r.line_value} odds=${r.odds_american} conf=${r.confidence}`);
    console.log(`    play_grade=${r.play_grade} best_angle=${r.best_angle} prediction_type=${r.prediction_type}`);
    console.log(`    no_bet=${r.no_bet} no_bet_reason=${r.no_bet_reason ?? "-"}`);
    console.log(`    locked_at=${r.locked_at ?? "NOT LOCKED"} published_at=${r.published_at ?? "-"} created_at=${r.created_at ?? "-"}`);
    const sp = r.snapshot_json ?? {};
    console.log(`    snapshot.${r.market === "moneyline" ? "ml" : r.market === "total" ? "ou" : "fi"}_play_grade=${sp[`${r.market === "moneyline" ? "ml" : r.market === "total" ? "ou" : "fi"}_play_grade`] ?? "-"}`);
    console.log(`    snapshot.${r.market === "moneyline" ? "ml" : "ou"}_best_angle_eligible=${sp[`${r.market === "moneyline" ? "ml" : "ou"}_best_angle_eligible`] ?? "-"}`);
    console.log(`    snapshot.${r.market === "moneyline" ? "ml" : "ou"}_best_angle_reason=${sp[`${r.market === "moneyline" ? "ml" : "ou"}_best_angle_reason`] ?? "-"}`);
  }

  // Live game_predictions row (current state)
  const { data: liveGp } = await sb
    .from("game_predictions")
    .select("id, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence, locked_at, computed_at, updated_at, sport_specific")
    .eq("game_id", 14856)
    .maybeSingle();
  if (liveGp) {
    const lg = liveGp as any;
    console.log(`\n  live game_predictions row:`);
    console.log(`    predicted_ml_winner=${lg.predicted_ml_winner} ml_confidence=${lg.ml_confidence}`);
    console.log(`    predicted_ou_side=${lg.predicted_ou_side} ou_confidence=${lg.ou_confidence}`);
    console.log(`    predicted_nrfi=${lg.predicted_nrfi} nrfi_confidence=${lg.nrfi_confidence}`);
    console.log(`    locked_at=${lg.locked_at ?? "NOT LOCKED"} computed_at=${lg.computed_at} updated_at=${lg.updated_at ?? "-"}`);
    const sp = lg.sport_specific ?? {};
    console.log(`    live sp.ml_play_grade=${sp.ml_play_grade ?? "-"} ml_best_angle_eligible=${sp.ml_best_angle_eligible ?? "-"}`);
    console.log(`    live sp.ou_play_grade=${sp.ou_play_grade ?? "-"} ou_best_angle_eligible=${sp.ou_best_angle_eligible ?? "-"}`);
  }

  // ── 6. All-game lock audit ───────────────────────────────────────
  console.log("\n── 6. All today's records — lock status + play_grade drift check ──");
  const { data: allRecs } = await sb
    .from("prediction_records")
    .select("id, game_id, market, play_grade, best_angle, locked_at, snapshot_json")
    .eq("sport", "mlb")
    .eq("slate_date", ET_TODAY)
    .order("game_id");
  const gameIds = Array.from(new Set((allRecs ?? []).map((r: any) => r.game_id)));
  const { data: liveGps } = await sb
    .from("game_predictions")
    .select("game_id, sport_specific, locked_at")
    .in("game_id", gameIds);
  const liveGpByGame = new Map<number, any>((liveGps ?? []).map((g: any) => [g.game_id, g]));

  let lockedRecs = 0, unlockedRecs = 0, mismatchPlayGrade = 0, mismatchBestAngle = 0;
  const mismatches: string[] = [];
  for (const r of (allRecs ?? []) as any[]) {
    if (r.locked_at) lockedRecs++; else unlockedRecs++;
    const live = liveGpByGame.get(r.game_id);
    if (!live) continue;
    const liveSp = live.sport_specific ?? {};
    const lockedSp = r.snapshot_json ?? {};
    // Compare play_grade and best_angle_eligible for ML/OU
    if (r.market === "moneyline" || r.market === "total") {
      const prefix = r.market === "moneyline" ? "ml" : "ou";
      const lockedPg = lockedSp[`${prefix}_play_grade`];
      const livePg = liveSp[`${prefix}_play_grade`];
      const lockedBa = lockedSp[`${prefix}_best_angle_eligible`];
      const liveBa = liveSp[`${prefix}_best_angle_eligible`];
      if (lockedPg !== livePg) {
        mismatchPlayGrade++;
        mismatches.push(`  g=${r.game_id} rec=${r.id} ${r.market}: locked play_grade=${lockedPg} → LIVE play_grade=${livePg}`);
      }
      if (lockedBa !== liveBa) {
        mismatchBestAngle++;
        mismatches.push(`  g=${r.game_id} rec=${r.id} ${r.market}: locked best_angle_eligible=${lockedBa} → LIVE best_angle_eligible=${liveBa}`);
      }
    }
  }
  console.log(`  locked records:   ${lockedRecs}`);
  console.log(`  unlocked records: ${unlockedRecs}`);
  console.log(`  play_grade drift (locked vs live): ${mismatchPlayGrade}`);
  console.log(`  best_angle drift (locked vs live): ${mismatchBestAngle}`);
  for (const m of mismatches) console.log(m);

  // ── 7. What Daily Edge displays for NYM@SD right now ────────────
  console.log("\n── 7. NYM @ SD display reconciliation ──");
  console.log(`  (See section 5 above for locked record state.)`);
  console.log(`  Daily Edge route reads game_predictions.sport_specific (live) UNLESS the record is locked + snapshot_json exists, per Phase 6B.18.`);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
