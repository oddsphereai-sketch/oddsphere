/**
 * READ-ONLY counterfactual backtest harness — MLB Packages 0-11.
 * No writes. Simulates grade transformations on tracked prediction_records
 * and reports board/Lean/BA/ML/OU/FI impact, ROI, robustness, volume.
 *
 * "Public board" = rows whose effective play_grade ∈ {best_angle, lean}.
 * ROI = 1u flat at stored odds_american (rows w/o price excluded from ROI,
 * counted in W-L). FI has no price today → shown for measurability only.
 */
import { supabase } from "../../lib/db/supabase";

const START = "2026-06-07";
const SIX14 = "2026-06-14";
const TODAY = "2026-06-15";

type Row = {
  date: string; market: string; side: string | null; odds: number | null;
  p: number | null; edge: number | null; grade: string; res: string;
};
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }

function metrics(rows: Row[]) {
  const g = rows.filter(r => r.res === "win" || r.res === "loss");
  const w = g.filter(r => r.res === "win").length, l = g.filter(r => r.res === "loss").length;
  let net = 0, n = 0; for (const r of g) { if (r.odds === null) continue; n++; net += profit(r.odds, r.res === "win"); }
  return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roi: n ? 100 * net / n : 0, roiN: n };
}
function fmt(m: ReturnType<typeof metrics>): string {
  return `${m.w}-${m.l} (${m.pct.toFixed(0)}%) ${m.units >= 0 ? "+" : ""}${m.units.toFixed(1)}u/${m.roi.toFixed(0)}%${m.roiN < m.t ? ` [priced ${m.roiN}/${m.t}]` : ""}`;
}

// Each package returns the EFFECTIVE grade for a row (null/other = off board).
type Pkg = { id: string; name: string; grade: (r: Row) => string };
const ON = (g: string) => g === "best_angle" || g === "lean";

const PACKAGES: Pkg[] = [
  { id: "0", name: "Production (baseline)", grade: r => r.grade },
  { id: "1", name: "Edge units fixed only", grade: r => r.grade /* analysis-only; no grade depends on stored edge */ },
  { id: "2", name: "OU confidence cap fixed only", grade: r => r.grade /* grade is edge-based; confidence pill only */ },
  { id: "3", name: "FI price capture only", grade: r => r.grade /* enables FI ROI; no pick change */ },
  { id: "4", name: "Edge + OU confidence", grade: r => r.grade },
  { id: "5", name: "Edge + OU conf + FI price", grade: r => r.grade },
  { id: "6", name: "R1 (Lean p<0.55 -> market_aligned)", grade: r => (r.grade === "lean" && r.p !== null && r.p < 0.55 ? "market_aligned" : r.grade) },
  { id: "7", name: "Value-Lean (ML/OU Lean needs edge>=2pp)", grade: r => (r.grade === "lean" && (r.market === "moneyline" || r.market === "total") && (r.edge === null || r.edge < 2) ? "market_aligned" : r.grade) },
  { id: "8", name: "Value-Lean + OU conf (=7 on board)", grade: r => (r.grade === "lean" && (r.market === "moneyline" || r.market === "total") && (r.edge === null || r.edge < 2) ? "market_aligned" : r.grade) },
  { id: "9", name: "Value-Lean + OU conf + R1", grade: r => { let g = r.grade; if (g === "lean" && (r.market === "moneyline" || r.market === "total") && (r.edge === null || r.edge < 2)) g = "market_aligned"; if (g === "lean" && r.p !== null && r.p < 0.55) g = "market_aligned"; return g; } },
  { id: "10", name: "Totals threshold (total Lean needs p>=0.58)", grade: r => (r.grade === "lean" && r.market === "total" && (r.p === null || r.p < 0.58) ? "market_aligned" : r.grade) },
  { id: "11", name: "BA tighten (BA needs p>=0.65, else off board)", grade: r => (r.grade === "best_angle" && (r.p === null || r.p < 0.65) ? "market_aligned" : r.grade) },
];

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, market, side, odds_american, model_probability, edge, play_grade, launch_day, no_bet, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", START);
  const all: Row[] = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true).map((r: any) => {
    const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    return { date: String(r.slate_date), market: String(r.market), side: r.side, odds: r.odds_american, p: r.model_probability, edge: r.edge, grade: String(r.play_grade ?? "").toLowerCase(), res: String(gr?.result ?? "").toLowerCase() };
  });
  const graded = all.filter(r => r.res === "win" || r.res === "loss");

  const base = PACKAGES[0];
  const baseGrade = new Map(graded.map(r => [r, base.grade(r)]));

  console.log(`MLB BACKTEST — ${graded.length} graded rows since ${START} (read-only)\n`);
  console.log("Pkg | Board (BA+Lean)            | excl-6/14 board          | Lean                | BA                  | ML                  | OU                  | Δ vs Pkg0 (won/lost removed)");
  console.log("-".repeat(190));

  for (const pkg of PACKAGES) {
    const eff = (r: Row) => pkg.grade(r);
    const board = graded.filter(r => ON(eff(r)));
    const boardX = board.filter(r => r.date !== SIX14);
    const lean = graded.filter(r => eff(r) === "lean");
    const ba = graded.filter(r => eff(r) === "best_angle");
    const ml = board.filter(r => r.market === "moneyline");
    const ou = board.filter(r => r.market === "total");

    // Δ vs baseline: rows on baseline board but off this board (removed)
    let removedW = 0, removedL = 0, changed = 0;
    for (const r of graded) {
      const wasOn = ON(baseGrade.get(r)!), nowOn = ON(eff(r));
      if (wasOn !== nowOn) { changed++; if (wasOn && !nowOn) { if (r.res === "win") removedW++; else removedL++; } }
    }
    console.log(
      `${pkg.id.padEnd(3)} | ${fmt(metrics(board)).padEnd(25)} | ${fmt(metrics(boardX)).padEnd(24)} | ${fmt(metrics(lean)).padEnd(19)} | ${fmt(metrics(ba)).padEnd(19)} | ${fmt(metrics(ml)).padEnd(19)} | ${fmt(metrics(ou)).padEnd(19)} | chg ${changed} (rm ${removedW}W/${removedL}L)  — ${pkg.name}`
    );
  }

  // Current-slate board impact (today+)
  console.log(`\n=== Current/upcoming board size (slate >= ${TODAY}) per package ===`);
  const cur = all.filter(r => r.date >= TODAY);
  for (const pkg of PACKAGES) {
    const board = cur.filter(r => ON(pkg.grade(r)));
    const ba = board.filter(r => pkg.grade(r) === "best_angle").length;
    const ln = board.filter(r => pkg.grade(r) === "lean").length;
    console.log(`  Pkg ${pkg.id.padEnd(2)} board=${board.length} (BA ${ba} / Lean ${ln})  — ${pkg.name}`);
  }

  // FI measurability note
  const fi = all.filter(r => r.market === "first_inning");
  console.log(`\nFI measurability: ${fi.length} FI rows, priced ${fi.filter(r => r.odds !== null).length} (Pkg3 enables forward; history backfill needs line_history FI prices)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
