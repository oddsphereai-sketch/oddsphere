/**
 * Forward-validation checkpoint (2026-06-22).
 *
 * Measures the SHIPPED corrections against graded results on FORWARD slates
 * (slate_date >= SINCE = prod deploy date). Reads the actual flip-audit fields
 * (snapshot.ml_flip / ou_flip / fi_flip) so it scores what really shipped, not a
 * re-derivation. Read-only.
 *
 * Reports, per your checklist:
 *   1. ML flipped cohort — record / units (+ old-side counterfactual)
 *   2. Totals mean-side corrected — record / units (+ old-side at the old line)
 *   3. FI NRFI→YRFI flip — record / units (+ old-side counterfactual)
 *   4. Bet-line-basis-dependent picks — flips where bet line != market_total
 *   5. Corrected picks by grade / verdict
 *   6. CLV where available
 *   7. Old-side counterfactual comparison (did the corrections help, net?)
 *   8. Cases where the correction HURT us (W→L from the flip)
 *
 * Run: npx tsx --env-file=.env.local scripts/forward-validation-checkpoint.ts [SINCE=YYYY-MM-DD]
 * SINCE defaults to the prod deploy date below — UPDATE IT at prod merge so the
 * window is genuinely forward (preview/in-sample rows are excluded).
 */
import { supabase } from "../lib/db/supabase";

const PROD_DEPLOY_DATE = "2026-06-22"; // ← update to the actual prod merge date
const SINCE = process.argv[2] || PROD_DEPLOY_DATE;

type Row = Record<string, any>;
const norm = (s: any) => String(s ?? "").toLowerCase();
function american(oa: any, won: boolean | null): number {
  if (oa == null || won == null) return 0;
  const o = Number(oa); if (!isFinite(o)) return 0;
  return won ? (o > 0 ? o / 100 : 100 / Math.abs(o)) : -1;
}
const g1 = (r: Row) => (Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades);
function rec(label: string, w: number, l: number, u: number, staked: number): string {
  const wr = w + l ? ((w / (w + l)) * 100).toFixed(1) + "%" : "-";
  return `${label.padEnd(34)} ${`${w}-${l}`.padEnd(8)} ${wr.padEnd(7)} ${(u >= 0 ? "+" : "") + u.toFixed(1)}u/${staked}`;
}

async function load(market: string): Promise<Row[]> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select(`matchup, pick, side, line_value, odds_american, confidence, play_grade, best_angle, no_bet, market_aligned, snapshot_json, prediction_grades:prediction_grades!prediction_record_id ( result, actual_total )`)
    .eq("sport", "mlb").eq("market", market).gte("slate_date", SINCE).limit(5000);
  if (error) { console.log(`  load(${market}) error: ${error.message}`); return []; }
  return (data ?? []) as Row[];
}

async function main() {
  console.log(`\n════════ FORWARD-VALIDATION CHECKPOINT — slates since ${SINCE} ════════`);
  const [ml, tot, fi] = [await load("moneyline"), await load("total"), await load("first_inning")];
  const settled = (r: Row) => { const g = g1(r); return g && (g.result === "win" || g.result === "loss"); };

  // ── 1. ML flipped cohort ──
  const mlFlipped = ml.filter((r) => (r.snapshot_json?.ml_flip?.flipped === true) && settled(r));
  let w = 0, l = 0, u = 0, ow = 0, ol = 0, ou = 0;
  const mlHurt: string[] = [];
  for (const r of mlFlipped) {
    const g = g1(r); const won = g.result === "win";
    if (won) w++; else l++; u += american(r.odds_american, won);
    const oldOdds = r.snapshot_json?.ml_flip?.original_odds; const oldWon = !won; // binary opposite
    if (oldWon) ow++; else ol++; ou += american(oldOdds, oldWon);
    if (!won && oldWon) mlHurt.push(`ML ${r.matchup ?? r.pick}: flip lost, original would've won`);
  }
  console.log(`\n── 1. ML flipped cohort (n=${mlFlipped.length}) ──`);
  console.log("  " + rec("FINAL (flipped, shipped)", w, l, u, w + l));
  console.log("  " + rec("OLD side (counterfactual)", ow, ol, ou, ow + ol));

  // ── 2. Totals mean-side corrected ──
  const ouFlipped = tot.filter((r) => (r.snapshot_json?.ou_flip?.flipped === true) && settled(r));
  let tw = 0, tl = 0, tu = 0, otw = 0, otl = 0, otu = 0, basisDep = 0;
  const ouHurt: string[] = [];
  for (const r of ouFlipped) {
    const g = g1(r); const won = g.result === "win";
    if (won) tw++; else tl++; tu += american(r.odds_american, won);
    const f = r.snapshot_json.ou_flip;
    if (f.line != null && f.market_total_internal != null && f.line !== f.market_total_internal) basisDep++;
    // old side graded vs the OLD line (market_total_internal) using actual_total
    const oldSide = norm(f.original_probability_side); const oldLine = f.market_total_internal; const at = g.actual_total;
    let oldWon: boolean | null = null;
    if (at != null && oldLine != null && at !== oldLine) oldWon = oldSide === "over" ? at > oldLine : at < oldLine;
    if (oldWon !== null) { if (oldWon) otw++; else otl++; otu += american(f.original_odds, oldWon); }
    if (!won && oldWon === true) ouHurt.push(`OU ${r.matchup ?? r.pick} ${r.line_value}: flip lost, original (${oldSide} ${oldLine}) would've won`);
  }
  console.log(`\n── 2. Totals mean-side corrected (n=${ouFlipped.length}; bet-line-dependent=${basisDep}) ──`);
  console.log("  " + rec("FINAL (flipped, shipped)", tw, tl, tu, tw + tl));
  console.log("  " + rec("OLD side @ old line (cf)", otw, otl, otu, otw + otl));

  // ── 3. FI NRFI→YRFI flip ──
  const fiFlipped = fi.filter((r) => (r.snapshot_json?.fi_flip?.flipped === true) && settled(r));
  let fw = 0, fl = 0, fu = 0, ofw = 0, ofl = 0, ofu = 0;
  const fiHurt: string[] = [];
  for (const r of fiFlipped) {
    const g = g1(r); const won = g.result === "win";
    if (won) fw++; else fl++; fu += american(r.odds_american, won);
    const oldOdds = r.snapshot_json?.fi_flip?.original_odds; const oldWon = !won;
    if (oldWon) ofw++; else ofl++; ofu += american(oldOdds, oldWon);
    if (!won && oldWon) fiHurt.push(`FI ${r.matchup ?? r.pick}: YRFI flip lost, original NRFI would've won`);
  }
  console.log(`\n── 3. FI NRFI→YRFI flip (n=${fiFlipped.length}) ──`);
  console.log("  " + rec("FINAL (YRFI, shipped)", fw, fl, fu, fw + fl));
  console.log("  " + rec("OLD side (NRFI, cf)", ofw, ofl, ofu, ofw + ofl));

  // ── 4. Bet-line-basis-dependent picks (already counted above; surface explicitly) ──
  console.log(`\n── 4. Bet-line-basis-dependent corrected totals: ${basisDep} (flips that exist only because we resolved vs the bet line, not market_total) ──`);

  // ── 5. Corrected picks by grade / verdict ──
  const allCorrected = [...mlFlipped, ...ouFlipped, ...fiFlipped];
  const byGrade = new Map<string, number>();
  for (const r of allCorrected) {
    const k = `play_grade=${r.play_grade ?? "null"} best_angle=${r.best_angle} no_bet=${r.no_bet}`;
    byGrade.set(k, (byGrade.get(k) ?? 0) + 1);
  }
  console.log(`\n── 5. Corrected picks by grade/verdict (n=${allCorrected.length}) ──`);
  if (allCorrected.length === 0) console.log("  (none yet)");
  for (const [k, v] of byGrade) console.log(`  ${v}×  ${k}`);

  // ── 6. CLV where available ──
  // CLV is computed by the clv-reconcile cron (closing_odds_american / clv_pct /
  // beat_closing_line) — NOT columns on prediction_records. Read them from the
  // snapshot if the cron has stamped them there; otherwise report unavailable.
  const clvOf = (r: Row) => r.snapshot_json?.clv ?? null;
  const withClv = allCorrected.filter((r) => clvOf(r)?.clv_pct != null);
  const beat = withClv.filter((r) => clvOf(r)?.beat_closing_line === true).length;
  const avgClv = withClv.length ? withClv.reduce((s, r) => s + Number(clvOf(r).clv_pct), 0) / withClv.length : null;
  console.log(`\n── 6. CLV (corrected picks with closing data: ${withClv.length}/${allCorrected.length}) ──`);
  if (withClv.length === 0) console.log(`  none yet — join clv-reconcile output when running the forward checkpoint`);
  else console.log(`  beat closing: ${beat}/${withClv.length}${avgClv !== null ? ` | avg CLV ${avgClv.toFixed(2)}%` : ""}`);

  // ── 7. Net counterfactual comparison ──
  const finalU = u + tu + fu, oldU = ou + otu + ofu;
  const finalW = w + tw + fw, finalL = l + tl + fl;
  console.log(`\n── 7. NET corrections vs old-side counterfactual ──`);
  console.log(`  CORRECTED (shipped): ${finalW}-${finalL}  ${(finalU >= 0 ? "+" : "") + finalU.toFixed(1)}u`);
  console.log(`  OLD sides (cf):      ${ow + otw + ofw}-${ol + otl + ofl}  ${(oldU >= 0 ? "+" : "") + oldU.toFixed(1)}u`);
  console.log(`  >>> correction delta: ${((finalU - oldU) >= 0 ? "+" : "") + (finalU - oldU).toFixed(1)}u`);

  // ── 8. Where the correction hurt ──
  const hurt = [...mlHurt, ...ouHurt, ...fiHurt];
  console.log(`\n── 8. Cases where the correction HURT (flip lost where original would've won): ${hurt.length} ──`);
  for (const h of hurt) console.log(`  ✗ ${h}`);

  if (finalW + finalL === 0)
    console.log(`\nNOTE: 0 settled corrected picks since ${SINCE} yet — run again after forward slates grade. Until then this is informational only.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
