/**
 * READ-ONLY decision-grade MLB harness. FAITHFUL grades: imports real
 * computePlayGrade + resolveMlbBestAngle (play_grade replay = 100% validated).
 * Per-row: unchanged rows keep STORED grade/best_angle (exact); only rows a
 * candidate changes are recomputed with production fns. No writes.
 *
 * Anchors: B0 = stored (actual tracking). B1 = current model uniform (no change).
 * Candidate = B1 + change. Effect isolated as Candidate vs B1; B0 = what showed.
 * Board = best_angle(bool)===true OR play_grade==='lean'.
 */
import { supabase } from "../../lib/db/supabase";
import { homeWinProbabilityPoisson, overProbabilityPoisson, poissonPmf } from "../../lib/automodel/runDistribution";
import { regularizeProbability } from "../../lib/automodel/mlbProbabilityRegularization";
import { computePlayGrade } from "../../lib/automodel/playGrade";
import { resolveMlbBestAngle } from "../../lib/services/predictionRecordService";

const START = "2026-06-07", SIX14 = "2026-06-14", TODAY = "2026-06-15";
const K_ML = 0.6, K_OU = 0.5, MAXD_ML = 10.0, MAXD_OU = 9.0, BA_ML = 3.0, BA_OU = 3.5;
const PUBLIC = new Set(["best_angle", "lean", "market_aligned", "provisional"]);
const pub = (g: any) => (g != null && PUBLIC.has(String(g)) ? String(g) : null);

// NB
function logGamma(z: number): number { const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]; if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z); z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i); const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x); }
function nbPmf(k: number, mu: number, r: number): number { if (k < 0) return 0; if (!isFinite(r) || r > 1e6) return poissonPmf(k, mu); if (mu <= 0) return k === 0 ? 1 : 0; const p = r / (r + mu); return Math.exp(logGamma(k + r) - logGamma(r) - logGamma(k + 1) + r * Math.log(p) + k * Math.log(1 - p)); }
function overDisp(muA: number, muH: number, line: number, r: number): number { if (!isFinite(r) || r > 1e6) return overProbabilityPoisson(muH, muA, line); const mu = Math.max(0, muA) + Math.max(0, muH); if (mu <= 0) return 0; let s = 0; for (let i = 0; i <= Math.floor(line); i++) s += nbPmf(i, mu, r); return 1 - Math.min(1, s); }
function homeDisp(muH: number, muA: number, r: number): number { if (!isFinite(r) || r > 1e6) return homeWinProbabilityPoisson(muH, muA); if (muH <= 0 && muA <= 0) return 0.5; const M = 20, ph: number[] = [], pa: number[] = []; for (let i = 0; i <= M; i++) { ph.push(nbPmf(i, muH, r)); pa.push(nbPmf(i, muA, r)); } let pH = 0, pA = 0, pT = 0; for (let h = 0; h <= M; h++) for (let a = 0; a <= M; a++) { const j = ph[h] * pa[a]; if (h > a) pH += j; else if (a > h) pA += j; else pT += j; } pH += pT * muH / (muH + muA); pA += pT * muA / (muH + muA); return pH / (pH + pA); }

function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }

type Row = {
  date: string; market: string; storedSide: string | null; storedGrade: string | null; storedBA: boolean; origRes: string; origOdds: number | null;
  pHome: number | null; pAway: number | null; line: number | null; tier: any; prov: boolean;
  mlMktHome: number | null; ouMkt: number | null; mlMktPick: number | null; conf: number | null; postDiff: number | null;
  overOdds: number | null; underOdds: number | null; dir: any; conflict: boolean; reqConf: boolean; mktFbML: boolean; mktFbOU: boolean;
  hs: number | null; as_: number | null; tot: number | null; fir: number | null;
  fiSide: string | null; awayLam: number | null; homeLam: number | null;
};
type Knobs = { rOU?: number; rML?: number; kOU?: number; kML?: number; meanOU?: number; underShrinkPp?: number; favCapPp?: number; fadeLo?: number; fadeHi?: number; ev?: boolean; evFav?: boolean; r1?: boolean; rFI?: number; gapLo?: number; gapHi?: number; lowLine?: number };
const demoteBoard = (e: Eff): Eff => (e.ba || e.grade === "lean") ? { ...e, grade: "market_aligned", ba: false } : e;
type Eff = { grade: string | null; ba: boolean; side: string | null; res: string; odds: number | null };

function run(r: Row, kn: Knobs | null): Eff {
  if (kn === null) return { grade: pub(r.storedGrade), ba: r.storedBA, side: r.storedSide, res: r.origRes, odds: r.origOdds };
  const kML = kn.kML ?? K_ML, kOU = kn.kOU ?? K_OU, rML = kn.rML ?? Infinity, rOU = kn.rOU ?? Infinity;

  if (r.market === "moneyline" && r.pHome != null && r.pAway != null && r.mlMktHome != null) {
    const homeP = homeDisp(r.pHome, r.pAway, rML);
    const pickHome = homeP >= 0.5; let raw = pickHome ? homeP : 1 - homeP;
    if (kn.favCapPp != null && r.origOdds != null && r.origOdds < 0) raw = Math.min(raw, 0.5 + kn.favCapPp / 100);
    const mkt = pickHome ? r.mlMktHome : 1 - r.mlMktHome;
    const reg = regularizeProbability({ rawProb: raw, marketProb: mkt, k: kML, maxDistancePp: MAXD_ML });
    const mp = reg.regularizedProb ?? raw, edge = reg.regularizedEdgePct ?? 0;
    const side = pickHome ? "home" : "away";
    const res = side === r.storedSide ? r.origRes : ((side === "home" ? r.hs! > r.as_! : r.as_! > r.hs!) ? "win" : (r.hs === r.as_ ? "push" : "loss"));
    let e = grade(r, mp, mkt, edge, side, r.origOdds, res, BA_ML, r.mktFbML, kn);
    if (kn.gapLo != null && r.postDiff != null && Math.abs(r.postDiff) >= kn.gapLo && Math.abs(r.postDiff) < (kn.gapHi ?? 1)) e = demoteBoard(e);
    return e;
  }
  if (r.market === "total" && r.pHome != null && r.pAway != null && r.line != null && r.ouMkt != null) {
    const s = (kn.meanOU ?? 0) / 2;
    let overP = overDisp(r.pAway + s, r.pHome + s, r.line, rOU);
    const pickOver = overP >= 0.5; let raw = pickOver ? overP : 1 - overP;
    if (kn.underShrinkPp != null && !pickOver) raw = Math.max(0.5, raw - kn.underShrinkPp / 100);
    const mkt = pickOver ? r.ouMkt : 1 - r.ouMkt;
    const reg = regularizeProbability({ rawProb: raw, marketProb: mkt, k: kOU, maxDistancePp: MAXD_OU });
    const mp = reg.regularizedProb ?? raw, edge = reg.regularizedEdgePct ?? 0;
    const side = pickOver ? "over" : "under";
    const odds = side === r.storedSide ? r.origOdds : (side === "over" ? r.overOdds : r.underOdds);
    const res = side === r.storedSide ? r.origRes : (r.tot === r.line ? "push" : ((side === "over") === (r.tot! > r.line!) ? "win" : "loss"));
    let e = grade(r, mp, mkt, edge, side, odds, res, BA_OU, r.mktFbOU, kn);
    if (kn.lowLine != null && r.line != null && r.line < kn.lowLine) e = demoteBoard(e);
    return e;
  }
  if (r.market === "first_inning" && r.awayLam != null && r.homeLam != null) {
    const muFI = Math.max(0, r.awayLam) + Math.max(0, r.homeLam);
    const pNrfi = nbPmf(0, muFI, kn.rFI ?? Infinity);
    const side = pNrfi >= 0.5 ? "under" : "over";
    const res = side === r.storedSide ? r.origRes : ((side === "under" ? r.fir === 0 : r.fir! > 0) ? "win" : "loss");
    return { grade: pub(r.storedGrade), ba: r.storedBA, side, res, odds: r.origOdds }; // FI grade unchanged (no price)
  }
  return { grade: pub(r.storedGrade), ba: r.storedBA, side: r.storedSide, res: r.origRes, odds: r.origOdds };
}

function grade(r: Row, mp: number, mkt: number, edge: number, side: string, odds: number | null, res: string, baEdge: number, mktFb: boolean, kn: Knobs): Eff {
  // fade band -> market_aligned (off board)
  if (kn.fadeLo != null && kn.fadeHi != null && Math.abs(edge) >= kn.fadeLo && Math.abs(edge) < kn.fadeHi) return { grade: "market_aligned", ba: false, side, res, odds };
  const pg = computePlayGrade({ modelProb: mp, marketProb: mkt, americanOdds: odds, dataQualityTier: r.tier ?? "medium", provisional: r.prov, isHeld: false, minBestAngleEdgePct: baEdge, minBestAngleConfidencePct: 56, marketProbIsFallback: mktFb, bestAngleHardBlockReason: null });
  let g: string | null = pub(pg.grade);
  const baRes = resolveMlbBestAngle({ baseEligible: pg.grade === "best_angle", requiresConfirmation: r.reqConf, lineDirection: r.dir ?? null, opposingPublicMoney: r.conflict });
  let ba = baRes.bestAngle;
  // grade-side overlays (apply to lean)
  if (g === "lean") {
    const ev = odds != null ? (mp * (odds > 0 ? odds / 100 : 100 / -odds) - (1 - mp)) : null;
    if (kn.r1 && mp < 0.55) g = "market_aligned";
    else if (kn.ev && ev != null && ev < 0) g = "market_aligned";
    else if (kn.evFav && odds != null && odds < 0 && ev != null && ev < 0) g = "market_aligned";
  }
  return { grade: g, ba, side, res, odds };
}

const onBoard = (e: Eff) => e.ba === true || e.grade === "lean";
function A(items: Eff[]) { const g = items.filter(e => e.res === "win" || e.res === "loss"); const w = g.filter(e => e.res === "win").length, l = g.length - w; let net = 0, n = 0; for (const e of g) { if (e.odds == null) continue; n++; net += profit(e.odds, e.res === "win"); } return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roi: n ? 100 * net / n : 0 }; }
const F = (a: ReturnType<typeof A>) => `${a.w}-${a.l}(${a.t ? a.pct.toFixed(0) : "--"}%) ${a.units >= 0 ? "+" : ""}${a.units.toFixed(1)}u/${a.roi.toFixed(0)}%`;

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, game_id, market, side, play_grade, best_angle, odds_american, line_value, confidence, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>();
  for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, home_score, away_score, total_runs, first_inning_runs").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: Row[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; const fa = r.snapshot_json?.fi_v2_audit ?? {}; const g = gmap.get(r.game_id) ?? {}; return { date: String(r.slate_date), market: String(r.market), storedSide: r.side, storedGrade: r.play_grade, storedBA: r.best_angle === true, origRes: String(gr?.result ?? "").toLowerCase(), origOdds: r.odds_american, pHome: a.posterior_home_runs ?? null, pAway: a.posterior_away_runs ?? null, line: a.market_total ?? r.line_value ?? a.posterior_total ?? null, tier: a.data_quality_tier ?? fa.data_quality_tier ?? "medium", prov: a.provisional === true, mlMktHome: a.market_home_win_prob ?? null, ouMkt: a.ou_market_prob ?? null, mlMktPick: a.ml_market_prob ?? null, conf: r.confidence, postDiff: a.posterior_home_diff ?? null, overOdds: a.over_odds_american ?? null, underOdds: a.under_odds_american ?? null, dir: r.snapshot_json?.line_movement?.direction ?? null, conflict: r.snapshot_json?.public_splits?.conflict === true, reqConf: a.ml_requires_market_confirmation === true || a.ou_requires_market_confirmation === true, mktFbML: a.ml_market_prob_was_fallback === true, mktFbOU: a.ou_market_prob_was_fallback === true, hs: g.home_score ?? null, as_: g.away_score ?? null, tot: g.total_runs ?? null, fir: g.first_inning_runs ?? null, fiSide: r.market === "first_inning" ? r.side : null, awayLam: fa.away_lambda ?? null, homeLam: fa.home_lambda ?? null }; });

  const PKs: { id: string; name: string; kn: Knobs | null }[] = [
    { id: "B0", name: "STORED actual", kn: null },
    { id: "B1", name: "Current-model control", kn: {} },
    // ML model-side
    { id: "ML.mkt+", name: "ML more market (k=0.4)", kn: { kML: 0.4 } },
    { id: "ML.mkt-", name: "ML less market (k=0.8)", kn: { kML: 0.8 } },
    { id: "ML.favcap", name: "ML favorite cap +6pp", kn: { favCapPp: 6 } },
    // Totals model-side
    { id: "OU.mc+.2", name: "Totals mean +0.2", kn: { meanOU: 0.2 } },
    { id: "OU.mc+.3", name: "Totals mean +0.3", kn: { meanOU: 0.3 } },
    { id: "OU.mc+.4", name: "Totals mean +0.4", kn: { meanOU: 0.4 } },
    { id: "OU.undShr", name: "Under prob shrink 4pp", kn: { underShrinkPp: 4 } },
    { id: "OU.mkt+", name: "Totals more market k=0.3", kn: { kOU: 0.3 } },
    // grade-side
    { id: "EVfav", name: "EV favorite Lean", kn: { evFav: true } },
    { id: "EV", name: "EV all Lean", kn: { ev: true } },
    { id: "R1", name: "R1 p>=.55", kn: { r1: true } },
    { id: "EV+R1", name: "EV + R1", kn: { ev: true, r1: true } },
    // combos
    { id: "OU.3+EVf", name: "Totals mean+.3 + EVfav", kn: { meanOU: 0.3, evFav: true } },
    { id: "OU.3+R1", name: "Totals mean+.3 + R1", kn: { meanOU: 0.3, r1: true } },
    { id: "OU.3+EVf+R1", name: "mean+.3 + EVfav + R1", kn: { meanOU: 0.3, evFav: true, r1: true } },
    { id: "ML.4+OU.3", name: "ML k=.4 + totals mean+.3", kn: { kML: 0.4, meanOU: 0.3 } },
    { id: "FULL", name: "ML.4 + OU.3 + EVfav", kn: { kML: 0.4, meanOU: 0.3, evFav: true } },
    // Gate-1 attributed candidates
    { id: "GAP", name: "ML run-gap 0.5-1 demote (attr)", kn: { gapLo: 0.5, gapHi: 1.0 } },
    { id: "LOWLINE", name: "OU line<8 demote (attr)", kn: { lowLine: 8 } },
    { id: "GAP+LOW", name: "run-gap + low-line demote", kn: { gapLo: 0.5, gapHi: 1.0, lowLine: 8 } },
    { id: "GAP+EVf", name: "run-gap + EVfav", kn: { gapLo: 0.5, gapHi: 1.0, evFav: true } },
    { id: "ATTR.FULL", name: "run-gap + low-line + EVfav", kn: { gapLo: 0.5, gapHi: 1.0, lowLine: 8, evFav: true } },
  ];

  const effAll = (p: typeof PKs[0]) => rows.map(r => run(r, p.kn));

  console.log(`\n${"=".repeat(200)}\nMASTER — record + UNITS/ROI by category. Board=best_angle(bool) OR play_grade=lean. (B0=actual, B1=control, effect = vs B1)\n${"=".repeat(200)}`);
  const cats: [string, (r: Row, e: Eff) => boolean][] = [
    ["BOARD", (r, e) => onBoard(e)], ["BestAngle", (r, e) => e.ba === true], ["Lean", (r, e) => e.grade === "lean"],
    ["ML(brd)", (r, e) => onBoard(e) && r.market === "moneyline"], ["OU(brd)", (r, e) => onBoard(e) && r.market === "total"],
    ["Over", (r, e) => onBoard(e) && e.side === "over"], ["Under", (r, e) => onBoard(e) && e.side === "under"],
    ["fav", (r, e) => onBoard(e) && r.market === "moneyline" && r.origOdds != null && r.origOdds < 0], ["dog", (r, e) => onBoard(e) && r.market === "moneyline" && r.origOdds != null && r.origOdds > 0],
  ];
  console.log(`pkg          ${cats.map(c => c[0].padEnd(20)).join("")}slate`);
  for (const p of PKs) { const es = effAll(p); const line = cats.map(([_, f]) => F(A(es.filter((e, i) => f(rows[i], e)))).padEnd(20)).join(""); const slate = rows.map((r, i) => ({ r, e: es[i] })).filter(x => x.r.date >= TODAY && onBoard(x.e)).length; console.log(`${p.id.padEnd(12)} ${line}${slate}`); }

  // OU + FI side accuracy (model effect, incl off-board)
  console.log(`\n--- O/U side accuracy (record+units) + FI side accuracy (record; unpriced) ---`);
  console.log(`pkg          OU-all               Over                 Under                FI-side             NRFI                YRFI`);
  for (const p of PKs) { const es = effAll(p); const ouA = rows.map((r, i) => ({ r, e: es[i] })).filter(x => x.r.market === "total").map(x => x.e); const ov = ouA.filter(e => e.side === "over"), un = ouA.filter(e => e.side === "under"); const fi = rows.map((r, i) => ({ r, e: es[i] })).filter(x => x.r.market === "first_inning").map(x => x.e); const nr = fi.filter(e => e.side === "under"), yr = fi.filter(e => e.side === "over"); console.log(`${p.id.padEnd(12)} ${F(A(ouA)).padEnd(20)} ${F(A(ov)).padEnd(20)} ${F(A(un)).padEnd(20)} ${F(A(fi)).padEnd(19)} ${F(A(nr)).padEnd(19)} ${F(A(yr))}`); }

  // Robustness (board)
  const KEY = ["B0", "B1", "OU.mc+.3", "EVfav", "GAP", "LOWLINE", "GAP+EVf", "ATTR.FULL", "OU.3+EVf"];
  console.log(`\n${"=".repeat(150)}\nROBUSTNESS — board record+units\n${"=".repeat(150)}`);
  const wins: [string, (r: Row) => boolean][] = [["full", () => true], ["excl6/14", r => r.date !== SIX14], ["6/14", r => r.date === SIX14], ["wk1", r => r.date <= "2026-06-13"], ["wk2", r => r.date >= "2026-06-14"], ["last7", r => r.date >= "2026-06-09"]];
  console.log(`pkg          ${wins.map(w => w[0].padEnd(20)).join("")}`);
  for (const id of KEY) { const p = PKs.find(x => x.id === id)!; const es = effAll(p); console.log(`${id.padEnd(12)} ${wins.map(([_, wf]) => F(A(rows.map((r, i) => ({ r, e: es[i] })).filter(x => wf(x.r) && onBoard(x.e)).map(x => x.e))).padEnd(20)).join("")}`); }

  // Daily+weekly for B0, B1, OU.mc+.3, OU.3+EVf
  const dates = [...new Set(rows.map(r => r.date))].sort();
  for (const id of ["B0", "B1", "OU.mc+.3", "OU.3+EVf"]) { const p = PKs.find(x => x.id === id)!; const es = effAll(p); console.log(`\n--- DAILY ${id} ${p.name} (board) ---`); for (const d of dates) { const e = rows.map((r, i) => ({ r, e: es[i] })).filter(x => x.r.date === d && onBoard(x.e)).map(x => x.e); console.log(`  ${d}  ${F(A(e))}`); } console.log(`  WK1 ${F(A(rows.map((r, i) => ({ r, e: es[i] })).filter(x => x.r.date <= "2026-06-13" && onBoard(x.e)).map(x => x.e)))}  WK2 ${F(A(rows.map((r, i) => ({ r, e: es[i] })).filter(x => x.r.date >= "2026-06-14" && onBoard(x.e)).map(x => x.e)))}`); }

  // Fidelity note: B1 vs B0 board reproduction for >=6/13
  const post = rows.map((r, i) => ({ r, b1: run(r, {}) })).filter(x => x.r.date >= "2026-06-13" && (x.r.market === "moneyline" || x.r.market === "total"));
  let m = 0; for (const x of post) { const b0on = x.r.storedBA || pub(x.r.storedGrade) === "lean"; if (b0on === onBoard(x.b1)) m++; }
  console.log(`\n[fidelity] B1 board-membership == stored for >=6/13 ML/OU: ${m}/${post.length} (${(100 * m / post.length).toFixed(0)}%)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
