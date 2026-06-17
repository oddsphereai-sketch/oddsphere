/**
 * READ-ONLY deep counterfactual report — MLB candidate fixes since public
 * tracking start (6/7). No writes. No model re-run.
 *
 * Capability (honest):
 *  - grade filters (R1/EV/floors/redesign): side & result UNCHANGED → exact, real-odds ROI.
 *  - calibration/disagreement shrink: simulated as grade-membership change
 *    (bet side unchanged → result unchanged) + edge re-derivation.
 *  - totals SIDE flips (overdispersion/Over-bias): result RE-COMPUTED from
 *    actual total vs line; flipped-side ROI uses -110 (labeled "~").
 *  - ML/FI prob re-derivation from a re-run model: NOT simulatable here.
 */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07", SIX14 = "2026-06-14", TODAY = "2026-06-15";

type Row = {
  date: string; gid: number | null; matchup: string; market: string;
  side: string | null; pick: string | null; odds: number | null; line: number | null;
  p: number | null; mkt: number | null; edge: number | null; grade: string; ba: boolean;
  conf: number | null; conflict: boolean | null; origRes: string;
  tot: number | null; fir: number | null;
};
type Eff = { grade: string; side: string | null; res: string; odds: number | null; flipped: boolean };

function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
function evOf(p: number | null, odds: number | null): number | null { if (p === null || odds === null) return null; const dec = odds > 0 ? odds / 100 : 100 / -odds; return p * dec - (1 - p); }
const ON = (g: string) => g === "best_angle" || g === "lean";

function totResult(side: string | null, line: number | null, tot: number | null): string {
  if (side === null || line === null || tot === null) return "";
  if (tot === line) return "push"; return (side === "over" ? tot > line : tot < line) ? "win" : "loss";
}
function fiResult(side: string | null, fir: number | null): string {
  if (side === null || fir === null) return ""; return (side === "under" ? fir === 0 : fir > 0) ? "win" : "loss";
}

function agg(effs: Eff[]) {
  const g = effs.filter(e => e.res === "win" || e.res === "loss");
  const w = g.filter(e => e.res === "win").length, l = g.length - w;
  let net = 0, n = 0; for (const e of g) { if (e.odds === null) continue; n++; net += profit(e.odds, e.res === "win"); }
  return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roi: n ? 100 * net / n : 0, roiN: n };
}
function fmt(a: ReturnType<typeof agg>) { return `${a.w}-${a.l} (${a.t ? a.pct.toFixed(0) : "--"}%) ${a.units >= 0 ? "+" : ""}${a.units.toFixed(1)}u/${a.roi.toFixed(0)}%`; }

// ---- packages ----
type Pkg = { id: string; name: string; tag: string; t: (r: Row) => { grade: string; side: string | null } };
const fade = (r: Row, lo: number, hi: number) => (ON(r.grade) && r.edge !== null && Math.abs(r.edge) >= lo && Math.abs(r.edge) < hi) ? "market_aligned" : r.grade;
const evDemote = (r: Row, pred: (r: Row) => boolean) => { if (r.grade !== "lean" || !pred(r)) return r.grade; const ev = evOf(r.p, r.odds); return (ev !== null && ev < 0) ? "market_aligned" : r.grade; };
const r1 = (r: Row) => (r.grade === "lean" && r.p !== null && r.p < 0.55) ? "market_aligned" : r.grade;
// totals Over-bias: flip Under->Over when projected/conviction is marginal (proxy: model_prob < 0.55)
const overBias = (r: Row): string | null => (r.market === "total" && r.side === "under" && r.p !== null && r.p < 0.55) ? "over" : r.side;

const PK: Pkg[] = [
  { id: "0", name: "Baseline (production)", tag: "—", t: r => ({ grade: r.grade, side: r.side }) },
  { id: "R1", name: "R1: Lean p>=0.55", tag: "grade", t: r => ({ grade: r1(r), side: r.side }) },
  { id: "EVml", name: "EV gate: ML Lean EV>=0", tag: "grade", t: r => ({ grade: evDemote(r, x => x.market === "moneyline"), side: r.side }) },
  { id: "EVfav", name: "EV gate: favorite Lean EV>=0", tag: "grade", t: r => ({ grade: evDemote(r, x => x.odds !== null && x.odds < 0), side: r.side }) },
  { id: "EVall", name: "EV gate: all Lean EV>=0", tag: "grade", t: r => ({ grade: evDemote(r, () => true), side: r.side }) },
  { id: "Lstr", name: "Lean needs p>=0.55 AND EV>=0", tag: "grade", t: r => { let g = r1(r); g = (g === "lean" && (evOf(r.p, r.odds) ?? 0) < 0) ? "market_aligned" : g; return { grade: g, side: r.side }; } },
  { id: "LstrNC", name: "Lean p>=.55 & EV>=0 & no-conflict", tag: "grade", t: r => { let g = r1(r); g = (g === "lean" && (evOf(r.p, r.odds) ?? 0) < 0) ? "market_aligned" : g; g = (g === "lean" && r.conflict === true) ? "market_aligned" : g; return { grade: g, side: r.side }; } },
  { id: "BAstr", name: "Best Angle needs p>=0.65", tag: "grade", t: r => ({ grade: (r.grade === "best_angle" && (r.p === null || r.p < 0.65)) ? "market_aligned" : r.grade, side: r.side }) },
  { id: "fd25", name: "Fade 2-5pp disagreement", tag: "calib", t: r => ({ grade: fade(r, 2, 5), side: r.side }) },
  { id: "fd510", name: "Fade 5-10pp disagreement", tag: "calib", t: r => ({ grade: fade(r, 5, 10), side: r.side }) },
  { id: "fd210", name: "Fade 2-10pp (preserve 10pp+)", tag: "calib", t: r => ({ grade: fade(r, 2, 10), side: r.side }) },
  { id: "uThr", name: "Total Under needs p>=0.58", tag: "grade", t: r => ({ grade: (r.grade === "lean" && r.market === "total" && r.side === "under" && (r.p === null || r.p < 0.58)) ? "market_aligned" : r.grade, side: r.side }) },
  { id: "oBias", name: "Totals Over-bias (flip marginal Under)", tag: "model", t: r => ({ grade: r.grade, side: overBias(r) }) },
  { id: "R1EV", name: "R1 + EV gate (all)", tag: "grade", t: r => { let g = r1(r); g = (g === "lean" && (evOf(r.p, r.odds) ?? 0) < 0) ? "market_aligned" : g; return { grade: g, side: r.side }; } },
  { id: "R1ob", name: "R1 + totals Over-bias", tag: "grade+model", t: r => ({ grade: r1(r), side: overBias(r) }) },
  { id: "R1fd", name: "R1 + fade 2-10pp", tag: "grade+calib", t: r => ({ grade: fade({ ...r, grade: r1(r) }, 2, 10), side: r.side }) },
  { id: "EVob", name: "EV gate + Over-bias", tag: "grade+model", t: r => ({ grade: evDemote(r, () => true), side: overBias(r) }) },
  { id: "FULL", name: "R1 + EV + Over-bias + fade210", tag: "all", t: r => { let g = r1(r); g = (g === "lean" && (evOf(r.p, r.odds) ?? 0) < 0) ? "market_aligned" : g; g = fade({ ...r, grade: g }, 2, 10); return { grade: g, side: overBias(r) }; } },
];

function effOf(r: Row, pk: Pkg): Eff {
  const { grade, side } = pk.t(r);
  const flipped = side !== r.side;
  let res = r.origRes, odds = r.odds;
  if (flipped) {
    if (r.market === "total") { res = totResult(side, r.line, r.tot); odds = -110; }
    else if (r.market === "first_inning") { res = fiResult(side, r.fir); odds = null; }
  }
  return { grade, side, res, odds, flipped };
}

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, game_id, matchup, market, side, pick, odds_american, line_value, model_probability, market_probability, edge, play_grade, best_angle, confidence, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>();
  for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, total_runs, first_inning_runs").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: Row[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const sj = r.snapshot_json ?? {}; const g = gmap.get(r.game_id) ?? {}; return { date: String(r.slate_date), gid: r.game_id, matchup: String(r.matchup ?? ""), market: String(r.market), side: r.side, pick: r.pick, odds: r.odds_american, line: r.line_value, p: r.model_probability, mkt: r.market_probability, edge: r.edge, grade: String(r.play_grade ?? "").toLowerCase(), ba: r.best_angle === true, conf: r.confidence, conflict: sj.public_splits?.conflict ?? null, origRes: String(gr?.result ?? "").toLowerCase(), tot: g.total_runs ?? null, fir: g.first_inning_runs ?? null }; });

  const board = (effs: Eff[]) => effs.filter(e => ON(e.grade));
  const sub = (rs: Row[], pk: Pkg, f: (r: Row, e: Eff) => boolean) => rs.map(r => ({ r, e: effOf(r, pk) })).filter(x => f(x.r, x.e)).map(x => x.e);

  // ---- MASTER TABLE ----
  console.log(`\n${"=".repeat(150)}\nMASTER — ${rows.filter(r => r.origRes === "win" || r.origRes === "loss").length} graded rows since ${START}. Board=BA+Lean. (flipped-totals ROI @ -110 "~")\n${"=".repeat(150)}`);
  console.log(`pkg     tag         board                    excl6/14 board           BA                    Lean                  ML(board)            OU(board)            chg(rmW/rmL/flip)  name`);
  for (const pk of PK) {
    const effAll = rows.map(r => effOf(r, pk));
    const bAll = board(effAll), bX = rows.filter(r => r.date !== SIX14).map(r => effOf(r, pk)).filter(e => ON(e.grade));
    const baE = effAll.filter(e => e.grade === "best_angle"), lnE = effAll.filter(e => e.grade === "lean");
    const mlE = bAll.filter((e, i) => false); // placeholder
    const mlBoard = sub(rows, pk, (r, e) => ON(e.grade) && r.market === "moneyline");
    const ouBoard = sub(rows, pk, (r, e) => ON(e.grade) && r.market === "total");
    // deltas vs baseline
    let rmW = 0, rmL = 0, flip = 0;
    for (const r of rows) { const b0 = ON(r.grade), e = effOf(r, pk); if (e.flipped) flip++; if (b0 && !ON(e.grade)) { if (r.origRes === "win") rmW++; else if (r.origRes === "loss") rmL++; } }
    console.log(`${pk.id.padEnd(7)} ${pk.tag.padEnd(11)} ${fmt(agg(bAll)).padEnd(24)} ${fmt(agg(bX)).padEnd(24)} ${fmt(agg(baE)).padEnd(21)} ${fmt(agg(lnE)).padEnd(21)} ${fmt(agg(mlBoard)).padEnd(20)} ${fmt(agg(ouBoard)).padEnd(20)} ${`${rmW}/${rmL}/${flip}`.padEnd(18)} ${pk.name}`);
  }

  // ---- SHORTLIST detail: daily + weekly + slate + diff ----
  const SHORT = ["0", "R1", "EVall", "R1EV", "oBias", "FULL"];
  for (const id of SHORT) {
    const pk = PK.find(p => p.id === id)!;
    console.log(`\n${"#".repeat(120)}\n### DETAIL — ${pk.id} ${pk.name} [${pk.tag}]\n${"#".repeat(120)}`);
    // robustness windows
    const win = (label: string, f: (r: Row) => boolean) => { const e = rows.filter(f).map(r => effOf(r, pk)).filter(x => ON(x.grade)); console.log(`  ${label.padEnd(22)} ${fmt(agg(e))}`); };
    console.log(" Robustness (board):");
    win("full", () => true); win("excl 6/14", r => r.date !== SIX14); win("6/14 only", r => r.date === SIX14);
    win("last3 (>=6/13)", r => r.date >= "2026-06-13"); win("last7 (>=6/09)", r => r.date >= "2026-06-09");
    win("ML only", r => r.market === "moneyline"); win("OU only", r => r.market === "total"); win("FI only", r => r.market === "first_inning");
    console.log("  BA only / Lean only:");
    console.log(`    BA   ${fmt(agg(rows.map(r => effOf(r, pk)).filter(e => e.grade === "best_angle")))}`);
    console.log(`    Lean ${fmt(agg(rows.map(r => effOf(r, pk)).filter(e => e.grade === "lean")))}`);
    // cuts
    console.log("  Cuts (board):");
    for (const [lbl, f] of [["Over", (r: Row, e: Eff) => e.side === "over"], ["Under", (r: Row, e: Eff) => e.side === "under"], ["favorite", (r: Row, e: Eff) => r.market === "moneyline" && r.odds !== null && r.odds < 0], ["dog", (r: Row, e: Eff) => r.market === "moneyline" && r.odds !== null && r.odds > 0], ["home", (r: Row, e: Eff) => r.pick === "home"], ["away", (r: Row, e: Eff) => r.pick === "away"], ["NRFI", (r: Row, e: Eff) => r.market === "first_inning" && e.side === "under"], ["YRFI", (r: Row, e: Eff) => r.market === "first_inning" && e.side === "over"]] as any[]) {
      console.log(`    ${lbl.padEnd(10)} ${fmt(agg(sub(rows, pk, (r, e) => ON(e.grade) && f(r, e))))}`);
    }
    // daily
    console.log("  Daily board record (date: rec | BA | Lean):");
    const dates = [...new Set(rows.map(r => r.date))].sort();
    for (const d of dates) { const dr = rows.filter(r => r.date === d).map(r => effOf(r, pk)); const b = agg(board(dr)), ba = agg(dr.filter(e => e.grade === "best_angle")), ln = agg(dr.filter(e => e.grade === "lean")); console.log(`    ${d}: ${fmt(b).padEnd(22)} | BA ${fmt(ba).padEnd(18)} | Lean ${fmt(ln)}`); }
    // weekly
    console.log("  Weekly board (wk1=6/7-6/13, wk2=6/14+):");
    for (const [lbl, f] of [["wk1", (r: Row) => r.date <= "2026-06-13"], ["wk2", (r: Row) => r.date >= "2026-06-14"]] as any[]) { const e = rows.filter(f).map(r => effOf(r, pk)).filter(x => ON(x.grade)); console.log(`    ${lbl}: ${fmt(agg(e))}`); }
    // current slate
    const curBefore = rows.filter(r => r.date >= TODAY && ON(r.grade));
    const curAfter = rows.filter(r => r.date >= TODAY).map(r => ({ r, e: effOf(r, PK.find(p => p.id === id)!) })).filter(x => ON(x.e.grade));
    console.log(`  Current slate (>=${TODAY}): before board=${curBefore.length} -> after board=${curAfter.length}`);
  }

  // ---- PICK-LEVEL DIFF for FULL ----
  console.log(`\n${"#".repeat(120)}\n### PICK-LEVEL DIFF — FULL package (changed rows only)\n${"#".repeat(120)}`);
  console.log("date       matchup           mkt   oSide oGrade->nGrade        flip  p     edge  oRes  reason");
  const full = PK.find(p => p.id === "FULL")!;
  for (const r of rows.sort((a, b) => a.date.localeCompare(b.date))) {
    const e = effOf(r, full); const gChg = e.grade !== r.grade, sChg = e.side !== r.side; if (!gChg && !sChg) continue;
    let reason = ""; if (sChg) reason += "Under->Over(marginal) "; if (r.grade === "lean" && r.p !== null && r.p < 0.55) reason += "p<.55 "; if (r.grade === "lean" && (evOf(r.p, r.odds) ?? 0) < 0) reason += "EV<0 "; if (r.grade === "lean" && r.edge !== null && Math.abs(r.edge) >= 2 && Math.abs(r.edge) < 10) reason += "fade2-10 ";
    console.log(`${r.date} ${r.matchup.padEnd(17)} ${r.market.slice(0, 5).padEnd(5)} ${String(r.side).padEnd(5)} ${(r.grade + "->" + e.grade).padEnd(22)} ${sChg ? "Y" : " "}    ${r.p !== null ? (r.p * 100).toFixed(0) : "--"}%  ${r.edge !== null ? r.edge.toFixed(1) : "--"}  ${r.origRes.slice(0, 4).padEnd(4)}  ${reason}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
