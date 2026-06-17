/** READ-ONLY — verify prod activation: feature_capture on fresh writes + gate
 * demotions on today's unlocked MLB slate. No writes. */
import { supabase } from "../../lib/db/supabase";
const PUBLIC = new Set(["best_angle", "lean", "market_aligned", "provisional"]);
const pub = (g: any) => (g != null && PUBLIC.has(String(g)) ? String(g) : null);
function ev(p: number | null, o: number | null): number | null { if (p == null || o == null) return null; const d = o > 0 ? o / 100 : 100 / -o; return p * d - (1 - p); }

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, matchup, market, side, play_grade, best_angle, odds_american, model_probability, line_value, locked_at, snapshot_json")
    .eq("sport", "mlb").eq("slate_date", "2026-06-15").order("matchup");
  const rows = (data ?? []) as any[];
  console.log(`=== Today 2026-06-15 MLB records: ${rows.length} ===`);
  const fc = rows.filter(r => r.snapshot_json?.v2_2_audit?.feature_capture != null);
  const fcFI = rows.filter(r => r.snapshot_json?.fi_v2_audit?.feature_capture != null);
  console.log(`feature_capture present (v2_2_audit): ${fc.length}/${rows.filter(r => r.market !== "first_inning").length} non-FI`);
  console.log(`FI feature_capture present: ${fcFI.length}/${rows.filter(r => r.market === "first_inning").length} FI`);
  const locked = rows.filter(r => r.locked_at != null).length;
  console.log(`locked rows: ${locked}  unlocked: ${rows.length - locked}`);

  console.log(`\n=== GATE demotions (ladder said 'lean' → stored grade differs) ===`);
  console.log("matchup            mkt   side  ladder→stored        reason  locked");
  let demoted = 0;
  for (const r of rows) {
    const a = r.snapshot_json?.v2_2_audit ?? {};
    const pre = r.market === "moneyline" ? "ml" : r.market === "total" ? "ou" : null;
    const ladder = pre ? pub(a[`${pre}_play_grade`]) : pub(r.snapshot_json?.fi_v2_audit?.fi_play_grade);
    const stored = pub(r.play_grade);
    if (ladder === "lean" && stored !== "lean") {
      demoted++;
      const e = ev(r.model_probability, r.odds_american);
      const runGap = typeof a.posterior_home_diff === "number" ? Math.abs(a.posterior_home_diff) : null;
      let reason = "";
      if ((e ?? 0) < 0) reason += "EV<0 ";
      if (r.market === "moneyline" && r.odds_american < 0 && runGap != null && runGap < 0.5) reason += "lowConvFav ";
      if (r.market === "total" && r.line_value != null && r.line_value < 8) reason += "line<8 ";
      console.log(`${String(r.matchup).padEnd(16)} ${String(r.market).slice(0, 5).padEnd(5)} ${String(r.side).padEnd(5)} ${(ladder + "→" + stored).padEnd(20)} ${reason.padEnd(20)} ${r.locked_at ? "LOCKED" : "unlocked"}`);
    }
  }
  if (!demoted) console.log("  (none — no Lean met a gate condition on today's slate)");

  console.log(`\n=== board grade distribution (stored) ===`);
  const dist: Record<string, number> = {};
  for (const r of rows) { const g = String(r.play_grade ?? "null"); dist[g] = (dist[g] ?? 0) + 1; }
  for (const k of Object.keys(dist).sort()) console.log(`  ${k}: ${dist[k]}`);
  const board = rows.filter(r => r.best_angle === true || pub(r.play_grade) === "lean");
  console.log(`  public board (BA-bool OR lean): ${board.length}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
