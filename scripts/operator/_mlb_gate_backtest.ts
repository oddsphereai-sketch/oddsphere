/** READ-ONLY — W-L + ROI by category, BEFORE (stored) vs AFTER (implemented gate:
 * EV<0 OR low-conviction-fav(run-gap<0.5) OR total line<8). Board = best_angle(bool)
 * OR play_grade=lean. Demotes leans only. Also a regular-games (noise-removed) view. */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07", SIX14 = "2026-06-14";
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
type R = { date: string; market: string; side: string | null; pick: string | null; grade: string; ba: boolean; odds: number | null; p: number | null; runGap: number | null; line: number | null; res: string; tot: number | null };
function A(rows: R[], onBoard: (r: R) => boolean) { const g = rows.filter(r => onBoard(r) && (r.res === "win" || r.res === "loss")); const w = g.filter(r => r.res === "win").length, l = g.length - w; let net = 0, n = 0; for (const r of g) { if (r.odds !== null) { n++; net += profit(r.odds, r.res === "win"); } } return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roi: n ? 100 * net / n : 0 }; }
const F = (a: ReturnType<typeof A>) => `${a.w}-${a.l} (${a.t ? a.pct.toFixed(0) : "--"}%) ${a.units >= 0 ? "+" : ""}${a.units.toFixed(1)}u/${a.roi.toFixed(0)}%`;
function ev(p: number | null, o: number | null): number | null { if (p === null || o === null) return null; const d = o > 0 ? o / 100 : 100 / -o; return p * d - (1 - p); }
// the implemented gate
function gateGrade(r: R): { grade: string; ba: boolean } {
  if (r.grade !== "lean") return { grade: r.grade, ba: r.ba };
  if ((ev(r.p, r.odds) ?? 0) < 0) return { grade: "market_aligned", ba: false };
  if (r.market === "moneyline" && r.odds !== null && r.odds < 0 && r.runGap !== null && r.runGap < 0.5) return { grade: "market_aligned", ba: false };
  if (r.market === "total" && r.line !== null && r.line < 8) return { grade: "market_aligned", ba: false };
  return { grade: "lean", ba: r.ba };
}

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records").select("slate_date, game_id, market, side, pick, play_grade, best_angle, odds_american, model_probability, line_value, launch_day, no_bet, snapshot_json, prediction_grades(result)").eq("sport", "mlb").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>(); for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, total_runs").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: R[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; return { date: String(r.slate_date), market: String(r.market), side: r.side, pick: r.pick, grade: String(r.play_grade ?? "").toLowerCase(), ba: r.best_angle === true, odds: r.odds_american, p: r.model_probability, runGap: typeof a.posterior_home_diff === "number" ? Math.abs(a.posterior_home_diff) : null, line: a.market_total ?? r.line_value ?? null, res: String(gr?.result ?? "").toLowerCase(), tot: gmap.get(r.game_id)?.total_runs ?? null }; });

  const before = (r: R) => r.ba || r.grade === "lean";
  const afterE = new Map<R, { grade: string; ba: boolean }>(); for (const r of rows) afterE.set(r, gateGrade(r));
  const after = (r: R) => { const e = afterE.get(r)!; return e.ba || e.grade === "lean"; };

  const cats: [string, (r: R) => boolean][] = [
    ["BOARD (all)", () => true], ["Best Angle", r => r.ba], ["Lean", r => !r.ba && r.grade === "lean"],
    ["ML", r => r.market === "moneyline"], ["O/U", r => r.market === "total"], ["First Inning", r => r.market === "first_inning"],
    ["Over", r => r.side === "over"], ["Under", r => r.side === "under"], ["NRFI", r => r.market === "first_inning" && r.side === "under"], ["YRFI", r => r.market === "first_inning" && r.side === "over"],
    ["favorite", r => r.market === "moneyline" && r.odds !== null && r.odds < 0], ["underdog", r => r.market === "moneyline" && r.odds !== null && r.odds > 0],
    ["home", r => r.pick === "home"], ["away", r => r.pick === "away"],
  ];
  // Best Angle/Lean category membership must use the after-grade for AFTER column
  const beforeCat = (catf: (r: R) => boolean, isBA: boolean | null) => (r: R) => before(r) && catf(r) && (isBA === null ? true : (isBA ? r.ba : (!r.ba && r.grade === "lean")));
  const afterCat = (catf: (r: R) => boolean, isBA: boolean | null) => (r: R) => { const e = afterE.get(r)!; return after(r) && catf(r) && (isBA === null ? true : (isBA ? e.ba : (!e.ba && e.grade === "lean"))); };

  console.log(`\n${"=".repeat(110)}\nGATE BACKTEST — W-L + ROI by category | BEFORE (stored) → AFTER (gate) | [exX = excl 6/14]\n${"=".repeat(110)}`);
  for (const [name, catf] of cats) {
    const isBA = name === "Best Angle" ? true : name === "Lean" ? false : null;
    const b = A(rows, beforeCat(catf, isBA)), af = A(rows, afterCat(catf, isBA));
    const bx = A(rows.filter(r => r.date !== SIX14), beforeCat(catf, isBA)), ax = A(rows.filter(r => r.date !== SIX14), afterCat(catf, isBA));
    console.log(`  ${name.padEnd(13)} BEFORE ${F(b).padEnd(26)} → AFTER ${F(af).padEnd(26)}  exX ${F(bx).split(" ")[0]}/${bx.roi.toFixed(0)}%→${F(ax).split(" ")[0]}/${ax.roi.toFixed(0)}%`);
  }

  // demotion accounting
  let rmW = 0, rmL = 0; for (const r of rows) { const wasOn = before(r), nowOn = after(r); if (wasOn && !nowOn) { if (r.res === "win") rmW++; else if (r.res === "loss") rmL++; } }
  console.log(`\n  Picks removed by gate: ${rmW} winners + ${rmL} losers (net ${rmL - rmW} more losers cut). Current slate board: before ${rows.filter(r => r.date >= "2026-06-15" && before(r)).length} → after ${rows.filter(r => r.date >= "2026-06-15" && after(r)).length}`);

  console.log(`\n${"=".repeat(110)}\nREGULAR-GAMES view (noise removed: total line 8-9.5 AND actual total <11) — diagnostic\n${"=".repeat(110)}`);
  const reg = (r: R) => r.line !== null && r.line >= 8 && r.line < 9.5 && r.tot !== null && r.tot < 11;
  for (const [name, catf] of cats.filter(c => ["BOARD (all)", "ML", "O/U", "Over", "Under"].includes(c[0]))) {
    const b = A(rows.filter(reg), beforeCat(catf, null)), af = A(rows.filter(reg), afterCat(catf, null));
    console.log(`  ${name.padEnd(13)} BEFORE ${F(b).padEnd(26)} → AFTER ${F(af)}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
