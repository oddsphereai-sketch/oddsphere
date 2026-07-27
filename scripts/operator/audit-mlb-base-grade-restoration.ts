/**
 * Read-only audit for restoring the calibrated MLB model's own Best Angle and
 * Lean grades as a primary actionability path. Named promotion rules remain
 * additive; this report isolates candidates suppressed only by the later
 * whitelist/recalibration layer.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-mlb-base-grade-restoration.ts
 */

import { supabase } from "../../lib/db/supabase";
import { MLB_MODEL_LAYER_VERSION_IDS } from "../../lib/automodel/mlbModelLayerVersions";

type Row = Record<string, any>;
type Result = "win" | "loss" | "push";

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function relation(row: Row): Row | null {
  const value = row.prediction_grades;
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function result(row: Row): Result | null {
  const value = String(relation(row)?.result ?? "").toLowerCase();
  return value === "win" || value === "loss" || value === "push" ? value : null;
}

function profit(outcome: Result, odds: number | null): number | null {
  if (outcome === "push") return 0;
  if (odds === null || odds === 0) return null;
  if (outcome === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function metrics(rows: Row[]) {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let units = 0;
  let priced = 0;
  let probabilityRows = 0;
  let probabilitySum = 0;
  let outcomeSum = 0;
  let brier = 0;
  let logLoss = 0;
  for (const row of rows) {
    const settled = result(row);
    if (settled === null) continue;
    if (settled === "win") wins++;
    else if (settled === "loss") losses++;
    else pushes++;
    const rowProfit = profit(settled, finite(row.odds_american));
    if (rowProfit !== null) {
      units += rowProfit;
      priced++;
    }
    const probability = finite(row.model_probability);
    if (settled !== "push" && probability !== null && probability > 0 && probability < 1) {
      const observed = settled === "win" ? 1 : 0;
      const p = Math.min(0.999, Math.max(0.001, probability));
      probabilityRows++;
      probabilitySum += probability;
      outcomeSum += observed;
      brier += (probability - observed) ** 2;
      logLoss -= observed * Math.log(p) + (1 - observed) * Math.log(1 - p);
    }
  }
  const decisions = wins + losses;
  return {
    candidates: rows.length,
    settled: wins + losses + pushes,
    record: `${wins}-${losses}${pushes ? `-${pushes}` : ""}`,
    units: Number(units.toFixed(3)),
    roiPct: priced ? Number((units / priced * 100).toFixed(1)) : null,
    winRatePct: decisions ? Number((wins / decisions * 100).toFixed(1)) : null,
    probability: probabilityRows
      ? {
          mean: Number((probabilitySum / probabilityRows).toFixed(4)),
          observed: Number((outcomeSum / probabilityRows).toFixed(4)),
          calibrationGapPp: Number(
            ((probabilitySum - outcomeSum) / probabilityRows * 100).toFixed(1),
          ),
          brier: Number((brier / probabilityRows).toFixed(4)),
          logLoss: Number((logLoss / probabilityRows).toFixed(4)),
        }
      : null,
  };
}

function split(rows: Row[]) {
  return {
    train: metrics(rows.filter((row) => row.slate_date >= "2026-07-11" && row.slate_date <= "2026-07-17")),
    validation: metrics(rows.filter((row) => row.slate_date >= "2026-07-18" && row.slate_date <= "2026-07-22")),
    untouchedHoldout: metrics(rows.filter((row) => row.slate_date >= "2026-07-23")),
    combined: metrics(rows),
  };
}

function layer(row: Row): Row {
  return row.snapshot_json?.model_layer_versions ?? {};
}

function currentHead(row: Row): boolean {
  const head = layer(row).active_probability_head;
  return row.market === "moneyline"
    ? head === MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head
    : row.market === "total"
      ? head === MLB_MODEL_LAYER_VERSION_IDS.total_probability_head
      : false;
}

function finalSideUnchanged(row: Row): boolean {
  return row.snapshot_json?.decision_pipeline?.final_side_changed !== true;
}

function mlBaseBestAngleSuppressed(row: Row): boolean {
  const resolution = row.snapshot_json?.best_angle_resolution;
  return (
    row.market === "moneyline" &&
    resolution?.base_eligible === true &&
    resolution?.demote_reason == null &&
    resolution?.broad_best_angle_demoted_by_recalibration === true &&
    row.best_angle !== true &&
    row.no_bet !== true &&
    finalSideUnchanged(row)
  );
}

function expectedValue(row: Row): number | null {
  const probability = finite(row.model_probability);
  const odds = finite(row.odds_american);
  if (probability === null || odds === null || odds === 0) return null;
  const winProfit = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  return probability * winProfit - (1 - probability);
}

function mlBaseLeanSuppressed(row: Row): boolean {
  const recalibration = row.snapshot_json?.ml_grade_recalibration;
  const probability = finite(recalibration?.model_prob ?? row.model_probability);
  const projectionGap = finite(recalibration?.same_side_projection_gap);
  const ev = expectedValue(row);
  const safeExistingGate =
    probability !== null &&
    probability >= 0.55 &&
    ev !== null &&
    ev >= 0 &&
    (projectionGap === null || Math.abs(projectionGap) >= 0.5) &&
    recalibration?.public_split_conflict !== true;
  return (
    row.market === "moneyline" &&
    recalibration?.original_public_play_grade === "lean" &&
    row.play_grade !== "lean" &&
    row.best_angle !== true &&
    row.no_bet !== true &&
    finalSideUnchanged(row) &&
    safeExistingGate
  );
}

function totalBaseBestAngleSuppressed(row: Row): boolean {
  const resolution = row.snapshot_json?.best_angle_resolution;
  return (
    row.market === "total" &&
    resolution?.base_eligible === true &&
    (resolution?.demote_reason === "total_over_quality_gate" ||
      resolution?.demote_reason === "total_under_quality_gate") &&
    row.best_angle !== true &&
    row.no_bet !== true &&
    finalSideUnchanged(row)
  );
}

function totalBaseLeanSuppressed(row: Row): boolean {
  const cap = row.snapshot_json?.total_lean_recalibration_cap;
  return (
    row.market === "total" &&
    cap?.action === "cap_to_watchlist" &&
    row.snapshot_json?.total_lean_projection_gap_cap == null &&
    row.snapshot_json?.total_lean_market_friction_cap == null &&
    row.no_bet !== true &&
    finalSideUnchanged(row)
  );
}

function candidateSummary(rows: Row[]) {
  return rows.map((row) => ({
    id: row.id,
    date: row.slate_date,
    gameId: row.game_id,
    market: row.market,
    pick: row.pick,
    odds: row.odds_american,
    probability: row.model_probability,
    edge: row.edge,
    finalGrade: row.best_angle === true ? "best_angle" : row.play_grade,
    result: result(row) ?? "pending",
  }));
}

async function loadRows(): Promise<Row[]> {
  const output: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select([
        "id",
        "game_id",
        "slate_date",
        "market",
        "pick",
        "odds_american",
        "model_probability",
        "market_probability",
        "edge",
        "play_grade",
        "best_angle",
        "no_bet",
        "held",
        "locked_at",
        "launch_day",
        "snapshot_json",
        "prediction_grades(result)",
      ].join(","))
      .eq("sport", "mlb")
      .in("market", ["moneyline", "total"])
      .gte("slate_date", "2026-07-11")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    output.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) return output;
  }
}

async function main() {
  const rows = (await loadRows()).filter(
    (row) => row.launch_day !== true && row.held !== true && currentHead(row),
  );
  const settled = rows.filter((row) => row.locked_at != null && result(row) !== null);
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const current = rows.filter((row) => row.slate_date === currentDate && row.locked_at == null);
  const families = {
    moneylineBaseBestAngle: {
      settled: settled.filter(mlBaseBestAngleSuppressed),
      current: current.filter(mlBaseBestAngleSuppressed),
    },
    moneylineBaseLean: {
      settled: settled.filter(mlBaseLeanSuppressed),
      current: current.filter(mlBaseLeanSuppressed),
    },
    totalBaseBestAngle: {
      settled: settled.filter(totalBaseBestAngleSuppressed),
      current: current.filter(totalBaseBestAngleSuppressed),
    },
    totalBaseLean: {
      settled: settled.filter(totalBaseLeanSuppressed),
      current: current.filter(totalBaseLeanSuppressed),
    },
  };
  console.log(JSON.stringify({
    mode: "read_only_mlb_base_grade_restoration_audit",
    noWrites: true,
    splitPolicy: {
      train: "2026-07-11..2026-07-17",
      validation: "2026-07-18..2026-07-22",
      untouchedHoldout: "2026-07-23..latest settled",
    },
    population: {
      currentHeadRows: rows.length,
      settledRows: settled.length,
      currentUnlockedRows: current.length,
    },
    currentGradePath: current.map((row) => ({
      id: row.id,
      gameId: row.game_id,
      market: row.market,
      pick: row.pick,
      odds: row.odds_american,
      probability: row.model_probability,
      edge: row.edge,
      rawModelGrade:
        row.market === "moneyline"
          ? row.snapshot_json?.ml_grade_recalibration?.original_public_play_grade ??
            row.snapshot_json?.ml_play_grade ??
            null
          : row.snapshot_json?.ou_play_grade ?? null,
      baseBestAngleEligible: row.snapshot_json?.best_angle_resolution?.base_eligible ?? null,
      baseBestAngleDemoteReason: row.snapshot_json?.best_angle_resolution?.demote_reason ?? null,
      finalGrade: row.best_angle === true ? "best_angle" : row.play_grade,
      actionRule: row.snapshot_json?.decision_pipeline?.action_rule_id ??
        row.snapshot_json?.decision_pipeline?.promotion_rule_id ??
        null,
      finalSideChanged: row.snapshot_json?.decision_pipeline?.final_side_changed ?? null,
    })),
    families: Object.fromEntries(Object.entries(families).map(([name, family]) => [
      name,
      {
        performance: split(family.settled),
        settledCandidates: candidateSummary(family.settled),
        currentBoardImpact: candidateSummary(family.current),
      },
    ])),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
