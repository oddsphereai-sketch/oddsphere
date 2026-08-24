/**
 * Read-only audit of MLB moneyline signed-resistance and movement cliffs.
 *
 * This script never invokes a writer and never mutates production. It uses one
 * final locked tuple per game, the exact evaluated price stored on that tuple,
 * and the stored settled result/CLV fields.
 */

import { supabase } from "../../lib/db/supabase";

type Row = {
  id: number;
  game_id: number;
  slate_date: string;
  matchup: string;
  side: string | null;
  pick: string | null;
  odds_american: number | null;
  model_probability: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  locked_at: string | null;
  calibration_version: string | null;
  snapshot_json: unknown;
  prediction_grades?: unknown;
};

type AuditRow = {
  source: Row;
  result: "win" | "loss" | "push" | null;
  release: string | null;
  probabilityHead: string | null;
  baselineAction: boolean;
  reasons: string[];
  signedGap: number | null;
  lineDirection: string | null;
  movementPp: number | null;
  projectionGap: number | null;
  publicConflict: boolean;
  dataBlocked: boolean;
  ev: number | null;
  priorSameSideAction: boolean;
  clvBeat: boolean | null;
};

type Candidate = { name: string; qualifies: (row: AuditRow) => boolean };

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function result(value: unknown): AuditRow["result"] {
  const grade = Array.isArray(value) ? object(value[0]) : object(value);
  const normalized = String(grade.result ?? "").toLowerCase();
  return normalized === "win" || normalized === "loss" || normalized === "push"
    ? normalized
    : null;
}

function oneUnit(odds: number | null, outcome: AuditRow["result"]): number | null {
  if (odds === null || (outcome !== "win" && outcome !== "loss")) return null;
  if (outcome === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function breakEven(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function window(date: string): "development" | "validation" | "holdout" | "current" {
  if (date <= "2026-08-14") return "development";
  if (date <= "2026-08-19") return "validation";
  if (date <= "2026-08-22") return "holdout";
  return "current";
}

function summarize(rows: AuditRow[]) {
  const settled = rows.filter((row) => row.result === "win" || row.result === "loss");
  const wins = settled.filter((row) => row.result === "win");
  const losses = settled.filter((row) => row.result === "loss");
  const units = settled.map((row) => oneUnit(row.source.odds_american, row.result))
    .filter((value): value is number => value !== null);
  const largestWin = Math.max(0, ...wins.map((row) => oneUnit(row.source.odds_american, row.result) ?? 0));
  const probabilities = settled.map((row) => row.source.model_probability)
    .filter((value): value is number => value !== null);
  const clv = rows.map((row) => row.clvBeat).filter((value): value is boolean => value !== null);
  const totalUnits = units.reduce((sum, value) => sum + value, 0);
  const observed = settled.length ? wins.length / settled.length : null;
  const expected = probabilities.length
    ? probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length
    : null;
  return {
    n: rows.length,
    settled: settled.length,
    record: `${wins.length}-${losses.length}`,
    units: Number(totalUnits.toFixed(3)),
    roiPct: units.length ? Number((100 * totalUnits / units.length).toFixed(2)) : null,
    unitsWithoutLargestWin: Number((totalUnits - largestWin).toFixed(3)),
    observedWinPct: observed === null ? null : Number((100 * observed).toFixed(2)),
    expectedWinPct: expected === null ? null : Number((100 * expected).toFixed(2)),
    calibrationGapPp: observed === null || expected === null
      ? null
      : Number((100 * (observed - expected)).toFixed(2)),
    clvN: clv.length,
    clvBeatPct: clv.length
      ? Number((100 * clv.filter(Boolean).length / clv.length).toFixed(2))
      : null,
  };
}

function auditRow(row: Row): AuditRow {
  const snapshot = object(row.snapshot_json);
  const decision = object(snapshot.decision_pipeline);
  const resistance = object(snapshot.ml_signed_market_resistance_standdown);
  const correction = object(snapshot.champion_candidate_correction);
  const movement = object(snapshot.line_movement);
  const recalibration = object(snapshot.ml_grade_recalibration);
  const completeness = object(snapshot.mlb_data_completeness);
  const missingFields = Array.isArray(completeness.missing_fields)
    ? completeness.missing_fields.filter((value): value is string => typeof value === "string")
    : [];
  const moneylineRequiredFields = new Set([
    "home_team_mapped",
    "away_team_mapped",
    "start_time",
    "ml_pick",
    "projected_home_score",
    "projected_away_score",
    "home_moneyline_price",
    "away_moneyline_price",
    "home_probable_pitcher",
    "away_probable_pitcher",
  ]);
  const layerVersions = object(snapshot.model_layer_versions);
  const closing = object(snapshot.closing_line_value);
  const reasons = Array.isArray(correction.reasons)
    ? correction.reasons.filter((value): value is string => typeof value === "string")
    : [];
  const probability = row.model_probability;
  const priceBreakEven = breakEven(row.odds_american);
  const history = Array.isArray(snapshot.prediction_grade_history_v1)
    ? snapshot.prediction_grade_history_v1.map(object)
    : [];
  const prior = history.at(-1);
  const priorGrade = string(prior?.play_grade);
  return {
    source: row,
    result: result(row.prediction_grades),
    release: string(decision.release_id),
    probabilityHead: string(layerVersions.moneyline_probability_head),
    baselineAction: decision.board_action === "bet",
    reasons,
    signedGap: number(resistance.money_over_tickets_gap),
    lineDirection: string(movement.direction) ?? string(movement.line_direction),
    movementPp: number(movement.magnitude_pp) ?? number(movement.magnitude),
    projectionGap: number(recalibration.same_side_projection_gap),
    publicConflict: recalibration.public_split_conflict === true,
    // The global card status also includes total-only fields. A missing total
    // price is not a missing moneyline input and must not contaminate this
    // market-specific counterfactual.
    dataBlocked: missingFields.some((field) => moneylineRequiredFields.has(field)),
    ev: probability === null || priceBreakEven === null || row.odds_american === null
      ? null
      : probability * (row.odds_american > 0 ? row.odds_american / 100 : 100 / Math.abs(row.odds_american)) - (1 - probability),
    priorSameSideAction:
      prior !== undefined
      && prior.pick === row.pick
      && prior.side === row.side
      && (prior.best_angle === true || priorGrade === "best_angle" || priorGrade === "lean"),
    clvBeat:
      typeof closing.beat_closing_line === "boolean"
        ? closing.beat_closing_line
        : typeof closing.beatClosingLine === "boolean"
          ? closing.beatClosingLine
          : null,
  };
}

function onlyReasons(row: AuditRow, allowed: string[]): boolean {
  return row.reasons.length > 0 && row.reasons.every((reason) => allowed.includes(reason));
}

function common(row: AuditRow): boolean {
  const probability = row.source.model_probability;
  const odds = row.source.odds_american;
  return !row.baselineAction
    && probability !== null
    && odds !== null
    && odds >= -300
    && odds <= 200
    && row.projectionGap !== null
    && row.projectionGap >= 0
    && !row.publicConflict
    && !row.dataBlocked;
}

async function load(dateFrom: string, dateTo: string): Promise<Row[]> {
  const result = await supabase
    .from("prediction_records")
    .select("id,game_id,slate_date,matchup,side,pick,odds_american,model_probability,play_grade,best_angle,no_bet,locked_at,calibration_version,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(result)")
    .eq("sport", "mlb")
    .eq("market", "moneyline")
    .gte("slate_date", dateFrom)
    .lte("slate_date", dateTo)
    .not("locked_at", "is", null)
    .order("slate_date", { ascending: true })
    .limit(1000);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as Row[];
}

async function main() {
  const rows = (await load("2026-08-10", "2026-08-23")).map(auditRow);
  const signedRule = "ml_signed_money_below_tickets_standdown_v1_2026_08_10";
  const movementRule = "line_movement_against_pick";
  const candidates: Candidate[] = [];
  for (const threshold of [15, 20, 25, 30]) {
    candidates.push({
      name: `signed_gap_gt_minus_${threshold}`,
      qualifies: (row) => common(row)
        && onlyReasons(row, [signedRule])
        && row.priorSameSideAction
        && row.signedGap !== null
        && row.signedGap > -threshold,
    });
  }
  for (const floor of [0.60, 0.58, 0.57, 0.55]) {
    candidates.push({
      name: `strong_winner_floor_${Math.round(floor * 100)}`,
      qualifies: (row) => common(row)
        && onlyReasons(row, [signedRule])
        && (row.source.model_probability ?? 0) >= floor
        && row.lineDirection !== "against_pick",
    });
  }
  for (const tolerance of [0.5, 1, 1.5, 2]) {
    candidates.push({
      name: `adverse_only_tolerance_${tolerance.toFixed(1)}`,
      qualifies: (row) => common(row)
        && onlyReasons(row, [movementRule])
        && row.priorSameSideAction
        && row.ev !== null
        && row.ev >= 0
        && row.lineDirection === "against_pick"
        && row.movementPp !== null
        && row.movementPp <= tolerance,
    });
  }
  const combined = (row: AuditRow) => common(row)
    && onlyReasons(row, [signedRule, movementRule])
    && (row.source.model_probability ?? 0) >= 0.58
    && row.ev !== null
    && row.ev >= 0
    && (row.signedGap === null || row.signedGap > -15)
    && (row.lineDirection !== "against_pick" || (row.movementPp ?? Infinity) <= 1);
  candidates.push({ name: "combined_58_gap15_move1", qualifies: combined });
  candidates.push({
    name: "combined_58_gap15_move1_prior_action_hysteresis",
    qualifies: (row) => combined(row) && row.priorSameSideAction,
  });

  const candidateResults = Object.fromEntries(candidates.map((candidate) => {
    const qualified = rows.filter(candidate.qualifies);
    return [candidate.name, {
      total: summarize(qualified),
      byWindow: Object.fromEntries(["development", "validation", "holdout", "current"].map((name) => [
        name,
        summarize(qualified.filter((row) => window(row.source.slate_date) === name)),
      ])),
      byRelease: Object.fromEntries([...new Set(qualified.map((row) => row.release ?? "missing"))].map((release) => [
        release,
        summarize(qualified.filter((row) => (row.release ?? "missing") === release)),
      ])),
      currentBoardPromotions: qualified
        .filter((row) => window(row.source.slate_date) === "current")
        .map((row) => ({
          matchup: row.source.matchup,
          pick: row.source.pick,
          probability: row.source.model_probability,
          price: row.source.odds_american,
          signedGap: row.signedGap,
          direction: row.lineDirection,
          movementPp: row.movementPp,
        })),
      promotions: qualified.length,
      demotions: 0,
    }];
  }));

  const current = rows.filter((row) => window(row.source.slate_date) === "current");
  const invariantDefects = current.filter((row) =>
    row.source.best_angle === true
    && (row.source.play_grade !== "best_angle" || !row.baselineAction),
  );
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    rowCount: rows.length,
    settledCount: rows.filter((row) => row.result !== null).length,
    baseline: {
      currentActionCount: current.filter((row) => row.baselineAction).length,
      currentNonActionCount: current.filter((row) => !row.baselineAction).length,
      signedStandDownCount: current.filter((row) => row.reasons.includes(signedRule)).length,
      movementStandDownCount: current.filter((row) => row.reasons.includes(movementRule)).length,
    },
    invariantDefects: invariantDefects.map((row) => ({
      matchup: row.source.matchup,
      playGrade: row.source.play_grade,
      bestAngle: row.source.best_angle,
      boardAction: row.baselineAction ? "bet" : "no_play",
      dataBlocked: row.dataBlocked,
    })),
    candidates: candidateResults,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
