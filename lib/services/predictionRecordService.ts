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
import { isBlockedSportsbook } from "../config/blockedSportsbooks";

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
 * EVIDENCE-GATED, ENVIRONMENT-INDEPENDENT quality test. Two conditions, both
 * validated on locked tracking (since 6/7) with leave-one-day-out + a clear
 * model reason (NOT a high-scoring-week artifact):
 *
 *   1. NEGATIVE EXPECTED VALUE (coherence). A Lean whose own model probability,
 *      priced at the locked American odds, has EV < 0 loses long-run by the
 *      model's OWN numbers. Favorite Leans with EV<0 went 1-5 (17%, −68% ROI).
 *      Arithmetic, not pattern-fit → environment-independent.
 *   2. LOW-CONVICTION FAVORITE (ML only). A money-line FAVORITE the model
 *      barely separates (|projected run gap| < 0.5) went 27% / −48% (robust
 *      excl-6/14, LODO never positive); favorites WITH conviction (gap ≥1)
 *      went 73% / +24%. Conviction, not environment.
 *
 * Replaces the earlier R1 confidence-floor (which emptied the board). Only
 * touches the "lean" tier; Best Angle / others unchanged. Future-picks + display
 * only — never mutates locked/historical/tracking rows. Reversible (constants).
 *
 * Public-trap (bets≫money) is intentionally EXCLUDED: it only predicts losses
 * on O/U (trap O/U = nearly all Unders = the one high-scoring week; trap×ML is
 * fine), i.e. environment-confounded. It is shadow-logged in the research
 * report, not gated, until a low-scoring week validates it out-of-sample.
 */
export const GATE_EV_FLOOR = 0;
export const GATE_LOW_CONVICTION_RUNGAP = 0.5;
export const GATE_LOW_TOTAL_LINE = 8;
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
  // 1. negative-EV coherence demotion (any market) — arithmetic, env-independent
  if (gateEvNegative(x.modelProb, x.americanOdds)) return "market_aligned";
  // 2. low-conviction favorite (money-line only) — run-gap conviction, env-independent
  if (
    x.market === "moneyline" &&
    x.americanOdds !== null && x.americanOdds < 0 &&
    x.runGapAbs !== null && x.runGapAbs < GATE_LOW_CONVICTION_RUNGAP
  ) {
    return "market_aligned";
  }
  // 3. extreme-low total line (totals only) — pitcher's-duel games where the
  //    model has no demonstrated edge (board 33% / −35%, both sides, robust
  //    excl-6/14 + LODO; structural: compressed run distribution). Pre-game
  //    knowable. Smallest-sample of the three — reversible via constant.
  if (
    x.market === "total" &&
    x.totalLine !== null && x.totalLine < GATE_LOW_TOTAL_LINE
  ) {
    return "market_aligned";
  }
  return grade;
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

/**
 * Phase 6B.18 — same priority list Daily Edge uses for line/odds
 * selection (BOOK_PRIORITY in app/api/lab/daily-edge/route.ts:903).
 * Duplicated here intentionally — predictionRecordService is a
 * server-only service and shouldn't import a route module. Keep in
 * sync if the daily-edge list changes.
 */
const BOOK_PRIORITY: readonly string[] = [
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
  "splits_consensus",
] as const;

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
      !isBlockedSportsbook(r.sportsbook),
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
    (r) => !isBlockedSportsbook(r.sportsbook),
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
  },
): GameOddsSnapshot {
  const history = opts?.historyByKey ?? new Map<string, ReadonlyArray<LineHistoryRowForOdds>>();
  const gameId = opts?.gameId ?? -1;
  const mlHome = pickOddsWithFallback(lines, history, gameId, "moneyline", "home");
  const mlAway = pickOddsWithFallback(lines, history, gameId, "moneyline", "away");
  const ouOver = pickOddsWithFallback(lines, history, gameId, "total", "over");
  const ouUnder = pickOddsWithFallback(lines, history, gameId, "total", "under");
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
): PredictionRecordRow | null {
  const sp = (pred.sport_specific ?? {}) as Record<string, unknown>;
  const holdPicks = Array.isArray(sp.hold_picks) ? (sp.hold_picks as string[]) : [];
  const held = holdPicks.includes("ml") || pred.predicted_ml_winner === null;
  if (held) return null;
  const v22 = (sp.v2_2_audit ?? {}) as Record<string, unknown>;
  const v21 = (sp.v2_1_audit ?? {}) as Record<string, unknown>;
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
  const mlBest = resolveMlbBestAngle({
    baseEligible: readBoolish(sp.ml_best_angle_eligible),
    requiresConfirmation: readBoolish(v22.ml_requires_market_confirmation),
    lineDirection: readLineDirection(mlLineMovement),
    opposingPublicMoney: hasOpposingPublicMoneyConflict(signalsForGame, "moneyline", pred.predicted_ml_winner),
  });
  return {
    game_prediction_id: pred.id,
    game_id: game.id,
    external_id: game.external_id,
    sport: "mlb",
    slate_date: slateDate,
    game_date: game.game_date,
    matchup: `${awayAbbrev}@${homeAbbrev}`,
    market: "moneyline",
    pick: pred.predicted_ml_winner,
    side: pred.predicted_ml_winner,
    line_value: null,
    odds_american: mlOddsAmerican,
    odds_decimal: null,
    model_used: readStringOrNull(sp.model_used),
    model_version: readStringOrNull(sp.model_version),
    prediction_source: pred.prediction_source,
    confidence: pred.ml_confidence,
    model_probability: mlModelProb,
    market_probability: mlMarketProb,
    edge: mlEdgePp,
    expected_value: null,
    // Phase 6B.27 — strip internal V2.2 diagnostic labels (no_bet/held/
    // toss_up) from the public column; raw stays in snapshot.v2_2_audit.
    play_grade: applyPlayGradeGate(readPublicPlayGrade(sp.ml_play_grade), {
      modelProb: mlModelProb, americanOdds: mlOddsAmerican, market: "moneyline",
      runGapAbs: typeof v22.posterior_home_diff === "number" ? Math.abs(v22.posterior_home_diff as number) : null,
      totalLine: null,
    }),
    prediction_type: readStringOrNull(sp.ml_prediction_type),
    // Phase 6B.11 + MLB-P0 — public-money guard PLUS line-movement /
    // large-edge confirmation (see resolveMlbBestAngle). Tracking pending
    // BA count matches what members see on the live slate.
    best_angle: mlBest.bestAngle,
    no_bet: false,
    no_bet_reason: readStringOrNull(sp.ml_no_bet_reason),
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
      public_splits: buildPublicSplitsSnapshot(signalsForGame, "moneyline", pred.predicted_ml_winner),
      line_movement: mlLineMovement,
      // MLB-P0 — audit trail for the Best Angle confirmation resolution.
      best_angle_resolution: {
        base_eligible: readBoolish(sp.ml_best_angle_eligible),
        requires_confirmation: readBoolish(v22.ml_requires_market_confirmation),
        line_direction: readLineDirection(mlLineMovement),
        demote_reason: mlBest.demoteReason,
        final_best_angle: mlBest.bestAngle,
      },
      data_integrity: buildDataIntegritySnapshot(sp, oddsForGame, "moneyline"),
      // Phase 6B.28 — rich-and-frozen Daily Edge substrate at lock.
      ...buildDailyEdgeLockSubstrate({ signalsForGame, currentLinesForGame, pred }),
      // Forward Fix A (2026-06-09) — audit trail for the writer's odds
      // source per (market, side). Lets operators verify the lock used
      // a real-book price (lines vs line_history_fallback) and detect
      // "unavailable" rows that need investigation. Always populated;
      // when `lines` was thin AND `line_history` had no usable row,
      // the source is "unavailable" with null book/odds/timestamp.
      odds_source_at_lock_ml: oddsForGame
        ? { home: oddsForGame.oddsSourceMl.home, away: oddsForGame.oddsSourceMl.away }
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
): PredictionRecordRow | null {
  const sp = (pred.sport_specific ?? {}) as Record<string, unknown>;
  const holdPicks = Array.isArray(sp.hold_picks) ? (sp.hold_picks as string[]) : [];
  const held = holdPicks.includes("ou") || pred.predicted_ou_side === null;
  if (held) return null;
  const v21 = (sp.v2_1_audit ?? {}) as Record<string, unknown>;
  const v22 = (sp.v2_2_audit ?? {}) as Record<string, unknown>;
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
  const ouBest = resolveMlbBestAngle({
    baseEligible: readBoolish(sp.ou_best_angle_eligible),
    requiresConfirmation: readBoolish(v22.ou_requires_market_confirmation),
    lineDirection: readLineDirection(ouLineMovement),
    opposingPublicMoney: hasOpposingPublicMoneyConflict(signalsForGame, "total", pred.predicted_ou_side),
  });
  return {
    game_prediction_id: pred.id,
    game_id: game.id,
    external_id: game.external_id,
    sport: "mlb",
    slate_date: slateDate,
    game_date: game.game_date,
    matchup: `${awayAbbrev}@${homeAbbrev}`,
    market: "total",
    pick: pred.predicted_ou_side,
    side: pred.predicted_ou_side,
    line_value: lockedTotalLine,
    odds_american: ouOddsAmerican,
    odds_decimal: null,
    model_used: readStringOrNull(sp.model_used),
    model_version: readStringOrNull(sp.model_version),
    prediction_source: pred.prediction_source,
    confidence: pred.ou_confidence,
    model_probability: ouModelProb,
    market_probability: ouMarketProb,
    edge: ouEdgePp,
    expected_value: null,
    // Phase 6B.27 — same translator as ML; see readPublicPlayGrade.
    play_grade: applyPlayGradeGate(readPublicPlayGrade(sp.ou_play_grade), {
      modelProb: ouModelProb, americanOdds: ouOddsAmerican, market: "total",
      runGapAbs: null, totalLine: lockedTotalLine,
    }),
    prediction_type: readStringOrNull(sp.ou_prediction_type),
    // Phase 6B.11 + MLB-P0 — same resolution as ML; see resolveMlbBestAngle.
    best_angle: ouBest.bestAngle,
    no_bet: false,
    no_bet_reason: readStringOrNull(sp.ou_no_bet_reason),
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
      public_splits: buildPublicSplitsSnapshot(signalsForGame, "total", pred.predicted_ou_side),
      line_movement: ouLineMovement,
      // MLB-P0 — audit trail for the Best Angle confirmation resolution.
      best_angle_resolution: {
        base_eligible: readBoolish(sp.ou_best_angle_eligible),
        requires_confirmation: readBoolish(v22.ou_requires_market_confirmation),
        line_direction: readLineDirection(ouLineMovement),
        demote_reason: ouBest.demoteReason,
        final_best_angle: ouBest.bestAngle,
      },
      data_integrity: buildDataIntegritySnapshot(sp, oddsForGame, "total"),
      // Phase 6B.28 — same rich-and-frozen substrate as ML.
      ...buildDailyEdgeLockSubstrate({ signalsForGame, currentLinesForGame, pred }),
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
): PredictionRecordRow | null {
  const sp = (pred.sport_specific ?? {}) as Record<string, unknown>;
  const holdPicks = Array.isArray(sp.hold_picks) ? (sp.hold_picks as string[]) : [];
  const held = holdPicks.includes("nrfi") || pred.predicted_nrfi === null;
  if (held) return null;

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
  const autoFactors =
    sp.auto_factors && typeof sp.auto_factors === "object"
      ? (sp.auto_factors as Record<string, unknown>)
      : null;
  const nrfiExpectedRuns =
    autoFactors && typeof autoFactors.nrfi_expected_runs === "number"
      ? (autoFactors.nrfi_expected_runs as number)
      : null;
  const isTossUp =
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

  // 2026-06-15: thread the REAL first-inning lock price (was hardcoded null —
  // the FI/NRFI/YRFI lock-price gap). first_inning_total lines exist in the DB
  // (NRFI=under 0.5, YRFI=over 0.5); use the same BOOK_PRIORITY picker as
  // ML/total. No history map (FI openers aren't loaded) → Tier-1 live lines
  // only, which is where FI odds live. Toss-Ups stay null (no actionable side).
  const NO_HISTORY = new Map<string, ReadonlyArray<LineHistoryRowForOdds>>();
  const fiPicked = sideValue === null
    ? null
    : pickOddsWithFallback(currentLines, NO_HISTORY, game.id, "first_inning_total", internalSide);
  const fiOpposite = sideValue === null
    ? null
    : pickOddsWithFallback(currentLines, NO_HISTORY, game.id, "first_inning_total", internalSide === "under" ? "over" : "under");
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
  const noBetValue = isTossUp;
  const noBetReasonValue = isTossUp
    ? "non-actionable: locked pill was Toss-Up"
    : null;

  // P7-Commit-B (2026-06-11) — FI play_grade persistence going forward.
  //
  // Before this change FI rows always wrote play_grade=null, so the Daily
  // Edge card could render a "Lean" pill (via marketVerdictFor Rule 5)
  // that was never captured in prediction_records. Tracking's Lean bucket
  // silently dropped those FI Leans because its filter is
  // `play_grade === "lean"`.
  //
  // Fix: mirror the card's Rule 5 in the writer. Rule 5 says
  // `confidence >= LEAN_CONFIDENCE_FLOOR (0.58)` → "lean". For FI, the
  // route divides nrfi_confidence by 100 before calling marketVerdictFor,
  // so 58 on the 0–100 scale = 0.58 in marketVerdictFor's space. Match it
  // exactly so the writer never disagrees with the displayed pill.
  //
  // Scope (explicit per operator directive):
  //   • Toss-Up / no_bet → keep play_grade=null (already handled above
  //     via isTossUp + noBetValue; never reach the lean check)
  //   • held → returns earlier (line 1032); no record written
  //   • best_angle stays false unless / until a separate FI Best Angle
  //     policy is approved (none today)
  //   • Watchlist / No Play continue to write play_grade=null — only
  //     "lean" gains explicit persistence in this change
  //
  // No tracking UI is changed. No historical FI rows are backfilled. The
  // Best Angles section still reads `best_angle === true` and remains
  // empty for FI by design.
  const FI_LEAN_CONFIDENCE_FLOOR_PCT = 58;
  const fiPlayGrade: string | null =
    !isTossUp &&
    typeof pred.nrfi_confidence === "number" &&
    pred.nrfi_confidence >= FI_LEAN_CONFIDENCE_FLOOR_PCT
      ? "lean"
      : null;

  return {
    game_prediction_id: pred.id,
    game_id: game.id,
    external_id: game.external_id,
    sport: "mlb",
    slate_date: slateDate,
    game_date: game.game_date,
    matchup: `${awayAbbrev}@${homeAbbrev}`,
    market: "first_inning",
    pick: pickLabel,
    side: sideValue,
    line_value: 0.5,
    odds_american: fiOddsAmerican,
    odds_decimal: null,
    model_used: readStringOrNull(sp.model_used),
    model_version: readStringOrNull(sp.model_version),
    prediction_source: pred.prediction_source,
    confidence: pred.nrfi_confidence,
    model_probability: fiModelProb,
    market_probability: fiMarketProb,
    edge: fiEdge,
    expected_value: null,
    play_grade: applyPlayGradeGate(fiPlayGrade, {
      modelProb: fiModelProb, americanOdds: fiOddsAmerican, market: "first_inning",
      runGapAbs: null, totalLine: null,
    }),
    prediction_type: predictionTypeValue,
    best_angle: false,
    no_bet: noBetValue,
    no_bet_reason: noBetReasonValue,
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
       ML/OU/spread; first_inning_total lines exist but aren't loaded
       in this build). data_integrity is still meaningful. Surface null
       for the unavailable ones so the calibration extractor reports
       "unknown" rather than absent. */
    snapshot_json: {
      ...sp,
      public_splits: null,
      line_movement: null,
      data_integrity: buildDataIntegritySnapshot(sp, null, "first_inning"),
      // Phase 6B.28 — substrate. signal_rows_at_lock + lines_at_lock are
      // empty for FI (sharp_signals/lines for first_inning_total not
      // loaded in this build). predicted_scores + framework_grades for
      // NRFI/YRFI are still captured.
      ...buildDailyEdgeLockSubstrate({ signalsForGame: [], currentLinesForGame: [], pred }),
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
    const ml = buildMlRecord(pred, g, home, away, args.slateDate, args.launchDay, sigs, odds, openers, currentLines);
    const ou = buildOuRecord(pred, g, home, away, args.slateDate, args.launchDay, sigs, odds, openers, currentLines);
    const fi = buildFiRecord(pred, g, home, away, args.slateDate, args.launchDay, currentLines);
    if (ml) proposed.push(ml);
    if (ou) proposed.push(ou);
    if (fi) proposed.push(fi);
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
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: lineHistoryRows } = await supabase
    .from("line_history")
    .select("game_id, market_type, side, sportsbook, odds_american, line_value, recorded_at")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total"])
    .is("player_id", null)
    .neq("sportsbook", "splits_consensus")
    .not("odds_american", "is", null)
    .gte("recorded_at", oneDayAgo)
    .order("recorded_at", { ascending: false });
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
  for (const gameId of gameIds) {
    const lines = linesByGame.get(gameId) ?? [];
    oddsByGameId.set(
      gameId,
      buildGameOddsSnapshot(lines, { historyByKey, gameId }),
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

  const { data: allHistory } = await supabase
    .from("line_history")
    .select("game_id, market_type, side, sportsbook, odds_american, line_value, recorded_at")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total"])
    .is("player_id", null)
    .order("recorded_at", { ascending: true });
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
    .select("game_id, market, model_version, slate_date, locked_at")
    .in("game_id", proposed.map((r) => r.game_id))
    .eq("slate_date", slateDate);
  const lockedKeys = new Set<string>();
  for (const r of (existingLocks ?? []) as Array<{
    game_id: number;
    market: string;
    model_version: string | null;
    slate_date: string;
    locked_at: string | null;
  }>) {
    if (r.locked_at !== null) {
      lockedKeys.add(
        `${r.game_id}::${r.market}::${r.model_version ?? ""}::${r.slate_date}`,
      );
    }
  }

  // Upsert per (game_id, market, model_version, slate_date). Locked
  // rows are skipped entirely (counted as skippedExisting so the
  // operator/cron summary surfaces them).
  for (const rec of proposed) {
    const key = `${rec.game_id}::${rec.market}::${rec.model_version ?? ""}::${rec.slate_date}`;
    if (lockedKeys.has(key)) {
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
