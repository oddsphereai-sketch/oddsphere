/**
 * Push 4 — Prediction Record service.
 *
 * Reads `game_predictions` rows for a slate, splits each into one
 * prediction_records row per non-held market (ML, total, FI), and
 * upserts via the (game_id, market, model_version, slate_date)
 * unique key.
 *
 * Idempotent. Never modifies game_predictions. Never touches
 * locked_at, predictions, or slate_status.
 *
 * When the tracking_baselines / prediction_records tables don't yet
 * exist (migration v17 not applied), the service returns a clean
 * error rather than throwing — the operator script surfaces a
 * helpful message.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PredictionRecordRow,
  TrackedSport,
  TrackedMarketV17,
} from "../types/domain/Tracking";
import { BOOK_PRIORITY as SHARED_BOOK_PRIORITY } from "../config/bookPriority";
import { isBlockedSportsbook } from "../config/blockedSportsbooks";
import { resolveMlInversionFlip, ML_INVERSION_RULE_ID } from "./mlInversionFlip";
import {
  resolveTotalsMarketOpposedFlip,
  resolveTotalsMeanFlip,
  TOTALS_MARKET_OPPOSED_FLIP_RULE_ID,
  TOTALS_MEAN_FLIP_RULE_ID,
} from "./totalsMeanFlip";
import { resolveFiInversionFlip, FI_INVERSION_RULE_ID } from "./fiInversionFlip";
import { flipRecommendationConfidence } from "./flipConfidence";
import { selectMainTotalLine } from "./selectMainTotalLine";
import { readMarketIntelligenceV2Config } from "../config/marketIntelligenceV2";
import {
  MLB_ML_RAW_MODEL_SIDE_PICK_CALIBRATION_RULE_ID,
  resolveMlbMlPickCalibration,
} from "./pickCalibrationLayer";
import { buildMlbModelLayerVersions } from "../automodel/mlbModelLayerVersions";

const SYNTHETIC_PRICE_BOOKS = new Set(["locked_snapshot", "recommendation_snapshot", "splits_consensus"]);
const BOOK_PRIORITY: readonly string[] = SHARED_BOOK_PRIORITY.filter(
  (book) => !SYNTHETIC_PRICE_BOOKS.has(book),
);

export type CreateRecordsOptions = {
  sport: TrackedSport;
  slateDate: string;
  /**
   * When true, the records get `launch_day=true` and
   * `manual_outcome_expected=true`. The admin tracking page can
   * exclude these from "fresh automated tracking" aggregates.
   */
  launchDay: boolean;
  /** When false → dry-run; no DB writes. */
  apply: boolean;
  supabase: SupabaseClient;
  /**
   * When true, include held markets as records with held=true. By
   * default, held markets are skipped (matches the v17 design:
   * snapshots represent picks the model actually made).
   */
  includeHeld?: boolean;
  /**
   * Lock-stage safety: when true, an existing prediction_records row for the
   * same game/market/model/slate is treated as the public card to preserve,
   * even if it is not locked yet. Used by pregame-sweep's t60 path so the
   * final lock stamps what members were already shown instead of overwriting it
   * with a last-second model recompute.
   */
  preserveExistingUnlocked?: boolean;
};

export type CreateRecordsResult = {
  scanned: number;
  proposed: PredictionRecordRow[];
  insertedCount: number;
  skippedExisting: number;
  skippedHeld: number;
  errors: Array<{ game_id: number; market: TrackedMarketV17; reason: string }>;
  /** Set when the underlying tables are missing — the operator surfaces this. */
  tablesInitialized: boolean;
};

type GameRow = {
  id: number;
  external_id: number;
  game_date: string | null;
  slate_status: string | null;
  home_team_id: number;
  away_team_id: number;
};

type PredictionRow = {
  id: number;
  game_id: number;
  predicted_ml_winner: string | null;
  ml_confidence: number | null;
  predicted_ou_side: string | null;
  ou_confidence: number | null;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  prediction_source: string | null;
  is_override: boolean | null;
  locked_at: string | null;
  computed_at: string | null;
  sport_specific: Record<string, unknown> | null;
  /** Phase 6B.28 — captured at lock for projected.home/away DTO field. */
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  /** Phase 6B.28 — captured at lock for per-market `predictions.*.grade`,
   *  `signalType`, `marketSignal` DTO fields (V2.1 framework grades). */
  ml_grade: string | null;
  ou_grade: string | null;
  nrfi_grade: string | null;
  ml_signal_type: string | null;
  ou_signal_type: string | null;
  nrfi_signal_type: string | null;
  ml_market_signal: string | null;
  ou_market_signal: string | null;
  nrfi_market_signal: string | null;
};

function readBoolish(v: unknown): boolean {
  return v === true;
}
function readStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function readNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function isExplicitNoBetReason(v: string | null): boolean {
  if (v === null) return false;
  const s = v.toLowerCase();
  return s.includes("not a betting recommendation") || s.includes("do not bet") || /\bno bet\b/.test(s);
}

/**
 * Phase 6B.27 — V2.2 audit grade → public play_grade translator.
 *
 * `prediction_records.play_grade` is the public-facing category column
 * (rendered on /lab/tracking via PLAY_GRADE_LABEL; grouped by
 * calibrationReport). V2.2's `mlPlayGrade.grade` / `ouPlayGrade.grade`
 * emit a wider taxonomy that includes internal diagnostic labels —
 * "no_bet" (edge < -1%, "pick shown but do not bet"), "held" (market
 * data unsafe), and "toss_up" — which are NOT public categories.
 *
 * Pre-6B.27 those internal labels leaked verbatim into the public
 * column. Today's CLE@TEX ML (rec=120) and LAA@LAD ML (rec=129) were
 * stored as play_grade="no_bet" even though the customer-facing slate
 * pill still showed an actionable pick (V2.1 framework grade
 * `market_watch` → "Market Watch" pill, pick + confidence non-null).
 *
 * Public taxonomy (matches PLAY_GRADE_LABEL):
 *   best_angle | lean | market_aligned | provisional | null
 *
 * Internal-only labels collapse to null. The full V2.2 diagnostic
 * (incl. ml_no_bet_reason / ml_play_grade / ml_market_aligned / etc.)
 * is preserved as-is in snapshot_json.v2_2_audit for calibration and
 * post-hoc audit. Counting/grading are unaffected — W/L gates on
 * no_bet boolean, never on play_grade.
 */
const PUBLIC_PLAY_GRADES = new Set(["best_angle", "lean", "market_aligned", "provisional"]);
function readPublicPlayGrade(v: unknown): string | null {
  const raw = readStringOrNull(v);
  if (raw === null) return null;
  return PUBLIC_PLAY_GRADES.has(raw) ? raw : null;
}

/**
 * Conviction/Value play-grade gate (2026-06-15) — demotes a public **Lean** to
 * `market_aligned` (off the public board, operator-only) when it fails an
 * EVIDENCE-GATED, ENVIRONMENT-INDEPENDENT quality test. Four conditions, all
 * validated on locked tracking (since 6/7) with leave-one-day-out + a clear
 * model reason (NOT a high-scoring-week artifact):
 *
 *   1. WEAK MODEL PROBABILITY. Cross-market MLB backtest through 2026-06-24:
 *      demoting Leans with model_probability <55% removed the weakest
 *      actionable cohort and improved board ROI materially without changing
 *      raw projections.
 *   2. NEGATIVE EXPECTED VALUE (coherence). A Lean whose own model probability,
 *      priced at the locked American odds, has EV < 0 loses long-run by the
 *      model's OWN numbers. Favorite Leans with EV<0 went 1-5 (17%, −68% ROI).
 *      Arithmetic, not pattern-fit → environment-independent.
 *   3. LOW-CONVICTION MONEYLINE. A money-line Lean where the model barely
 *      separates the teams (|projected run gap| < 0.5) remains a real tracked
 *      pick, but should not be user-promoted as a Lean. Fresh audit through
 *      2026-06-24: 9-16, -25% ROI.
 *   4. FULL-GAME TOTAL LEANS. Totals are tracked and may still become Best
 *      Angle through the stricter Best Angle path. The lower Lean tier is
 *      allowed only when probability, edge, price, and projection alignment
 *      match the validated historical profile.
 *
 * Only touches the "lean" tier; Best Angle / others unchanged. Future-picks +
 * display only — never mutates locked/historical/tracking rows. Reversible
 * (constants).
 *
 * Public-trap (bets≫money) is intentionally EXCLUDED: it only predicts losses
 * on O/U (trap O/U = nearly all Unders = the one high-scoring week; trap×ML is
 * fine), i.e. environment-confounded. It is shadow-logged in the research
 * report, not gated, until a low-scoring week validates it out-of-sample.
 */
export const GATE_EV_FLOOR = 0;
export const GATE_LEAN_MIN_MODEL_PROB = 0.55;
export const GATE_LOW_CONVICTION_RUNGAP = 0.5;
export const GATE_TOTAL_UNDER_BEST_ANGLE_MIN_MODEL_PROB = 0.70;
export const GATE_TOTAL_OVER_BEST_ANGLE_MIN_MODEL_PROB = 0.70;
export const GATE_TOTAL_LEAN_MARKET_FRICTION_MAX_EDGE_PCT = 5.0;
export const TOTAL_PROJECTION_OPPOSED_LEAN_CAP_RULE_ID = "total_lean_projection_opposed_cap_v1_2026_07_11";
export const TOTAL_VALIDATED_LEAN_RULE_ID = "total_validated_lean_v1_2026_07_11";
export const TOTAL_VALIDATED_LEAN_MIN_MODEL_PROB = 0.54;
export const TOTAL_VALIDATED_LEAN_MIN_EDGE_PCT = 5.0;
export const TOTAL_VALIDATED_LEAN_MIN_PRICE_EXCLUSIVE = -145;
export const TOTAL_VALIDATED_STRONG_LEAN_MIN_MODEL_PROB = 0.57;
export const TOTAL_VALIDATED_STRONG_LEAN_MIN_PROJECTION_GAP = 0.75;
export const TOTAL_CLEAN_CONFIRMED_BEST_ANGLE_RULE_ID = "total_clean_strong_best_angle_v4_2026_07_11";
export const TOTAL_BEST_ANGLE_MIN_MODEL_PROB = 0.57;
export const TOTAL_BEST_ANGLE_MIN_EDGE_PCT = 5.0;
export const TOTAL_BEST_ANGLE_STRONG_ABS_PROJECTION_GAP = 0.75;
export const TOTAL_BEST_ANGLE_MIN_PRICE_EXCLUSIVE = -135;
export const ML_CLEAN_TIGHT_EDGE_BEST_ANGLE_RULE_ID = "ml_clean_tight_edge_best_angle_v1_2026_07_11";
export const ML_CLEAN_TIGHT_EDGE_MIN_MODEL_PROB = 0.55;
export const ML_CLEAN_TIGHT_EDGE_MAX_MODEL_PROB_EXCLUSIVE = 0.58;
export const ML_CLEAN_TIGHT_EDGE_MIN_EDGE_PCT = 0.5;
export const ML_CLEAN_TIGHT_EDGE_MIN_PRICE_EXCLUSIVE = -220;
export const ML_CLEAN_TIGHT_EDGE_MAX_ABS_PROJECTION_GAP_EXCLUSIVE = 0.75;
export const FI_VALIDATED_BEST_ANGLE_RULE_ID = "fi_validated_best_angle_v1_2026_07_11";
export const FI_FINAL_BEST_ANGLE_MIN_EDGE = 0.06;
export const FI_FINAL_BEST_ANGLE_MIN_CONFIDENCE = 56;
export const FI_FINAL_BEST_ANGLE_MIN_PRICE_EXCLUSIVE = -130;
export interface PlayGradeGateInputs {
  modelProb: number | null;
  americanOdds: number | null;
  market: "moneyline" | "total" | "first_inning";
  /** |posterior_home_diff| — model run-gap conviction (ML favorites only). */
  runGapAbs: number | null;
  /** total line at lock (totals only) — model has no edge on line<8 duels. */
  totalLine: number | null;
}
function gateEvNegative(p: number | null, odds: number | null): boolean {
  if (p === null || odds === null) return false;
  const dec = odds > 0 ? odds / 100 : 100 / -odds;
  return p * dec - (1 - p) < GATE_EV_FLOOR;
}
export function applyPlayGradeGate(grade: string | null, x: PlayGradeGateInputs): string | null {
  if (grade !== "lean") return grade; // gate only demotes the Lean tier
  // 1. weak Lean demotion (any market) — model is not strong enough to promote
  //    as user-actionable, even when the raw pick still displays internally.
  if (x.modelProb !== null && x.modelProb < GATE_LEAN_MIN_MODEL_PROB) return "market_aligned";
  // 2. negative-EV coherence demotion (any market) — arithmetic, env-independent
  if (gateEvNegative(x.modelProb, x.americanOdds)) return "market_aligned";
  // 3. low-conviction moneyline — run-gap conviction, env-independent
  if (
    x.market === "moneyline" &&
    x.runGapAbs !== null && x.runGapAbs < GATE_LOW_CONVICTION_RUNGAP
  ) {
    return "market_aligned";
  }
  return grade;
}

function applyMlbBestAngleFinalGate(
  grade: string | null,
  baseBestAngleEligible: boolean,
  finalBestAngle: boolean,
): string | null {
  if (!baseBestAngleEligible || finalBestAngle) return grade;
  return grade === "best_angle" ? "lean" : grade;
}

function totalProjectionGapAbs(
  pick: string | null,
  projectedTotal: number | null,
  line: number | null,
): number | null {
  if (projectedTotal === null || line === null) return null;
  if (pick !== "over" && pick !== "under") return null;
  const sameSideGap = pick === "over" ? projectedTotal - line : line - projectedTotal;
  return Math.abs(sameSideGap);
}

function totalProjectionSameSideGap(
  pick: string | null,
  projectedTotal: number | null,
  line: number | null,
): number | null {
  if (projectedTotal === null || line === null) return null;
  if (pick === "over") return projectedTotal - line;
  if (pick === "under") return line - projectedTotal;
  return null;
}

function moneylineProjectionSameSideGap(
  pred: PredictionRow,
  v22: Record<string, unknown>,
  pick: string | null,
): number | null {
  const homeDiff =
    readNumberOrNull(v22.posterior_home_diff) ??
    readNumberOrNull(v22.independent_home_diff);
  const diff = homeDiff ?? (() => {
    const projected = projectedScoresForConflict(pred, v22);
    return projected.home !== null && projected.away !== null ? projected.home - projected.away : null;
  })();
  if (diff === null) return null;
  if (pick === "home") return diff;
  if (pick === "away") return -diff;
  return null;
}

function resolveMlCleanTightEdgeBestAngle(args: {
  blocked: boolean;
  side: string | null;
  modelProb: number | null;
  edgePct: number | null;
  oddsAmerican: number | null;
  sameSideProjectionGap: number | null;
  lineDirection: "toward_pick" | "against_pick" | "neutral" | "unknown" | null;
  publicSplitConflict: boolean;
}): {
  bestAngle: boolean;
  reason: string | null;
  absProjectionGap: number | null;
} {
  const absProjectionGap =
    args.sameSideProjectionGap === null ? null : Math.abs(args.sameSideProjectionGap);
  const cleanMarket = !args.publicSplitConflict && args.lineDirection !== "against_pick";
  const playablePrice =
    args.oddsAmerican !== null &&
    args.oddsAmerican > ML_CLEAN_TIGHT_EDGE_MIN_PRICE_EXCLUSIVE;
  const qualified =
    !args.blocked &&
    (args.side === "home" || args.side === "away") &&
    args.modelProb !== null &&
    args.modelProb >= ML_CLEAN_TIGHT_EDGE_MIN_MODEL_PROB &&
    args.modelProb < ML_CLEAN_TIGHT_EDGE_MAX_MODEL_PROB_EXCLUSIVE &&
    args.edgePct !== null &&
    args.edgePct >= ML_CLEAN_TIGHT_EDGE_MIN_EDGE_PCT &&
    playablePrice &&
    cleanMarket &&
    absProjectionGap !== null &&
    absProjectionGap < ML_CLEAN_TIGHT_EDGE_MAX_ABS_PROJECTION_GAP_EXCLUSIVE;
  return {
    bestAngle: qualified,
    reason: qualified ? ML_CLEAN_TIGHT_EDGE_BEST_ANGLE_RULE_ID : null,
    absProjectionGap,
  };
}

/**
 * Phase 6B.11 — minimal sharp_signals row shape used for the
 * best_angle public-money guard. Mirrors the fields the daily-edge
 * route reads in its own copy of this guard (Phase 6B.10).
 */
type PublicSplitsRow = {
  market_type: string;
  side: string;
  public_money_pct: number | null;
  public_betting_pct: number | null;
  /* Phase 6B.22 — additional sharp_signals fields snapshotted at lock time. */
  has_steam_move: boolean | null;
  has_reverse_line_movement: boolean | null;
  rlm_direction: string | null;
  signal_strength: string | null;
  computed_at: string | null;
  /* Phase 6B.28 — additional fields the Daily Edge route consumes for
   * the rich-and-frozen post-lock render. Captured at lock so route's
   * SignalRow shape can be rehydrated 1:1 from snapshot. */
  pinnacle_fair_probability: number | null;
  is_plus_ev: boolean | null;
  ev_pct: number | null;
  steam_detected_at: string | null;
  steam_books_count: number | null;
};

type SourceAwareSplitObservationRow = {
  canonical_event_id: string;
  market_type: string;
  selection_key: string | null;
  provider: string | null;
  source_book: string | null;
  source_type: string | null;
  bets_pct: number | null;
  money_pct: number | null;
  source_observed_at: string | null;
  fetched_at: string | null;
};

function sourceAwareSide(row: SourceAwareSplitObservationRow): string | null {
  const side = row.selection_key?.split(":").pop();
  return side === "home" || side === "away" || side === "over" || side === "under" ? side : null;
}

function sourceAwarePct(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

function sourceAwarePairScore(a: SourceAwareSplitObservationRow, b: SourceAwareSplitObservationRow): number {
  const moneyA = sourceAwarePct(a.money_pct);
  const moneyB = sourceAwarePct(b.money_pct);
  const betsA = sourceAwarePct(a.bets_pct);
  const betsB = sourceAwarePct(b.bets_pct);
  let score = 0;
  let fields = 0;
  if (moneyA !== null && moneyB !== null) {
    score += Math.abs(moneyA + moneyB - 100);
    fields += 1;
  }
  if (betsA !== null && betsB !== null) {
    score += Math.abs(betsA + betsB - 100);
    fields += 1;
  }
  return fields === 0 ? Number.POSITIVE_INFINITY : score;
}

function compactSourceAwareRowsForLock(
  rows: ReadonlyArray<SourceAwareSplitObservationRow>,
): SourceAwareSplitObservationRow[] {
  const out: SourceAwareSplitObservationRow[] = [];
  for (const market of ["moneyline", "total"] as const) {
    const sideOrder = market === "moneyline" ? ["away", "home"] : ["over", "under"];
    for (const source of ["consensus", "sharp"] as const) {
      const candidates = rows
        .filter((row) => row.market_type === market)
        .filter((row) => {
          const provider = (row.provider ?? "").toLowerCase();
          const sourceType = (row.source_type ?? "").toLowerCase();
          return source === "consensus"
            ? provider === "playbook" || sourceType === "multi_book_consensus"
            : provider === "sharpapi" && sourceType === "sharp_adjacent_book";
        })
        .map((row, index) => ({ row, index, side: sourceAwareSide(row) }))
        .filter((candidate) => candidate.side !== null);
      const [leftSide, rightSide] = sideOrder;
      const leftRows = candidates.filter((candidate) => candidate.side === leftSide);
      const rightRows = candidates.filter((candidate) => candidate.side === rightSide);
      if (leftRows.length === 0 || rightRows.length === 0) continue;
      let bestPair: { left: (typeof candidates)[number]; right: (typeof candidates)[number]; score: number; indexGap: number } | null = null;
      for (const left of leftRows) {
        for (const right of rightRows) {
          const score = sourceAwarePairScore(left.row, right.row);
          const indexGap = Math.abs(left.index - right.index);
          if (
            bestPair === null ||
            score < bestPair.score ||
            (score === bestPair.score && indexGap < bestPair.indexGap)
          ) {
            bestPair = { left, right, score, indexGap };
          }
        }
      }
      if (bestPair !== null && bestPair.score <= 2) {
        out.push(bestPair.left.row, bestPair.right.row);
      }
    }
  }
  return out;
}

/**
 * Phase 6B.22 — opener row from `line_history` (is_opener=true). One per
 * (game, market, side, book). Combined with the lock-time price in `lines`,
 * lets us derive line-movement direction relative to the picked side.
 */
type LineHistoryOpenerRow = {
  game_id: number;
  market_type: string;
  side: string | null;
  sportsbook: string;
  odds_american: number | null;
  line_value: number | null;
  recorded_at: string | null;
};

/**
 * Phase 6B.18 — picked-side pregame odds captured at lock time so the
 * locked snapshot carries enough data for Daily Edge to render the
 * frozen pregame price after lock without falling back to the live
 * `lines` table (which keeps moving mid-game).
 *
 * Forward Fix A (2026-06-09 lock-contract fix) — adds per-side source
 * metadata so the writer can persist how each price was chosen:
 *   • "lines"                 → current real-book row in `lines`
 *   • "line_history_fallback" → most-recent pre-write real-book row
 *                                in `line_history`
 *   • "unavailable"           → no usable real-book row anywhere
 *
 * `splits_consensus` is excluded — it does not carry odds_american,
 * only a no-vig line value, so it can never serve as a "real-book"
 * price source even when present.
 */
export type OddsSource = "lines" | "line_history_fallback" | "unavailable";
export type OddsSourceDetail = {
  source: OddsSource;
  /** Sportsbook name when source is "lines" or "line_history_fallback"; null when "unavailable". */
  book: string | null;
  /** Selected odds_american when known; null when "unavailable". */
  odds: number | null;
  /** Selected line_value (totals only); null otherwise. */
  line: number | null;
  /** ISO timestamp of the source row; null when "unavailable". */
  observedAt: string | null;
};
type GameOddsSnapshot = {
  mlHomeOdds: number | null;
  mlAwayOdds: number | null;
  ouOverOdds: number | null;
  ouUnderOdds: number | null;
  /** Forward Fix A — per-(market, side) source metadata for snapshot_json. */
  oddsSourceMl: { home: OddsSourceDetail; away: OddsSourceDetail };
  oddsSourceOu: { over: OddsSourceDetail; under: OddsSourceDetail };
};

type LineRowForOdds = {
  game_id: number;
  market_type: string;
  side: string | null;
  sportsbook: string;
  odds_american: number | null;
  /** Phase 6B.22 — null for ML; populated for totals (e.g. 8.5). */
  line_value?: number | null;
  /** Phase 6B.28 — captured at lock so route's LineRow shape rehydrates 1:1. */
  fetched_at?: string | null;
};

/**
 * Forward Fix A (2026-06-09) — `line_history` row shape consumed by
 * the lock-time fallback selector. Same minimal columns as
 * `LineRowForOdds` plus `recorded_at` so the most-recent valid row
 * can be chosen when the current `lines` table is thin.
 */
type LineHistoryRowForOdds = {
  game_id: number;
  market_type: string;
  side: string | null;
  sportsbook: string;
  odds_american: number | null;
  line_value: number | null;
  recorded_at: string;
};

const LOCK_PRICE_MAX_SOURCE_AGE_MS = 90 * 60 * 1000;

function isFreshLockPriceSource(observedAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (observedAt === null || observedAt === undefined) return true;
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return false;
  return nowMs - observedMs <= LOCK_PRICE_MAX_SOURCE_AGE_MS;
}

function currentEasternDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function freshnessReferenceMsForGame(game: GameRow, slateDate: string): number {
  if (slateDate >= currentEasternDate()) return Date.now();
  const gameMs = game.game_date === null ? NaN : Date.parse(game.game_date);
  if (Number.isFinite(gameMs)) return gameMs - 60 * 60 * 1000;
  const slateEndMs = Date.parse(`${slateDate}T23:59:00.000Z`);
  return Number.isFinite(slateEndMs) ? slateEndMs : Date.now();
}

/**
 * For one (game, market, side), return the picked-side odds_american
 * from the highest-priority book that has a non-null value. Excludes
 * `splits_consensus` since it carries only a no-vig line, never odds.
 * Returns null when nothing matches.
 */
function pickPriorityOdds(
  rows: ReadonlyArray<LineRowForOdds>,
  marketType: "moneyline" | "total",
  side: string,
): number | null {
  const candidates = rows.filter(
    (r) =>
      r.market_type === marketType &&
      r.side === side &&
      r.odds_american !== null,
  );
  for (const book of BOOK_PRIORITY) {
    const hit = candidates.find((r) => r.sportsbook === book);
    if (hit) return hit.odds_american;
  }
  return null;
}

/**
 * Forward Fix A (2026-06-09) — lock-time fallback selector.
 *
 * Priority:
 *   1. Current `lines` real-book row (sportsbook != splits_consensus,
 *      odds_american != null). Selected by BOOK_PRIORITY.
 *   2. Freshest `line_history` real-book row with the same constraints.
 *      Selected by recorded_at DESC, then BOOK_PRIORITY within the
 *      most-recent timestamp's batch (same minute, same source).
 *   3. "unavailable" — no real-book row exists in either source.
 *
 * The writer captures the source's actual book / odds / line /
 * recorded_at so snapshot_json carries the audit trail. Never selects
 * `splits_consensus`. Never selects a `line_history` row newer than
 * `now()` (the caller's current write moment), which keeps the lock
 * snapshot honest — post-lock prices cannot leak in via fallback
 * because this function runs BEFORE `locked_at` is stamped.
 *
 * `historyByGame` is keyed by `${gameId}::${market_type}::${side}` so
 * the caller can prune by relevance before passing in.
 */
function pickOddsWithFallback(
  lines: ReadonlyArray<LineRowForOdds>,
  historyByKey: ReadonlyMap<string, ReadonlyArray<LineHistoryRowForOdds>>,
  gameId: number,
  marketType: "moneyline" | "total" | "first_inning_total",
  side: string,
  nowMs = Date.now(),
): OddsSourceDetail {
  // Tier 1 — current `lines` real-book. Blocked books (fliff, kalshi) are
  // never a valid price source (#39): drop them here so they cannot be the
  // selected lock price even if a writer persisted them to `lines`.
  const liveCandidates = lines.filter(
    (r) =>
      r.market_type === marketType &&
      r.side === side &&
      r.odds_american !== null &&
      r.sportsbook !== "splits_consensus" &&
      !isBlockedSportsbook(r.sportsbook) &&
      isFreshLockPriceSource(r.fetched_at, nowMs),
  );
  for (const book of BOOK_PRIORITY) {
    if (book === "splits_consensus") continue;
    const hit = liveCandidates.find((r) => r.sportsbook === book);
    if (hit) {
      return {
        source: "lines",
        book: hit.sportsbook,
        odds: hit.odds_american,
        line: hit.line_value ?? null,
        observedAt: hit.fetched_at ?? null,
      };
    }
  }
  // Tier 2 — `line_history` fallback. The history map is pre-filtered to
  // real-book non-null rows by the caller; we just pick the most-recent
  // batch and apply BOOK_PRIORITY within it.
  const historyKey = `${gameId}::${marketType}::${side}`;
  // Drop blocked books (fliff, kalshi) up front so neither the BOOK_PRIORITY
  // pass nor the "first real book" fallback below can surface one (#39).
  const history = (historyByKey.get(historyKey) ?? []).filter(
    (r) => !isBlockedSportsbook(r.sportsbook) && isFreshLockPriceSource(r.recorded_at, nowMs),
  );
  if (history.length > 0) {
    // History is pre-sorted by recorded_at DESC. Pick the most-recent
    // minute, then resolve ties by BOOK_PRIORITY.
    const newestMinute = history[0].recorded_at.slice(0, 16);
    const sameMinute = history.filter((r) => r.recorded_at.slice(0, 16) === newestMinute);
    for (const book of BOOK_PRIORITY) {
      if (book === "splits_consensus") continue;
      const hit = sameMinute.find((r) => r.sportsbook === book);
      if (hit) {
        return {
          source: "line_history_fallback",
          book: hit.sportsbook,
          odds: hit.odds_american,
          line: hit.line_value,
          observedAt: hit.recorded_at,
        };
      }
    }
    // No BOOK_PRIORITY match in the most-recent minute — accept whatever
    // real book is first in the most-recent batch.
    const fallback = sameMinute[0];
    return {
      source: "line_history_fallback",
      book: fallback.sportsbook,
      odds: fallback.odds_american,
      line: fallback.line_value,
      observedAt: fallback.recorded_at,
    };
  }
  // Tier 3 — no real-book row anywhere.
  return { source: "unavailable", book: null, odds: null, line: null, observedAt: null };
}

function pickFreshOnlyOdds(
  lines: ReadonlyArray<LineRowForOdds>,
  gameId: number,
  marketType: "first_inning_total",
  side: string,
  nowMs = Date.now(),
): OddsSourceDetail {
  const picked = pickOddsWithFallback(lines, new Map(), gameId, marketType, side, nowMs);
  return picked.source === "lines" ? picked : { source: "unavailable", book: null, odds: null, line: null, observedAt: null };
}

function fiAuditFreshDataReady(sp: Record<string, unknown>): { ready: boolean; blockers: string[] } {
  const audit = sp.fi_v2_audit && typeof sp.fi_v2_audit === "object"
    ? sp.fi_v2_audit as Record<string, unknown>
    : null;
  if (audit === null) return { ready: true, blockers: [] };
  const blockers = Array.isArray(audit.fresh_data_blockers)
    ? audit.fresh_data_blockers.filter((v): v is string => typeof v === "string")
    : [];
  if (audit.fresh_data_ready === false) return { ready: false, blockers };
  return { ready: true, blockers };
}

/**
 * Build the per-game odds snapshot from the lines table. Reads the
 * first BOOK_PRIORITY-matching odds per (game, market, side).
 *
 * Forward Fix A (2026-06-09) — accepts an optional `historyByKey` map.
 * When supplied, each (market, side) slot uses `pickOddsWithFallback`
 * so a missing live real-book price is recovered from the freshest
 * pre-write `line_history` row. The per-side `OddsSourceDetail` is
 * always populated so callers can persist `odds_source_at_lock` in
 * snapshot_json. Callers that don't supply a history map (e.g., unit
 * tests) get a snapshot where every fallback resolves to "unavailable"
 * if `lines` is empty — same shape, just no recovery.
 */
export function buildGameOddsSnapshot(
  lines: ReadonlyArray<LineRowForOdds>,
  opts?: {
    historyByKey?: ReadonlyMap<string, ReadonlyArray<LineHistoryRowForOdds>>;
    gameId?: number;
    freshnessReferenceMs?: number;
  },
): GameOddsSnapshot {
  const history = opts?.historyByKey ?? new Map<string, ReadonlyArray<LineHistoryRowForOdds>>();
  const gameId = opts?.gameId ?? -1;
  const freshnessReferenceMs = opts?.freshnessReferenceMs ?? Date.now();
  const freshLines = lines.filter((l) => isFreshLockPriceSource(l.fetched_at, freshnessReferenceMs));
  const mlHome = pickOddsWithFallback(freshLines, history, gameId, "moneyline", "home", freshnessReferenceMs);
  const mlAway = pickOddsWithFallback(freshLines, history, gameId, "moneyline", "away", freshnessReferenceMs);
  // Constrain totals to the CONSENSUS main line so over + under come from the SAME
  // line (not a divergent/alt-line single book — e.g. a lone Pinnacle 9.5/10). The
  // bet line + per-side prices in the locked snapshot then stay coherent.
  const mainTotal = selectMainTotalLine(freshLines.filter((l) => l.market_type === "total"));
  const ouLines = mainTotal === null ? freshLines : freshLines.filter(
    (l) => l.market_type !== "total" || l.line_value === mainTotal || l.line_value === null,
  );
  const ouOver = pickOddsWithFallback(ouLines, history, gameId, "total", "over", freshnessReferenceMs);
  const ouUnder = pickOddsWithFallback(ouLines, history, gameId, "total", "under", freshnessReferenceMs);
  return {
    mlHomeOdds: mlHome.odds,
    mlAwayOdds: mlAway.odds,
    ouOverOdds: ouOver.odds,
    ouUnderOdds: ouUnder.odds,
    oddsSourceMl: { home: mlHome, away: mlAway },
    oddsSourceOu: { over: ouOver, under: ouUnder },
  };
}

/* ─── Phase 6B.22 — context snapshots for calibration ────────────────────
 *
 * Three helpers that produce the additive `public_splits`, `line_movement`,
 * and `data_integrity` namespaces injected into snapshot_json at lock
 * time. Every helper is pure (no DB, no I/O) and defensive: when source
 * data is missing, returns explicit `null` / `"unknown"` rather than
 * inventing values.
 *
 * Why namespaced sub-objects: keeps existing snapshot_json keys
 * untouched (Daily Edge, Stage 1 / Stage 2 reports continue to read
 * what they always read), while letting the calibration contextFlags
 * extractor read the new paths without coupling to model internals.
 */

/** Pure — American odds → implied probability of winning. null when input is null/0. */
export function americanToImpliedProb(american: number | null | undefined): number | null {
  if (american === null || american === undefined) return null;
  if (american === 0) return null;
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

const OPPOSITE_SIDE: Record<string, string> = {
  home: "away",
  away: "home",
  over: "under",
  under: "over",
};

/**
 * Phase 6B.22 — picked-side / opposite-side public money + bets snapshot.
 * Mirrors the existing best_angle public-money guard but exposes the full
 * pair so calibration can analyze "public-money conflict" vs "support" as
 * separate cuts.
 *
 * conflict and support are tri-state (true | false | null). null when the
 * source data needed to determine them is missing on either side.
 */
export function buildPublicSplitsSnapshot(
  signals: ReadonlyArray<PublicSplitsRow>,
  market: "moneyline" | "total",
  pickedSide: string | null,
): Record<string, unknown> | null {
  if (pickedSide === null) return null;
  const opp = OPPOSITE_SIDE[pickedSide] ?? null;
  if (opp === null) return null;
  const picked = signals.find((s) => s.market_type === market && s.side === pickedSide);
  const opposite = signals.find((s) => s.market_type === market && s.side === opp);
  if (picked === undefined && opposite === undefined) return null;
  // Conflict / support — derive only when BOTH halves of the comparison have
  // values. Return null otherwise so the calibration extractor reports
  // "unknown" rather than a default-false that would skew analysis.
  const oppMoney = opposite?.public_money_pct ?? null;
  const oppBets = opposite?.public_betting_pct ?? null;
  const conflict =
    oppMoney !== null && oppBets !== null
      ? oppMoney >= 60 && oppMoney - oppBets >= 15
      : null;
  const pickedMoney = picked?.public_money_pct ?? null;
  const pickedBets = picked?.public_betting_pct ?? null;
  const support =
    pickedMoney !== null && pickedBets !== null
      ? pickedMoney >= 60 && pickedMoney - pickedBets >= 15
      : null;
  return {
    market,
    picked_side: pickedSide,
    picked_money_pct: pickedMoney,
    picked_bets_pct: pickedBets,
    opp_side: opp,
    opp_money_pct: oppMoney,
    opp_bets_pct: oppBets,
    conflict,
    support,
    source: "sharp_signals",
    fetched_at: picked?.computed_at ?? opposite?.computed_at ?? null,
  };
}

/**
 * Phase 6B.22 — opener vs current price for the picked side, plus steam /
 * RLM flags from sharp_signals. Direction is computed in implied-probability
 * space so it generalises across ML / OU price moves.
 *
 *   direction = "toward_pick"  → picked-side implied prob went UP (line
 *                                moved in our favor)
 *   direction = "against_pick" → picked-side implied prob went DOWN
 *   direction = "neutral"      → change is within ±0.5pp
 *   direction = "unknown"      → opener or current price missing
 *
 * For totals, also surfaces total line drift (e.g., 8.5 → 9.0).
 */
function pickPriorityOpener(
  openers: ReadonlyArray<LineHistoryOpenerRow>,
  market: "moneyline" | "total",
  side: string,
): LineHistoryOpenerRow | null {
  const candidates = openers.filter(
    (r) =>
      r.market_type === market &&
      r.side === side &&
      r.odds_american !== null &&
      !isBlockedSportsbook(r.sportsbook), // #39 — never open off a blocked book
  );
  for (const book of BOOK_PRIORITY) {
    const hit = candidates.find((r) => r.sportsbook === book);
    if (hit) return hit;
  }
  return null;
}

export function buildLineMovementSnapshot(
  openers: ReadonlyArray<LineHistoryOpenerRow>,
  currentLines: ReadonlyArray<LineRowForOdds>,
  signals: ReadonlyArray<PublicSplitsRow>,
  market: "moneyline" | "total",
  pickedSide: string | null,
): Record<string, unknown> | null {
  if (pickedSide === null) return null;
  const opener = pickPriorityOpener(openers, market, pickedSide);
  const currentOdds = pickPriorityOdds(currentLines, market, pickedSide);
  const openImplied = americanToImpliedProb(opener?.odds_american ?? null);
  const currentImplied = americanToImpliedProb(currentOdds);

  let direction: "toward_pick" | "against_pick" | "neutral" | "unknown" = "unknown";
  let magnitudePp: number | null = null;
  if (openImplied !== null && currentImplied !== null) {
    const deltaPp = (currentImplied - openImplied) * 100;
    magnitudePp = Math.abs(deltaPp);
    if (magnitudePp < 0.5) direction = "neutral";
    else if (deltaPp > 0) direction = "toward_pick";
    else direction = "against_pick";
  }

  // Total-line drift (line_value), for totals only.
  let totalOpen: number | null = null;
  let totalCurrent: number | null = null;
  if (market === "total" && opener !== null) {
    totalOpen = opener.line_value ?? null;
    const cur = currentLines.find(
      (r) => r.market_type === "total" && r.side === pickedSide,
    );
    totalCurrent = (cur as { line_value?: number | null } | undefined)?.line_value ?? null;
  }

  // Steam / RLM signals from sharp_signals (per-side, picked side).
  const pickedSignal = signals.find((s) => s.market_type === market && s.side === pickedSide);
  const steam = pickedSignal?.has_steam_move ?? null;
  const rlm = pickedSignal?.has_reverse_line_movement ?? null;
  const rlmDirection = pickedSignal?.rlm_direction ?? null;

  return {
    market,
    picked_side: pickedSide,
    open_odds_american: opener?.odds_american ?? null,
    current_odds_american: currentOdds,
    open_implied_prob: openImplied,
    current_implied_prob: currentImplied,
    direction,
    magnitude_pp: magnitudePp,
    total_open: totalOpen,
    total_current: totalCurrent,
    has_steam_move: steam,
    has_reverse_line_movement: rlm,
    rlm_direction: rlmDirection,
    source: "line_history+lines+sharp_signals",
    opener_recorded_at: opener?.recorded_at ?? null,
  };
}

/**
 * Phase 6B.22 — data-integrity context flags pulled from the locked sport_specific
 * (auto_factors + v2_2_audit + fi_v2_audit + top-level snapshot keys) plus odds
 * availability. Every field is tri-state ("yes" | "no" | "unknown") so the
 * calibration extractor can faithfully report what was known at lock time.
 */
export function buildDataIntegritySnapshot(
  sp: Record<string, unknown>,
  oddsForGame: GameOddsSnapshot | null,
  market: "moneyline" | "total" | "first_inning",
): Record<string, unknown> {
  const af = (sp.auto_factors ?? null) as Record<string, unknown> | null;
  const v22 = (sp.v2_2_audit ?? null) as Record<string, unknown> | null;
  const fiAudit = (sp.fi_v2_audit ?? null) as Record<string, unknown> | null;

  function triBool(v: unknown): "yes" | "no" | "unknown" {
    if (v === true) return "yes";
    if (v === false) return "no";
    return "unknown";
  }
  function triString(v: unknown): string | null {
    return typeof v === "string" ? v : null;
  }

  // Bullpen fallback — no explicit boolean in sport_specific today.
  // The factor values exist (auto_factors.{home,away}_bullpen_factor) but
  // there's no signal whether they came from real data or league fallback.
  // Mark "unknown" so calibration treats it honestly. Future push can wire
  // bullpenService to set this explicitly.
  const bullpenFallback: "yes" | "no" | "unknown" = "unknown";

  // Weather adjust — auto_factors.weather_total_adjust carries the value.
  // 0 could mean "no data" or "no adjust needed"; without an explicit
  // fallback flag we report "unknown".
  const weatherFallback: "yes" | "no" | "unknown" = "unknown";

  // Odds source quality — pulled from the audit object that owns the market.
  const oddsSourceQuality =
    triString(v22?.market_source_quality) ?? triString(fiAudit?.market_data_quality);

  // Two-sided price availability for ML / OU. For FI we don't load both
  // sides into GameOddsSnapshot, so report "unknown".
  let marketTwoSidedAvailable: "yes" | "no" | "unknown" = "unknown";
  if (market === "moneyline" && oddsForGame !== null) {
    marketTwoSidedAvailable =
      oddsForGame.mlHomeOdds !== null && oddsForGame.mlAwayOdds !== null ? "yes" : "no";
  } else if (market === "total" && oddsForGame !== null) {
    marketTwoSidedAvailable =
      oddsForGame.ouOverOdds !== null && oddsForGame.ouUnderOdds !== null ? "yes" : "no";
  }

  return {
    market,
    bullpen_fallback: bullpenFallback,
    weather_fallback: weatherFallback,
    starter_confirmed: triBool(sp.starter_confirmed),
    lineup_confirmed: triBool(sp.lineup_confirmed),
    market_line_available: triBool(sp.market_line_available),
    stale: triBool(sp.stale),
    odds_source_quality: oddsSourceQuality,
    market_two_sided_available: marketTwoSidedAvailable,
    market_baseline_valid: triBool(v22?.market_baseline_valid),
    nrfi_used_fallback_era: triBool(af?.nrfi_used_fallback_era),
    posterior_capped:
      market === "first_inning"
        ? triBool(fiAudit?.posterior_capped)
        : triBool((v22?.capped_by_total === true || v22?.capped_by_diff === true) ? true : v22 === null ? undefined : false),
    review_logic_audit_passed: triBool(
      (sp.review_v1 as Record<string, unknown> | null)?.logic_audit_passed,
    ),
  };
}

/**
 * Phase 6B.28 — Daily Edge "rich-and-frozen" lock substrate.
 *
 * Captures the live inputs the Daily Edge route reads at lock instant:
 *   • signal_rows_at_lock — every sharp_signals row for this game
 *     (every market_type × side combination the route consumes)
 *   • lines_at_lock — every `lines` row (ML + OU per book per side)
 *   • predicted_scores_at_lock — V2.2 predicted home/away score
 *   • framework_grades_at_lock — V2.1 per-market grade / signal_type
 *     / market_signal triplets
 *
 * After lock the route swaps these in for the live tables, so a
 * locked game's Daily Edge card renders identically to the pregame
 * card at the moment of lock — same publicSplits, same sharpSignals
 * array, same lineCurrent, same modelMarketGap, same QuickRead text,
 * same MarketNotes — never drifting because live providers nulled
 * out or moved post-start.
 *
 * Backwards-compatible: 6B.18 + 6B.22 fields untouched. Pre-6B.28
 * snapshots have these new fields absent → route falls back to
 * empty/null for those locked rows (today's 28 old locks). Reader
 * hides panels quietly when locked-but-empty.
 */
function buildDailyEdgeLockSubstrate(args: {
  signalsForGame: ReadonlyArray<PublicSplitsRow>;
  currentLinesForGame: ReadonlyArray<LineRowForOdds>;
  sourceAwareSplitsForGame?: ReadonlyArray<SourceAwareSplitObservationRow>;
  pred: PredictionRow;
}): Record<string, unknown> {
  return {
    signal_rows_at_lock: args.signalsForGame.map((s) => ({
      market_type: s.market_type,
      side: s.side,
      public_money_pct: s.public_money_pct,
      public_betting_pct: s.public_betting_pct,
      has_steam_move: s.has_steam_move,
      has_reverse_line_movement: s.has_reverse_line_movement,
      rlm_direction: s.rlm_direction,
      signal_strength: s.signal_strength,
      computed_at: s.computed_at,
      pinnacle_fair_probability: s.pinnacle_fair_probability,
      is_plus_ev: s.is_plus_ev,
      ev_pct: s.ev_pct,
      steam_detected_at: s.steam_detected_at,
      steam_books_count: s.steam_books_count,
    })),
    lines_at_lock: args.currentLinesForGame.map((l) => ({
      game_id: l.game_id,
      market_type: l.market_type,
      side: l.side,
      sportsbook: l.sportsbook,
      odds_american: l.odds_american,
      line_value: l.line_value ?? null,
      fetched_at: l.fetched_at ?? null,
    })),
    source_aware_split_rows_at_lock: (args.sourceAwareSplitsForGame ?? []).map((s) => ({
      canonical_event_id: s.canonical_event_id,
      market_type: s.market_type,
      selection_key: s.selection_key,
      provider: s.provider,
      source_book: s.source_book,
      source_type: s.source_type,
      bets_pct: s.bets_pct,
      money_pct: s.money_pct,
      source_observed_at: s.source_observed_at,
      fetched_at: s.fetched_at,
    })),
    predicted_scores_at_lock: {
      home: args.pred.predicted_home_score,
      away: args.pred.predicted_away_score,
    },
    framework_grades_at_lock: {
      ml_grade: args.pred.ml_grade,
      ml_signal_type: args.pred.ml_signal_type,
      ml_market_signal: args.pred.ml_market_signal,
      ou_grade: args.pred.ou_grade,
      ou_signal_type: args.pred.ou_signal_type,
      ou_market_signal: args.pred.ou_market_signal,
      nrfi_grade: args.pred.nrfi_grade,
      nrfi_signal_type: args.pred.nrfi_signal_type,
      nrfi_market_signal: args.pred.nrfi_market_signal,
    },
  };
}

function canonicalPublicGrade(record: PredictionRecordRow): string | null {
  const raw = typeof record.play_grade === "string" ? record.play_grade.trim().toLowerCase() : "";
  if (raw === "toss_up") return "no_play";
  if (record.no_bet === true) return "no_play";
  if (record.best_angle === true) return "best_angle";
  if (
    raw === "best_angle" ||
    raw === "lean" ||
    raw === "watchlist" ||
    raw === "caution" ||
    raw === "no_play" ||
    raw === "market_aligned" ||
    raw === "provisional" ||
    raw === "held" ||
    raw === "no_bet"
  ) {
    if (raw === "held" || raw === "no_bet") return "no_play";
    return raw;
  }
  if (record.held === true) return "held";
  return null;
}

function withMemberFacingAtLock(record: PredictionRecordRow): PredictionRecordRow {
  const snapshot = record.snapshot_json && typeof record.snapshot_json === "object"
    ? (record.snapshot_json as Record<string, unknown>)
    : {};
  return {
    ...record,
    snapshot_json: {
      ...snapshot,
      member_facing_at_lock: {
        schema_version: "member_facing_lock_v1",
        captured_at: record.locked_at,
        source: "prediction_records_writer",
        model_layer_versions: snapshot.model_layer_versions ?? null,
        sport: record.sport,
        market: record.market,
        matchup: record.matchup,
        pick: record.pick,
        side: record.side,
        line_value: record.line_value,
        odds_american: record.odds_american,
        confidence: record.confidence,
        play_grade: record.play_grade,
        grade: canonicalPublicGrade(record),
        best_angle: record.best_angle,
        no_bet: record.no_bet,
        no_bet_reason: record.no_bet_reason,
        prediction_type: record.prediction_type,
      },
    },
  };
}

function projectedScoresForConflict(
  pred: PredictionRow,
  v22: Record<string, unknown>,
): { home: number | null; away: number | null; total: number | null } {
  const home =
    readNumberOrNull(pred.predicted_home_score) ??
    readNumberOrNull(v22.posterior_home_runs);
  const away =
    readNumberOrNull(pred.predicted_away_score) ??
    readNumberOrNull(v22.posterior_away_runs);
  return {
    home,
    away,
    total: home !== null && away !== null ? home + away : readNumberOrNull(v22.posterior_total),
  };
}

function projectionContradictsMoneylinePick(
  pred: PredictionRow,
  v22: Record<string, unknown>,
  pick: string | null,
): boolean {
  const p = projectedScoresForConflict(pred, v22);
  if (p.home === null || p.away === null) return false;
  if (pick === "home") return p.home <= p.away;
  if (pick === "away") return p.away <= p.home;
  return false;
}

function projectionContradictsTotalPick(
  projectedTotal: number | null,
  line: number | null,
  side: string | null,
): boolean {
  if (projectedTotal === null || line === null) return false;
  if (side === "over") return projectedTotal <= line;
  if (side === "under") return projectedTotal >= line;
  return false;
}

/**
 * Phase 6B.11 — applies the same public-money guard the Daily Edge
 * verdict layer uses (Phase 6B.10), so prediction_records.best_angle
 * matches what members actually see on the slate.
 *
 * Pre-6B.11 prediction_records snapshot best_angle directly from
 * v2_2_audit.{ml,ou}_best_angle_eligible. Daily Edge then suppresses
 * the BA promotion when the OPPOSITE side carries a clear sharp-fade
 * pattern (money >= 60 AND money - bets >= 15). Tracking pending BA
 * counts diverged from the live page — most painfully visible on
 * BAL@TOR ML where Daily Edge correctly showed Watchlist but
 * tracking counted it as a pending Best Angle.
 *
 * Same conservative rule as Phase 6B.10:
 *   • Only suppresses; never invents a Best Angle.
 *   • Only fires when the opposite side has both high money AND
 *     low ticket count (the few-large-bets sharp pattern).
 *   • NEVER touches the underlying pick, picks side, line, or grade
 *     columns on game_predictions. Only the boolean best_angle flag
 *     on prediction_records changes.
 */
function hasOpposingPublicMoneyConflict(
  signals: PublicSplitsRow[],
  market: "moneyline" | "total",
  pickSide: string | null,
): boolean {
  if (pickSide === null) return false;
  let oppositeSide: string | null = null;
  if (market === "moneyline") {
    if (pickSide === "home") oppositeSide = "away";
    else if (pickSide === "away") oppositeSide = "home";
  } else {
    if (pickSide === "over") oppositeSide = "under";
    else if (pickSide === "under") oppositeSide = "over";
  }
  if (oppositeSide === null) return false;
  const opp = signals.find(
    (s) => s.market_type === market && s.side === oppositeSide,
  );
  if (opp === undefined) return false;
  const money = opp.public_money_pct;
  const bets = opp.public_betting_pct;
  if (money === null || bets === null) return false;
  if (money < 60) return false;
  if (money - bets < 15) return false;
  return true;
}

function hasSupportingPublicMoneyConfirmation(
  signals: PublicSplitsRow[],
  market: "moneyline" | "total",
  pickSide: string | null,
): boolean {
  if (pickSide === null) return false;
  const picked = signals.find((s) => s.market_type === market && s.side === pickSide);
  if (picked === undefined) return false;
  const money = picked.public_money_pct;
  const bets = picked.public_betting_pct;
  if (money === null || bets === null) return false;
  if (money < 60) return false;
  if (money - bets < 15) return false;
  return true;
}

/** Read the line-movement direction off a buildLineMovementSnapshot result. */
function readLineDirection(
  snap: Record<string, unknown> | null,
): "toward_pick" | "against_pick" | "neutral" | "unknown" | null {
  if (!snap) return null;
  const d = snap.direction;
  if (d === "toward_pick" || d === "against_pick" || d === "neutral" || d === "unknown") {
    return d;
  }
  return null;
}

function resolveTotalCleanConfirmedBestAngle(args: {
  blocked: boolean;
  side: string | null;
  projectedTotal: number | null;
  line: number | null;
  modelProb: number | null;
  edgePct: number | null;
  oddsAmerican: number | null;
  lineDirection: "toward_pick" | "against_pick" | "neutral" | "unknown" | null;
  publicSplitSupport: boolean;
  publicSplitConflict: boolean;
}): {
  bestAngle: boolean;
  reason: string | null;
  absProjectionGap: number | null;
  mediumGapConfirmed: boolean;
  strongProjection: boolean;
} {
  const absProjectionGap = totalProjectionGapAbs(args.side, args.projectedTotal, args.line);
  const sameSideGap =
    args.side === "over" && args.projectedTotal !== null && args.line !== null
      ? args.projectedTotal - args.line
      : args.side === "under" && args.projectedTotal !== null && args.line !== null
        ? args.line - args.projectedTotal
        : null;
  const strongProjection =
    absProjectionGap !== null &&
    absProjectionGap >= TOTAL_BEST_ANGLE_STRONG_ABS_PROJECTION_GAP;
  const mediumGapConfirmed = false;
  const cleanMarket = !args.publicSplitConflict && args.lineDirection !== "against_pick";
  const playablePrice =
    args.oddsAmerican !== null &&
    args.oddsAmerican > TOTAL_BEST_ANGLE_MIN_PRICE_EXCLUSIVE;
  const qualified =
    !args.blocked &&
    (args.side === "over" || args.side === "under") &&
    args.modelProb !== null &&
    args.modelProb >= TOTAL_BEST_ANGLE_MIN_MODEL_PROB &&
    args.edgePct !== null &&
    args.edgePct >= TOTAL_BEST_ANGLE_MIN_EDGE_PCT &&
    sameSideGap !== null &&
    sameSideGap >= 0 &&
    strongProjection &&
    playablePrice &&
    cleanMarket;
  return {
    bestAngle: qualified,
    reason: qualified ? TOTAL_CLEAN_CONFIRMED_BEST_ANGLE_RULE_ID : null,
    absProjectionGap,
    mediumGapConfirmed,
    strongProjection,
  };
}

function resolveTotalValidatedLean(args: {
  blocked: boolean;
  side: string | null;
  modelProb: number | null;
  edgePct: number | null;
  oddsAmerican: number | null;
  sameSideProjectionGap: number | null;
}): {
  lean: boolean;
  strength: "strong" | "broad" | null;
  reason: string | null;
} {
  const playablePrice =
    args.oddsAmerican !== null &&
    args.oddsAmerican > TOTAL_VALIDATED_LEAN_MIN_PRICE_EXCLUSIVE;
  const projectionAligned =
    args.sameSideProjectionGap === null ||
    args.sameSideProjectionGap >= 0;
  const broad =
    !args.blocked &&
    (args.side === "over" || args.side === "under") &&
    args.modelProb !== null &&
    args.modelProb >= TOTAL_VALIDATED_LEAN_MIN_MODEL_PROB &&
    args.edgePct !== null &&
    args.edgePct >= TOTAL_VALIDATED_LEAN_MIN_EDGE_PCT &&
    playablePrice &&
    projectionAligned;
  const strong =
    broad &&
    args.modelProb !== null &&
    args.modelProb >= TOTAL_VALIDATED_STRONG_LEAN_MIN_MODEL_PROB &&
    args.sameSideProjectionGap !== null &&
    args.sameSideProjectionGap >= TOTAL_VALIDATED_STRONG_LEAN_MIN_PROJECTION_GAP;
  return {
    lean: broad,
    strength: strong ? "strong" : broad ? "broad" : null,
    reason: broad ? TOTAL_VALIDATED_LEAN_RULE_ID : null,
  };
}

function resolveFiFinalGrade(args: {
  basePlayGrade: string | null;
  baseNoBet: boolean;
  baseNoBetReason: string | null;
  edge: number | null;
  oddsAmerican: number | null;
  confidence: number | null;
}): {
  playGrade: string | null;
  bestAngle: boolean;
  noBet: boolean;
  noBetReason: string | null;
  audit: Record<string, unknown> | null;
} {
  const baseGrade = args.basePlayGrade;
  if (baseGrade !== "best_angle" && baseGrade !== "lean") {
    return {
      playGrade: baseGrade,
      bestAngle: false,
      noBet: args.baseNoBet,
      noBetReason: args.baseNoBetReason,
      audit: null,
    };
  }

  if (args.edge === null || args.oddsAmerican === null) {
    return {
      playGrade: "no_bet",
      bestAngle: false,
      noBet: true,
      noBetReason: "FI final value gate: missing current first-inning price or no-vig edge; not actionable.",
      audit: {
        rule_id: FI_VALIDATED_BEST_ANGLE_RULE_ID,
        action: "block_to_no_bet",
        reason: "missing_final_price_or_edge",
        original_play_grade: baseGrade,
        edge: args.edge,
        odds_american: args.oddsAmerican,
      },
    };
  }

  if (args.edge < 0) {
    return {
      playGrade: "no_bet",
      bestAngle: false,
      noBet: true,
      noBetReason: "FI final value gate: picked side has negative edge after current no-vig price; not actionable.",
      audit: {
        rule_id: FI_VALIDATED_BEST_ANGLE_RULE_ID,
        action: "block_to_no_bet",
        reason: "negative_final_edge",
        original_play_grade: baseGrade,
        edge: args.edge,
        odds_american: args.oddsAmerican,
        confidence: args.confidence,
      },
    };
  }

  if (baseGrade !== "best_angle") {
    return {
      playGrade: baseGrade,
      bestAngle: false,
      noBet: args.baseNoBet,
      noBetReason: args.baseNoBetReason,
      audit: null,
    };
  }

  const confidenceOk =
    args.confidence !== null &&
    args.confidence >= FI_FINAL_BEST_ANGLE_MIN_CONFIDENCE;
  const edgeOk = args.edge >= FI_FINAL_BEST_ANGLE_MIN_EDGE;
  const priceOk = args.oddsAmerican > FI_FINAL_BEST_ANGLE_MIN_PRICE_EXCLUSIVE;
  const validated = !args.baseNoBet && confidenceOk && edgeOk && priceOk;
  if (validated) {
    return {
      playGrade: "best_angle",
      bestAngle: true,
      noBet: false,
      noBetReason: null,
      audit: {
        rule_id: FI_VALIDATED_BEST_ANGLE_RULE_ID,
        action: "keep_as_best_angle",
        edge: args.edge,
        min_edge: FI_FINAL_BEST_ANGLE_MIN_EDGE,
        odds_american: args.oddsAmerican,
        min_price_exclusive: FI_FINAL_BEST_ANGLE_MIN_PRICE_EXCLUSIVE,
        confidence: args.confidence,
        min_confidence: FI_FINAL_BEST_ANGLE_MIN_CONFIDENCE,
        validation_note:
          "MLB FI replay 2026-06-11..2026-07-10: signed edge >=6pp with price > -130 replayed 25-12, +11.7767u. The 5-6pp tier replayed near-flat and is Lean only.",
      },
    };
  }

  return {
    playGrade: "lean",
    bestAngle: false,
    noBet: false,
    noBetReason: null,
    audit: {
      rule_id: FI_VALIDATED_BEST_ANGLE_RULE_ID,
      action: "demote_to_lean",
      reason: "failed_final_best_angle_gate",
      original_play_grade: baseGrade,
      edge: args.edge,
      min_edge: FI_FINAL_BEST_ANGLE_MIN_EDGE,
      edge_ok: edgeOk,
      odds_american: args.oddsAmerican,
      min_price_exclusive: FI_FINAL_BEST_ANGLE_MIN_PRICE_EXCLUSIVE,
      price_ok: priceOk,
      confidence: args.confidence,
      min_confidence: FI_FINAL_BEST_ANGLE_MIN_CONFIDENCE,
      confidence_ok: confidenceOk,
    },
  };
}

/**
 * MLB-P0 — final Best Angle resolution at write time.
 *
 * The pure model marks a pick `*_best_angle_eligible` (regularized-edge
 * gates + totals tightening + fallback block) and, separately,
 * `*_requires_market_confirmation` when regularization had to cap an
 * implausibly large RAW edge. This resolver applies the market-confirmation
 * layer the pure model can't see (line movement + public money):
 *
 *   • opposing public money (existing narrow guard)      → demote
 *   • line movement AGAINST the pick                      → demote
 *   • requires-confirmation pick with NO confirming move  → demote
 *       (confirmation = line movement TOWARD the pick; "neutral"/"unknown"
 *        is NOT confirmation — an unavailable signal can't confirm)
 *   • line movement toward the pick CONFIRMS a capped edge but never
 *     upgrades a non-eligible pick — the baseEligible gate is checked
 *     first, so confirmation can only rescue, never promote.
 *
 * Only ever suppresses; never invents a Best Angle. Never touches the
 * pick, side, line, or grade columns — only the boolean best_angle flag.
 */
export function resolveMlbBestAngle(args: {
  baseEligible: boolean;
  requiresConfirmation: boolean;
  lineDirection: "toward_pick" | "against_pick" | "neutral" | "unknown" | null;
  opposingPublicMoney: boolean;
}): { bestAngle: boolean; demoteReason: string | null } {
  if (!args.baseEligible) return { bestAngle: false, demoteReason: null };
  if (args.opposingPublicMoney) {
    return { bestAngle: false, demoteReason: "opposing_public_money" };
  }
  if (args.lineDirection === "against_pick") {
    return { bestAngle: false, demoteReason: "line_movement_against_pick" };
  }
  if (args.requiresConfirmation && args.lineDirection !== "toward_pick") {
    return { bestAngle: false, demoteReason: "large_unconfirmed_regularized_edge" };
  }
  return { bestAngle: true, demoteReason: null };
}

export const MLB_MARKET_AWARE_SIDE_CORRECTION_RULE_ID =
  "mlb_market_aware_final_side_selector_v1_2026_07_11";
export const MLB_MARKET_AWARE_CORRECTED_GRADE_RULE_ID =
  "mlb_market_aware_corrected_grade_v3_ba_only_2026_07_11";

type MlbMarketAwareSideCorrectionInput = {
  market: "moneyline" | "total";
  side: string | null;
  modelProb: number | null;
  marketProb: number | null;
  originalConfidence: number | null;
  lineDirection: "toward_pick" | "against_pick" | "neutral" | "unknown" | null;
  publicSplitSupport: boolean;
  publicSplitConflict: boolean;
  distanceCapApplied: boolean;
  homeOdds: number | null;
  awayOdds: number | null;
  overOdds: number | null;
  underOdds: number | null;
};

type MlbMarketAwareSideCorrectionResult =
  | {
      applied: true;
      rule_id: typeof MLB_MARKET_AWARE_SIDE_CORRECTION_RULE_ID;
      correctedSide: "home" | "away" | "over" | "under";
      correctedOdds: number;
      correctedModelProb: number;
      correctedMarketProb: number | null;
      correctedEdgePp: number | null;
      rawCorrectedSideModelProb: number | null;
      rawCorrectedSideMarketProb: number | null;
      reasons: string[];
    }
  | { applied: false; reason: string };

type MlbMarketAwareCorrectedPlayGradeInput = {
  market: "moneyline" | "total";
  correctedOdds: number | null;
  reasons: readonly string[];
};

type MlbMarketAwareCorrectedPlayGradeResult = {
  rule_id: typeof MLB_MARKET_AWARE_CORRECTED_GRADE_RULE_ID;
  playGrade: "best_angle" | "market_aligned";
  bestAngle: boolean;
  reason: string;
};

function oppositeMarketSide(
  market: "moneyline" | "total",
  side: string | null,
): "home" | "away" | "over" | "under" | null {
  if (market === "moneyline") {
    if (side === "home") return "away";
    if (side === "away") return "home";
    return null;
  }
  if (side === "over") return "under";
  if (side === "under") return "over";
  return null;
}

function pricedOddsForSide(
  side: "home" | "away" | "over" | "under",
  args: Pick<MlbMarketAwareSideCorrectionInput, "homeOdds" | "awayOdds" | "overOdds" | "underOdds">,
): number | null {
  if (side === "home") return args.homeOdds;
  if (side === "away") return args.awayOdds;
  if (side === "over") return args.overOdds;
  return args.underOdds;
}

function roundEdgePp(n: number): number {
  return Math.round(n * 10) / 10;
}

export function resolveMlbMarketAwareSideCorrection(
  args: MlbMarketAwareSideCorrectionInput,
): MlbMarketAwareSideCorrectionResult {
  const currentSide = args.side;
  const correctedSide = oppositeMarketSide(args.market, currentSide);
  if (correctedSide === null) return { applied: false, reason: "unsupported_side" };

  const reasons: string[] = [];
  if (args.market === "moneyline") {
    if (args.lineDirection === "against_pick") reasons.push("line_movement_against_pick");
    if (args.publicSplitConflict) reasons.push("opposing_public_split_conflict");
    if (args.distanceCapApplied) reasons.push("regularization_distance_cap_applied");
  } else {
    const splitSignal = args.publicSplitSupport || args.publicSplitConflict;
    if (args.lineDirection === "toward_pick") return { applied: false, reason: "line_movement_confirms_total_pick" };
    if (splitSignal) {
      if (args.publicSplitSupport) reasons.push("total_split_support_fade");
      if (args.publicSplitConflict) reasons.push("total_split_conflict_fade");
      if (args.lineDirection === "against_pick") reasons.push("line_movement_against_pick");
    }
  }
  if (reasons.length === 0) return { applied: false, reason: "no_market_side_correction_signal" };

  const correctedOdds = pricedOddsForSide(correctedSide, args);
  if (correctedOdds === null || !Number.isFinite(correctedOdds)) {
    return { applied: false, reason: "missing_corrected_side_price" };
  }

  const rawCorrectedSideModelProb = args.modelProb !== null ? 1 - args.modelProb : null;
  const rawCorrectedSideMarketProb = args.marketProb !== null ? 1 - args.marketProb : null;
  const correctedModelProb = flipRecommendationConfidence(args.originalConfidence) / 100;
  const correctedEdgePp =
    rawCorrectedSideMarketProb !== null
      ? roundEdgePp((correctedModelProb - rawCorrectedSideMarketProb) * 100)
      : null;

  return {
    applied: true,
    rule_id: MLB_MARKET_AWARE_SIDE_CORRECTION_RULE_ID,
    correctedSide,
    correctedOdds,
    correctedModelProb,
    correctedMarketProb: rawCorrectedSideMarketProb,
    correctedEdgePp,
    rawCorrectedSideModelProb,
    rawCorrectedSideMarketProb,
    reasons,
  };
}

export function resolveMlbMarketAwareCorrectedPlayGrade(
  args: MlbMarketAwareCorrectedPlayGradeInput,
): MlbMarketAwareCorrectedPlayGradeResult {
  const price = args.correctedOdds;
  const reasons = new Set(args.reasons);
  const watchlist = (reason: string): MlbMarketAwareCorrectedPlayGradeResult => ({
    rule_id: MLB_MARKET_AWARE_CORRECTED_GRADE_RULE_ID,
    playGrade: "market_aligned",
    bestAngle: false,
    reason,
  });
  const bestAngle = (reason: string): MlbMarketAwareCorrectedPlayGradeResult => ({
    rule_id: MLB_MARKET_AWARE_CORRECTED_GRADE_RULE_ID,
    playGrade: "best_angle",
    bestAngle: true,
    reason,
  });

  if (price === null || !Number.isFinite(price)) return watchlist("missing_corrected_side_price");

  if (args.market === "moneyline") {
    if (price <= -170) return watchlist("corrected_ml_price_too_expensive");
    if (price >= 140) return watchlist("corrected_ml_plus_price_too_volatile");
    if (reasons.has("line_movement_against_pick") && reasons.has("regularization_distance_cap_applied")) {
      return watchlist("corrected_ml_line_against_plus_distance_cap_unvalidated");
    }
    if (price > -136 && price < 100) return bestAngle("corrected_ml_short_playable_favorite");
    if (reasons.has("regularization_distance_cap_applied")) return bestAngle("corrected_ml_distance_cap_playable_price");
    return watchlist("corrected_ml_unvalidated_watchlist");
  }

  if (price <= -135) return watchlist("corrected_total_price_not_best_angle_playable");
  if (
    reasons.has("total_split_support_fade") &&
    reasons.has("line_movement_against_pick")
  ) {
    return watchlist("corrected_total_split_support_plus_line_against_unvalidated");
  }
  if (price >= 100) return bestAngle("corrected_total_plus_money_split_fade");
  return watchlist("corrected_total_unvalidated_watchlist");
}

function buildMlRecord(
  pred: PredictionRow,
  game: GameRow,
  homeAbbrev: string,
  awayAbbrev: string,
  slateDate: string,
  launchDay: boolean,
  signalsForGame: PublicSplitsRow[],
  oddsForGame: GameOddsSnapshot | null,
  openersForGame: LineHistoryOpenerRow[],
  currentLinesForGame: LineRowForOdds[],
  sourceAwareSplitsForGame: SourceAwareSplitObservationRow[] = [],
): PredictionRecordRow | null {
  const sp = (pred.sport_specific ?? {}) as Record<string, unknown>;
  const holdPicks = Array.isArray(sp.hold_picks) ? (sp.hold_picks as string[]) : [];
  const held = holdPicks.includes("ml") || pred.predicted_ml_winner === null;
  if (held) return null;
  const v22 = (sp.v2_2_audit ?? {}) as Record<string, unknown>;
  const v21 = (sp.v2_1_audit ?? {}) as Record<string, unknown>;
  const legacyMarketSignalGradeInfluenceEnabled =
    readMarketIntelligenceV2Config().legacyMarketSignalGradeInfluenceEnabled;
  // Phase 6B.18 — capture the pregame price + audit math for the
  // picked side so Daily Edge can render the locked snapshot
  // verbatim after lock instead of falling back to live `lines` and
  // live game_predictions.sport_specific. Pre-6B.18 these were all
  // null on locked snapshots and the UI had to fall back to live.
  const mlOddsAmerican =
    pred.predicted_ml_winner === "home"
      ? oddsForGame?.mlHomeOdds ?? null
      : pred.predicted_ml_winner === "away"
        ? oddsForGame?.mlAwayOdds ?? null
        : null;
  const mlModelProb =
    typeof v22.ml_model_prob === "number"
      ? (v22.ml_model_prob as number)
      : pred.ml_confidence !== null
        ? pred.ml_confidence / 100
        : null;
  const mlMarketProb =
    typeof v22.ml_market_prob === "number"
      ? (v22.ml_market_prob as number)
      : pred.predicted_ml_winner === "home" && typeof v21.market_home_win_prob === "number"
        ? (v21.market_home_win_prob as number)
        : pred.predicted_ml_winner === "away" && typeof v21.market_away_win_prob === "number"
          ? (v21.market_away_win_prob as number)
          : null;
  const mlEdgePp =
    typeof v22.ml_edge_pct === "number"
      ? (v22.ml_edge_pct as number)
      : mlModelProb !== null && mlMarketProb !== null
        ? (mlModelProb - mlMarketProb) * 100
        : null;
  // MLB-P0 — resolve Best Angle with the market-confirmation layer the pure
  // model can't see (line movement + public money). Computed once here so
  // the same line_movement snapshot is reused below.
  const mlLineMovement = buildLineMovementSnapshot(
    openersForGame, currentLinesForGame, signalsForGame, "moneyline", pred.predicted_ml_winner,
  );
  const mlBaseBestAngleEligible = readBoolish(sp.ml_best_angle_eligible);
  // This is tracking/display truth, not legacy market-grade influence. Even
  // when the market-aware engine is enabled, a Best Angle still needs the same
  // final confirmation/demotion layer that Daily Edge uses for member cards.
  const mlBest = resolveMlbBestAngle({
    baseEligible: mlBaseBestAngleEligible,
    requiresConfirmation: readBoolish(v22.ml_requires_market_confirmation),
    lineDirection: readLineDirection(mlLineMovement),
    opposingPublicMoney: hasOpposingPublicMoneyConflict(signalsForGame, "moneyline", pred.predicted_ml_winner),
  });
  // 2026-06-22 — ML inverted low-conviction market-divergent flip. For the
  // proven inverted cohort (final conf 55-60 ∧ raw<60 ∧ market-divergent) the
  // model is reliably wrong; we flip the OFFICIAL/tracked recommendation to the
  // opposite ML side at the real opposite-book price (never fabricated). The
  // model's own opinion (pred.predicted_ml_winner) is preserved in audit; only
  // the prediction_records pick flips. See resolveMlInversionFlip + snapshot.ml_flip.
  const mlAf = (sp.auto_factors ?? {}) as Record<string, unknown>;
  const mlFlip = resolveMlInversionFlip({
    predictedSide: pred.predicted_ml_winner === "home" || pred.predicted_ml_winner === "away" ? pred.predicted_ml_winner : null,
    confidence: pred.ml_confidence,
    rawConfidence: typeof mlAf.ml_raw_confidence === "number" ? (mlAf.ml_raw_confidence as number) : null,
    marketAligned: readBoolish(sp.ml_market_aligned),
    modelProb: mlModelProb,
    marketProb: mlMarketProb,
    homeOdds: oddsForGame?.mlHomeOdds ?? null,
    awayOdds: oddsForGame?.mlAwayOdds ?? null,
  });
  const mlFlipped = mlFlip.flipped === true;
  const baseMlPick = mlFlipped ? mlFlip.flippedSide : pred.predicted_ml_winner;
  const baseMlOdds = mlFlipped ? mlFlip.flippedOdds : mlOddsAmerican;
  const baseMlConfidence = mlFlipped ? mlFlip.recommendationConfidence : pred.ml_confidence;
  const baseMlModelProb = mlFlipped ? mlFlip.recommendationConfidence / 100 : mlModelProb;
  const baseMlMarketProb = mlFlipped ? mlFlip.flippedMarketProb : mlMarketProb;
  const baseMlEdge = mlFlipped ? null : mlEdgePp;
  const rawModelProbOnBaseSide =
    baseMlPick === pred.predicted_ml_winner
      ? mlModelProb
      : mlModelProb !== null
        ? 1 - mlModelProb
        : null;
  const marketProbOnBaseSide =
    baseMlPick === pred.predicted_ml_winner
      ? mlMarketProb
      : mlMarketProb !== null
        ? 1 - mlMarketProb
        : null;
  const mlPickCalibration = resolveMlbMlPickCalibration({
    officialSide: baseMlPick === "home" || baseMlPick === "away" ? baseMlPick : null,
    modelProbOnOfficialSide: rawModelProbOnBaseSide,
    marketProbOnOfficialSide: marketProbOnBaseSide,
    homeOdds: oddsForGame?.mlHomeOdds ?? null,
    awayOdds: oddsForGame?.mlAwayOdds ?? null,
  });
  const mlPickCalibrated = mlPickCalibration.applied === true;
  let finalMlPick = mlPickCalibrated ? mlPickCalibration.calibratedSide : baseMlPick;
  let finalMlOdds = mlPickCalibrated ? mlPickCalibration.calibratedOdds : baseMlOdds;
  // Member-facing: a flipped row shows the conservative recommendation
  // confidence (>=55), never the raw sub-50 opposite-side probability. The raw
  // opposite-side prob/edge live in snapshot.ml_flip (audit only).
  let finalMlModelProb = mlPickCalibrated ? mlPickCalibration.calibratedModelProb : baseMlModelProb;
  let finalMlConfidence = mlPickCalibrated ? Math.round(mlPickCalibration.calibratedModelProb * 100) : baseMlConfidence;
  let finalMlMarketProb = mlPickCalibrated ? mlPickCalibration.calibratedMarketProb : baseMlMarketProb;
  let finalMlEdge = mlPickCalibrated ? mlPickCalibration.calibratedEdgePp : baseMlEdge;
  let finalMlLineMovement =
    finalMlPick !== pred.predicted_ml_winner
      ? buildLineMovementSnapshot(openersForGame, currentLinesForGame, signalsForGame, "moneyline", finalMlPick)
      : mlLineMovement;
  let finalMlLineDirection = readLineDirection(finalMlLineMovement);
  let finalMlPublicSplitConflict = hasOpposingPublicMoneyConflict(signalsForGame, "moneyline", finalMlPick);
  const mlMarketSideCorrection = !mlFlipped && !mlPickCalibrated
    ? resolveMlbMarketAwareSideCorrection({
        market: "moneyline",
        side: finalMlPick,
        modelProb: finalMlModelProb,
        marketProb: finalMlMarketProb,
        originalConfidence: finalMlConfidence,
        lineDirection: finalMlLineDirection,
        publicSplitSupport: hasSupportingPublicMoneyConfirmation(signalsForGame, "moneyline", finalMlPick),
        publicSplitConflict: finalMlPublicSplitConflict,
        distanceCapApplied: readBoolish(v22.ml_distance_cap_applied),
        homeOdds: oddsForGame?.mlHomeOdds ?? null,
        awayOdds: oddsForGame?.mlAwayOdds ?? null,
        overOdds: null,
        underOdds: null,
      })
    : { applied: false as const, reason: "prior_ml_side_correction_applied" };
  const mlMarketSideCorrected = mlMarketSideCorrection.applied === true;
  if (mlMarketSideCorrected) {
    finalMlPick = mlMarketSideCorrection.correctedSide;
    finalMlOdds = mlMarketSideCorrection.correctedOdds;
    finalMlConfidence = Math.round(mlMarketSideCorrection.correctedModelProb * 100);
    finalMlModelProb = mlMarketSideCorrection.correctedModelProb;
    finalMlMarketProb = mlMarketSideCorrection.correctedMarketProb;
    finalMlEdge = mlMarketSideCorrection.correctedEdgePp;
    finalMlLineMovement = buildLineMovementSnapshot(
      openersForGame, currentLinesForGame, signalsForGame, "moneyline", finalMlPick,
    );
    finalMlLineDirection = readLineDirection(finalMlLineMovement);
    finalMlPublicSplitConflict = hasOpposingPublicMoneyConflict(signalsForGame, "moneyline", finalMlPick);
  }
  const mlProjectionConflict = projectionContradictsMoneylinePick(pred, v22, finalMlPick);
  const mlChampionCorrectionReasons = [
    !mlMarketSideCorrected && mlProjectionConflict ? "projected_score_contradicts_ml_pick" : null,
    !mlMarketSideCorrected && readBoolish(v22.ml_requires_market_confirmation) ? "ml_requires_market_confirmation" : null,
    !mlMarketSideCorrected && finalMlLineDirection === "against_pick" ? "line_movement_against_pick" : null,
    !mlMarketSideCorrected && finalMlPublicSplitConflict ? "opposing_public_split_conflict" : null,
  ].filter((r): r is string => r !== null);
  const mlChampionStandDownReason =
    mlChampionCorrectionReasons.length > 0
      ? `champion_candidate_ml_stand_down: ${mlChampionCorrectionReasons.join(", ")}`
      : null;
  const mlNoBetReason = readStringOrNull(sp.ml_no_bet_reason);
  const mlNoBet = mlChampionStandDownReason !== null || (!mlFlipped && !mlPickCalibrated && !mlMarketSideCorrected && isExplicitNoBetReason(mlNoBetReason));
  const finalMlNoBetReason = mlChampionStandDownReason ?? mlNoBetReason;
  const mlPublicPlayGrade = readPublicPlayGrade(sp.ml_play_grade);
  const mlMarketAwareCorrectedGrade = mlMarketSideCorrected
    ? resolveMlbMarketAwareCorrectedPlayGrade({
        market: "moneyline",
        correctedOdds: finalMlOdds,
        reasons: mlMarketSideCorrection.applied === true ? mlMarketSideCorrection.reasons : [],
      })
    : null;
  const mlSameSideProjectionGap = moneylineProjectionSameSideGap(pred, v22, finalMlPick);
  const mlCleanTightEdgeBestAngle = resolveMlCleanTightEdgeBestAngle({
    blocked: mlNoBet || mlFlipped || mlPickCalibrated || mlMarketSideCorrected,
    side: finalMlPick,
    modelProb: finalMlModelProb,
    edgePct: finalMlEdge,
    oddsAmerican: finalMlOdds,
    sameSideProjectionGap: mlSameSideProjectionGap,
    lineDirection: finalMlLineDirection,
    publicSplitConflict: finalMlPublicSplitConflict,
  });
  const mlCalibratedBestAngle = mlCleanTightEdgeBestAngle.bestAngle;
  const mlPromotedBestAngle = !mlBest.bestAngle && mlCalibratedBestAngle;
  const mlDemotedBroadBestAngle = mlBest.bestAngle && !mlCalibratedBestAngle;
  const trackedMlBestAngle =
    mlMarketAwareCorrectedGrade !== null
      ? mlMarketAwareCorrectedGrade.bestAngle
      : mlFlipped || mlPickCalibrated || mlChampionStandDownReason !== null
      ? false
      : mlCalibratedBestAngle;
  const mlLeanEligible =
    !trackedMlBestAngle &&
    !mlNoBet &&
    !mlFlipped &&
    !mlPickCalibrated &&
    !mlMarketSideCorrected &&
    finalMlModelProb !== null &&
    finalMlModelProb >= ML_CLEAN_TIGHT_EDGE_MIN_MODEL_PROB &&
    finalMlModelProb < ML_CLEAN_TIGHT_EDGE_MAX_MODEL_PROB_EXCLUSIVE &&
    finalMlEdge !== null &&
    finalMlEdge >= ML_CLEAN_TIGHT_EDGE_MIN_EDGE_PCT &&
    finalMlOdds !== null &&
    finalMlOdds > ML_CLEAN_TIGHT_EDGE_MIN_PRICE_EXCLUSIVE &&
    !finalMlPublicSplitConflict &&
    (mlSameSideProjectionGap === null || mlSameSideProjectionGap >= 0);
  const trackedMlPublicPlayGrade =
    mlPublicPlayGrade === "provisional"
      ? "provisional"
      : mlNoBet
        ? null
        : trackedMlBestAngle
          ? "best_angle"
          : mlLeanEligible
            ? "lean"
            : mlPublicPlayGrade !== null && finalMlEdge !== null && finalMlEdge >= 0
              ? "market_aligned"
              : null;
  return {
    game_prediction_id: pred.id,
    game_id: game.id,
    external_id: game.external_id,
    sport: "mlb",
    slate_date: slateDate,
    game_date: game.game_date,
    matchup: `${awayAbbrev}@${homeAbbrev}`,
    market: "moneyline",
    pick: finalMlPick,
    side: finalMlPick,
    line_value: null,
    odds_american: finalMlOdds,
    odds_decimal: null,
    model_used: readStringOrNull(sp.model_used),
    model_version: readStringOrNull(sp.model_version),
    prediction_source: pred.prediction_source,
    confidence: finalMlConfidence,
    model_probability: finalMlModelProb,
    market_probability: finalMlMarketProb,
    edge: finalMlEdge,
    expected_value: null,
    // Phase 6B.27 — strip internal V2.2 diagnostic labels (no_bet/held/
    // toss_up) from the public column; raw stays in snapshot.v2_2_audit.
    // Flipped/calibrated/corrected rows carry no model grade until the separate
    // grade calibration layer validates a cohort; otherwise they remain Watchlist.
    play_grade: mlMarketSideCorrected
      ? mlMarketAwareCorrectedGrade?.playGrade ?? "market_aligned"
      : mlFlipped || mlPickCalibrated || mlChampionStandDownReason !== null
        ? null
        : trackedMlPublicPlayGrade,
    prediction_type: readStringOrNull(sp.ml_prediction_type),
    // Phase 6B.11 + MLB-P0 — public-money guard PLUS line-movement /
    // large-edge confirmation (see resolveMlbBestAngle). Tracking pending
    // BA count matches what members see on the live slate. Flipped/calibrated
    // rows are never Best Angle until grade calibration is separately validated.
    best_angle: trackedMlBestAngle,
    no_bet: mlNoBet,
    no_bet_reason: finalMlNoBetReason,
    market_aligned: readBoolish(sp.ml_market_aligned),
    data_quality_tier: readStringOrNull(sp.v2_data_quality_tier),
    source_quality: null,
    provisional: readBoolish(sp.v2_provisional),
    held: false,
    hold_reason: null,
    launch_day: launchDay,
    manual_outcome_expected: launchDay,
    locked_at: pred.locked_at,
    published_at: game.slate_status === "published" ? pred.computed_at : null,
    /* Phase 6B.22 — additive context for calibration. Never overwrites
       existing sp keys. */
    snapshot_json: {
      ...sp,
      model_layer_versions: buildMlbModelLayerVersions("moneyline"),
      public_splits: buildPublicSplitsSnapshot(signalsForGame, "moneyline", finalMlPick),
      line_movement: finalMlLineMovement,
      // MLB-P0 — audit trail for the Best Angle confirmation resolution.
      best_angle_resolution: {
        base_eligible: mlBaseBestAngleEligible,
        legacy_market_signal_grade_influence_enabled: legacyMarketSignalGradeInfluenceEnabled,
        requires_confirmation: readBoolish(v22.ml_requires_market_confirmation),
        line_direction: finalMlLineDirection,
        demote_reason: mlBest.demoteReason,
        clean_tight_edge_promotion: mlPromotedBestAngle,
        clean_tight_edge_promotion_rule_id: mlPromotedBestAngle ? ML_CLEAN_TIGHT_EDGE_BEST_ANGLE_RULE_ID : null,
        broad_best_angle_demoted_by_recalibration: mlDemotedBroadBestAngle,
        final_best_angle: trackedMlBestAngle,
      },
      market_aware_corrected_grade: mlMarketAwareCorrectedGrade,
      ml_grade_recalibration: {
        rule_id: "ml_grade_recalibration_v2_2026_07_11",
        original_public_play_grade: mlPublicPlayGrade,
        final_public_play_grade: mlMarketAwareCorrectedGrade?.playGrade ?? trackedMlPublicPlayGrade,
        final_best_angle: trackedMlBestAngle,
        clean_tight_best_angle: mlCalibratedBestAngle,
        lean_eligible: mlLeanEligible,
        model_prob: finalMlModelProb,
        min_model_prob: ML_CLEAN_TIGHT_EDGE_MIN_MODEL_PROB,
        max_model_prob_exclusive: ML_CLEAN_TIGHT_EDGE_MAX_MODEL_PROB_EXCLUSIVE,
        edge_pct: finalMlEdge,
        min_edge_pct: ML_CLEAN_TIGHT_EDGE_MIN_EDGE_PCT,
        odds_american: finalMlOdds,
        min_price_exclusive: ML_CLEAN_TIGHT_EDGE_MIN_PRICE_EXCLUSIVE,
        same_side_projection_gap: mlSameSideProjectionGap,
        abs_projection_gap: mlCleanTightEdgeBestAngle.absProjectionGap,
        max_abs_projection_gap_exclusive: ML_CLEAN_TIGHT_EDGE_MAX_ABS_PROJECTION_GAP_EXCLUSIVE,
        line_direction: finalMlLineDirection,
        public_split_conflict: finalMlPublicSplitConflict,
        market_aware_side_corrected: mlMarketSideCorrected,
        market_aware_corrected_grade: mlMarketAwareCorrectedGrade,
        demoted_broad_best_angle: mlDemotedBroadBestAngle,
        validation_note:
          "Historical MLB grade replay 2026-06-11..2026-07-10: market-aware corrected ML Best Angles under v3 BA-only policy replayed 76-48, +13.96u; unvalidated corrected rows stay Watchlist.",
      },
      ml_clean_tight_edge_best_angle_promotion: mlPromotedBestAngle
        ? {
            rule_id: ML_CLEAN_TIGHT_EDGE_BEST_ANGLE_RULE_ID,
            action: "promote_to_best_angle",
            model_prob: finalMlModelProb,
            min_model_prob: ML_CLEAN_TIGHT_EDGE_MIN_MODEL_PROB,
            max_model_prob_exclusive: ML_CLEAN_TIGHT_EDGE_MAX_MODEL_PROB_EXCLUSIVE,
            edge_pct: finalMlEdge,
            min_edge_pct: ML_CLEAN_TIGHT_EDGE_MIN_EDGE_PCT,
            odds_american: finalMlOdds,
            min_price_exclusive: ML_CLEAN_TIGHT_EDGE_MIN_PRICE_EXCLUSIVE,
            abs_projection_gap: mlCleanTightEdgeBestAngle.absProjectionGap,
            max_abs_projection_gap_exclusive: ML_CLEAN_TIGHT_EDGE_MAX_ABS_PROJECTION_GAP_EXCLUSIVE,
            line_direction: finalMlLineDirection,
            public_split_conflict: finalMlPublicSplitConflict,
            validation_note:
              "Historical MLB replay 2026-06-01..2026-07-10 on current non-Best-Angles: 17-7, +6.7824u, 70.83% win rate, 28.26% ROI.",
          }
        : null,
      champion_candidate_correction: mlChampionStandDownReason === null
        ? null
        : {
            market: "moneyline",
            action: "stand_down",
            reasons: mlChampionCorrectionReasons,
            replay_policy: "champion_candidate_guardrails_2026_07_08",
            projection_conflict: mlProjectionConflict,
            line_direction: finalMlLineDirection,
            public_split_conflict: finalMlPublicSplitConflict,
            requires_market_confirmation: readBoolish(v22.ml_requires_market_confirmation),
          },
      data_integrity: buildDataIntegritySnapshot(sp, oddsForGame, "moneyline"),
      // Phase 6B.28 — rich-and-frozen Daily Edge substrate at lock.
      ...buildDailyEdgeLockSubstrate({ signalsForGame, currentLinesForGame, sourceAwareSplitsForGame, pred }),
      // Forward Fix A (2026-06-09) — audit trail for the writer's odds
      // source per (market, side). Lets operators verify the lock used
      // a real-book price (lines vs line_history_fallback) and detect
      // "unavailable" rows that need investigation. Always populated;
      // when `lines` was thin AND `line_history` had no usable row,
      // the source is "unavailable" with null book/odds/timestamp.
      odds_source_at_lock_ml: oddsForGame
        ? { home: oddsForGame.oddsSourceMl.home, away: oddsForGame.oddsSourceMl.away }
        : null,
      market_aware_side_correction: mlMarketSideCorrection.applied === true
        ? {
            applied: true,
            rule_id: MLB_MARKET_AWARE_SIDE_CORRECTION_RULE_ID,
            market: "moneyline",
            original_side: mlPickCalibration.applied === true ? mlPickCalibration.calibratedSide : baseMlPick,
            original_pick: mlPickCalibration.applied === true ? mlPickCalibration.calibratedSide : baseMlPick,
            original_odds: mlPickCalibration.applied === true ? mlPickCalibration.calibratedOdds : baseMlOdds,
            original_confidence: mlPickCalibration.applied === true ? Math.round(mlPickCalibration.calibratedModelProb * 100) : baseMlConfidence,
            original_model_prob: mlPickCalibration.applied === true ? mlPickCalibration.calibratedModelProb : baseMlModelProb,
            original_market_prob: mlPickCalibration.applied === true ? mlPickCalibration.calibratedMarketProb : baseMlMarketProb,
            corrected_side: finalMlPick,
            corrected_pick: finalMlPick,
            corrected_odds: finalMlOdds,
            corrected_model_prob: finalMlModelProb,
            corrected_market_prob: finalMlMarketProb,
            corrected_edge_pp: mlMarketSideCorrection.correctedEdgePp,
            raw_corrected_side_model_prob: mlMarketSideCorrection.rawCorrectedSideModelProb,
            raw_corrected_side_market_prob: mlMarketSideCorrection.rawCorrectedSideMarketProb,
            final_displayed_confidence: finalMlConfidence,
            reasons: mlMarketSideCorrection.reasons,
            public_play_grade: mlMarketAwareCorrectedGrade?.playGrade ?? "market_aligned",
            public_best_angle: mlMarketAwareCorrectedGrade?.bestAngle ?? false,
            public_grade_reason: mlMarketAwareCorrectedGrade?.reason ?? null,
            validation_note:
              "Historical MLB side-correction replay through 2026-07-10: ML market-against/distance-cap rows improved when flipped before grading; corrected Best Angle promotion is limited to validated v3 cohorts.",
          }
        : null,
      // 2026-06-22 — ML inversion flip audit. Present only when the flip fired;
      // preserves the original model recommendation so the override is fully
      // reversible and explainable. The model's raw opinion also remains in
      // game_predictions.predicted_ml_winner (untouched).
      ml_flip: mlFlipped
        ? {
            flipped: true,
            rule_id: ML_INVERSION_RULE_ID,
            original_side: pred.predicted_ml_winner,
            original_pick: pred.predicted_ml_winner,
            original_confidence: pred.ml_confidence,
            original_raw_confidence:
              typeof mlAf.ml_raw_confidence === "number" ? (mlAf.ml_raw_confidence as number) : null,
            original_model_prob: mlModelProb,
            original_market_aligned: readBoolish(sp.ml_market_aligned),
            original_odds: mlOddsAmerican,
            flipped_side: finalMlPick,
            flipped_pick: finalMlPick,
            flipped_odds: finalMlOdds,
            // Raw opposite-side probability — AUDIT ONLY, never shown to members.
            flipped_side_model_prob: mlFlip.flippedSideModelProb,
            flipped_side_edge_pp: mlFlip.flippedEdgePp,
            final_displayed_confidence: finalMlConfidence,
            reason: "low-conviction market-divergent ML inversion",
          }
        : null,
      pick_calibration: mlPickCalibrated
        ? {
            applied: true,
            rule_id: MLB_ML_RAW_MODEL_SIDE_PICK_CALIBRATION_RULE_ID,
            original_side: mlPickCalibration.originalSide,
            original_pick: mlPickCalibration.originalSide,
            original_odds: baseMlOdds,
            original_model_prob: mlPickCalibration.originalModelProb,
            original_market_prob: mlPickCalibration.originalMarketProb,
            calibrated_side: mlPickCalibration.calibratedSide,
            calibrated_pick: mlPickCalibration.calibratedSide,
            calibrated_odds: mlPickCalibration.calibratedOdds,
            calibrated_model_prob: mlPickCalibration.calibratedModelProb,
            calibrated_market_prob: mlPickCalibration.calibratedMarketProb,
            calibrated_edge_pp: mlPickCalibration.calibratedEdgePp,
            reason: mlPickCalibration.reason,
          }
        : null,
    },
  };
}

function buildOuRecord(
  pred: PredictionRow,
  game: GameRow,
  homeAbbrev: string,
  awayAbbrev: string,
  slateDate: string,
  launchDay: boolean,
  signalsForGame: PublicSplitsRow[],
  oddsForGame: GameOddsSnapshot | null,
  openersForGame: LineHistoryOpenerRow[],
  currentLinesForGame: LineRowForOdds[],
  sourceAwareSplitsForGame: SourceAwareSplitObservationRow[] = [],
): PredictionRecordRow | null {
  const sp = (pred.sport_specific ?? {}) as Record<string, unknown>;
  const holdPicks = Array.isArray(sp.hold_picks) ? (sp.hold_picks as string[]) : [];
  const held = holdPicks.includes("ou") || pred.predicted_ou_side === null;
  if (held) return null;
  const v21 = (sp.v2_1_audit ?? {}) as Record<string, unknown>;
  const v22 = (sp.v2_2_audit ?? {}) as Record<string, unknown>;
  const legacyMarketSignalGradeInfluenceEnabled =
    readMarketIntelligenceV2Config().legacyMarketSignalGradeInfluenceEnabled;
  // Phase 6B.17 — read line_value from V2.2 audit FIRST (the active
  // model writes here), fall back to V2.1 audit for legacy snapshots.
  // Pre-6B.17 the locked total snapshot stored line_value=null because
  // V2.2 writes market_total under sp.v2_2_audit, not sp.v2_1_audit.
  // Daily Edge then had no locked total line to render and fell back
  // to the live `lines` table — which kept moving mid-game (CWS@PHI
  // pregame 9.5 → mid-game 12.5 was the symptom).
  const lockedTotalLine =
    typeof v22.market_total === "number"
      ? (v22.market_total as number)
      : typeof v21.market_total === "number"
        ? (v21.market_total as number)
        : null;
  // Phase 6B.18 — capture pregame picked-side OU price + audit math.
  const ouOddsAmerican =
    pred.predicted_ou_side === "over"
      ? oddsForGame?.ouOverOdds ?? null
      : pred.predicted_ou_side === "under"
        ? oddsForGame?.ouUnderOdds ?? null
        : null;
  const ouModelProb =
    typeof v22.ou_model_prob === "number"
      ? (v22.ou_model_prob as number)
      : pred.ou_confidence !== null
        ? pred.ou_confidence / 100
        : null;
  const ouMarketProb =
    typeof v22.ou_market_prob === "number"
      ? (v22.ou_market_prob as number)
      : null;
  const ouEdgePp =
    typeof v22.ou_edge_pct === "number"
      ? (v22.ou_edge_pct as number)
      : ouModelProb !== null && ouMarketProb !== null
        ? (ouModelProb - ouMarketProb) * 100
        : null;
  // MLB-P0 — same Best Angle confirmation resolution as ML.
  const ouLineMovement = buildLineMovementSnapshot(
    openersForGame, currentLinesForGame, signalsForGame, "total", pred.predicted_ou_side,
  );
  const ouBaseBestAngleEligible = readBoolish(sp.ou_best_angle_eligible);
  const initialOuPublicSplitConflict = hasOpposingPublicMoneyConflict(
    signalsForGame,
    "total",
    pred.predicted_ou_side,
  );
  const initialOuPublicSplitSupport = hasSupportingPublicMoneyConfirmation(
    signalsForGame,
    "total",
    pred.predicted_ou_side,
  );
  // This is tracking/display truth, not legacy market-grade influence. Keep
  // the final Best Angle resolver active under the market-aware engine too.
  const ouBest = resolveMlbBestAngle({
    baseEligible: ouBaseBestAngleEligible,
    requiresConfirmation: readBoolish(v22.ou_requires_market_confirmation),
    lineDirection: readLineDirection(ouLineMovement),
    opposingPublicMoney: initialOuPublicSplitConflict,
  });
  // 2026-06-22 — Integrity stand-down for projection/probability divergence.
  // The O/U side follows P(over) vs P(under), but the projected MEAN total can
  // land on the opposite side of the line (right-skew). reconcileTotalProjection
  // already flags this as `mean_probability_divergence` and caps the GRADE to
  // "watchlist" — but the row still published as a promoted Lean/market_aligned
  // play. Backtest (6/6–6/22) shows these go 4-12 (25%), a real model-signal
  // leak, not just a display artifact. Stand them down to No Play via no_bet
  // (the resolver maps no_bet=true → "No Play"). This is a TEMPORARY integrity
  // patch while the totals probability/edge layer is diagnosed — NOT the fix.
  // no_bet (not held) is used deliberately so the row still WRITES and GRADES
  // internally per the tracking-completeness contract; it is only excluded from
  // the public W/L surface at read time.
  // 2026-06-22 — Totals divergence handling. The divergent cohort (probability
  // pick opposite the projected-mean side) is upgraded from Patch-1 No Play to a
  // CONSERVATIVE mean-side FLIP when material (gap>=0.3, line<10, valid mean-side
  // price). Backtest: flip-to-mean 54.6%/+13.4u beats no-play +1.6u. Non-eligible
  // divergent rows keep Patch-1 no_bet stand-down. Side-selection reconciliation
  // only — the projected total and probability model are untouched. The model's
  // original probability side is preserved in snapshot.ou_flip.
  const ouReconciliation = (sp.total_projection_reconciliation ?? null) as
    | { mean_probability_divergence?: unknown }
    | null;
  // 2026-06-22 — LINE BASIS: the totals correction, line_value, and tracking
  // resolve against the line the user actually BETS (the sportsbook total line
  // from oddsForGame), falling back to the model's market_total only when the
  // bet line is unavailable. Keeps the final side/line/tracking aligned to what
  // members see.
  const pickedSideOuLine =
    pred.predicted_ou_side === "over"
      ? oddsForGame?.oddsSourceOu?.over?.line ?? null
      : pred.predicted_ou_side === "under"
        ? oddsForGame?.oddsSourceOu?.under?.line ?? null
        : null;
  const ouBetLine: number | null =
    pickedSideOuLine ??
    (oddsForGame?.oddsSourceOu?.over?.line ?? null) ??
    (oddsForGame?.oddsSourceOu?.under?.line ?? null) ??
    lockedTotalLine;
  // The final O/U side resolves against the model's own posterior total first.
  // Displayed scores may be rounded/reconciled for card readability; they must
  // not override the champion totals projection when deciding O/U side.
  const ouScoreSum: number | null =
    typeof v22.posterior_total === "number"
        ? (v22.posterior_total as number)
        : typeof pred.predicted_away_score === "number" && typeof pred.predicted_home_score === "number"
          ? pred.predicted_away_score + pred.predicted_home_score
          : null;
  const ouFlip = resolveTotalsMeanFlip({
    predictedSide: pred.predicted_ou_side === "over" || pred.predicted_ou_side === "under" ? pred.predicted_ou_side : null,
    line: ouBetLine,
    projectedTotal: ouScoreSum,
    modelProb: ouModelProb,
    marketProb: ouMarketProb,
    originalConfidence: pred.ou_confidence,
    overOdds: oddsForGame?.ouOverOdds ?? null,
    underOdds: oddsForGame?.ouUnderOdds ?? null,
    reconciliationDivergence: ouReconciliation !== null && ouReconciliation.mean_probability_divergence === true,
  });
  const ouFlipped = ouFlip.action === "flip";
  const ouDivergenceStandDown = ouFlip.action === "standdown";
  const ouMarketFlip = ouFlip.action === "none"
    ? resolveTotalsMarketOpposedFlip({
        predictedSide: pred.predicted_ou_side === "over" || pred.predicted_ou_side === "under" ? pred.predicted_ou_side : null,
        modelProb: ouModelProb,
        marketProb: ouMarketProb,
        opposingPublicSplitConflict: initialOuPublicSplitConflict,
        originalConfidence: pred.ou_confidence,
        overOdds: oddsForGame?.ouOverOdds ?? null,
        underOdds: oddsForGame?.ouUnderOdds ?? null,
      })
    : { action: "none" as const };
  const ouMarketFlipped = ouMarketFlip.action === "flip";
  let finalOuPick = ouFlipped ? ouFlip.meanSide : ouMarketFlipped ? ouMarketFlip.flippedSide : pred.predicted_ou_side;
  let finalOuOdds = ouFlipped ? ouFlip.flippedOdds : ouMarketFlipped ? ouMarketFlip.flippedOdds : ouOddsAmerican;
  let ouCorrectionRuleId: string | null = ouFlipped
    ? TOTALS_MEAN_FLIP_RULE_ID
    : ouMarketFlipped
      ? TOTALS_MARKET_OPPOSED_FLIP_RULE_ID
      : null;
  let ouCorrectionKind: string | null = ouFlipped
    ? "mean_side_selector"
    : ouMarketFlipped
      ? "market_opposed_public_conflict"
      : null;
  let ouCorrectedSideModelProb = ouFlipped
    ? ouFlip.flippedSideModelProb
    : ouMarketFlipped
      ? ouMarketFlip.flippedSideModelProb
      : null;
  let ouCorrectedSideMarketProb = ouFlipped
    ? ouFlip.flippedMarketProb
    : ouMarketFlipped
      ? ouMarketFlip.flippedMarketProb
      : null;
  let ouCorrectedSideEdgePp = ouFlipped
    ? ouFlip.flippedEdgePp
    : ouMarketFlipped
      ? ouMarketFlip.flippedEdgePp
      : null;
  // Member-facing: flipped row shows the conservative recommendation confidence
  // (>=55), never the raw sub-50 mean-side probability (which lives in ou_flip).
  let finalOuConfidence = ouFlipped
    ? ouFlip.recommendationConfidence
    : ouMarketFlipped
      ? ouMarketFlip.recommendationConfidence
      : pred.ou_confidence;
  let finalOuModelProb = ouFlipped
    ? ouFlip.recommendationConfidence / 100
    : ouMarketFlipped
      ? ouMarketFlip.recommendationConfidence / 100
      : ouModelProb;
  let finalOuMarketProb = ouFlipped
    ? ouFlip.flippedMarketProb
    : ouMarketFlipped
      ? ouMarketFlip.flippedMarketProb
      : ouMarketProb;
  let finalOuEdge = ouFlipped || ouMarketFlipped ? null : ouEdgePp;
  let finalOuLineMovement =
    finalOuPick !== pred.predicted_ou_side
      ? buildLineMovementSnapshot(openersForGame, currentLinesForGame, signalsForGame, "total", finalOuPick)
      : ouLineMovement;
  let ouLineDirection = readLineDirection(finalOuLineMovement);
  const ouMarketSideCorrection = !ouFlipped && !ouMarketFlipped && !ouDivergenceStandDown
    ? resolveMlbMarketAwareSideCorrection({
        market: "total",
        side: finalOuPick,
        modelProb: finalOuModelProb,
        marketProb: finalOuMarketProb,
        originalConfidence: finalOuConfidence,
        lineDirection: readLineDirection(ouLineMovement),
        publicSplitSupport: initialOuPublicSplitSupport,
        publicSplitConflict: initialOuPublicSplitConflict,
        distanceCapApplied: false,
        homeOdds: null,
        awayOdds: null,
        overOdds: oddsForGame?.ouOverOdds ?? null,
        underOdds: oddsForGame?.ouUnderOdds ?? null,
      })
    : { applied: false as const, reason: "prior_total_side_correction_applied" };
  const ouMarketSideCorrected = ouMarketSideCorrection.applied === true;
  if (ouMarketSideCorrected) {
    finalOuPick = ouMarketSideCorrection.correctedSide;
    finalOuOdds = ouMarketSideCorrection.correctedOdds;
    ouCorrectionRuleId = MLB_MARKET_AWARE_SIDE_CORRECTION_RULE_ID;
    ouCorrectionKind = "market_aware_split_signal_fade";
    ouCorrectedSideModelProb = ouMarketSideCorrection.rawCorrectedSideModelProb;
    ouCorrectedSideMarketProb = ouMarketSideCorrection.rawCorrectedSideMarketProb;
    ouCorrectedSideEdgePp = ouMarketSideCorrection.correctedEdgePp;
    finalOuConfidence = Math.round(ouMarketSideCorrection.correctedModelProb * 100);
    finalOuModelProb = ouMarketSideCorrection.correctedModelProb;
    finalOuMarketProb = ouMarketSideCorrection.correctedMarketProb;
    finalOuEdge = ouMarketSideCorrection.correctedEdgePp;
    finalOuLineMovement = buildLineMovementSnapshot(
      openersForGame, currentLinesForGame, signalsForGame, "total", finalOuPick,
    );
    ouLineDirection = readLineDirection(finalOuLineMovement);
  }
  const ouBaseBestAngle = ouFlipped || ouMarketFlipped || ouMarketSideCorrected || ouDivergenceStandDown
    ? false
    : ouBest.bestAngle;
  const ouRawBestAngleCandidate =
    ouBaseBestAngleEligible &&
    !ouFlipped &&
    !ouMarketFlipped &&
    !ouMarketSideCorrected &&
    !ouDivergenceStandDown;
  const totalBestAngleMinModelProb =
    finalOuPick === "over"
      ? GATE_TOTAL_OVER_BEST_ANGLE_MIN_MODEL_PROB
      : finalOuPick === "under"
        ? GATE_TOTAL_UNDER_BEST_ANGLE_MIN_MODEL_PROB
        : null;
  const ouTotalBestAngleDemote =
    ouBaseBestAngle &&
    totalBestAngleMinModelProb !== null &&
    finalOuModelProb !== null &&
    finalOuModelProb < totalBestAngleMinModelProb;
  const ouFinalBestAngle = ouBaseBestAngle && !ouTotalBestAngleDemote;
  const ouRawPublicPlayGrade = readPublicPlayGrade(sp.ou_play_grade);
  const ouPublicPlayGrade = applyMlbBestAngleFinalGate(
    legacyMarketSignalGradeInfluenceEnabled
      ? applyPlayGradeGate(ouRawPublicPlayGrade, {
          modelProb: finalOuModelProb, americanOdds: finalOuOdds, market: "total",
          runGapAbs: null, totalLine: ouBetLine,
        })
      : ouRawPublicPlayGrade,
    ouRawBestAngleCandidate,
    ouFinalBestAngle,
  );
  const ouSameSideProjectionGap = totalProjectionSameSideGap(finalOuPick, ouScoreSum, ouBetLine);
  const ouProjectionGapAbs = totalProjectionGapAbs(finalOuPick, ouScoreSum, ouBetLine);
  const ouThinProjectionLeanCap =
    ouPublicPlayGrade === "lean" &&
    ouSameSideProjectionGap !== null &&
    ouSameSideProjectionGap < 0;
  const ouPublicSplitConflict = hasOpposingPublicMoneyConflict(signalsForGame, "total", finalOuPick);
  const ouMarketFriction = ouLineDirection === "against_pick" || ouPublicSplitConflict;
  const ouThinEdgeMarketFrictionCap =
    ouPublicPlayGrade === "lean" &&
    !ouThinProjectionLeanCap &&
    finalOuEdge !== null &&
    finalOuEdge < GATE_TOTAL_LEAN_MARKET_FRICTION_MAX_EDGE_PCT &&
    ouMarketFriction;
  const finalOuPublicPlayGrade = ouThinProjectionLeanCap || ouThinEdgeMarketFrictionCap ? "market_aligned" : ouPublicPlayGrade;
  const ouProjectionConflict =
    !ouMarketFlipped &&
    !ouMarketSideCorrected &&
    projectionContradictsTotalPick(ouScoreSum, ouBetLine, finalOuPick);
  const ouChampionStandDownReason = ouProjectionConflict
    ? "champion_candidate_total_projection_conflict: projected_total_contradicts_total_pick"
    : null;
  const explicitOuNoBetReason = readStringOrNull(sp.ou_no_bet_reason);
  const ouMissingActionableMarket =
    oddsForGame !== null &&
    (finalOuOdds === null ||
      finalOuMarketProb === null);
  const ouNoBet =
    ouMissingActionableMarket ||
    ouChampionStandDownReason !== null ||
    ouDivergenceStandDown ||
    (!ouMarketSideCorrected && isExplicitNoBetReason(explicitOuNoBetReason));
  const ouNoBetReason = ouMissingActionableMarket
    ? "No real-book total price or market-implied probability available; not actionable until the odds refresh provides a priced total."
    : ouDivergenceStandDown
    ? "Stood down: projected total is on the opposite side of the line from the probability-driven pick, and the flip rule did not qualify (gap/line/odds). Mean/probability divergence hold."
    : ouChampionStandDownReason ?? explicitOuNoBetReason;
  const ouPublicSplitSupport = hasSupportingPublicMoneyConfirmation(signalsForGame, "total", finalOuPick);
  const ouMarketAwareCorrectedGrade = ouMarketSideCorrected
    ? resolveMlbMarketAwareCorrectedPlayGrade({
        market: "total",
        correctedOdds: finalOuOdds,
        reasons: ouMarketSideCorrection.applied === true ? ouMarketSideCorrection.reasons : [],
      })
    : null;
  const ouCleanConfirmedBestAngle = resolveTotalCleanConfirmedBestAngle({
    blocked: ouNoBet || ouFlipped || ouMarketFlipped || ouMarketSideCorrected,
    side: finalOuPick,
    projectedTotal: ouScoreSum,
    line: ouBetLine,
    modelProb: finalOuModelProb,
    edgePct: finalOuEdge,
    oddsAmerican: finalOuOdds,
    lineDirection: ouLineDirection,
    publicSplitSupport: ouPublicSplitSupport,
    publicSplitConflict: ouPublicSplitConflict,
  });
  const ouPromotedBestAngle = !ouFinalBestAngle && ouCleanConfirmedBestAngle.bestAngle;
  const trackedOuFinalBestAngle = ouChampionStandDownReason !== null
    || ouNoBet
    ? false
    : ouMarketAwareCorrectedGrade !== null
      ? ouMarketAwareCorrectedGrade.bestAngle
      : (ouFinalBestAngle || ouPromotedBestAngle);
  const ouValidatedLean = resolveTotalValidatedLean({
    blocked:
      trackedOuFinalBestAngle ||
      ouNoBet ||
      ouFlipped ||
      ouMarketFlipped ||
      ouMarketSideCorrected,
    side: finalOuPick,
    modelProb: finalOuModelProb,
    edgePct: finalOuEdge,
    oddsAmerican: finalOuOdds,
    sameSideProjectionGap: ouSameSideProjectionGap,
  });
  const ouUnvalidatedLeanCap =
    !trackedOuFinalBestAngle &&
    finalOuPublicPlayGrade === "lean" &&
    !ouValidatedLean.lean;
  const trackedOuPublicPlayGrade = ouMarketAwareCorrectedGrade !== null
    ? ouMarketAwareCorrectedGrade.playGrade
    : ouPromotedBestAngle
    ? "best_angle"
    : ouValidatedLean.lean
      ? "lean"
    : ouUnvalidatedLeanCap
      ? "market_aligned"
      : finalOuPublicPlayGrade;
  const ouUnvalidatedFlipPublicPlayGrade =
    !ouNoBet && (ouFlipped || ouMarketFlipped) ? "market_aligned" : null;
  return {
    game_prediction_id: pred.id,
    game_id: game.id,
    external_id: game.external_id,
    sport: "mlb",
    slate_date: slateDate,
    game_date: game.game_date,
    matchup: `${awayAbbrev}@${homeAbbrev}`,
    market: "total",
    pick: finalOuPick,
    side: finalOuPick,
    // LINE BASIS — track against the line the member actually bets.
    line_value: ouBetLine,
    odds_american: finalOuOdds,
    odds_decimal: null,
    model_used: readStringOrNull(sp.model_used),
    model_version: readStringOrNull(sp.model_version),
    prediction_source: pred.prediction_source,
    confidence: finalOuConfidence,
    model_probability: finalOuModelProb,
    market_probability: finalOuMarketProb,
    edge: finalOuEdge,
    expected_value: null,
    // Phase 6B.27 — same translator as ML; see readPublicPlayGrade. Mean-side
    // and market-opposed flipped rows do not inherit the original side's grade;
    // when playable, they are explicitly stored as market_aligned/Watchlist.
    play_grade: ouMissingActionableMarket
      ? null
      : ouMarketSideCorrected
      ? ouMarketAwareCorrectedGrade?.playGrade ?? "market_aligned"
      : ouUnvalidatedFlipPublicPlayGrade !== null
        ? ouUnvalidatedFlipPublicPlayGrade
      : ouChampionStandDownReason !== null
        ? null
        : trackedOuPublicPlayGrade,
    prediction_type: readStringOrNull(sp.ou_prediction_type),
    // Phase 6B.11 + MLB-P0 — same resolution as ML; see resolveMlbBestAngle.
    // A flipped or stood-down divergent row is never Best Angle.
    best_angle: trackedOuFinalBestAngle,
    no_bet: ouNoBet,
    no_bet_reason: ouNoBetReason,
    market_aligned: readBoolish(sp.ou_market_aligned),
    data_quality_tier: readStringOrNull(sp.v2_data_quality_tier),
    source_quality: null,
    provisional: readBoolish(sp.v2_provisional),
    held: false,
    hold_reason: null,
    launch_day: launchDay,
    manual_outcome_expected: launchDay,
    locked_at: pred.locked_at,
    published_at: game.slate_status === "published" ? pred.computed_at : null,
    /* Phase 6B.22 — additive context for calibration. */
    snapshot_json: {
      ...sp,
      model_layer_versions: buildMlbModelLayerVersions("total"),
      public_splits: buildPublicSplitsSnapshot(signalsForGame, "total", finalOuPick),
      line_movement: finalOuLineMovement,
      // MLB-P0 — audit trail for the Best Angle confirmation resolution.
      best_angle_resolution: {
        base_eligible: ouBaseBestAngleEligible,
        legacy_market_signal_grade_influence_enabled: legacyMarketSignalGradeInfluenceEnabled,
        requires_confirmation: readBoolish(v22.ou_requires_market_confirmation),
        line_direction: ouLineDirection,
        demote_reason: ouTotalBestAngleDemote
          ? finalOuPick === "over"
            ? "total_over_quality_gate"
            : "total_under_quality_gate"
          : ouBest.demoteReason,
        total_quality_gate: ouTotalBestAngleDemote,
        total_over_quality_gate: ouTotalBestAngleDemote && finalOuPick === "over",
        total_under_quality_gate: ouTotalBestAngleDemote && finalOuPick === "under",
        total_min_model_prob: totalBestAngleMinModelProb,
        total_under_min_model_prob: GATE_TOTAL_UNDER_BEST_ANGLE_MIN_MODEL_PROB,
        total_over_min_model_prob: GATE_TOTAL_OVER_BEST_ANGLE_MIN_MODEL_PROB,
        clean_confirmed_promotion: ouPromotedBestAngle,
        clean_confirmed_promotion_rule_id: ouPromotedBestAngle ? TOTAL_CLEAN_CONFIRMED_BEST_ANGLE_RULE_ID : null,
        final_best_angle: trackedOuFinalBestAngle,
      },
      market_aware_corrected_grade: ouMarketAwareCorrectedGrade,
      total_clean_confirmed_best_angle_promotion: ouPromotedBestAngle
        ? {
            rule_id: TOTAL_CLEAN_CONFIRMED_BEST_ANGLE_RULE_ID,
            action: "promote_to_best_angle",
            model_prob: finalOuModelProb,
            min_model_prob: TOTAL_BEST_ANGLE_MIN_MODEL_PROB,
            edge_pct: finalOuEdge,
            min_edge_pct: TOTAL_BEST_ANGLE_MIN_EDGE_PCT,
            projected_total: ouScoreSum,
            line: ouBetLine,
            abs_projection_gap: ouCleanConfirmedBestAngle.absProjectionGap,
            strong_projection_gap: ouCleanConfirmedBestAngle.strongProjection,
            medium_gap_confirmed: ouCleanConfirmedBestAngle.mediumGapConfirmed,
            line_direction: ouLineDirection,
            public_split_support: ouPublicSplitSupport,
            public_split_conflict: ouPublicSplitConflict,
            odds_american: finalOuOdds,
	            min_price_exclusive: TOTAL_BEST_ANGLE_MIN_PRICE_EXCLUSIVE,
	            validation_note:
	              "Historical MLB replay through 2026-07-10: strong-gap clean total promotion cohort was positive while medium-gap confirmed promotions were not retained.",
	          }
        : null,
      total_lean_projection_gap_cap: ouThinProjectionLeanCap
        ? {
            rule_id: TOTAL_PROJECTION_OPPOSED_LEAN_CAP_RULE_ID,
            action: "cap_to_watchlist",
            original_play_grade: ouPublicPlayGrade,
            final_play_grade: finalOuPublicPlayGrade,
            projected_total: ouScoreSum,
            line: ouBetLine,
            pick: finalOuPick,
            same_side_projection_gap: ouSameSideProjectionGap,
            validation_note:
              "Historical replay through 2026-07-10: total Leans need projection alignment for the Lean tier; smaller aligned gaps can remain Lean when probability, edge, and price qualify.",
          }
        : null,
      total_lean_market_friction_cap: ouThinEdgeMarketFrictionCap
        ? {
            rule_id: "total_lean_edge_lt_5_market_friction_cap",
            action: "cap_to_watchlist",
            original_play_grade: ouPublicPlayGrade,
            final_play_grade: finalOuPublicPlayGrade,
            edge_pct: finalOuEdge,
            max_edge_pct: GATE_TOTAL_LEAN_MARKET_FRICTION_MAX_EDGE_PCT,
            line_direction: ouLineDirection,
            public_split_conflict: ouPublicSplitConflict,
            reasons: [
              ouLineDirection === "against_pick" ? "line_movement_against_pick" : null,
              ouPublicSplitConflict ? "opposing_public_split_conflict" : null,
            ].filter((reason): reason is string => reason !== null),
            validation_note:
              "Historical same-day cohort through 2026-07-10: total Leans with edge < 5pp plus market friction replayed as a production cap candidate (+9.9547u delta across train/validation/holdout).",
          }
        : null,
      total_lean_recalibration_cap: ouUnvalidatedLeanCap
        ? {
            rule_id: "total_lean_unvalidated_actionability_cap_v1_2026_07_11",
            action: "cap_to_watchlist",
            original_play_grade: finalOuPublicPlayGrade,
            final_play_grade: trackedOuPublicPlayGrade,
            projected_total: ouScoreSum,
            line: ouBetLine,
            pick: finalOuPick,
            model_prob: finalOuModelProb,
            edge_pct: finalOuEdge,
            abs_projection_gap: ouProjectionGapAbs,
            validation_note:
              "Historical MLB grade replay 2026-06-11..2026-07-10: total Best Angles stayed positive, but the lower total Lean tier remained unstable, including a poor last-7-date split. Keep totals predictions and Best Angles; cap unvalidated total Leans to Watchlist until forward calibration earns them back.",
          }
        : null,
      total_validated_lean: ouValidatedLean.lean
        ? {
            rule_id: TOTAL_VALIDATED_LEAN_RULE_ID,
            action: "keep_as_lean",
            strength: ouValidatedLean.strength,
            model_prob: finalOuModelProb,
            min_model_prob: TOTAL_VALIDATED_LEAN_MIN_MODEL_PROB,
            edge_pct: finalOuEdge,
            min_edge_pct: TOTAL_VALIDATED_LEAN_MIN_EDGE_PCT,
            odds_american: finalOuOdds,
            min_price_exclusive: TOTAL_VALIDATED_LEAN_MIN_PRICE_EXCLUSIVE,
            projected_total: ouScoreSum,
            line: ouBetLine,
            same_side_projection_gap: ouSameSideProjectionGap,
            strong_min_model_prob: TOTAL_VALIDATED_STRONG_LEAN_MIN_MODEL_PROB,
            strong_min_projection_gap: TOTAL_VALIDATED_STRONG_LEAN_MIN_PROJECTION_GAP,
            validation_note:
              "Normalized MLB replay 2026-06-11..2026-07-10: non-Best-Angle totals with p>=54%, edge>=5pp, price>-145, and projection aligned went 47-35, +7.8662u, +9.59% ROI; stronger gap>=0.75 subset went 17-8, +6.6929u.",
          }
        : null,
      total_flip_public_grade_resolution: ouFlipped || ouMarketFlipped
        ? {
            rule_id: ouCorrectionRuleId,
            flip_kind: ouCorrectionKind,
            action: ouUnvalidatedFlipPublicPlayGrade !== null ? "store_as_watchlist" : "no_public_grade",
            public_play_grade: ouUnvalidatedFlipPublicPlayGrade,
            no_bet: ouNoBet,
            reason: ouNoBet
              ? ouNoBetReason
              : "Flipped totals are actionable only as market_aligned Watchlist unless a validated correction cohort promotes them.",
          }
        : null,
      champion_candidate_correction: ouChampionStandDownReason === null
        ? null
        : {
            market: "total",
            action: "stand_down",
            reasons: ["projected_total_contradicts_total_pick"],
            replay_policy: "champion_candidate_guardrails_2026_07_08",
            projected_total: ouScoreSum,
            line: ouBetLine,
            pick: finalOuPick,
          },
      data_integrity: buildDataIntegritySnapshot(sp, oddsForGame, "total"),
      // Phase 6B.28 — same rich-and-frozen substrate as ML.
      ...buildDailyEdgeLockSubstrate({ signalsForGame, currentLinesForGame, sourceAwareSplitsForGame, pred }),
      // Forward Fix A (2026-06-09) — audit trail for the writer's odds
      // source per (market, side). Same shape as the ML record's ML
      // variant; lets operators verify the lock used a real-book price.
      odds_source_at_lock_ou: oddsForGame
        ? { over: oddsForGame.oddsSourceOu.over, under: oddsForGame.oddsSourceOu.under }
        : null,
      // 2026-06-09 phantom-alt-line fix — audit trail for the locked
      // total LINE. Values come from
      // featureSnapshot.pickListedTotal via the model's
      // sp.v2_2_audit.market_total path. When absent on the model
      // snapshot (legacy v2_1 row, or unavailable), defaults below
      // surface honestly so operators can spot rows that locked
      // without verified corroboration.
      total_line_source_at_lock:
        typeof (v22 as Record<string, unknown>).total_line_source === "string"
          ? ((v22 as Record<string, unknown>).total_line_source as string)
          : "unknown",
      total_line_book_at_lock:
        typeof (v22 as Record<string, unknown>).total_line_book === "string" ||
        (v22 as Record<string, unknown>).total_line_book === null
          ? ((v22 as Record<string, unknown>).total_line_book as string | null)
          : null,
      total_line_agreement_count_at_lock:
        typeof (v22 as Record<string, unknown>).total_line_agreement_count === "number"
          ? ((v22 as Record<string, unknown>).total_line_agreement_count as number)
          : null,
      total_line_consensus_at_same_line_at_lock:
        typeof (v22 as Record<string, unknown>).total_line_consensus_at_same_line === "boolean"
          ? ((v22 as Record<string, unknown>).total_line_consensus_at_same_line as boolean)
          : null,
      market_aware_side_correction: ouMarketSideCorrection.applied === true
        ? {
            applied: true,
            rule_id: MLB_MARKET_AWARE_SIDE_CORRECTION_RULE_ID,
            market: "total",
            original_side: pred.predicted_ou_side,
            original_pick: pred.predicted_ou_side,
            original_odds: ouOddsAmerican,
            original_confidence: pred.ou_confidence,
            original_model_prob: ouModelProb,
            original_market_prob: ouMarketProb,
            original_line_direction: readLineDirection(ouLineMovement),
            original_public_split_support: initialOuPublicSplitSupport,
            original_public_split_conflict: initialOuPublicSplitConflict,
            corrected_side: finalOuPick,
            corrected_pick: finalOuPick,
            corrected_odds: finalOuOdds,
            corrected_model_prob: finalOuModelProb,
            corrected_market_prob: finalOuMarketProb,
            corrected_edge_pp: ouMarketSideCorrection.correctedEdgePp,
            raw_corrected_side_model_prob: ouMarketSideCorrection.rawCorrectedSideModelProb,
            raw_corrected_side_market_prob: ouMarketSideCorrection.rawCorrectedSideMarketProb,
            final_displayed_confidence: finalOuConfidence,
            reasons: ouMarketSideCorrection.reasons,
            public_play_grade: ouMarketAwareCorrectedGrade?.playGrade ?? "market_aligned",
            public_best_angle: ouMarketAwareCorrectedGrade?.bestAngle ?? false,
            public_grade_reason: ouMarketAwareCorrectedGrade?.reason ?? null,
            validation_note:
              "Historical MLB side-correction replay through 2026-07-10: totals split-signal rows improved when flipped before grading; corrected Best Angle promotion is limited to validated v3 plus-money cohorts.",
          }
        : null,
      // 2026-06-22 / 2026-07-11 — totals side-correction audit. Present only
      // when a correction fired; preserves the original probability side so the
      // override is fully reversible. The model's projected total and raw
      // probability are untouched.
      ou_flip: ouFlipped || ouMarketFlipped || ouMarketSideCorrected
        ? {
            flipped: true,
            rule_id: ouCorrectionRuleId,
            flip_kind: ouCorrectionKind,
            original_probability_side: pred.predicted_ou_side,
            original_pick: pred.predicted_ou_side,
            original_confidence: pred.ou_confidence,
            original_model_prob: ouModelProb,
            original_odds: ouOddsAmerican,
            // Bet-line basis: projected_total is the displayed score sum and
            // `line` is the member's bet line — the pair the flip resolved on.
            // market_total preserved alongside for audit when they differ.
            projected_total: ouScoreSum,
            line: ouBetLine,
            market_total_internal: typeof v22.market_total === "number" ? (v22.market_total as number) : null,
            posterior_total_internal: typeof v22.posterior_total === "number" ? (v22.posterior_total as number) : null,
            mean_side: ouFlipped ? ouFlip.meanSide : null,
            mean_gap: ouFlipped ? ouFlip.meanGap : null,
            market_opposed_side: ouMarketFlipped ? ouMarketFlip.flippedSide : null,
            market_opposed_max_model_prob: ouMarketFlipped ? ouMarketFlip.maxModelProb : null,
            opposing_public_split_conflict: ouMarketFlipped ? initialOuPublicSplitConflict : null,
            market_aware_side_correction: ouMarketSideCorrected,
            market_aware_reasons: ouMarketSideCorrection.applied === true ? ouMarketSideCorrection.reasons : null,
            flipped_pick: finalOuPick,
            flipped_odds: finalOuOdds,
            // Raw corrected-side probability — AUDIT ONLY, never shown to members.
            flipped_side_model_prob: ouCorrectedSideModelProb,
            flipped_side_market_prob: ouCorrectedSideMarketProb,
            flipped_side_edge_pp: ouCorrectedSideEdgePp,
            final_displayed_confidence: finalOuConfidence,
            reason: ouFlipped
              ? "projected mean/probability divergence, mean-side selector"
              : ouMarketFlipped
                ? "market opposed weak total with opposing public split conflict"
                : "market-aware total split signal fade",
          }
        : null,
    },
  };
}

function buildFiRecord(
  pred: PredictionRow,
  game: GameRow,
  homeAbbrev: string,
  awayAbbrev: string,
  slateDate: string,
  launchDay: boolean,
  currentLines: ReadonlyArray<LineRowForOdds>,
  historyByKey: ReadonlyMap<string, ReadonlyArray<LineHistoryRowForOdds>>,
  freshnessReferenceMs: number = Date.now(),
): PredictionRecordRow | null {
  const sp = (pred.sport_specific ?? {}) as Record<string, unknown>;
  const holdPicks = Array.isArray(sp.hold_picks) ? (sp.hold_picks as string[]) : [];
  const held = holdPicks.includes("nrfi") || pred.predicted_nrfi === null;
  if (held) return null;
  const freshAudit = fiAuditFreshDataReady(sp);
  if (!freshAudit.ready) return null;

  // Phase 6B.20 — preserve the member-facing FI pill. Daily Edge
  // (`app/api/lab/daily-edge/route.ts:584-597`) displays "Toss-Up"
  // when sport_specific.nrfi_decision_kind === "toss_up", regardless
  // of the internal NRFI/YRFI lean. Tracking must use the same
  // member-facing pill — never the hidden lean — or the public W/L
  // tally will count picks members never saw as actionable.
  //
  // Detection mirrors the route's logic exactly:
  //   1. nrfi_decision_kind === "toss_up" (canonical post-4D.1 field)
  //   2. heuristic fallback for pre-4D.1 rows: nrfi_confidence rounds
  //      to 52 AND nrfi_expected_runs in [0.85, 1.15)
  //
  // Internal lean (sp.predicted_nrfi) is preserved in snapshot_json
  // for calibration analysis. Only the displayed-pill columns flip.
  const nrfiDecisionKind =
    typeof sp.nrfi_decision_kind === "string"
      ? (sp.nrfi_decision_kind as string)
      : null;
  const fiAudit = sp.fi_v2_audit && typeof sp.fi_v2_audit === "object"
    ? sp.fi_v2_audit as Record<string, unknown>
    : null;
  const fiWriterPlayGradeRaw = readStringOrNull(fiAudit?.fi_play_grade);
  const fiWriterPlayGrade =
    fiWriterPlayGradeRaw === "best_angle" ||
    fiWriterPlayGradeRaw === "lean" ||
    fiWriterPlayGradeRaw === "toss_up" ||
    fiWriterPlayGradeRaw === "no_bet" ||
    fiWriterPlayGradeRaw === "held"
      ? fiWriterPlayGradeRaw
      : null;
  const autoFactors =
    sp.auto_factors && typeof sp.auto_factors === "object"
      ? (sp.auto_factors as Record<string, unknown>)
      : null;
  const nrfiExpectedRuns =
    autoFactors && typeof autoFactors.nrfi_expected_runs === "number"
      ? (autoFactors.nrfi_expected_runs as number)
      : null;
  const isTossUp =
    fiWriterPlayGrade === "toss_up" ||
    nrfiDecisionKind === "toss_up" ||
    (nrfiDecisionKind === null &&
      typeof pred.nrfi_confidence === "number" &&
      Math.round(pred.nrfi_confidence) === 52 &&
      nrfiExpectedRuns !== null &&
      nrfiExpectedRuns >= 0.85 &&
      nrfiExpectedRuns < 1.15);

  const internalSide: "under" | "over" =
    pred.predicted_nrfi === true ? "under" : "over";
  const actionablePick = pred.predicted_nrfi === true ? "NRFI" : "YRFI";

  const pickLabel = isTossUp ? "Toss-Up" : actionablePick;
  const sideValue = isTossUp ? null : internalSide;
  const predictionTypeValue = isTossUp ? "toss_up" : null;

  // FI fresh-data-only policy: first-inning plays require current two-sided
  // first_inning_total prices. Unlike ML/totals, FI does not use line_history
  // fallback for actionable tracking because stale FI prices can create a play
  // users should never have seen.
  const fiPicked = sideValue === null
    ? null
    : pickFreshOnlyOdds(currentLines, game.id, "first_inning_total", internalSide, freshnessReferenceMs);
  const fiOpposite = sideValue === null
    ? null
    : pickFreshOnlyOdds(currentLines, game.id, "first_inning_total", internalSide === "under" ? "over" : "under", freshnessReferenceMs);
  if (sideValue !== null && (fiPicked?.source !== "lines" || fiOpposite?.source !== "lines")) {
    return null;
  }
  const fiOddsAmerican = fiPicked?.odds ?? null;
  // De-vig market probability for the picked side when both sides priced.
  const impPicked = americanToImpliedProb(fiPicked?.odds ?? null);
  const impOpp = americanToImpliedProb(fiOpposite?.odds ?? null);
  const fiMarketProb =
    impPicked !== null && impOpp !== null && impPicked + impOpp > 0
      ? impPicked / (impPicked + impOpp)
      : null;
  const fiModelProb = pred.nrfi_confidence !== null ? pred.nrfi_confidence / 100 : null;
  const fiEdge = fiModelProb !== null && fiMarketProb !== null ? fiModelProb - fiMarketProb : null;
  const fiWriterNoBetReason = readStringOrNull(fiAudit?.fi_no_bet_reason);
  const noBetValue = isTossUp;
  const noBetReasonValue = isTossUp
    ? "non-actionable: locked pill was Toss-Up"
    : null;

  // FI V2 is the source of truth for first-inning actionability. Persist the
  // exact writer grade users see on Daily Edge: Best Angle, Lean, Toss-Up,
  // no-bet, and held must not be recreated from a confidence-only ladder.
  const fiWriterNoBet =
    fiWriterPlayGrade === "no_bet" ||
    fiWriterPlayGrade === "held";
  const fiPlayGrade: string | null =
    fiWriterPlayGrade ??
    (isTossUp ? "toss_up" : null);

  // Legacy-only FI inversion fallback. FI V2 audit grades are authoritative;
  // do not let an older post-model flip override the current FI model's
  // audited actionability decision.
  const fiNrfiProbability =
    autoFactors && typeof autoFactors.nrfi_probability === "number"
      ? (autoFactors.nrfi_probability as number)
      : null;
  const fiFlip = fiAudit !== null
    ? { flipped: false as const, reason: "fi_v2_audit_grade_authoritative" }
    : resolveFiInversionFlip({
        predictedSide: isTossUp ? "tossup" : pred.predicted_nrfi === true ? "nrfi" : "yrfi",
        nrfiProbability: fiNrfiProbability,
        originalConfidence: pred.nrfi_confidence,
        nrfiMarketProb: fiMarketProb,
        yrfiOdds: fiOpposite?.odds ?? null,
      });
  const fiFlipped = fiFlip.flipped === true;
  const fiChampionStandDown = fiFlipped;
  const finalFiPick = fiChampionStandDown ? "Toss-Up" : pickLabel;
  const finalFiSide = fiChampionStandDown ? null : sideValue;
  const finalFiOdds = fiChampionStandDown ? null : fiOddsAmerican;
  const finalFiConfidence = fiChampionStandDown ? null : pred.nrfi_confidence;
  const finalFiModelProb = fiChampionStandDown ? null : fiModelProb;
  const finalFiMarketProb = fiChampionStandDown ? null : fiMarketProb;
  const finalFiEdge = fiChampionStandDown ? null : fiEdge;
  const baseFiNoBet = noBetValue || fiWriterNoBet || fiChampionStandDown;
  const baseFiNoBetReason = fiChampionStandDown
    ? "champion_candidate_fi_flip_stand_down: FI flip cohort replayed flat; no actionable FI."
    : noBetReasonValue ??
      fiWriterNoBetReason ??
      (fiWriterPlayGrade === "held"
        ? "Held — data quality insufficient."
        : fiWriterPlayGrade === "no_bet"
          ? "Edge too thin; no bet."
          : null);
  const fiFinalGrade = resolveFiFinalGrade({
    basePlayGrade: fiChampionStandDown ? null : fiPlayGrade,
    baseNoBet: baseFiNoBet,
    baseNoBetReason: baseFiNoBetReason,
    edge: finalFiEdge,
    oddsAmerican: finalFiOdds,
    confidence: finalFiConfidence,
  });
  const finalFiNoBet = fiFinalGrade.noBet;
  const finalFiNoBetReason = fiFinalGrade.noBetReason;
  const finalFiPlayGrade = fiFinalGrade.playGrade;
  const finalFiBestAngle = fiFinalGrade.bestAngle;

  return {
    game_prediction_id: pred.id,
    game_id: game.id,
    external_id: game.external_id,
    sport: "mlb",
    slate_date: slateDate,
    game_date: game.game_date,
    matchup: `${awayAbbrev}@${homeAbbrev}`,
    market: "first_inning",
    pick: finalFiPick,
    side: finalFiSide,
    line_value: 0.5,
    odds_american: finalFiOdds,
    odds_decimal: null,
    model_used: readStringOrNull(sp.model_used),
    model_version: readStringOrNull(sp.model_version),
    prediction_source: pred.prediction_source,
    confidence: finalFiConfidence,
    model_probability: finalFiModelProb,
    market_probability: finalFiMarketProb,
    edge: finalFiEdge,
    expected_value: null,
    // Flipped rows carry no model grade (the override isn't a model call).
    play_grade: finalFiPlayGrade,
    prediction_type: fiChampionStandDown ? "toss_up" : fiFlipped ? null : predictionTypeValue,
    best_angle: finalFiBestAngle,
    no_bet: finalFiNoBet,
    no_bet_reason: finalFiNoBetReason,
    market_aligned: false,
    data_quality_tier: readStringOrNull(sp.v2_data_quality_tier),
    source_quality: null,
    provisional: readBoolish(sp.v2_provisional),
    held: false,
    hold_reason: null,
    launch_day: launchDay,
    manual_outcome_expected: launchDay,
    locked_at: pred.locked_at,
    published_at: game.slate_status === "published" ? pred.computed_at : null,
    /* Phase 6B.22 — additive context. Public splits + line movement
       aren't captured for FI markets today (sharp_signals scopes to
       ML/OU/spread). data_integrity + odds_source_at_lock_fi are still
       meaningful. Surface unavailable signals as null so calibration reports
       "unknown" rather than absent. */
    snapshot_json: {
      ...sp,
      model_layer_versions: buildMlbModelLayerVersions("first_inning"),
      public_splits: null,
      line_movement: null,
      data_integrity: buildDataIntegritySnapshot(sp, null, "first_inning"),
      // Phase 6B.28 — substrate. signal_rows_at_lock + lines_at_lock are
      // empty for FI (sharp_signals/lines for first_inning_total not
      // loaded in this build). predicted_scores + framework_grades for
      // NRFI/YRFI are still captured.
      ...buildDailyEdgeLockSubstrate({ signalsForGame: [], currentLinesForGame: [], pred }),
      odds_source_at_lock_fi: sideValue === null
        ? null
        : {
            picked: fiPicked,
            opposite: fiOpposite,
          },
      fi_final_grade_resolution: fiFinalGrade.audit,
      champion_candidate_correction: fiChampionStandDown
        ? {
            market: "first_inning",
            action: "stand_down",
            reasons: ["fi_flip_replayed_flat"],
            replay_policy: "champion_candidate_guardrails_2026_07_08",
            proposed_flip_pick: "YRFI",
            original_pick: pickLabel,
          }
        : null,
      // 2026-06-22 — FI NRFI overconfident mid-band flip audit. Present only when
      // the flip fired; preserves the original NRFI side so the override is fully
      // reversible. The model's NRFI opinion + probability are untouched.
      fi_flip: fiFlipped
        ? {
            flipped: true,
            rule_id: FI_INVERSION_RULE_ID,
            original_pick: pickLabel,
            original_side: internalSide,
            original_confidence: pred.nrfi_confidence,
            original_nrfi_probability: fiNrfiProbability,
            original_odds: fiOddsAmerican,
            flipped_pick: "YRFI",
            flipped_odds: fiFlip.flipped ? fiFlip.flippedOdds : null,
            // Raw YRFI-side probability — AUDIT ONLY, never shown to members.
            flipped_side_model_prob: fiFlip.flipped ? fiFlip.flippedSideModelProb : null,
            flipped_side_edge_pp: fiFlip.flipped ? fiFlip.flippedEdgePp : null,
            final_displayed_confidence: fiChampionStandDown ? null : finalFiConfidence,
            stood_down: fiChampionStandDown,
            reason: "NRFI overconfident mid-band [0.57,0.63), conservative YRFI flip",
          }
        : null,
    },
  };
}

/**
 * Build the list of prediction_records for the slate.
 *
 * Pure function — no DB writes. Caller dispatches to insert in apply mode.
 */
export function buildPredictionRecordsFromSlate(args: {
  sport: TrackedSport;
  slateDate: string;
  launchDay: boolean;
  games: ReadonlyArray<GameRow>;
  predictionByGameId: ReadonlyMap<number, PredictionRow>;
  abbrevByTeamId: ReadonlyMap<number, string>;
  /**
   * Phase 6B.11 — per-game sharp_signals subset, used to apply the
   * public-money conflict guard on best_angle. Empty map / missing
   * key = no guard fires (defaults to V2.2 audit's raw eligibility).
   */
  signalsByGameId?: ReadonlyMap<number, ReadonlyArray<PublicSplitsRow>>;
  /**
   * Phase 6B.18 — per-game pregame odds snapshot. Threaded through
   * buildMl/OuRecord so the locked snapshot carries the picked-side
   * price. Empty map / missing key = odds captured as null (Daily
   * Edge will fall back to live `lines` for unlocked games as before,
   * and "price unavailable" for locked games — no fake values).
   */
  oddsByGameId?: ReadonlyMap<number, GameOddsSnapshot>;
  /**
   * Phase 6B.22 — per-game opener prices from line_history (is_opener=true).
   * Used to compute snapshot_json.line_movement. Empty map = no movement
   * captured; the snapshot just records open as null with
   * direction="unknown".
   */
  openersByGameId?: ReadonlyMap<number, ReadonlyArray<LineHistoryOpenerRow>>;
  /**
   * Phase 6B.22 — per-game lock-time line rows (same shape we already
   * use for buildGameOddsSnapshot). Threaded through so the line-movement
   * helper can read total line drift + per-side current odds.
   */
  currentLinesByGameId?: ReadonlyMap<number, ReadonlyArray<LineRowForOdds>>;
  /**
   * Lock-time source-aware split observations used by the rendered reader:
   * Consensus Splits plus Sharp Book Splits/Signal. Stored raw so post-lock
   * cards can render the same split package that existed at lock.
   */
  sourceAwareSplitsByGameId?: ReadonlyMap<number, ReadonlyArray<SourceAwareSplitObservationRow>>;
  /**
   * Forward odds recovery for FI/NRFI/YRFI. Same key shape used by
   * pickOddsWithFallback: `${gameId}::${market_type}::${side}`.
   */
  historyByKey?: ReadonlyMap<string, ReadonlyArray<LineHistoryRowForOdds>>;
}): PredictionRecordRow[] {
  const proposed: PredictionRecordRow[] = [];
  for (const g of args.games) {
    const pred = args.predictionByGameId.get(g.id);
    if (!pred) continue;
    const home = args.abbrevByTeamId.get(g.home_team_id) ?? "?";
    const away = args.abbrevByTeamId.get(g.away_team_id) ?? "?";
    const sigs = (args.signalsByGameId?.get(g.id) ?? []) as PublicSplitsRow[];
    const odds = args.oddsByGameId?.get(g.id) ?? null;
    const openers = (args.openersByGameId?.get(g.id) ?? []) as LineHistoryOpenerRow[];
    const currentLines = (args.currentLinesByGameId?.get(g.id) ?? []) as LineRowForOdds[];
    const sourceAwareSplits = (args.sourceAwareSplitsByGameId?.get(g.id) ?? []) as SourceAwareSplitObservationRow[];
    const freshnessReferenceMs = freshnessReferenceMsForGame(g, args.slateDate);
    const ml = buildMlRecord(pred, g, home, away, args.slateDate, args.launchDay, sigs, odds, openers, currentLines, sourceAwareSplits);
    const ou = buildOuRecord(pred, g, home, away, args.slateDate, args.launchDay, sigs, odds, openers, currentLines, sourceAwareSplits);
    const fi = buildFiRecord(
      pred,
      g,
      home,
      away,
      args.slateDate,
      args.launchDay,
      currentLines,
      args.historyByKey ?? new Map<string, ReadonlyArray<LineHistoryRowForOdds>>(),
      freshnessReferenceMs,
    );
    if (ml) proposed.push(withMemberFacingAtLock(ml));
    if (ou) proposed.push(withMemberFacingAtLock(ou));
    if (fi) proposed.push(withMemberFacingAtLock(fi));
  }
  return proposed;
}

/**
 * Full create flow with DB I/O. Idempotent via the unique key.
 */
export async function createPredictionRecords(
  opts: CreateRecordsOptions,
): Promise<CreateRecordsResult> {
  const { sport, slateDate, launchDay, apply, supabase } = opts;
  const preserveExistingUnlocked = opts.preserveExistingUnlocked === true;
  const result: CreateRecordsResult = {
    scanned: 0,
    proposed: [],
    insertedCount: 0,
    skippedExisting: 0,
    skippedHeld: 0,
    errors: [],
    tablesInitialized: true,
  };

  // Load slate
  const { data: gameRows, error: gErr } = await supabase
    .from("games")
    .select("id, external_id, game_date, slate_status, home_team_id, away_team_id")
    .eq("sport", sport)
    .eq("slate_date", slateDate);
  if (gErr) {
    result.errors.push({ game_id: 0, market: "moneyline", reason: `games fetch failed: ${gErr.message}` });
    return result;
  }
  const games = (gameRows ?? []) as GameRow[];
  result.scanned = games.length;

  if (games.length === 0) return result;
  const gameIds = games.map((g) => g.id);

  // Load predictions
  // Phase 6B.28 — also pull predicted_*_score + V2.1 framework grades so the
  // lock substrate can carry them. Frozen at lock, surfaced by the route
  // for post-start cards.
  const { data: predRows } = await supabase
    .from("game_predictions")
    .select("id, game_id, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence, prediction_source, is_override, locked_at, computed_at, sport_specific, predicted_home_score, predicted_away_score, ml_grade, ou_grade, nrfi_grade, ml_signal_type, ou_signal_type, nrfi_signal_type, ml_market_signal, ou_market_signal, nrfi_market_signal")
    .in("game_id", gameIds);
  const preds = ((predRows ?? []) as PredictionRow[]);
  const predictionByGameId = new Map<number, PredictionRow>(
    preds.map((p) => [p.game_id, p]),
  );

  // Load team abbreviations
  const teamIds = Array.from(
    new Set([...games.map((g) => g.home_team_id), ...games.map((g) => g.away_team_id)]),
  );
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", teamIds);
  const abbrevByTeamId = new Map<number, string>(
    ((teamRows ?? []) as Array<{ id: number; abbreviation: string }>).map((t) => [t.id, t.abbreviation]),
  );

  // Phase 6B.11 / 6B.22 — load per-game sharp_signals. Pre-6B.22 we read
  // only the public-money columns used by the best_angle conflict guard;
  // 6B.22 also pulls the steam / RLM / strength / fetched-at fields so
  // snapshot_json.line_movement can carry sharp-money signals at lock
  // time for calibration. Missing signals = guard stays off and the
  // additive snapshot fields are null (no false defaults).
  // Phase 6B.28 — also pull the Daily Edge route's full SignalRow
  // shape (pinnacle_fair_probability, is_plus_ev, ev_pct, steam_detected_at,
  // steam_books_count) so the lock substrate can rehydrate it 1:1.
  const { data: signalRows } = await supabase
    .from("sharp_signals")
    .select(
      "game_id, market_type, side, public_money_pct, public_betting_pct, has_steam_move, has_reverse_line_movement, rlm_direction, signal_strength, computed_at, pinnacle_fair_probability, is_plus_ev, ev_pct, steam_detected_at, steam_books_count",
    )
    .in("game_id", gameIds);
  const signalsByGameId = new Map<number, PublicSplitsRow[]>();
  for (const s of (signalRows ?? []) as Array<{ game_id: number } & PublicSplitsRow>) {
    const list = signalsByGameId.get(s.game_id) ?? [];
    list.push({
      market_type: s.market_type,
      side: s.side,
      public_money_pct: s.public_money_pct,
      public_betting_pct: s.public_betting_pct,
      has_steam_move: s.has_steam_move,
      has_reverse_line_movement: s.has_reverse_line_movement,
      rlm_direction: s.rlm_direction,
      signal_strength: s.signal_strength,
      computed_at: s.computed_at,
      pinnacle_fair_probability: s.pinnacle_fair_probability,
      is_plus_ev: s.is_plus_ev,
      ev_pct: s.ev_pct,
      steam_detected_at: s.steam_detected_at,
      steam_books_count: s.steam_books_count,
    });
    signalsByGameId.set(s.game_id, list);
  }

  // Phase 6B.18 — load picked-side odds for ML + OU markets so the
  // snapshot captures the pregame price. Daily Edge can then render
  // the locked snapshot's odds_american directly after lock instead
  // of falling back to the live `lines` table.
  // Phase 6B.22 — also load `line_value` so the line-movement helper
  // can surface total-line drift (e.g., 8.5 → 9.0).
  // Phase 6B.28 — pull fetched_at so the lock substrate's LineRow shape
  // matches the Daily Edge route's LineRow shape exactly.
  const { data: lineRowsForOdds } = await supabase
    .from("lines")
    .select("game_id, market_type, side, sportsbook, odds_american, line_value, fetched_at")
    .in("game_id", gameIds)
    // 2026-06-15: include first_inning_total so the FI record can thread its
    // real lock price (was excluded → FI odds_american hardcoded null).
    .in("market_type", ["moneyline", "total", "first_inning_total"])
    .is("player_id", null);
  const linesByGame = new Map<number, LineRowForOdds[]>();
  for (const l of ((lineRowsForOdds ?? []) as LineRowForOdds[])) {
    const arr = linesByGame.get(l.game_id) ?? [];
    arr.push(l);
    linesByGame.set(l.game_id, arr);
  }

  // Forward Fix A (2026-06-09 lock-contract fix) — load `line_history`
  // real-book rows for these games so `buildGameOddsSnapshot` can fall
  // back when the current `lines` table is thin. Restricted to the last
  // 24 hours by `recorded_at >= now() - 24h` to keep the query small;
  // older history is irrelevant for tonight's slate. `splits_consensus`
  // is excluded at the helper level (not here) so we keep the option
  // to expose those rows if we ever need them for diagnostics.
  // 2026-06-16 P0 — PER-GAME parallel reads. A multi-game `.in(game_id) + ORDER
  // BY` degenerates on the bloated line_history table (322k rows) and blows past
  // the statement_timeout, which inflated the slate-cycle cron past its 300s
  // maxDuration → killed → stuck "in_progress" → stale data. Per-game
  // `.eq(game_id) + ORDER + LIMIT` uses the game_id index and is bounded.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const lineHistoryResults = await Promise.all(
    gameIds.map((gid) =>
      supabase
        .from("line_history")
        .select("game_id, market_type, side, sportsbook, odds_american, line_value, recorded_at")
        .eq("game_id", gid)
        .in("market_type", ["moneyline", "total", "first_inning_total"])
        .is("player_id", null)
        .neq("sportsbook", "splits_consensus")
        .not("odds_american", "is", null)
        .gte("recorded_at", oneDayAgo)
        .order("recorded_at", { ascending: false })
        .limit(800)
        .then((r) => (r.data ?? []) as LineHistoryRowForOdds[], () => [] as LineHistoryRowForOdds[]),
    ),
  );
  const lineHistoryRows = lineHistoryResults.flat();
  // Pre-bucket by (game_id, market_type, side). Each bucket is already
  // sorted by recorded_at DESC because of the query order above —
  // `pickOddsWithFallback` reads `history[0]` for the most-recent batch.
  const historyByKey = new Map<string, LineHistoryRowForOdds[]>();
  for (const r of ((lineHistoryRows ?? []) as LineHistoryRowForOdds[])) {
    const key = `${r.game_id}::${r.market_type}::${r.side ?? "null"}`;
    const arr = historyByKey.get(key) ?? [];
    arr.push(r);
    historyByKey.set(key, arr);
  }

  const oddsByGameId = new Map<number, GameOddsSnapshot>();
  // Build a snapshot for every game in the slate, even when `lines` is
  // empty for that game — the history fallback may still recover a price.
  const gameById = new Map(games.map((g) => [g.id, g]));
  for (const gameId of gameIds) {
    const lines = linesByGame.get(gameId) ?? [];
    const gameForFreshness = gameById.get(gameId);
    oddsByGameId.set(
      gameId,
      buildGameOddsSnapshot(lines, {
        historyByKey,
        gameId,
        freshnessReferenceMs: gameForFreshness
          ? freshnessReferenceMsForGame(gameForFreshness, slateDate)
          : Date.now(),
      }),
    );
  }

  // Phase 6B.22 — load opener prices from line_history (is_opener=true)
  // so the line-movement helper can compute direction vs the picked side.
  // Missing openers = direction reported as "unknown".
  //
  // Phase 6B.32 (2026-06-11) — Fallback path. The lines-refresh writers
  // hardcode `is_opener: false` on every history insert (see
  // linesService.ts / refreshNbaLinesService.ts / refreshNhlLinesService.ts),
  // so the is_opener=true query returns 0 rows in production. To restore
  // the line-movement section on cards without waiting on Phase B, treat
  // the OLDEST line_history row per (game_id, market_type, side,
  // sportsbook) as the de-facto opener when no flagged row exists. The
  // is_opener=true path stays primary so the future fix doesn't change
  // behavior on backfilled openers.
  const { data: flaggedOpenerRows } = await supabase
    .from("line_history")
    .select("game_id, market_type, side, sportsbook, odds_american, line_value, recorded_at")
    .eq("is_opener", true)
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total"])
    .is("player_id", null);
  const flagged = (flaggedOpenerRows ?? []) as LineHistoryOpenerRow[];

  // Build the (game, market, side, book) keys that already have a flagged
  // opener; anything else needs a fallback.
  const flaggedKeys = new Set<string>();
  for (const o of flagged) {
    flaggedKeys.add(`${o.game_id}|${o.market_type}|${o.side}|${o.sportsbook}`);
  }

  // 2026-06-16 P0 — PER-GAME parallel (see note above). Only the OLDEST rows are
  // needed (a fallback opener is the first recorded per key), so LIMIT is safe.
  const allHistoryResults = await Promise.all(
    gameIds.map((gid) =>
      supabase
        .from("line_history")
        .select("game_id, market_type, side, sportsbook, odds_american, line_value, recorded_at")
        .eq("game_id", gid)
        .in("market_type", ["moneyline", "total"])
        .is("player_id", null)
        .order("recorded_at", { ascending: true })
        .limit(400)
        .then((r) => (r.data ?? []) as LineHistoryOpenerRow[], () => [] as LineHistoryOpenerRow[]),
    ),
  );
  const allHistory = allHistoryResults.flat();
  const fallbackByKey = new Map<string, LineHistoryOpenerRow>();
  for (const r of (allHistory ?? []) as LineHistoryOpenerRow[]) {
    const k = `${r.game_id}|${r.market_type}|${r.side}|${r.sportsbook}`;
    if (flaggedKeys.has(k)) continue;
    if (!fallbackByKey.has(k)) fallbackByKey.set(k, r); // ASC order → first seen IS oldest
  }

  const openerRows: LineHistoryOpenerRow[] = [...flagged, ...fallbackByKey.values()];

  const openersByGameId = new Map<number, LineHistoryOpenerRow[]>();
  for (const o of openerRows) {
    const arr = openersByGameId.get(o.game_id) ?? [];
    arr.push(o);
    openersByGameId.set(o.game_id, arr);
  }

  // 2026-06-30 — lock the exact source-aware split package the Daily Edge
  // reader shows pregame. `sharp_signals` is the older source; the modern
  // reader renders Consensus Splits + Sharp Book Splits from
  // market_split_observations_v2. Without freezing these rows, locked cards
  // can lose Sharp Book context after providers rotate/expire live data.
  const sourceAwareSplitsByGameId = new Map<number, SourceAwareSplitObservationRow[]>();
  if (sport === "mlb") {
    const externalIdToGameId = new Map<string, number>(
      games.map((g) => [String(g.external_id), g.id]),
    );
    const eventIds = Array.from(externalIdToGameId.keys());
    const sourceAwareResults = await Promise.all(
      eventIds.map((eventId) =>
        supabase
          .from("market_split_observations_v2")
          .select("canonical_event_id, market_type, selection_key, provider, source_book, source_type, bets_pct, money_pct, source_observed_at, fetched_at")
          .eq("league", "mlb")
          .eq("canonical_event_id", eventId)
          .in("market_type", ["moneyline", "total"])
          .order("fetched_at", { ascending: false })
          .limit(500),
      ),
    );
    for (const sourceAwareResult of sourceAwareResults) {
      if (sourceAwareResult.error) {
        result.errors.push({
          game_id: 0,
          market: "moneyline",
          reason: `source-aware split lock fetch failed: ${sourceAwareResult.error.message}`,
        });
        continue;
      }
      const compactRows = compactSourceAwareRowsForLock(
        (sourceAwareResult.data ?? []) as SourceAwareSplitObservationRow[],
      );
      for (const row of compactRows) {
        const gameId = externalIdToGameId.get(String(row.canonical_event_id));
        if (gameId === undefined) continue;
        const list = sourceAwareSplitsByGameId.get(gameId) ?? [];
        list.push(row);
        sourceAwareSplitsByGameId.set(gameId, list);
      }
    }
  }

  const proposed = buildPredictionRecordsFromSlate({
    sport,
    slateDate,
    launchDay,
    games,
    predictionByGameId,
    abbrevByTeamId,
    signalsByGameId,
    oddsByGameId,
    openersByGameId,
    currentLinesByGameId: linesByGame,
    sourceAwareSplitsByGameId,
    historyByKey,
  });
  result.proposed = proposed;
  result.skippedHeld =
    games.length * 3 -
    proposed.length -
    games.filter((g) => !predictionByGameId.has(g.id)).length * 3;

  if (!apply) return result;

  // Probe table existence with a HEAD-style query
  const { error: probeErr } = await supabase
    .from("prediction_records")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  if (probeErr && /relation .* does not exist|could not find the table/i.test(probeErr.message)) {
    result.tablesInitialized = false;
    return result;
  }

  // Phase 6B.12 — locked-row-aware upsert. We must update existing
  // unlocked rows so tracking stays in sync with intraday game_predictions
  // refreshes, but we must NEVER overwrite a row that already has
  // locked_at != null (pregame-sweep / lock-on-write owns that
  // transition; pick + line + confidence must freeze at lock). Load
  // existing lock state per (game_id, market, model_version, slate_date)
  // first, then skip the upsert for any locked match.
  const { data: existingLocks } = await supabase
    .from("prediction_records")
    .select("id, game_id, market, model_version, slate_date, locked_at")
    .in("game_id", proposed.map((r) => r.game_id))
    .eq("slate_date", slateDate);
  const lockedKeys = new Set<string>();
  const existingKeys = new Set<string>();
  const proposedKeys = new Set(
    proposed.map((r) =>
      `${r.game_id}::${r.market}::${r.model_version ?? ""}::${r.slate_date}`,
    ),
  );
  for (const r of (existingLocks ?? []) as Array<{
    id: number;
    game_id: number;
    market: string;
    model_version: string | null;
    slate_date: string;
    locked_at: string | null;
  }>) {
    existingKeys.add(
      `${r.game_id}::${r.market}::${r.model_version ?? ""}::${r.slate_date}`,
    );
    if (r.locked_at !== null) {
      lockedKeys.add(
        `${r.game_id}::${r.market}::${r.model_version ?? ""}::${r.slate_date}`,
      );
    }
  }

  // FI fresh-data-only guardrail: when the current model no longer proposes an
  // FI row (fresh data missing, stale price, unconfirmed lineup, etc.),
  // neutralize any previous unlocked FI row for the same slate/game. Otherwise
  // an older NRFI/YRFI prediction can remain visible even though the fresh-data
  // gate is correctly refusing to create a new actionable FI row. We update
  // instead of deleting because some rows may already have prediction_grades
  // children; locked rows are never touched.
  const staleUnlockedFiIds = preserveExistingUnlocked ? [] : ((existingLocks ?? []) as Array<{
    id: number;
    game_id: number;
    market: string;
    model_version: string | null;
    slate_date: string;
    locked_at: string | null;
  }>)
    .filter((r) =>
      r.locked_at === null &&
      r.market === "first_inning" &&
      !proposedKeys.has(`${r.game_id}::${r.market}::${r.model_version ?? ""}::${r.slate_date}`),
    )
    .map((r) => r.id);
  if (staleUnlockedFiIds.length > 0) {
    const { error: neutralizeErr } = await supabase
      .from("prediction_records")
      .update({
        pick: "Toss-Up",
        side: null,
        play_grade: "held",
        best_angle: false,
        no_bet: true,
        no_bet_reason: "fi_fresh_data_gate_no_current_actionable_prediction",
        prediction_type: "toss_up",
        held: true,
        hold_reason: "fi_fresh_data_gate_no_current_actionable_prediction",
      })
      .in("id", staleUnlockedFiIds);
    if (neutralizeErr) {
      result.errors.push({
        game_id: 0,
        market: "first_inning",
        reason: `stale unlocked FI cleanup failed: ${neutralizeErr.message}`,
      });
    }
  }

  // Upsert per (game_id, market, model_version, slate_date). Locked
  // rows are skipped entirely (counted as skippedExisting so the
  // operator/cron summary surfaces them).
  for (const rec of proposed) {
    const key = `${rec.game_id}::${rec.market}::${rec.model_version ?? ""}::${rec.slate_date}`;
    if (lockedKeys.has(key) || (preserveExistingUnlocked && existingKeys.has(key))) {
      result.skippedExisting++;
      continue;
    }
    const { error: upErr } = await supabase
      .from("prediction_records")
      .upsert(rec, {
        onConflict: "game_id,market,model_version,slate_date",
        ignoreDuplicates: false,
      });
    if (upErr) {
      // The most common failure is the conflict path on a table that
      // already has the row — count it as "skippedExisting" if the
      // hint matches.
      if (/duplicate key/i.test(upErr.message)) {
        result.skippedExisting++;
      } else {
        result.errors.push({
          game_id: rec.game_id,
          market: rec.market,
          reason: upErr.message,
        });
      }
    } else {
      result.insertedCount++;
    }
  }
  return result;
}
