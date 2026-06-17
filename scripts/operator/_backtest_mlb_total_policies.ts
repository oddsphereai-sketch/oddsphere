/**
 * READ-ONLY backtest of MLB totals side-selection policies.
 *
 * Compares:
 *   A. raw Poisson probability side (current production)
 *   B. mean direction side (projected_total vs line)
 *   C. holistic weighted vote (the proposed 9a4b697 policy)
 *   D. conservative: hold whenever mean/probability/value disagree
 *   E1. tuned mean=1.25 / prob=1.0 / value=1.0
 *   E2. tuned mean=1.5  / prob=1.25 / value=1.0
 *   E3. tuned mean=1.0  / prob=1.0  / value=1.25
 *
 * Inputs are derived from prediction_records.snapshot_json.v2_2_audit
 * (only v2.2 rows are used so all policies see the same model inputs).
 * Outcomes come from games.home_score + away_score.
 *
 * NO DB WRITES. NO PREDICTION REWRITES. Single SELECT against
 * prediction_records JOIN games, then pure computation.
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// ─── Policy implementations (pure) ─────────────────────────────────────

type Side = "over" | "under" | "hold";

type RowInputs = {
  market_total: number;
  posterior_total: number;
  ou_model_prob: number;       // PICKED-side prob from v22 audit
  ou_market_prob: number | null; // PICKED-side market no-vig prob (nullable)
  predicted_ou_side: "over" | "under"; // v22's stored pick
  // Derived OVER-perspective probabilities:
  prob_over: number;
  market_over: number | null;
};

function policyA_rawPoisson(i: RowInputs): Side {
  return i.prob_over >= 0.5 ? "over" : "under";
}

function policyB_meanDirection(i: RowInputs): Side {
  if (i.posterior_total > i.market_total) return "over";
  if (i.posterior_total < i.market_total) return "under";
  return "hold";
}

function valueSideFromOverPp(i: RowInputs): Side | null {
  if (i.market_over === null) return null;
  const overEdge = (i.prob_over - i.market_over) * 100;
  const underEdge = ((1 - i.prob_over) - (1 - i.market_over)) * 100;
  if (overEdge > underEdge) return "over";
  if (underEdge > overEdge) return "under";
  return null;
}

function holisticVote(
  i: RowInputs,
  weights: { mean: number; probability: number; value: number },
): Side {
  // Strength scaling matches totalProjectionReconciliation.ts
  const meanSide: Side = i.posterior_total > i.market_total ? "over" : i.posterior_total < i.market_total ? "under" : "hold";
  const meanStrength = Math.min(1, Math.abs(i.posterior_total - i.market_total) / 1.0);
  const probabilityStrength = Math.min(1, Math.abs(i.prob_over - 0.5) * 2);
  const probSide: Side = policyA_rawPoisson(i);
  const valueSide = valueSideFromOverPp(i);
  let valueStrength = 0;
  if (valueSide !== null && i.market_over !== null) {
    const overEdge = (i.prob_over - i.market_over) * 100;
    const underEdge = ((1 - i.prob_over) - (1 - i.market_over)) * 100;
    const edge = valueSide === "over" ? overEdge : underEdge;
    valueStrength = Math.min(1, Math.abs(edge) / 5.0);
  }
  let over = 0;
  let under = 0;
  if (meanSide === "over") over += meanStrength * weights.mean;
  else if (meanSide === "under") under += meanStrength * weights.mean;
  if (probSide === "over") over += probabilityStrength * weights.probability;
  else under += probabilityStrength * weights.probability;
  if (valueSide === "over") over += valueStrength * weights.value;
  else if (valueSide === "under") under += valueStrength * weights.value;

  if (Math.abs(over - under) < 1e-9) return probSide; // tie → probability
  const holistic: Side = over > under ? "over" : "under";

  // Coherence guard: if mean is non-null and holistic disagrees with mean,
  // revert to mean (matching the proposed reconciler V1 behavior).
  if (meanSide !== "hold" && holistic !== meanSide) return meanSide;
  return holistic;
}

function policyC_proposed(i: RowInputs): Side {
  return holisticVote(i, { mean: 1.5, probability: 1.0, value: 1.0 });
}

function policyD_conservative(i: RowInputs): Side {
  // Hold whenever any pair of (mean, probability, value) disagrees.
  const meanSide = i.posterior_total > i.market_total ? "over" : i.posterior_total < i.market_total ? "under" : "hold";
  const probSide = policyA_rawPoisson(i);
  const valueSide = valueSideFromOverPp(i);
  const sides = [meanSide, probSide, valueSide].filter((s): s is "over" | "under" => s === "over" || s === "under");
  if (sides.length === 0) return "hold";
  const allSame = sides.every((s) => s === sides[0]);
  return allSame ? sides[0] : "hold";
}

function policyE1(i: RowInputs): Side { return holisticVote(i, { mean: 1.25, probability: 1.0, value: 1.0 }); }
function policyE2(i: RowInputs): Side { return holisticVote(i, { mean: 1.5,  probability: 1.25, value: 1.0 }); }
function policyE3(i: RowInputs): Side { return holisticVote(i, { mean: 1.0,  probability: 1.0,  value: 1.25 }); }

const POLICIES: Array<[string, (i: RowInputs) => Side]> = [
  ["A. raw Poisson (production)", policyA_rawPoisson],
  ["B. mean direction only",       policyB_meanDirection],
  ["C. holistic 1.5/1.0/1.0",      policyC_proposed],
  ["D. conservative-hold-on-conflict", policyD_conservative],
  ["E1. holistic 1.25/1.0/1.0",    policyE1],
  ["E2. holistic 1.5/1.25/1.0",    policyE2],
  ["E3. holistic 1.0/1.0/1.25",    policyE3],
];

// ─── Outcome scoring ───────────────────────────────────────────────────

type Outcome = "win" | "loss" | "push" | "hold";

function scoreOutcome(pickedSide: Side, actualTotal: number, line: number): Outcome {
  if (pickedSide === "hold") return "hold";
  if (Math.abs(actualTotal - line) < 1e-9) return "push";
  if (pickedSide === "over") return actualTotal > line ? "win" : "loss";
  return actualTotal < line ? "win" : "loss";
}

// ─── Backtest runner ───────────────────────────────────────────────────

type RowRecord = RowInputs & {
  game_id: number;
  game_date: string;
  actual_total: number;
};

async function main(): Promise<void> {
  console.log("=== MLB totals side-policy backtest (READ-ONLY) ===\n");
  console.log("No DB writes. No prediction rewrites. Pure computation against historical v2.2 audit blobs.\n");

  // Query: prediction_records joined to games, filtered to:
  //   - market = 'total'
  //   - games.sport = 'mlb'
  //   - games.home_score IS NOT NULL (final score recorded)
  //   - snapshot_json.v2_2_audit present
  console.log("Pulling historical sample…");
  // Two-step: (1) get prediction_records, (2) lookup game scores from games.
  const { data: predRows, error: predErr } = await sb
    .from("prediction_records")
    .select("id, game_id, market, snapshot_json, locked_at, created_at")
    .eq("market", "total")
    .not("snapshot_json", "is", null);
  if (predErr) {
    console.error("query failed:", predErr.message);
    process.exit(1);
  }
  console.log(`  prediction_records.market='total' rows: ${predRows?.length ?? 0}`);

  const gameIds = [...new Set((predRows ?? []).map((r) => r.game_id))];
  if (gameIds.length === 0) {
    console.log("\nNo rows. Exiting.");
    process.exit(0);
  }
  // Pull games in chunks if needed (supabase IN limits).
  console.log(`  fetching scores for ${gameIds.length} distinct games…`);
  const gameById = new Map<number, { sport: string; home_score: number | null; away_score: number | null; game_date: string; status: string }>();
  const CHUNK = 200;
  for (let i = 0; i < gameIds.length; i += CHUNK) {
    const chunk = gameIds.slice(i, i + CHUNK);
    const { data, error } = await sb
      .from("games")
      .select("id, sport, home_score, away_score, game_date, status")
      .in("id", chunk);
    if (error) {
      console.error("games chunk error:", error.message);
      process.exit(1);
    }
    for (const g of data ?? []) gameById.set(g.id, g as never);
  }

  // Build the unified row set.
  const rows: RowRecord[] = [];
  let dropped_non_mlb = 0;
  let dropped_no_score = 0;
  let dropped_no_v22 = 0;
  let dropped_missing_inputs = 0;

  for (const p of (predRows ?? []) as Array<{ id: number; game_id: number; snapshot_json: Record<string, unknown> | null }>) {
    const g = gameById.get(p.game_id);
    if (g === undefined) { dropped_no_score++; continue; }
    if (g.sport !== "mlb") { dropped_non_mlb++; continue; }
    if (g.home_score === null || g.away_score === null) { dropped_no_score++; continue; }
    const snap = p.snapshot_json ?? {};
    const v22 = (snap as { v2_2_audit?: Record<string, unknown> }).v2_2_audit;
    if (!v22 || typeof v22 !== "object") { dropped_no_v22++; continue; }
    const market_total = (v22 as { market_total?: number }).market_total ?? null;
    const posterior_total = (v22 as { posterior_total?: number }).posterior_total ?? null;
    const ou_model_prob = (v22 as { ou_model_prob?: number }).ou_model_prob ?? null;
    const ou_market_prob = (v22 as { ou_market_prob?: number | null }).ou_market_prob ?? null;
    if (
      typeof market_total !== "number" ||
      typeof posterior_total !== "number" ||
      typeof ou_model_prob !== "number"
    ) { dropped_missing_inputs++; continue; }
    const predicted_ou_side = ((snap as { decision?: { pick?: string } }).decision?.pick ?? null) as "over" | "under" | null;
    // The v22 ou_model_prob is for the picked side; derive over-perspective.
    // If v22 audit has predicted_ou_side encoded; if not, fall back to (prob >= 0.5).
    // The cleanest path: ou_model_prob is per design "PICKED side prob"; we have to know which side was picked.
    // Strategy: use v22's stored predicted_ou_side if present; otherwise infer from ou_model_prob convention.
    // Looking at mlbAutoModelV2_2.ts: ou_model_prob = ouPickIsOver ? ouOverProb : (1 - ouOverProb).
    // So if predicted side known: prob_over = picked==over ? ou_model_prob : 1 - ou_model_prob.
    // If unknown, fall back: ouOverProb such that ou_model_prob >= 0.5 ⇒ probability for "picked side."
    //   If picked is over: prob_over = ou_model_prob (≥ 0.5).
    //   If picked is under: prob_over = 1 - ou_model_prob (≤ 0.5).
    // Without the pick we cannot disambiguate. v22 audit doesn't separately store ou_pick_is_over;
    // but the model writes predicted_ou_side onto game_predictions, not prediction_records.
    // For the backtest we'll fall back to the convention: ou_model_prob is the picked-side prob,
    // and we derive ouOverProb from the sign of posterior_total - market_total when picked-side
    // is ambiguous. This is a conservative inference: the picked side is whichever direction
    // v2.2's argmax-Poisson would have chosen, which equals raw_probability_side. We don't have
    // ouOverProb cleanly; reconstruct from the model's actual selector:
    //   ouPickIsOver = ouOverProb >= 0.5
    //   ou_model_prob = ouPickIsOver ? ouOverProb : 1 - ouOverProb
    // ⇒ ouOverProb = ou_model_prob OR 1 - ou_model_prob.
    // The two branches: max(ou_model_prob, 1-ou_model_prob) and min(...). We cannot tell which.
    // Workaround: also pull game_predictions.predicted_ou_side for this game to resolve.
    // (Do it in batch below.)
    rows.push({
      game_id: p.game_id,
      game_date: g.game_date,
      actual_total: g.home_score + g.away_score,
      market_total,
      posterior_total,
      ou_model_prob,
      ou_market_prob,
      predicted_ou_side: (predicted_ou_side === "over" || predicted_ou_side === "under") ? predicted_ou_side : "over",
      // Provisional — fixed in the next step.
      prob_over: 0.5,
      market_over: null,
    });
  }

  // Resolve OVER-perspective probabilities by joining to game_predictions.predicted_ou_side.
  const uniqueGameIds = [...new Set(rows.map((r) => r.game_id))];
  console.log(`  resolving picked side from game_predictions for ${uniqueGameIds.length} games…`);
  const pickedById = new Map<number, "over" | "under">();
  for (let i = 0; i < uniqueGameIds.length; i += CHUNK) {
    const chunk = uniqueGameIds.slice(i, i + CHUNK);
    const { data, error } = await sb
      .from("game_predictions")
      .select("game_id, predicted_ou_side")
      .in("game_id", chunk);
    if (error) { console.error("game_predictions error:", error.message); process.exit(1); }
    for (const r of data ?? []) {
      if (r.predicted_ou_side === "over" || r.predicted_ou_side === "under") pickedById.set(r.game_id, r.predicted_ou_side);
    }
  }

  // Now rebase prob_over and market_over.
  let dropped_no_picked = 0;
  const finalRows: RowRecord[] = [];
  for (const r of rows) {
    const picked = pickedById.get(r.game_id);
    if (picked === undefined) { dropped_no_picked++; continue; }
    const prob_over = picked === "over" ? r.ou_model_prob : 1 - r.ou_model_prob;
    const market_over = r.ou_market_prob === null
      ? null
      : (picked === "over" ? r.ou_market_prob : 1 - r.ou_market_prob);
    finalRows.push({ ...r, predicted_ou_side: picked, prob_over, market_over });
  }

  console.log("\n── Sample funnel ──");
  console.log(`  prediction_records.market='total':         ${predRows?.length ?? 0}`);
  console.log(`  − dropped non-MLB:                          ${dropped_non_mlb}`);
  console.log(`  − dropped without final score:              ${dropped_no_score}`);
  console.log(`  − dropped without v2_2_audit:               ${dropped_no_v22}`);
  console.log(`  − dropped missing market/posterior/prob:    ${dropped_missing_inputs}`);
  console.log(`  − dropped no game_predictions picked side:  ${dropped_no_picked}`);
  console.log(`  ───────────────────────────────────────────`);
  console.log(`  usable backtest rows:                       ${finalRows.length}`);

  if (finalRows.length === 0) {
    console.log("\nEmpty backtest sample. Cannot evaluate policies.");
    process.exit(0);
  }

  const dates = finalRows.map((r) => r.game_date).sort();
  console.log(`  date range: ${dates[0]?.slice(0, 10)} → ${dates[dates.length - 1]?.slice(0, 10)}`);

  // ─── Policy evaluation ─────────────────────────────────────────────
  type PolicyStats = {
    name: string;
    picks: { over: number; under: number; hold: number };
    outcomes: { win: number; loss: number; push: number; hold: number };
    flips_vs_production: number;
    by_confidence: { high: { w: number; l: number }; mid: { w: number; l: number }; low: { w: number; l: number } };
  };

  function newStats(name: string): PolicyStats {
    return {
      name,
      picks: { over: 0, under: 0, hold: 0 },
      outcomes: { win: 0, loss: 0, push: 0, hold: 0 },
      flips_vs_production: 0,
      by_confidence: { high: { w: 0, l: 0 }, mid: { w: 0, l: 0 }, low: { w: 0, l: 0 } },
    };
  }

  const stats: PolicyStats[] = POLICIES.map(([n]) => newStats(n));
  const productionStats = stats[0];

  // Subgroup counters
  let disagreement_mean_vs_prob = 0;
  let disagreement_value_vs_prob = 0;
  const subgroupStats = {
    mean_vs_prob_disagree: POLICIES.map(([n]) => newStats(`${n} | mean vs prob disagree`)),
    value_vs_prob_disagree: POLICIES.map(([n]) => newStats(`${n} | value vs prob disagree`)),
  };

  for (const r of finalRows) {
    const productionPick = policyA_rawPoisson(r);
    const meanSide = policyB_meanDirection(r);
    const valueSide = valueSideFromOverPp(r);
    const meanVsProb = meanSide !== "hold" && meanSide !== productionPick;
    const valueVsProb = valueSide !== null && valueSide !== productionPick;
    if (meanVsProb) disagreement_mean_vs_prob++;
    if (valueVsProb) disagreement_value_vs_prob++;

    POLICIES.forEach(([, fn], idx) => {
      const pick = fn(r);
      const s = stats[idx];
      s.picks[pick]++;
      const o = scoreOutcome(pick, r.actual_total, r.market_total);
      s.outcomes[o]++;
      if (pick !== productionPick && pick !== "hold") s.flips_vs_production++;

      // Confidence band (raw prob of the chosen side)
      if (pick === "over" || pick === "under") {
        const p = pick === "over" ? r.prob_over : 1 - r.prob_over;
        const bandKey: keyof PolicyStats["by_confidence"] = p >= 0.55 ? "high" : p >= 0.50 ? "mid" : "low";
        if (o === "win") s.by_confidence[bandKey].w++;
        else if (o === "loss") s.by_confidence[bandKey].l++;
      }

      if (meanVsProb) {
        const ss = subgroupStats.mean_vs_prob_disagree[idx];
        ss.picks[pick]++;
        ss.outcomes[o]++;
      }
      if (valueVsProb) {
        const ss = subgroupStats.value_vs_prob_disagree[idx];
        ss.picks[pick]++;
        ss.outcomes[o]++;
      }
    });
  }

  // Render
  function pct(n: number, d: number): string {
    if (d === 0) return "—";
    return ((n / d) * 100).toFixed(1) + "%";
  }

  function renderTable(rows: PolicyStats[]): void {
    console.log(`\n  Policy                                   Picks(O/U/H)        W-L-P-H         Accuracy   HighConf  MidConf   LowConf   Flips`);
    console.log(`  ${"─".repeat(126)}`);
    for (const s of rows) {
      const total = s.outcomes.win + s.outcomes.loss; // push and hold excluded from accuracy denominator
      const acc = pct(s.outcomes.win, total);
      const hi = pct(s.by_confidence.high.w, s.by_confidence.high.w + s.by_confidence.high.l);
      const mid = pct(s.by_confidence.mid.w, s.by_confidence.mid.w + s.by_confidence.mid.l);
      const lo = pct(s.by_confidence.low.w, s.by_confidence.low.w + s.by_confidence.low.l);
      const picks = `${s.picks.over}/${s.picks.under}/${s.picks.hold}`.padEnd(20);
      const outs = `${s.outcomes.win}-${s.outcomes.loss}-${s.outcomes.push}-${s.outcomes.hold}`.padEnd(16);
      const name = s.name.padEnd(40);
      console.log(`  ${name} ${picks}${outs}${acc.padEnd(11)}${hi.padEnd(10)}${mid.padEnd(10)}${lo.padEnd(10)}${s.flips_vs_production}`);
    }
  }

  console.log("\n──────────────────────────────────────────────────────────────────────");
  console.log("  Aggregate accuracy (push + hold excluded from denominator)");
  console.log("──────────────────────────────────────────────────────────────────────");
  renderTable(stats);

  console.log(`\n──────────────────────────────────────────────────────────────────────`);
  console.log(`  Subgroup: mean direction disagrees with raw probability  (n=${disagreement_mean_vs_prob})`);
  console.log(`──────────────────────────────────────────────────────────────────────`);
  renderTable(subgroupStats.mean_vs_prob_disagree);

  console.log(`\n──────────────────────────────────────────────────────────────────────`);
  console.log(`  Subgroup: value side disagrees with raw probability       (n=${disagreement_value_vs_prob})`);
  console.log(`──────────────────────────────────────────────────────────────────────`);
  renderTable(subgroupStats.value_vs_prob_disagree);

  console.log("\n── MIA/PIT-style cases: posterior 0.0–0.5 above line, raw prob narrowly under ──");
  let cnt_mp = 0, win_mean = 0, loss_mean = 0, win_prob = 0, loss_prob = 0, win_holistic = 0, loss_holistic = 0;
  for (const r of finalRows) {
    const diff = r.posterior_total - r.market_total;
    if (diff > 0 && diff < 0.5 && r.prob_over < 0.5 && r.prob_over > 0.45) {
      cnt_mp++;
      const a = scoreOutcome(policyA_rawPoisson(r), r.actual_total, r.market_total);
      const b = scoreOutcome(policyB_meanDirection(r), r.actual_total, r.market_total);
      const c = scoreOutcome(policyC_proposed(r), r.actual_total, r.market_total);
      if (a === "win") win_prob++; else if (a === "loss") loss_prob++;
      if (b === "win") win_mean++; else if (b === "loss") loss_mean++;
      if (c === "win") win_holistic++; else if (c === "loss") loss_holistic++;
    }
  }
  console.log(`  matches (posterior 0–0.5 over line, raw prob 0.45–0.50): n=${cnt_mp}`);
  console.log(`    Policy A raw Poisson (under):       ${win_prob}W ${loss_prob}L  ${pct(win_prob, win_prob + loss_prob)}`);
  console.log(`    Policy B mean direction (over):     ${win_mean}W ${loss_mean}L  ${pct(win_mean, win_mean + loss_mean)}`);
  console.log(`    Policy C holistic 1.5/1.0/1.0:      ${win_holistic}W ${loss_holistic}L  ${pct(win_holistic, win_holistic + loss_holistic)}`);

  console.log("\n=== end backtest ===\n");
}

main().then(() => process.exit(0), (e) => { console.error("FATAL:", e); process.exit(1); });
