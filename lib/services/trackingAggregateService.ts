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

/**
 * Sport+market joint split with the Best Angle / Lean cuts most members
 * want to see ("how is MLB NRFI doing? how are its Best Angles?").
 */
export type SportMarketBucket = {
  sport: TrackedSport;
  market: TrackedMarketV17;
  metrics: AggregateMetrics;
  bestAngles: AggregateMetrics;
  leans: AggregateMetrics;
};

/** Daily slice for trend charts. One bucket per slate_date. */
export type DailyBucket = {
  date: string;
  metrics: AggregateMetrics;
};

/**
 * Member-safe recent pick. Carries enough for a stacked card list —
 * never raw audit fields (no model_probability / model audit / raw
 * snapshot_json).
 */
export type RecentPickRow = {
  slate_date: string;
  sport: TrackedSport;
  market: TrackedMarketV17;
  matchup: string;
  pick: string | null;
  play_grade: string | null;
  model_version: string | null;
  result: "win" | "loss" | "push" | "void" | "pending";
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_first_inning_runs: number | null;
  best_angle: boolean;
  held: boolean;
};

/**
 * 6B.21 — "Latest Results" feed. Ordered by prediction_grades.graded_at
 * DESC, settled-only (no pending), no_bet=true already filtered upstream.
 * Carries the extra calibration / pricing context the UI shows on the
 * recent-settled card without leaking model-audit internals.
 *
 * FI rows enter this feed as soon as inning 1 closes (6B.19 mid-game
 * grading). ML / OU enter once status=final. Slate_date is always the
 * original locked slate — late games stay tied to their slate.
 */
export type RecentlySettledPickRow = {
  slate_date: string;
  sport: TrackedSport;
  market: TrackedMarketV17;
  matchup: string;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  confidence: number | null;
  play_grade: string | null;
  best_angle: boolean;
  model_version: string | null;
  /** Settled result — never "pending" (filtered upstream). */
  result: "win" | "loss" | "push" | "void";
  win: boolean;
  loss: boolean;
  push: boolean;
  void: boolean;
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_first_inning_runs: number | null;
  /** ISO timestamp. The ordering key for the feed. */
  graded_at: string | null;
  grade_notes: string | null;
};

export type TrackingAggregateResult = {
  rowsConsidered: number;
  /** Excludes launch_day=true unless includeLaunchDay flag is set. */
  rowsCounted: number;
  overall: AggregateMetrics;
  bySport: DimensionRow<TrackedSport>[];
  byMarket: DimensionRow<TrackedMarketV17>[];
  bySportMarket: SportMarketBucket[];
  byModelVersion: DimensionRow[];
  byPlayGrade: DimensionRow[];
  byConfidenceBucket: DimensionRow<ConfidenceBucket>[];
  byDataQualityTier: DimensionRow[];
  bestAngles: AggregateMetrics;
  leans: AggregateMetrics;
  provisionalOnly: AggregateMetrics;
  /** Yesterday's slate (slate_date = effective "yesterday" relative to `to`). */
  yesterday: { date: string | null; overall: AggregateMetrics; bySportMarket: SportMarketBucket[] };
  /** Trailing 7-day window ending on `to` (or today). */
  thisWeek: { from: string; to: string; overall: AggregateMetrics; bySportMarket: SportMarketBucket[]; daily: DailyBucket[] };
  /** Trailing 14-day daily trend for charts. */
  dailyTrend: DailyBucket[];
  /** Last N graded/pending picks (member-safe shape). */
  recentPicks: RecentPickRow[];
  /**
   * 6B.21 — Last N actually-settled picks ordered by graded_at DESC.
   * Excludes pending and no_bet=true. Surfaces FI mid-game settles
   * the moment inning 1 grades, plus ML/OU at final. Additive surface
   * — does not replace recentPicks; daily/weekly/lifetime rollups
   * remain slate_date-bucketed and are unchanged.
   */
  recentlySettled: RecentlySettledPickRow[];
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
    bySportMarket: [],
    byModelVersion: [],
    byPlayGrade: [],
    byConfidenceBucket: [],
    byDataQualityTier: [],
    bestAngles: emptyMetrics(),
    leans: emptyMetrics(),
    provisionalOnly: emptyMetrics(),
    yesterday: { date: null, overall: emptyMetrics(), bySportMarket: [] },
    thisWeek: { from: "", to: "", overall: emptyMetrics(), bySportMarket: [], daily: [] },
    dailyTrend: [],
    recentPicks: [],
    recentlySettled: [],
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
  const launchFiltered = opts.includeLaunchDay === true
    ? recordsRaw
    : recordsRaw.filter((r) => !r.launch_day);

  // Phase 6B.20 — exclude no_bet=true rows from the public W/L tally.
  // Covers Toss-Up FI rows whose member-facing pill was "Toss-Up", and
  // any future ML/OU no_bet flagging. These rows still exist in
  // prediction_records (with prediction_type='toss_up' or similar) and
  // can be inspected separately; they just don't count toward member-
  // facing wins / losses on /lab/tracking.
  const records = launchFiltered.filter((r) => r.no_bet !== true);
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

  // Best Angle vs Lean cuts. 2026-06-15: key both off the canonical
  // play_grade, case-insensitive — ONE source of truth. Previously the Best
  // Angle cut used the `best_angle` boolean (which desynced from play_grade on
  // 25 MLB rows → dropped from BA tracking) and the Lean cut was lowercase-only
  // (so soccer's capital "Lean" was silently dropped). play_grade is what the
  // card grades on, so it's the authoritative tier.
  const grade = (r: Row): string => String(r.record.play_grade ?? "").trim().toLowerCase();
  const bestRows = rows.filter((r) => grade(r) === "best_angle");
  for (const row of bestRows) accumulate(result.bestAngles, row);
  finalize(result.bestAngles, bestRows);

  const leanRows = rows.filter((r) => grade(r) === "lean");
  for (const row of leanRows) accumulate(result.leans, row);
  finalize(result.leans, leanRows);

  const provRows = rows.filter((r) => r.record.provisional === true);
  for (const row of provRows) accumulate(result.provisionalOnly, row);
  finalize(result.provisionalOnly, provRows);

  // ── Phase 6B.2d additions ───────────────────────────────────────────
  // Joint sport+market buckets with Best Angle / Lean sub-cuts. Drives
  // the redesigned member page (MLB ML / MLB O-U / MLB NRFI / MLB YRFI
  // as first-class cards, with each card carrying its own BA/Lean
  // record).
  function buildSportMarketBuckets(scopeRows: ReadonlyArray<Row>): SportMarketBucket[] {
    const groups = new Map<string, Row[]>();
    for (const r of scopeRows) {
      const key = `${r.record.sport}::${r.record.market}`;
      let arr = groups.get(key);
      if (arr === undefined) {
        arr = [];
        groups.set(key, arr);
      }
      arr.push(r);
    }

    // Phase 6B.24 — Virtual NRFI / YRFI buckets sourced from MLB
    // first_inning records, split by pick. Public Tracking categorises
    // NRFI and YRFI separately (and the tracking_baselines table stores
    // them as separate keys), but the underlying records all live in
    // market="first_inning". Without these virtual buckets, today's
    // NRFI / YRFI grades silently fail to merge with baselines and the
    // page shows the historical baseline frozen in time.
    //
    // Toss-Up / no_bet rows are already excluded upstream
    // (records.filter((r) => r.no_bet !== true) at line ~297). NRFI/YRFI
    // buckets here only see actionable picks.
    const mlbFiKey = "mlb::first_inning";
    const mlbFiRows = groups.get(mlbFiKey) ?? [];
    if (mlbFiRows.length > 0) {
      const nrfiRows = mlbFiRows.filter(
        (r) => String(r.record.pick ?? "").toUpperCase() === "NRFI",
      );
      const yrfiRows = mlbFiRows.filter(
        (r) => String(r.record.pick ?? "").toUpperCase() === "YRFI",
      );
      if (nrfiRows.length > 0) groups.set("mlb::nrfi", nrfiRows);
      if (yrfiRows.length > 0) groups.set("mlb::yrfi", yrfiRows);
    }

    const out: SportMarketBucket[] = [];
    for (const [key, rs] of groups) {
      const [sport, market] = key.split("::") as [TrackedSport, TrackedMarketV17];
      const m = emptyMetrics();
      for (const r of rs) accumulate(m, r);
      finalize(m, rs);
      const ba = emptyMetrics();
      const bestRs = rs.filter((r) => grade(r) === "best_angle");
      for (const r of bestRs) accumulate(ba, r);
      finalize(ba, bestRs);
      const le = emptyMetrics();
      const leanRs = rs.filter((r) => grade(r) === "lean");
      for (const r of leanRs) accumulate(le, r);
      finalize(le, leanRs);
      out.push({ sport, market, metrics: m, bestAngles: ba, leans: le });
    }
    out.sort((a, b) => {
      if (a.sport !== b.sport) return a.sport.localeCompare(b.sport);
      return a.market.localeCompare(b.market);
    });
    return out;
  }
  result.bySportMarket = buildSportMarketBuckets(rows);

  // Effective "today" for relative windows. Caller-supplied `to`
  // wins (operator queries, historic audits). Otherwise default to
  // the real ET calendar day — slate_date is ET-anchored so we must
  // match its timezone or the page would show "yesterday" as the day
  // after the latest pick at certain hours of the night.
  const today = opts.to ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const yesterdayDate = shiftDate(today, -1);
  const weekFrom = shiftDate(today, -6);

  // Yesterday slice
  const yesterdayRows = rows.filter((r) => r.record.slate_date === yesterdayDate);
  if (yesterdayRows.length > 0) {
    result.yesterday.date = yesterdayDate;
    for (const r of yesterdayRows) accumulate(result.yesterday.overall, r);
    finalize(result.yesterday.overall, yesterdayRows);
    result.yesterday.bySportMarket = buildSportMarketBuckets(yesterdayRows);
  }

  // This-week slice (trailing 7 days ending on `today`)
  const weekRows = rows.filter((r) => r.record.slate_date >= weekFrom && r.record.slate_date <= today);
  result.thisWeek.from = weekFrom;
  result.thisWeek.to = today;
  if (weekRows.length > 0) {
    for (const r of weekRows) accumulate(result.thisWeek.overall, r);
    finalize(result.thisWeek.overall, weekRows);
    result.thisWeek.bySportMarket = buildSportMarketBuckets(weekRows);
    result.thisWeek.daily = buildDailyTrend(weekRows, weekFrom, today);
  }

  // 14-day trailing trend for the chart
  const trendFrom = shiftDate(today, -13);
  const trendRows = rows.filter((r) => r.record.slate_date >= trendFrom && r.record.slate_date <= today);
  result.dailyTrend = buildDailyTrend(trendRows, trendFrom, today);

  // Recent picks — most recent 20 by slate_date desc, member-safe shape.
  // Excludes launch-day rows (already filtered above).
  result.recentPicks = [...rows]
    .sort((a, b) => {
      if (a.record.slate_date !== b.record.slate_date) {
        return a.record.slate_date < b.record.slate_date ? 1 : -1;
      }
      const aId = a.record.id ?? 0;
      const bId = b.record.id ?? 0;
      return bId - aId;
    })
    .slice(0, 20)
    .map((r) => ({
      slate_date: r.record.slate_date,
      sport: r.record.sport,
      market: r.record.market,
      matchup: r.record.matchup,
      pick: r.record.pick,
      play_grade: r.record.play_grade,
      model_version: r.record.model_version,
      result:
        r.grade === null
          ? "pending"
          : (r.grade.result as "win" | "loss" | "push" | "void" | "pending"),
      actual_home_score: r.grade?.actual_home_score ?? null,
      actual_away_score: r.grade?.actual_away_score ?? null,
      actual_first_inning_runs: r.grade?.actual_first_inning_runs ?? null,
      best_angle: String(r.record.play_grade ?? "").trim().toLowerCase() === "best_angle",
      held: r.record.held === true,
    }));

  // 6B.21 — Recently settled feed. Settled-only (no pending), ordered
  // by prediction_grades.graded_at DESC, limit 20. no_bet=true rows
  // were already filtered out of `rows` at the top of this function;
  // launch_day rows are also already excluded. Slate_date is preserved
  // so the per-day rollups in dailyTrend/yesterday/thisWeek stay in
  // sync — this is a parallel feed, not a substitute.
  const settledRows = rows.filter(
    (r) =>
      r.grade !== null &&
      r.grade.result !== "pending" &&
      typeof r.grade.graded_at === "string" &&
      r.grade.graded_at.length > 0,
  );
  result.recentlySettled = settledRows
    .sort((a, b) => {
      const aAt = a.grade!.graded_at ?? "";
      const bAt = b.grade!.graded_at ?? "";
      if (aAt !== bAt) return aAt < bAt ? 1 : -1;
      const aId = a.record.id ?? 0;
      const bId = b.record.id ?? 0;
      return bId - aId;
    })
    .slice(0, 20)
    .map((r) => {
      const g = r.grade!;
      const res = g.result as "win" | "loss" | "push" | "void";
      return {
        slate_date: r.record.slate_date,
        sport: r.record.sport,
        market: r.record.market,
        matchup: r.record.matchup,
        pick: r.record.pick,
        side: r.record.side,
        line_value: r.record.line_value,
        odds_american: r.record.odds_american,
        confidence: r.record.confidence,
        play_grade: r.record.play_grade,
        best_angle: String(r.record.play_grade ?? "").trim().toLowerCase() === "best_angle",
        model_version: r.record.model_version,
        result: res,
        win: res === "win",
        loss: res === "loss",
        push: res === "push",
        void: res === "void",
        actual_home_score: g.actual_home_score,
        actual_away_score: g.actual_away_score,
        actual_first_inning_runs: g.actual_first_inning_runs,
        graded_at: g.graded_at ?? null,
        grade_notes: g.grade_notes,
      };
    });

  return result;
}

function shiftDate(yyyyMmDd: string, deltaDays: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function buildDailyTrend(scopeRows: ReadonlyArray<Row>, from: string, to: string): DailyBucket[] {
  // Pre-fill every date in [from, to] so chart x-axis has no gaps.
  const buckets = new Map<string, Row[]>();
  let cursor = from;
  while (cursor <= to) {
    buckets.set(cursor, []);
    cursor = shiftDate(cursor, 1);
  }
  for (const r of scopeRows) {
    const arr = buckets.get(r.record.slate_date);
    if (arr !== undefined) arr.push(r);
  }
  const out: DailyBucket[] = [];
  for (const [date, rs] of buckets) {
    const m = emptyMetrics();
    for (const r of rs) accumulate(m, r);
    finalize(m, rs);
    out.push({ date, metrics: m });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
