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
