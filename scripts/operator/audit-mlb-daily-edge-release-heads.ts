/**
 * Read-only, release-aware MLB Daily Edge audit.
 *
 * It reports settled performance only under the probability head stamped on
 * each immutable row. Decision releases and public grades remain separated;
 * legacy and current releases are never blended and called current.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-mlb-daily-edge-release-heads.ts
 *   npx tsx scripts/operator/audit-mlb-daily-edge-release-heads.ts /path/to/export.json
 */

import { existsSync, readFileSync } from "node:fs";
import { MLB_MODEL_LAYER_VERSION_IDS } from "../../lib/automodel/mlbModelLayerVersions";

type Row = Record<string, any>;
type SettledResult = "win" | "loss" | "push";

const markets = ["moneyline", "total", "first_inning"] as const;
const activeHeads = {
  moneyline: MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head,
  total: MLB_MODEL_LAYER_VERSION_IDS.total_probability_head,
  first_inning: MLB_MODEL_LAYER_VERSION_IDS.first_inning_probability_head,
} as const;

function relation(row: Row): Row | null {
  const value = row.prediction_grades;
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function settledResult(row: Row): SettledResult | null {
  const value = String(relation(row)?.result ?? "").toLowerCase();
  return value === "win" || value === "loss" || value === "push" ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function lockedProfit(row: Row): number | null {
  const result = settledResult(row);
  const odds = finite(row.odds_american);
  if (result === null || odds === null || odds === 0) return null;
  if (result === "push") return 0;
  if (result === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function metrics(rows: Row[]) {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let units = 0;
  let priced = 0;
  let brier = 0;
  let logLoss = 0;
  let probabilityRows = 0;
  let probabilitySum = 0;
  let outcomeSum = 0;
  for (const row of rows) {
    const result = settledResult(row);
    const profit = lockedProfit(row);
    if (result === null || profit === null) continue;
    if (result === "win") wins++;
    else if (result === "loss") losses++;
    else pushes++;
    units += profit;
    priced++;
    const probability = finite(row.model_probability);
    if (result === "push" || probability === null) continue;
    const observed = result === "win" ? 1 : 0;
    const bounded = Math.max(0.001, Math.min(0.999, probability));
    probabilityRows++;
    probabilitySum += probability;
    outcomeSum += observed;
    brier += (probability - observed) ** 2;
    logLoss -= observed * Math.log(bounded) + (1 - observed) * Math.log(1 - bounded);
  }
  return {
    settled: priced,
    record: `${wins}-${losses}${pushes ? `-${pushes}` : ""}`,
    units: round(units),
    roi: priced ? round(units / priced) : null,
    brier: probabilityRows ? round(brier / probabilityRows) : null,
    logLoss: probabilityRows ? round(logLoss / probabilityRows) : null,
    meanProbability: probabilityRows ? round(probabilitySum / probabilityRows) : null,
    observedRate: probabilityRows ? round(outcomeSum / probabilityRows) : null,
    activeDays: new Set(rows.map((row) => row.slate_date)).size,
  };
}

function decisionRelease(row: Row): string {
  return String(
    row.snapshot_json?.decision_pipeline?.release_id ??
    row.snapshot_json?.model_layer_versions?.decision_release_id ??
    "legacy_unstamped_decision_release",
  );
}

function probabilityHead(row: Row): string {
  return String(
    row.snapshot_json?.model_layer_versions?.active_probability_head ??
    "legacy_unstamped_probability_head",
  );
}

function groupMetrics(
  rows: Row[],
  key: (row: Row) => string,
): Record<string, ReturnType<typeof metrics>> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const group = groups.get(groupKey) ?? [];
    group.push(row);
    groups.set(groupKey, group);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([groupKey, group]) => [groupKey, metrics(group)]),
  );
}

async function loadRows(): Promise<Row[]> {
  const inputPath = process.argv[2];
  if (inputPath) {
    if (!existsSync(inputPath)) throw new Error(`Audit input not found: ${inputPath}`);
    return JSON.parse(readFileSync(inputPath, "utf8")) as Row[];
  }
  const { supabase } = await import("../../lib/db/supabase");
  const output: Row[] = [];
  const pageSize = 250;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select([
        "id",
        "slate_date",
        "market",
        "odds_american",
        "model_probability",
        "market_probability",
        "edge",
        "play_grade",
        "best_angle",
        "no_bet",
        "held",
        "launch_day",
        "locked_at",
        "snapshot_json",
        "prediction_grades(result)",
      ].join(","))
      .eq("sport", "mlb")
      .in("market", [...markets])
      .gte("slate_date", "2026-06-01")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    output.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < pageSize) return output;
  }
}

async function main() {
  const source = (await loadRows()).filter(
    (row) =>
      markets.includes(row.market)
      && row.launch_day !== true
      && row.held !== true
      && row.locked_at != null
      && settledResult(row) !== null,
  );
  const report = Object.fromEntries(markets.map((market) => {
    const marketRows = source.filter((row) => row.market === market);
    const currentHeadRows = marketRows.filter(
      (row) => probabilityHead(row) === activeHeads[market],
    );
    return [market, {
      activeProbabilityHead: activeHeads[market],
      exactCurrentHead: metrics(currentHeadRows),
      byDecisionRelease: groupMetrics(currentHeadRows, decisionRelease),
      byPublicGrade: groupMetrics(
        currentHeadRows,
        (row) => String(row.best_angle === true ? "best_angle" : row.play_grade ?? "null"),
      ),
      excludedOtherHeads: marketRows.length - currentHeadRows.length,
    }];
  }));
  console.log(JSON.stringify({
    mode: "read_only_release_aware_mlb_daily_edge_audit",
    noWrites: true,
    rowsLoaded: source.length,
    report,
  }, null, 2));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
