/** R1 threshold sensitivity (53-57%) + current-slate Lean detail. READ-ONLY. */
import { supabase } from "../../lib/db/supabase";
const TRACKING_START = "2026-06-07";

type Row = { market: string; side: string | null; odds: number | null; p: number | null; edge: number | null; res: string; lineMoveDir: string | null; pickedMoney: number | null; conflict: boolean | null; support: boolean | null; };
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
function stats(arr: Row[]) {
  const g = arr.filter(r => r.res === "win" || r.res === "loss");
  const w = g.filter(r => r.res === "win").length, l = g.filter(r => r.res === "loss").length;
  let net = 0, n = 0; for (const r of g) { if (r.odds === null) continue; n++; net += profit(r.odds, r.res === "win"); }
  return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roi: n ? 100 * net / n : 0, roiN: n };
}
function fmt(s: ReturnType<typeof stats>): string { return `${s.w}-${s.l} (${s.pct.toFixed(0)}%) ${s.units >= 0 ? "+" : ""}${s.units.toFixed(1)}u/${s.roi.toFixed(0)}%`; }

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, market, play_grade, side, odds_american, model_probability, edge, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", TRACKING_START);
  const mk = (r: any): Row => { const g = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const sj = r.snapshot_json ?? {}; return { market: String(r.market), side: r.side, odds: r.odds_american, p: r.model_probability, edge: r.edge, res: String(g?.result ?? "").toLowerCase(), lineMoveDir: sj.line_movement?.direction ?? null, pickedMoney: sj.public_splits?.picked_money_pct ?? null, conflict: sj.public_splits?.conflict ?? null, support: sj.public_splits?.support ?? null }; };
  const leans = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true && String(r.play_grade).toLowerCase() === "lean").map(mk);
  const base = stats(leans);
  console.log(`\nBASELINE all MLB Leans: ${fmt(base)} (n=${base.t})  [Best Angle impact = NONE at every floor — R1 only touches 'lean']\n`);
  console.log(`floor | removed (W/L)        | KEPT Lean record      | ML kept        | O/U kept       | FI kept`);
  for (const floor of [0.53, 0.54, 0.55, 0.56, 0.57]) {
    const removed = leans.filter(r => r.p !== null && r.p < floor);
    const kept = leans.filter(r => !(r.p !== null && r.p < floor));
    const rs = stats(removed), ks = stats(kept);
    const mlK = stats(kept.filter(r => r.market === "moneyline")), ouK = stats(kept.filter(r => r.market === "total")), fiK = stats(kept.filter(r => r.market === "first_inning"));
    console.log(`${(floor * 100).toFixed(0)}%   | ${`${rs.t} (${rs.w}W/${rs.l}L)`.padEnd(18)} | ${fmt(ks).padEnd(20)} | ${fmt(mlK).padEnd(13)} | ${fmt(ouK).padEnd(13)} | ${fmt(fiK)}`);
  }

  // Current/upcoming slate Lean detail
  const { data: cur } = await supabase.from("prediction_records")
    .select("slate_date, matchup, market, side, model_probability, edge, play_grade, snapshot_json")
    .eq("sport", "mlb").eq("play_grade", "lean").gte("slate_date", "2026-06-15").order("slate_date");
  console.log(`\n=== Current/upcoming MLB Leans (would R1 demote?) ===`);
  console.log(`match            market   side  prob   edge   move          splits(money%/sup/conf)`);
  for (const r of (cur ?? []) as any[]) {
    const sj = r.snapshot_json ?? {}; const lm = sj.line_movement?.direction ?? "—"; const ps = sj.public_splits;
    const sp = ps ? `${ps.picked_money_pct ?? "?"}% sup=${ps.support} conf=${ps.conflict}` : "—";
    const demote = r.model_probability !== null && r.model_probability < 0.55;
    console.log(`${String(r.matchup).padEnd(16)} ${String(r.market).padEnd(8)} ${String(r.side).padEnd(5)} ${((r.model_probability ?? 0) * 100).toFixed(1)}% ${r.edge !== null ? (r.edge * 100).toFixed(1) + "pp" : "—"}  ${String(lm).padEnd(13)} ${sp}  ${demote ? "→ market_aligned" : "KEEP lean"}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
