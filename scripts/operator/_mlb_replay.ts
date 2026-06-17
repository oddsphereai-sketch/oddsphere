/**
 * READ-ONLY historical replay / counterfactual harness — MLB Packages 0-18.
 * No writes, no model re-run.
 *
 * HONESTY BOUNDARY:
 *  - grade filters (R1/EV/BA-tighten) + market/sharp caps: EXACT (side/result unchanged).
 *  - A2 (disagreement shrink) / A3 (shrink-to-market): simulated as board-membership
 *    (calibration shadow); bet side unchanged so result unchanged (except A3 totals
 *    cross-0.5 flips, recomputed from actuals).
 *  - A1 (totals overdispersion): PROXY = flip marginal Under (p<0.55) -> Over,
 *    result RE-COMPUTED from actual total vs line (flip ROI @ -110, "~"). True
 *    overdispersion needs the offline re-run; this is its directional proxy.
 *  - ML/FI probability/side from a re-run model: NOT simulatable here (flagged).
 */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07", SIX14 = "2026-06-14", TODAY = "2026-06-15";

type Row = {
  date: string; matchup: string; market: string; side: string | null; pick: string | null;
  odds: number | null; line: number | null; p: number | null; mkt: number | null; edge: number | null;
  grade: string; ba: boolean; origRes: string; tot: number | null; fir: number | null;
};
type W = { grade: string; side: string | null; p: number | null; flipped: boolean };

function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
function ev(p: number | null, o: number | null): number | null { if (p === null || o === null) return null; const d = o > 0 ? o / 100 : 100 / -o; return p * d - (1 - p); }
const ON = (g: string) => g === "best_angle" || g === "lean";
function totRes(side: string | null, line: number | null, tot: number | null): string { if (side === null || line === null || tot === null) return ""; if (tot === line) return "push"; return (side === "over" ? tot > line : tot < line) ? "win" : "loss"; }
function fiRes(side: string | null, fir: number | null): string { if (side === null || fir === null) return ""; return (side === "under" ? fir === 0 : fir > 0) ? "win" : "loss"; }

// transforms mutate W
const tA1 = (w: W, r: Row) => { if (r.market === "total" && w.side === "under" && w.p !== null && w.p < 0.55) { w.side = "over"; w.flipped = true; } };
const tA2 = (w: W, r: Row) => { if (ON(w.grade) && r.edge !== null && Math.abs(r.edge) >= 2 && Math.abs(r.edge) < 10) w.grade = "market_aligned"; };
const tA3 = (w: W, r: Row) => { // shrink f=0.5 toward market; demote sub-2pp; totals flip if crosses .5
  if (r.mkt !== null && r.p !== null) { const np = r.mkt + 0.5 * (r.p - r.mkt); if (r.market === "total" && np < 0.5 && !w.flipped) { w.side = w.side === "under" ? "over" : "under"; w.flipped = true; } if (ON(w.grade) && Math.abs((np - r.mkt) * 100) < 1) w.grade = "market_aligned"; }
};
const tEV = (favOnly: boolean) => (w: W, r: Row) => { if (w.grade === "lean" && (!favOnly || (r.odds !== null && r.odds < 0)) && (ev(r.p, r.odds) ?? 1) < 0) w.grade = "market_aligned"; };
const tR1 = (w: W, r: Row) => { if (w.grade === "lean" && r.p !== null && r.p < 0.55) w.grade = "market_aligned"; };

type Pkg = { id: string; name: string; tag: string; fns: ((w: W, r: Row) => void)[] };
const PK: Pkg[] = [
  { id: "0", name: "Baseline (production)", tag: "—", fns: [] },
  { id: "1", name: "A1 totals correction (flip marginal Under)", tag: "model*", fns: [tA1] },
  { id: "2", name: "A2 disagreement shrink 2-10pp", tag: "calib-shadow", fns: [tA2] },
  { id: "3", name: "A3 conservative shrink-to-market", tag: "calib", fns: [tA3] },
  { id: "4", name: "EV gate (all Lean)", tag: "grade", fns: [tEV(false)] },
  { id: "5", name: "R1 (Lean p>=0.55)", tag: "grade", fns: [tR1] },
  { id: "6", name: "EV gate + R1", tag: "grade", fns: [tEV(false), tR1] },
  { id: "7", name: "A1 + A2", tag: "model*+calib", fns: [tA1, tA2] },
  { id: "8", name: "A1 + EV gate", tag: "model*+grade", fns: [tA1, tEV(false)] },
  { id: "9", name: "A1 + R1", tag: "model*+grade", fns: [tA1, tR1] },
  { id: "10", name: "A2 + EV gate", tag: "calib+grade", fns: [tA2, tEV(false)] },
  { id: "11", name: "A2 + R1", tag: "calib+grade", fns: [tA2, tR1] },
  { id: "12", name: "A1 + A2 + EV gate", tag: "mixed", fns: [tA1, tA2, tEV(false)] },
  { id: "13", name: "A1 + A2 + R1", tag: "mixed", fns: [tA1, tA2, tR1] },
  { id: "14", name: "A1 + A2 + EV + R1", tag: "mixed", fns: [tA1, tA2, tEV(false), tR1] },
  { id: "15", name: "BEST FULL: A1 + R1 + EVfav", tag: "mixed", fns: [tA1, tR1, tEV(true)] },
  { id: "16", name: "BEST MODEL-ONLY: A1 + A2", tag: "model*+calib", fns: [tA1, tA2] },
  { id: "17", name: "BEST GRADE-ONLY: R1 + EV", tag: "grade", fns: [tR1, tEV(false)] },
  { id: "18", name: "BEST SAFE PUBLIC: A1 + EVfav", tag: "model*+grade", fns: [tA1, tEV(true)] },
];

function apply(r: Row, pk: Pkg): { grade: string; side: string | null; res: string; odds: number | null; flipped: boolean } {
  const w: W = { grade: r.grade, side: r.side, p: r.p, flipped: false };
  for (const fn of pk.fns) fn(w, r);
  let res = r.origRes, odds = r.odds;
  if (w.flipped) { if (r.market === "total") { res = totRes(w.side, r.line, r.tot); odds = -110; } else if (r.market === "first_inning") { res = fiRes(w.side, r.fir); odds = null; } }
  return { grade: w.grade, side: w.side, res, odds, flipped: w.flipped };
}

function A(items: { res: string; odds: number | null }[]) {
  const g = items.filter(e => e.res === "win" || e.res === "loss");
  const w = g.filter(e => e.res === "win").length, l = g.length - w;
  let net = 0, n = 0; for (const e of g) { if (e.odds === null) continue; n++; net += profit(e.odds, e.res === "win"); }
  return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roi: n ? 100 * net / n : 0 };
}
const F = (a: ReturnType<typeof A>) => `${a.w}-${a.l}(${a.t ? a.pct.toFixed(0) : "--"}%) ${a.units >= 0 ? "+" : ""}${a.units.toFixed(0)}u/${a.roi.toFixed(0)}%`;

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, matchup, game_id, market, side, pick, odds_american, line_value, model_probability, market_probability, edge, play_grade, best_angle, launch_day, no_bet, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>();
  for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, total_runs, first_inning_runs").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: Row[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const g = gmap.get(r.game_id) ?? {}; return { date: String(r.slate_date), matchup: String(r.matchup ?? ""), market: String(r.market), side: r.side, pick: r.pick, odds: r.odds_american, line: r.line_value, p: r.model_probability, mkt: r.market_probability, edge: r.edge, grade: String(r.play_grade ?? "").toLowerCase(), ba: r.best_angle === true, origRes: String(gr?.result ?? "").toLowerCase(), tot: g.total_runs ?? null, fir: g.first_inning_runs ?? null }; });

  const boardItems = (rs: Row[], pk: Pkg) => rs.map(r => apply(r, pk)).filter(e => ON(e.grade));
  const cut = (rs: Row[], pk: Pkg, f: (r: Row, e: ReturnType<typeof apply>) => boolean) => rs.map(r => ({ r, e: apply(r, pk) })).filter(x => f(x.r, x.e)).map(x => x.e);

  // ---- §1 BASELINE ----
  const b0 = PK[0];
  console.log(`${"=".repeat(70)}\n§1 PACKAGE 0 BASELINE (since ${START})\n${"=".repeat(70)}`);
  console.log(`Board(BA+Lean): ${F(A(boardItems(rows, b0)))}`);
  console.log(`  BA:   ${F(A(rows.map(r => apply(r, b0)).filter(e => e.grade === "best_angle")))}`);
  console.log(`  Lean: ${F(A(rows.map(r => apply(r, b0)).filter(e => e.grade === "lean")))}`);
  for (const [lbl, f] of [["ML(brd)", (r: Row, e: any) => ON(e.grade) && r.market === "moneyline"], ["OU(brd)", (r: Row, e: any) => ON(e.grade) && r.market === "total"], ["FI", (r: Row, e: any) => r.market === "first_inning"], ["Over(brd)", (r: Row, e: any) => ON(e.grade) && e.side === "over"], ["Under(brd)", (r: Row, e: any) => ON(e.grade) && e.side === "under"], ["fav(brd)", (r: Row, e: any) => ON(e.grade) && r.market === "moneyline" && r.odds !== null && r.odds < 0], ["dog(brd)", (r: Row, e: any) => ON(e.grade) && r.market === "moneyline" && r.odds !== null && r.odds > 0], ["home(brd)", (r: Row, e: any) => ON(e.grade) && r.pick === "home"], ["away(brd)", (r: Row, e: any) => ON(e.grade) && r.pick === "away"], ["NRFI", (r: Row, e: any) => r.market === "first_inning" && e.side === "under"], ["YRFI", (r: Row, e: any) => r.market === "first_inning" && e.side === "over"]] as any[]) console.log(`  ${lbl.padEnd(10)} ${F(A(cut(rows, b0, f)))}`);
  console.log(`  Current slate board: ${rows.filter(r => r.date >= TODAY && ON(r.grade)).length} (BA ${rows.filter(r => r.date >= TODAY && r.grade === "best_angle").length} / Lean ${rows.filter(r => r.date >= TODAY && r.grade === "lean").length})`);

  // ---- §3 MASTER TABLE ----
  console.log(`\n${"=".repeat(160)}\n§3 MASTER — board=BA+Lean. flip-ROI@-110. tag model*=A1 proxy(needs re-run)\n${"=".repeat(160)}`);
  console.log(`pkg tag           board                exX board            BA                Lean              ML(brd)           OU(brd)           rmW/rmL/flip slate  name`);
  for (const pk of PK) {
    const bAll = A(boardItems(rows, pk)), bX = A(boardItems(rows.filter(r => r.date !== SIX14), pk));
    const ba = A(rows.map(r => apply(r, pk)).filter(e => e.grade === "best_angle")), ln = A(rows.map(r => apply(r, pk)).filter(e => e.grade === "lean"));
    const ml = A(cut(rows, pk, (r, e) => ON(e.grade) && r.market === "moneyline")), ou = A(cut(rows, pk, (r, e) => ON(e.grade) && r.market === "total"));
    let rmW = 0, rmL = 0, flip = 0; for (const r of rows) { const e = apply(r, pk); if (e.flipped) flip++; if (ON(r.grade) && !ON(e.grade)) { if (r.origRes === "win") rmW++; else if (r.origRes === "loss") rmL++; } }
    const slate = rows.filter(r => r.date >= TODAY).map(r => apply(r, pk)).filter(e => ON(e.grade)).length;
    console.log(`${pk.id.padEnd(3)} ${pk.tag.padEnd(13)} ${F(bAll).padEnd(20)} ${F(bX).padEnd(19)} ${F(ba).padEnd(17)} ${F(ln).padEnd(17)} ${F(ml).padEnd(17)} ${F(ou).padEnd(17)} ${`${rmW}/${rmL}/${flip}`.padEnd(12)} ${String(slate).padEnd(6)} ${pk.name}`);
  }

  // ---- §6 ROBUSTNESS for shortlist ----
  const SHORT = ["0", "1", "5", "6", "13", "15", "18"];
  console.log(`\n${"=".repeat(120)}\n§6 ROBUSTNESS (board) — shortlist\n${"=".repeat(120)}`);
  const wins: [string, (r: Row) => boolean][] = [["full", () => true], ["excl6/14", r => r.date !== SIX14], ["6/14", r => r.date === SIX14], ["last3>=6/13", r => r.date >= "2026-06-13"], ["last7>=6/09", r => r.date >= "2026-06-09"], ["wk1<=6/13", r => r.date <= "2026-06-13"], ["wk2>=6/14", r => r.date >= "2026-06-14"]];
  console.log(`pkg ${wins.map(w => w[0].padEnd(15)).join("")}`);
  for (const id of SHORT) { const pk = PK.find(p => p.id === id)!; console.log(`${id.padEnd(3)} ${wins.map(w => F(A(boardItems(rows.filter(w[1]), pk))).padEnd(15)).join("")}`); }

  // ---- §4 DAILY + WEEKLY for shortlist ----
  const dates = [...new Set(rows.map(r => r.date))].sort();
  for (const id of SHORT) {
    const pk = PK.find(p => p.id === id)!;
    console.log(`\n--- DAILY ${pk.id} ${pk.name} ---`);
    for (const d of dates) { const dr = rows.filter(r => r.date === d); console.log(`  ${d} board ${F(A(boardItems(dr, pk))).padEnd(20)} BA ${F(A(dr.map(r => apply(r, pk)).filter(e => e.grade === "best_angle"))).padEnd(16)} Lean ${F(A(dr.map(r => apply(r, pk)).filter(e => e.grade === "lean")))}`); }
  }

  // ---- §7 PICK-LEVEL DIFF for Package 15 (best full) ----
  const pk15 = PK.find(p => p.id === "15")!;
  console.log(`\n${"=".repeat(120)}\n§7 PICK DIFF — Package 15 (A1+R1+EVfav), changed rows\n${"=".repeat(120)}`);
  console.log("date       matchup          mkt   side  grade->            flip res  reason");
  for (const r of rows.sort((a, b) => a.date.localeCompare(b.date))) {
    const e = apply(r, pk15); if (e.grade === r.grade && e.side === r.side) continue;
    let why = ""; if (e.side !== r.side) why += "Under->Over "; if (r.grade === "lean" && r.p !== null && r.p < 0.55) why += "p<.55 "; if (r.grade === "lean" && r.odds !== null && r.odds < 0 && (ev(r.p, r.odds) ?? 1) < 0) why += "favEV<0 ";
    console.log(`${r.date} ${r.matchup.padEnd(16)} ${r.market.slice(0, 5).padEnd(5)} ${String(r.side).padEnd(5)} ${(r.grade + "->" + e.grade).slice(0, 18).padEnd(18)} ${e.flipped ? "Y" : " "}   ${(e.flipped ? e.res : r.origRes).slice(0, 4).padEnd(4)} ${why}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
