/**
 * READ ONLY. Tests the grade-continuity gap between the r37 neutral-consensus
 * Moneyline Best Angle and the r37 toward-movement Lean.
 */
import { supabase } from "../../lib/db/supabase";

// Historical snapshots are deliberately schemaless across release eras.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Row = {
  id: number;
  slate_date: string;
  matchup: string | null;
  side: string | null;
  odds_american: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  held: boolean | null;
  launch_day: boolean | null;
  model_probability: number | null;
  snapshot_json: Json | null;
  prediction_grades: Array<{ result: string | null }> | { result: string | null } | null;
};

type AuditRow = {
  id: number;
  date: string;
  matchup: string | null;
  side: string | null;
  price: number;
  result: "win" | "loss" | "push";
  modelProbability: number | null;
  movement: string;
  movementMagnitudePp: number;
  betsPct: number;
  moneyPct: number;
  finalSideChanged: boolean;
  historicallyActionable: boolean;
  release: string | null;
};

const FROM = "2026-06-07";
const THROUGH = "2026-08-12";

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sideFromKey(value: unknown): string | null {
  const side = String(value ?? "").split(":").at(-1)?.toLowerCase();
  return side === "home" || side === "away" ? side : null;
}

function percentage(value: unknown): number | null {
  const parsed = number(value);
  if (parsed === null) return null;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

function resultOf(row: Row): "win" | "loss" | "push" | null {
  const joined = Array.isArray(row.prediction_grades)
    ? row.prediction_grades[0]
    : row.prediction_grades;
  const result = String(joined?.result ?? "").toLowerCase();
  return result === "win" || result === "loss" || result === "push" ? result : null;
}

function sharpSplit(snapshot: Json, side: string | null): { bets: number; money: number } | null {
  if (side === null) return null;
  const rows = Array.isArray(snapshot.source_aware_split_rows_at_lock)
    ? snapshot.source_aware_split_rows_at_lock
    : [];
  const match = rows.find((candidate: Json) =>
    candidate.provider === "sharpapi" &&
    candidate.market_type === "moneyline" &&
    sideFromKey(candidate.selection_key) === side,
  );
  const bets = percentage(match?.bets_pct);
  const money = percentage(match?.money_pct);
  return bets === null || money === null ? null : { bets, money };
}

function unitProfit(row: AuditRow): number {
  if (row.result === "push") return 0;
  if (row.result === "loss") return -1;
  return row.price > 0 ? row.price / 100 : 100 / Math.abs(row.price);
}

function summarize(rows: AuditRow[]) {
  const wins = rows.filter((row) => row.result === "win").length;
  const losses = rows.filter((row) => row.result === "loss").length;
  const pushes = rows.filter((row) => row.result === "push").length;
  const units = rows.reduce((sum, row) => sum + unitProfit(row), 0);
  return {
    n: rows.length,
    dates: new Set(rows.map((row) => row.date)).size,
    record: `${wins}-${losses}${pushes ? `-${pushes}` : ""}`,
    units: Number(units.toFixed(3)),
    roiPct: rows.length ? Number(((units / rows.length) * 100).toFixed(1)) : null,
    hitRatePct: wins + losses ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : null,
  };
}

function partitions(universe: AuditRow[], matched: AuditRow[]) {
  const dates = [...new Set(universe.map((row) => row.date))].sort();
  const trainEnd = Math.floor(dates.length * 0.6);
  const validationEnd = Math.floor(dates.length * 0.8);
  const trainDates = new Set(dates.slice(0, trainEnd));
  const validationDates = new Set(dates.slice(trainEnd, validationEnd));
  return {
    boundaries: {
      train: [dates[0] ?? null, dates[trainEnd - 1] ?? null],
      validation: [dates[trainEnd] ?? null, dates[validationEnd - 1] ?? null],
      holdout: [dates[validationEnd] ?? null, dates.at(-1) ?? null],
    },
    train: summarize(matched.filter((row) => trainDates.has(row.date))),
    validation: summarize(matched.filter((row) => validationDates.has(row.date))),
    holdout: summarize(matched.filter((row) => !trainDates.has(row.date) && !validationDates.has(row.date))),
    combined: summarize(matched),
    bootstrap: bootstrapByDate(matched),
  };
}

function bootstrapByDate(rows: AuditRow[], iterations = 20_000) {
  const clusters = [...Map.groupBy(rows, (row) => row.date).values()];
  if (clusters.length === 0) return null;
  let state = 0x9e3779b9;
  const random = () => {
    state = (Math.imul(state ^ (state >>> 16), 0x21f0aaad) + 0x735a2d97) | 0;
    return ((state ^ (state >>> 15)) >>> 0) / 4294967296;
  };
  const rois: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample: AuditRow[] = [];
    for (let index = 0; index < clusters.length; index += 1) {
      sample.push(...clusters[Math.floor(random() * clusters.length)]!);
    }
    rois.push(100 * sample.reduce((sum, row) => sum + unitProfit(row), 0) / sample.length);
  }
  rois.sort((left, right) => left - right);
  const quantile = (value: number) => rois[Math.min(rois.length - 1, Math.floor(value * rois.length))]!;
  return {
    iterations,
    dateClusters: clusters.length,
    roiP05: Number(quantile(0.05).toFixed(1)),
    roiMedian: Number(quantile(0.5).toFixed(1)),
    roiP95: Number(quantile(0.95).toFixed(1)),
    probabilityPositiveRoi: Number((rois.filter((roi) => roi > 0).length / rois.length).toFixed(4)),
  };
}

async function loadRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select("id,slate_date,matchup,side,odds_american,play_grade,best_angle,no_bet,held,launch_day,model_probability,snapshot_json,prediction_grades(result)")
      .eq("sport", "mlb")
      .eq("market", "moneyline")
      .gte("slate_date", FROM)
      .lte("slate_date", THROUGH)
      .not("locked_at", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 500) break;
  }
  return rows;
}

async function main(): Promise<void> {
  const source = await loadRows();
  const universe: AuditRow[] = source.flatMap((row) => {
    const result = resultOf(row);
    const snapshot = row.snapshot_json ?? {};
    const movement = snapshot.line_movement ?? {};
    const integrity = snapshot.data_integrity ?? {};
    const decision = snapshot.decision_pipeline ?? {};
    const split = sharpSplit(snapshot, row.side);
    const price = number(row.odds_american);
    const magnitude = number(movement.magnitude_pp);
    if (
      result === null ||
      row.launch_day === true ||
      row.no_bet === true ||
      row.held === true ||
      price === null ||
      magnitude === null ||
      split === null ||
      snapshot.v2_data_quality_tier !== "high" ||
      integrity.stale !== "no" ||
      integrity.market_baseline_valid !== "yes" ||
      decision.market_aware_correction_applied === true ||
      decision.inversion_triggered === true
    ) return [];
    return [{
      id: row.id,
      date: row.slate_date,
      matchup: row.matchup,
      side: row.side,
      price,
      result,
      modelProbability: row.model_probability,
      movement: String(movement.direction ?? "unknown"),
      movementMagnitudePp: magnitude,
      betsPct: split.bets,
      moneyPct: split.money,
      finalSideChanged: decision.final_side_changed === true,
      historicallyActionable: row.best_angle === true || row.play_grade === "best_angle" || row.play_grade === "lean",
      release: typeof decision.release_id === "string" ? decision.release_id : null,
    }];
  });
  const strongConsensus = universe.filter((row) =>
    row.price >= -200 && row.price <= 200 && row.betsPct >= 70 && row.moneyPct >= 70,
  );
  const candidate = (rows: AuditRow[], lower: number, upper: number) => rows.filter((row) =>
    row.movement === "toward_pick" &&
    row.movementMagnitudePp >= lower &&
    row.movementMagnitudePp < upper,
  );
  const report = {
    generatedAt: new Date().toISOString(),
    databaseWrites: false,
    dateRange: { from: FROM, through: THROUGH },
    universe: summarize(universe),
    strongConsensus: summarize(strongConsensus),
    candidates: {
      neutralProductionCohort: partitions(universe, strongConsensus.filter((row) => row.movement === "neutral")),
      towardAny: partitions(universe, candidate(strongConsensus, 0, Infinity)),
      towardBelowOnePoint: partitions(universe, candidate(strongConsensus, 0, 1)),
      towardOneToOnePointFive: partitions(universe, candidate(strongConsensus, 1, 1.5)),
      towardBelowOnePointFive: partitions(universe, candidate(strongConsensus, 0, 1.5)),
      towardAtLeastOnePointFive: partitions(universe, candidate(strongConsensus, 1.5, Infinity)),
      towardChangedSide: partitions(universe, candidate(strongConsensus, 0, Infinity).filter((row) => row.finalSideChanged)),
      towardUnchangedSide: partitions(universe, candidate(strongConsensus, 0, Infinity).filter((row) => !row.finalSideChanged)),
      incrementalHistoricallyNonActionable: partitions(universe, candidate(strongConsensus, 0, Infinity).filter((row) => !row.historicallyActionable)),
    },
    matchedRows: candidate(strongConsensus, 0, Infinity),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
