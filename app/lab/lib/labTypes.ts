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
import type {
  Grade,
  MarketSignal,
  SignalType,
} from "@/lib/types/domain/Grade";
import type { Verdict } from "@/lib/services/verdictDerivation";
import type { SharpReadKey } from "@/lib/services/sharpReadSelector";

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
 * Per-market sharp posture relative to the model's pick. Drives the
 * per-tile ✓ / — / ⚠ icon on the three pick tiles.
 *   • confirm — a sharp_signals row exists with signal_strength="strong" on
 *               the same side our model picked
 *   • caution — sharps are flagged as caution on our side, OR sharps are
 *               strong on the opposite side
 *   • mixed   — no actionable signal for this market
 */
export type SharpStatus = "confirm" | "mixed" | "caution";

export type DailyEdgePredictionDto = {
  /**
   * Display label: ML → team abbr, total → "Over"/"Under", NRFI →
   * "NRFI"/"YRFI"/"Toss-Up".
   *
   * Phase 4.2.C.2 — null when the auto-model held this market. Pre-4.2.C.2
   * the route surfaced fake defaults (home team / "Under" / "NRFI") for
   * held games, which caused the "all games look the same" bug on the
   * 2026-06-03 smoke. Held games now pass null through. The canonical
   * member-facing path is the per-market `markets.{ml,total,first_inning}`
   * block (which carries the per-market `held` flag and renders cleanly);
   * this legacy `predictions.*` block is kept as a back-compat surface
   * for any consumers that haven't migrated.
   */
  pick: string | null;
  /** 0..1 (server normalizes the 0..100 column). Null when held. */
  confidence: number | null;
  sharpStatus: SharpStatus;
  /**
   * V2.1.1 per-pick grade fields (Phase 6.3.5c). Populated from the
   * per-pick columns added by schema-migration-v13.sql:
   *   ml.*   ← game_predictions.ml_*
   *   total.*← game_predictions.ou_*   (note name asymmetry — preserved
   *                                     from pre-6.3.5 pattern where the
   *                                     DB column uses "ou_" prefix while
   *                                     the DTO surface calls the market
   *                                     "total")
   *   nrfi.* ← game_predictions.nrfi_*
   *
   * All three fields NULL together when the model didn't pick this market
   * (predicted_<market>_* IS NULL upstream). Consumers should treat the
   * triplet as atomic — never one populated while another is null.
   */
  grade: Grade | null;
  signalType: SignalType | null;
  marketSignal: MarketSignal | null;
};

export type DailyEdgeTotalPredictionDto = DailyEdgePredictionDto & {
  /**
   * Actual SPORTSBOOK total line (5F.1) — what members would bet on.
   *
   * Fix 7.2.5: nullable. Priority chain in the route:
   *   1. lines table sportsbook total (Pinnacle preferred)
   *   2. game_predictions.sport_specific.listed_line
   *      (operator-entered at upload; MLB optional field)
   *   3. null — UI renders the side alone ("Under") rather than
   *      misleadingly substituting predicted_total (the model
   *      projection, which is a DIFFERENT concept from a market line).
   */
  line: number | null;
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

// ───────────────────────────────────────────────────────────────────────────
// 4.1.10 — per-market enrichment DTO types
// ───────────────────────────────────────────────────────────────────────────

/**
 * One stat row for the v13.1 KeyStats panel. Beginner-formatted by
 * keyStatsFormatter — never raw multipliers like 1.08.
 *
 * `awayValue` may be null when the stat is a single-game-level value
 * (e.g., park factor) rather than a per-side value. UI renders only
 * the `homeValue` cell in that case.
 */
export type KeyStatRow = {
  label: string;
  awayValue: string | null;
  homeValue: string | null;
  source: "feature_snapshot" | "computed";
};

/**
 * Per-market enriched edge data — the v13.1 Daily Edge card consumes
 * this shape for each of moneyline / total / first_inning. The shape
 * mirrors the existing `DailyEdgePredictionDto` but adds the verdict,
 * beginner copy, edge-stack quantification, and KeyStats.
 *
 * Nulls mean "data unavailable" — the UI must render honest fallback
 * copy ("No public split data", "Open price unavailable", etc.) rather
 * than substituting other fields.
 */
export type MarketEdgeDto = {
  // ── existing per-pick fields (preserved from DailyEdgePredictionDto) ──
  pick: string | null;
  /**
   * Phase 4.2.C.2 — nullable confidence. When the model holds this market
   * (held=true), `pick`, `confidence`, and `grade` are ALL null. The UI
   * renders "—" instead of fake "0%". Pre-4.2.C.2 this field was `number`
   * with confidence defaulted to 0 for held markets, which surfaced as a
   * misleading "0%" label.
   */
  confidence: number | null;
  grade: Grade | null;
  signalType: SignalType | null;
  marketSignal: MarketSignal | null;
  sharpStatus: SharpStatus;

  /**
   * Phase 4.2.C.2 — per-market held flag. True when the auto-model held
   * this specific market (i.e., `sport_specific.held === true` AND this
   * market key is in `sport_specific.hold_picks`). Held markets:
   *   • carry pick=null, confidence=null, grade=null
   *   • route to verdict.key="no_play" via verdictDerivation
   *   • render as "Held" in the UI, not as a fake default pick
   * Held is per-market: a game can have ML held while Total is playable.
   * For the typical "all 3 held" case (every market in hold_picks), the
   * DailyEdgeGameDto.holdReason carries the model's reason string.
   */
  held: boolean;

  // ── 4.1.10 per-market verdict ──
  verdict: { key: Verdict; label: string };

  // ── 4.1.10 server-generated beginner copy (banned-terms-linted) ──
  guidedGuide: string;
  guidedWatchOut: string;
  whyLine: string;
  riskLine: string;

  // ── 4.1.10 edge-stack quantification (nulls allowed) ──
  modelProb: number | null;
  marketFairProb: number | null;
  pinnacleEvPct: number | null;
  moneyPct: number | null;
  betsPct: number | null;
  /**
   * Phase 4.2.C.1.R-13C — both sides' public splits for this market.
   * Pre-R-13C the DTO only carried the model-picked side's
   * `moneyPct` / `betsPct`, hiding the opposing side's public bet
   * even when SharpAPI returned it. This array carries up to 2 rows
   * keyed by side ("home"/"away" for ML/spread, "over"/"under" for
   * total). Each row's moneyPct or betsPct is null when the
   * provider didn't report that field — the UI shows "not reported"
   * for those instead of dropping the side. Empty array when no
   * sharp_signals rows exist for this (game, market), or for the
   * first-inning market (provider doesn't offer FI splits).
   *
   * `moneyPct` / `betsPct` above (picked-side scalars) are
   * preserved for back-compat with existing MarketPulse callers.
   */
  publicSplits: Array<{
    side: "home" | "away" | "over" | "under";
    /** Member-facing side label ("PHI", "SD", "Over", "Under"). */
    label: string;
    moneyPct: number | null;
    betsPct: number | null;
    /**
     * Phase 7I (Last Known Good) — ISO timestamp of when this split was
     * last observed. Optional; populated only when the value came from
     * `sharp_signals_history` fallback (current row was null). Used by
     * the UI to render "Last updated …" copy on stale-but-valid values.
     */
    observedAt?: string | null;
    /** Phase 7I — true when observedAt is older than the stale threshold. */
    isStale?: boolean;
  }>;
  priceAmerican: number | null;
  lineOpenAmerican: number | null;
  /**
   * Lock-snapshot honesty flag (2026-06-09 lock-contract fix).
   * True only when the market is locked AND no usable real-book price
   * was captured in the lock snapshot AND no pre-lock real-book row
   * is available from `line_history`. Used by the UI to render an
   * explicit "No price recorded at lock" label instead of a blank
   * price chip. This is a last-resort fallback — with Forward Fix A
   * (writer `line_history` fallback) in place, this should rarely
   * surface. Never true for unlocked markets.
   */
  priceUnavailableAtLock?: boolean;
  /**
   * Phase 7I (Last Known Good) — observation timestamps for the price
   * fields. Optional; populated when the value came from `line_history`
   * fallback (current `lines` row was null/missing). Null/undefined
   * means the value is fresh from the current `lines` row.
   */
  priceObservedAt?: string | null;
  priceIsStale?: boolean;
  lineOpenObservedAt?: string | null;
  lineOpenIsStale?: boolean;
  /** Picked-side scalar splits stamps — mirror publicSplits per-item stamps. */
  moneyPctObservedAt?: string | null;
  moneyPctIsStale?: boolean;
  betsPctObservedAt?: string | null;
  betsPctIsStale?: boolean;

  /**
   * Line-tracker stops (2026-06-16, WebSocket streaming foundation).
   * ADDITIVE + optional → cards degrade to today's "Open → Current" when
   * these are absent (stream tables not yet populated). Member-facing labels
   * are Open / First Published / Current / Locked.
   *   • Open    = lineOpenAmerican (existing)
   *   • Current = priceAmerican (existing; the route overlays the fresher of
   *               cron `lines` and live `odds_current_stream` into it)
   *   • First Published = the picked-side price when we FIRST generated a
   *               prediction for this market (set-if-null upstream). Internal
   *               storage is `posted_*`; never surfaced as "OddSphere posted".
   *   • Locked  = the picked-side price frozen at T-60 lock (from the locked
   *               prediction snapshot, NOT live/current odds).
   */
  oddspherePostedAmerican?: number | null;
  oddspherePostedAt?: string | null;
  lockedLineAmerican?: number | null;
  lockedLineAt?: string | null;

  /**
   * Live market-intelligence (2026-06-16). Derived (display/audit only — no
   * pick/grade impact). `marketInterpretation` is the compact chip + expanded
   * detail from lib/streaming/marketInterpretation. `lastMove*` are the most
   * recent picked-side price change (the "Previous → Current" timeline stop).
   * All optional → cards degrade cleanly when streaming tables are empty.
   */
  marketInterpretation?: {
    chipLabel: string;
    chipTone: "emerald" | "amber" | "gray";
    flags: string[];
    detail: string[];
  } | null;
  lastMovePrevAmerican?: number | null;
  lastMoveNextAmerican?: number | null;
  lastMoveAtIso?: string | null;
  /** Actual LINE/point move on the last move (e.g. total 8.5 → 9). Null for
   * moneyline or when the line didn't change. Reader-only display. */
  lastMoveLinePrev?: number | null;
  lastMoveLineNext?: number | null;

  // ── totals-only (null for moneyline / first_inning) ──
  modelTotal: number | null;
  marketTotal: number | null;
  line: number | null;

  // ── 4.1.10 KeyStats panel input ──
  keyStats: KeyStatRow[];

  // ─────────────────────────────────────────────────────────────
  // Phase 4.2.C.1.R-14C1 — Model / Market / Take strip
  // ─────────────────────────────────────────────────────────────
  /**
   * Reviewed model confidence on a 0..100 scale. Same numeric value as
   * `confidence * 100` but exposed as an explicit `modelTrustPct` so
   * the strip and the verdict layer can read distinct fields. Null when
   * the market is held.
   */
  modelTrustPct: number | null;
  /**
   * No-vig market-implied probability for the model's picked side, in
   * percent (0..100). Computed once per game from a two-sided
   * consensus book (Pinnacle preferred, then DraftKings, then
   * available books). Null when fewer than both sides are available,
   * or for first-inning where no market data exists.
   */
  marketImpliedPct: number | null;
  /**
   * `modelTrustPct − marketImpliedPct` in percentage points. Positive
   * means the model trusts the pick more than the market prices it.
   * Null when either input is null — the UI MUST render "—" instead
   * of guessing a gap. Read-only stat, not a calibrated edge.
   */
  modelMarketGapPct: number | null;
  /**
   * Push 3C-2 (Phase 6B.1.6m) — Recommendation Confidence (0..100).
   *
   * Separate from `confidence` / `modelTrustPct`:
   *   • confidence / modelTrustPct = direction confidence (raw model)
   *   • recommendationConfidence    = HOW ACTIONABLE the pick is
   *                                   relative to the book price.
   *
   * Null when:
   *   • play_grade is Toss-Up or Held
   *   • no pick exists
   *
   * Capped by data-quality tier (high=80 / medium=65 / low=50 /
   * fallback=35) so low-quality data can never look like a strong
   * actionable play even when the projected edge looks big.
   */
  recommendationConfidence?: number | null;
  /**
   * Sportsbook that produced the no-vig pair. Diagnostic display so
   * members can see "Market 50% · ballybet" or "Market 50% · pinnacle".
   * Null when no book had both sides.
   */
  marketSource: string | null;
  /**
   * Quality classification of the market data feeding `marketImpliedPct`:
   *   • `"two_sided_consensus"` — both sides found at one real book; reliable
   *   • `"splits_consensus"` — both sides synthesized from SharpAPI's
   *     `/splits` payload because `/odds` returned nothing for this
   *     market. Lower confidence than a real book pair; the reader is
   *     told it's a splits-consensus read (R-16E).
   *   • `"single_book"` — only one side priced; no-vig not derivable
   *   • `"pinnacle_only"` — Pinnacle fair-prob from sharp_signals only
   *   • `"unavailable"` — no usable market data at all
   * Drives the "Market: unavailable" honest-empty UI path.
   */
  marketDataQuality:
    | "two_sided_consensus"
    | "splits_consensus"
    | "single_book"
    | "pinnacle_only"
    | "unavailable";
  /**
   * Compact review-trail surfaced to the reader strip. Sourced from
   * `sport_specific.review_v1.flags` when the reviewer fired. Empty
   * array when reviewer is OFF or produced no flags. The full audit
   * record lives in `sport_specific.review_v1` for operator inspection.
   */
  reviewFlags: string[];
  /**
   * Short label summarizing what the reviewer did to THIS market.
   *   • `"keep"` — no reviewer change (default)
   *   • `"cap_confidence"` — reviewer dampened confidence
   *   • `"hold"` — reviewer forced a hold
   *   • `"adjust_score_toward_market"` — score projection was adjusted
   * Members see "Reviewer caution" + flags when the action ≠ "keep".
   */
  reviewActionSummary:
    | "keep"
    | "cap_confidence"
    | "hold"
    | "adjust_score_toward_market"
    | "flip_side"
    | "dampen_confidence"
    | "downgrade_grade";
  /**
   * WC reader follow-up (2026-06-12) — Match Result three-way model
   * probabilities for soccer, pulled from the Dixon-Coles snapshot at
   * `model.raw_probabilities.match_result.{home, draw, away}`.
   *
   * Populated ONLY for soccer Match Result rows (sport === "soccer" and
   * market_key === "moneyline" in the DTO slot mapping). Null for any
   * other sport/market combination — the reader hides the section when
   * the field is null. Adapter-side; NEVER persisted to the DB.
   *
   * Sum should be ≈ 1.0 ± Dixon-Coles rounding. Display is read-only.
   */
  matchResultThreeWayProbs?: {
    /** 0..1 probability of the home team winning regulation. */
    home: number;
    /** 0..1 probability of a draw. */
    draw: number;
    /** 0..1 probability of the away team winning regulation. */
    away: number;
  } | null;

  /**
   * 2026-06-12 — WC Daily Edge full completion pass.
   *
   * Per-market "Market Context" reader content for soccer/WC. Each
   * block is populated by `buildSoccerDailyEdgeAdapted` from existing
   * Dixon-Coles + market-comparison fields in the snapshot. NEVER
   * fabricated: any unavailable field is null. The reader hides a
   * row or shows "—" when a field is null.
   *
   * Populated ONLY for soccer/ucl sport on the matching market slot:
   *   • soccerMatchResultContext  → moneyline slot
   *   • soccerDoubleChanceContext → first_inning slot (DC mapping)
   *   • soccerTotalContext        → total slot
   *   • soccerBttsContext         → moneyline slot (BTTS substitute
   *                                   surfaces alongside Match Result
   *                                   in the reader)
   * MLB / NBA / NHL adapters NEVER set these fields.
   */
  soccerMatchResultContext?: {
    /** Model probabilities (raw Dixon-Coles). All three must sum ≈ 1.0. */
    model: { home: number; draw: number; away: number };
    /** No-vig market-implied probabilities. null when market data missing. */
    market: { home: number; draw: number; away: number } | null;
    /** Edge in percentage points per side. null when market data missing. */
    edge_pp: { home: number; draw: number; away: number } | null;
    /** Side the displayed pick refers to ("home" | "draw" | "away"). */
    displayed_side: "home" | "draw" | "away";
    /** Honest 1-line agreement / disagreement summary copy. */
    note: string;
  } | null;

  soccerDoubleChanceContext?: {
    displayed_side: "home_or_draw" | "away_or_draw" | "home_or_away";
    /** Team abbreviations so the reader renders "{Team} or Draw" labels
     * instead of generic "Home or Draw". */
    home_abbr: string;
    away_abbr: string;
    /** Model coverage probability for the displayed DC side. */
    model_coverage: number;
    /** No-vig market-implied probability for the displayed DC side. null when missing. */
    market_coverage: number | null;
    /** Edge in pp for displayed side. null when market data missing. */
    edge_pp: number | null;
    /** Plain-English explanation of what the displayed DC side covers. */
    side_explanation: string;
    /** Compact preview of the other two DC sides' model probabilities. */
    other_sides: Array<{ side: string; model: number; market: number | null }>;
    note: string;
  } | null;

  soccerTotalContext?: {
    /** λ_home + λ_away. */
    projected_total: number;
    /** Market line at lock candidate. */
    line: number;
    /** Model probability of the over. */
    over_p: number;
    /** Model probability of the under. */
    under_p: number;
    /** Edge in pp for the displayed side. null when market data missing. */
    edge_pp: number | null;
    displayed_side: "over" | "under";
    /** Side implied by expected goals vs the line (mean direction). Can
     * differ from displayed_side — the reader explains why when it does. */
    mean_direction_side: "over" | "under";
    /** True when expected-goals direction disagrees with the displayed
     * side (probability/value chose the other side). */
    mean_vs_probability_disagree: boolean;
    /** Honest 1-line note about reconciliation / divergence. */
    note: string;
    /** True when TOTAL_LINES_DIVERGE blocker is firing for this fixture. */
    provider_divergence: boolean;
  } | null;

  soccerBttsContext?: {
    /** Model probability of Yes. */
    yes_p: number;
    /** Model probability of No. */
    no_p: number;
    /** No-vig market-implied probability of Yes. null when missing. */
    market_yes: number | null;
    /** Edge in pp for the displayed side. null when market data missing. */
    edge_pp: number | null;
    displayed_side: "yes" | "no";
    /** Scoring context line derived from λ_home / λ_away (e.g., projected goals). */
    scoring_context: string;
    note: string;
  } | null;

  /** WC-MODEL-5 grade-honesty block (soccer only). Explains the grade with
   * model/market probabilities, edge, the research-calibrated reason it is
   * not higher, the calibration level, and the upgrade path. */
  soccerGradeContext?: {
    /** Customer-facing calibration level, e.g. "Research-calibrated (live tuning in progress)". */
    calibration_label: string;
    /** Model probability of the pick (0..100), null when unavailable. */
    model_pct: number | null;
    /** De-vigged market-implied probability of the pick (0..100), null when missing. */
    market_pct: number | null;
    /** Edge in pp (model − market). null when market data missing. */
    edge_pp: number | null;
    /** Plain-English reason for the grade + what would upgrade it. */
    grade_reason: string;
    /** True when the edge was flagged as possible model/market disagreement. */
    miscalibration_flag: boolean;
  } | null;
};

/**
 * Per-game lock + status block. Most fields are placeholders until the
 * lock DDL lands in Phase 4.1.12 — `lockState` is hardcoded "open" and
 * `lockedAt` is hardcoded null in this phase.
 */
export type LockState = "open" | "locking" | "locked";

/**
 * Per-game post-grading result. Null pre-grading; populated by the
 * grader cron after the game finishes. Lives OUTSIDE the locked-snapshot
 * payload so it can mutate after the snapshot is frozen.
 */
export type PickResult = "win" | "loss" | "push" | "void";

export type ResultDto = {
  finalScore: { away: number; home: number } | null;
  markets: {
    moneyline: { pickResult: PickResult | null; gradeUnits: number | null };
    total: { pickResult: PickResult | null; gradeUnits: number | null };
    first_inning: { pickResult: PickResult | null; gradeUnits: number | null };
  };
};

/**
 * Per-game live-status block. UI uses these for "lineup pending" /
 * "sharp signal pending" / "market data limited" badges.
 */
export type GameStatusDto = {
  /** Null = unknown (lineup not yet posted), false = posted but unconfirmed, true = confirmed */
  lineupConfirmed: boolean | null;
  /** True iff at least one `lines` row exists for the game */
  linesLocked: boolean;
  /** True iff NO `sharp_signals` row exists for the game */
  sharpSignalPending: boolean;
  /** Per-game flag: true when every quantitative market field is null across all three markets */
  marketDataLimited: boolean;
};

export type DailyEdgeGameDto = {
  /** Stable ID for React keys: `${sport}-${external_id}`. */
  id: string;
  sport: Sport;
  external_id: number;
  awayTeam: string;
  /** CDN URL for the away team logo (5F.3). Null for sports without logos populated yet. */
  awayTeamLogo: string | null;
  homeTeam: string;
  /** CDN URL for the home team logo. Null when unavailable — UI falls back to abbreviation alone. */
  homeTeamLogo: string | null;
  /** Display string in ET (e.g., "7:10 PM"). */
  gameTime: string;
  /** Minutes-from-midnight-ET for sort stability. */
  gameStartMinutes: number;
  /**
   * Phase 4.2.B — ISO 8601 UTC of when the per-game lock cron will fire
   * for this game (= `games.game_date` minus the lock window, default
   * 60 min). The UI uses this for "Locks in 23 min" copy. Falls back to
   * `games.game_date` itself when computeLocksAt returns null (invalid
   * game_date), so the field is always a usable timestamp.
   */
  scheduledLockAt: string;
  /**
   * Phase 4.2.B — three-state lock indicator mapped from the four-state
   * `classifyLockState` output:
   *   • "locked"  → game_predictions.locked_at is set, OR game has started
   *   • "locking" → game is within the T-60 window AND not yet locked
   *                  (next pregame-sweep run will set locked_at)
   *   • "open"    → game is far from T-60; cron will keep refreshing
   */
  lockState: LockState;
  /**
   * Phase 4.2.B — game_predictions.locked_at. Non-null when the per-game
   * cron has frozen this row. Future writes from cron are blocked; the
   * lockState above is "locked" or "locking" depending on the four-state
   * classifier mapping. Null while the game is still being refreshed.
   */
  lockedAt: string | null;
  /**
   * Phase 4.2.B — game_predictions.computed_at. Null when no prediction
   * has been recorded yet. Surfaces as "Updated HH:MM" in the UI.
   */
  updatedAt: string | null;
  /** 4.1.10 — read from `sport_specific.breakdown_generated_at` when present. */
  generatedAt: string | null;
  /**
   * Phase 4.2.C.2 — `sport_specific.hold_reason` from the auto-model.
   * Surfaces in the UI under a held banner ("Held — starter data pending"
   * / "Held — game postponed" / etc.) so members understand WHY a game
   * has no picks rather than seeing 0% defaults. Null when the model
   * didn't hold any market.
   *
   * Known values today (Phase 4D.1):
   *   • "missing_or_scratched_starter" — most common; renders as
   *     "Held — starter data pending"
   *   • Other values map to a generic "Held" fallback in the UI
   */
  holdReason: string | null;
  /**
   * Phase 4.2.C.1.R-10 — starter info per side. Joined from
   * `players` via `games.{home,away}_pitcher_id` at API time. Null when
   * the probable starter isn't posted yet (e.g., TOR @ ATL on 2026-06-04
   * before TOR announced) — UI renders a "starter TBD" placeholder
   * rather than implying a system failure.
   *
   * `throws` is "L" / "R" / null and surfaces handedness next to the
   * name so members can see L/R matchup context at a glance. The
   * model already uses handedness for top-of-order OPS computation;
   * this just exposes it.
   */
  homeStarter: { name: string; throws: "L" | "R" | null } | null;
  awayStarter: { name: string; throws: "L" | "R" | null } | null;
  predictions: {
    ml: DailyEdgePredictionDto;
    total: DailyEdgeTotalPredictionDto;
    nrfi: DailyEdgePredictionDto;
  };
  /**
   * 4.1.10 — per-market enriched edge data for the v13.1 UI. Lives
   * ALONGSIDE the existing `predictions` block during the dual-DTO
   * period. The current Daily Edge UI continues to read `predictions`;
   * the v13.1 UI port (4.1.11) switches to `markets` and `predictions`
   * is removed in 4.1.11.
   */
  markets: {
    moneyline: MarketEdgeDto;
    total: MarketEdgeDto;
    first_inning: MarketEdgeDto;
  };
  /**
   * 4.1.10 — short directive sentence for the v13.1 Edge Board card.
   * Server-generated, banned-terms-linted. Example: "Best angle tonight: KC ML".
   */
  decisionLine: string;
  projected: { away: number; home: number };
  sharpSignals: SharpSignalDto[];
  /** 4.1.10 — per-game live status flags. */
  status: GameStatusDto;
  /** 4.1.10 — post-grading result. Null pre-grade. Populated by the grader cron. */
  result: ResultDto | null;
  /**
   * Phase 4.1.8.B — member-facing pick breakdown surface.
   *
   * Three fields:
   *   • `verdict`      — ALWAYS present. Member-friendly verb word + display
   *                      label. Derived server-side at read time from the
   *                      headline grade + per-market confidences (see
   *                      lib/services/verdictDerivation). The "no_play"
   *                      branch handles rows where the model picked no
   *                      market — the field never has to be null-checked.
   *   • `sharpRead`    — ALWAYS present. One sentence from a 6-template
   *                      pool. Derived server-side at read time from the
   *                      headline grade + sharp_signals projection (see
   *                      lib/services/sharpReadSelector).
   *   • `modelBreakdown` — Model-side prose from the v2 generator. Null
   *                      when neither `sport_specific.breakdown_v2.model_breakdown`
   *                      NOR legacy `sport_specific.member_summary` is
   *                      populated. The reader prefers v2 and falls back
   *                      to legacy for rows written pre-4.1.8.B regen.
   *
   * Member API never exposes `operator_detail`, `breakdown_version`, or
   * `breakdown_generated_at` — those stay server-side per Phase 4.1.6
   * contract.
   */
  breakdown: {
    verdict: { key: Verdict; label: string };
    sharpRead: { key: SharpReadKey; sentence: string };
    modelBreakdown: string | null;
  };
  // V2.1.1 (Phase 6.3.5e): legacy top-level grade / signalType /
  // marketSignal / primaryMarket fields dropped. Headline derivation
  // moves client-side to perPickHeadline.ts (headlineGrade /
  // headlinePrimaryMarket) which reads from predictions.<market>.grade
  // in ML → OU → NRFI precedence. The DB legacy columns are orphaned
  // post-6.3.5e — V14 cleanup migration drops them in a future commit.
};

/**
 * R-19 Phase 1 (C7) — explicit slate-resolution state. Surfaces WHY a
 * given response has (or doesn't have) games, so the UI can render
 * honest empty-state copy instead of a misleading stale slate.
 *
 * See lib/services/dailyEdgeSlateResolution.ts for the state machine.
 */
export type SlateState =
  | "today_published"
  | "today_draft_only"
  | "today_hidden_only"
  | "today_pending_ingest"
  | "stale_fallback"
  | "no_data";

export type DailyEdgeResponse = {
  as_of: string;
  sport: Sport;
  /**
   * The slate_date the response is for — equals `requested_date` when games
   * exist on it, otherwise the most recent slate_date with games (fallback
   * — only when caller opted in via `?allowStale=true`).
   */
  date: string;
  /** What the caller asked for (URL ?date= or auto-today). */
  requested_date: string;
  /**
   * True when `date !== requested_date` — i.e. when the server fell back
   * to a past slate. R-19 Phase 1: fallback is now OPT-IN via
   * `?allowStale=true`. By default `fallback_used` is always false; the
   * pending/empty state is surfaced via `slateState` instead.
   */
  fallback_used: boolean;
  /**
   * R-19 Phase 1 — explicit slate-resolution state. UI uses this to
   * decide which empty-state copy to render when `games` is empty,
   * and to label `stale_fallback` clearly.
   */
  slateState: SlateState;
  /**
   * R-19 Phase 1 — the dominant slate_status of the games being
   * displayed. Null when no rows exist on the requested date at all.
   * For stale_fallback this reports the fallback slate's status.
   */
  slate_status: string | null;
  /**
   * R-19 Phase 1 — most recent `games.updated_at` across the displayed
   * slate. Null when no games are displayed. Useful for an explicit
   * "as of HH:MM" label in the UI separate from response `as_of`.
   */
  last_slate_update_at: string | null;
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
