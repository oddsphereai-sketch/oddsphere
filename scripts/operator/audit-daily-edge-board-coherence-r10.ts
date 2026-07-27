/**
 * Read-only release audit for the MLB Daily Edge r10 board-coherence repair.
 *
 * 1. Totals: evaluate the original probability-side pick when the retired
 *    market-aware rule fired only because the picked side had supporting
 *    split evidence. The retired opposite-side candidate remains rejected.
 * 2. Moneyline: evaluate a 0.10-run projection-noise tolerance for the
 *    already-validated -145..-121 near-market price ladder.
 *
 * No writes, provider calls, or prediction changes.
 */
import { createClient } from "@supabase/supabase-js";

type Json = Record<string, any>;
type Game = {
  id: number;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  total_runs: number | null;
};
type Row = {
  id: number;
  slate_date: string;
  game_id: number;
  matchup: string | null;
  market: string;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  model_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  held: boolean | null;
  snapshot_json: Json | null;
};
type Candidate = {
  id: number;
  date: string;
  matchup: string;
  market: "moneyline" | "total";
  side: string;
  odds: number;
  line: number | null;
  probability: number;
  edgePp: number;
  projectionGap: number | null;
  grade: "lean" | "best_angle";
  result: "win" | "loss" | "push" | "pending";
  units: number;
};

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function lineDirection(snapshot: Json): string {
  return String(snapshot.line_movement?.direction ?? "unknown");
}

function publicConflict(snapshot: Json): boolean {
  return snapshot.public_splits?.conflict === true ||
    snapshot.ml_grade_recalibration?.public_split_conflict === true;
}

function hasSupportingSplit(snapshot: Json, side: string): boolean {
  const rows = Array.isArray(snapshot.signal_rows_at_lock)
    ? snapshot.signal_rows_at_lock
    : [];
  const picked = rows.find(
    (row: Json) => row.market_type === "total" && row.side === side,
  );
  const money = num(picked?.public_money_pct);
  const bets = num(picked?.public_betting_pct);
  return money !== null && bets !== null && money >= 60 && money - bets >= 15;
}

function sameSideMlGap(row: Row): number | null {
  const snapshot = row.snapshot_json ?? {};
  const homeDiff = num(
    snapshot.v2_2_audit?.posterior_home_diff ??
      snapshot.v2_2_audit?.independent_home_diff,
  );
  if (homeDiff === null) return null;
  const side = String(row.pick ?? row.side ?? "").toLowerCase();
  if (side === "home") return homeDiff;
  if (side === "away") return -homeDiff;
  return null;
}

function totalProjection(snapshot: Json): number | null {
  return num(
    snapshot.v2_2_audit?.posterior_total ??
      snapshot.total_projection_reconciliation?.reconciled_total,
  );
}

function sameSideTotalGap(side: string, projected: number | null, line: number | null): number | null {
  if (projected === null || line === null) return null;
  if (side === "over") return projected - line;
  if (side === "under") return line - projected;
  return null;
}

function outcome(game: Game | undefined, market: Candidate["market"], side: string, line: number | null) {
  if (!game || game.home_score === null || game.away_score === null) return "pending" as const;
  if (market === "moneyline") {
    if (game.home_score === game.away_score) return "push" as const;
    const winner = game.home_score > game.away_score ? "home" : "away";
    return winner === side ? "win" as const : "loss" as const;
  }
  if (line === null) return "pending" as const;
  const total = game.total_runs ?? game.home_score + game.away_score;
  if (total === line) return "push" as const;
  const winner = total > line ? "over" : "under";
  return winner === side ? "win" as const : "loss" as const;
}

function profit(result: Candidate["result"], odds: number): number {
  if (result === "loss") return -1;
  if (result !== "win") return 0;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function summarize(rows: Candidate[]) {
  const settled = rows.filter((row) => row.result === "win" || row.result === "loss");
  const wins = settled.filter((row) => row.result === "win").length;
  const losses = settled.filter((row) => row.result === "loss").length;
  const units = settled.reduce((sum, row) => sum + row.units, 0);
  const brier = settled.length
    ? settled.reduce((sum, row) => {
        const y = row.result === "win" ? 1 : 0;
        return sum + (row.probability - y) ** 2;
      }, 0) / settled.length
    : null;
  const logLoss = settled.length
    ? settled.reduce((sum, row) => {
        const y = row.result === "win" ? 1 : 0;
        const p = Math.max(0.001, Math.min(0.999, row.probability));
        return sum - (y * Math.log(p) + (1 - y) * Math.log(1 - p));
      }, 0) / settled.length
    : null;
  const avgProb = settled.length
    ? settled.reduce((sum, row) => sum + row.probability, 0) / settled.length
    : null;
  const winRate = settled.length ? wins / settled.length : null;
  return {
    candidates: rows.length,
    settled: settled.length,
    record: `${wins}-${losses}`,
    units: Number(units.toFixed(4)),
    roiPct: settled.length ? Number((units / settled.length * 100).toFixed(2)) : null,
    brier: brier === null ? null : Number(brier.toFixed(4)),
    logLoss: logLoss === null ? null : Number(logLoss.toFixed(4)),
    calibrationGapPp:
      avgProb === null || winRate === null ? null : Number(((avgProb - winRate) * 100).toFixed(2)),
    byGrade: {
      bestAngle: rows.filter((row) => row.grade === "best_angle").length,
      lean: rows.filter((row) => row.grade === "lean").length,
    },
  };
}

function splitSummary(rows: Candidate[], boundaries: [string, string]) {
  const [validationStart, holdoutStart] = boundaries;
  return {
    train: summarize(rows.filter((row) => row.date < validationStart)),
    validation: summarize(rows.filter((row) => row.date >= validationStart && row.date < holdoutStart)),
    holdout: summarize(rows.filter((row) => row.date >= holdoutStart && row.date <= "2026-07-26")),
    currentBoard: rows
      .filter((row) => row.date === "2026-07-27")
      .map((row) => ({
        matchup: row.matchup,
        side: row.side,
        odds: row.odds,
        probability: row.probability,
        edgePp: row.edgePp,
        projectionGap: row.projectionGap,
        grade: row.grade,
      })),
  };
}

async function main() {
  const rows: Row[] = [];
  for (let from = 0; from < 5000; from += 750) {
    const { data, error } = await sb
      .from("prediction_records")
      .select("id,slate_date,game_id,matchup,market,pick,side,line_value,odds_american,model_probability,market_probability,edge,play_grade,best_angle,no_bet,held,snapshot_json")
      .eq("sport", "mlb")
      .in("market", ["moneyline", "total"])
      .gte("slate_date", "2026-06-01")
      .lte("slate_date", "2026-07-27")
      .order("slate_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 749);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 750) break;
  }
  const gameIds = [...new Set(rows.map((row) => row.game_id))];
  const games: Game[] = [];
  for (let i = 0; i < gameIds.length; i += 500) {
    const response = await sb
      .from("games")
      .select("id,status,home_score,away_score,total_runs")
      .in("id", gameIds.slice(i, i + 500));
    if (response.error) throw response.error;
    games.push(...((response.data ?? []) as Game[]));
  }
  const gameById = new Map(games.map((game) => [game.id, game]));

  const mlTolerance: Candidate[] = [];
  for (const row of rows.filter((candidate) => candidate.market === "moneyline")) {
    const snapshot = row.snapshot_json ?? {};
    const decision = snapshot.decision_pipeline ?? {};
    const dataStatus = snapshot.mlb_data_completeness?.status ?? null;
    const odds = num(row.odds_american);
    const probability = num(row.model_probability);
    const edge = num(row.edge);
    const gap = sameSideMlGap(row);
    const side = String(row.pick ?? row.side ?? "").toLowerCase();
    const exactCurrentHead =
      snapshot.model_layer_versions?.active_probability_head ===
      "mlb_moneyline_regularized_k01_cap6_champion_guardrails_2026_07_11";
    const common =
      exactCurrentHead &&
      (side === "home" || side === "away") &&
      odds !== null && odds >= -145 && odds <= -121 &&
      probability !== null &&
      edge !== null && edge >= -1 && edge < 2 &&
      row.held !== true && row.no_bet !== true &&
      decision.inversion_triggered !== true &&
      decision.pick_calibration_applied !== true &&
      decision.market_aware_correction_applied !== true &&
      dataStatus !== "incomplete_missing_required_data" &&
      lineDirection(snapshot) !== "against_pick" &&
      !publicConflict(snapshot);
    if (!common || gap === null || gap >= 0 || gap < -0.1) continue;
    const grade = odds <= -131 ? "best_angle" : "lean";
    const result = outcome(gameById.get(row.game_id), "moneyline", side, null);
    mlTolerance.push({
      id: row.id,
      date: row.slate_date,
      matchup: row.matchup ?? "",
      market: "moneyline",
      side,
      odds,
      line: null,
      probability,
      edgePp: edge,
      projectionGap: gap,
      grade,
      result,
      units: profit(result, odds),
    });
  }

  const totalSupport: Candidate[] = [];
  for (const row of rows.filter((candidate) => candidate.market === "total" && candidate.slate_date >= "2026-07-11")) {
    const snapshot = row.snapshot_json ?? {};
    const rejection = snapshot.totals_correction_rejection ?? {};
    const correction = snapshot.market_aware_side_correction ?? {};
    const flip = snapshot.ou_flip ?? {};
    const reasons: string[] =
      rejection.market_aware_reasons ??
      correction.reasons ??
      flip.market_aware_reasons ??
      [];
    if (!reasons.includes("total_split_support_fade")) continue;
    const side = String(
      rejection.original_side ??
      correction.original_side ??
      flip.original_pick ??
      snapshot.decision_pipeline?.original_side ??
      "",
    ).toLowerCase();
    const odds = num(
      rejection.original_odds ??
      correction.original_odds ??
      flip.original_odds ??
      row.odds_american,
    );
    const probability = num(
      rejection.original_model_prob ??
      correction.original_model_prob ??
      flip.original_model_prob ??
      snapshot.v2_2_audit?.ou_model_prob,
    );
    const marketProbability = num(
      rejection.original_market_prob ??
      correction.original_market_prob ??
      flip.original_market_prob ??
      snapshot.v2_2_audit?.ou_market_prob,
    );
    const line = num(
      row.line_value ??
      rejection.rejected_candidate_line ??
      flip.line ??
      snapshot.v2_2_audit?.market_total,
    );
    const projected = totalProjection(snapshot);
    const gap = sameSideTotalGap(side, projected, line);
    if (
      (side !== "over" && side !== "under") ||
      odds === null ||
      probability === null ||
      marketProbability === null ||
      line === null ||
      gap === null
    ) continue;
    const edge = (probability - marketProbability) * 100;
    const lean =
      probability >= 0.54 &&
      edge >= 5 &&
      odds > -145 &&
      gap >= 0;
    const bestAngle =
      lean &&
      probability >= 0.57 &&
      edge >= 5 &&
      gap >= 0.75 &&
      odds > -135 &&
      lineDirection(snapshot) !== "against_pick";
    if (!lean) continue;
    const grade = bestAngle ? "best_angle" : "lean";
    const result = outcome(gameById.get(row.game_id), "total", side, line);
    totalSupport.push({
      id: row.id,
      date: row.slate_date,
      matchup: row.matchup ?? "",
      market: "total",
      side,
      odds,
      line,
      probability,
      edgePp: Number(edge.toFixed(3)),
      projectionGap: gap,
      grade,
      result,
      units: profit(result, odds),
    });
  }

  const allCurrentHeadSupportOriginal: Candidate[] = [];
  const allCurrentHeadSupportFlip: Candidate[] = [];
  const allCurrentHeadSupportDetails: Json[] = [];
  for (const row of rows.filter((candidate) => candidate.market === "total")) {
    const snapshot = row.snapshot_json ?? {};
    const rejection = snapshot.totals_correction_rejection ?? {};
    const correction = snapshot.market_aware_side_correction ?? {};
    const flip = snapshot.ou_flip ?? {};
    const side = String(
      rejection.original_side ??
      correction.original_side ??
      flip.original_pick ??
      snapshot.total_projection_reconciliation?.raw_probability_side ??
      snapshot.decision_pipeline?.original_side ??
      row.pick ??
      row.side ??
      "",
    ).toLowerCase();
    const exactCurrentHead =
      snapshot.model_layer_versions?.active_probability_head ===
      "mlb_total_market_read_k04_cap8_thin_gap_guard_2026_07_11";
    if (!exactCurrentHead || !hasSupportingSplit(snapshot, side)) continue;
    const odds = num(
      rejection.original_odds ??
      correction.original_odds ??
      flip.original_odds ??
      snapshot.odds_source_at_lock_ou?.[side]?.odds ??
      row.odds_american,
    );
    const probability = num(
      rejection.original_model_prob ??
      correction.original_model_prob ??
      flip.original_model_prob ??
      snapshot.v2_2_audit?.ou_model_prob,
    );
    const marketProbability = num(
      rejection.original_market_prob ??
      correction.original_market_prob ??
      flip.original_market_prob ??
      snapshot.v2_2_audit?.ou_market_prob,
    );
    const line = num(
      snapshot.odds_source_at_lock_ou?.[side]?.line ??
      row.line_value ??
      flip.line ??
      snapshot.v2_2_audit?.market_total,
    );
    const projected = totalProjection(snapshot);
    const gap = sameSideTotalGap(side, projected, line);
    if (
      (side !== "over" && side !== "under") ||
      odds === null ||
      probability === null ||
      marketProbability === null ||
      line === null ||
      gap === null
    ) continue;
    const edge = (probability - marketProbability) * 100;
    const eligible =
      probability >= 0.54 &&
      edge >= 5 &&
      odds > -145 &&
      gap >= 0 &&
      row.held !== true &&
      snapshot.mlb_data_completeness?.status !== "incomplete_missing_required_data";
    if (!eligible) continue;
    const originalDirection = String(
      correction.original_line_direction ??
      flip.original_line_direction ??
      snapshot.line_movement?.direction ??
      "unknown",
    );
    const bestAngle =
      probability >= 0.57 &&
      gap >= 0.75 &&
      odds > -135 &&
      originalDirection !== "against_pick";
    const grade = bestAngle ? "best_angle" : "lean";
    const originalResult = outcome(gameById.get(row.game_id), "total", side, line);
    allCurrentHeadSupportOriginal.push({
      id: row.id,
      date: row.slate_date,
      matchup: row.matchup ?? "",
      market: "total",
      side,
      odds,
      line,
      probability,
      edgePp: Number(edge.toFixed(3)),
      projectionGap: gap,
      grade,
      result: originalResult,
      units: profit(originalResult, odds),
    });
    const opposite = side === "over" ? "under" : "over";
    const oppositeOdds = num(
      rejection.rejected_candidate_odds ??
      correction.corrected_odds ??
      flip.flipped_odds ??
      snapshot.odds_source_at_lock_ou?.[opposite]?.odds,
    );
    if (oppositeOdds !== null) {
      const flipResult = outcome(gameById.get(row.game_id), "total", opposite, line);
      allCurrentHeadSupportFlip.push({
        id: row.id,
        date: row.slate_date,
        matchup: row.matchup ?? "",
        market: "total",
        side: opposite,
        odds: oppositeOdds,
        line,
        probability,
        edgePp: Number(edge.toFixed(3)),
        projectionGap: gap,
        grade,
        result: flipResult,
        units: profit(flipResult, oppositeOdds),
      });
      allCurrentHeadSupportDetails.push({
        date: row.slate_date,
        matchup: row.matchup,
        originalSide: side,
        originalResult,
        originalOdds: odds,
        oppositeSide: opposite,
        oppositeResult: flipResult,
        oppositeOdds,
        probability,
        edgePp: Number(edge.toFixed(3)),
        projectionGap: Number(gap.toFixed(3)),
        lineDirection: originalDirection,
        grade,
      });
    }
  }

  const current = rows.filter((row) => row.slate_date === "2026-07-27");
  const baseline = {
    moneyline: {
      bestAngle: current.filter((row) => row.market === "moneyline" && row.best_angle === true).length,
      lean: current.filter((row) => row.market === "moneyline" && row.play_grade === "lean").length,
    },
    total: {
      bestAngle: current.filter((row) => row.market === "total" && row.best_angle === true).length,
      lean: current.filter((row) => row.market === "total" && row.play_grade === "lean").length,
      noPlay: current.filter((row) => row.market === "total" && row.no_bet === true).length,
    },
  };

  console.log(JSON.stringify({
    mode: "mlb_daily_edge_board_coherence_r10_audit",
    noWrites: true,
    baseline,
    moneylineProjectionNoiseTolerance: {
      rule: "existing -145..-121 near-market ladder; permit projection same-side gap >= -0.10 instead of >= 0",
      incrementalOnly: splitSummary(mlTolerance, ["2026-07-20", "2026-07-24"]),
    },
    totalSupportingSplitRestoration: {
      rule: "do not trigger retired opposite-side correction from supporting split evidence; original side still must pass existing validated Lean/Best Angle gates",
      combinedSettledThrough2026_07_26: summarize(
        totalSupport.filter((row) => row.date <= "2026-07-26"),
      ),
      eligibleOriginalSideOnly: splitSummary(totalSupport, ["2026-07-18", "2026-07-23"]),
      broaderCurrentHeadConditionCheck: {
        originalSide: splitSummary(
          allCurrentHeadSupportOriginal,
          ["2026-07-13", "2026-07-20"],
        ),
        oppositeSideCounterfactual: splitSummary(
          allCurrentHeadSupportFlip,
          ["2026-07-13", "2026-07-20"],
        ),
        pairedRows: allCurrentHeadSupportDetails,
      },
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
