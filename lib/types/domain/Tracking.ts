import type { Sport } from "./Sport";
import type { SignalType, SourceType } from "./Grade";

/** Outcome of a resolved prediction. */
export type PredictionOutcome = "win" | "loss" | "push" | "void";

/** Discriminator on `prediction_results.prediction_type`. */
export type PredictionType = "game_ml" | "game_total" | "game_nrfi" | "prop";

/** Time-window labels used by tracking aggregates. */
export type TimeWindow = "yesterday" | "this_week" | "season" | "all_time";

/** Tracking market labels — shorter than line `market_type`. */
export type TrackingMarket =
  | "ml"
  | "total"
  | "nrfi"
  | "yrfi"
  | "prop_hits"
  | "prop_total_bases"
  | "prop_home_runs"
  | "prop_rbis"
  | "prop_strikeouts"
  | "prop_earned_runs"
  | "prop_hits_allowed"
  | (string & {});

/**
 * Mirrors the `prediction_results` table.
 *
 * Schema V7/V11 fields (Phase 6.3a):
 *   • signal_type — carried forward from the prediction at resolve time so
 *     tracking can pivot historical W/L by signal source without rejoining
 *     a predictions table that gets regenerated each slate.
 *   • source_type — provenance carried forward likewise. NOT NULL with
 *     DB DEFAULT 'mock'; existing rows backfilled to 'mock'.
 */
export type PredictionResult = {
  id: number;
  prediction_type: PredictionType;
  game_prediction_id: number | null;
  prop_prediction_id: number | null;
  outcome: PredictionOutcome;
  actual_value: number | null;
  predicted_side: string | null;
  sport: Sport;
  market: TrackingMarket;
  resolved_at: string;
  game_date: string; // YYYY-MM-DD
  // Closing Line Value
  bet_odds_american: number | null;
  closing_odds_american: number | null;
  clv_pct: number | null;
  beat_closing_line: boolean | null;
  // V2.1 attribution (V7) + provenance (V11) carried forward from the prediction
  signal_type: SignalType | null;
  source_type: SourceType;
  created_at: string;
};

/**
 * Mirrors the `tracking_aggregates` table — pre-computed W/L totals.
 * Refreshed via `post-game-results` cron after game resolution.
 */
export type TrackingAggregate = {
  id: number;
  sport: Sport;
  market: TrackingMarket;
  time_window: TimeWindow;
  window_start: string | null; // YYYY-MM-DD
  window_end: string | null; // YYYY-MM-DD
  wins: number;
  losses: number;
  pushes: number;
  total: number;
  hit_rate: number | null; // 0-100 (e.g., 56.8)
  computed_at: string;
};

// ═══════════════════════════════════════════════════════════════════
// Push 4 — Tracking foundation (schema-migration-v17)
// ═══════════════════════════════════════════════════════════════════
//
// These types mirror schema-migration-v17.sql exactly. They live
// alongside the legacy Phase 6.3a types above (which reference the
// older `prediction_results` + `tracking_aggregates` tables) without
// touching them — additive, never destructive. The new launch model
// (V2.1+) writes to these new tables; legacy callers continue to
// read the old types until they're migrated separately.
//
// Naming discipline:
//   - `TrackedSport`, `TrackedMarket` are deliberately distinct from
//     the legacy `Sport` and `TrackingMarket` unions. They map to
//     the v17 SQL CHECK-like constraints and the CSV importer.
//   - Row types end in `Row` to signal they are DB-shape (snake_case
//     fields) not domain models.

export type TrackedSport =
  | "mlb"
  | "nfl"
  | "nba"
  | "cfb"
  | "cbb"
  | "nhl"
  | "ucl"
  | "soccer"
  | "wnba";

/**
 * Tracked markets enum (v17). Additive — new entries widen the union
 * without affecting existing callers.
 *
 * 2026-06-11 — WC-1 additions for soccer launch markets:
 *   - "match_result"  — 3-way result (Home / Draw / Away), graded by
 *     90-minute regulation / full-time score only. Knockouts MUST NOT
 *     resolve "match_result" via extra time or penalties.
 *   - "btts"          — Both Teams To Score (Yes / No), graded by
 *     90-minute regulation / full-time score only.
 *   - "double_chance" — Two-of-three outcomes (1X / X2 / 12), graded by
 *     90-minute regulation / full-time score only. Pre-existed in this
 *     union for UCL substrate; WC-1 promotes it to a soccer official
 *     tracked market because the tracking page already carries a
 *     "Double Chance" column.
 *
 * "total" is reused for soccer total goals (canonical line 2.5).
 *
 * Soccer DOES NOT use "moneyline" because soccer is 3-way (draw is a
 * first-class outcome). Forcing soccer into the 2-way "moneyline" enum
 * would erase the draw and is explicitly out of contract.
 */
export type TrackedMarketV17 =
  | "moneyline"
  | "total"
  | "first_inning"
  | "nrfi"
  | "yrfi"
  | "double_chance"
  | "spread"
  | "match_result"
  | "btts";

export type GradeResult = "win" | "loss" | "push" | "void" | "pending";

export type ConfidenceBucket =
  | "lt_50"
  | "50_52"
  | "53_55"
  | "56_58"
  | "59_62"
  | "gte_63";

/** Numeric thresholds for ConfidenceBucket — exported for callers. */
export const CONFIDENCE_BUCKET_RANGES: ReadonlyArray<{
  label: ConfidenceBucket;
  display: string;
  min: number;
  max: number;
}> = [
  { label: "lt_50", display: "<50%", min: 0, max: 50 },
  { label: "50_52", display: "50–52%", min: 50, max: 52.999 },
  { label: "53_55", display: "53–55%", min: 53, max: 55.999 },
  { label: "56_58", display: "56–58%", min: 56, max: 58.999 },
  { label: "59_62", display: "59–62%", min: 59, max: 62.999 },
  { label: "gte_63", display: "63%+", min: 63, max: 100 },
];

export function bucketForConfidence(
  conf: number | null | undefined,
): ConfidenceBucket {
  if (conf === null || conf === undefined) return "lt_50";
  if (conf < 50) return "lt_50";
  if (conf <= 52.999) return "50_52";
  if (conf <= 55.999) return "53_55";
  if (conf <= 58.999) return "56_58";
  if (conf <= 62.999) return "59_62";
  return "gte_63";
}

// ─── Table-shape types ────────────────────────────────────────────

/** Mirrors `tracking_baselines` row in schema-migration-v17.sql. */
export type TrackingBaselineRow = {
  id?: number;
  source_label: string;
  sport: TrackedSport;
  market: TrackedMarketV17;
  model_family: string;
  lifetime_wins: number;
  lifetime_total: number;
  lifetime_pct: number;
  current_season_wins: number | null;
  current_season_total: number | null;
  current_season_pct: number | null;
  weekly_wins: number | null;
  weekly_total: number | null;
  weekly_pct: number | null;
  imported_from: string;
  imported_at?: string;
  notes?: Record<string, unknown> | null;
};

/** Mirrors `prediction_records` row in schema-migration-v17.sql.
 *
 * v18 (Phase 7H): `game_prediction_id` is now nullable — NBA writes
 * tracking rows directly from the NBA pipeline without a corresponding
 * `game_predictions` row. MLB rows continue to populate the column.
 * See `lib/db/schema-migration-v18.sql`.
 */
export type PredictionRecordRow = {
  id?: number;
  game_prediction_id: number | null;
  game_id: number;
  external_id: number;
  sport: TrackedSport;
  slate_date: string;
  game_date: string | null;
  matchup: string;
  market: TrackedMarketV17;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  model_used: string | null;
  model_version: string | null;
  prediction_source: string | null;
  confidence: number | null;
  model_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  expected_value: number | null;
  play_grade: string | null;
  prediction_type: string | null;
  best_angle: boolean;
  no_bet: boolean;
  no_bet_reason: string | null;
  market_aligned: boolean;
  data_quality_tier: string | null;
  source_quality: string | null;
  provisional: boolean;
  held: boolean;
  hold_reason: string | null;
  launch_day: boolean;
  manual_outcome_expected: boolean;
  locked_at: string | null;
  published_at: string | null;
  created_at?: string;
  /** Projected JSON field used by bounded aggregate queries that intentionally
   * avoid transferring the complete snapshot_json payload. */
  competition?: string | null;
  snapshot_json: Record<string, unknown> | null;
  /**
   * Phase 6B.21 / 7A prep — tag for the calibration version active at
   * lock time. NULL through V1 launch and 7A shadow stages. Populated
   * by Phase 7A Stage 4 once guarded auto-apply is enabled. Never
   * backfilled. Optional in the type because the schema-v18 column is
   * added as nullable and may not yet be present in stale environments.
   */
  calibration_version?: string | null;
};

/** Mirrors `prediction_grades` row in schema-migration-v17.sql. */
export type PredictionGradeRow = {
  id?: number;
  prediction_record_id: number;
  game_id: number;
  market: TrackedMarketV17;
  result: GradeResult;
  push: boolean;
  win: boolean;
  loss: boolean;
  void: boolean;
  pending: boolean;
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_total: number | null;
  actual_first_inning_runs: number | null;
  winning_team: string | null;
  graded_at?: string;
  grade_source: "auto_score_ingest" | "manual_operator" | "csv_import";
  grade_notes: string | null;
};

/** Marker so callers can identify when a query result targets the new schema. */
export const TRACKING_V17_SCHEMA_VERSION = 17 as const;
