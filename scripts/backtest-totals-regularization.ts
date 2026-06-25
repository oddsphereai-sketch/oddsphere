/**
 * Offline totals backtest harness (2026-06-22, "C").
 *
 * Re-runs the totals SIDE-SELECTION and PROBABILITY-REGULARIZATION layers from
 * STORED inputs (snapshot v2_2_audit posterior runs + market prob + odds) against
 * ACTUAL graded results. No model is re-run; this is a faithful replay of the
 * pure layers that turn the posterior into a pick + edge.
 *
 *   raw P(over) = overProbabilityPoisson(posterior_home, posterior_away, line)
 *   reg P(over) = regularizeProbability(raw, market, k, cap)
 *   side        = P(over) >= 0.5 ? over : under   (or mean/market alternatives)
 *
 * Answers: does changing regularization (or the side-selection signal) change the
 * actual picks and improve results — not just relabel them?
 *
 * Read-only. Run: npx tsx --env-file=.env.local scripts/backtest-totals-regularization.ts
 */
import { supabase } from "../lib/db/supabase";
import { overProbabilityPoisson } from "../lib/automodel/runDistribution";
import { regularizeProbability } from "../lib/automodel/mlbProbabilityRegularization";

const BA_OU = 3.0; // BEST_ANGLE_MIN_EDGE_PCT_OU
const LEAN = 1.0;  // LEAN_MIN_EDGE_PCT

type T = {
  id: number; gameId: number;
  line: number; postHome: number; postAway: number; marketTotal: number;
  marketOver: number | null; overOdds: number | null; underOdds: number | null;
  shippedPick: "over" | "under"; result: string; actual: number;
  storedModelProb: number | null; storedEdge: number | null;
};

function americanProfit(oa: number | null, won: boolean | null): number {
  if (oa == null || won == null) return 0;
  return won ? (oa > 0 ? oa / 100 : 100 / Math.abs(oa)) : -1;
}
// grade a side vs actual total + line. null = push.
function won(side: "over" | "under", actual: number, line: number): boolean | null {
  if (actual === line) return null;
  const over = actual > line;
  return side === "over" ? over : !over;
}
function oddsFor(side: "over" | "under", r: T): number | null {
  return side === "over" ? r.overOdds : r.underOdds;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type Agg = { w: number; l: number; push: number; units: number; staked: number; flips: number; w2l: number; l2w: number; div: number; promoted: { w: number; l: number; units: number; staked: number; n: number } };
function newAgg(): Agg { return { w: 0, l: 0, push: 0, units: 0, staked: 0, flips: 0, w2l: 0, l2w: 0, div: 0, promoted: { w: 0, l: 0, units: 0, staked: 0, n: 0 } }; }
function pct(w: number, l: number): string { const n = w + l; return n ? ((w / n) * 100).toFixed(1) + "%" : "-"; }
function line(name: string, a: Agg): string {
  return `${name.padEnd(26)} ${`${a.w}-${a.l}`.padEnd(8)} ${pct(a.w, a.l).padEnd(7)} ${(a.units >= 0 ? "+" : "") + a.units.toFixed(1)}u/${a.staked}  flips=${a.flips} W→L=${a.w2l} L→W=${a.l2w} div=${a.div}  promoted ${a.promoted.w}-${a.promoted.l} (${pct(a.promoted.w, a.promoted.l)}) ${(a.promoted.units >= 0 ? "+" : "") + a.promoted.units.toFixed(1)}u`;
}

async function main() {
  const { data } = await supabase.from("prediction_records")
    .select(`id, game_id, pick, line_value, odds_american, model_probability, edge, snapshot_json,
      prediction_grades:prediction_grades!prediction_record_id ( result, actual_total )`)
    .eq("sport", "mlb").eq("market", "total").gte("slate_date", "2026-06-01").limit(3000);
  const gameIds = [...new Set(((data ?? []) as any[]).map((r) => r.game_id).filter((v) => typeof v === "number"))];
  const actualByGame = new Map<number, number>();
  for (let i = 0; i < gameIds.length; i += 200) {
    const { data: games } = await supabase
      .from("games")
      .select("id, total_runs")
      .in("id", gameIds.slice(i, i + 200));
    for (const g of (games ?? []) as any[]) {
      const total = num(g.total_runs);
      if (typeof g.id === "number" && total !== null) actualByGame.set(g.id, total);
    }
  }
  const rows: T[] = [];
  for (const r of (data ?? []) as any[]) {
    const a = (r.snapshot_json ?? {}).v2_2_audit ?? {};
    const g = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    if (!g || (g.result !== "win" && g.result !== "loss" && g.result !== "push")) continue;
    const postHome = num(a.posterior_home_runs);
    const postAway = num(a.posterior_away_runs);
    const lineValue = num(r.line_value);
    const actualTotal = num(g.actual_total) ?? actualByGame.get(r.game_id) ?? null;
    if (postHome === null || postAway === null) continue;
    if (lineValue === null || actualTotal === null) continue;
    const pick = String(r.pick).toLowerCase().includes("over") ? "over" : "under";
    rows.push({
      id: Number(r.id), gameId: Number(r.game_id),
      line: lineValue, postHome, postAway,
      marketTotal: num(a.market_total) ?? lineValue,
      marketOver: num(a.ou_market_prob),
      overOdds: a.over_odds_american ?? (pick === "over" ? r.odds_american : null),
      underOdds: a.under_odds_american ?? (pick === "under" ? r.odds_american : null),
      shippedPick: pick, result: g.result, actual: actualTotal,
      storedModelProb: num(a.ou_model_prob) ?? num(r.model_probability),
      storedEdge: num(a.ou_edge_pct) ?? num(r.edge),
    });
  }
  console.log(`graded totals with replayable inputs: ${rows.length}\n`);

  // ---- DIAGNOSIS: is the shipped side raw-Poisson driven? is stored edge regularized? ----
  let reproMatch = 0, edgeIsRaw = 0, edgeBoth = 0;
  for (const r of rows) {
    const raw = overProbabilityPoisson(r.postHome, r.postAway, r.line);
    const rawSide = raw >= 0.5 ? "over" : "under";
    if (rawSide === r.shippedPick) reproMatch++;
    if (r.storedEdge != null && r.marketOver != null && r.storedModelProb != null) {
      edgeBoth++;
      const rawEdge = (r.storedModelProb - r.marketOver) * 100;
      if (Math.abs(rawEdge - r.storedEdge) < 0.2) edgeIsRaw++;
    }
  }
  console.log("=== DIAGNOSIS ===");
  console.log(`  shipped side reproduced by raw Poisson(post runs) >= .5 : ${reproMatch}/${rows.length} (${((reproMatch / rows.length) * 100).toFixed(0)}%)`);
  console.log(`  stored ou_edge_pct == (ou_model_prob - ou_market_prob) [i.e. UN-regularized]: ${edgeIsRaw}/${edgeBoth}`);
  console.log(`     → if ~100%, the promoted edge is the RAW Poisson edge; regularization is NOT reaching grade.\n`);

  // ---- SIDE-SELECTION RULES (actual W/L changes) ----
  const rules: Record<string, (r: T) => "over" | "under"> = {
    "shipped (as-traded)": (r) => r.shippedPick,
    "raw Poisson >= .5": (r) => overProbabilityPoisson(r.postHome, r.postAway, r.line) >= 0.5 ? "over" : "under",
    "mean-aligned (total>line)": (r) => (r.postHome + r.postAway) > r.line ? "over" : "under",
    "market-aligned (mkt>=.5)": (r) => r.marketOver != null ? (r.marketOver >= 0.5 ? "over" : "under") : r.shippedPick,
  };
  console.log("=== SIDE-SELECTION RULES (same graded games) ===");
  for (const [name, fn] of Object.entries(rules)) {
    const a = newAgg();
    for (const r of rows) {
      const side = fn(r);
      const w = won(side, r.actual, r.line);
      if (w === null) { a.push++; } else if (w) a.w++; else a.l++;
      const oa = oddsFor(side, r);
      if (w !== null && oa != null) { a.units += americanProfit(oa, w); a.staked++; }
      if (side !== r.shippedPick) {
        a.flips++;
        const shippedWon = won(r.shippedPick, r.actual, r.line);
        if (shippedWon === true && w === false) a.w2l++;
        if (shippedWon === false && w === true) a.l2w++;
      }
      if ((r.postHome + r.postAway > r.line) !== (side === "over")) a.div++;
    }
    console.log(line(name, a));
  }

  // ---- REGULARIZATION SWEEP (grade/promotion effect; side rarely flips) ----
  console.log("\n=== REGULARIZATION SWEEP (k, capPp) — side from reg P(over) >= .5; promoted = edge gates ===");
  const settings: Array<[string, number, number]> = [
    ["raw (k=1.0,no cap)", 1.0, 100],
    ["current-spec k=0.5,9", 0.5, 9],
    ["k=0.35,cap6", 0.35, 6],
    ["k=0.25,cap5", 0.25, 5],
    ["k=0.15,cap4", 0.15, 4],
    ["k=0.0 (full market)", 0.0, 9],
  ];
  for (const [name, k, cap] of settings) {
    const a = newAgg();
    for (const r of rows) {
      const raw = overProbabilityPoisson(r.postHome, r.postAway, r.line);
      const reg = regularizeProbability({ rawProb: raw, marketProb: r.marketOver, k, maxDistancePp: cap });
      const regOver = reg.regularizedProb ?? raw;
      const side: "over" | "under" = regOver >= 0.5 ? "over" : "under";
      const w = won(side, r.actual, r.line);
      if (w === null) a.push++; else if (w) a.w++; else a.l++;
      const oa = oddsFor(side, r);
      if (w !== null && oa != null) { a.units += americanProfit(oa, w); a.staked++; }
      if (side !== r.shippedPick) {
        a.flips++;
        const sw = won(r.shippedPick, r.actual, r.line);
        if (sw === true && w === false) a.w2l++;
        if (sw === false && w === true) a.l2w++;
      }
      // promoted set: edge for the chosen side after this regularization
      const sideProb = side === "over" ? regOver : 1 - regOver;
      const sideMkt = r.marketOver == null ? null : (side === "over" ? r.marketOver : 1 - r.marketOver);
      const edge = sideMkt == null ? null : (sideProb - sideMkt) * 100;
      if (edge != null && edge >= LEAN) {
        a.promoted.n++;
        if (w !== null) {
          if (w) a.promoted.w++; else a.promoted.l++;
          if (oa != null) { a.promoted.units += americanProfit(oa, w); a.promoted.staked++; }
        }
      }
    }
    console.log(line(name, a));
  }

  console.log("\n=== Best-Angle-tier totals (edge >= 3) count by setting ===");
  for (const [name, k, cap] of settings) {
    let baN = 0, baW = 0, baL = 0, baU = 0;
    for (const r of rows) {
      const raw = overProbabilityPoisson(r.postHome, r.postAway, r.line);
      const reg = regularizeProbability({ rawProb: raw, marketProb: r.marketOver, k, maxDistancePp: cap });
      const regOver = reg.regularizedProb ?? raw;
      const side: "over" | "under" = regOver >= 0.5 ? "over" : "under";
      const sideProb = side === "over" ? regOver : 1 - regOver;
      const sideMkt = r.marketOver == null ? null : (side === "over" ? r.marketOver : 1 - r.marketOver);
      const edge = sideMkt == null ? null : (sideProb - sideMkt) * 100;
      if (edge != null && edge >= BA_OU) {
        baN++;
        const w = won(side, r.actual, r.line);
        const oa = oddsFor(side, r);
        if (w !== null) { if (w) baW++; else baL++; if (oa != null) baU += americanProfit(oa, w); }
      }
    }
    console.log(`  ${name.padEnd(22)} BA-tier n=${String(baN).padStart(3)}  ${baW}-${baL} (${pct(baW, baL)}) ${(baU >= 0 ? "+" : "") + baU.toFixed(1)}u`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
