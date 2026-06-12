/**
 * GET /api/lab/daily-edge?sport=mlb&date=YYYY-MM-DD
 *
 * Tonight's slate for the Daily Edge view. Joins:
 *   • games + teams (abbreviations)
 *   • game_predictions (model picks + confidences + projected scores)
 *   • sharp_signals (per-market posture, batched by game_id)
 *
 * Per Decision G: the route is the single source of truth for game-level
 * verdicts. Per-market sharpStatus is derived from the authoritative
 * sharp_signals.signal_strength column (compared against the predicted
 * side); the 4-tier verdict (triple_lock/strong/lean/caution) is aggregated
 * server-side from those statuses. UI components do not re-derive.
 *
 * Auth: public read. Data is identical to what members see in /lab.
 *
 * Slate-date convention: games starting before 06:00 UTC on date+1 belong
 * to `date`'s slate (matches /api/admin/games). Default `date` = today UTC.
 *
 * Sports without live coverage (anything other than MLB in V1) return
 * `{ games: [] }` — UI's ComingSoonState handles the empty case.
 */

import { supabase } from "@/lib/db/supabase";
import { filterMockSourceRows } from "@/lib/db/productionFilter";
import { classifyEvidence } from "@/lib/services/signalEvidenceClassifier";
import { generateSignalSummary } from "@/lib/services/signalSummaryGenerator";
import {
  deriveVerdict,
  VERDICT_LABEL,
  type Verdict,
} from "@/lib/services/verdictDerivation";
import {
  selectSharpReadKey,
  SHARP_READ_SENTENCES,
  type SharpReadKey,
  type SharpReadMarket,
  type SharpSignalProjection,
} from "@/lib/services/sharpReadSelector";
import type { Side } from "@/lib/types/domain/Lines";
import { computeMarketImplied } from "@/app/lab/lib/marketImplied";
import type { Sport } from "@/lib/types/domain/Sport";
import type {
  Grade,
  MarketSignal,
  SignalType,
} from "@/lib/types/domain/Grade";
import { currentSlateDate, isSlateDate } from "@/lib/dates/slateDate";
import { determineSlateState } from "@/lib/services/dailyEdgeSlateResolution";
import {
  classifyLockState,
  computeLocksAt,
} from "@/lib/automodel/lockState";
import type { LockState as DtoLockState } from "@/app/lab/lib/labTypes";
import type {
  DailyEdgeGameDto,
  DailyEdgeResponse,
  MarketEdgeDto,
  GameStatusDto,
  SharpSignalCategory,
  SharpSignalDto,
  SharpStatus,
} from "@/app/lab/lib/labTypes";
import {
  marketVerdictFor,
  type SharpDirection,
  type MarketVerdict,
  type ReviewerSignals,
  type MarketContextSignals,
  type LineMovementVsPick,
  type EdgeStrengthBucket,
} from "@/lib/services/marketVerdictDerivation";
import { generatePerMarketCopy } from "@/lib/services/perMarketCopyGenerator";
import {
  computeRecommendationConfidence,
  type RecommendationPlayGrade,
  type RecommendationTier,
} from "@/lib/services/recommendationConfidence";
import { formatKeyStats } from "@/lib/services/keyStatsFormatter";
import { assertNoBannedTerms } from "@/lib/services/bannedTermsLinter";
import { buildNbaDailyEdgeAdapted } from "@/lib/services/nba/buildNbaDailyEdgeAdapted";
import {
  loadSplitsHistoryForSlate,
  loadLinesHistoryForSlate,
  isStale as isObservationStale,
} from "@/lib/services/lastKnownGoodReader";

const VALID_SPORTS: Sport[] = ["mlb", "nba", "nfl", "cbb", "cfb", "nhl", "ucl", "soccer"];
// Phase 7G — NBA goes live in the member-facing Daily Edge via the
// shared adapter below. MLB pipeline below is unchanged.
const LIVE_SPORTS: Sport[] = ["mlb", "nba"];

/**
 * V2.1 Part 9 — only `published` and `final` slates are visible to members.
 * `draft` slates are admin-loaded but not yet live; `hidden` slates have
 * been retracted. This array is the single source of truth for the filter
 * applied to every games query in this route.
 */
const VISIBLE_SLATE_STATUSES = ["published", "final"] as const;

/**
 * R-19 Phase 1 (C7) — slate-resolution moved to a pure state machine
 * (`lib/services/dailyEdgeSlateResolution.ts`). The route now:
 *   1. Probes the requested date for all `slate_status` rows.
 *   2. If `?allowStale=true` is set, probes for the most recent visible
 *      slate to use as fallback. Default = no fallback query.
 *   3. Hands the rows to `determineSlateState` and renders the response
 *      according to the returned state machine result.
 *
 * Pre-R-19 the route silently fell back to the most recent visible slate
 * — surfacing yesterday's picks under today's date. That regression mode
 * is now gated behind the explicit `?allowStale=true` query opt-in, and
 * even there the response carries `slateState="stale_fallback"` +
 * `fallback_used=true` for the UI to render an unambiguous label.
 */

// ───────────────────────────────────────────────────────────────────────────
// Lock-snapshot single-source-of-truth helpers
// ───────────────────────────────────────────────────────────────────────────
//
// Contract: once a market has a locked prediction_record, every customer-
// facing field on the card (pill, body copy, caution text) MUST agree with
// the locked decision. This helper translates the locked play_grade (and
// no_bet flag) into the verdict tier used by both the headline pill and
// the breakdown copy template, so the body template branch matches the pill.
//
// Mapping (per Daniel, 2026-06-09 + 2026-06-10 v15.2 + 2026-06-10 v15.3 FI):
//
//   ML / Total (v2.2 writer):
//     play_grade=best_angle                          → "Best Angle"
//     play_grade=lean                                → "Lean"
//     play_grade=market_watch|model_only|provisional|market_aligned
//                                                    → "Watchlist"
//
//   First Inning (FI v2 writer — different enum, same contract):
//     play_grade=best_angle                          → "Best Angle"
//     play_grade=lean                                → "Lean"
//     play_grade=toss_up                             → "Watchlist"
//        (Toss-Up is a non-actionable "watching" state — model probability
//         in the neutral band [0.85, 1.15]. Toss-Up FI rows also carry
//         no_bet=true on prediction_records, so tracking excludes them
//         from W/L; the chip stays visible so members see the model's
//         neutral read.)
//     play_grade=held                                → "No Play"
//        (Held rows fail the held=true short-circuit in buildMarketEdge
//         independently; this case is the explicit lock-snapshot path so
//         the contract is auditable even when the live held flag is
//         absent.)
//     play_grade=no_bet                              → "No Play"
//        (FI writer's "Edge too thin; no bet" verdict. Pre-v15.3 these
//         fell through to the live ladder and rendered as Watchlist or
//         even Lean when confidence cleared the floors — silently
//         overriding the writer's "do not bet" decision. v15.3 honors
//         the writer.)
//
//   Cross-market:
//     no_bet=true (any market)                       → "No Play"
//     play_grade=null + no_bet=false                 → null (live ladder)
//
// 2026-06-10 v15.2 — Single source of truth extended pre-lock. This
// resolver is now used for BOTH locked rows AND unlocked rows whose
// writer has produced a play_grade. Pre-lock, the writer play_grade
// is read from `sport_specific.v2_2_audit.{ml,ou}_play_grade` /
// `sport_specific.fi_v2_audit.fi_play_grade` via
// `resolveWriterPlayGrade()`.
//
// 2026-06-10 v15.3 — FI-specific play_grade values (toss_up / held /
// no_bet) added so FI's writer authority is honored the same way as
// ML/Total. Pre-v15.3 these fell through to default→null→live ladder
// and the FI display verdict could disagree with the FI writer.
type LockedVerdictOverride = { key: "best_angle" | "lean" | "watchlist" | "no_play"; label: string };
function resolveLockedVerdict(
  lockedPlayGrade: string | null | undefined,
  lockedNoBet: boolean | null | undefined,
  /**
   * Truthfulness guard (2026-06-11 P7-B1). When the writer text says
   * "best_angle" but `prediction_records.best_angle` is explicitly
   * false (the writer's public-money conflict guard demoted it), we
   * MUST display Lean — not Best Angle. Same row, same writer, the
   * boolean is the authoritative final state.
   *
   * Null is treated as "unknown" and does NOT trigger the demote — that
   * preserves pre-existing behavior for code paths that don't yet
   * thread the boolean in (e.g. FI today). Only an explicit `false`
   * downgrades.
   */
  lockedBestAngleBool?: boolean | null,
): LockedVerdictOverride | null {
  // 2026-06-10 v15.3 FI ordering — Toss-Up is checked BEFORE the
  // no_bet short-circuit. FI writes `no_bet=true` alongside
  // `fi_play_grade=toss_up` so the row is voided in tracking
  // (predictionGrader.ts treats no_bet=true rows as void), but the
  // CHIP must stay visible as Watchlist per product contract:
  // "Toss-Up remains visible on the card as a non-actionable
  // Watchlist-style state and remains excluded from W/L tracking."
  // Without this precedence the no_bet flag would flip Toss-Up to
  // No Play and hide the model's neutral read from the member.
  if (lockedPlayGrade === "toss_up") return { key: "watchlist", label: "Watchlist" };
  if (lockedNoBet === true) return { key: "no_play", label: "No Play" };
  switch (lockedPlayGrade) {
    case "best_angle":
      // P7-B1 truthfulness guard (2026-06-11). The writer's
      // predictionRecordService applies a public-money conflict guard
      // when it sets the `best_angle` boolean column (see
      // hasOpposingPublicMoneyConflict). If the boolean is explicitly
      // false, the writer's final decision is "not a Best Angle" — so
      // we demote the displayed pill to Lean. `null` (unknown) preserves
      // the prior behavior so paths that don't thread the boolean keep
      // working untouched.
      if (lockedBestAngleBool === false) {
        return { key: "lean", label: "Lean" };
      }
      return { key: "best_angle", label: "Best Angle" };
    case "lean":           return { key: "lean", label: "Lean" };
    case "market_watch":
    case "model_only":
    case "provisional":
    case "market_aligned": return { key: "watchlist", label: "Watchlist" };
    case "held":
    case "no_bet":         return { key: "no_play", label: "No Play" };
    default: return null;
  }
}

/**
 * 2026-06-10 v15.2 — Reads the live writer play_grade for an unlocked
 * row from `sport_specific.v2_2_audit.{ml,ou}_play_grade` or
 * `sport_specific.fi_v2_audit.fi_play_grade`. This is the same field
 * the lock writer copies into `prediction_records.play_grade` at T-60,
 * so resolving from it pre-lock keeps the pre-lock and post-lock
 * verdicts in lockstep — no T-60 "verdict flip" because the read-side
 * ladder no longer overrides the writer's decision.
 *
 * Returns the raw writer play_grade string (e.g. "best_angle", "lean",
 * "market_aligned", "provisional") or null when the writer has not
 * produced a grade for this market (in which case the caller falls
 * back to the live verdict ladder).
 *
 * NEVER returns an enum-narrowed value — the consumer is
 * `resolveLockedVerdict()` which already has the canonical mapping.
 * Keeping the string raw means new writer play_grades automatically
 * flow through once their case is added to the resolver, without
 * needing to widen the extractor's union too.
 */
function resolveWriterPlayGrade(
  sportSpecific: Record<string, unknown> | null | undefined,
  market: "moneyline" | "total" | "first_inning",
): string | null {
  if (!sportSpecific) return null;
  if (market === "first_inning") {
    const fi =
      (sportSpecific.fi_v2_audit as Record<string, unknown> | undefined) ?? null;
    if (!fi) return null;
    const pg = fi.fi_play_grade;
    return typeof pg === "string" ? pg : null;
  }
  const v22 =
    (sportSpecific.v2_2_audit as Record<string, unknown> | undefined) ?? null;
  if (!v22) return null;
  const key = market === "moneyline" ? "ml_play_grade" : "ou_play_grade";
  const pg = v22[key];
  return typeof pg === "string" ? pg : null;
}

// ───────────────────────────────────────────────────────────────────────────
// Time helpers (ET display)
// ───────────────────────────────────────────────────────────────────────────

/** Format UTC ISO timestamp as "7:10 PM" in ET. Approximation: UTC-4 (EDT). */
function formatTimeET(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hour24 = (d.getUTCHours() + 24 - 4) % 24;
  const minutes = d.getUTCMinutes();
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const display = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${display}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

/** Minutes-from-midnight-ET for stable sort ordering. */
function minutesFromMidnightET(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const hour24 = (d.getUTCHours() + 24 - 4) % 24;
  return hour24 * 60 + d.getUTCMinutes();
}

/** Compose "3H AGO" / "12M AGO" / "JUST NOW". */
function relativeTimeAgo(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return undefined;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H AGO`;
  const days = Math.floor(hours / 24);
  return `${days}D AGO`;
}

// (slate-date window helpers removed in 5E.1 — filters now hit
// games.slate_date directly. See lib/dates/slateDate.ts for the canonical
// "today's slate" computation.)

// ───────────────────────────────────────────────────────────────────────────
// Sharp signal mapping
// ───────────────────────────────────────────────────────────────────────────

/**
 * Sharp signal row shape consumed by the route. Fix 4.1 (K1) dropped
 * `signal_strength` and `signal_summary` from the SELECT — those legacy
 * columns are no longer the source of truth for member-facing signal data.
 * sharpStatus and direction now derive from the per-pick grade; description
 * text comes from generateSignalSummary() at response time.
 */
type SignalRow = {
  game_id: number;
  market_type: string;
  side: string;
  pinnacle_fair_probability: number | null;
  is_plus_ev: boolean | null;
  ev_pct: number | null;
  has_steam_move: boolean | null;
  steam_detected_at: string | null;
  steam_books_count: number | null;
  has_reverse_line_movement: boolean | null;
  rlm_direction: string | null;
  public_betting_pct: number | null;
  public_money_pct: number | null;
  computed_at: string | null;
  /**
   * Phase 7I (Last Known Good) — when public_money_pct or
   * public_betting_pct was hydrated from sharp_signals_history rather
   * than the live sharp_signals row, the original observed_at is
   * stamped here per-field. buildMarketEdge propagates the stamps onto
   * MarketEdgeDto so the UI can render subtle "Last updated …" copy.
   * null/undefined → value came from the live current row (fresh).
   */
  public_money_pct_observed_at?: string | null;
  public_betting_pct_observed_at?: string | null;
};

/**
 * 4.1.10 — current `lines` row for the v13.1 Edge Stack per-market price.
 * Selected with `player_id IS NULL` so player props don't leak in.
 */
type LineRow = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  fetched_at: string | null;
  /**
   * Phase 7I (Last Known Good) — when odds_american or line_value was
   * hydrated from line_history rather than the live lines row, the
   * original recorded_at is stamped per-field. buildMarketEdge propagates
   * onto MarketEdgeDto for "Last updated …" UI copy.
   */
  odds_american_observed_at?: string | null;
  line_value_observed_at?: string | null;
};

/**
 * 4.1.10 — first-seen line for `lineOpenAmerican`. Per 4.1.9.B section 10,
 * we derive "first seen" from MIN(recorded_at) on `line_history` because
 * `linesService.refreshGameLines` hardcodes `is_opener=false` today.
 */
type LineHistoryRow = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  odds_american: number | null;
  /**
   * Phase 6B.30E — totals open line_value, needed for deriving
   * line-movement direction (10.5 → 11 confirms Over, etc.).
   * `line_history` already stores this column; the SELECT below was
   * widened to read it. Null for moneyline rows (no line value) and
   * for any pre-historic row that lacked the column.
   */
  line_value: number | null;
  recorded_at: string;
};

const MARKET_LABEL: Record<string, SharpSignalDto["market"]> = {
  moneyline: "ML",
  total: "OU",
  first_inning_total: "NRFI",
};

/**
 * Fix 4.1 (Flag D1): three-state sharpStatus derived from the per-pick
 * grade rather than legacy `signal_strength`. Per the framework's grade
 * vocabulary, the grade IS the user-facing verdict — sharpStatus is the
 * compact per-tile visualization of that verdict.
 *
 *   best_signal / sharp_confirmed → confirm  (market agrees with model)
 *   sharp_conflict               → caution   (market opposes model)
 *   everything else              → mixed     (no clear verdict)
 *
 * Gap-19.5 follow-up: the "mixed" label is shared by genuinely silent
 * states (model_only) and middle-tier states (market_watch, market_led).
 * Member feedback post-launch should inform whether to split this into
 * "neutral" / "quiet" sub-states. Not a launch blocker.
 */
function deriveSharpStatus(grade: Grade | null): SharpStatus {
  if (grade === "best_signal" || grade === "sharp_confirmed") return "confirm";
  if (grade === "sharp_conflict") return "caution";
  return "mixed";
}

/**
 * Direction maps to the same three-state grade-derived verdict. Drives the
 * signal-row border color (emerald / amber / gray). Mirrors the legacy
 * mapping post-Fix-4.1 but sourced from grade instead of signal_strength.
 */
function deriveDirection(grade: Grade | null): SharpSignalDto["direction"] {
  if (grade === "best_signal" || grade === "sharp_confirmed") return "positive";
  if (grade === "sharp_conflict") return "negative";
  return "neutral";
}

function categorizeSignal(s: SignalRow): SharpSignalCategory {
  if (s.has_steam_move && (s.steam_books_count ?? 0) >= 2) return "steam";
  if (s.has_reverse_line_movement) {
    // rlm_direction stored as "toward_home" / "toward_away" / "toward_over" / "toward_under".
    // For UI we only need toward vs. away from the SIGNAL's side.
    const target = s.rlm_direction ?? "";
    if (target.includes(s.side)) return "line_move_toward";
    return "line_move_away";
  }
  if (
    s.public_money_pct !== null &&
    s.public_betting_pct !== null &&
    s.public_money_pct - s.public_betting_pct >= 12
  ) {
    return "handle_gap";
  }
  if (s.is_plus_ev) return "pinnacle_agree";
  return "no_signal";
}

/**
 * Project the per-pick grade and modelSide for a given (market, prediction)
 * tuple. Returns null when the model didn't pick that market (per-pick
 * triplet all-null upstream).
 */
type MarketSignalLookup = {
  modelSide: Side;
  grade: Grade | null;
};

function buildSignalDtos(
  rows: SignalRow[],
  lookup: Map<string, MarketSignalLookup>,
  ctx: { homeTeamAbbr: string; awayTeamAbbr: string }
): SharpSignalDto[] {
  return rows
    .map((s): SharpSignalDto | null => {
      const market = MARKET_LABEL[s.market_type];
      if (!market) return null;

      // Look up the per-pick grade + modelSide for this market. When the
      // model didn't pick, fall back to the signal's own side and grade=null
      // (generator yields the honest fallback copy).
      const pick = lookup.get(s.market_type);
      const modelSide: Side = (pick?.modelSide ?? (s.side as Side));
      const grade = pick?.grade ?? null;

      // Fix 4.1: classifyEvidence + generateSignalSummary derive the text
      // at response time from the same evidence record the grade engine
      // already computed. One pipeline. Replaces the legacy
      // verdictGenerator pre-write path.
      const evidence = classifyEvidence(modelSide, {
        side: s.side as Side,
        is_plus_ev: s.is_plus_ev ?? false,
        ev_pct: s.ev_pct,
        has_steam_move: s.has_steam_move ?? false,
        steam_books_count: s.steam_books_count,
        has_reverse_line_movement: s.has_reverse_line_movement ?? false,
        rlm_direction: s.rlm_direction,
        public_betting_pct: s.public_betting_pct,
        public_money_pct: s.public_money_pct,
      });
      const description = generateSignalSummary(
        modelSide,
        s.market_type,
        {
          side: s.side as Side,
          is_plus_ev: s.is_plus_ev ?? false,
          ev_pct: s.ev_pct,
          has_steam_move: s.has_steam_move ?? false,
          steam_books_count: s.steam_books_count,
          has_reverse_line_movement: s.has_reverse_line_movement ?? false,
          rlm_direction: s.rlm_direction,
          public_betting_pct: s.public_betting_pct,
          public_money_pct: s.public_money_pct,
        },
        evidence,
        grade,
        {
          homeTeamAbbr: ctx.homeTeamAbbr,
          awayTeamAbbr: ctx.awayTeamAbbr,
          steamDetectedAt: s.steam_detected_at,
        }
      );

      const category = categorizeSignal(s);
      return {
        market,
        category,
        description,
        source: s.is_plus_ev ? "PINNACLE" : "MARKET",
        timestamp: relativeTimeAgo(s.steam_detected_at ?? s.computed_at),
        direction: deriveDirection(grade),
      };
    })
    .filter((x): x is SharpSignalDto => x !== null);
}

// ───────────────────────────────────────────────────────────────────────────
// Row → DTO
//
// Note: pre-6.4 a 3-state verdict banner (strong/caution/null) was computed
// here from per-market sharpStatus values. Phase 6.4b replaces the banner
// with the V2.1 grade badge (Grade + SignalType + MarketSignal, populated
// upstream by gradeDerivationService) and removes the verdict aggregator
// helpers entirely — the per-tile sharpStatus on each pick tile is the
// only remaining per-market signal on the card.
// ───────────────────────────────────────────────────────────────────────────

type PredictionRow = {
  /** Data provenance (V11 migration). Read by the production data-mode
   * filter to suppress mock rows from member-facing responses per
   * SHARP_SIGNAL_FRAMEWORK.md §"Signal Source Quality". */
  source_type: string | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_total: number | null;
  predicted_ml_winner: string | null;
  ml_confidence: number | null;
  predicted_ou_side: string | null;
  ou_confidence: number | null;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  /** V13 per-pick grade triplets (Phase 6.3.5). All three fields per
   * market are NULL together when the model didn't pick that market.
   * Column names use the DB convention: ml_* / ou_* / nrfi_* — the
   * DTO surfaces them as predictions.ml / predictions.total / predictions.nrfi
   * respectively (note ou_ → total name swap).
   *
   * 6.3.5e dropped the legacy single-grade columns (grade, signal_type,
   * market_signal) from this type and from the SELECT — those DB columns
   * are now orphaned and get cleaned up by a future V14 migration. */
  ml_grade: Grade | null;
  ml_signal_type: SignalType | null;
  ml_market_signal: MarketSignal | null;
  ou_grade: Grade | null;
  ou_signal_type: SignalType | null;
  ou_market_signal: MarketSignal | null;
  nrfi_grade: Grade | null;
  nrfi_signal_type: SignalType | null;
  nrfi_market_signal: MarketSignal | null;
  /**
   * Fix 7.2.5: sport_specific JSONB — operator-entered listed_line
   * (MLB) or other per-sport extras. Daily Edge prefers the lines
   * table sportsbook total; falls back to sport_specific.listed_line
   * when no lines row exists.
   */
  sport_specific: Record<string, unknown> | null;
  /**
   * Phase 4.2.B — when the prediction was last refreshed. Surfaces as
   * `updatedAt` in the DTO so the UI can show "Updated 4:12 PM".
   */
  computed_at: string | null;
  /**
   * Phase 4.2.B — per-game T-60 lock timestamp. NULL = unlocked.
   * Surfaces as `lockedAt` in the DTO and feeds the `lockState`
   * classification via lockState.classifyLockState.
   */
  locked_at: string | null;
};

type GameRow = {
  id: number;
  external_id: number;
  sport: string;
  game_date: string;
  /** R-19 Phase 1 — `games.updated_at`; route uses it to compute
   *  `last_slate_update_at` for the slate displayed in the response. */
  updated_at: string | null;
  // To-one FK expansions: Supabase typegen renders these as arrays but the
  // runtime returns a single object. game_predictions has UNIQUE(game_id)
  // and team FKs are to-one. Cast as single-object | null.
  home_team: { abbreviation: string; logo_url: string | null } | null;
  away_team: { abbreviation: string; logo_url: string | null } | null;
  /**
   * Phase 4.2.C.1.R-10 — joined starter rows. Null when
   * `games.{home,away}_pitcher_id` is null (probable starter not
   * posted yet). The relation alias forces Supabase to expand the
   * FK rather than returning the id.
   */
  home_pitcher: { first_name: string | null; last_name: string | null; throws: string | null } | null;
  away_pitcher: { first_name: string | null; last_name: string | null; throws: string | null } | null;
  game_predictions: PredictionRow | null;
};

/**
 * Phase R-10 — project a joined `players` FK expansion into the DTO
 * starter shape. Returns null when the FK was null (no probable
 * starter posted) or when the row is too sparse to render (no name
 * at all). Normalizes `throws` to the "L" | "R" | null contract.
 */
function buildStarterDto(
  raw: { first_name: string | null; last_name: string | null; throws: string | null } | null
): { name: string; throws: "L" | "R" | null } | null {
  if (raw === null) return null;
  const first = raw.first_name?.trim() ?? "";
  const last = raw.last_name?.trim() ?? "";
  const name = `${first} ${last}`.trim();
  if (name.length === 0) return null;
  const throws: "L" | "R" | null =
    raw.throws === "L" ? "L" : raw.throws === "R" ? "R" : null;
  return { name, throws };
}

function buildGameDto(
  row: GameRow,
  signals: SignalRow[],
  sportsbookTotalLine: number | null,
  currentLinesByGameMarket: Map<string, LineRow[]>,
  openLinesByGameMarket: Map<string, LineHistoryRow[]>,
  lockedPlayGradeByGameMarket: Map<string, {
    playGrade: string | null;
    noBet: boolean | null;
    bestAngle: boolean | null;
    lockedOpenOddsAmerican: number | null;
    lockedOpenerRecordedAt: string | null;
    lockedSignalRowsAtLock: SignalRow[] | null;
  }>
): DailyEdgeGameDto | null {
  const home = row.home_team?.abbreviation ?? "—";
  const away = row.away_team?.abbreviation ?? "—";
  const homeLogo = row.home_team?.logo_url ?? null;
  const awayLogo = row.away_team?.logo_url ?? null;
  // Phase 6B.30A — never silently drop an official scheduled game.
  // Pre-6B.30A this site returned null for any game without a
  // game_predictions row, causing the official slate count to silently
  // diverge from MLB Stats (today: 7 cards rendered for 8 scheduled
  // games, SEA@BAL was missing because Baltimore's home starter
  // wasn't yet published by any integrated source). Replace the
  // silent drop with a synthetic "prediction pending" placeholder
  // that flows through the existing held-card render path (Phase
  // 4.2.C.2). The placeholder:
  //   • has all three markets held (null pick / null confidence /
  //     null grade) so downstream extractors treat it as a held game
  //   • carries hold_reason="prediction_pending" so the UI renders
  //     customer-safe copy ("Prediction pending" / "Waiting on
  //     confirmed starter data") instead of a default 0% pick
  //   • carries no locked_at, no actionable fields
  //   • triggers ZERO writes to prediction_records (the record
  //     writer's held filter, which has long existed, drops it)
  //   • is excluded from Tracking by the existing no_bet=true /
  //     held=true gates
  // When the normal pipeline later assigns a starter and the
  // automodel writes a real game_predictions row, the next request
  // sees the real row and the card auto-promotes to a normal pick.
  // No manual intervention required.
  const pred: PredictionRow = row.game_predictions ?? {
    source_type: null,
    predicted_home_score: null,
    predicted_away_score: null,
    predicted_total: null,
    predicted_ml_winner: null,
    ml_confidence: null,
    predicted_ou_side: null,
    ou_confidence: null,
    predicted_nrfi: null,
    nrfi_confidence: null,
    ml_grade: null,
    ml_signal_type: null,
    ml_market_signal: null,
    ou_grade: null,
    ou_signal_type: null,
    ou_market_signal: null,
    nrfi_grade: null,
    nrfi_signal_type: null,
    nrfi_market_signal: null,
    sport_specific: {
      hold_reason: "prediction_pending",
      hold_picks: ["ml", "ou", "nrfi"],
    },
    computed_at: null,
    locked_at: null,
  };

  // Phase 4.2.C.2 — held extraction. The auto-model marks a market as
  // held when it refuses to make a pick (e.g., missing starter, scratched
  // starter, insufficient data). Held markets carry null pick / null
  // confidence / null grade — the UI must render "Held", NEVER a fake
  // default. Pre-4.2.C.2 the route used `?? "home"` / `?? "under"` /
  // `?? true` defaults which surfaced as misleading 0%/Under/NRFI on the
  // card. Those defaults are removed below.
  const heldFlag =
    pred.sport_specific !== null &&
    (pred.sport_specific as Record<string, unknown>).held === true;
  const holdPicksRaw =
    pred.sport_specific === null
      ? []
      : ((pred.sport_specific as Record<string, unknown>).hold_picks as
          | string[]
          | undefined) ?? [];
  const holdPicks = Array.isArray(holdPicksRaw) ? holdPicksRaw : [];
  const isMlHeld = heldFlag && holdPicks.includes("ml");
  const isOuHeld = heldFlag && holdPicks.includes("ou");
  const isNrfiHeld = heldFlag && holdPicks.includes("nrfi");
  const holdReason =
    pred.sport_specific === null
      ? null
      : (((pred.sport_specific as Record<string, unknown>).hold_reason as
          | string
          | undefined) ?? null);

  // ── ML ──
  // Phase 4.2.C.2 — null pick passes through honestly when held. The
  // home/away resolution only fires when predicted_ml_winner is non-null.
  // UI renders the null pick as "Held" via MarketEdgeDto.held.
  const mlWinnerKey = pred.predicted_ml_winner;
  const mlPick: string | null =
    mlWinnerKey === null ? null
      : mlWinnerKey === "home" ? home
        : away;
  // Fix 4.1 (Flag D1): sharpStatus derives from the per-pick grade, not
  // from legacy signal_strength. See deriveSharpStatus() comment.
  const mlStatus = deriveSharpStatus(pred.ml_grade);

  // ── Total ──
  // 5F.1 / Fix 7.2.5: display the SPORTSBOOK total line — what members
  // would actually bet on. The model projection lives separately in
  // `projected` (hero stat) and never substitutes here.
  //
  // Priority chain (Fix 7.2.5):
  //   1. lines table (Pinnacle preferred, then DK/FD/MGM/Caesars) —
  //      most current; populated by sharp-signal provider
  //   2. game_predictions.sport_specific.listed_line — operator-
  //      entered at upload time; useful for manual MLB slates without
  //      sharp data
  //   3. null — neither source available; UI renders the side alone
  //      ("Under") rather than misleadingly showing predicted_total
  //
  // Pre-Fix-7.2.5 the route fell through to `pred.predicted_total ?? 0`
  // which surfaced "Under 7.8" on manual slates — the 7.8 looked like
  // a market line but was actually the model projection (home + away).
  // The fallback is removed; the field is now allowed to be null and
  // the UI handles null cleanly.
  // Phase 4.2.C.2 — held total. Pre-4.2.C.2 `?? "under"` defaulted the
  // ou_side to "under" when null, which surfaced as fake "Under" picks
  // on held games (one of the symptoms in the 2026-06-03 smoke test).
  // Null is now passed through honestly; the UI renders held markets
  // explicitly.
  const ouSide = pred.predicted_ou_side;
  const manualListedLine =
    typeof pred.sport_specific?.listed_line === "number"
      ? pred.sport_specific.listed_line
      : null;
  const totalLine: number | null =
    sportsbookTotalLine ?? manualListedLine ?? null;
  const totalStatus = deriveSharpStatus(pred.ou_grade);
  const totalPick: string | null =
    ouSide === null ? null
      : ouSide === "over" ? "Over"
        : "Under";

  // ── NRFI ──
  //
  // Toss-Up display fix (Change A):
  //   The legacy `predicted_nrfi` boolean column can't represent the
  //   model's Phase 4D.1 5-zone Toss-Up state — it always collapses to
  //   true (NRFI) for Toss-Up rows. That makes the displayed pick read
  //   as "NRFI 52%" with a projection of ~1.00 runs, which is squarely
  //   in the model's Toss-Up band [0.85, 1.15] and reads as a
  //   contradiction to users.
  //
  //   Detection strategy (safest signal first):
  //     1. `sport_specific.nrfi_decision_kind === "toss_up"` — the
  //        canonical model field added in Phase 4D.1. Honest, distinguishes
  //        Toss-Up from held cleanly.
  //     2. Heuristic fallback for pre-4D.1 rows that don't have
  //        nrfi_decision_kind populated: nrfi_confidence === 52 (the
  //        sentinel) AND nrfi_expected_runs in [0.85, 1.15) (the exact
  //        Toss-Up band the model uses).
  //
  //   This is a DISPLAY-only fix. Model, thresholds, confidence,
  //   projected runs, and the underlying DB columns are unchanged. The
  //   route just chooses a different pick label for Toss-Up zone rows.
  // Phase 4.2.C.2 — held FI. Pre-4.2.C.2 `?? true` defaulted predicted_nrfi
  // to NRFI when null, surfacing fake "NRFI" picks on held games. Null
  // is now passed through honestly. Toss-Up display logic still fires
  // for valid non-held Toss-Up rows (nrfi_decision_kind="toss_up") —
  // those have non-null predicted_nrfi and aren't in hold_picks, so they
  // remain unaffected.
  const isNrfi = pred.predicted_nrfi; // boolean | null — null when held
  // nrfiSide used for sharp_signals lookup; defensive default when null
  // doesn't affect display because nrfiPick handles null separately
  const nrfiSide: Side = isNrfi === true || isNrfi === null ? "under" : "over";
  const nrfiStatus = deriveSharpStatus(pred.nrfi_grade);
  const nrfiDecisionKind =
    typeof pred.sport_specific?.nrfi_decision_kind === "string"
      ? pred.sport_specific.nrfi_decision_kind
      : null;
  const nrfiExpectedRunsRaw =
    pred.sport_specific?.auto_factors &&
    typeof pred.sport_specific.auto_factors === "object"
      ? (pred.sport_specific.auto_factors as Record<string, unknown>).nrfi_expected_runs
      : null;
  const nrfiExpectedRuns =
    typeof nrfiExpectedRunsRaw === "number" && Number.isFinite(nrfiExpectedRunsRaw)
      ? nrfiExpectedRunsRaw
      : null;
  // Toss-Up detection only fires for non-held games. Held games always
  // route to nrfiPick=null below, regardless of decision_kind.
  const isNrfiTossUp =
    !isNrfiHeld &&
    (nrfiDecisionKind === "toss_up" ||
      (nrfiDecisionKind === null &&
        pred.nrfi_confidence !== null &&
        Math.round(pred.nrfi_confidence) === 52 &&
        nrfiExpectedRuns !== null &&
        nrfiExpectedRuns >= 0.85 &&
        nrfiExpectedRuns < 1.15));
  const nrfiPick: string | null =
    isNrfi === null ? null
      : isNrfiTossUp ? "Toss-Up"
        : isNrfi ? "NRFI"
          : "YRFI";

  // Build the (market → modelSide + grade) lookup that buildSignalDtos
  // consumes for both alignment-aware text generation and direction color.
  const signalLookup = new Map<string, MarketSignalLookup>();
  if (pred.predicted_ml_winner !== null) {
    signalLookup.set("moneyline", {
      modelSide: pred.predicted_ml_winner as Side,
      grade: pred.ml_grade,
    });
  }
  if (pred.predicted_ou_side !== null) {
    signalLookup.set("total", {
      modelSide: pred.predicted_ou_side as Side,
      grade: pred.ou_grade,
    });
  }
  if (pred.predicted_nrfi !== null) {
    signalLookup.set("first_inning_total", {
      modelSide: nrfiSide,
      grade: pred.nrfi_grade,
    });
  }

  // 4.1.10 — assemble per-market enriched MarketEdgeDto for the v13.1 UI
  // alongside the legacy `predictions` block. Each market gets its own
  // verdict / copy / quantification / keyStats. First-inning is treated
  // specially: marketDataLimited never downgrades, sharpDirection is forced
  // to "none" (V1 has no first-inning sharp data), and copy never refers
  // to splits.
  // Phase 4.2.C.2 — null confidence passes through honestly for held
  // markets. Pre-4.2.C.2 the route coerced null→0 here which surfaced as
  // "0%" on the card. The MarketEdgeDto.confidence field is now nullable
  // (lib/lab/labTypes.ts) and UI helpers render "—" for null.
  const mlConfidence: number | null =
    pred.ml_confidence === null
      ? null
      : Math.max(0, Math.min(1, pred.ml_confidence / 100));
  const ouConfidence: number | null =
    pred.ou_confidence === null
      ? null
      : Math.max(0, Math.min(1, pred.ou_confidence / 100));
  const nrfiConfidence: number | null =
    pred.nrfi_confidence === null
      ? null
      : Math.max(0, Math.min(1, pred.nrfi_confidence / 100));

  const autoFactors = extractAutoFactors(pred.sport_specific);

  // Phase 6B.9 + 6B.10 — three-way grade routing (same logic as
  // deriveVerdictForRow). Keeps the per-market verdict pill in sync
  // with the game-level verdict + propagates the sharp-confirmation
  // bump to per-market display.
  const baOverride = readV22BestAngleOverride(pred.sport_specific);
  const mlMoneyConflict = hasOpposingPublicMoneyConflict(signals, "moneyline", pred.predicted_ml_winner);
  const ouMoneyConflict = hasOpposingPublicMoneyConflict(signals, "total", pred.predicted_ou_side);
  const mlMoneySupport = hasSupportingPublicMoneyConfirmation(signals, "moneyline", pred.predicted_ml_winner);
  const ouMoneySupport = hasSupportingPublicMoneyConfirmation(signals, "total", pred.predicted_ou_side);
  const mlMarketEdge = readV22EdgePp(pred.sport_specific, "moneyline");
  const ouMarketEdge = readV22EdgePp(pred.sport_specific, "total");
  const mlGradeForMarket = applyV22BestAngleOverride(pred.ml_grade, baOverride.ml, mlMoneyConflict, mlMoneySupport, mlMarketEdge);
  const ouGradeForMarket = applyV22BestAngleOverride(pred.ou_grade, baOverride.ou, ouMoneyConflict, ouMoneySupport, ouMarketEdge);

  const lockedMl = lockedPlayGradeByGameMarket.get(`${row.id}::moneyline`);
  const lockedOu = lockedPlayGradeByGameMarket.get(`${row.id}::total`);
  // 2026-06-10 v15.3 FI integrity — FI's lock map is read symmetric
  // with ML/Total. Pre-v15.3 the FI buildMarketEdge call omitted
  // lockedPlayGrade / lockedNoBet, so the locked FI snapshot was
  // never the single source of truth for FI verdict — the live
  // ladder ran instead, and writer "no_bet" / "toss_up" could
  // silently downgrade to actionable Watchlist or Lean.
  const lockedFi = lockedPlayGradeByGameMarket.get(`${row.id}::first_inning`);
  const ml = buildMarketEdge({
    market: "moneyline",
    pick: mlPick,
    confidence: mlConfidence,
    grade: mlGradeForMarket,
    signalType: pred.ml_signal_type,
    marketSignal: pred.ml_market_signal,
    sharpStatus: mlStatus,
    modelSide: pred.predicted_ml_winner as Side | null,
    signals,
    linesCurrent: currentLinesByGameMarket.get(`${row.id}::moneyline`) ?? [],
    lineOpenCandidates:
      openLinesByGameMarket.get(
        `${row.id}::moneyline::${pred.predicted_ml_winner ?? "null"}`
      ) ?? [],
    autoFactors,
    homeAbbr: home,
    awayAbbr: away,
    held: isMlHeld,
    sportSpecific: pred.sport_specific,
    lockedPlayGrade: lockedMl?.playGrade ?? null,
    lockedNoBet: lockedMl?.noBet ?? null,
    lockedBestAngle: lockedMl?.bestAngle ?? null,
    isLockedRow: lockedMl !== undefined,
    lockedOpenOddsAmerican: lockedMl?.lockedOpenOddsAmerican ?? null,
    lockedOpenerRecordedAt: lockedMl?.lockedOpenerRecordedAt ?? null,
    lockedFrozenSignals: lockedMl?.lockedSignalRowsAtLock ?? null,
  });
  const total = buildMarketEdge({
    market: "total",
    pick: totalPick,
    confidence: ouConfidence,
    grade: ouGradeForMarket,
    signalType: pred.ou_signal_type,
    marketSignal: pred.ou_market_signal,
    sharpStatus: totalStatus,
    modelSide: pred.predicted_ou_side as Side | null,
    signals,
    linesCurrent: currentLinesByGameMarket.get(`${row.id}::total`) ?? [],
    lineOpenCandidates:
      openLinesByGameMarket.get(
        `${row.id}::total::${pred.predicted_ou_side ?? "null"}`
      ) ?? [],
    autoFactors,
    homeAbbr: home,
    awayAbbr: away,
    held: isOuHeld,
    sportSpecific: pred.sport_specific,
    totalsExtras: {
      modelTotal: pred.predicted_total,
      marketTotal: totalLine,
      sportsbookLine: totalLine,
    },
    lockedPlayGrade: lockedOu?.playGrade ?? null,
    lockedNoBet: lockedOu?.noBet ?? null,
    lockedBestAngle: lockedOu?.bestAngle ?? null,
    isLockedRow: lockedOu !== undefined,
    lockedOpenOddsAmerican: lockedOu?.lockedOpenOddsAmerican ?? null,
    lockedOpenerRecordedAt: lockedOu?.lockedOpenerRecordedAt ?? null,
    lockedFrozenSignals: lockedOu?.lockedSignalRowsAtLock ?? null,
  });
  const firstInning = buildMarketEdge({
    market: "first_inning",
    pick: nrfiPick,
    confidence: nrfiConfidence,
    grade: pred.nrfi_grade,
    signalType: pred.nrfi_signal_type,
    marketSignal: pred.nrfi_market_signal,
    sharpStatus: nrfiStatus,
    modelSide: nrfiSide as Side,
    signals,
    linesCurrent: currentLinesByGameMarket.get(`${row.id}::first_inning_total`) ?? [],
    lineOpenCandidates:
      openLinesByGameMarket.get(
        `${row.id}::first_inning_total::${nrfiSide}`
      ) ?? [],
    autoFactors,
    homeAbbr: home,
    awayAbbr: away,
    held: isNrfiHeld,
    sportSpecific: pred.sport_specific,
    // 2026-06-10 v15.3 FI integrity — FI now receives locked
    // play_grade / no_bet symmetric with ML/Total. Combined with the
    // new FI cases in resolveLockedVerdict (toss_up → Watchlist,
    // no_bet / held → No Play), this closes the FI display contract:
    // the writer's verdict survives to the pill the same way it does
    // for ML/Total. lockedPlayGrade comes from prediction_records
    // (the top-level FI column is null today — that's fine, the
    // writer-authority resolver falls back to resolveWriterPlayGrade
    // which reads sport_specific.fi_v2_audit.fi_play_grade).
    lockedPlayGrade: lockedFi?.playGrade ?? null,
    lockedNoBet: lockedFi?.noBet ?? null,
    lockedBestAngle: lockedFi?.bestAngle ?? null,
    isLockedRow: lockedFi !== undefined,
    lockedOpenOddsAmerican: lockedFi?.lockedOpenOddsAmerican ?? null,
    lockedOpenerRecordedAt: lockedFi?.lockedOpenerRecordedAt ?? null,
    lockedFrozenSignals: lockedFi?.lockedSignalRowsAtLock ?? null,
  });

  // 4.1.10 — per-game status flags.
  const status: GameStatusDto = {
    lineupConfirmed: extractLineupConfirmed(pred.sport_specific),
    linesLocked:
      (currentLinesByGameMarket.get(`${row.id}::moneyline`)?.length ?? 0) > 0 ||
      (currentLinesByGameMarket.get(`${row.id}::total`)?.length ?? 0) > 0 ||
      (currentLinesByGameMarket.get(`${row.id}::first_inning_total`)?.length ?? 0) > 0,
    sharpSignalPending: signals.length === 0,
    marketDataLimited: computeGameMarketDataLimited({ ml, total, firstInning }),
  };

  // 4.1.10 — decision line for the v13.1 Edge Board card. Picks the strongest
  // (rank-by-grade) market and frames it directively.
  const decisionLine = buildDecisionLine({ ml, total, firstInning, awayAbbr: away, homeAbbr: home });

  // 4.1.10 — generatedAt from sport_specific.breakdown_generated_at when
  // present. Reflects WHEN the model output was last refreshed for this row.
  const generatedAt = extractGeneratedAt(pred.sport_specific);

  // Phase 4.2.B — derive lock state for the DTO surface.
  //   • scheduledLockAt = game_date minus the lock window (default 60min).
  //     This is when the per-game cron will set locked_at; the UI uses it
  //     for "Locks in 23 min" copy. If game_date is invalid this resolves
  //     to row.game_date as a defensive fallback so the UI still has a
  //     usable string to render.
  //   • lockedAt        = the actual locked_at timestamp from
  //     game_predictions. Null when the row hasn't been locked yet.
  //   • lockState       = three-state DTO enum mapped from our four-state
  //     classifier output: locked|already_started → "locked";
  //     entering_lock → "locking"; still_unlocked → "open".
  //   • updatedAt       = game_predictions.computed_at. Surfaces "when did
  //     this prediction last refresh" so the UI can render "Updated 4:12 PM".
  const lockClassification = classifyLockState(
    { locked_at: pred.locked_at, game_date: row.game_date },
    new Date()
  );
  const dtoLockState: DtoLockState =
    lockClassification === "locked" || lockClassification === "already_started"
      ? "locked"
      : lockClassification === "entering_lock"
        ? "locking"
        : "open";
  const scheduledLockAt = computeLocksAt(row.game_date) ?? row.game_date;

  // Phase R-10 — surface starter info per side. Joined from `players`
  // via games.home_pitcher_id / away_pitcher_id. Null when the probable
  // starter isn't posted yet. Handedness limited to "L" / "R" / null.
  const homeStarter = buildStarterDto(row.home_pitcher);
  const awayStarter = buildStarterDto(row.away_pitcher);

  return {
    id: `${row.sport}-${row.external_id}`,
    sport: row.sport as Sport,
    external_id: row.external_id,
    awayTeam: away,
    awayTeamLogo: awayLogo,
    homeTeam: home,
    homeTeamLogo: homeLogo,
    gameTime: formatTimeET(row.game_date),
    gameStartMinutes: minutesFromMidnightET(row.game_date),
    // Phase 4.2.B — actual lock-time ISO + per-game lock state from
    // game_predictions.locked_at. Pre-4.2.B these were placeholders.
    scheduledLockAt,
    lockState: dtoLockState,
    lockedAt: pred.locked_at,
    generatedAt,
    updatedAt: pred.computed_at,
    holdReason,
    homeStarter,
    awayStarter,
    markets: { moneyline: ml, total, first_inning: firstInning },
    decisionLine,
    status,
    result: null,
    // Phase 4.2.C.2 — legacy predictions block. Null picks and null
    // confidences pass through honestly (was `?? 0` / fake defaults
    // pre-4.2.C.2). The canonical member surface is `markets.*` above;
    // this block remains for back-compat consumers.
    predictions: {
      ml: {
        pick: mlPick,
        confidence: mlConfidence,
        sharpStatus: mlStatus,
        // V13 per-pick triplet for ML — sourced from ml_* DB columns.
        // Phase 6B.9 — apply V2.2 best_angle override (see deriveVerdictForRow
        // above for full rationale). headlinePrimaryMarket + findBestOfMarket
        // rank by this grade, so without the override the briefing's
        // 3-up "Best Moneyline / Total / 1st Inning" row would always
        // surface ML on every game (precedence-tiebreak on tied
        // market_watch grades). The override aligns this with the
        // game-level verdict.
        grade: mlGradeForMarket,
        signalType: pred.ml_signal_type,
        marketSignal: pred.ml_market_signal,
      },
      total: {
        pick: totalPick,
        confidence: ouConfidence,
        sharpStatus: totalStatus,
        line: totalLine,
        // V13 per-pick triplet for the total — sourced from ou_* DB columns
        // (note DB ou_* ↔ DTO predictions.total name asymmetry).
        // Phase 6B.9 — same override as predictions.ml above.
        grade: ouGradeForMarket,
        signalType: pred.ou_signal_type,
        marketSignal: pred.ou_market_signal,
      },
      nrfi: {
        pick: nrfiPick,
        confidence: nrfiConfidence,
        sharpStatus: nrfiStatus,
        // V13 per-pick triplet for 1st inning — sourced from nrfi_* DB columns.
        grade: pred.nrfi_grade,
        signalType: pred.nrfi_signal_type,
        marketSignal: pred.nrfi_market_signal,
      },
    },
    projected: {
      away: pred.predicted_away_score ?? 0,
      home: pred.predicted_home_score ?? 0,
    },
    sharpSignals: buildSignalDtos(signals, signalLookup, {
      homeTeamAbbr: home,
      awayTeamAbbr: away,
    }),
    // Phase 4.1.8.B — member-facing breakdown surface. Three fields:
    //   • verdict       — derived at read time from headline grade +
    //                     per-market confidences (never persisted)
    //   • sharpRead     — derived at read time from headline grade +
    //                     sharp signals (never persisted)
    //   • modelBreakdown— prefers sport_specific.breakdown_v2.model_breakdown
    //                     (v2), falls back to sport_specific.member_summary
    //                     (legacy v1) for rows that haven't been regenerated
    //                     under 4.1.8.B yet
    // operator_detail / breakdown_version / breakdown_generated_at
    // remain server-side and are never sent to the public API — this
    // function builds the DTO field-by-field; never spreads sport_specific.
    breakdown: buildBreakdownDto(pred, signals),
    // V2.1.1 (Phase 6.3.5e): legacy top-level grade / signalType /
    // marketSignal / primaryMarket dropped. Headline derivation lives in
    // perPickHeadline.ts (client-side) reading the per-pick fields below.
  };
}

// ─────────────────────────────────────────────────────────────────────
// 4.1.10 — per-market enrichment helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * R-16G-A — display-price book priority.
 *
 * Pre-R-16G-A this list was only the legacy US-tier-1 books
 * (`pinnacle/draftkings/fanduel/betmgm/caesars`), NONE of which exist
 * in our actual `lines` table at our current SharpAPI tier. The
 * function fell through to `pool.find((r) => r.odds_american !== null)`
 * — i.e. the first row in DB-return order — which could surface a
 * kalshi row (whose home/away semantics are inverted at our provider,
 * see SharpAPIOddsProvider). That is how a wrong-side price could
 * reach the reader.
 *
 * The new list:
 *   • keeps the tier-1 books at the top so future tier upgrades take
 *     priority automatically,
 *   • adds the real books actually returned at our current tier in
 *     trusted order,
 *   • excludes `kalshi` (audit found side flips; safer to omit until
 *     SharpAPI's normalization is fixed or we add a per-book sanity
 *     check),
 *   • ends with `splits_consensus` (R-16E synthetic — last resort).
 *
 * Together with `pickPriceRow`'s tightened fallback (returns null
 * instead of an arbitrary row when the priority list misses), this
 * removes the wrong-side-price path entirely.
 */
const BOOK_PRIORITY = [
  // Phase 6B.18 — locked snapshot wins over every live book for
  // locked games. Injected by the route's locked-snapshot override
  // (see "Phase 6B.18 — FULL locked-snapshot override" comment).
  // For unlocked games this entry simply has no matching rows.
  "locked_snapshot",
  "pinnacle",
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "bet365 us",
  "bookmaker",
  "ballybet",
  "onexbet",
  "saba",
  "fliff",
  // kalshi — intentionally excluded (R-16G-A side-flip safety)
  "splits_consensus",
] as const;

/** Pick the best (by book priority + matching side) row from a candidate set. */
/**
 * R-16G-A — pick a deterministic price row from BOOK_PRIORITY.
 *
 * Returns the first row matching `preferredSide` from the highest-
 * priority trusted book in `BOOK_PRIORITY` that has a non-null
 * `odds_american`. If NO trusted book has a price for the picked
 * side, returns `null` — better to show no price than a wrong-side
 * one. This is the "fail-closed" hardening from R-16G-A audit; the
 * pre-fix code fell back to `pool.find(...)` (first row in
 * DB-return order) which could surface a kalshi flipped row.
 *
 * When `preferredSide` is null (model held), we still walk the
 * priority list across all sides and return the first trusted row.
 * Caller is expected to gate display on the model side existing.
 */
function pickPriceRow<T extends { sportsbook: string; side: string | null; odds_american: number | null }>(
  rows: T[],
  preferredSide: Side | null
): T | null {
  if (rows.length === 0) return null;
  // R-19 Phase 5j Fix 4 — held/no-pick markets must not surface a
  // side-specific price. Pre-5j, when preferredSide was null the
  // function fell through to picking ANY row from BOOK_PRIORITY order,
  // which returned an arbitrary side (home or away depending on DB row
  // order). The UI then displayed that price next to a null pick,
  // implying the model leaned that side when it actually held. Return
  // null so the caller renders "—" instead.
  if (preferredSide === null) return null;
  const sideMatch = rows.filter((r) => r.side === preferredSide);
  const pool = sideMatch.length > 0 ? sideMatch : rows;
  for (const book of BOOK_PRIORITY) {
    const hit = pool.find((r) => r.sportsbook === book && r.odds_american !== null);
    if (hit) return hit;
  }
  // No trusted book had a price for this side. Return null rather
  // than an arbitrary row — better honest empty than wrong odds.
  return null;
}

function extractAutoFactors(
  ss: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!ss) return null;
  const af = ss.auto_factors;
  if (af && typeof af === "object" && af !== null) {
    return af as Record<string, unknown>;
  }
  return null;
}

function extractLineupConfirmed(
  ss: Record<string, unknown> | null | undefined
): boolean | null {
  if (!ss) return null;
  const v = ss.lineup_confirmed;
  if (v === true || v === false) return v;
  return null;
}

function extractGeneratedAt(
  ss: Record<string, unknown> | null | undefined
): string | null {
  if (!ss) return null;
  const v = ss.breakdown_generated_at;
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

/**
 * Derive `sharpDirection` for a single market from sharp_signals + the
 * model's picked side. "support" when a +EV row exists on the same side;
 * "push_against" when sharp signals back the OPPOSITE side; "none"
 * otherwise. First_inning callers should pass an empty signals array;
 * the helper returns "none".
 */
function deriveSharpDirection(
  signals: SignalRow[],
  marketDbKey: "moneyline" | "total" | "first_inning_total",
  modelSide: Side | null
): SharpDirection {
  if (modelSide === null) return "none";
  const relevant = signals.filter((s) => s.market_type === marketDbKey);
  if (relevant.length === 0) return "none";

  // Look for ANY +EV signal on the same side OR opposite side. Same-side
  // is "support"; opposite is "push_against".
  const sameSide = relevant.find((s) => s.side === modelSide && s.is_plus_ev === true);
  if (sameSide !== undefined) return "support";
  const oppositeSide = relevant.find((s) => s.side !== modelSide && s.is_plus_ev === true);
  if (oppositeSide !== undefined) return "push_against";
  return "none";
}

/**
 * 4.1.10 — short technical phrase to surface as the "primary driver"
 * in whyLine. Picked greedily from auto_factors based on which factor
 * is most extreme. Returns null when no factor is dominant enough.
 */
/**
 * Push 3B-7 follow-up (Phase 6B.1.6i) — pick-aware FI driver copy.
 *
 * For first_inning, the previous version returned "low projected 1st-inning
 * runs" whenever FI runs were low, regardless of whether the pick was NRFI
 * or YRFI. That surfaced as "Primary driver: low projected 1st-inning runs"
 * on YRFI cards, which contradicts the pick. We now:
 *   1. Prefer fi_v2_audit values when present (the post-cutover source of
 *      truth on game_predictions.sport_specific.fi_v2_audit).
 *   2. Choose a driver/risk phrase whose direction MATCHES the displayed
 *      pick. A "low projected runs" signal becomes a SUPPORT line for NRFI
 *      and a RISK line for YRFI — never the inverse.
 *   3. Return null for Toss-Up so the copy layer falls through to neutral
 *      Toss-Up text.
 */
function extractDataQualityTier(
  sp: Record<string, unknown> | null,
  market: "moneyline" | "total" | "first_inning",
): RecommendationTier | null {
  if (!sp) return null;
  if (market === "first_inning") {
    const fi = (sp.fi_v2_audit as Record<string, unknown> | undefined) ?? null;
    const tier = fi ? (fi.data_quality_tier as string | undefined) : undefined;
    if (tier === "high" || tier === "medium" || tier === "low" || tier === "fallback") return tier;
    return null;
  }
  const v22 = (sp.v2_2_audit as Record<string, unknown> | undefined) ?? null;
  const tier = v22 ? (v22.data_quality_tier as string | undefined) : undefined;
  if (tier === "high" || tier === "medium" || tier === "low" || tier === "fallback") return tier;
  return null;
}

function extractPlayGrade(
  sp: Record<string, unknown> | null,
  market: "moneyline" | "total" | "first_inning",
  pick: string | null,
  held: boolean,
): RecommendationPlayGrade | null {
  if (held) return "held";
  if (pick === "Toss-Up") return "toss_up";
  if (!sp) return null;
  if (market === "first_inning") {
    const fi = (sp.fi_v2_audit as Record<string, unknown> | undefined) ?? null;
    const pg = fi ? (fi.fi_play_grade as string | undefined) : undefined;
    if (pg === "best_angle" || pg === "lean" || pg === "no_bet" || pg === "toss_up" || pg === "held") return pg;
    return null;
  }
  const v22 = (sp.v2_2_audit as Record<string, unknown> | undefined) ?? null;
  const key = market === "moneyline" ? "ml_play_grade" : "ou_play_grade";
  const pg = v22 ? (v22[key] as string | undefined) : undefined;
  if (pg === "best_angle" || pg === "lean" || pg === "no_bet" || pg === "market_aligned" || pg === "held") return pg;
  return null;
}

function readFiV2Audit(sp: Record<string, unknown> | null): {
  fi_pick: string | null;
  posterior_p_nrfi: number | null;
  posterior_p_yrfi: number | null;
  market_nrfi_no_vig: number | null;
  fi_edge_pct: number | null;
  data_quality_tier: string | null;
  reason_codes: string[];
} | null {
  if (!sp || typeof sp !== "object") return null;
  const a = (sp as Record<string, unknown>).fi_v2_audit;
  if (!a || typeof a !== "object") return null;
  const audit = a as Record<string, unknown>;
  const fa = (audit.feature_audit as Record<string, unknown> | undefined) ?? {};
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const codes = Array.isArray(fa.reason_codes)
    ? (fa.reason_codes as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return {
    fi_pick: typeof audit.fi_pick === "string" ? audit.fi_pick : null,
    posterior_p_nrfi: num(audit.posterior_p_nrfi),
    posterior_p_yrfi: num(audit.posterior_p_yrfi),
    market_nrfi_no_vig: num(audit.market_nrfi_no_vig),
    fi_edge_pct: num(audit.fi_edge_pct),
    data_quality_tier: typeof audit.data_quality_tier === "string" ? audit.data_quality_tier : null,
    reason_codes: codes,
  };
}

/**
 * Phase 6B.7 — read true model + market probabilities for the picked side
 * out of v2_2_audit. Mirrors the existing readFiV2Audit/FI-override path so
 * ML and Total markets surface honest model probability instead of the
 * blended pick-strength score that ml_confidence / ou_confidence carry.
 *
 * Background: ml_confidence in V2.2 is `avg(|2p_ml-1|, |2p_ou-1|)*100 +
 * run-diff bump`, capped by tier ceiling. It blends ML AND OU strength,
 * so a 0.03-run game with a strong OU lean shows ~62% under the "ML"
 * label even though the true ML model probability is ~51%. The audit
 * carries the unblended `ml_model_prob` / `ml_market_prob` / `ml_edge_pct`
 * separately — this helper exposes them so MarketEdgeDto.modelProb /
 * modelTrustPct / marketImpliedPct / modelMarketGapPct become honest.
 *
 * Returns null when the audit is missing OR the picked-side prob can't be
 * resolved (e.g., FI market routes through readFiV2Audit instead).
 */
function readV22AuditForPick(
  sp: Record<string, unknown> | null,
  market: "moneyline" | "total",
  pickIsHome: boolean | null,
  pickIsOver: boolean | null,
): {
  modelProb: number | null;
  marketProb: number | null;
  edgePctPp: number | null;
} | null {
  if (!sp || typeof sp !== "object") return null;
  const a = (sp as Record<string, unknown>).v2_2_audit;
  if (!a || typeof a !== "object") return null;
  const audit = a as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  if (market === "moneyline") {
    // ml_model_prob / ml_market_prob in the audit are written for the
    // model's picked side (V22 emits them post-pick selection). The
    // audit's perspective IS the pick perspective, so no home/away flip.
    void pickIsHome;
    const m = num(audit.ml_model_prob);
    const k = num(audit.ml_market_prob);
    const e = num(audit.ml_edge_pct);
    if (m === null && k === null && e === null) return null;
    return { modelProb: m, marketProb: k, edgePctPp: e };
  }
  // total — Phase 6B.8 wired V2.2 to compute real no-vig OU market
  // probability from per-side over/under American odds (see
  // featureSnapshot.pickOuOdds and marketPrior.computeOuNoVigPair).
  // The audit now carries:
  //   ou_market_prob: number (real no-vig) | null (no real OU prices)
  //   ou_edge_pct:    number               | null
  // Both paths are honest — no 0.5 placeholder masquerading as edge.
  // We trust the audit values directly here, just like the ML path.
  void pickIsOver;
  const m = num(audit.ou_model_prob);
  const k = num(audit.ou_market_prob);
  const e = num(audit.ou_edge_pct);
  if (m === null && k === null && e === null) return null;
  return { modelProb: m, marketProb: k, edgePctPp: e };
}

function pickModelDriver(
  af: Record<string, unknown> | null,
  market: "moneyline" | "total" | "first_inning",
  pick: string | null,
  sportSpecific: Record<string, unknown> | null,
): string | null {
  if (!af) return null;
  const n = (k: string): number | null => {
    const v = af[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  if (market === "moneyline") {
    const hsf = n("home_starter_era_factor");
    const asf = n("away_starter_era_factor");
    if (hsf !== null && asf !== null && Math.abs(hsf - asf) > 0.1) {
      return "starter ERA edge";
    }
    const hlf = n("home_lineup_ops_factor_adjusted");
    const alf = n("away_lineup_ops_factor_adjusted");
    if (hlf !== null && alf !== null && Math.abs(hlf - alf) > 0.06) {
      return "lineup-vs-starter matchup";
    }
    return null;
  }
  if (market === "total") {
    const park = n("park_factor_runs");
    if (park !== null && Math.abs(park - 1) > 0.07) {
      return park > 1 ? "hitter-friendly park" : "pitcher-friendly park";
    }
    const w = n("weather_total_adjust");
    if (w !== null && Math.abs(w) > 0.25) {
      return w > 0 ? "weather favors offense" : "weather suppresses offense";
    }
    return null;
  }
  // first_inning — pick-aware. Toss-Up and Held both fall through to null
  // so the copy layer emits its neutral/held-specific text instead.
  if (pick === "Toss-Up" || pick === null) return null;
  const fi = readFiV2Audit(sportSpecific);
  const fiRuns = n("nrfi_expected_runs");
  const lowRuns = fiRuns !== null && fiRuns < 0.7;
  const highRuns = fiRuns !== null && fiRuns > 1.1;
  const top = af.nrfi_used_top_of_order_data;
  // FI V2 path — use posterior + market edge when present.
  if (fi) {
    const edgeAbs = fi.fi_edge_pct !== null ? Math.abs(fi.fi_edge_pct) : 0;
    if (pick === "NRFI") {
      if (lowRuns) return "low projected 1st-inning runs";
      if (edgeAbs >= 2) return "posterior favors NRFI vs the market line";
      if (top === true) return "stronger starter / top-of-order suppression";
      return null;
    }
    if (pick === "YRFI") {
      if (highRuns) return "elevated projected 1st-inning runs";
      if (edgeAbs >= 2) return "posterior favors YRFI vs the market line";
      if (top === true) return "stronger top-of-order matchup";
      return null;
    }
  }
  // V1 fallback — still direction-aware.
  if (pick === "NRFI") {
    if (lowRuns) return "low projected 1st-inning runs";
    if (top === true) return "confirmed top-of-order matchup favors NRFI";
    return null;
  }
  if (pick === "YRFI") {
    if (highRuns) return "elevated projected 1st-inning runs";
    if (top === true) return "confirmed top-of-order matchup favors YRFI";
    return null;
  }
  return null;
}

function pickRiskDriver(
  af: Record<string, unknown> | null,
  market: "moneyline" | "total" | "first_inning",
  pick: string | null,
  sportSpecific: Record<string, unknown> | null,
): string | null {
  if (!af) return null;
  const n = (k: string): number | null => {
    const v = af[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  if (market === "moneyline") {
    const hb = n("home_bullpen_factor");
    const ab = n("away_bullpen_factor");
    if (hb !== null && hb > 1.1) return "home bullpen below league average";
    if (ab !== null && ab > 1.1) return "away bullpen below league average";
    return null;
  }
  if (market === "total") {
    const w = n("weather_total_adjust");
    if (w !== null && Math.abs(w) > 0.4) {
      return "weather effect could shift the line";
    }
    return null;
  }
  // first_inning — pick-aware.
  const fi = readFiV2Audit(sportSpecific);
  const fiRuns = n("nrfi_expected_runs");
  const top = af.nrfi_used_top_of_order_data;
  if (pick === "Toss-Up") {
    // Neutral risk language for Toss-Up.
    if (fi && (fi.data_quality_tier === "low" || fi.data_quality_tier === "fallback")) {
      return "lineup or market uncertainty";
    }
    return "no clear NRFI/YRFI edge";
  }
  // FI V2 data-quality risks — apply regardless of side when present.
  if (fi) {
    if (fi.reason_codes.includes("fi_lineup_missing")) {
      return "lineup not yet confirmed — model used projected order";
    }
    if (fi.data_quality_tier === "low" || fi.data_quality_tier === "fallback") {
      return "model is operating on partial pitcher/lineup data";
    }
  }
  // Direction-aware risks: cite the factor that pushes AGAINST the pick.
  if (pick === "NRFI") {
    if (fiRuns !== null && fiRuns > 1.1) {
      return "elevated projected 1st-inning runs cut against NRFI";
    }
    if (top === false || top === null || top === undefined) {
      return "top-of-order data not yet confirmed";
    }
    return null;
  }
  if (pick === "YRFI") {
    if (fiRuns !== null && fiRuns < 0.7) {
      return "low projected 1st-inning runs cut against YRFI";
    }
    if (top === false || top === null || top === undefined) {
      return "top-of-order data not yet confirmed";
    }
    return null;
  }
  return null;
}

type BuildMarketEdgeInput = {
  market: "moneyline" | "total" | "first_inning";
  pick: string | null;
  /**
   * Phase 4.2.C.2 — null when this market is held by the auto-model.
   * Pre-4.2.C.2 callers coerced null to 0 with `?? 0`, which surfaced
   * as a misleading "0%" label. The DTO now passes null through honestly
   * and the UI renders "—" for held confidence.
   */
  confidence: number | null;
  grade: Grade | null;
  signalType: SignalType | null;
  marketSignal: MarketSignal | null;
  sharpStatus: SharpStatus;
  modelSide: Side | null;
  signals: SignalRow[];
  linesCurrent: LineRow[];
  /**
   * P7-B3 (2026-06-11) — ALL line_history rows for this (game, market, side),
   * sorted by recorded_at ASC. buildMarketEdge resolves the picked-side
   * "open" by finding the OLDEST candidate whose `sportsbook` matches the
   * current `priceRow.sportsbook`. Same-sportsbook is required so the
   * `-140 → -145` display reflects a real move at one book, not a cross-book
   * delta. When no candidate matches the current sportsbook, the open is
   * null and the line-move chip is suppressed (no fabrication).
   */
  lineOpenCandidates: LineHistoryRow[];
  autoFactors: Record<string, unknown> | null;
  homeAbbr: string;
  awayAbbr: string;
  /**
   * Phase 4.2.C.2 — true when this specific market is in the auto-model's
   * hold_picks list. Surfaces to MarketEdgeDto.held so the UI renders
   * "Held" instead of a fake default pick.
   */
  held: boolean;
  /** Totals-only — when supplied, modelTotal/marketTotal/line get populated. */
  totalsExtras?: {
    modelTotal: number | null;
    marketTotal: number | null;
    sportsbookLine: number | null;
  };
  /**
   * R-14C1 — full sport_specific JSONB. Used to extract `review_v1`
   * (reviewer audit record) for the Model/Market/Take strip. Optional
   * for backward compatibility with callers that don't surface review
   * metadata. Never spread into the DTO — only specific fields are
   * extracted via the typed helper.
   */
  sportSpecific?: Record<string, unknown> | null;
  /**
   * Lock-snapshot single source of truth (2026-06-09 lock-contract fix).
   * When this market has a locked prediction_record, callers pass the
   * locked play_grade + no_bet flag here so the verdict tier overrides
   * BEFORE generatePerMarketCopy runs — keeping the headline pill and
   * the body copy template branch in lockstep. null/undefined when the
   * market is not locked or sport is not MLB.
   */
  lockedPlayGrade?: string | null;
  lockedNoBet?: boolean | null;
  /**
   * P7-B1 (2026-06-11) — final `prediction_records.best_angle` boolean
   * for this (game, market). Passed through to resolveLockedVerdict to
   * honor the writer's public-money conflict guard when the text label
   * says "best_angle". null = unknown (preserve prior behavior); false
   * = demote display to Lean; true = display "Best Angle".
   */
  lockedBestAngle?: boolean | null;
  /**
   * Lock-snapshot honesty (2026-06-09 lock-contract fix). True when the
   * row carries a non-null `prediction_records.locked_at`, regardless of
   * whether play_grade or odds were captured. Used to set
   * priceUnavailableAtLock on the DTO when the locked snapshot has
   * no usable real-book price.
   */
  isLockedRow?: boolean;
  /**
   * 2026-06-11 P7-Commit-E — frozen opener from the locked snapshot's
   * `line_movement.open_odds_american` field. Used as the post-lock
   * `lineOpenAmerican` fallback when the live line_history lookup
   * returns null (because priceRow.sportsbook is the placeholder
   * "locked_snapshot" that doesn't match anything in line_history).
   *
   * Null pre-lock or when the writer didn't capture a usable opener.
   */
  lockedOpenOddsAmerican?: number | null;
  lockedOpenerRecordedAt?: string | null;
  /**
   * 2026-06-11 P7-Commit-F — frozen sharp_signals array captured at
   * lock time. Pulled from `snapshot_json.signal_rows_at_lock` (writer
   * captures all sides). When the row is locked, buildMarketEdge swaps
   * this in for `input.signals` so publicSplits, sharp direction,
   * marketFairProb, and steam/RLM all reflect the moment-of-lock
   * state — not whatever sharp_signals now reports. Null pre-lock or
   * when the snapshot didn't carry the array; the live `input.signals`
   * stays primary.
   */
  lockedFrozenSignals?: SignalRow[] | null;
};

// ─────────────────────────────────────────────────────────────
// Phase 4.2.C.1.R-14C1 / R-16E / R-16F-D — Model / Market / Take strip
// ─────────────────────────────────────────────────────────────
// R-16F-D — no-vig math + book priority extracted to
// `app/lab/lib/marketImplied.ts` so it can be unit-tested without
// setting up the full DTO build path. The route still owns invocation
// + DTO wiring; the helper module owns the math.
//
// The extracted version also dropped the `market === "first_inning"`
// short-circuit so the same no-vig path runs for FI markets whenever
// two-sided FI odds exist in `lines` (R-16F-C captured these rows).
// The `modelSide === null` guard remains — held / toss-up picks still
// honestly return "unavailable".

/**
 * Extract review flags + per-market action from `sport_specific.review_v1`.
 * Returns "keep" + [] when the reviewer didn't run for this row.
 */
function extractReviewMeta(
  ss: Record<string, unknown> | null | undefined,
  market: "moneyline" | "total" | "first_inning"
): {
  flags: string[];
  action:
    | "keep"
    | "cap_confidence"
    | "hold"
    | "adjust_score_toward_market"
    | "flip_side"
    | "dampen_confidence"
    | "downgrade_grade";
} {
  if (!ss || typeof ss !== "object") {
    return { flags: [], action: "keep" };
  }
  const review = (ss as { review_v1?: unknown }).review_v1;
  if (!review || typeof review !== "object") {
    return { flags: [], action: "keep" };
  }
  const r = review as Record<string, unknown>;
  const flags = Array.isArray(r.flags) ? (r.flags as string[]) : [];
  const actions = (r.actions ?? {}) as Record<string, unknown>;
  const marketKey =
    market === "moneyline" ? "ml" : market === "total" ? "ou" : "nrfi";
  const raw = actions[marketKey];
  const allowed = new Set([
    "keep",
    "cap_confidence",
    "hold",
    "adjust_score_toward_market",
    "flip_side",
    "dampen_confidence",
    "downgrade_grade",
  ]);
  const action =
    typeof raw === "string" && allowed.has(raw)
      ? (raw as
          | "keep"
          | "cap_confidence"
          | "hold"
          | "adjust_score_toward_market"
          | "flip_side"
          | "dampen_confidence"
          | "downgrade_grade")
      : "keep";
  return { flags, action };
}

/**
 * R-16I Phase 1 — translate the reviewer's flag array into per-market
 * `ReviewerSignals` consumed by `marketVerdictFor`. The reviewer's flag
 * array is global (not per-market) so each market consumes only the
 * flags that apply to it.
 *
 * Mapping today:
 *   total      → sharpConflict ← "ou_sharp_conflict"
 *   moneyline  → publicSmokeAligned ← "public_smoke_aligned_with_pick"
 *                hasFragilityFlag  ← any of the 4 strong fragility flags
 *   first_inning → all false (V1 has no FI-side reviewer surface)
 *
 * Note: `review_recommends_caution` is the reviewer's POST-cap label
 * (synthesized when STRONG_INTERVENTION_CAP fires). It's intentionally
 * NOT counted here — the cap already takes ML confidence to 52% which
 * routes to no_play via the existing confidence floor, so re-flagging
 * the same condition would double-downgrade.
 */
const STRONG_FRAGILITY_ML_FLAGS = new Set<string>([
  "extreme_run_diff_with_coinflip_market",
  "small_sample_starter_driver",
  "raw_conf_extreme_fragile",
  "huge_model_market_gap",
]);

function deriveReviewerSignals(
  flags: string[],
  market: "moneyline" | "total" | "first_inning"
): ReviewerSignals {
  if (market === "total") {
    return {
      sharpConflict: flags.includes("ou_sharp_conflict"),
      publicSmokeAligned: false,
      hasFragilityFlag: false,
    };
  }
  if (market === "moneyline") {
    return {
      sharpConflict: false,
      publicSmokeAligned: flags.includes("public_smoke_aligned_with_pick"),
      hasFragilityFlag: flags.some((f) => STRONG_FRAGILITY_ML_FLAGS.has(f)),
    };
  }
  // first_inning — no reviewer-derived warnings in V1.
  return {
    sharpConflict: false,
    publicSmokeAligned: false,
    hasFragilityFlag: false,
  };
}

function buildMarketEdge(input: BuildMarketEdgeInput): MarketEdgeDto {
  // DB key — the JSONB uses "first_inning_total" for the FI market.
  const dbMarket: "moneyline" | "total" | "first_inning_total" =
    input.market === "first_inning" ? "first_inning_total" : input.market;

  // 2026-06-11 P7-Commit-F — locked-row signals freeze. The freeze
  // contract says "locked = frozen": any sharp-signal-derived display
  // (publicSplits, sharp direction, marketFairProb, steam/RLM) must
  // reflect what we saw at lock time, not what the live sharp_signals
  // table says now. Snapshot `signal_rows_at_lock` was already
  // populated by the writer; this swap is the read side. The shape is
  // identical (same columns) so callers can treat it as `SignalRow[]`.
  // Pre-lock rows fall through to `input.signals` (live) unchanged.
  const effectiveSignals: SignalRow[] =
    input.isLockedRow === true && Array.isArray(input.lockedFrozenSignals)
      ? (input.lockedFrozenSignals as SignalRow[])
      : input.signals;

  // Sharp direction (per-market, forced "none" for first_inning by the
  // verdict helper but useful here too for copy phrasing).
  const sharpDirection: SharpDirection =
    input.market === "first_inning"
      ? "none"
      : deriveSharpDirection(effectiveSignals, dbMarket, input.modelSide);

  // Pricing — best available American odds for the picked side.
  const priceRow = pickPriceRow(input.linesCurrent, input.modelSide);
  const priceAmerican = priceRow?.odds_american ?? null;
  // Phase 7I — stamp the observation timestamp when the value came from
  // line_history via LKG hydration. undefined → value came from the live
  // lines row; UI renders normally.
  const priceObservedAt: string | null =
    priceRow?.odds_american_observed_at ?? null;
  const priceIsStale =
    priceObservedAt !== null ? isObservationStale(priceObservedAt) : false;

  // First-seen line for the picked side.
  //
  // R-19 Phase 5i Fix A — candidates are keyed by (game_id, market_type,
  // modelSide) so every row already matches the picked side.
  //
  // P7-B3 (2026-06-11) — pick the OLDEST candidate row whose sportsbook
  // matches the current priceRow's sportsbook. This guarantees the
  // displayed `-140 → -145` chain is a real move at the same book, not
  // a cross-book delta. When priceRow is null (held / no trusted book
  // has a price) or no candidate from the same book exists in
  // line_history, `lineOpen` is null and the UI suppresses the chip.
  // Candidates are already sorted ASC by recorded_at, so .find() returns
  // the oldest matching row → that's the "true opener" when present,
  // and the "oldest known stored line at this book" as the natural
  // fallback. No fabrication path.
  //
  // Post-lock note: priceRow.sportsbook becomes "locked_snapshot" which
  // doesn't exist in line_history, so locked markets correctly fall to
  // null here. Carrying the lock's underlying sportsbook to re-enable
  // post-lock line-move display is a separate writer change, not B3.
  // Prefer the opener at the SAME book as the current price (cleanest
  // open→current comparison). 2026-06-12 line-move hardening: if that book
  // has no stored opener on this side, fall back to the oldest opener on
  // the SAME side at any book rather than showing "unavailable" — the
  // candidates are pre-filtered to this (game, market, side) and sorted
  // oldest→newest, so [0] is the earliest available opener. A genuine
  // opener that merely lives at a different book is better than no line
  // move at all.
  const lineOpen: LineHistoryRow | null =
    priceRow !== null
      ? (input.lineOpenCandidates.find(
          (c) => c.sportsbook === priceRow.sportsbook,
        ) ??
        input.lineOpenCandidates[0] ??
        null)
      : null;
  const liveOpenAmerican: number | null = lineOpen?.odds_american ?? null;
  // 2026-06-11 P7-Commit-E — locked-row opener fallback. The live
  // lookup above filters by priceRow.sportsbook, which on a locked row
  // is the placeholder "locked_snapshot" that doesn't exist in
  // line_history → lookup returns null and the card's line-move section
  // disappears, even though the writer captured a real opener in
  // snapshot_json.line_movement.open_odds_american at lock time. Use
  // the carried-through frozen opener here. Pre-lock the override stays
  // null, so unlocked rows still take the live live-history value.
  const openAmerican: number | null =
    liveOpenAmerican ??
    (input.isLockedRow === true ? input.lockedOpenOddsAmerican ?? null : null);
  // Phase 7I — openAmerican already comes from line_history (always-LKG
  // semantics). Stamp its recorded_at if we have it so the UI can render
  // the age. lineOpen.recorded_at is the source's natural timestamp.
  const lineOpenObservedAt: string | null =
    lineOpen?.recorded_at ??
    (input.isLockedRow === true ? input.lockedOpenerRecordedAt ?? null : null);
  const lineOpenIsStale =
    lineOpenObservedAt !== null && openAmerican !== null
      ? isObservationStale(lineOpenObservedAt)
      : false;

  // Per-market signal-derived quantitative fields. Pick the +EV signal on
  // the model's side (preferred), falling back to ANY signal for this
  // market-side. nulls allowed when no signal row exists.
  const sigForSide =
    input.modelSide !== null
      ? effectiveSignals.find(
          (s) => s.market_type === dbMarket && s.side === input.modelSide
        ) ?? null
      : effectiveSignals.find((s) => s.market_type === dbMarket) ?? null;

  const marketFairProb = sigForSide?.pinnacle_fair_probability ?? null;
  const pinnacleEvPct = sigForSide?.ev_pct ?? null;
  const moneyPct = sigForSide?.public_money_pct ?? null;
  const betsPct = sigForSide?.public_betting_pct ?? null;
  // Phase 7I — per-field LKG stamps for the picked-side scalars. The
  // route's LKG hydration step writes *_observed_at when the value came
  // from sharp_signals_history instead of the live sharp_signals row.
  const moneyPctObservedAt: string | null =
    sigForSide?.public_money_pct_observed_at ?? null;
  const moneyPctIsStale =
    moneyPctObservedAt !== null && moneyPct !== null
      ? isObservationStale(moneyPctObservedAt)
      : false;
  const betsPctObservedAt: string | null =
    sigForSide?.public_betting_pct_observed_at ?? null;
  const betsPctIsStale =
    betsPctObservedAt !== null && betsPct !== null
      ? isObservationStale(betsPctObservedAt)
      : false;

  // marketDataLimited rule diverges per Daniel's adjustment #3:
  //   ML/Total:     true when EVERY quant field is null (no quantitative data)
  //   first_inning: true only when BOTH priceAmerican is null AND
  //                 nrfi_expected_runs is null (truly nothing to show)
  const marketDataLimited =
    input.market === "first_inning"
      ? priceAmerican === null &&
        (input.autoFactors === null ||
          input.autoFactors.nrfi_expected_runs === null ||
          input.autoFactors.nrfi_expected_runs === undefined)
      : pinnacleEvPct === null &&
        marketFairProb === null &&
        moneyPct === null &&
        betsPct === null &&
        openAmerican === null;

  // Reviewer trail from sport_specific.review_v1 (R-16 wiring). Hoisted
  // above the verdict call so R-16I Phase 1 can route reviewer signals
  // into marketVerdictFor.
  const reviewMeta = extractReviewMeta(input.sportSpecific, input.market);

  // Per-market verdict.
  //
  // Phase 4.2.C.2 — held markets route to "no_play" directly. The
  // marketVerdictFor function takes a numeric confidence, so we'd need
  // to pass 0 anyway when confidence is null; the floor checks would
  // route a 0-confidence call to no_play. The short-circuit here is
  // explicit and avoids passing misleading 0 values through the verdict
  // engine for held markets.
  //
  // R-16I Phase 1 — derive reviewer-authority signals from the flag
  // array we already extracted via extractReviewMeta. The reviewer's
  // intelligence (ou_sharp_conflict, public_smoke_aligned_with_pick,
  // single-flag fragility) flows into the verdict layer here so the
  // final user-facing verdict reflects what the reviewer actually saw,
  // not just what the grade column happens to hold.
  const reviewerSignals = deriveReviewerSignals(
    reviewMeta.flags,
    input.market
  );
  // Phase 6B.30E — derive the market-context signals for the
  // money-conflict / line-movement / edge-strength policy. Returns
  // undefined for first_inning or when there's no pick, in which case
  // the verdict ladder runs with pre-6B.30E behavior.
  const marketContext = deriveMarketContext(
    input.market,
    input.modelSide,
    effectiveSignals,
    input.linesCurrent,
    lineOpen,
    input.sportSpecific,
  );
  const liveVerdict =
    input.held || input.confidence === null
      ? { key: "no_play" as MarketVerdict, label: "No Play", warning: null }
      : marketVerdictFor({
          market: input.market,
          confidence: input.confidence,
          grade: input.grade ?? ("market_watch" as Grade),
          sharpDirection,
          marketDataLimited,
          reviewerSignals,
          marketContext,
        });
  // Writer-authority verdict (2026-06-10 v15.2) — extended from
  // lock-snapshot-only to ALL rows. The writer's play_grade is the
  // single source of truth for the customer-facing verdict whenever
  // the writer has produced one. Resolution order:
  //   1. Locked play_grade (frozen at T-60 — strongest)
  //   2. Current writer play_grade (live, from sport_specific.v2_2_audit
  //      or sport_specific.fi_v2_audit)
  //   3. Live verdict ladder (fallback only when writer has no grade)
  //
  // Why the change: pre-2026-06-10 the live verdict ladder ran on
  // every unlocked row and could silently DOWNGRADE the writer's
  // Best Angle to Watchlist via reviewer caps (public_smoke_aligned,
  // hasFragilityFlag) — caps the v2.2 writer already considered when
  // greenlighting Best Angle. That created two divergent verdict
  // systems and produced visible pre-lock vs post-lock mismatches.
  // (e.g. CIN/SD ML 2026-06-10: writer best_angle, live ladder
  // capped to Watchlist via reviewer's public_smoke_aligned flag.)
  //
  // The MarketContextWarning from the live ladder is preserved on
  // the result so the body's "watch out" copy still surfaces the
  // warning text — but it never silently overrides the headline.
  const writerPlayGrade =
    input.lockedPlayGrade ??
    resolveWriterPlayGrade(input.sportSpecific ?? null, input.market);
  const writerOverride = resolveLockedVerdict(
    writerPlayGrade,
    input.lockedNoBet ?? null,
    input.lockedBestAngle ?? null,
  );
  const verdict = writerOverride !== null
    ? { key: writerOverride.key as MarketVerdict, label: writerOverride.label, warning: liveVerdict.warning }
    : liveVerdict;

  // Server-generated copy (banned-terms-linted at output time).
  const modelDriver = pickModelDriver(input.autoFactors, input.market, input.pick, input.sportSpecific ?? null);
  const riskDriver = pickRiskDriver(input.autoFactors, input.market, input.pick, input.sportSpecific ?? null);
  // Phase 4.2.C.2 — held markets pass 0 confidence to the copy generator.
  // generatePerMarketCopy takes a numeric confidence; held markets always
  // route to verdict="no_play" (short-circuit above) so the no_play
  // template fires regardless of the confidence value.
  const copy = generatePerMarketCopy({
    market: input.market,
    verdict: verdict.key,
    pick: input.pick ?? "—",
    confidence: input.confidence ?? 0,
    sharpDirection,
    modelDriver,
    riskDriver,
    marketDataLimited,
    // Phase 6B.30E — route the verdict layer's market-context warning
    // code into the copy generator so the "watch out" line names the
    // conflict explicitly. `verdict.warning` is null when no rule
    // fired or for held/null-confidence rows (short-circuit above).
    marketContextWarning: "warning" in verdict ? verdict.warning : null,
  });

  // KeyStats.
  const keyStats = formatKeyStats(input.autoFactors, input.market);

  // Phase R-13C — two-sided publicSplits. The pre-R-13C scalars
  // (moneyPct / betsPct above) carry only the picked side's data, so
  // the reader's MarketPulse panel was pick-centered. Build an array
  // covering both sides for this (game, market) from the same
  // signal rows the picker uses. FI returns [] because /splits
  // doesn't cover first_inning_total — UI keeps the provider-
  // limitation copy already in place.
  const publicSplits = buildPublicSplits({
    market: input.market,
    dbMarket,
    signals: effectiveSignals,
    homeAbbr: input.homeAbbr,
    awayAbbr: input.awayAbbr,
    totalsLine: input.totalsExtras?.sportsbookLine ?? null,
  });

  // ── R-14C1 — Model / Market / Take strip fields ────────────────
  // modelTrustPct mirrors `confidence` on a 0..100 scale for the strip
  // (the existing `confidence` field is 0..1 to match
  // DailyEdgePredictionDto.confidence). Null when held.
  const modelTrustPct = input.confidence !== null ? input.confidence * 100 : null;
  // marketImplied: compute no-vig from a two-sided book; fall back to
  // Pinnacle fair-prob from sharp_signals when no book has both sides.
  const implied = computeMarketImplied(
    input.market,
    dbMarket,
    input.linesCurrent,
    input.modelSide,
    marketFairProb,
  );
  const marketImpliedPct = implied.pickPct;
  const marketSource = implied.source;
  const marketDataQuality = implied.quality;
  let modelMarketGapPct =
    modelTrustPct !== null && marketImpliedPct !== null
      ? +(modelTrustPct - marketImpliedPct).toFixed(1)
      : null;

  // Phase 6B.1.6L — for the first_inning market, source model/market
  // probability + edge directly from sport_specific.fi_v2_audit when
  // present. computeMarketImplied is built for ML/Total odds shapes
  // and doesn't synthesise an FI no-vig pair; fi_v2_audit already has
  // posterior_p_nrfi + market_nrfi_no_vig + fi_edge_pct that we can
  // pipe straight through.
  //
  // Phase 6B.7 — extend the same pattern to ML and Total markets via
  // v2_2_audit. The pre-6B.7 `modelProb` field on MarketEdgeDto was
  // hard-wired to `input.confidence` (the blended pick-strength score),
  // which mislabels it: a 0.03-run game with a strong OU lean showed
  // ~62% under "ML model prob" even though the unblended ml_model_prob
  // was ~51%. This block resolves the true picked-side probability,
  // market no-vig probability, and edge in percentage points so the
  // member-facing edge stack stops conflating "pick strength" with
  // "model probability".
  let modelTrustPctOverride: number | null = null;
  let marketImpliedPctOverride: number | null = null;
  let modelProbOverride: number | null = null;
  if (input.market === "moneyline" || input.market === "total") {
    const v22 = readV22AuditForPick(
      input.sportSpecific ?? null,
      input.market,
      input.market === "moneyline" ? input.modelSide === "home" : null,
      input.market === "total" ? input.modelSide === "over" : null,
    );
    if (v22 !== null) {
      if (v22.modelProb !== null) {
        modelProbOverride = v22.modelProb;
        modelTrustPctOverride = +(v22.modelProb * 100).toFixed(1);
      }
      if (v22.marketProb !== null) {
        marketImpliedPctOverride = +(v22.marketProb * 100).toFixed(1);
      }
      // edgePctPp in the audit is signed (model − market) in percentage
      // points. Prefer it over the computed gap when both inputs were
      // present in the audit, since the audit value reflects the exact
      // model output rather than the displayed-rounded difference.
      if (
        v22.edgePctPp !== null &&
        modelTrustPctOverride !== null &&
        marketImpliedPctOverride !== null
      ) {
        modelMarketGapPct = +v22.edgePctPp.toFixed(1);
      }
    }
  }
  if (input.market === "first_inning") {
    const fi = readFiV2Audit(input.sportSpecific ?? null);
    if (fi && input.pick !== null && input.pick !== "Held") {
      // Pick-side probabilities (posterior + market) for the actual pick.
      const pickIsNrfi = input.pick === "NRFI" || input.pick === "Toss-Up";
      const post =
        pickIsNrfi
          ? fi.posterior_p_nrfi
          : (fi.posterior_p_nrfi !== null ? 1 - fi.posterior_p_nrfi : null);
      const mkt =
        pickIsNrfi
          ? fi.market_nrfi_no_vig
          : (fi.market_nrfi_no_vig !== null ? 1 - fi.market_nrfi_no_vig : null);
      if (post !== null) modelTrustPctOverride = +(post * 100).toFixed(1);
      if (mkt !== null) marketImpliedPctOverride = +(mkt * 100).toFixed(1);
      if (modelTrustPctOverride !== null && marketImpliedPctOverride !== null) {
        // For Toss-Up, force gap to zero — the model is explicitly NOT
        // claiming an edge here. (fi_edge_pct is null for Toss-Up.)
        modelMarketGapPct = input.pick === "Toss-Up"
          ? 0
          : +(modelTrustPctOverride - marketImpliedPctOverride).toFixed(1);
      }
    }
  }

  return {
    pick: input.pick,
    confidence: input.confidence,
    grade: input.grade,
    signalType: input.signalType,
    marketSignal: input.marketSignal,
    sharpStatus: input.sharpStatus,
    held: input.held,
    verdict,
    guidedGuide: copy.guidedGuide,
    guidedWatchOut: copy.guidedWatchOut,
    whyLine: copy.whyLine,
    riskLine: copy.riskLine,
    // Phase 6B.7 — prefer the true V2.2 posterior model probability for
    // the picked side over the blended `input.confidence` whenever the
    // audit provides one. Pre-6B.7 this field carried `input.confidence`
    // (ml_confidence / 100 = blended pick strength), which mislabeled the
    // value as a probability. FI already had its own override path below.
    modelProb: modelProbOverride ?? input.confidence,
    marketFairProb,
    pinnacleEvPct,
    moneyPct,
    betsPct,
    publicSplits,
    priceAmerican,
    // Lock-snapshot honesty (2026-06-09 lock-contract fix). Only ever true
    // on locked rows when no usable real-book price exists. With Forward
    // Fix A in place (writer line_history fallback), this flag should
    // rarely surface; today's 4 damaged rows are the visible exception
    // and the UI renders "No price recorded at lock" instead of a blank
    // chip. Never true for unlocked markets.
    priceUnavailableAtLock: input.isLockedRow === true && priceAmerican === null,
    lineOpenAmerican: openAmerican,
    // Phase 7I — LKG age stamps. Optional fields; absent/null means
    // "fresh, render normally". Present means the value came from
    // history fallback and the UI may render "Last updated …" copy
    // when isStale=true.
    priceObservedAt,
    priceIsStale,
    lineOpenObservedAt,
    lineOpenIsStale,
    moneyPctObservedAt,
    moneyPctIsStale,
    betsPctObservedAt,
    betsPctIsStale,
    modelTotal: input.totalsExtras?.modelTotal ?? null,
    marketTotal: input.totalsExtras?.marketTotal ?? null,
    line: input.totalsExtras?.sportsbookLine ?? null,
    keyStats,
    // R-14C1 additions
    modelTrustPct: modelTrustPctOverride ?? modelTrustPct,
    marketImpliedPct: marketImpliedPctOverride ?? marketImpliedPct,
    modelMarketGapPct,
    marketSource,
    marketDataQuality,
    reviewFlags: reviewMeta.flags,
    reviewActionSummary: reviewMeta.action,
    // Phase 6B.1.6m — recommendation confidence (0..100). Edge-aware,
    // tier-capped. Separate from raw model probability.
    recommendationConfidence: computeRecommendationConfidence({
      edgePctPp: input.market === "total" ? null : modelMarketGapPct,
      edgeUnits: (() => {
        if (input.market !== "total") return null;
        const mt = input.totalsExtras?.modelTotal ?? null;
        const ln = input.totalsExtras?.sportsbookLine ?? null;
        return mt !== null && ln !== null ? mt - ln : null;
      })(),
      tier: extractDataQualityTier(input.sportSpecific ?? null, input.market),
      playGrade: extractPlayGrade(input.sportSpecific ?? null, input.market, input.pick, input.held),
      hasPick: input.pick !== null && !input.held,
    }),
  };
}

/**
 * Phase R-13C — assemble the two-sided publicSplits array for one
 * (game, market). Returns the picked-side row first when the model
 * has a side, then the opposing side, so the reader can render in a
 * stable order (pick on the left).
 *
 * Side label conventions:
 *   moneyline / spread → home/away abbreviation (PHI / SD)
 *   total              → "Over" / "Under"
 *   first_inning       → [] (provider doesn't offer; UI shows the
 *                            existing limitation copy)
 */
function buildPublicSplits(args: {
  market: "moneyline" | "total" | "first_inning";
  dbMarket: "moneyline" | "total" | "first_inning_total";
  signals: SignalRow[];
  homeAbbr: string;
  awayAbbr: string;
  totalsLine: number | null;
}): MarketEdgeDto["publicSplits"] {
  if (args.market === "first_inning") return [];

  const rows = args.signals.filter((s) => s.market_type === args.dbMarket);
  if (rows.length === 0) return [];

  const labelFor = (side: string): { side: "home" | "away" | "over" | "under"; label: string } | null => {
    if (args.market === "moneyline") {
      if (side === "home") return { side: "home", label: args.homeAbbr };
      if (side === "away") return { side: "away", label: args.awayAbbr };
      return null;
    }
    if (args.market === "total") {
      if (side === "over") return { side: "over", label: "Over" };
      if (side === "under") return { side: "under", label: "Under" };
      return null;
    }
    return null;
  };

  // Build the side rows in canonical order so the UI render order is
  // deterministic regardless of provider row ordering.
  const canonicalOrder: ReadonlyArray<"home" | "away" | "over" | "under"> =
    args.market === "moneyline" ? ["home", "away"] : ["over", "under"];

  const out: MarketEdgeDto["publicSplits"] = [];
  for (const side of canonicalOrder) {
    const sig = rows.find((r) => r.side === side);
    const meta = labelFor(side);
    if (meta === null) continue;
    // Phase 7I — pick the most recent stamp across the two fields so the
    // UI shows a single "Last updated …" timestamp per side. When both
    // fields came from the live current row (no LKG hydration), the
    // stamp stays undefined and the UI renders normally.
    const moneyAt = sig?.public_money_pct_observed_at ?? null;
    const betsAt = sig?.public_betting_pct_observed_at ?? null;
    const observedAt =
      moneyAt !== null && betsAt !== null
        ? (moneyAt > betsAt ? moneyAt : betsAt)
        : (moneyAt ?? betsAt);
    out.push({
      side: meta.side,
      label: meta.label,
      moneyPct: sig?.public_money_pct ?? null,
      betsPct: sig?.public_betting_pct ?? null,
      observedAt,
      isStale: observedAt !== null ? isObservationStale(observedAt) : false,
    });
  }
  // Drop rows where BOTH money and bets are null AND no row existed —
  // i.e. the side wasn't reported at all. Keep partial-coverage rows.
  return out.filter((r) => r.moneyPct !== null || r.betsPct !== null || rows.find((sig) => sig.side === r.side) !== undefined);
}

/**
 * 4.1.10 — true when every market lacks quantitative data. For first_inning,
 * its own marketDataLimited rule applies (see buildMarketEdge); the game-level
 * status field combines all three.
 */
function computeGameMarketDataLimited(args: {
  ml: MarketEdgeDto;
  total: MarketEdgeDto;
  firstInning: MarketEdgeDto;
}): boolean {
  const nullish = (m: MarketEdgeDto) =>
    m.pinnacleEvPct === null &&
    m.marketFairProb === null &&
    m.moneyPct === null &&
    m.betsPct === null &&
    m.lineOpenAmerican === null &&
    m.priceAmerican === null;
  return nullish(args.ml) && nullish(args.total) && nullish(args.firstInning);
}

/**
 * 4.1.10 — short directive sentence for the v13.1 Edge Board card. Picks
 * the strongest verdict across the three markets and frames it. Banned-
 * terms-linted at output.
 */
function buildDecisionLine(args: {
  ml: MarketEdgeDto;
  total: MarketEdgeDto;
  firstInning: MarketEdgeDto;
  awayAbbr: string;
  homeAbbr: string;
}): string {
  const verdictRank: Record<MarketVerdict, number> = {
    best_angle: 4,
    lean: 3,
    watchlist: 2,
    caution: 1,
    no_play: 0,
  };
  const candidates: Array<{ m: MarketEdgeDto; label: string }> = [
    { m: args.ml, label: "moneyline" },
    { m: args.total, label: "total" },
    { m: args.firstInning, label: "1st inning" },
  ];
  candidates.sort((a, b) => verdictRank[b.m.verdict.key] - verdictRank[a.m.verdict.key]);
  const top = candidates[0]!;
  const pick = top.m.pick ?? "—";
  let line: string;
  if (top.m.verdict.key === "best_angle") {
    line = `Best angle tonight: ${pick} on the ${top.label}.`;
  } else if (top.m.verdict.key === "lean") {
    line = `Lean toward ${pick} on the ${top.label}.`;
  } else if (top.m.verdict.key === "watchlist") {
    line = `On the watchlist: ${pick} on the ${top.label}.`;
  } else if (top.m.verdict.key === "caution") {
    line = `Caution flagged on the ${top.label} — model and market disagree.`;
  } else {
    line = `No clean play on this slate.`;
  }
  assertNoBannedTerms(line, "decisionLine");
  return line;
}

/**
 * Phase 4.1.8.B — Extracts the model-side breakdown prose from a
 * prediction's sport_specific JSONB. Reader-tolerant: prefers the v2
 * namespace (`sport_specific.breakdown_v2.model_breakdown`), falls back
 * to the legacy v1 single-blob (`sport_specific.member_summary`) for
 * rows that haven't been regenerated under Phase 4.1.8.B yet.
 *
 * Returns null when:
 *   • sport_specific is null/missing (older predictions)
 *   • Neither breakdown_v2.model_breakdown nor member_summary is a
 *     non-empty string
 *
 * Operator-only keys (operator_detail, breakdown_version,
 * breakdown_generated_at) are intentionally ignored — they never appear
 * in the member API response.
 */
function extractModelBreakdown(
  sportSpecific: Record<string, unknown> | null | undefined
): string | null {
  if (!sportSpecific) return null;

  // Prefer v2.
  const v2 = sportSpecific.breakdown_v2;
  if (v2 && typeof v2 === "object" && v2 !== null) {
    const mb = (v2 as Record<string, unknown>).model_breakdown;
    if (typeof mb === "string" && mb.length > 0) return mb;
  }

  // Fall back to legacy member_summary.
  const legacy = sportSpecific.member_summary;
  if (typeof legacy === "string" && legacy.length > 0) return legacy;

  return null;
}

/**
 * Phase 4.1.8.B — headline-grade derivation for verdict computation.
 *
 * Mirrors the ranking logic in app/lab/lib/perPickHeadline.ts exactly,
 * inlined here per Sub-D2: keep 4.1.8.B scope tight; consolidation
 * deferred to 4.1.8.C. Tests verify both implementations stay in sync.
 *
 * Ranking: GRADE_RANK descending, ML → OU → NRFI precedence on ties.
 * Returns null grade + null market when the model picked no markets
 * (all three per-pick grades null).
 */
const GRADE_RANK: Record<Grade, number> = {
  best_signal: 70,
  sharp_confirmed: 60,
  sharp_conflict: 50,
  market_led: 40,
  public_smoke: 30,
  model_only: 20,
  market_watch: 10,
};

/**
 * Phase 6B.9 — read the V2.2 model's own best_angle eligibility flags
 * out of the audit JSON. V2.2 already enforces strict gates internally
 * (edge ≥ 3pp ML / 3.5pp OU, conf ≥ 56%, high data quality, no key
 * feature on neutral fallback) — the resulting ml_best_angle_eligible
 * / ou_best_angle_eligible booleans ARE the model's authoritative
 * Best Angle decision.
 *
 * Background: the downstream gradeDerivationService writes the per-
 * pick grade columns (ml_grade / ou_grade / nrfi_grade) using a
 * stricter sharp-confirmation rule. On nights when sharp signals are
 * "neutral" (no confirming or conflicting action), it downgrades
 * even a clear model best_angle to "market_watch". The Daily Edge
 * verdict pipeline only saw the downgraded grade, so 0 Best Angles
 * surfaced even when the model had identified several.
 *
 * This helper exposes V2.2's eligibility flags so the verdict layer
 * can upgrade a market_watch / model_only / market_led / public_smoke
 * candidate to "best_signal" when the model itself says so. We
 * INTENTIONALLY do NOT override sharp_conflict (a real conflict
 * warning must surface) or best_signal / sharp_confirmed (already
 * top). Null grades (model didn't pick the market) are unaffected.
 *
 * This is a display-layer routing fix only — model math, the grader
 * pipeline, and DB writes are untouched.
 */
function readV22BestAngleOverride(
  sportSpecific: Record<string, unknown> | null | undefined,
): { ml: boolean; ou: boolean } {
  const empty = { ml: false, ou: false };
  if (!sportSpecific || typeof sportSpecific !== "object") return empty;
  const a = (sportSpecific as Record<string, unknown>).v2_2_audit;
  if (!a || typeof a !== "object") return empty;
  const audit = a as Record<string, unknown>;
  return {
    ml: audit.ml_best_angle_eligible === true,
    ou: audit.ou_best_angle_eligible === true,
  };
}

/**
 * Grades that the V2.2 best_angle override is allowed to upgrade.
 * NEVER upgrade sharp_conflict (loses the warning) or already-top
 * grades (no-op).
 */
const UPGRADABLE_GRADES = new Set<Grade>([
  "market_watch",
  "model_only",
  "market_led",
  "public_smoke",
] as Grade[]);

/**
 * Phase 6B.10 — public-money conflict guard for the V2.2 best_angle
 * promotion. Even when V2.2's own gates say a pick is best_angle
 * eligible, refuse to promote when sharp_signals show the OPPOSITE
 * side carrying a clear sharp-money signature (high money %, low
 * tickets % — the classic "few large bets vs many small bets" fade).
 *
 * Rule (both conditions required to suppress):
 *   • opposite_side.public_money_pct >= 60
 *   • (opposite_money - opposite_bets) >= 15pp
 *
 * Rationale: V2.2's "sharp neutral" classification is the model's
 * INTERNAL read of the sharp layer. On nights when its sharp-direction
 * heuristic misses an obvious money-vs-bets divergence (e.g. BAL@TOR
 * 2026-06-07: BAL away money 78% / bets 27% against a TOR home pick),
 * we should NOT promote to Best Angle just because the model agreed
 * with itself. Members reading "Best Angle: TOR" while the card's
 * own Market Pulse panel says "78% money on BAL" would lose trust.
 *
 * The pick stays as Watchlist (or whatever the underlying grade was)
 * with all its public-split context. The card still surfaces the
 * model edge and the conflicting market money side-by-side; the
 * verdict label is the conservative one.
 *
 * Threshold sourced from the observed 2026-06-07 slate where three
 * games (BAL@TOR, BOS@NYY, KC@MIN if pick=KC) showed clear sharp-
 * fade patterns against the model's pick. Conservative bounds:
 * opposite_money>=60 keeps single-side runaway from triggering on
 * marginal 55/45 splits; 15pp divergence isolates real money-vs-bets
 * separation from cases where everyone agrees.
 */
function oppositeOf(
  marketType: "moneyline" | "total",
  pickSide: string | null,
): string | null {
  if (pickSide === null) return null;
  if (marketType === "moneyline") {
    if (pickSide === "home") return "away";
    if (pickSide === "away") return "home";
    return null;
  }
  if (pickSide === "over") return "under";
  if (pickSide === "under") return "over";
  return null;
}

/**
 * Threshold for a "sharp-leaning" public split on either side. money% >= 60
 * AND money−bets divergence ≥ 15pp = few-large-bets pattern (sharps).
 */
function isSharpLeaningSide(row: SignalRow | undefined): boolean {
  if (!row) return false;
  const money = row.public_money_pct;
  const bets = row.public_betting_pct;
  if (money === null || bets === null) return false;
  if (money < 60) return false;
  if (money - bets < 15) return false;
  return true;
}

function findSignal(
  signals: SignalRow[],
  marketType: "moneyline" | "total",
  side: string,
): SignalRow | undefined {
  return signals.find((s) => s.market_type === marketType && s.side === side);
}

function hasOpposingPublicMoneyConflict(
  signals: SignalRow[],
  marketType: "moneyline" | "total",
  pickSide: string | null,
): boolean {
  const opp = oppositeOf(marketType, pickSide);
  if (opp === null) return false;
  return isSharpLeaningSide(findSignal(signals, marketType, opp));
}

// ─────────────────────────────────────────────────────────────────────
// Phase 6B.30E — market-context signal derivation
// ─────────────────────────────────────────────────────────────────────
//
// Pure helpers that turn the row's existing data into the typed inputs
// `marketVerdictFor` expects. NO DB writes, NO model math changes —
// only display-layer classification.
//
// Thresholds are deliberately conservative so flat lines stay "flat"
// and only meaningful moves register as confirming. These constants
// live here rather than in marketVerdictDerivation.constants.ts because
// they belong to the route's input shaping, not to the verdict rules
// themselves.
const LINE_MOVE_TOTAL_THRESHOLD_RUNS = 0.5;        // total moved at least half a run
const LINE_MOVE_ML_THRESHOLD_AMERICAN = 5;         // moneyline shifted at least 5 cents
const EDGE_STRONG_PP_THRESHOLD = 5.0;              // edge_pct ≥ +5 → strong
const EDGE_NORMAL_PP_THRESHOLD = 2.0;              // edge_pct ≥ +2 → normal
const EDGE_THIN_FLOOR_PP = 0;                       // 0 ≤ edge_pct < 2 → thin

function deriveLineMovementVsPick(
  market: "moneyline" | "total" | "first_inning",
  pickSide: string | null,
  linesCurrent: LineRow[],
  lineOpen: LineHistoryRow | null,
): LineMovementVsPick {
  if (market === "first_inning") return "unknown"; // FI ignores market context
  if (pickSide === null) return "unknown";
  if (lineOpen === null) return "unknown";
  if (linesCurrent.length === 0) return "unknown";

  // Pick the matching current row for the pick side (preserves Phase
  // R-19 Phase 5i Fix A's pick-side-based selection).
  const current = pickPriceRow(linesCurrent, pickSide as Side);
  if (!current) return "unknown";

  if (market === "total") {
    // Total: compare line_value. Under wants the line to come DOWN
    // (e.g. 10.5 → 10 confirms Under). Over wants the line to go UP.
    const openLine = lineOpen.line_value;
    const currLine = current.line_value;
    if (openLine === null || currLine === null) return "unknown";
    const delta = currLine - openLine;
    if (Math.abs(delta) < LINE_MOVE_TOTAL_THRESHOLD_RUNS) return "flat";
    // Under wants negative delta (line dropped); Over wants positive.
    if (pickSide === "Under") {
      return delta < 0 ? "confirms_pick" : "confirms_market";
    }
    if (pickSide === "Over") {
      return delta > 0 ? "confirms_pick" : "confirms_market";
    }
    return "unknown";
  }

  // Moneyline: compare odds_american. A "shortening" odds price (less
  // negative for favorites, less positive for dogs) confirms the pick.
  // Threshold is 5 American cents — generous enough that small spread-
  // micro-move doesn't trigger.
  const openOdds = lineOpen.odds_american;
  const currOdds = current.odds_american;
  if (openOdds === null || currOdds === null) return "unknown";
  const delta = currOdds - openOdds;
  if (Math.abs(delta) < LINE_MOVE_ML_THRESHOLD_AMERICAN) return "flat";
  // For favorites (negative odds): odds becoming MORE negative = price
  // shortened (the favorite got heavier favored) → confirms_pick.
  // For dogs (positive odds): odds becoming SMALLER = price shortened
  // (the dog became less of a dog) → confirms_pick.
  if (openOdds < 0 || currOdds < 0) {
    // Favorite — odds got more negative means absolute value grew.
    return delta < 0 ? "confirms_pick" : "confirms_market";
  }
  // Both positive (dog) — odds shrinking toward 0 confirms the pick.
  return delta < 0 ? "confirms_pick" : "confirms_market";
}

function deriveEdgeStrengthBucket(
  sportSpecific: Record<string, unknown> | null | undefined,
  market: "moneyline" | "total" | "first_inning",
): EdgeStrengthBucket {
  if (market === "first_inning") return "unknown";
  const edge = readV22EdgePp(sportSpecific, market);
  if (edge === null) return "unknown";
  if (edge < EDGE_THIN_FLOOR_PP) return "negative";
  if (edge < EDGE_NORMAL_PP_THRESHOLD) return "thin";
  if (edge < EDGE_STRONG_PP_THRESHOLD) return "normal";
  return "strong";
}

/**
 * Phase 6B.31a future: when a second splits provider lands, count
 * distinct providers reporting on this (game, market). Today the
 * sharp_signals rows all carry the same provider so this returns 1.
 *
 * `findSignal` already returns one row per (market, side); we count
 * distinct sources across both sides for the same market. When the
 * column shape grows a discriminator (e.g. `provider`), this swaps to
 * unique-count without changing call sites.
 */
function deriveSplitSourceCount(
  signals: SignalRow[],
  market: "moneyline" | "total",
  pickSide: string | null,
): number {
  if (pickSide === null) return 0;
  // Today's data model: any non-empty (pick or opposite) signal row
  // counts as one source. When a second provider is added, count
  // distinct `provider`/`source_name` values across those rows.
  const opp = oppositeOf(market, pickSide);
  const haveAny = signals.some(
    (s) => s.market_type === market && (s.side === pickSide || (opp !== null && s.side === opp)),
  );
  return haveAny ? 1 : 0;
}

function deriveMarketContext(
  market: "moneyline" | "total" | "first_inning",
  pickSide: string | null,
  signals: SignalRow[],
  linesCurrent: LineRow[],
  lineOpen: LineHistoryRow | null,
  sportSpecific: Record<string, unknown> | null | undefined,
): MarketContextSignals | undefined {
  if (market === "first_inning") return undefined; // FI verdicts skip the policy
  if (pickSide === null) return undefined;
  const marketType = market === "moneyline" ? "moneyline" : "total";
  return {
    moneyConflict: hasOpposingPublicMoneyConflict(signals, marketType, pickSide),
    lineMovementVsPick: deriveLineMovementVsPick(market, pickSide, linesCurrent, lineOpen),
    edgeStrength: deriveEdgeStrengthBucket(sportSpecific, market),
    sourceCount: deriveSplitSourceCount(signals, marketType, pickSide),
    // RLM signal not yet plumbed into our DB — wired but defaults false.
    // Phase 6B.31b will surface this from signal_rows_at_lock /
    // sharp_signals.has_reverse_line_movement.
    rlmAgainstPick: false,
  };
}

function hasSupportingPublicMoneyConfirmation(
  signals: SignalRow[],
  marketType: "moneyline" | "total",
  pickSide: string | null,
): boolean {
  if (pickSide === null) return false;
  return isSharpLeaningSide(findSignal(signals, marketType, pickSide));
}

/**
 * Read V2.2 audit edge for the picked market. Used as the
 * "model has at least some agreement" condition for the sharp-
 * confirmation bump (Phase 6B.10).
 */
function readV22EdgePp(
  sportSpecific: Record<string, unknown> | null | undefined,
  market: "moneyline" | "total",
): number | null {
  if (!sportSpecific || typeof sportSpecific !== "object") return null;
  const a = (sportSpecific as Record<string, unknown>).v2_2_audit;
  if (!a || typeof a !== "object") return null;
  const audit = a as Record<string, unknown>;
  const v = market === "moneyline" ? audit.ml_edge_pct : audit.ou_edge_pct;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Phase 6B.10 — three-way grade routing. Combines the V2.2 BA override
 * (Phase 6B.9), the opposing-money suppression (Phase 6B.10 conflict),
 * and the same-side money confirmation bump (Phase 6B.10 support).
 *
 * Behavior table (input grade → effective grade):
 *
 *   sharp_conflict       → unchanged (real warning, never promote/demote)
 *   best_signal / sharp_confirmed → unchanged (already top)
 *   null                 → null
 *
 *   For upgradable grades (market_watch / model_only / market_led /
 *   public_smoke):
 *     1. BA-eligible AND opposing-money-conflict   → unchanged
 *     2. BA-eligible AND not conflict              → best_signal (Best Angle)
 *     3. NOT BA-eligible AND same-side sharp money AND edge >= 1pp → market_led (Lean)
 *     4. Otherwise                                  → unchanged
 *
 * The edge>=1pp guard on the confirmation bump prevents promoting a
 * pure sharp-money pile when the model has no positive read on the
 * same side (would be promoting noise). 1pp is intentionally minimal:
 * any positive model agreement + sharp money on the same side earns
 * the Lean label.
 */
function applyV22BestAngleOverride(
  grade: Grade | null,
  marketEligible: boolean,
  opposingMoneyConflict: boolean = false,
  sameSideConfirmation: boolean = false,
  edgePp: number | null = null,
): Grade | null {
  if (grade === null) return null;
  if (!UPGRADABLE_GRADES.has(grade)) return grade;
  if (marketEligible) {
    if (opposingMoneyConflict) return grade;
    return "best_signal" as Grade;
  }
  // Same-side sharp money confirmation + positive edge → Lean bump.
  if (sameSideConfirmation && edgePp !== null && edgePp >= 1) {
    return "market_led" as Grade;
  }
  return grade;
}

function deriveVerdictForRow(pred: PredictionRow, signals: SignalRow[] = []): {
  headlineGrade: Grade | null;
  headlineMarket: SharpReadMarket | null;
  verdict: Verdict;
} {
  // Phase 6B.9 + 6B.10 — three-way grade routing combining V2.2 BA
  // override, opposing-money suppression, and same-side sharp-money
  // confirmation bump. See applyV22BestAngleOverride for the rules.
  //
  // Phase 6B.25 — Locked games freeze the verdict at lock time. Live
  // sharp signals MUST NOT override the locked best_angle eligibility,
  // because the locked snapshot (Phase 6B.18) already captured the
  // conflict/support call at lock and stored the resulting BA flag in
  // sport_specific. Pre-6B.25, live post-lock signal drift could flip
  // a locked Best Angle to Caution in the displayed verdict while
  // tracking continued to count the locked Best Angle — a member-
  // visible inconsistency. Fix: for locked games, pass empty signals
  // so conflict/support are false and the frozen override propagates.
  const override = readV22BestAngleOverride(pred.sport_specific);
  const useSignals: SignalRow[] = pred.locked_at !== null ? [] : signals;
  const mlConflict = hasOpposingPublicMoneyConflict(useSignals, "moneyline", pred.predicted_ml_winner);
  const ouConflict = hasOpposingPublicMoneyConflict(useSignals, "total", pred.predicted_ou_side);
  const mlSupport = hasSupportingPublicMoneyConfirmation(useSignals, "moneyline", pred.predicted_ml_winner);
  const ouSupport = hasSupportingPublicMoneyConfirmation(useSignals, "total", pred.predicted_ou_side);
  const mlEdge = readV22EdgePp(pred.sport_specific, "moneyline");
  const ouEdge = readV22EdgePp(pred.sport_specific, "total");
  const mlGradeEffective = applyV22BestAngleOverride(pred.ml_grade, override.ml, mlConflict, mlSupport, mlEdge);
  const ouGradeEffective = applyV22BestAngleOverride(pred.ou_grade, override.ou, ouConflict, ouSupport, ouEdge);

  const candidates: Array<{
    grade: Grade;
    market: SharpReadMarket;
    precedence: number;
  }> = [];
  if (mlGradeEffective !== null) {
    candidates.push({ grade: mlGradeEffective, market: "ml", precedence: 0 });
  }
  if (ouGradeEffective !== null) {
    candidates.push({ grade: ouGradeEffective, market: "total", precedence: 1 });
  }
  if (pred.nrfi_grade !== null) {
    candidates.push({ grade: pred.nrfi_grade, market: "nrfi", precedence: 2 });
  }
  candidates.sort((a, b) => {
    const r = GRADE_RANK[b.grade] - GRADE_RANK[a.grade];
    if (r !== 0) return r;
    return a.precedence - b.precedence;
  });

  const headline = candidates[0] ?? null;
  const headlineGrade = headline?.grade ?? null;
  const headlineMarket = headline?.market ?? null;

  const verdict = deriveVerdict({
    headlineGrade,
    perMarketConfidence: {
      ml: pred.ml_confidence !== null ? pred.ml_confidence / 100 : null,
      total: pred.ou_confidence !== null ? pred.ou_confidence / 100 : null,
      nrfi: pred.nrfi_confidence !== null ? pred.nrfi_confidence / 100 : null,
    },
  });
  return { headlineGrade, headlineMarket, verdict };
}

/**
 * Project the row's sharp_signals into the minimal {market, direction}
 * shape that sharpReadSelector consumes. Direction is derived from the
 * matching per-market grade (mirrors deriveDirection on the SharpSignalDto
 * side — both surfaces compute direction from grade, not from raw signal
 * row fields).
 */
function projectSharpSignalsForRead(
  signals: SignalRow[],
  pred: PredictionRow
): SharpSignalProjection[] {
  return signals.map((s) => {
    let market: SharpReadMarket;
    let gradeForMarket: Grade | null;
    if (s.market_type === "moneyline") {
      market = "ml";
      gradeForMarket = pred.ml_grade;
    } else if (s.market_type === "total") {
      market = "total";
      gradeForMarket = pred.ou_grade;
    } else {
      market = "nrfi";
      gradeForMarket = pred.nrfi_grade;
    }
    return { market, direction: deriveDirection(gradeForMarket) };
  });
}

/**
 * Phase 4.1.8.B — assemble the breakdown DTO field. ALWAYS returns a
 * populated object — verdict + sharpRead derive deterministically from
 * the row's grades + signals (with "no_play" / "no_data" branches for
 * empty states). modelBreakdown is the only field that can be null.
 */
function buildBreakdownDto(
  pred: PredictionRow,
  signals: SignalRow[]
): DailyEdgeGameDto["breakdown"] {
  const { headlineGrade, headlineMarket, verdict } = deriveVerdictForRow(pred, signals);

  const sharpProjection = projectSharpSignalsForRead(signals, pred);
  const sharpReadKey = selectSharpReadKey({
    headlineGrade,
    headlineMarket,
    sharpSignals: sharpProjection,
  });

  return {
    verdict: { key: verdict, label: VERDICT_LABEL[verdict] },
    sharpRead: {
      key: sharpReadKey,
      sentence: SHARP_READ_SENTENCES[sharpReadKey],
    },
    modelBreakdown: extractModelBreakdown(pred.sport_specific),
  };
}

// Exported for unit-test access (mirrors the __TEST__ pattern in
// featureSnapshot.ts). Production callers go through the GET handler.
export const __TEST__ = {
  buildGameDto,
  extractModelBreakdown,
  deriveVerdictForRow,
  projectSharpSignalsForRead,
  buildBreakdownDto,
  GRADE_RANK,
};

// ───────────────────────────────────────────────────────────────────────────
// Route handler
// ───────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sportParam = url.searchParams.get("sport");
  const dateParam = url.searchParams.get("date");
  // R-19 Phase 1 (C7) — explicit opt-in for stale-slate fallback. Default
  // (no param, or any value other than "true") = no fallback; route
  // surfaces an explicit pending/empty state via `slateState`. Callers
  // that genuinely want "show me whatever's most recent" pass
  // `?allowStale=true` and accept the labeled stale response.
  const allowStale = url.searchParams.get("allowStale") === "true";

  const sport: Sport =
    sportParam && (VALID_SPORTS as string[]).includes(sportParam)
      ? (sportParam as Sport)
      : "mlb";

  // Resolve the requested slate_date. Explicit ?date= wins; otherwise today's
  // slate in the sport's anchor timezone (ET for North American, London for UCL).
  const requestedDate = isSlateDate(dateParam) ? dateParam : currentSlateDate(sport);

  // Phase 7G — NBA branch. Member-safe path that hands off to the
  // shared NBA adapter service. Returns the MLB-shaped DailyEdgeResponse
  // so the DailyEdgeShell renders NBA games through the same components
  // it uses for MLB (sport guards inside the shell handle baseball-only
  // copy). No admin auth, no preview-only bypass. NBA pipeline is
  // read-only — no DB writes, no prediction_records, no cron.
  //
  // MLB code path below is unchanged: this branch returns early when
  // sport === "nba" and never falls through to the MLB orchestration.
  if (sport === "nba") {
    try {
      const adapted = await buildNbaDailyEdgeAdapted(requestedDate);
      return Response.json(adapted, {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
      });
    } catch (e) {
      const body: DailyEdgeResponse = {
        as_of: new Date().toISOString(),
        sport,
        date: requestedDate,
        requested_date: requestedDate,
        fallback_used: false,
        slateState: "no_data",
        slate_status: null,
        last_slate_update_at: null,
        games: [],
      };
      console.warn(`nba daily-edge: pipeline error: ${(e as Error).message}`);
      return Response.json(body, {
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  // Phase 7L Phase 3 — NHL branch. Admin-safe: SportRail keeps NHL
  // as live=false so members can't reach this via the tab, but a
  // direct URL (?sport=nhl) returns the NHL pipeline output for
  // operator review. Read-only — DB writes happen only via the
  // operator scripts (write-nhl-prediction-records, grade-nhl-games).
  if (sport === "nhl") {
    try {
      const { buildNhlDailyEdgeAdapted } = await import(
        "@/lib/services/nhl/buildNhlDailyEdgeAdapted"
      );
      const adapted = await buildNhlDailyEdgeAdapted(requestedDate);
      return Response.json(adapted, {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
      });
    } catch (e) {
      const body: DailyEdgeResponse = {
        as_of: new Date().toISOString(),
        sport,
        date: requestedDate,
        requested_date: requestedDate,
        fallback_used: false,
        slateState: "no_data",
        slate_status: null,
        last_slate_update_at: null,
        games: [],
      };
      console.warn(`nhl daily-edge: pipeline error: ${(e as Error).message}`);
      return Response.json(body, {
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  // WC-4 Phase D — soccer (FIFA World Cup) branch. Reads soccer
  // prediction_records + games and shapes them into the MLB-style
  // DailyEdgeResponse. Read-only — DB writes happen via the
  // operator/cron writer (writeSoccerPredictionRecords). Member-facing
  // label is "World Cup"; internal sport key stays `soccer`.
  if (sport === "soccer") {
    try {
      const { buildSoccerDailyEdgeAdapted } = await import(
        "@/lib/services/soccer/buildSoccerDailyEdgeAdapted"
      );
      const adapted = await buildSoccerDailyEdgeAdapted(requestedDate);
      return Response.json(adapted, {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
      });
    } catch (e) {
      const body: DailyEdgeResponse = {
        as_of: new Date().toISOString(),
        sport,
        date: requestedDate,
        requested_date: requestedDate,
        fallback_used: false,
        slateState: "no_data",
        slate_status: null,
        last_slate_update_at: null,
        games: [],
      };
      console.warn(`soccer daily-edge: pipeline error: ${(e as Error).message}`);
      return Response.json(body, {
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  // Non-live sports return empty — UI's ComingSoonState handles the message.
  if (!LIVE_SPORTS.includes(sport)) {
    const body: DailyEdgeResponse = {
      as_of: new Date().toISOString(),
      sport,
      date: requestedDate,
      requested_date: requestedDate,
      fallback_used: false,
      slateState: "no_data",
      slate_status: null,
      last_slate_update_at: null,
      games: [],
    };
    return Response.json(body, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  }

  // ─── R-19 Phase 1 (C7) — slate-state resolution ──────────────────────
  //
  // Step 1: probe the requested date for every `slate_status` row. The
  // determineSlateState helper classifies into one of six states based
  // on what (if anything) lives on the requested date.
  const { data: probeRows } = await supabase
    .from("games")
    .select("slate_status")
    .eq("sport", sport)
    .eq("slate_date", requestedDate);

  // Step 2: only query for the fallback when the caller opted in. The
  // helper handles all branches; when allowStale=false we pass null so
  // there is no silent fallback path.
  let mostRecentVisibleFallback:
    | { slate_date: string; slate_status: string }
    | null = null;
  if (allowStale) {
    const { data: latest } = await supabase
      .from("games")
      .select("slate_date, slate_status")
      .eq("sport", sport)
      .neq("slate_date", requestedDate)
      .in("slate_status", [...VISIBLE_SLATE_STATUSES])
      .order("slate_date", { ascending: false })
      .limit(1);
    const row = (latest ?? [])[0];
    if (row) {
      mostRecentVisibleFallback = {
        slate_date: row.slate_date,
        slate_status: row.slate_status,
      };
    }
  }

  const slateResult = determineSlateState({
    requestedDate,
    rowsForRequestedDate: (probeRows ?? []) as Array<{ slate_status: string }>,
    mostRecentVisibleFallback,
    allowStale,
  });
  const effectiveDate = slateResult.effectiveDate;

  // Step 3: when no games to render (pending / draft-only / hidden-only /
  // no_data), short-circuit with an explicit empty response. The UI
  // reads `slateState` to render honest copy. Avoids the heavy join
  // queries when there's nothing to display.
  if (!slateResult.shouldFetchGames) {
    const body: DailyEdgeResponse = {
      as_of: new Date().toISOString(),
      sport,
      date: effectiveDate,
      requested_date: requestedDate,
      fallback_used: false,
      slateState: slateResult.slateState,
      slate_status: slateResult.slate_status,
      last_slate_update_at: null,
      games: [],
    };
    return Response.json(body, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  }

  // ─── Games + teams + predictions (one round-trip) ────────────────────────
  // VISIBLE_SLATE_STATUSES gates draft / hidden slates out of member view per
  // V2.1 Part 9. Both the resolver (above) and this query use the same filter
  // so the response is consistent across the date fallback path.
  const { data: gameData, error: gamesErr } = await supabase
    .from("games")
    .select(
      `id, external_id, sport, game_date, slate_date, updated_at,
       home_team:home_team_id (abbreviation, logo_url),
       away_team:away_team_id (abbreviation, logo_url),
       home_pitcher:home_pitcher_id (first_name, last_name, throws),
       away_pitcher:away_pitcher_id (first_name, last_name, throws),
       game_predictions (
         source_type,
         predicted_home_score, predicted_away_score, predicted_total,
         predicted_ml_winner, ml_confidence,
         predicted_ou_side, ou_confidence,
         predicted_nrfi, nrfi_confidence,
         ml_grade, ml_signal_type, ml_market_signal,
         ou_grade, ou_signal_type, ou_market_signal,
         nrfi_grade, nrfi_signal_type, nrfi_market_signal,
         sport_specific,
         computed_at, locked_at
       )`
    )
    .eq("sport", sport)
    .eq("slate_date", effectiveDate)
    .in("slate_status", [...VISIBLE_SLATE_STATUSES])
    .order("game_date", { ascending: true });

  if (gamesErr) {
    return Response.json({ error: gamesErr.message }, { status: 500 });
  }

  // Supabase typegen renders FK expansions as arrays; runtime returns the
  // single object for to-one relations. Cast accordingly.
  const rawGames = (gameData ?? []) as unknown as GameRow[];

  // ─── Production data-mode filter (Framework §"Signal Source Quality") ──
  // Drops mock-sourced predictions before they reach members. No-op in
  // dev / preview modes; activated by ODDSPHERE_DATA_MODE=production.
  // TODO Gap-25: sharp_signals table needs source_type column. Currently
  // transitively safe because mock predictions get filtered here, before
  // their sharp_signals are even joined below.
  const games = filterMockSourceRows(
    rawGames,
    (g) => g.game_predictions?.source_type
  );

  // ─── Sharp signals for these games (batched) ─────────────────────────────
  const gameIds = games.map((g) => g.id);
  let signalsByGame = new Map<number, SignalRow[]>();
  // Sportsbook total lines per game (5F.1). Prefer Pinnacle as the de-vig
  // reference; fall back to DraftKings, then the first book we see.
  const totalLineByGame = new Map<number, number>();
  // 4.1.10 — per-market price + open price for the v13.1 Edge Stack.
  const currentLinesByGameMarket = new Map<string, LineRow[]>();
  // P7-B3 (2026-06-11) — value is the full array of line_history rows for
  // each (game, market, side), sorted by recorded_at ASC. buildMarketEdge
  // walks this list to pick the OLDEST entry whose sportsbook matches the
  // chosen `priceRow.sportsbook`, so the displayed line move is bound to a
  // single book. Pre-B3 the map stored only the first-seen row across all
  // books, which could pair an open from book A with a current from book B.
  const openLinesByGameMarket = new Map<string, LineHistoryRow[]>();
  // Lock-snapshot single source of truth (2026-06-09 lock-contract fix).
  // Hoisted out of the data-fetch block so the post-fetch DTO build loop
  // can read per-(game,market) locked play_grade + no_bet and pass them
  // into buildMarketEdge → resolveLockedVerdict. Empty when no games
  // are locked; populated below from the same Phase 6B.18 query.
  // P7-B1 (2026-06-11) — `bestAngle` now carried alongside playGrade +
  // noBet so resolveLockedVerdict can honor the writer's final boolean
  // decision. Null is treated as "unknown" so unlocked rows / FI rows
  // that don't write a meaningful boolean keep prior behavior.
  const lockedPlayGradeByGameMarket = new Map<
    string,
    {
      playGrade: string | null;
      noBet: boolean | null;
      bestAngle: boolean | null;
      // 2026-06-11 P7-Commit-E — locked snapshot's line_movement opener
      // fields. The route's request-time lineOpenAmerican lookup filters
      // line_history by the CURRENT priceRow.sportsbook, which on locked
      // rows is the placeholder "locked_snapshot" — so the live lookup
      // returns null even though the writer froze a real opener in
      // snapshot_json.line_movement.open_odds_american at lock time.
      // Carry the frozen opener here so buildMarketEdge can fall back to
      // it when the live lookup whiffs on a locked row.
      lockedOpenOddsAmerican: number | null;
      lockedOpenerRecordedAt: string | null;
      // 2026-06-11 P7-Commit-F — frozen sharp_signals array from the
      // locked snapshot. signal_rows_at_lock is per-game (same array
      // copied into every market's snapshot), so any locked row's
      // value works. Null pre-lock or when the snapshot didn't carry
      // an array — live `input.signals` then stays primary.
      lockedSignalRowsAtLock: SignalRow[] | null;
    }
  >();
  if (gameIds.length > 0) {
    const { data: signalData, error: sigErr } = await supabase
      .from("sharp_signals")
      .select(
        // Fix 4.1: dropped signal_strength + signal_summary — those legacy
      // DB columns are orphaned post-Fix-4.1 (V15 future migration drops
      // them). sharpStatus and description now derive at response time
      // from the per-pick grade + classifyEvidence + generateSignalSummary.
      "game_id, market_type, side, pinnacle_fair_probability, is_plus_ev, ev_pct, has_steam_move, steam_detected_at, steam_books_count, has_reverse_line_movement, rlm_direction, public_betting_pct, public_money_pct, computed_at"
      )
      .in("game_id", gameIds);
    if (sigErr) {
      return Response.json({ error: sigErr.message }, { status: 500 });
    }
    for (const row of (signalData ?? []) as SignalRow[]) {
      const arr = signalsByGame.get(row.game_id) ?? [];
      arr.push(row);
      signalsByGame.set(row.game_id, arr);
    }

    // 4.1.10 — pull lines for ALL three game-level markets, with odds_american
    // and side, so per-market priceAmerican + the totals line both come from
    // the same fetch. Player-prop rows are filtered server-side via player_id IS NULL.
    const { data: lineData, error: lineErr } = await supabase
      .from("lines")
      .select(
        "game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at"
      )
      .in("game_id", gameIds)
      .in("market_type", ["moneyline", "total", "first_inning_total"])
      .is("player_id", null);
    if (lineErr) {
      return Response.json({ error: lineErr.message }, { status: 500 });
    }
    // Group by game, then pick the preferred book per game.
    const totalsByGame = new Map<number, Array<{ sportsbook: string; line_value: number | null }>>();
    for (const row of (lineData ?? []) as LineRow[]) {
      const key = `${row.game_id}::${row.market_type}`;
      const arr = currentLinesByGameMarket.get(key) ?? [];
      arr.push(row);
      currentLinesByGameMarket.set(key, arr);

      // Maintain the legacy totals-line map for predictions.total.line.
      if (row.market_type === "total") {
        const tot = totalsByGame.get(row.game_id) ?? [];
        tot.push({ sportsbook: row.sportsbook, line_value: row.line_value });
        totalsByGame.set(row.game_id, tot);
      }
    }

    // ─── Phase 7I (Last Known Good) hydration ───────────────────────
    //
    // Product rule: "Latest valid data persists until newer valid data
    // replaces it. Unavailable only means we truly never had valid data."
    //
    // For each (game, market, side, field) where the current sharp_signals
    // / lines row has a NULL value but history has a non-null one, hydrate
    // the in-memory row with the historical value and stamp the original
    // observed_at on a per-field metadata key. buildMarketEdge reads the
    // stamps and propagates them onto MarketEdgeDto so the UI can render
    // subtle "Last updated …" copy on stale-but-valid values.
    //
    // Defensive: if the history tables are missing or empty, the helpers
    // return [] and this block is a no-op. Zero impact on existing rows
    // where current is already non-null.
    //
    // Locked-game behavior unchanged — the snapshot override below runs
    // AFTER this hydration and replaces signals/lines for locked games
    // with the frozen snapshot substrate, so LKG augmentation never
    // leaks into a locked-game render.
    try {
      const [splitsHistory, linesHistory] = await Promise.all([
        loadSplitsHistoryForSlate(supabase, gameIds),
        loadLinesHistoryForSlate(supabase, gameIds),
      ]);

      // ── Splits hydration ──
      // Index history by (game_id, market_type, side) so we can patch
      // in O(1) per signal-row.
      const splitsHistByKey = new Map<string, typeof splitsHistory[number]>();
      for (const h of splitsHistory) {
        splitsHistByKey.set(`${h.game_id}::${h.market_type}::${h.side}`, h);
      }

      // First, augment existing signal rows where a field is null.
      for (const [gameId, rows] of signalsByGame.entries()) {
        for (const r of rows) {
          if (r.public_money_pct !== null && r.public_betting_pct !== null) {
            continue;
          }
          const h = splitsHistByKey.get(`${gameId}::${r.market_type}::${r.side}`);
          if (h === undefined) continue;
          if (r.public_money_pct === null && h.public_money_pct !== null) {
            r.public_money_pct = h.public_money_pct;
            r.public_money_pct_observed_at = h.public_money_pct_observed_at;
          }
          if (r.public_betting_pct === null && h.public_betting_pct !== null) {
            r.public_betting_pct = h.public_betting_pct;
            r.public_betting_pct_observed_at = h.public_betting_pct_observed_at;
          }
        }
      }
      // Second, synthesize signal rows for (game, market, side) tuples
      // that have NO current row at all but DO have history. Without
      // this, sides whose row was wiped between cron passes stay blank
      // forever even when history would recover them.
      for (const h of splitsHistory) {
        const rows = signalsByGame.get(h.game_id) ?? [];
        const exists = rows.some(
          (r) => r.market_type === h.market_type && r.side === h.side,
        );
        if (exists) continue;
        const synthesized: SignalRow = {
          game_id: h.game_id,
          market_type: h.market_type,
          side: h.side,
          pinnacle_fair_probability: null,
          is_plus_ev: null,
          ev_pct: null,
          has_steam_move: null,
          steam_detected_at: null,
          steam_books_count: null,
          has_reverse_line_movement: null,
          rlm_direction: null,
          public_betting_pct: h.public_betting_pct,
          public_money_pct: h.public_money_pct,
          computed_at: null,
          public_money_pct_observed_at: h.public_money_pct_observed_at,
          public_betting_pct_observed_at: h.public_betting_pct_observed_at,
        };
        rows.push(synthesized);
        signalsByGame.set(h.game_id, rows);
      }

      // ── Lines hydration ──
      // Index history by (game_id, market_type, sportsbook, side).
      const linesHistByKey = new Map<string, typeof linesHistory[number]>();
      for (const h of linesHistory) {
        linesHistByKey.set(
          `${h.game_id}::${h.market_type}::${h.sportsbook}::${h.side}`,
          h,
        );
      }
      // Patch existing line rows where odds_american or line_value is null.
      for (const [, rows] of currentLinesByGameMarket.entries()) {
        for (const r of rows) {
          if (r.side === null) continue;
          if (r.odds_american !== null && r.line_value !== null) continue;
          const h = linesHistByKey.get(
            `${r.game_id}::${r.market_type}::${r.sportsbook}::${r.side}`,
          );
          if (h === undefined) continue;
          if (r.odds_american === null && h.odds_american !== null) {
            r.odds_american = h.odds_american;
            r.odds_american_observed_at = h.odds_american_observed_at;
          }
          if (r.line_value === null && h.line_value !== null) {
            r.line_value = h.line_value;
            r.line_value_observed_at = h.line_value_observed_at;
          }
        }
      }
      // Synthesize rows for missing (game, market, sportsbook, side).
      for (const h of linesHistory) {
        const key = `${h.game_id}::${h.market_type}`;
        const rows = currentLinesByGameMarket.get(key) ?? [];
        const exists = rows.some(
          (r) =>
            r.sportsbook === h.sportsbook && r.side === h.side,
        );
        if (exists) continue;
        const synthesized: LineRow = {
          game_id: h.game_id,
          market_type: h.market_type,
          sportsbook: h.sportsbook,
          side: h.side,
          line_value: h.line_value,
          odds_american: h.odds_american,
          fetched_at: null,
          odds_american_observed_at: h.odds_american_observed_at,
          line_value_observed_at: h.line_value_observed_at,
        };
        rows.push(synthesized);
        currentLinesByGameMarket.set(key, rows);
      }
    } catch (lkgErr) {
      // LKG hydration is a value-add overlay. Never break the slate
      // assembly on a hydration error — log and continue with the
      // pre-LKG behavior (current-row-only).
      console.warn(`LKG hydration skipped: ${(lkgErr as Error).message}`);
    }
    // R-16G-A — totals-line selection now uses the same hardened
    // BOOK_PRIORITY as `pickPriceRow`. The pre-fix fallback to "any row
    // with a line_value" was untrusted; the new behavior returns null
    // when no trusted book has the line (rather than an arbitrary
    // book's value).
    for (const [gameId, rows] of totalsByGame.entries()) {
      let chosen: number | null = null;
      for (const book of BOOK_PRIORITY) {
        const hit = rows.find((r) => r.sportsbook === book && r.line_value !== null);
        if (hit) { chosen = hit.line_value!; break; }
      }
      if (chosen !== null) totalLineByGame.set(gameId, chosen);
    }

    // Phase 6B.18 — FULL locked-snapshot override.
    //
    // For games whose prediction_records is locked (locked_at !=
    // null), Daily Edge MUST render the pregame snapshot, not the
    // live game_predictions + lines + sharp_signals which keep
    // moving mid-game. We achieve this in two places:
    //   (a) totalLineByGame override (preserves the 6B.17 fix)
    //   (b) MUTATE the in-memory game.game_predictions to swap pick,
    //       confidence, sport_specific to the locked snapshot. This
    //       single swap propagates the lock through every downstream
    //       extractor: pick/side, confidence, ml_play_grade, ou_play_grade,
    //       best_angle_eligible, model_prob, market_prob, edge_pct,
    //       reviewer flags, all sharp/verdict derivation, etc.
    //   (c) Add synthesized rows to currentLinesByGameMarket for ML +
    //       OU using locked odds_american, so priceAmerican on the
    //       DTO uses the locked snapshot's price too.
    //
    // Reads prediction_records for THIS slate's ML + total markets
    // where locked_at != null. Per-game-per-market override.
    const { data: lockedRecRows } = await supabase
      .from("prediction_records")
      .select(
        "game_id, market, pick, side, line_value, odds_american, confidence, model_probability, market_probability, edge, play_grade, best_angle, no_bet, locked_at, snapshot_json",
      )
      .eq("sport", "mlb")
      .eq("slate_date", requestedDate)
      // 2026-06-10 FI lock-contract fix — extend to first_inning so the
      // FI Daily Edge card stops drifting post-lock when the model
      // re-runs and flips its pick. ML/Total already follow this
      // contract (Phase 6B.18 + commit 05ae36e); FI was the scope gap.
      .in("market", ["moneyline", "total", "first_inning"])
      .not("locked_at", "is", null);
    type LockedRec = {
      game_id: number;
      market: string;
      pick: string | null;
      side: string | null;
      line_value: number | null;
      odds_american: number | null;
      confidence: number | null;
      model_probability: number | null;
      market_probability: number | null;
      edge: number | null;
      play_grade: string | null;
      best_angle: boolean | null;
      no_bet: boolean | null;
      locked_at: string | null;
      snapshot_json: Record<string, unknown> | null;
    };
    const lockedByGameMarket = new Map<string, LockedRec>();
    for (const r of (lockedRecRows ?? []) as LockedRec[]) {
      lockedByGameMarket.set(`${r.game_id}::${r.market}`, r);
      // Lock-snapshot single source of truth (2026-06-09): per-(game,market)
      // play_grade + no_bet for the downstream DTO build loop. Same data
      // as lockedByGameMarket, separate map so buildGameDto doesn't need
      // the full snapshot row.
      // Extract frozen opener fields from the locked snapshot's
      // line_movement subfield (populated by buildLineMovementSnapshot
      // at write time). Used by buildMarketEdge below when the live
      // sportsbook-keyed lookup returns null on a locked row.
      const lm = (r.snapshot_json as { line_movement?: { open_odds_american?: number | null; opener_recorded_at?: string | null } } | null)?.line_movement;
      const sigsAtLock = (r.snapshot_json as { signal_rows_at_lock?: unknown[] } | null)?.signal_rows_at_lock;
      lockedPlayGradeByGameMarket.set(`${r.game_id}::${r.market}`, {
        playGrade: r.play_grade,
        noBet: r.no_bet,
        bestAngle: r.best_angle,
        lockedOpenOddsAmerican: lm?.open_odds_american ?? null,
        lockedOpenerRecordedAt: lm?.opener_recorded_at ?? null,
        lockedSignalRowsAtLock: Array.isArray(sigsAtLock) ? (sigsAtLock as SignalRow[]) : null,
      });
    }

    // P7-B1 (2026-06-11) — pre-lock best_angle boolean lookup.
    //
    // The locked query above filters to `locked_at != null`. The pre-lock
    // verdict path (resolveWriterPlayGrade → resolveLockedVerdict) needs
    // to see the writer's final boolean too — that's what the
    // predictionRecordService.hasOpposingPublicMoneyConflict guard sets.
    // Without this lookup, an unlocked row whose text=play_grade="best_angle"
    // but boolean=false (because the conflict guard fired at write time)
    // still rendered "Best Angle" pre-lock. The boolean below feeds the
    // resolveLockedVerdict third argument so the demote rule fires
    // identically pre- and post-lock.
    //
    // Important: this query DOES NOT mutate game_predictions like the
    // locked path above. It only populates the per-(game,market) boolean
    // for the verdict-honor guard.
    //
    // P7-Commit-B Phase 1 (2026-06-11) — also pull snapshot_json so the
    // pre-lock substrate swap below can wire Market Pulse / lines from
    // the same input moment the writer used to compute play_grade +
    // best_angle. Without this the card mixes live sharp_signals with
    // an older writer snapshot; with this every component on the card
    // reflects one coherent recommendation moment.
    const { data: unlockedBaRows } = await supabase
      .from("prediction_records")
      .select("game_id, market, play_grade, no_bet, best_angle, snapshot_json")
      .eq("sport", "mlb")
      .eq("slate_date", requestedDate)
      .in("market", ["moneyline", "total", "first_inning"])
      .is("locked_at", null);
    type UnlockedRec = {
      game_id: number;
      market: string;
      play_grade: string | null;
      no_bet: boolean | null;
      best_angle: boolean | null;
      snapshot_json: Record<string, unknown> | null;
    };
    const unlockedByGameMarket = new Map<string, UnlockedRec>();
    for (const r of (unlockedBaRows ?? []) as UnlockedRec[]) {
      const key = `${r.game_id}::${r.market}`;
      unlockedByGameMarket.set(key, r);
      // Locked rows already populated above — don't overwrite their
      // authoritative locked state with the pre-lock writer's current
      // state.
      if (lockedPlayGradeByGameMarket.has(key)) continue;
      lockedPlayGradeByGameMarket.set(key, {
        playGrade: r.play_grade,
        noBet: r.no_bet,
        bestAngle: r.best_angle,
        // Unlocked rows don't have a true T-60 opener yet — set null
        // so the live live opener lookup stays primary for pre-lock cards.
        lockedOpenOddsAmerican: null,
        lockedOpenerRecordedAt: null,
        lockedSignalRowsAtLock: null,
      });
    }
    // (a) totalLineByGame override (6B.17 behavior preserved)
    for (const r of lockedByGameMarket.values()) {
      if (r.market === "total" && r.line_value !== null) {
        totalLineByGame.set(r.game_id, r.line_value);
      }
    }
    // (b) In-place swap of game_predictions for locked games — pick,
    //     confidence, sport_specific (the audit). The locked
    //     snapshot_json carries the full sport_specific that was
    //     captured at lock time, so downstream extractors that read
    //     sport_specific.v2_2_audit.* get the frozen values.
    for (const g of games) {
      const lockedMl = lockedByGameMarket.get(`${g.id}::moneyline`);
      const lockedOu = lockedByGameMarket.get(`${g.id}::total`);
      // 2026-06-10 FI lock-contract fix — pull the locked FI row too so
      // the FI card stops reading live `pred.predicted_nrfi` after lock.
      const lockedFi = lockedByGameMarket.get(`${g.id}::first_inning`);
      if (!lockedMl && !lockedOu && !lockedFi) continue;
      if (!g.game_predictions) continue;
      const pred = g.game_predictions;
      // Prefer the most-complete snapshot (ML, OU, and FI share the same
      // game_predictions.sport_specific at lock time, so any is fine —
      // fall back through them if some are missing).
      const lockedSp = (lockedMl?.snapshot_json ?? lockedOu?.snapshot_json ?? lockedFi?.snapshot_json) as
        | Record<string, unknown>
        | null;
      if (lockedSp !== null && lockedSp !== undefined) {
        // Cast: PredictionRow is typed but we mutate live to swap audit
        // data. Downstream code reads sport_specific generically.
        (pred as unknown as { sport_specific: Record<string, unknown> }).sport_specific = lockedSp;
      }
      if (lockedMl) {
        (pred as unknown as { predicted_ml_winner: string | null }).predicted_ml_winner =
          lockedMl.pick;
        (pred as unknown as { ml_confidence: number | null }).ml_confidence =
          lockedMl.confidence;
      }
      if (lockedOu) {
        (pred as unknown as { predicted_ou_side: string | null }).predicted_ou_side =
          lockedOu.pick;
        (pred as unknown as { ou_confidence: number | null }).ou_confidence =
          lockedOu.confidence;
      }
      if (lockedFi) {
        // 2026-06-10 FI lock-contract fix — convert the locked FI pick
        // string back to the boolean shape that the downstream FI
        // builder reads. Mapping:
        //   "NRFI"    → predicted_nrfi=true
        //   "YRFI"    → predicted_nrfi=false
        //   "Toss-Up" → predicted_nrfi=true (Toss-Up is communicated to
        //                the card via sport_specific.fi_v2_audit fields
        //                which were already swapped above; this boolean
        //                just preserves the NRFI-side identity that
        //                Phase 4D.1 uses for the Toss-Up zone)
        //   null      → predicted_nrfi=null (held / no pick)
        (pred as unknown as { predicted_nrfi: boolean | null }).predicted_nrfi =
          lockedFi.pick === null
            ? null
            : lockedFi.pick === "YRFI"
              ? false
              : true;
        (pred as unknown as { nrfi_confidence: number | null }).nrfi_confidence =
          lockedFi.confidence;
      }
      // Make sure locked_at is present so downstream lock-aware UI
      // bits (LockBadge etc.) render the lock state correctly even
      // when game_predictions.locked_at was cleared.
      const anyLockedAt = lockedMl?.locked_at ?? lockedOu?.locked_at ?? lockedFi?.locked_at;
      if (anyLockedAt !== undefined) {
        (pred as unknown as { locked_at: string | null }).locked_at = anyLockedAt ?? null;
      }
      // Phase 6B.28 — swap predicted_*_score and V2.1 framework grades
      // (ml_grade/ou_grade/nrfi_grade + signal_type + market_signal) from
      // the lock substrate, so predictions[market].grade / signalType /
      // marketSignal and projected.home/away are frozen at lock too.
      // Missing fields (pre-6B.28 snapshots) leave pred's live values in
      // place, which preserves prior 6B.18 behavior for old locks.
      const ps = (lockedSp?.predicted_scores_at_lock ?? null) as
        | { home: number | null; away: number | null }
        | null;
      if (ps !== null) {
        (pred as unknown as { predicted_home_score: number | null }).predicted_home_score = ps.home;
        (pred as unknown as { predicted_away_score: number | null }).predicted_away_score = ps.away;
      }
      const fg = (lockedSp?.framework_grades_at_lock ?? null) as Record<string, string | null> | null;
      if (fg !== null) {
        for (const k of [
          "ml_grade", "ml_signal_type", "ml_market_signal",
          "ou_grade", "ou_signal_type", "ou_market_signal",
          "nrfi_grade", "nrfi_signal_type", "nrfi_market_signal",
        ] as const) {
          if (k in fg) {
            (pred as unknown as Record<string, string | null>)[k] = fg[k] ?? null;
          }
        }
      }
    }
    // Phase 6B.28 — rehydrate sharp_signals + lines from the lock
    // substrate for locked games. The pre-6B.28 route fed LIVE
    // sharp_signals and live `lines` rows into the DTO build for
    // every game, regardless of lock state. After lock, publicSplits
    // / sharpSignals / breakdown.sharpRead / marketEdge.publicMoney*
    // / lineCurrentAmerican kept moving as the live sources drifted
    // (or returned nulls post-start). 6B.18 froze the headline
    // (pick, confidence, sport_specific, line, odds) by swapping pred
    // in-place; this block freezes the signal + line substrate too.
    //
    // For locked games:
    //   • If snapshot has signal_rows_at_lock + lines_at_lock (locks
    //     after Phase 6B.28 ships) → replace the live arrays with
    //     rehydrated snapshot arrays. DTO renders identically to
    //     pregame at the lock instant.
    //   • If snapshot lacks these fields (pre-6B.28 locks, including
    //     today's 28 ML/OU rows from before this deploy) → replace
    //     with empty arrays. UI hides those panels quietly per the
    //     "not available at lock" honest rule — never live drift.
    //
    // P7-Commit-B Phase 1 (2026-06-11) — coherent pre-lock snapshot.
    //
    // The writer captures `signal_rows_at_lock` + `lines_at_lock` into
    // snapshot_json on EVERY refresh (Phase 6B.28's "at_lock" name is
    // misleading — the substrate is rebuilt each cron tick, not just at
    // T-60). Reading from it pre-lock — not just post-lock — means
    // Market Pulse, Quick Read, play_grade, best_angle, edge, copy,
    // and line move all derive from the same input moment. Live data
    // continues to flow into sharp_signals and lines tables, but the
    // route renders the snapshot until the writer's next refresh.
    //
    // Behavior by lock state:
    //   • Locked rows: existing semantics — swap to substrate if
    //     present, wipe to empty if not (honest "not captured at lock").
    //   • Unlocked rows WITH substrate: swap to substrate. Card is
    //     coherent against the writer's last refresh.
    //   • Unlocked rows WITHOUT substrate (e.g. very new row, very old
    //     writer): leave live arrays in place — same as pre-Phase-1
    //     behavior. Fall-through, no regression for legacy rows.
    for (const g of games) {
      const lockedMl = lockedByGameMarket.get(`${g.id}::moneyline`);
      const lockedOu = lockedByGameMarket.get(`${g.id}::total`);
      const unlockedMl = unlockedByGameMarket.get(`${g.id}::moneyline`);
      const unlockedOu = unlockedByGameMarket.get(`${g.id}::total`);
      const unlockedFi = unlockedByGameMarket.get(`${g.id}::first_inning`);
      const isLocked = lockedMl !== undefined || lockedOu !== undefined;
      const snapshot =
        (lockedMl?.snapshot_json ??
          lockedOu?.snapshot_json ??
          unlockedMl?.snapshot_json ??
          unlockedOu?.snapshot_json ??
          unlockedFi?.snapshot_json ??
          null) as Record<string, unknown> | null;
      if (!isLocked && !snapshot) continue;
      const sigsAtLock = (snapshot?.signal_rows_at_lock ?? null) as
        | SignalRow[]
        | null;
      const linesAtLock = (snapshot?.lines_at_lock ?? null) as
        | LineRow[]
        | null;

      // Signals swap — same rule for locked + unlocked:
      // present array → frozen substrate, missing → empty for locked
      // (honest hide), preserve live for unlocked (no regression).
      if (Array.isArray(sigsAtLock)) {
        signalsByGame.set(
          g.id,
          sigsAtLock.map((s) => ({ ...s, game_id: g.id })),
        );
      } else if (isLocked) {
        signalsByGame.set(g.id, []);
      }
      // else (unlocked + no substrate): leave the live signals array in place.

      // Lines swap — same rule structure.
      if (Array.isArray(linesAtLock)) {
        for (const market of ["moneyline", "total"]) {
          currentLinesByGameMarket.delete(`${g.id}::${market}`);
        }
        for (const lr of linesAtLock) {
          const key = `${lr.game_id}::${lr.market_type}`;
          const arr = currentLinesByGameMarket.get(key) ?? [];
          arr.push({
            game_id: lr.game_id,
            market_type: lr.market_type,
            sportsbook: lr.sportsbook,
            side: lr.side,
            line_value: lr.line_value,
            odds_american: lr.odds_american,
            fetched_at: lr.fetched_at,
          });
          currentLinesByGameMarket.set(key, arr);
        }
      } else if (isLocked) {
        for (const market of ["moneyline", "total"]) {
          currentLinesByGameMarket.delete(`${g.id}::${market}`);
        }
      }
      // else (unlocked + no substrate): leave live lines arrays in place.
    }
    // (c) Inject locked ML/OU odds into currentLinesByGameMarket so
    //     priceAmerican on the DTO uses the locked snapshot price.
    //     Only injects when locked odds_american is non-null. The
    //     synthetic row uses sportsbook="locked_snapshot" so it sorts
    //     in via BOOK_PRIORITY (added below) and wins for the picked
    //     side; live rows for other books are still present but the
    //     route's pickPriceRow selects via BOOK_PRIORITY which now
    //     places "locked_snapshot" first.
    for (const r of lockedByGameMarket.values()) {
      if (r.odds_american === null || r.side === null) continue;
      const lockedRow: LineRow = {
        game_id: r.game_id,
        market_type: r.market,
        sportsbook: "locked_snapshot",
        side: r.side,
        line_value: r.line_value,
        odds_american: r.odds_american,
        fetched_at: r.locked_at,
      };
      const key = `${r.game_id}::${r.market}`;
      const arr = currentLinesByGameMarket.get(key) ?? [];
      arr.unshift(lockedRow); // unshift so it's first if BOOK_PRIORITY doesn't include it
      currentLinesByGameMarket.set(key, arr);
    }

    // 4.1.10 — per-game-market first-seen line price for `lineOpenAmerican`.
    // Per Daniel's direction (4.1.9.B section 10): use MIN(recorded_at) as
    // the "first seen" since linesService hardcodes is_opener=false.
    //
    // 2026-06-12 line-move fix — paginate to defeat PostgREST's 1000-row
    // cap. A busy slate's line_history exceeds 1000 rows (books × markets ×
    // timestamps); a single capped fetch ordered ascending silently kept
    // only the 1000 OLDEST rows and starved openers for whichever (game,
    // market) recorded later — non-deterministically nulling
    // lineOpenAmerican and showing "Line Move unavailable" on cards whose
    // opener really exists. Page through (recorded_at, id) ascending so the
    // per-key map below still sees the true oldest row for every key.
    const HIST_PAGE = 1000;
    const histData: LineHistoryRow[] = [];
    for (let from = 0; ; from += HIST_PAGE) {
      const { data: page, error: histErr } = await supabase
        .from("line_history")
        .select("game_id, market_type, sportsbook, side, line_value, odds_american, recorded_at")
        .in("game_id", gameIds)
        .in("market_type", ["moneyline", "total", "first_inning_total"])
        .is("player_id", null)
        .order("recorded_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + HIST_PAGE - 1);
      if (histErr) {
        return Response.json({ error: histErr.message }, { status: 500 });
      }
      const rows = (page ?? []) as LineHistoryRow[];
      histData.push(...rows);
      if (rows.length < HIST_PAGE) break;
      // Safety bound (no silent cap): line_history for a single slate
      // should never approach 100k rows. Log and stop if it does.
      if (from / HIST_PAGE >= 100) {
        console.warn(
          `daily-edge line_history pagination hit 100-page bound (${histData.length} rows); openers may be incomplete`,
        );
        break;
      }
    }
    for (const row of histData) {
      // R-19 Phase 5i Fix A — key by (game_id, market_type, side). Pre-5i
      // the key omitted side, so when line_history had rows for BOTH sides
      // of a market (which is normal — every two-sided market does), only
      // the first-recorded row survived in the map. If the model's pick
      // was on the opposite side, the downstream side-filter nulled
      // `lineOpenAmerican` even when the picked side's open price did
      // exist in line_history. Including side in the key lets the lookup
      // be side-correct.
      // line_history.side can be null defensively; bucket those under
      // a "null" key.
      //
      // P7-B3 (2026-06-11) — append all rows per side (not first-seen-wins).
      // The query is `.order("recorded_at", { ascending: true })` so each
      // array stays sorted oldest → newest, and buildMarketEdge can call
      // `.find(c => c.sportsbook === priceRow.sportsbook)` to get the
      // oldest entry at the chosen book.
      const key = `${row.game_id}::${row.market_type}::${row.side ?? "null"}`;
      const arr = openLinesByGameMarket.get(key) ?? [];
      arr.push(row);
      openLinesByGameMarket.set(key, arr);
    }
  }

  // ─── Assemble DTOs ───────────────────────────────────────────────────────
  const dtos: DailyEdgeGameDto[] = [];
  for (const g of games) {
    const dto = buildGameDto(
      g,
      signalsByGame.get(g.id) ?? [],
      totalLineByGame.get(g.id) ?? null,
      currentLinesByGameMarket,
      openLinesByGameMarket,
      lockedPlayGradeByGameMarket
    );
    if (dto) dtos.push(dto);
  }

  // Lock-snapshot single-source-of-truth handling moved upstream
  // (2026-06-09 lock-contract fix). The post-DTO verdict overlay that
  // previously lived here only changed the headline pill — the body
  // copy template was already rendered from the live-derived verdict
  // and would contradict the locked pill on Caution-classified rows.
  //
  // The fix lifts the override into `buildMarketEdge` via the
  // `lockedPlayGrade` / `lockedNoBet` inputs and `resolveLockedVerdict`
  // helper. With that in place, `generatePerMarketCopy` receives the
  // locked verdict and produces a body template branch that agrees
  // with the headline pill. See `lockedPlayGradeByGameMarket` map.

  // R-19 Phase 1 — last_slate_update_at = max(games.updated_at) across
  // the displayed slate. Null when no rows carry an updated_at.
  let lastSlateUpdateAt: string | null = null;
  for (const g of games) {
    if (g.updated_at === null || g.updated_at === undefined) continue;
    if (lastSlateUpdateAt === null || g.updated_at > lastSlateUpdateAt) {
      lastSlateUpdateAt = g.updated_at;
    }
  }

  const body: DailyEdgeResponse = {
    as_of: new Date().toISOString(),
    sport,
    date: effectiveDate,
    requested_date: requestedDate,
    fallback_used: effectiveDate !== requestedDate,
    slateState: slateResult.slateState,
    slate_status: slateResult.slate_status,
    last_slate_update_at: lastSlateUpdateAt,
    games: dtos,
  };
  return Response.json(body, {
    headers: {
      // Short edge cache keeps stampedes off Supabase; clients also poll.
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
