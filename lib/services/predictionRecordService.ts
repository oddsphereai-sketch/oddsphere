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
};

function readBoolish(v: unknown): boolean {
  return v === true;
}
function readStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
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
 */
type GameOddsSnapshot = {
  mlHomeOdds: number | null;
  mlAwayOdds: number | null;
  ouOverOdds: number | null;
  ouUnderOdds: number | null;
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
  "fliff",
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
};

/**
 * For one (game, market, side), return the picked-side odds_american
 * from the highest-priority book that has a non-null value. Returns
 * null when nothing matches.
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
 * Build the per-game odds snapshot from the lines table. Reads the
 * first BOOK_PRIORITY-matching odds per (game, market, side).
 */
export function buildGameOddsSnapshot(
  lines: ReadonlyArray<LineRowForOdds>,
): GameOddsSnapshot {
  return {
    mlHomeOdds: pickPriorityOdds(lines, "moneyline", "home"),
    mlAwayOdds: pickPriorityOdds(lines, "moneyline", "away"),
    ouOverOdds: pickPriorityOdds(lines, "total", "over"),
    ouUnderOdds: pickPriorityOdds(lines, "total", "under"),
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
    (r) => r.market_type === market && r.side === side && r.odds_american !== null,
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
    play_grade: readStringOrNull(sp.ml_play_grade),
    prediction_type: readStringOrNull(sp.ml_prediction_type),
    // Phase 6B.11 — apply the same public-money conflict guard the
    // Daily Edge verdict layer uses (Phase 6B.10). Tracking pending
    // BA count now matches what members see on the live slate.
    best_angle:
      readBoolish(sp.ml_best_angle_eligible) &&
      !hasOpposingPublicMoneyConflict(signalsForGame, "moneyline", pred.predicted_ml_winner),
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
      line_movement: buildLineMovementSnapshot(openersForGame, currentLinesForGame, signalsForGame, "moneyline", pred.predicted_ml_winner),
      data_integrity: buildDataIntegritySnapshot(sp, oddsForGame, "moneyline"),
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
    play_grade: readStringOrNull(sp.ou_play_grade),
    prediction_type: readStringOrNull(sp.ou_prediction_type),
    // Phase 6B.11 — same guard as ML above; see hasOpposingPublicMoneyConflict.
    best_angle:
      readBoolish(sp.ou_best_angle_eligible) &&
      !hasOpposingPublicMoneyConflict(signalsForGame, "total", pred.predicted_ou_side),
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
      line_movement: buildLineMovementSnapshot(openersForGame, currentLinesForGame, signalsForGame, "total", pred.predicted_ou_side),
      data_integrity: buildDataIntegritySnapshot(sp, oddsForGame, "total"),
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
  const noBetValue = isTossUp;
  const noBetReasonValue = isTossUp
    ? "non-actionable: locked pill was Toss-Up"
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
    odds_american: null,
    odds_decimal: null,
    model_used: readStringOrNull(sp.model_used),
    model_version: readStringOrNull(sp.model_version),
    prediction_source: pred.prediction_source,
    confidence: pred.nrfi_confidence,
    model_probability:
      pred.nrfi_confidence !== null ? pred.nrfi_confidence / 100 : null,
    market_probability: null,
    edge: null,
    expected_value: null,
    play_grade: null,
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
    const fi = buildFiRecord(pred, g, home, away, args.slateDate, args.launchDay);
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
  const { data: predRows } = await supabase
    .from("game_predictions")
    .select("id, game_id, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence, prediction_source, is_override, locked_at, computed_at, sport_specific")
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
  const { data: signalRows } = await supabase
    .from("sharp_signals")
    .select(
      "game_id, market_type, side, public_money_pct, public_betting_pct, has_steam_move, has_reverse_line_movement, rlm_direction, signal_strength, computed_at",
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
    });
    signalsByGameId.set(s.game_id, list);
  }

  // Phase 6B.18 — load picked-side odds for ML + OU markets so the
  // snapshot captures the pregame price. Daily Edge can then render
  // the locked snapshot's odds_american directly after lock instead
  // of falling back to the live `lines` table.
  // Phase 6B.22 — also load `line_value` so the line-movement helper
  // can surface total-line drift (e.g., 8.5 → 9.0).
  const { data: lineRowsForOdds } = await supabase
    .from("lines")
    .select("game_id, market_type, side, sportsbook, odds_american, line_value")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total"])
    .is("player_id", null);
  const oddsByGameId = new Map<number, GameOddsSnapshot>();
  const linesByGame = new Map<number, LineRowForOdds[]>();
  for (const l of ((lineRowsForOdds ?? []) as LineRowForOdds[])) {
    const arr = linesByGame.get(l.game_id) ?? [];
    arr.push(l);
    linesByGame.set(l.game_id, arr);
  }
  for (const [gameId, lines] of linesByGame) {
    oddsByGameId.set(gameId, buildGameOddsSnapshot(lines));
  }

  // Phase 6B.22 — load opener prices from line_history (is_opener=true)
  // so the line-movement helper can compute direction vs the picked side.
  // Missing openers = direction reported as "unknown".
  const { data: openerRows } = await supabase
    .from("line_history")
    .select("game_id, market_type, side, sportsbook, odds_american, line_value, recorded_at")
    .eq("is_opener", true)
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "total"])
    .is("player_id", null);
  const openersByGameId = new Map<number, LineHistoryOpenerRow[]>();
  for (const o of ((openerRows ?? []) as LineHistoryOpenerRow[])) {
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
