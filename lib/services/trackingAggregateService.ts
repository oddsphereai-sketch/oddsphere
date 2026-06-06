/**
 * Push 4 — Tracking aggregate service.
 *
 * Reads prediction_records + prediction_grades and produces the
 * aggregates the admin/member tracking pages render. Service-level
 * aggregation (no materialized table) — the slate volume (15 games
 * × 3 markets × 1 day ≈ 45 rows/day) means even a slow scan is
 * sub-second. When tracking volume grows, a materialized refresh
 * fits naturally on top of this same shape.
 *
 * Aggregation dimensions:
 *   - by sport / market / model_version
 *   - by best_angle / play_grade / prediction_type
 *   - by confidence_bucket
 *   - by data_quality_tier / source_quality / provisional
 *
 * Calibration metrics:
 *   - Brier = mean((p - outcome)^2)  where outcome ∈ {0,1}
 *   - Log loss = -mean(outcome * log(p) + (1-outcome) * log(1-p))
 *   - Skips push / void / pending rows
 *
 * Launch day / manual rows are excluded from "fresh automated"
 * counts by default; the admin page can opt-in to view them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bucketForConfidence,
  type ConfidenceBucket,
  type PredictionGradeRow,
  type PredictionRecordRow,
  type TrackedSport,
  type TrackedMarketV17,
  type TrackingBaselineRow,
} from "../types/domain/Tracking";

export type AggregateKey =
  | "all"
  | { kind: "sport"; sport: TrackedSport }
  | { kind: "market"; market: TrackedMarketV17 }
  | { kind: "model_version"; model_version: string }
  | { kind: "best_angle" }
  | { kind: "lean" }
  | { kind: "confidence_bucket"; bucket: ConfidenceBucket }
  | { kind: "data_quality_tier"; tier: string }
  | { kind: "provisional" };

export type AggregateMetrics = {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  win_pct: number | null;
  avg_confidence: number | null;
  avg_edge: number | null;
  avg_ev: number | null;
  brier_score: number | null;
  log_loss: number | null;
};

export type DimensionRow<K extends string = string> = {
  label: K;
  metrics: AggregateMetrics;
};

export type TrackingAggregateResult = {
  rowsConsidered: number;
  /** Excludes launch_day=true unless includeLaunchDay flag is set. */
  rowsCounted: number;
  overall: AggregateMetrics;
  bySport: DimensionRow<TrackedSport>[];
  byMarket: DimensionRow<TrackedMarketV17>[];
  byModelVersion: DimensionRow[];
  byPlayGrade: DimensionRow[];
  byConfidenceBucket: DimensionRow<ConfidenceBucket>[];
  byDataQualityTier: DimensionRow[];
  bestAngles: AggregateMetrics;
  leans: AggregateMetrics;
  provisionalOnly: AggregateMetrics;
  baselines: TrackingBaselineRow[];
  tablesInitialized: boolean;
};

function emptyMetrics(): AggregateMetrics {
  return {
    picks: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    voids: 0,
    pending: 0,
    win_pct: null,
    avg_confidence: null,
    avg_edge: null,
    avg_ev: null,
    brier_score: null,
    log_loss: null,
  };
}

type Row = {
  record: PredictionRecordRow;
  grade: PredictionGradeRow | null;
};

function accumulate(metrics: AggregateMetrics, row: Row): void {
  metrics.picks++;
  const g = row.grade;
  if (g === null || g.result === "pending") {
    metrics.pending++;
    return;
  }
  if (g.win) metrics.wins++;
  else if (g.loss) metrics.losses++;
  else if (g.push) metrics.pushes++;
  else if (g.void) metrics.voids++;
}

function finalize(metrics: AggregateMetrics, rows: ReadonlyArray<Row>): void {
  // win_pct excludes pushes / voids / pending (binary settle only).
  const decided = metrics.wins + metrics.losses;
  metrics.win_pct = decided > 0 ? Math.round((metrics.wins / decided) * 10000) / 100 : null;

  // Aggregate confidence / edge / EV from the prediction snapshot side
  let confSum = 0;
  let confCount = 0;
  let edgeSum = 0;
  let edgeCount = 0;
  let evSum = 0;
  let evCount = 0;
  let brierSum = 0;
  let logSum = 0;
  let calibrationCount = 0;
  for (const r of rows) {
    if (r.record.confidence !== null && r.record.confidence !== undefined) {
      confSum += r.record.confidence;
      confCount++;
    }
    if (r.record.edge !== null && r.record.edge !== undefined) {
      edgeSum += r.record.edge;
      edgeCount++;
    }
    if (r.record.expected_value !== null && r.record.expected_value !== undefined) {
      evSum += r.record.expected_value;
      evCount++;
    }
    if (
      r.grade !== null &&
      (r.grade.win || r.grade.loss) &&
      r.record.model_probability !== null &&
      r.record.model_probability !== undefined &&
      r.record.model_probability > 0 &&
      r.record.model_probability < 1
    ) {
      const p = r.record.model_probability;
      const o = r.grade.win ? 1 : 0;
      brierSum += (p - o) * (p - o);
      // Stable log-loss: clamp p to (eps, 1-eps) for numerical safety
      const eps = 1e-9;
      const pc = Math.min(Math.max(p, eps), 1 - eps);
      logSum += -(o * Math.log(pc) + (1 - o) * Math.log(1 - pc));
      calibrationCount++;
    }
  }
  metrics.avg_confidence = confCount > 0 ? confSum / confCount : null;
  metrics.avg_edge = edgeCount > 0 ? edgeSum / edgeCount : null;
  metrics.avg_ev = evCount > 0 ? evSum / evCount : null;
  metrics.brier_score = calibrationCount > 0 ? brierSum / calibrationCount : null;
  metrics.log_loss = calibrationCount > 0 ? logSum / calibrationCount : null;
}

/**
 * Compute the full tracking aggregate for the optional sport / date
 * range. Defaults to "all sports, all time".
 */
export async function computeTrackingAggregate(opts: {
  supabase: SupabaseClient;
  sport?: TrackedSport;
  from?: string; // YYYY-MM-DD inclusive
  to?: string;   // YYYY-MM-DD inclusive
  includeLaunchDay?: boolean;
}): Promise<TrackingAggregateResult> {
  const result: TrackingAggregateResult = {
    rowsConsidered: 0,
    rowsCounted: 0,
    overall: emptyMetrics(),
    bySport: [],
    byMarket: [],
    byModelVersion: [],
    byPlayGrade: [],
    byConfidenceBucket: [],
    byDataQualityTier: [],
    bestAngles: emptyMetrics(),
    leans: emptyMetrics(),
    provisionalOnly: emptyMetrics(),
    baselines: [],
    tablesInitialized: true,
  };

  // Probe table existence
  const probe = await opts.supabase
    .from("prediction_records")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  if (
    probe.error &&
    /relation .* does not exist|could not find the table/i.test(
      probe.error.message,
    )
  ) {
    result.tablesInitialized = false;
    return result;
  }

  // Baselines
  let baselinesQuery = opts.supabase.from("tracking_baselines").select("*");
  if (opts.sport !== undefined) baselinesQuery = baselinesQuery.eq("sport", opts.sport);
  const { data: baselineRows } = await baselinesQuery;
  result.baselines = (baselineRows ?? []) as TrackingBaselineRow[];

  // Records
  let recQuery = opts.supabase.from("prediction_records").select("*");
  if (opts.sport !== undefined) recQuery = recQuery.eq("sport", opts.sport);
  if (opts.from !== undefined) recQuery = recQuery.gte("slate_date", opts.from);
  if (opts.to !== undefined) recQuery = recQuery.lte("slate_date", opts.to);
  const { data: recRows, error: recErr } = await recQuery;
  if (recErr) return result;
  const recordsRaw = (recRows ?? []) as PredictionRecordRow[];
  result.rowsConsidered = recordsRaw.length;

  // Filter launch-day if requested
  const records = opts.includeLaunchDay === true
    ? recordsRaw
    : recordsRaw.filter((r) => !r.launch_day);
  result.rowsCounted = records.length;
  if (records.length === 0) return result;

  // Grades — load only for the relevant record ids
  const recordIds = records.map((r) => r.id).filter((x): x is number => x !== undefined);
  const { data: gradeRows } = await opts.supabase
    .from("prediction_grades")
    .select("*")
    .in("prediction_record_id", recordIds);
  const grades = ((gradeRows ?? []) as PredictionGradeRow[]);
  const gradeByRecordId = new Map<number, PredictionGradeRow>(
    grades.map((g) => [g.prediction_record_id, g]),
  );

  const rows: Row[] = records.map((r) => ({
    record: r,
    grade: r.id !== undefined ? gradeByRecordId.get(r.id) ?? null : null,
  }));

  // Overall
  for (const row of rows) accumulate(result.overall, row);
  finalize(result.overall, rows);

  // Helper to bucket rows by a key fn
  function groupBy<K extends string>(keyFn: (row: Row) => K | null): DimensionRow<K>[] {
    const groups = new Map<K, Row[]>();
    for (const row of rows) {
      const k = keyFn(row);
      if (k === null) continue;
      let arr = groups.get(k);
      if (arr === undefined) {
        arr = [];
        groups.set(k, arr);
      }
      arr.push(row);
    }
    const out: DimensionRow<K>[] = [];
    for (const [k, rs] of groups) {
      const m = emptyMetrics();
      for (const r of rs) accumulate(m, r);
      finalize(m, rs);
      out.push({ label: k, metrics: m });
    }
    return out;
  }

  result.bySport = groupBy<TrackedSport>((r) => r.record.sport);
  result.byMarket = groupBy<TrackedMarketV17>((r) => r.record.market);
  result.byModelVersion = groupBy((r) => r.record.model_version ?? "(unknown)");
  result.byPlayGrade = groupBy((r) => r.record.play_grade ?? "(none)");
  result.byConfidenceBucket = groupBy((r) => bucketForConfidence(r.record.confidence));
  result.byDataQualityTier = groupBy((r) => r.record.data_quality_tier ?? "(none)");

  // Best Angle vs Lean cuts
  const bestRows = rows.filter((r) => r.record.best_angle === true);
  for (const row of bestRows) accumulate(result.bestAngles, row);
  finalize(result.bestAngles, bestRows);

  const leanRows = rows.filter((r) => r.record.play_grade === "lean");
  for (const row of leanRows) accumulate(result.leans, row);
  finalize(result.leans, leanRows);

  const provRows = rows.filter((r) => r.record.provisional === true);
  for (const row of provRows) accumulate(result.provisionalOnly, row);
  finalize(result.provisionalOnly, provRows);

  return result;
}
