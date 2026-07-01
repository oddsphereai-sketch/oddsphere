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
import { isPublicallyTracked } from "../config/officialTrackingStart";
import {
  computeRecommendationConfidence,
  type RecommendationPlayGrade,
  type RecommendationTier,
} from "./recommendationConfidence";
import { normalizeDailyEdgeActionability } from "./dailyEdgeActionability";
import type { DailyEdgeActionabilityMarket } from "./dailyEdgeActionability";
import type { Grade } from "../types/domain/Grade";
import type { Verdict } from "./verdictDerivation";

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
 * DESC, settled-only (no pending). Toss-Ups are excluded; `no_bet`
 * stand-downs are included (they are graded calls that count for accuracy).
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
  /** Trailing 30-day window ending on `to` (or today). */
  thisMonth: { from: string; to: string; overall: AggregateMetrics; bySportMarket: SportMarketBucket[] };
  /** Trailing 14-day daily trend for charts. */
  dailyTrend: DailyBucket[];
  /** Last N graded/pending picks (member-safe shape). */
  recentPicks: RecentPickRow[];
  /**
   * 6B.21 — Last N actually-settled picks ordered by graded_at DESC.
   * Excludes pending and Toss-Ups (no_bet stand-downs are included).
   * Surfaces FI mid-game settles
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

/**
 * A genuine Toss-Up — a non-actionable pick with NO side (First-Inning-only).
 * This is the ONLY thing withheld from the public W/L tally; every other
 * prediction (incl. `no_bet` stand-downs) has a side and counts. Mirrors the
 * grader's Toss-Up detection (predictionGrader.ts) so the two stay in lockstep.
 */
function isTossUp(r: PredictionRecordRow): boolean {
  return (
    r.prediction_type === "toss_up" ||
    String(r.pick ?? "").trim().toLowerCase() === "toss-up"
  );
}

type Row = {
  record: PredictionRecordRow;
  grade: PredictionGradeRow | null;
};

const TRACKING_PAGE_SIZE = 1000;
const TRACKING_GRADE_ID_CHUNK_SIZE = 500;

function storedGrade(record: PredictionRecordRow): string {
  return String(record.play_grade ?? "").trim().toLowerCase();
}

function flagEnabled(name: string): boolean {
  return process.env[name] === "true";
}

function snapshotNumber(record: PredictionRecordRow, path: string[]): number | null {
  let cursor: unknown = record.snapshot_json;
  for (const key of path) {
    if (cursor === null || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : null;
}

function snapshotString(record: PredictionRecordRow, path: string[]): string | null {
  let cursor: unknown = record.snapshot_json;
  for (const key of path) {
    if (cursor === null || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" ? cursor.trim().toLowerCase() : null;
}

function isKnownMlMovementNotTowardPick(record: PredictionRecordRow): boolean {
  const direction = snapshotString(record, ["line_movement", "direction"]);
  return direction === "neutral" || direction === "resistance" || direction === "against_pick";
}

function movementDirectionRelativeToPick(record: PredictionRecordRow): "support" | "resistance" | "neutral" | null {
  const direction = snapshotString(record, ["line_movement", "direction"]);
  if (direction === "toward_pick" || direction === "support") return "support";
  if (direction === "against_pick" || direction === "resistance") return "resistance";
  if (direction === "neutral") return "neutral";
  return null;
}

function totalProjectionGap(record: PredictionRecordRow): number | null {
  if (typeof record.line_value !== "number") return null;
  const projectedTotal =
    snapshotNumber(record, ["v2_2_audit", "posterior_total"]) ??
    snapshotNumber(record, ["predicted_scores_at_lock", "total"]);
  if (projectedTotal === null) return null;
  return Math.abs(projectedTotal - record.line_value);
}

function verdictForStoredGrade(grade: string): Verdict {
  if (grade === "best_angle") return "best_angle";
  if (grade === "lean") return "lean";
  if (grade === "market_watch" || grade === "model_only" || grade === "provisional" || grade === "market_aligned" || grade === "watchlist") {
    return "watchlist";
  }
  if (grade === "caution" || grade === "sharp_conflict") return "caution";
  return "no_play";
}

function labelForVerdict(verdict: Verdict): string {
  if (verdict === "best_angle") return "Best Angle";
  if (verdict === "lean") return "Lean";
  if (verdict === "watchlist") return "Watchlist";
  if (verdict === "caution") return "Caution";
  return "No Play";
}

function rawGradeForStoredGrade(grade: string): Grade | null {
  if (grade === "best_angle") return "best_signal";
  if (grade === "lean") return "model_only";
  if (grade === "caution" || grade === "sharp_conflict") return "sharp_conflict";
  if (grade.length > 0) return "market_watch";
  return null;
}

function recommendationPlayGrade(grade: string): RecommendationPlayGrade | null {
  if (grade === "best_angle") return "best_angle";
  if (grade === "lean") return "lean";
  if (grade === "toss_up") return "toss_up";
  if (grade === "held") return "held";
  if (grade === "no_bet" || grade === "no_play") return "no_bet";
  if (grade === "market_aligned") return "market_aligned";
  return null;
}

function recommendationTier(record: PredictionRecordRow): RecommendationTier {
  const tier = String(
    record.data_quality_tier ??
    snapshotString(record, ["v2_2_audit", "data_quality_tier"]) ??
    snapshotString(record, ["fi_v2_audit", "data_quality_tier"]) ??
    "",
  ).toLowerCase();
  if (tier === "high" || tier === "medium" || tier === "low" || tier === "fallback") return tier;
  return "fallback";
}

function actionabilityMarket(record: PredictionRecordRow): DailyEdgeActionabilityMarket | null {
  if (record.market === "moneyline") return "moneyline";
  if (record.market === "total") return "total";
  if (record.market === "first_inning") return "first_inning";
  if (record.market === "spread") return "spread";
  if (record.market === "match_result") return "soccer_moneyline";
  if (record.market === "btts") return "soccer_btts";
  return null;
}

function actionabilityGrade(record: PredictionRecordRow, grade: string): string {
  if (grade.length === 0) return grade;
  const market = actionabilityMarket(record);
  if (market === null) return grade;
  const verdict = verdictForStoredGrade(grade);
  const edgeUnits = record.market === "total" && typeof record.line_value === "number"
    ? totalProjectionGap(record)
    : null;
  const hasPick = record.pick !== null && record.pick !== "Held" && !isTossUp(record);
  const recScore = computeRecommendationConfidence({
    edgePctPp: typeof record.edge === "number" ? record.edge : null,
    edgeUnits,
    tier: recommendationTier(record),
    playGrade: recommendationPlayGrade(grade),
    hasPick,
  });
  const normalized = normalizeDailyEdgeActionability({
    market,
    rawVerdict: { key: verdict, label: labelForVerdict(verdict) },
    rawGrade: rawGradeForStoredGrade(grade),
    rawRecScore: recScore,
    modelMarketGapPct: typeof record.edge === "number" ? record.edge : null,
    marketReadV2: {
      movement: {
        directionRelativeToPick: movementDirectionRelativeToPick(record),
      },
    } as never,
    hasPick,
    held: record.held === true,
    dataQualityTier: recommendationTier(record),
    priceAmerican: record.odds_american,
    priceUnavailableAtLock: record.locked_at !== null && record.odds_american === null && hasPick,
  });
  return normalized.finalVerdict.key;
}

/**
 * Tracking must match the member-facing action grade, not just the raw writer
 * grade. A stored Best Angle whose boolean was explicitly demoted is not a Best
 * Angle in public tracking. Same-day deterministic guardrails are display-layer
 * grade caps, so public tracking buckets apply the same caps without mutating
 * prediction_records or prediction_grades.
 */
export function effectiveTrackingPlayGrade(record: PredictionRecordRow): string {
  let grade = storedGrade(record);
  if (grade === "best_angle" && record.best_angle === false) return "lean";
  grade = actionabilityGrade(record, grade);

  if (
    record.sport === "mlb" &&
    record.market === "first_inning" &&
    flagEnabled("MLB_FI_TOSSUP_FORCE_NO_PLAY_ENABLED") &&
    isTossUp(record)
  ) {
    return "no_play";
  }

  if (
    record.sport === "mlb" &&
    record.market === "first_inning" &&
    flagEnabled("MLB_FI_MISSING_PRICE_BLOCKS_GRADE_STRENGTHENING_ENABLED") &&
    record.odds_american === null &&
    (grade === "best_angle" || grade === "lean")
  ) {
    return "watchlist";
  }

  if (
    record.sport === "mlb" &&
    record.market === "total" &&
    flagEnabled("MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED") &&
    grade === "lean"
  ) {
    const gap = totalProjectionGap(record);
    if (gap !== null && gap < 0.5) return "watchlist";
  }

  if (
    record.sport === "mlb" &&
    record.market === "moneyline" &&
    flagEnabled("MLB_ML_BEST_ANGLE_MOVEMENT_EDGE_CAP_ENABLED") &&
    grade === "best_angle" &&
    (
      snapshotNumber(record, ["v2_2_audit", "ml_distance_cap_applied"]) === 1 ||
      (record.snapshot_json?.v2_2_audit as { ml_distance_cap_applied?: unknown } | undefined)?.ml_distance_cap_applied === true ||
      (record.snapshot_json?.v2_2_audit as { ml_miscalibration_flag?: unknown } | undefined)?.ml_miscalibration_flag === true
    )
  ) {
    return "lean";
  }

  if (
    record.sport === "mlb" &&
    record.market === "moneyline" &&
    flagEnabled("MLB_ML_BEST_ANGLE_MOVEMENT_EDGE_CAP_ENABLED") &&
    grade === "best_angle" &&
    isKnownMlMovementNotTowardPick(record) &&
    typeof record.edge === "number" &&
    record.edge < 8
  ) {
    return "lean";
  }

  return grade;
}

async function fetchAllPredictionRecords(
  supabase: SupabaseClient,
  opts: {
    sport?: TrackedSport;
    from?: string;
    to?: string;
  },
): Promise<{ rows: PredictionRecordRow[]; error: unknown | null }> {
  const out: PredictionRecordRow[] = [];
  for (let fromRow = 0; ; fromRow += TRACKING_PAGE_SIZE) {
    let query = supabase
      .from("prediction_records")
      .select("*")
      .order("id", { ascending: true })
      .range(fromRow, fromRow + TRACKING_PAGE_SIZE - 1);
    if (opts.sport !== undefined) query = query.eq("sport", opts.sport);
    if (opts.from !== undefined) query = query.gte("slate_date", opts.from);
    if (opts.to !== undefined) query = query.lte("slate_date", opts.to);
    const { data, error } = await query;
    if (error) return { rows: out, error };
    const page = (data ?? []) as PredictionRecordRow[];
    out.push(...page);
    if (page.length < TRACKING_PAGE_SIZE) break;
  }
  return { rows: out, error: null };
}

async function fetchGradesForRecordIds(
  supabase: SupabaseClient,
  recordIds: number[],
): Promise<PredictionGradeRow[]> {
  const out: PredictionGradeRow[] = [];
  for (let i = 0; i < recordIds.length; i += TRACKING_GRADE_ID_CHUNK_SIZE) {
    const ids = recordIds.slice(i, i + TRACKING_GRADE_ID_CHUNK_SIZE);
    const { data } = await supabase
      .from("prediction_grades")
      .select("*")
      .in("prediction_record_id", ids);
    out.push(...((data ?? []) as PredictionGradeRow[]));
  }
  return out;
}

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
    thisMonth: { from: "", to: "", overall: emptyMetrics(), bySportMarket: [] },
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

  // Records. Supabase/PostgREST caps un-ranged selects (commonly 1,000 rows).
  // Tracking is an all-time surface, so a plain `.select("*")` silently drops
  // newer slates once history grows. Page explicitly to keep Yesterday / Week /
  // Lifetime based on the full prediction_records table.
  const { rows: recordsRaw, error: recErr } = await fetchAllPredictionRecords(opts.supabase, {
    sport: opts.sport,
    from: opts.from,
    to: opts.to,
  });
  if (recErr) return result;
  result.rowsConsidered = recordsRaw.length;

  // Filter launch-day if requested
  const launchFiltered = opts.includeLaunchDay === true
    ? recordsRaw
    : recordsRaw.filter((r) => !r.launch_day);
  const publicStartFiltered = launchFiltered.filter((r) =>
    isPublicallyTracked(r.sport, r.slate_date),
  );

  // W-L accuracy counts EVERY prediction that has a side. `no_bet` is a GUIDANCE
  // signal ("we don't advise betting this"), NOT a tracking exclusion — a
  // stand-down total or model-wrong-side ML is still a graded right/wrong call
  // and must count toward the public W/L record. The ONLY thing withheld is a
  // genuine Toss-Up (no side at all), which is First-Inning-only. Toss-Ups also
  // carry a `void` grade, so they never reach wins/losses regardless; excluding
  // them here just keeps them out of the row counts entirely.
  //
  // ROI is a SEPARATE (HQ-only) metric and is where null-odds rows get dropped —
  // never conflate "ROI-ineligible" with "doesn't count for accuracy".
  const records = publicStartFiltered.filter((r) => !isTossUp(r));
  result.rowsCounted = records.length;
  if (records.length === 0) return result;

  // Grades — load only for the relevant record ids
  const recordIds = records.map((r) => r.id).filter((x): x is number => x !== undefined);
  const grades = await fetchGradesForRecordIds(opts.supabase, recordIds);
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
  result.byPlayGrade = groupBy((r) => effectiveTrackingPlayGrade(r.record) || "(none)");
  result.byConfidenceBucket = groupBy((r) => bucketForConfidence(r.record.confidence));
  result.byDataQualityTier = groupBy((r) => r.record.data_quality_tier ?? "(none)");

  // Best Angle vs Lean cuts. 2026-06-15: key both off the canonical
  // play_grade, case-insensitive — ONE source of truth. Previously the Best
  // Angle cut used the `best_angle` boolean (which desynced from play_grade on
  // 25 MLB rows → dropped from BA tracking) and the Lean cut was lowercase-only
  // (so soccer's capital "Lean" was silently dropped). play_grade is what the
  // card grades on, so it's the authoritative tier.
  const grade = (r: Row): string => effectiveTrackingPlayGrade(r.record);

  // Best Angle / Lean measure how our ACTUAL recommendations performed, so they
  // stay actionable-only — a `no_bet` stand-down is not advice we gave (it counts
  // for accuracy above, just not in these recommendation-performance cuts).
  const bestRows = rows.filter((r) => r.record.no_bet !== true && grade(r) === "best_angle");
  for (const row of bestRows) accumulate(result.bestAngles, row);
  finalize(result.bestAngles, bestRows);

  const leanRows = rows.filter((r) => r.record.no_bet !== true && grade(r) === "lean");
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
    // Toss-Up rows are excluded upstream (records.filter((r) => !isTossUp(r))),
    // and all FI `no_bet` rows are Toss-Ups, so these NRFI/YRFI buckets only
    // ever see actionable first-inning picks.
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
      const bestRs = rs.filter((r) => r.record.no_bet !== true && grade(r) === "best_angle");
      for (const r of bestRs) accumulate(ba, r);
      finalize(ba, bestRs);
      const le = emptyMetrics();
      const leanRs = rs.filter((r) => r.record.no_bet !== true && grade(r) === "lean");
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

  // This-month slice. Floored at LAUNCH (2026-06-07): "Monthly" starts at launch
  // and grows day-by-day until the trailing-30-day window naturally catches up
  // (~30 days post-launch). Never extend the window before launch — there's no
  // data there and the label would be misleading.
  const TRACKING_LAUNCH_DATE = "2026-06-07";
  const trailing30From = shiftDate(today, -29);
  const monthFrom = trailing30From > TRACKING_LAUNCH_DATE ? trailing30From : TRACKING_LAUNCH_DATE;
  const monthRows = rows.filter((r) => r.record.slate_date >= monthFrom && r.record.slate_date <= today);
  result.thisMonth.from = monthFrom;
  result.thisMonth.to = today;
  if (monthRows.length > 0) {
    for (const r of monthRows) accumulate(result.thisMonth.overall, r);
    finalize(result.thisMonth.overall, monthRows);
    result.thisMonth.bySportMarket = buildSportMarketBuckets(monthRows);
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
      best_angle: String(r.record.play_grade ?? "").trim().toLowerCase() === "best_angle" && r.record.best_angle !== false,
      held: r.record.held === true,
    }));

  // 6B.21 — Recently settled feed. Settled-only (no pending), ordered
  // by prediction_grades.graded_at DESC, limit 20. Toss-Up rows are
  // excluded upstream; `no_bet` stand-downs DO appear here (they are real
  // graded calls — the W/L tally counts them, so the settled feed reflects
  // them too). launch_day rows are already excluded. Slate_date is preserved
  // so the per-day rollups in dailyTrend/yesterday/thisWeek stay in sync.
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
        best_angle: String(r.record.play_grade ?? "").trim().toLowerCase() === "best_angle" && r.record.best_angle !== false,
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
