/**
 * Totals SIDE-SELECTION redesign backtest (queue #1, 2026-06-22).
 *
 * Replays 7 candidate side-selection rules from stored snapshot inputs against
 * actual graded results. Read-only; no model is re-run. Decision is OPEN for
 * redesign — this is the evidence gate, NOT an implementation.
 *
 * Variants: 1 mean-aligned · 2 raw Poisson · 3 regularized prob · 4 hybrid
 * (prob, defer to mean on divergence) · 5 market-anchored · 6 stand-down only on
 * near-line divergence (Patch-1 behavior) · 7 line-movement-confirmed.
 *
 * Run: npx tsx --env-file=.env.local scripts/backtest-totals-side-selection.ts
 */
import { supabase } from "../lib/db/supabase";
import { overProbabilityPoisson } from "../lib/automodel/runDistribution";
import { regularizeProbability } from "../lib/automodel/mlbProbabilityRegularization";

type Side = "over" | "under";
type T = {
  line: number; postHome: number; postAway: number; marketOver: number | null;
  overOdds: number | null; underOdds: number | null; shipped: Side; actual: number;
  mvDelta: number | null; // current_implied - open_implied for picked side (>0 = toward shipped)
};

function profit(oa: number | null, w: boolean | null): number { if (oa == null || w == null) return 0; return w ? (oa > 0 ? oa / 100 : 100 / Math.abs(oa)) : -1; }
function won(side: Side, actual: number, line: number): boolean | null { if (actual === line) return null; const over = actual > line; return side === "over" ? over : !over; }
function oddsFor(side: Side, r: T): number | null { return side === "over" ? r.overOdds : r.underOdds; }
const raw = (r: T) => overProbabilityPoisson(r.postHome, r.postAway, r.line);
const meanOver = (r: T) => (r.postHome + r.postAway) > r.line;

type Stat = { w: number; l: number; push: number; u: number; staked: number; flips: number; w2l: number; l2w: number; noplay: number; div: number };
const z = (): Stat => ({ w: 0, l: 0, push: 0, u: 0, staked: 0, flips: 0, w2l: 0, l2w: 0, noplay: 0, div: 0 });
const wr = (s: Stat) => { const n = s.w + s.l; return n ? ((s.w / n) * 100).toFixed(1) + "%" : "-"; };

// a rule returns the side to play, or null = no-play
function evalRule(rows: T[], rule: (r: T) => Side | null): Stat {
  const s = z();
  for (const r of rows) {
    const side = rule(r);
    if (side === null) { s.noplay++; continue; }
    if (meanOver(r) !== (side === "over")) s.div++;
    const w = won(side, r.actual, r.line);
    if (w === null) s.push++; else if (w) s.w++; else s.l++;
    const oa = oddsFor(side, r);
    if (w !== null && oa != null) { s.u += profit(oa, w); s.staked++; }
    if (side !== r.shipped) {
      s.flips++;
      const sw = won(r.shipped, r.actual, r.line);
      if (sw === true && w === false) s.w2l++;
      if (sw === false && w === true) s.l2w++;
    }
  }
  return s;
}
function row(name: string, s: Stat): string {
  return `${name.padEnd(30)} ${`${s.w}-${s.l}`.padEnd(8)} ${wr(s).padEnd(7)} ${(s.u >= 0 ? "+" : "") + s.u.toFixed(1)}u/${s.staked}  noplay=${s.noplay} flips=${s.flips} W→L=${s.w2l} L→W=${s.l2w} div=${s.div}`;
}

async function main() {
  const { data } = await supabase.from("prediction_records")
    .select(`id, pick, line_value, odds_american, snapshot_json,
      prediction_grades:prediction_grades!prediction_record_id ( result, actual_total )`)
    .eq("sport", "mlb").eq("market", "total").gte("slate_date", "2026-06-01").limit(3000);
  const rows: T[] = [];
  for (const r of (data ?? []) as any[]) {
    const a = (r.snapshot_json ?? {}).v2_2_audit ?? {};
    const lm = (r.snapshot_json ?? {}).line_movement ?? null;
    const g = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    if (!g || (g.result !== "win" && g.result !== "loss" && g.result !== "push")) continue;
    if (a.posterior_home_runs == null || a.posterior_away_runs == null || r.line_value == null || g.actual_total == null) continue;
    const shipped: Side = String(r.pick).toLowerCase().includes("over") ? "over" : "under";
    rows.push({
      line: Number(r.line_value), postHome: Number(a.posterior_home_runs), postAway: Number(a.posterior_away_runs),
      marketOver: a.ou_market_prob != null ? Number(a.ou_market_prob) : null,
      overOdds: a.over_odds_american ?? (shipped === "over" ? r.odds_american : null),
      underOdds: a.under_odds_american ?? (shipped === "under" ? r.odds_american : null),
      shipped, actual: Number(g.actual_total),
      mvDelta: lm && lm.open_implied_prob != null && lm.current_implied_prob != null ? Number(lm.current_implied_prob) - Number(lm.open_implied_prob) : null,
    });
  }
  console.log(`graded totals: ${rows.length}  (with movement data: ${rows.filter(r => r.mvDelta != null).length})\n`);

  const divergent = (r: T) => meanOver(r) !== (raw(r) >= 0.5);
  const regOver = (r: T, k: number, cap: number) => regularizeProbability({ rawProb: raw(r), marketProb: r.marketOver, k, maxDistancePp: cap }).regularizedProb ?? raw(r);

  const rules: Array<[string, (r: T) => Side | null]> = [
    ["shipped (baseline)", (r) => r.shipped],
    ["1 mean-aligned", (r) => meanOver(r) ? "over" : "under"],
    ["2 raw Poisson >=.5", (r) => raw(r) >= 0.5 ? "over" : "under"],
    ["3 regularized k=.5", (r) => regOver(r, 0.5, 9) >= 0.5 ? "over" : "under"],
    ["4 hybrid (mean on diverge)", (r) => divergent(r) ? (meanOver(r) ? "over" : "under") : (raw(r) >= 0.5 ? "over" : "under")],
    ["5 market-anchored", (r) => r.marketOver != null ? (r.marketOver >= 0.5 ? "over" : "under") : (raw(r) >= 0.5 ? "over" : "under")],
    ["6 stand-down near-line div", (r) => divergent(r) ? null : (raw(r) >= 0.5 ? "over" : "under")],
    ["7 movement-confirmed", (r) => { const side = raw(r) >= 0.5 ? "over" : "under"; if (r.mvDelta == null) return side; return r.mvDelta > 0.005 ? side : null; }],
  ];

  console.log("=== OVERALL (record · units · flips · W↔L · no-play · divergence) ===");
  for (const [n, f] of rules) console.log(row(n, evalRule(rows, f)));

  console.log("\n=== OVER vs UNDER split (win% / units) ===");
  for (const [n, f] of rules) {
    const ov = evalRule(rows.filter(r => f(r) === "over"), f);
    const un = evalRule(rows.filter(r => f(r) === "under"), f);
    console.log(`  ${n.padEnd(30)} OVER ${`${ov.w}-${ov.l}`.padEnd(7)} ${wr(ov).padEnd(6)} ${(ov.u>=0?"+":"")+ov.u.toFixed(1)}u | UNDER ${`${un.w}-${un.l}`.padEnd(7)} ${wr(un).padEnd(6)} ${(un.u>=0?"+":"")+un.u.toFixed(1)}u`);
  }

  console.log("\n=== LINE-RANGE split (win%) ===");
  const ranges: Array<[string, (l: number) => boolean]> = [["<7.5", l => l < 7.5], ["7.5-8.5", l => l >= 7.5 && l <= 8.5], ["9-9.5", l => l > 8.5 && l <= 9.5], ["10+", l => l > 9.5]];
  for (const [n, f] of rules) {
    const parts = ranges.map(([rn, rf]) => { const s = evalRule(rows.filter(r => rf(r.line)), f); return `${rn} ${wr(s)}`; });
    console.log(`  ${n.padEnd(30)} ${parts.join(" | ")}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
