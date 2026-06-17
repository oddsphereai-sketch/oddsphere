/**
 * READ-ONLY — market/sharp signal predictiveness (§3), cohort interaction (§4),
 * signal counterfactual packages (§7). All from lock-frozen snapshot_json
 * (lookahead-safe). No writes.
 */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07", SIX14 = "2026-06-14";
type R = {
  date: string; market: string; side: string | null; pick: string | null; odds: number | null;
  p: number | null; edge: number | null; grade: string; ba: boolean; res: string;
  pm: number | null; pb: number | null; conflict: boolean | null; support: boolean | null;
  dir: string | null; openOdds: number | null; curOdds: number | null;
};
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
function ev(p: number | null, o: number | null): number | null { if (p === null || o === null) return null; const d = o > 0 ? o / 100 : 100 / -o; return p * d - (1 - p); }
function A(rows: R[]) {
  const g = rows.filter(r => r.res === "win" || r.res === "loss");
  const w = g.filter(r => r.res === "win").length, l = g.length - w;
  let net = 0, n = 0, ps = 0, pn = 0; for (const r of g) { if (r.odds !== null) { n++; net += profit(r.odds, r.res === "win"); } if (r.p !== null) { ps += r.p; pn++; } }
  return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, roi: n ? 100 * net / n : 0, avgP: pn ? 100 * ps / pn : 0 };
}
function L(label: string, rows: R[], showCal = true): string {
  const a = A(rows); const x = A(rows.filter(r => r.date !== SIX14)); const warn = a.t < 12 ? " ⚠" : "";
  const cal = showCal && a.t ? ` | avgP ${a.avgP.toFixed(0)}% obs ${a.pct.toFixed(0)}% gap ${(a.pct - a.avgP).toFixed(0)}` : "";
  return `  ${label.padEnd(30)} ${`${a.w}-${a.l}(${a.t ? a.pct.toFixed(0) : "--"}%)`.padEnd(13)} ROI ${a.roi.toFixed(0)}% (n=${a.t})${warn}  [exX ${x.t ? x.pct.toFixed(0) : "--"}%/${x.roi.toFixed(0)}%]${cal}`;
}

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, market, side, pick, odds_american, model_probability, edge, play_grade, best_angle, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", START);
  const rows: R[] = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true).map((r: any) => {
    const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const sj = r.snapshot_json ?? {}; const ps = sj.public_splits ?? {}; const lm = sj.line_movement ?? {};
    return { date: String(r.slate_date), market: String(r.market), side: r.side, pick: r.pick, odds: r.odds_american, p: r.model_probability, edge: r.edge, grade: String(r.play_grade ?? "").toLowerCase(), ba: r.best_angle === true, res: String(gr?.result ?? "").toLowerCase(), pm: ps.picked_money_pct ?? null, pb: ps.picked_bets_pct ?? null, conflict: ps.conflict ?? null, support: ps.support ?? null, dir: lm.direction ?? null, openOdds: lm.open_odds_american ?? null, curOdds: lm.current_odds_american ?? null };
  });
  const mlou = rows.filter(r => r.market === "moneyline" || r.market === "total");

  console.log(`\n###### §3 SIGNAL PREDICTIVENESS (ML+OU, n=${mlou.length}; [exX]=excl 6/14) ######`);
  console.log("\n-- Model-market disagreement (edge pp) --");
  for (const [lo, hi, lbl] of [[-100, 0, "neg edge (defer to mkt)"], [0, 2, "0-2pp"], [2, 5, "2-5pp"], [5, 10, "5-10pp"], [10, 100, "10pp+"]] as any[]) console.log(L(lbl, mlou.filter(r => r.edge !== null && r.edge >= lo && r.edge < hi)));
  console.log("\n-- Line movement vs pick --");
  for (const d of ["toward_pick", "against_pick", "neutral", "unknown"]) console.log(L(`dir=${d}`, mlou.filter(r => (r.dir ?? "unknown") === d)));
  console.log("\n-- Public money on PICKED side --");
  for (const [lo, hi, lbl] of [[0, 50, "<50% (contrarian)"], [50, 60, "50-60%"], [60, 65, "60-65%"], [65, 75, "65-75%"], [75, 101, "75%+ (very public)"]] as any[]) console.log(L(lbl, mlou.filter(r => r.pm !== null && r.pm >= lo && r.pm < hi)));
  console.log("\n-- Handle/ticket disagreement (money - bets) --");
  console.log(L("money>>bets +15 (sharp on pick)", mlou.filter(r => r.pm !== null && r.pb !== null && r.pm - r.pb >= 15)));
  console.log(L("bets>>money +15 (public on pick)", mlou.filter(r => r.pm !== null && r.pb !== null && r.pb - r.pm >= 15)));
  console.log(L("aligned (|gap|<15)", mlou.filter(r => r.pm !== null && r.pb !== null && Math.abs(r.pm - r.pb) < 15)));
  console.log("\n-- Splits conflict/support --");
  console.log(L("conflict=true", mlou.filter(r => r.conflict === true)));
  console.log(L("support=true", mlou.filter(r => r.support === true)));
  console.log("\n-- EV / price --");
  console.log(L("EV>=0", mlou.filter(r => (ev(r.p, r.odds) ?? -1) >= 0)));
  console.log(L("EV<0", mlou.filter(r => (ev(r.p, r.odds) ?? 1) < 0)));
  console.log(L("favorite (odds<0) EV<0", mlou.filter(r => r.odds !== null && r.odds < 0 && (ev(r.p, r.odds) ?? 1) < 0)));
  console.log(L("dog (odds>0) EV>=0", mlou.filter(r => r.odds !== null && r.odds > 0 && (ev(r.p, r.odds) ?? -1) >= 0)));

  console.log(`\n###### §4 SIGNAL × WEAK COHORTS ######`);
  const leans = mlou.filter(r => r.grade === "lean");
  console.log(`\n-- Weak LEANS (n=${leans.length}) decomposed --`);
  console.log(L("Lean public-heavy pick>65%", leans.filter(r => r.pm !== null && r.pm > 65)));
  console.log(L("Lean line against_pick", leans.filter(r => r.dir === "against_pick")));
  console.log(L("Lean EV<0", leans.filter(r => (ev(r.p, r.odds) ?? 1) < 0)));
  console.log(L("Lean conflict=true", leans.filter(r => r.conflict === true)));
  console.log(L("Lean missing splits", leans.filter(r => r.pm === null)));
  console.log(L("Lean p<0.55", leans.filter(r => r.p !== null && r.p < 0.55)));
  const favL = leans.filter(r => r.market === "moneyline" && r.odds !== null && r.odds < 0);
  console.log(`\n-- FAVORITE Leans (n=${favL.length}) --`);
  console.log(L("fav Lean EV<0", favL.filter(r => (ev(r.p, r.odds) ?? 1) < 0)));
  console.log(L("fav Lean EV>=0", favL.filter(r => (ev(r.p, r.odds) ?? -1) >= 0)));
  console.log(L("fav Lean public-heavy>65%", favL.filter(r => r.pm !== null && r.pm > 65)));
  console.log(L("fav Lean line against", favL.filter(r => r.dir === "against_pick")));
  const unders = rows.filter(r => r.market === "total" && r.side === "under");
  console.log(`\n-- Total UNDERS (n=${unders.length}) --`);
  console.log(L("Under public-heavy Over (opp money) conflict", unders.filter(r => r.conflict === true)));
  console.log(L("Under line against_pick (total rising)", unders.filter(r => r.dir === "against_pick")));
  console.log(L("Under line toward_pick", unders.filter(r => r.dir === "toward_pick")));
  console.log(L("Under EV<0", unders.filter(r => (ev(r.p, r.odds) ?? 1) < 0)));
  console.log(L("Under BEST ANGLE (market-confirmed)", unders.filter(r => r.ba)));
  console.log(L("Under LEAN (no confirmation)", unders.filter(r => r.grade === "lean")));

  console.log(`\n###### §7 SIGNAL COUNTERFACTUAL PACKAGES (board=BA+Lean) ######`);
  const ON = (g: string) => g === "best_angle" || g === "lean";
  const board = (f: (r: R) => string) => A(rows.filter(r => ON(f(r))));
  const fmt = (a: ReturnType<typeof A>) => `${a.w}-${a.l} (${a.t ? a.pct.toFixed(0) : "--"}%) ROI ${a.roi.toFixed(0)}% n=${a.t}`;
  const boardX = (f: (r: R) => string) => A(rows.filter(r => r.date !== SIX14 && ON(f(r))));
  const pk = (name: string, f: (r: R) => string) => console.log(`  ${name.padEnd(34)} ${fmt(board(f)).padEnd(34)} exX ${fmt(boardX(f))}`);
  pk("Baseline", r => r.grade);
  pk("line against_pick -> demote Lean", r => (r.grade === "lean" && r.dir === "against_pick") ? "x" : r.grade);
  pk("public-heavy>65% -> demote Lean", r => (r.grade === "lean" && r.pm !== null && r.pm > 65) ? "x" : r.grade);
  pk("bets>>money(public) -> demote Lean", r => (r.grade === "lean" && r.pm !== null && r.pb !== null && r.pb - r.pm >= 15) ? "x" : r.grade);
  pk("conflict -> demote Lean", r => (r.grade === "lean" && r.conflict === true) ? "x" : r.grade);
  pk("missing splits -> demote Lean", r => (r.grade === "lean" && r.pm === null) ? "x" : r.grade);
  pk("disagreement 2-10pp -> demote Lean", r => (r.grade === "lean" && r.edge !== null && Math.abs(r.edge) >= 2 && Math.abs(r.edge) < 10) ? "x" : r.grade);
  pk("EV<0 -> demote Lean", r => (r.grade === "lean" && (ev(r.p, r.odds) ?? 1) < 0) ? "x" : r.grade);
  pk("R1 (p<.55)", r => (r.grade === "lean" && r.p !== null && r.p < 0.55) ? "x" : r.grade);
  pk("R1 + EV + disagreement2-10", r => { let g = r.grade; if (g === "lean" && (r.p === null || r.p < 0.55 || (ev(r.p, r.odds) ?? 1) < 0 || (r.edge !== null && Math.abs(r.edge) >= 2 && Math.abs(r.edge) < 10))) g = "x"; return g; });
  pk("R1 + EV + conflict + public>65", r => { let g = r.grade; if (g === "lean" && (r.p === null || r.p < 0.55 || (ev(r.p, r.odds) ?? 1) < 0 || r.conflict === true || (r.pm !== null && r.pm > 65))) g = "x"; return g; });
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
