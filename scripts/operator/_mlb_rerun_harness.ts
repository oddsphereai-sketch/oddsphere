/**
 * READ-ONLY offline MLB model re-run harness. Foundation validated by
 * _mlb_rerun_validate.ts (100% baseline match per model regime).
 *
 * Reports, for each candidate: tracking RECORD and UNITS/ROI across every
 * category (board/BA/Lean/ML/OU/FI/NRFI/YRFI/Over/Under/fav/dog/home/away),
 * daily, weekly, and out-of-sample windows.
 *
 * THREE comparison anchors (avoids conflating model-version rollout w/ candidate):
 *   B0 = stored (ACTUAL tracking that showed).
 *   B1 = current model (Poisson + regularization) uniform on all inputs, NO candidate.
 *   Cand = B1 + the candidate change. Candidate effect = Cand vs B1.
 * Side flips (totals/FI) re-graded vs actuals; flipped-totals priced from the
 * stored over/under odds in audit (exact, not -110).
 */
import { supabase } from "../../lib/db/supabase";
import { homeWinProbabilityPoisson, overProbabilityPoisson, poissonPmf } from "../../lib/automodel/runDistribution";
import { regularizeProbability } from "../../lib/automodel/mlbProbabilityRegularization";

const START = "2026-06-07", SIX14 = "2026-06-14", TODAY = "2026-06-15";
const K_ML = 0.6, K_OU = 0.5, MAXD_ML = 10.0, MAXD_OU = 9.0;
const BA_EDGE_ML = 3.0, BA_EDGE_OU = 3.5, BA_CONF = 56, LEAN_EDGE = 1.0;

// ---- NB (mean mu, dispersion r; r->inf = Poisson) ----
function logGamma(z: number): number { const g = 7; const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]; if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z); z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i); const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x); }
function nbPmf(k: number, mu: number, r: number): number { if (k < 0) return 0; if (!isFinite(r) || r > 1e6) return poissonPmf(k, mu); if (mu <= 0) return k === 0 ? 1 : 0; const p = r / (r + mu); return Math.exp(logGamma(k + r) - logGamma(r) - logGamma(k + 1) + r * Math.log(p) + k * Math.log(1 - p)); }
function nbCdf(k: number, mu: number, r: number): number { let s = 0; for (let i = 0; i <= k; i++) s += nbPmf(i, mu, r); return Math.min(1, s); }
function overProbDisp(muAway: number, muHome: number, line: number, r: number): number { if (!isFinite(r) || r > 1e6) return overProbabilityPoisson(muHome, muAway, line); const mu = Math.max(0, muHome) + Math.max(0, muAway); if (mu <= 0) return 0; return 1 - nbCdf(Math.floor(line), mu, r); }
function homeWinDisp(muHome: number, muAway: number, r: number): number { if (!isFinite(r) || r > 1e6) return homeWinProbabilityPoisson(muHome, muAway); if (muHome <= 0 && muAway <= 0) return 0.5; if (muHome <= 0) return 0; if (muAway <= 0) return 1; const M = 20, ph: number[] = [], pa: number[] = []; for (let i = 0; i <= M; i++) { ph.push(nbPmf(i, muHome, r)); pa.push(nbPmf(i, muAway, r)); } let pH = 0, pA = 0, pT = 0; for (let h = 0; h <= M; h++) for (let a = 0; a <= M; a++) { const j = ph[h] * pa[a]; if (h > a) pH += j; else if (a > h) pA += j; else pT += j; } pH += pT * muHome / (muHome + muAway); pA += pT * muAway / (muHome + muAway); return pH / (pH + pA); }

function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
function evOf(p: number, o: number | null): number | null { if (o === null) return null; const d = o > 0 ? o / 100 : 100 / -o; return p * d - (1 - p); }

type Row = {
  date: string; gid: number | null; matchup: string; market: string;
  origSide: string | null; origGrade: string; origRes: string; origOdds: number | null;
  // frozen audit inputs
  pHome: number | null; pAway: number | null; line: number | null; tier: string; prov: boolean;
  mlMkt: number | null; ouMkt: number | null; conf: number | null;
  overOdds: number | null; underOdds: number | null; dir: string | null; conflict: boolean | null;
  fiPostNrfi: number | null; awayLam: number | null; homeLam: number | null; fiMktNrfi: number | null;
  // actuals
  hs: number | null; as_: number | null; tot: number | null; fir: number | null;
};

type Knobs = { rOU: number; rML: number; kOU: number; kML: number; meanShift?: number; fadeLo?: number; fadeHi?: number; blendW?: number | null; ev?: boolean; evFav?: boolean; r1?: boolean };

// produce effective {grade, side, res, odds} for a row under knobs (current-model uniform + change)
function run(r: Row, kn: Knobs): { grade: string; side: string | null; res: string; odds: number | null; flipped: boolean } {
  let grade = r.origGrade, side: string | null = r.origSide, res = r.origRes, odds = r.origOdds, flipped = false;

  if (r.market === "moneyline" && r.pHome != null && r.pAway != null) {
    const homeP = homeWinDisp(r.pHome, r.pAway, kn.rML);
    const pickHome = homeP >= 0.5; const rawPick = pickHome ? homeP : 1 - homeP;
    const reg = regularizeProbability({ rawProb: rawPick, marketProb: r.mlMkt, k: kn.kML, maxDistancePp: MAXD_ML });
    const mp = reg.regularizedProb ?? rawPick; const edge = reg.regularizedEdgePct ?? 0;
    const newSide = pickHome ? "home" : "away";
    if (newSide !== r.origSide) { flipped = true; side = newSide; res = (newSide === "home" ? (r.hs! > r.as_!) : (r.as_! > r.hs!)) ? "win" : (r.hs === r.as_ ? "push" : "loss"); }
    grade = deriveGrade(edge, r.conf, r.tier, r.prov, BA_EDGE_ML, mp, kn, r.origOdds, r.dir, r.conflict);
  } else if (r.market === "total" && r.pHome != null && r.pAway != null && r.line != null) {
    const s = (kn.meanShift ?? 0) / 2; // split mean correction across home/away
    const overP = overProbDisp(r.pAway + s, r.pHome + s, r.line, kn.rOU);
    const pickOver = overP >= 0.5; const rawPick = pickOver ? overP : 1 - overP;
    const reg = regularizeProbability({ rawProb: rawPick, marketProb: r.ouMkt, k: kn.kOU, maxDistancePp: MAXD_OU });
    const mp = reg.regularizedProb ?? rawPick; const edge = reg.regularizedEdgePct ?? 0;
    const newSide = pickOver ? "over" : "under";
    if (newSide !== r.origSide) { flipped = true; side = newSide; odds = newSide === "over" ? r.overOdds : r.underOdds; res = (r.tot === r.line ? "push" : ((newSide === "over") === (r.tot! > r.line!) ? "win" : "loss")); }
    grade = deriveGrade(edge, r.conf, r.tier, r.prov, BA_EDGE_OU, mp, kn, odds, r.dir, r.conflict);
  } else if (r.market === "first_inning" && r.fiPostNrfi != null) {
    // FI overdispersion via lambdas: P(0 first-inning runs) with NB on total FI runs
    if (r.awayLam != null && r.homeLam != null) {
      const muFI = Math.max(0, r.awayLam) + Math.max(0, r.homeLam);
      const pNrfi = nbPmf(0, muFI, kn.rOU); // P(no runs) under dispersion
      const pickNrfi = pNrfi >= 0.5; const newSide = pickNrfi ? "under" : "over";
      if (newSide !== r.origSide) { flipped = true; side = newSide; res = (newSide === "under" ? r.fir === 0 : r.fir! > 0) ? "win" : "loss"; }
    }
    // FI grade unchanged (no price; keep stored grade)
  }
  // grade-side overlays
  if (grade === "lean" && kn.r1) { /* handled in deriveGrade via mp */ }
  return { grade, side, res, odds, flipped };
}

function deriveGrade(edge: number, conf: number | null, tier: string, prov: boolean, baEdge: number, mp: number, kn: Knobs, odds: number | null, dir: string | null, conflict: boolean | null): string {
  // fade band -> demote
  if (kn.fadeLo != null && kn.fadeHi != null && Math.abs(edge) >= kn.fadeLo && Math.abs(edge) < kn.fadeHi) return "market_aligned";
  let g: string;
  const c = conf ?? 0;
  if (edge >= baEdge && c >= BA_CONF && tier === "high" && !prov) g = "best_angle";
  else if (edge >= LEAN_EDGE) g = "lean";
  else if (edge >= -LEAN_EDGE) g = "market_aligned";
  else g = "no_bet";
  // BA market-confirmation demotion (resolveMlbBestAngle): against_pick line move
  // OR opposing public-money conflict -> BA drops to lean.
  if (g === "best_angle" && (dir === "against_pick" || conflict === true)) g = "lean";
  if (g === "lean" && kn.r1 && mp < 0.55) g = "market_aligned";
  if (g === "lean" && kn.ev && (evOf(mp, odds) ?? 1) < 0) g = "market_aligned";
  if (g === "lean" && kn.evFav && odds !== null && odds < 0 && (evOf(mp, odds) ?? 1) < 0) g = "market_aligned";
  return g;
}

const ON = (g: string) => g === "best_angle" || g === "lean";
function A(items: { res: string; odds: number | null }[]) { const gg = items.filter(e => e.res === "win" || e.res === "loss"); const w = gg.filter(e => e.res === "win").length, l = gg.length - w; let net = 0, n = 0; for (const e of gg) { if (e.odds === null) continue; n++; net += profit(e.odds, e.res === "win"); } return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roi: n ? 100 * net / n : 0 }; }
const F = (a: ReturnType<typeof A>) => `${a.w}-${a.l}(${a.t ? a.pct.toFixed(0) : "--"}%) ${a.units >= 0 ? "+" : ""}${a.units.toFixed(1)}u/${a.roi.toFixed(0)}%`;

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, matchup, game_id, market, side, play_grade, odds_american, line_value, confidence, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>();
  for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, home_score, away_score, total_runs, first_inning_runs").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: Row[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; const fa = r.snapshot_json?.fi_v2_audit ?? {}; const g = gmap.get(r.game_id) ?? {}; return { date: String(r.slate_date), gid: r.game_id, matchup: String(r.matchup ?? ""), market: String(r.market), origSide: r.side, origGrade: String(r.play_grade ?? "").toLowerCase(), origRes: String(gr?.result ?? "").toLowerCase(), origOdds: r.odds_american, pHome: a.posterior_home_runs ?? null, pAway: a.posterior_away_runs ?? null, line: a.market_total ?? r.line_value ?? a.posterior_total ?? null, tier: String(a.data_quality_tier ?? fa.data_quality_tier ?? ""), prov: a.provisional === true, mlMkt: a.ml_market_prob ?? null, ouMkt: a.ou_market_prob ?? null, conf: r.confidence, overOdds: a.over_odds_american ?? null, underOdds: a.under_odds_american ?? null, dir: r.snapshot_json?.line_movement?.direction ?? null, conflict: r.snapshot_json?.public_splits?.conflict ?? null, fiPostNrfi: fa.posterior_p_nrfi ?? null, awayLam: fa.away_lambda ?? null, homeLam: fa.home_lambda ?? null, fiMktNrfi: fa.market_nrfi_no_vig ?? null, hs: g.home_score ?? null, as_: g.away_score ?? null, tot: g.total_runs ?? null, fir: g.first_inning_runs ?? null }; });

  const POISSON = Infinity;
  const B1: Knobs = { rOU: POISSON, rML: POISSON, kOU: K_OU, kML: K_ML };
  // candidate packages
  const PKs: { id: string; name: string; kn: Knobs | null }[] = [
    { id: "B0", name: "STORED (actual tracking)", kn: null },
    { id: "B1", name: "Current model uniform (control)", kn: B1 },
    { id: "OD5", name: "Totals overdisp r=5 (contrast)", kn: { ...B1, rOU: 5 } },
    { id: "MC+.3", name: "Mean-corr +0.3 runs", kn: { ...B1, meanShift: 0.3 } },
    { id: "MC+.5", name: "Mean-corr +0.5 runs", kn: { ...B1, meanShift: 0.5 } },
    { id: "MC+.7", name: "Mean-corr +0.7 runs", kn: { ...B1, meanShift: 0.7 } },
    { id: "MC+1.0", name: "Mean-corr +1.0 runs", kn: { ...B1, meanShift: 1.0 } },
    { id: "fade", name: "Fade 2-10pp (OU+ML)", kn: { ...B1, fadeLo: 2, fadeHi: 10 } },
    { id: "EV", name: "EV gate all Lean", kn: { ...B1, ev: true } },
    { id: "R1", name: "R1 p>=.55", kn: { ...B1, r1: true } },
    { id: "EVfav", name: "EV favorite Lean", kn: { ...B1, evFav: true } },
    { id: "MC.5+EVf", name: "MC+0.5 + EVfav", kn: { ...B1, meanShift: 0.5, evFav: true } },
    { id: "MC.5+R1", name: "MC+0.5 + R1", kn: { ...B1, meanShift: 0.5, r1: true } },
    { id: "MC.5+EVf+R1", name: "MC+0.5 + EVfav + R1", kn: { ...B1, meanShift: 0.5, evFav: true, r1: true } },
  ];

  const eff = (r: Row, p: typeof PKs[0]) => p.kn === null ? { grade: r.origGrade, side: r.origSide, res: r.origRes, odds: r.origOdds, flipped: false } : run(r, p.kn);

  // ---- MASTER: board + per-category RECORD + UNITS ----
  console.log(`\n${"=".repeat(170)}\nMASTER — record + UNITS/ROI by category. B0=actual, B1=control, rest=candidates (effect = vs B1)\n${"=".repeat(170)}`);
  const cats: [string, (r: Row, e: ReturnType<typeof eff>) => boolean][] = [
    ["BOARD", (r, e) => ON(e.grade)], ["BA", (r, e) => e.grade === "best_angle"], ["Lean", (r, e) => e.grade === "lean"],
    ["ML", (r, e) => ON(e.grade) && r.market === "moneyline"], ["OU", (r, e) => ON(e.grade) && r.market === "total"],
    ["Over", (r, e) => ON(e.grade) && e.side === "over"], ["Under", (r, e) => ON(e.grade) && e.side === "under"],
    ["fav", (r, e) => ON(e.grade) && r.market === "moneyline" && r.origOdds !== null && r.origOdds < 0], ["dog", (r, e) => ON(e.grade) && r.market === "moneyline" && r.origOdds !== null && r.origOdds > 0],
  ];
  console.log(`pkg          ${cats.map(c => c[0].padEnd(20)).join("")}slate`);
  for (const p of PKs) { const line = cats.map(([_, f]) => F(A(rows.map(r => eff(r, p)).filter(e => true).filter((e, i) => f(rows[i], e)))).padEnd(20)).join(""); const slate = rows.filter(r => r.date >= TODAY).map(r => eff(r, p)).filter(e => ON(e.grade)).length; console.log(`${p.id.padEnd(12)} ${line}${slate}`); }

  // FI + Over/Under model-accuracy (record only; FI unpriced)
  console.log(`\n--- OU side accuracy (record, units) + FI side accuracy (record only) ---`);
  console.log(`pkg          OU-all(side)         Over                 Under                FI(side)            NRFI                YRFI`);
  for (const p of PKs) {
    const ouAll = rows.filter(r => r.market === "total").map(r => eff(r, p));
    const over = rows.filter(r => r.market === "total").map(r => eff(r, p)).filter(e => e.side === "over");
    const under = rows.filter(r => r.market === "total").map(r => eff(r, p)).filter(e => e.side === "under");
    const fi = rows.filter(r => r.market === "first_inning").map(r => eff(r, p));
    const nrfi = fi.filter(e => e.side === "under"), yrfi = fi.filter(e => e.side === "over");
    console.log(`${p.id.padEnd(12)} ${F(A(ouAll)).padEnd(20)} ${F(A(over)).padEnd(20)} ${F(A(under)).padEnd(20)} ${F(A(fi)).padEnd(19)} ${F(A(nrfi)).padEnd(19)} ${F(A(yrfi))}`);
  }

  // ---- ROBUSTNESS (board) for key packages ----
  const KEY = ["B0", "B1", "OD5", "MC+.5", "EVfav", "MC.5+EVf", "MC.5+EVf+R1"];
  console.log(`\n${"=".repeat(140)}\nROBUSTNESS — board record+units (candidate effect = vs B1)\n${"=".repeat(140)}`);
  const wins: [string, (r: Row) => boolean][] = [["full", () => true], ["excl6/14", r => r.date !== SIX14], ["6/14", r => r.date === SIX14], ["wk1", r => r.date <= "2026-06-13"], ["wk2", r => r.date >= "2026-06-14"], ["last7", r => r.date >= "2026-06-09"]];
  console.log(`pkg          ${wins.map(w => w[0].padEnd(20)).join("")}`);
  for (const id of KEY) { const p = PKs.find(x => x.id === id)!; console.log(`${id.padEnd(12)} ${wins.map(([_, wf]) => F(A(rows.filter(wf).map(r => eff(r, p)).filter(e => ON(e.grade)))).padEnd(20)).join("")}`); }

  // ---- DAILY + WEEKLY for B0, B1, OD5, OD5+EVf ----
  const dates = [...new Set(rows.map(r => r.date))].sort();
  for (const id of ["B0", "B1", "MC+.5", "MC.5+EVf"]) {
    const p = PKs.find(x => x.id === id)!;
    console.log(`\n--- DAILY+WEEKLY ${id} ${p.name} (board) ---`);
    for (const d of dates) { const dr = rows.filter(r => r.date === d).map(r => eff(r, p)).filter(e => ON(e.grade)); console.log(`  ${d}  ${F(A(dr))}`); }
    console.log(`  WK1 ${F(A(rows.filter(r => r.date <= "2026-06-13").map(r => eff(r, p)).filter(e => ON(e.grade))))}  WK2 ${F(A(rows.filter(r => r.date >= "2026-06-14").map(r => eff(r, p)).filter(e => ON(e.grade))))}`);
  }

  // ---- VALIDATION: B1 grade vs stored for >=6/13 (fidelity of grade re-derivation) ----
  const post = rows.filter(r => r.date >= "2026-06-13" && (r.market === "moneyline" || r.market === "total"));
  let gMatch = 0; for (const r of post) { const e = run(r, B1); if (e.grade === r.origGrade) gMatch++; }
  console.log(`\n[fidelity] B1 grade==stored for >=6/13 ML/OU: ${gMatch}/${post.length} (${(100 * gMatch / post.length).toFixed(0)}%) — BA market-confirmation demotions not replicated, so <100% expected`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
