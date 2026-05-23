/**
 * Shared response types for the Lab's internal REST API (/api/lab/*).
 *
 * One file per endpoint shape. Hooks in /app/lab/hooks/* and route handlers
 * in /app/api/lab/* import these so the wire contract stays in sync.
 *
 * Phase 5 endpoints land here as they are built:
 *   • /api/lab/refresh-status   → RefreshStatusResponse (5A)
 *   • /api/lab/daily-edge       → DailyEdgeResponse     (5B)
 *   • /api/lab/player-props     → PlayerPropsResponse   (5C)
 *   • /api/lab/tracking         → TrackingResponse      (5D)
 *   • /api/lab/calibration      → CalibrationResponse   (5E)
 */

import type { Sport } from "@/lib/types/domain/Sport";

// ───────────────────────────────────────────────────────────────────────────
// /api/lab/refresh-status
// ───────────────────────────────────────────────────────────────────────────

/**
 * The four UI-facing states a data source (or the overall pipeline) can be in.
 *   • live      — completed recently, within its expected cadence
 *   • updating  — a refresh is currently in_progress
 *   • stale     — completed but older than 2× the expected cadence
 *   • error     — most recent completed run was 'failed'
 *   • unknown   — no row has ever been written for this source
 */
export type RefreshState = "live" | "updating" | "stale" | "error" | "unknown";

export type RefreshSource = {
  data_source: string;
  sport: Sport | null;
  last_started_at: string | null;
  last_completed_at: string | null;
  last_status: "success" | "partial" | "failed" | "in_progress" | null;
  records_updated: number | null;
  expected_cadence_minutes: number;
  /** Minutes since `last_completed_at`. Null if never completed. */
  age_minutes: number | null;
  state: RefreshState;
};

export type RefreshStatusResponse = {
  /** Server timestamp this response was assembled at. */
  as_of: string;
  /** Sport scope of the response (null = cross-sport view). */
  sport: Sport | null;
  /**
   * Aggregate state for the "frontline" refresh pipeline (the cycle crons
   * users see most directly). RefreshIndicator binds to this.
   */
  overall: {
    state: RefreshState;
    /** Most recent completion across frontline sources for `sport`. */
    last_updated_at: string | null;
    age_seconds: number | null;
    /** Earliest upcoming scheduled_next_refresh across frontline sources. */
    next_scheduled_at: string | null;
  };
  /** Per-source detail — drives HowWeUpdatePanel + the cron-status admin page. */
  sources: RefreshSource[];
};

// ───────────────────────────────────────────────────────────────────────────
// /api/lab/daily-edge
// ───────────────────────────────────────────────────────────────────────────

/**
 * Per-market sharp posture relative to the model's pick.
 *   • confirm — a sharp_signals row exists with signal_strength="strong" on
 *               the same side our model picked
 *   • caution — sharps are flagged as caution on our side, OR sharps are
 *               strong on the opposite side
 *   • mixed   — no actionable signal for this market
 */
export type SharpStatus = "confirm" | "mixed" | "caution";

/**
 * Game-level verdict aggregated from per-market sharpStatus values. Mirrors
 * the V1 mock's tiering so the existing card visuals stay intact. Computed
 * SERVER-SIDE per Decision G — UI components do not re-derive.
 */
export type DailyEdgeVerdict = "triple_lock" | "strong" | "lean" | "caution";

export type DailyEdgePredictionDto = {
  /** Display label: ML → team abbr, total → "Over"/"Under", NRFI → "NRFI"/"YRFI"/"Toss-Up". */
  pick: string;
  /** 0..1 (server normalizes the 0..100 column). */
  confidence: number;
  sharpStatus: SharpStatus;
};

export type DailyEdgeTotalPredictionDto = DailyEdgePredictionDto & {
  /** O/U line (e.g., 8.5). */
  line: number;
};

export type SharpSignalCategory =
  | "pinnacle_agree"
  | "pinnacle_disagree"
  | "line_move_toward"
  | "line_move_away"
  | "steam"
  | "handle_gap"
  | "context_weather"
  | "context_park"
  | "no_signal";

export type SharpSignalDto = {
  /** UI label: ML / OU / NRFI. */
  market: "ML" | "OU" | "NRFI";
  category: SharpSignalCategory;
  description: string;
  source?: string;
  /** Relative-time string for display (e.g., "3H AGO"). */
  timestamp?: string;
  direction: "positive" | "negative" | "neutral";
};

export type DailyEdgeGameDto = {
  /** Stable ID for React keys: `${sport}-${external_id}`. */
  id: string;
  sport: Sport;
  external_id: number;
  awayTeam: string;
  homeTeam: string;
  /** Display string in ET (e.g., "7:10 PM"). */
  gameTime: string;
  /** Minutes-from-midnight-ET for sort stability. */
  gameStartMinutes: number;
  predictions: {
    ml: DailyEdgePredictionDto;
    total: DailyEdgeTotalPredictionDto;
    nrfi: DailyEdgePredictionDto;
  };
  projected: { away: number; home: number };
  sharpSignals: SharpSignalDto[];
  verdict: DailyEdgeVerdict;
  verdictSubtitle: string;
};

export type DailyEdgeResponse = {
  as_of: string;
  sport: Sport;
  /** Slate date in YYYY-MM-DD (request param or default). */
  date: string;
  games: DailyEdgeGameDto[];
};
