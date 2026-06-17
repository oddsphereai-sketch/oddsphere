/** MLB diagnostic Section 7 — counterfactual backtests for proposed Lean-demotion rules. READ-ONLY. */
import { supabase } from "../../lib/db/supabase";
const TRACKING_START = "2026-06-07";

type Row = { date: string; market: string; grade: string; side: string | null; odds: number | null; p: number | null; res: string; lineMoveDir: string | null; pickedMoney: number | null; conflict: boolean | null; };
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
function stats(arr: Row[]) {
  const g = arr.filter(r => r.res === "win" || r.res === "loss");
  const w = g.filter(r => r.res === "win").length, l = g.filter(r => r.res === "loss").length;
  let net = 0, n = 0; for (const r of g) { if (r.odds === null) continue; n++; net += profit(r.odds, r.res === "win"); }
  return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roiN: n, roi: n ? 100 * net / n : 0 };
}
function fmt(s: ReturnType<typeof stats>): string { return `${s.w}-${s.l} (${s.pct.toFixed(0)}%, n=${s.t}) | ${s.units >= 0 ? "+" : ""}${s.units.toFixed(1)}u (${s.roi.toFixed(0)}%, n=${s.roiN})`; }

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, market, play_grade, side, odds_american, model_probability, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", TRACKING_START);
  const rows: Row[] = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true).map((r: any) => {
    const g = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const sj = r.snapshot_json ?? {};
    return { date: String(r.slate_date), market: String(r.market), grade: String(r.play_grade ?? "").toLowerCase(), side: r.side, odds: r.odds_american, p: r.model_probability, res: String(g?.result ?? "").toLowerCase(), lineMoveDir: sj.line_movement?.direction ?? null, pickedMoney: sj.public_splits?.picked_money_pct ?? null, conflict: sj.public_splits?.conflict ?? null };
  });
  const leans = rows.filter(r => r.grade === "lean");
  const base = stats(leans);
  console.log(`\nBASELINE — all MLB Leans: ${fmt(base)}\n`);

  const rules: { id: string; desc: string; demote: (r: Row) => boolean }[] = [
    { id: "R1", desc: "Lean p<0.55 → Watchlist", demote: r => r.p !== null && r.p < 0.55 },
    { id: "R2", desc: "Lean public-heavy (>65% money on pick) → Watchlist", demote: r => r.pickedMoney !== null && r.pickedMoney > 65 },
    { id: "R3", desc: "Lean splits-conflict → Watchlist", demote: r => r.conflict === true },
    { id: "R4", desc: "Lean total UNDER → Watchlist", demote: r => r.market === "total" && r.side === "under" },
    { id: "R5", desc: "Lean line-move against_pick → Watchlist", demote: r => r.lineMoveDir === "against_pick" },
    { id: "R6", desc: "Lean p<0.55 OR splits-conflict → Watchlist", demote: r => (r.p !== null && r.p < 0.55) || r.conflict === true },
    { id: "R7", desc: "Lean p<0.55 OR public-heavy>65% → Watchlist", demote: r => (r.p !== null && r.p < 0.55) || (r.pickedMoney !== null && r.pickedMoney > 65) },
  ];
  for (const rule of rules) {
    const removed = leans.filter(rule.demote);
    const kept = leans.filter(r => !rule.demote(r));
    const rs = stats(removed), ks = stats(kept);
    const robust = ks.t >= 15 ? "robust-ish" : "⚠ small remaining";
    console.log(`${rule.id}: ${rule.desc}`);
    console.log(`   removed (→Watchlist): ${fmt(rs)}  [winners removed=${rs.w}, losers removed=${rs.l}]`);
    console.log(`   KEPT as Lean:         ${fmt(ks)}   (${robust})`);
    console.log(`   net effect: public Lean board ${base.pct.toFixed(0)}%→${ks.pct.toFixed(0)}%, ROI ${base.roi.toFixed(0)}%→${ks.roi.toFixed(0)}%, removes ${rs.t} picks (${rs.l} losers / ${rs.w} winners)\n`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
