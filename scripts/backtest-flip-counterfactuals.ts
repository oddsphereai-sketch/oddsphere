/**
 * Flip counterfactual harness (queue, 2026-06-22).
 *
 * For inverted/bad cohorts, tests FLIP (bet the opposite side) and price-aware
 * redesign — not just no-play/demotion. The goal is prediction accuracy, not
 * warning labels. Read-only; no model re-run; uses STORED model fields.
 *
 * Flips are priced with the real opposite-side odds:
 *   totals — v2_2_audit.over/under_odds_american
 *   ML     — snapshot.odds_source_at_lock_ml.{home,away}.odds
 *   FI     — fi_v2_audit.market_{nrfi,yrfi}_odds_american
 *
 * Run: npx tsx --env-file=.env.local scripts/backtest-flip-counterfactuals.ts
 */
import { supabase } from "../lib/db/supabase";
type Row = Record<string, any>;
const norm = (s: any) => String(s ?? "").toLowerCase();
function american(oa: any, won: boolean | null): number { if (oa == null || won == null) return 0; const o = Number(oa); if (!isFinite(o)) return 0; return won ? (o > 0 ? o / 100 : 100 / Math.abs(o)) : -1; }

// A normalized binary bet: pickedWon (true/false/null=push), and odds for each side.
type Bet = { pickedWon: boolean | null; pickedOdds: number | null; oppOdds: number | null; feat: Row };
type Action = "keep" | "flip" | "noplay";

function run(bets: Bet[], rule: (b: Bet) => Action) {
  let w = 0, l = 0, push = 0, noplay = 0, u = 0, staked = 0, flips = 0, w2l = 0, l2w = 0;
  for (const b of bets) {
    const a = rule(b);
    if (a === "noplay") { noplay++; continue; }
    const won = a === "flip" ? (b.pickedWon === null ? null : !b.pickedWon) : b.pickedWon;
    const oa = a === "flip" ? b.oppOdds : b.pickedOdds;
    if (won === null) push++; else if (won) w++; else l++;
    if (won !== null && oa != null) { u += american(oa, won); staked++; }
    if (a === "flip") { flips++; if (b.pickedWon === true && won === false) w2l++; if (b.pickedWon === false && won === true) l2w++; }
  }
  const n = w + l;
  return { w, l, push, noplay, u, staked, flips, w2l, l2w, wr: n ? (w / n) * 100 : NaN, n };
}
function fmt(label: string, r: ReturnType<typeof run>): string {
  return `${label.padEnd(30)} ${`${r.w}-${r.l}`.padEnd(8)} ${(isNaN(r.wr) ? "-" : r.wr.toFixed(1) + "%").padEnd(7)} ${(r.u >= 0 ? "+" : "") + r.u.toFixed(1)}u/${r.staked}  noplay=${r.noplay} flips=${r.flips} W→L=${r.w2l} L→W=${r.l2w}`;
}

async function loadTotals(): Promise<Bet[]> {
  const { data } = await supabase.from("prediction_records").select(`pick, line_value, odds_american, snapshot_json, prediction_grades:prediction_grades!prediction_record_id ( result, actual_total )`).eq("sport", "mlb").eq("market", "total").gte("slate_date", "2026-06-01").limit(3000);
  const bets: Bet[] = [];
  for (const r of (data ?? []) as Row[]) {
    const a = (r.snapshot_json ?? {}).v2_2_audit ?? {}; const g = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    if (!g || (g.result !== "win" && g.result !== "loss" && g.result !== "push") || a.posterior_total == null || r.line_value == null || g.actual_total == null) continue;
    const pick = norm(r.pick).includes("over") ? "over" : "under"; const line = Number(r.line_value); const actual = Number(g.actual_total);
    const pickedWon = actual === line ? null : (pick === "over" ? actual > line : actual < line);
    bets.push({ pickedWon, pickedOdds: pick === "over" ? a.over_odds_american ?? r.odds_american : a.under_odds_american ?? r.odds_american, oppOdds: pick === "over" ? a.under_odds_american : a.over_odds_american, feat: { pick, line, postTotal: Number(a.posterior_total), meanOver: Number(a.posterior_total) > line, play_grade: r.play_grade, best_angle: r.best_angle, divergence: pick !== (Number(a.posterior_total) > line ? "over" : "under") } });
  }
  return bets;
}
async function loadML(): Promise<Bet[]> {
  const { data } = await supabase.from("prediction_records").select(`pick, odds_american, confidence, edge, market_aligned, snapshot_json, prediction_grades:prediction_grades!prediction_record_id ( result )`).eq("sport", "mlb").eq("market", "moneyline").gte("slate_date", "2026-06-01").limit(3000);
  const bets: Bet[] = [];
  for (const r of (data ?? []) as Row[]) {
    const s = r.snapshot_json ?? {}; const af = s.auto_factors ?? {}; const os = s.odds_source_at_lock_ml; const g = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    if (!g || (g.result !== "win" && g.result !== "loss")) continue;
    const pick = norm(r.pick); const opp = pick === "home" ? "away" : "home";
    bets.push({ pickedWon: g.result === "win", pickedOdds: r.odds_american, oppOdds: os && os[opp] ? os[opp].odds ?? null : null, feat: { conf: Number(r.confidence), raw: Number(af.ml_raw_confidence), fav: Number(r.odds_american) < 0, edge: Number(r.edge), market_aligned: r.market_aligned === true } });
  }
  return bets;
}
async function loadFI(): Promise<Bet[]> {
  const { data } = await supabase.from("prediction_records").select(`pick, odds_american, confidence, snapshot_json, prediction_grades:prediction_grades!prediction_record_id ( result )`).eq("sport", "mlb").eq("market", "first_inning").gte("slate_date", "2026-06-01").limit(3000);
  const bets: Bet[] = [];
  for (const r of (data ?? []) as Row[]) {
    const fa = (r.snapshot_json ?? {}).fi_v2_audit ?? {}; const af = (r.snapshot_json ?? {}).auto_factors ?? {}; const g = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    if (!g || (g.result !== "win" && g.result !== "loss")) continue;
    const pick = norm(r.pick); const isNrfi = pick.includes("nrfi") && !pick.includes("yrfi");
    bets.push({ pickedWon: g.result === "win", pickedOdds: isNrfi ? fa.market_nrfi_odds_american ?? r.odds_american : fa.market_yrfi_odds_american ?? r.odds_american, oppOdds: isNrfi ? fa.market_yrfi_odds_american : fa.market_nrfi_odds_american, feat: { isNrfi, p: Number(af.nrfi_probability), conf: Number(r.confidence) } });
  }
  return bets;
}

async function main() {
  const tot = await loadTotals(), ml = await loadML(), fi = await loadFI();

  console.log(`\n══════ A. TOTALS (n=${tot.length}; opp-priced=${tot.filter(b => b.oppOdds != null).length}) ══════`);
  const gap = (b: Bet) => Math.abs(b.feat.postTotal - b.feat.line);
  console.log(fmt("shipped", run(tot, () => "keep")));
  console.log(fmt("Patch1 no-play divergence", run(tot, (b) => b.feat.divergence ? "noplay" : "keep")));
  console.log(fmt("flip-to-mean (all divergence)", run(tot, (b) => b.feat.pick !== (b.feat.meanOver ? "over" : "under") ? "flip" : "keep")));
  console.log(fmt("flip-to-mean gap>=0.3", run(tot, (b) => (b.feat.pick !== (b.feat.meanOver ? "over" : "under") && gap(b) >= 0.3) ? "flip" : "keep")));
  console.log(fmt("flip gap>=0.5", run(tot, (b) => (b.feat.pick !== (b.feat.meanOver ? "over" : "under") && gap(b) >= 0.5) ? "flip" : "keep")));
  console.log(fmt("hybrid (flip diverge, else keep)", run(tot, (b) => b.feat.pick !== (b.feat.meanOver ? "over" : "under") ? "flip" : "keep")));
  // O/U + line-range split for flip-to-mean
  const flipMean = (b: Bet): Action => b.feat.pick !== (b.feat.meanOver ? "over" : "under") ? "flip" : "keep";
  console.log(`  flip-to-mean O/U: OVER-result ${fmt("", run(tot.filter(b => (flipMean(b) === "flip" ? !(b.feat.pick === "over") : b.feat.pick === "over")), flipMean)).trim()}`);
  for (const [rn, lo, hi] of [["<7.5", 0, 7.5], ["7.5-8.5", 7.5, 8.51], ["9-9.5", 8.6, 9.6], ["10+", 9.6, 99]] as any)
    console.log(`  flip-to-mean line ${rn.padEnd(8)} ${fmt("", run(tot.filter(b => b.feat.line >= lo && b.feat.line < hi), flipMean)).trim()}`);
  const flippedTot = tot.filter(b => flipMean(b) === "flip");
  console.log(`  flipped set: ${flippedTot.length} picks | BA in flipped: ${flippedTot.filter(b => b.feat.best_angle).length} | lean in flipped: ${flippedTot.filter(b => b.feat.play_grade === "lean").length}`);

  console.log(`\n══════ B. ML cohort: final 55-60 ∧ raw<60 (priced flips) ══════`);
  const cohort = ml.filter(b => isFinite(b.feat.raw) && b.feat.conf >= 55 && b.feat.conf < 60 && b.feat.raw < 60);
  console.log(`  cohort n=${cohort.length}; opp-priced=${cohort.filter(b => b.oppOdds != null).length}`);
  console.log(fmt("shipped (cohort)", run(cohort, () => "keep")));
  console.log(fmt("no-play", run(cohort, () => "noplay")));
  console.log(fmt("flip-opposite (all)", run(cohort, () => "flip")));
  console.log(fmt("flip favorites only", run(cohort, (b) => b.feat.fav ? "flip" : "keep")));
  console.log(fmt("flip dogs only", run(cohort, (b) => !b.feat.fav ? "flip" : "keep")));
  console.log(fmt("flip positive-edge only", run(cohort, (b) => Number(b.feat.edge) >= 0 ? "flip" : "keep")));
  console.log(`  market-aligned split: aligned ${fmt("", run(cohort.filter(b => b.feat.market_aligned), () => "keep")).trim()}`);
  console.log(`  market-aligned split: divergent ${fmt("", run(cohort.filter(b => !b.feat.market_aligned), () => "keep")).trim()}`);
  console.log(`  fav ${fmt("", run(cohort.filter(b => b.feat.fav), () => "keep")).trim()}`);
  console.log(`  dog ${fmt("", run(cohort.filter(b => !b.feat.fav), () => "keep")).trim()}`);
  console.log(`  whole-ML effect of flip-favorites-in-cohort: ${fmt("", run(ml, (b) => (isFinite(b.feat.raw) && b.feat.conf >= 55 && b.feat.conf < 60 && b.feat.raw < 60 && b.feat.fav) ? "flip" : "keep")).trim()}`);

  console.log(`\n══════ C. FI NRFI marginal (priced flips) ══════`);
  const nrfi = fi.filter(b => b.feat.isNrfi);
  console.log(`  all NRFI n=${nrfi.length}; opp(YRFI)-priced=${nrfi.filter(b => b.oppOdds != null).length}`);
  console.log(fmt("shipped NRFI", run(nrfi, () => "keep")));
  console.log(fmt("no-play all NRFI", run(nrfi, () => "noplay")));
  console.log(fmt("flip ALL NRFI->YRFI", run(nrfi, () => "flip")));
  console.log(fmt("flip NRFI .53-.62 ->YRFI", run(nrfi, (b) => (b.feat.p >= 0.53 && b.feat.p < 0.62) ? "flip" : "keep")));
  console.log(fmt("no-play NRFI .53-.62", run(nrfi, (b) => (b.feat.p >= 0.53 && b.feat.p < 0.62) ? "noplay" : "keep")));
  console.log(fmt("stronger thresh: keep p>=.62 only", run(nrfi, (b) => b.feat.p < 0.62 ? "noplay" : "keep")));
  console.log(fmt("flip p<.62, keep p>=.62", run(nrfi, (b) => b.feat.p < 0.62 ? "flip" : "keep")));
  for (const [rn, lo, hi] of [[".53-.57", .53, .57], [".57-.60", .57, .60], [".60-.62", .60, .62], [".62-.65", .62, .65], [".65+", .65, 1]] as any)
    console.log(`  NRFI ${rn.padEnd(8)} shipped ${fmt("", run(nrfi.filter(b => b.feat.p >= lo && b.feat.p < hi), () => "keep")).trim()} || flip→YRFI ${fmt("", run(nrfi.filter(b => b.feat.p >= lo && b.feat.p < hi), () => "flip")).trim()}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
