/**
 * Read-only, release-aware First Inning grade-ladder audit.
 *
 * Uses only locked rows produced by the active FI probability head. Candidate
 * families are declared in code before results are inspected and are reported
 * across fixed chronological train, validation, and untouched windows.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-mlb-first-inning-grade-ladder.ts
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

function grade(row: Row): string {
  if (row.held === true) return "held";
  if (row.no_bet === true) return "no_play";
  if (row.best_angle === true) return "best_angle";
  return String(row.play_grade ?? "ungraded").toLowerCase();
}

function profit(row: Row): number | null {
  const settled = result(row);
  const price = finite(row.odds_american);
  if (settled === null || price === null || price === 0) return null;
  if (settled === "push") return 0;
  if (settled === "loss") return -1;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
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
    const rowProfit = profit(row);
    if (rowProfit !== null) {
      units += rowProfit;
      priced++;
    }
    const probability = finite(row.model_probability);
    if (settled === "push" || probability === null || probability <= 0 || probability >= 1) continue;
    const observed = settled === "win" ? 1 : 0;
    const p = Math.min(0.999, Math.max(0.001, probability));
    probabilityRows++;
    probabilitySum += probability;
    outcomeSum += observed;
    brier += (probability - observed) ** 2;
    logLoss -= observed * Math.log(p) + (1 - observed) * Math.log(1 - p);
  }
  const decisions = wins + losses;
  const dates = [...new Set(rows.map((row) => String(row.slate_date)))];
  const leaveOneDateOutRois = dates.flatMap((date) => {
    const kept = rows.filter((row) => String(row.slate_date) !== date);
    const pricedRows = kept.filter((row) => profit(row) !== null);
    if (pricedRows.length === 0) return [];
    const net = pricedRows.reduce((sum, row) => sum + (profit(row) ?? 0), 0);
    return [net / pricedRows.length * 100];
  });
  return {
    rows: rows.length,
    record: `${wins}-${losses}${pushes ? `-${pushes}` : ""}`,
    units: Number(units.toFixed(3)),
    roiPct: priced ? Number((units / priced * 100).toFixed(1)) : null,
    winRatePct: decisions ? Number((wins / decisions * 100).toFixed(1)) : null,
    activeDates: new Set(rows.map((row) => row.slate_date)).size,
    leaveOneDateOutRoiRangePct: leaveOneDateOutRois.length
      ? [
          Number(Math.min(...leaveOneDateOutRois).toFixed(1)),
          Number(Math.max(...leaveOneDateOutRois).toFixed(1)),
        ]
      : null,
    probability: probabilityRows ? {
      mean: Number((probabilitySum / probabilityRows).toFixed(4)),
      observed: Number((outcomeSum / probabilityRows).toFixed(4)),
      calibrationGapPp: Number(((probabilitySum - outcomeSum) / probabilityRows * 100).toFixed(1)),
      brier: Number((brier / probabilityRows).toFixed(4)),
      logLoss: Number((logLoss / probabilityRows).toFixed(4)),
    } : null,
  };
}

function group(rows: Row[], key: (row: Row) => string) {
  return Object.fromEntries([...new Set(rows.map(key))].sort().map((value) => [
    value,
    metrics(rows.filter((row) => key(row) === value)),
  ]));
}

function split(row: Row): "train" | "validation" | "untouched" {
  if (row.slate_date <= "2026-07-17") return "train";
  if (row.slate_date <= "2026-07-22") return "validation";
  return "untouched";
}

function splitMetrics(rows: Row[]) {
  return {
    train: metrics(rows.filter((row) => split(row) === "train")),
    validation: metrics(rows.filter((row) => split(row) === "validation")),
    untouched: metrics(rows.filter((row) => split(row) === "untouched")),
    combined: metrics(rows),
  };
}

function fi(row: Row): Row {
  return row.snapshot_json?.fi_v2_audit ?? {};
}

function fiEdgePp(row: Row): number | null {
  return finite(fi(row).fi_edge_pct) ?? (
    finite(row.edge) === null ? null : (finite(row.edge) as number) * 100
  );
}

function edgeBand(row: Row): string {
  const edge = fiEdgePp(row);
  if (edge === null) return "missing";
  if (edge < 0) return "negative";
  if (edge < 2) return "0_to_1_99";
  if (edge < 4) return "2_to_3_99";
  if (edge < 6) return "4_to_5_99";
  if (edge < 8) return "6_to_7_99";
  return "8_plus";
}

function priceBand(row: Row): string {
  const price = finite(row.odds_american);
  if (price === null) return "missing";
  if (price <= -170) return "minus_170_or_shorter";
  if (price <= -130) return "minus_169_to_130";
  if (price < 100) return "minus_129_to_101";
  return "plus_money";
}

function validPick(row: Row): boolean {
  return row.pick === "NRFI" || row.pick === "YRFI";
}

async function loadRows(): Promise<Row[]> {
  const output: Row[] = [];
  const pageSize = 250;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select([
        "id", "game_id", "slate_date", "pick", "side", "odds_american",
        "model_probability", "market_probability", "edge", "confidence",
        "play_grade", "best_angle", "no_bet", "held", "launch_day",
        "locked_at", "snapshot_json", "prediction_grades(result)",
      ].join(","))
      .eq("sport", "mlb")
      .eq("market", "first_inning")
      .gte("slate_date", "2026-07-11")
      .not("locked_at", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    output.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < pageSize) return output;
  }
}

async function main() {
  const rows = (await loadRows()).filter((row) =>
    row.launch_day !== true &&
    result(row) !== null &&
    row.snapshot_json?.model_layer_versions?.active_probability_head ===
      MLB_MODEL_LAYER_VERSION_IDS.first_inning_probability_head
  );
  const actionable = rows.filter((row) => grade(row) === "best_angle" || grade(row) === "lean");
  const candidates = {
    existingBestAngles: rows.filter((row) => grade(row) === "best_angle"),
    existingLeans: rows.filter((row) => grade(row) === "lean"),
    leanNrfi: rows.filter((row) => grade(row) === "lean" && row.pick === "NRFI"),
    leanYrfi: rows.filter((row) => grade(row) === "lean" && row.pick === "YRFI"),
    leanEightPlusEdge: rows.filter((row) =>
      grade(row) === "lean" && (fiEdgePp(row) ?? -Infinity) >= 8
    ),
    leanSixPlusEdgePriceAboveMinus130: rows.filter((row) =>
      grade(row) === "lean" &&
      (fiEdgePp(row) ?? -Infinity) >= 6 &&
      (finite(row.odds_american) ?? -Infinity) > -130
    ),
    leanFinalWriterEdgeSixPlusPriceAboveMinus130: rows.filter((row) =>
      grade(row) === "lean" &&
      ((finite(row.edge) ?? -Infinity) * 100) >= 6 &&
      (finite(row.odds_american) ?? -Infinity) > -130
    ),
    leanFinalWriterEdgeSixPlusPriceAboveMinus130Confidence56: rows.filter((row) =>
      grade(row) === "lean" &&
      ((finite(row.edge) ?? -Infinity) * 100) >= 6 &&
      (finite(row.odds_american) ?? -Infinity) > -130 &&
      (finite(row.confidence) ?? -Infinity) >= 56
    ),
    lowEdgeNoPlayQualifiedPrice: rows.filter((row) =>
      grade(row) === "no_play" &&
      validPick(row) &&
      fi(row).fi_play_grade_reason === "fi_no_bet_low_edge" &&
      fi(row).provisional !== true &&
      fi(row).data_quality_tier === "high" &&
      (finite(row.odds_american) ?? -Infinity) > -170
    ),
    negativeEdgeNoPlayNrfiQualifiedPrice: rows.filter((row) =>
      grade(row) === "no_play" &&
      row.pick === "NRFI" &&
      fi(row).fi_play_grade_reason === "fi_no_bet_negative_edge" &&
      fi(row).provisional !== true &&
      fi(row).data_quality_tier === "high" &&
      (finite(row.odds_american) ?? -Infinity) > -170
    ),
  };
  console.log(JSON.stringify({
    mode: "read_only_release_aware_first_inning_grade_ladder",
    noWrites: true,
    splitPolicy: {
      train: "2026-07-11..2026-07-17",
      validation: "2026-07-18..2026-07-22",
      untouched: "2026-07-23..latest settled",
    },
    population: metrics(rows),
    actionable: metrics(actionable),
    byGradeSide: group(rows, (row) => `${grade(row)}|${String(row.pick ?? "none").toLowerCase()}`),
    actionableByGradeEdgeBand: group(actionable, (row) => `${grade(row)}|${edgeBand(row)}`),
    actionableByGradePriceBand: group(actionable, (row) => `${grade(row)}|${priceBand(row)}`),
    byGradeReason: group(rows.filter(validPick), (row) => String(fi(row).fi_play_grade_reason ?? "missing")),
    candidateFamilies: Object.fromEntries(
      Object.entries(candidates).map(([name, selected]) => [name, splitMetrics(selected)]),
    ),
    policy: "Candidate families are diagnostic until they pass all fixed chronological windows and paired board-impact review.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
