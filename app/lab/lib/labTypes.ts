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
 * Game-level sharp-signal verdict, locked to THREE states per the
 * locked UI spec (planning-docs/07-locked-ui-specs.md §4):
 *
 *   • "strong"  — at least one market has a confirming sharp signal AND no
 *                 contradicting signal. Renders as the green banner.
 *   • "caution" — at least one market has a contradicting signal. Wins over
 *                 "strong" — caution is a red flag and stays visible. Renders
 *                 as the amber/rose banner.
 *   • null      — no sharp signals on any market. No banner at all. This is
 *                 the DEFAULT state for most games — absence of signal is
 *                 NOT a negative signal.
 *
 * Replaces the pre-5F.1 4-tier model (triple_lock/strong/lean/caution) which
 * conflated "no data" with "negative signal" and showed CAUTION on every
 * game without sharp_signals rows.
 *
 * Computed SERVER-SIDE per Decision G. UI components do not re-derive.
 */
export type DailyEdgeVerdict = "strong" | "caution" | null;

export type DailyEdgePredictionDto = {
  /** Display label: ML → team abbr, total → "Over"/"Under", NRFI → "NRFI"/"YRFI"/"Toss-Up". */
  pick: string;
  /** 0..1 (server normalizes the 0..100 column). */
  confidence: number;
  sharpStatus: SharpStatus;
};

export type DailyEdgeTotalPredictionDto = DailyEdgePredictionDto & {
  /**
   * Actual SPORTSBOOK total line (5F.1) — what members would bet on.
   * Falls back to the model projection when no lines.total row exists.
   */
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
  /** Three-state verdict — null when no banner should render (most games). */
  verdict: DailyEdgeVerdict;
  /** Short brand-voice subtitle for the banner — null when verdict is null. */
  verdictSubtitle: string | null;
};

export type DailyEdgeResponse = {
  as_of: string;
  sport: Sport;
  /**
   * The slate_date the response is for — equals `requested_date` when games
   * exist on it, otherwise the most recent slate_date with games (fallback).
   */
  date: string;
  /** What the caller asked for (URL ?date= or auto-today). */
  requested_date: string;
  /** True when `date !== requested_date` (server fell back to most recent slate). */
  fallback_used: boolean;
  games: DailyEdgeGameDto[];
};

// ───────────────────────────────────────────────────────────────────────────
// /api/lab/player-props
// ───────────────────────────────────────────────────────────────────────────

export type PropTier = "premium" | "strong" | "good" | "skip";

export type PlayerDto = {
  id: string;
  name: string;
  /** Team abbreviation (e.g., "NYY"). */
  team: string;
  /** Display string: "vs OPP" for home, "@ OPP" for away. */
  opponent: string;
  /** ET time string (e.g., "7:10 PM"). */
  gameTime: string;
  /** Position abbreviation (e.g., "RF", "SP"). */
  position: string;
};

export type PlayerPropDto = {
  /** Stable identifier — `prop_predictions.id` as string. */
  id: string;
  sport: Sport;
  player: PlayerDto;
  /** UI prop-type key (e.g., "hits"), translated from DB `prop_market`. */
  propType: string;
  line: number;
  side: "over" | "under";
  /** ±NNN American odds string. */
  odds: string;
  /**
   * Count of "win" outcomes over the player's last N resolved predictions for
   * the same `prop_market`. May be fewer than 10 — see `recent10.length`.
   */
  hitsLast10: number;
  /**
   * Outcome pattern: true = win, false = loss, ordered oldest-first to
   * newest-last. Length is 0..10 based on available history.
   */
  recent10: boolean[];
  /** Absolute edge as 0..1 decimal. Always positive on the recommended side. */
  edge: number;
  /** Signed edge_pct/100 — preserves direction info for honest display. */
  edgeRaw: number;
  tier: PropTier;
  /** Categorical context tags (e.g., "hot", "vs_lhp"). V1: always empty. */
  signals: string[];
};

export type PlayerPropsResponse = {
  as_of: string;
  sport: Sport;
  /** Slate the response is for (equals requested_date or fallback). */
  date: string;
  requested_date: string;
  fallback_used: boolean;
  filters: {
    prop_market: string | null;
    tiers: PropTier[];
    minEdge: number;
    signals: string[];
    player_id: string | null;
  };
  entries: PlayerPropDto[];
};

// ───────────────────────────────────────────────────────────────────────────
// /api/lab/tracking
// ───────────────────────────────────────────────────────────────────────────

export type WindowTally = {
  wins: number;
  losses: number;
  pushes: number;
  total: number;
  /** wins / (wins + losses), 0..1; 0 if no decided picks. */
  hitRate: number;
};

export type SportMarketTally = {
  sport: Sport;
  /** UI-facing market label (ML, O/U, NRFI, YRFI, NRFI/YRFI, etc.). */
  market: string;
  lifetime: WindowTally;
  /** Current season tally; null if no data this season. */
  currentSeason: WindowTally | null;
  /** Last-7-days tally; null if no activity. */
  weekly: WindowTally | null;
};

export type DailyMarketResult = {
  sport: Sport;
  market: string;
  wins: number;
  losses: number;
  pushes: number;
  total: number;
};

export type DailyRecap = {
  /** YYYY-MM-DD of the day shown. */
  date: string;
  /** Display label, e.g., "May 21". */
  label: string;
  /** True when `date` is calendar-yesterday; false when we fell back to the most recent day with data. */
  isYesterday: boolean;
  results: DailyMarketResult[];
  totalPicks: number;
  totalWins: number;
  totalLosses: number;
  hitRate: number;
};

export type WeeklyAggregate = {
  /** YYYY-MM-DD inclusive. */
  weekStart: string;
  weekEnd: string;
  /** "May 16" — display labels. */
  weekStartLabel: string;
  weekEndLabel: string;
  totalPicks: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
};

export type DailyHitRatePoint = {
  date: string;
  picks: number;
  wins: number;
  hitRate: number;
};

export type LastThirtyDays = {
  days: DailyHitRatePoint[];
  aggregate: {
    picks: number;
    wins: number;
    losses: number;
    hitRate: number;
  };
  bestDay: { date: string; dateLabel: string; record: string } | null;
  worstDay: { date: string; dateLabel: string; record: string } | null;
  mostPicks: { date: string; dateLabel: string; count: number } | null;
};

export type AllTimeAggregate = {
  totalPredictions: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
};

export type Streak = {
  /** "W" = consecutive winning days, "L" = consecutive losing days, "NONE" = no activity. */
  type: "W" | "L" | "NONE";
  count: number;
  description: string;
};

export type TrackingResponse = {
  as_of: string;
  /** Sports that appear in `tallies` in display order. */
  sportOrder: Sport[];
  yesterdayRecap: DailyRecap;
  weeklyAggregate: WeeklyAggregate;
  last30Days: LastThirtyDays;
  allTimeAggregate: AllTimeAggregate;
  streak: Streak;
  tallies: SportMarketTally[];
};

// ───────────────────────────────────────────────────────────────────────────
// /api/lab/calibration
// ───────────────────────────────────────────────────────────────────────────

/**
 * Game-level prediction types only — Phase 5C locked the V1 launch decision
 * to EXCLUDE prop calibration from the Tracking page. The prop model is
 * unproven; raw W-L on binary props at ~10-15% baseline looks bad even when
 * edge is good. Surface again in Phase 9+ with ROI/CLV-based tracking.
 */
export type CalibrationPredictionType = "game_ml" | "game_total" | "game_nrfi";

export type CalibrationBucket = {
  sport: Sport;
  predictionType: CalibrationPredictionType;
  market: string | null;
  /** "55-60%", "60-70%", etc. */
  label: string;
  bucketLower: number;
  bucketUpper: number;
  sampleSize: number;
  /** 0..1, mid-point of the bucket (e.g., 0.65 for 60-70%). */
  expectedHitRate: number;
  /** 0..1, observed. */
  actualHitRate: number;
  /** Signed percentage-point delta (actual - expected), e.g., -7.13. */
  calibrationDelta: number;
  /** time_window column: 'all_time' | 'season' | 'this_week'. */
  timeWindow: "all_time" | "season" | "this_week";
};

export type CalibrationHeadline = {
  /** Bucket with the biggest sample-weighted miss (most newsworthy "we admit"). */
  bucket: CalibrationBucket;
  /** Plain-English summary, e.g., "When we say 60% confidence on game moneylines, we hit 57% of the time." */
  summary: string;
};

export type CalibrationResponse = {
  as_of: string;
  /** Lifetime buckets only — `time_window='all_time'`. The other windows are exposed for future drill-downs. */
  buckets: CalibrationBucket[];
  /** Auto-selected headline finding for the hero callout. Null when no displayable bucket has the minimum sample size. */
  headline: CalibrationHeadline | null;
};
