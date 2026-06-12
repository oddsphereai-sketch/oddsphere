/**
 * MLB totals side-reconciliation — pure module.
 *
 * Reconciles four independent signals for an Over/Under decision:
 *
 *   • model_side          = argmax(Poisson probability over the line)
 *   • value_side          = argmax(edge_pp vs no-vig market)
 *   • mean_direction_side = sign(posterior_total − market_total)
 *   • market_pressure_side = direction supported by meaningful money
 *                            split + line movement
 *
 * Existing pipeline behavior (before this module) picked
 * `model_side` deterministically from Poisson probability and grade
 * derivation never downgraded a normal Watchlist when the four signals
 * disagreed. The MIA@PIT 2026-06-12 audit exposed the gap: a side with
 * negative edge + opposing money + mean-direction conflict surfaced as
 * a normal Watchlist Under.
 *
 * Contract (approved 2026-06-12, see [[project — auditor/fixer design
 * contract]] and the MLB totals plan from the same session):
 *
 *   1. Independent model is the source of truth for the side. Market
 *      data conditions the GRADE (cap / hold / flip) but never anchors
 *      the model probability or rewrites the model layer.
 *   2. A side with negative edge cannot remain actionable Watchlist or
 *      Lean.
 *   3. A side that conflicts with projected-total direction is capped
 *      or held unless model probability edge is clearly explainable.
 *   4. If public money AND line movement both warn against the
 *      displayed side, cap or hold unless model edge is strong enough
 *      to override.
 *   5. The system MAY flip the side before lock when:
 *      - model probability supports the opposite side OR is within a
 *        narrow band of 0.5,
 *      - value side supports the opposite side,
 *      - mean direction supports the opposite side,
 *      - market pressure supports the opposite side OR is null,
 *      - row is not locked,
 *      - no data-quality blocker exists,
 *      - and the env flag MLB_TOTALS_PRE_LOCK_FLIP_ENABLED === "true".
 *      When the flag is OFF, the would-flip is RECORDED in audit
 *      metadata but the displayed side does not change.
 *   6. After lock the side is frozen. Flip is blocked; would-flip
 *      metadata still records the recompute for incident analysis.
 *   7. Tracking/grading must use the locked final side only — not the
 *      transient pre-lock would-flip side.
 *
 * This module is PURE: no DB, no HTTP, no globals. It reads the env
 * flag once at module load and returns a frozen value for the lifetime
 * of the Node process. Tests pass an explicit override via
 * `reconcileTotalSide(..., { flipFlagOverride: true })`.
 */

export const MLB_TOTALS_PRE_LOCK_FLIP_FLAG_NAME = "MLB_TOTALS_PRE_LOCK_FLIP_ENABLED" as const;

function readFlipFlag(): boolean {
  // Read once at module load. process.env access is intentional —
  // server-side only path (mlbAutoModelV2_2 is server-only).
  const raw = process.env[MLB_TOTALS_PRE_LOCK_FLIP_FLAG_NAME];
  return raw === "true" || raw === "1";
}

const FLIP_FLAG_AT_LOAD = readFlipFlag();

// ─── Tunables (binding) ────────────────────────────────────────────────

/**
 * |edge_pp| below this counts as "small edge" — too noisy to publish
 * an actionable side when other signals contradict.
 */
export const SMALL_EDGE_BAND_PP = 2.0;

/**
 * |edge_pp| below this on the model side (when negative) does NOT
 * trigger the hard "No Play" cap. Above this magnitude, displaying
 * the model side as anything other than No Play would be misleading.
 */
export const NEGATIVE_EDGE_NO_PLAY_PP = 1.0;

/**
 * Public-money percentage above this on the opposite side counts as
 * "meaningful money pressure against the displayed side." Combined
 * with line-movement against the side to set market_pressure_side.
 */
export const MEANINGFUL_MONEY_PCT = 60;

/**
 * Line movement magnitude (pp) above this counts as "the line moved
 * meaningfully." Combined with money against to set market_pressure_side.
 */
export const MEANINGFUL_LINE_MOVE_PP = 1.0;

// ─── Inputs ───────────────────────────────────────────────────────────

export type TotalSide = "over" | "under";

export type SideReconciliationInput = {
  /**
   * Posterior expected total runs (sum of home + away expected runs).
   * Used for mean_direction_side.
   */
  posteriorTotal: number;
  /** Listed market total at lock candidate. null if no market line. */
  marketTotal: number | null;
  /** Model probability of Over the line, in [0,1]. */
  ouOverProb: number;
  /**
   * No-vig market implied probability of Over. null when the market
   * line is missing or odds are unavailable.
   */
  ouMarketOverProb: number | null;
  /**
   * Public-money percent on Over (0-100). null when split data missing
   * (V1 SharpAPI tier returns no MLB totals splits for some markets).
   */
  publicMoneyOverPct: number | null;
  /**
   * Public-bets percent on Over (0-100). null when missing. NOT used
   * to set market_pressure_side directly — included for audit only;
   * money is the operative signal. Bets are surfaced for the auditor
   * (e.g., reverse-line-movement detection where bets contradict money).
   */
  publicBetsOverPct: number | null;
  /**
   * Line-movement magnitude (pp) and direction. magnitude is unsigned.
   * direction "against_picked" means the line moved AGAINST whichever
   * side the caller is about to display; this caller does not yet know
   * the displayed side, so we pass the raw direction relative to OVER
   * (positive = moved toward Over; negative = moved toward Under).
   */
  lineMovementOverPp: number | null;
  /** True if this row is locked. */
  isLocked: boolean;
  /** True if any data-quality blocker prevents flip (provisional, missing market, etc.). */
  hasFlipBlocker: boolean;
};

// ─── Outputs ──────────────────────────────────────────────────────────

export type SideSelectionReason =
  | "all_agree"
  | "model_value_agree_mean_disagree"
  | "value_disagree_keep_model"
  | "value_flipped_pre_lock"
  | "all_disagree_hold"
  | "market_pressure_overrides_keep_model"
  | "model_only_no_market_data";

export type GradeCap = "no_play" | "caution" | "watchlist" | null;

export type SideFlipBlockedReason =
  | "flag_disabled"
  | "locked"
  | "blocker_present"
  | "not_eligible";

export type TotalSideReconciliation = {
  model_side: TotalSide;
  value_side: TotalSide | null;
  mean_direction_side: TotalSide | null;
  market_pressure_side: TotalSide | null;
  /**
   * Final customer-facing side after applying the policy. Under the
   * default flag-OFF behavior, always equals model_side. Under flag-ON,
   * equals value_side when the flip conditions pass.
   */
  displayed_side: TotalSide;
  side_selection_reason: SideSelectionReason;
  /**
   * Cap clamped over downstream grade derivation. null = no cap. Soft
   * caps are NOT a downgrade-to-lean signal — they are an upper bound.
   */
  grade_cap: GradeCap;
  /**
   * Hard hold. When true, downstream grade derivation must produce a
   * no_bet / no_play verdict regardless of evidence-tier grade.
   */
  hold: boolean;
  /**
   * Stable codes the auditor and UI read alongside grade_cap.
   * Examples: "model_side_negative_edge", "mean_direction_conflict",
   * "all_signals_disagree", "market_pressure_conflict".
   */
  side_disagree_flags: ReadonlyArray<string>;
  /**
   * Side the system WOULD flip to if the flip flag were enabled and
   * not blocked. Set whenever reconciliation finds a strict opposite-
   * side dominance; null otherwise. Independent of whether the flip
   * was actually applied.
   */
  would_flip_side: TotalSide | null;
  /**
   * Reason the would-flip was not applied. "flag_disabled" is the
   * default reason while the env flag is off. null when no flip was
   * considered (would_flip_side === null) or when the flip WAS applied
   * (displayed_side !== model_side).
   */
  flip_blocked_reason: SideFlipBlockedReason | null;
  /**
   * Whether the flip flag was enabled at the time reconciliation ran.
   * Captured into the snapshot so the auditor can reconcile snapshots
   * across flag toggles without re-running the pipeline.
   */
  flip_flag_enabled: boolean;
};

export type ReconcileOptions = {
  /**
   * Test-only override for the env flag. When undefined, the module-
   * level FLIP_FLAG_AT_LOAD value is used.
   */
  flipFlagOverride?: boolean;
};

// ─── Reconciliation logic ─────────────────────────────────────────────

function chooseModelSide(p: number): TotalSide {
  return p >= 0.5 ? "over" : "under";
}

function chooseMeanDirection(
  posteriorTotal: number,
  marketTotal: number | null,
): TotalSide | null {
  if (marketTotal === null) return null;
  if (posteriorTotal > marketTotal) return "over";
  if (posteriorTotal < marketTotal) return "under";
  return null;
}

function computeEdgePp(modelOverProb: number, marketOverProb: number | null): {
  overEdgePp: number | null;
  underEdgePp: number | null;
} {
  if (marketOverProb === null) return { overEdgePp: null, underEdgePp: null };
  const overEdgePp = (modelOverProb - marketOverProb) * 100;
  const underEdgePp = ((1 - modelOverProb) - (1 - marketOverProb)) * 100;
  return { overEdgePp, underEdgePp };
}

function chooseValueSide(
  overEdgePp: number | null,
  underEdgePp: number | null,
): TotalSide | null {
  if (overEdgePp === null || underEdgePp === null) return null;
  if (overEdgePp === underEdgePp) return null;
  return overEdgePp > underEdgePp ? "over" : "under";
}

/**
 * Market pressure side. Three signals participate:
 *
 *   1. public_money — meaningful when one side has > MEANINGFUL_MONEY_PCT.
 *   2. line_movement — meaningful when |move| ≥ MEANINGFUL_LINE_MOVE_PP.
 *
 * Pressure favors a side only when BOTH the money split and the line
 * movement agree AND each is meaningful in isolation. Public bets
 * are NOT factored into the pressure side; they are surfaced in the
 * audit blob for human inspection (RLM cases where bets contradict
 * money are intentionally ignored at this layer).
 *
 * Returns null when either signal is missing or when they disagree.
 */
function chooseMarketPressureSide(
  publicMoneyOverPct: number | null,
  lineMovementOverPp: number | null,
): TotalSide | null {
  if (publicMoneyOverPct === null || lineMovementOverPp === null) return null;

  const moneyFavorsOver = publicMoneyOverPct > MEANINGFUL_MONEY_PCT;
  const moneyFavorsUnder = publicMoneyOverPct < (100 - MEANINGFUL_MONEY_PCT);
  if (!moneyFavorsOver && !moneyFavorsUnder) return null;

  const moveMeaningful = Math.abs(lineMovementOverPp) >= MEANINGFUL_LINE_MOVE_PP;
  if (!moveMeaningful) return null;

  const moveFavorsOver = lineMovementOverPp > 0;
  const moneyAgreesWithMoveOver = moneyFavorsOver && moveFavorsOver;
  const moneyAgreesWithMoveUnder = moneyFavorsUnder && !moveFavorsOver;

  if (moneyAgreesWithMoveOver) return "over";
  if (moneyAgreesWithMoveUnder) return "under";
  return null;
}

function edgeFor(
  side: TotalSide,
  overEdgePp: number | null,
  underEdgePp: number | null,
): number | null {
  return side === "over" ? overEdgePp : underEdgePp;
}

export function reconcileTotalSide(
  input: SideReconciliationInput,
  opts: ReconcileOptions = {},
): TotalSideReconciliation {
  const flipFlag = opts.flipFlagOverride ?? FLIP_FLAG_AT_LOAD;

  const model_side = chooseModelSide(input.ouOverProb);
  const mean_direction_side = chooseMeanDirection(input.posteriorTotal, input.marketTotal);

  const { overEdgePp, underEdgePp } = computeEdgePp(input.ouOverProb, input.ouMarketOverProb);
  const value_side = chooseValueSide(overEdgePp, underEdgePp);
  const market_pressure_side = chooseMarketPressureSide(input.publicMoneyOverPct, input.lineMovementOverPp);

  const modelEdge = edgeFor(model_side, overEdgePp, underEdgePp);
  const oppositeSide: TotalSide = model_side === "over" ? "under" : "over";

  // Disagreement flags — accumulate as we evaluate. Stable codes for
  // auditor + UI consumption.
  const flags: string[] = [];
  if (value_side !== null && value_side !== model_side) flags.push("value_side_disagrees_with_model");
  if (mean_direction_side !== null && mean_direction_side !== model_side) flags.push("mean_direction_disagrees_with_model");
  if (market_pressure_side !== null && market_pressure_side !== model_side) flags.push("market_pressure_disagrees_with_model");
  if (modelEdge !== null && modelEdge < 0) flags.push("model_side_negative_edge");
  if (modelEdge !== null && modelEdge < -NEGATIVE_EDGE_NO_PLAY_PP) flags.push("model_side_strong_negative_edge");
  if (
    value_side !== null && value_side !== model_side &&
    mean_direction_side !== null && mean_direction_side !== model_side &&
    market_pressure_side !== null && market_pressure_side !== model_side
  ) {
    flags.push("all_signals_disagree_with_model");
  }

  // Would-flip detection. Strict: all available signals must agree on
  // the opposite side. If any of (value, mean, market_pressure) are
  // null, the would-flip is null — we never flip on partial information.
  // model probability must also be at or near 50/50 (within 2 pp) on
  // the opposite side to qualify, so a strong model conviction blocks
  // a flip even if the other signals oppose.
  const oppositeProbBand = Math.abs(input.ouOverProb - 0.5) <= 0.02;
  let would_flip_side: TotalSide | null = null;
  if (
    oppositeProbBand &&
    value_side === oppositeSide &&
    mean_direction_side === oppositeSide &&
    market_pressure_side === oppositeSide
  ) {
    would_flip_side = oppositeSide;
  }

  // Decide hold / cap. Order matters: hold takes precedence over caps.
  //
  // Small-edge hold: when the model probability is essentially flat
  // (|edge| < SMALL_EDGE_BAND_PP) AND the value side disagrees with
  // the model side AND the mean direction disagrees AND market
  // pressure is null or opposed, we hold rather than display a
  // contradictory pick.
  let hold = false;
  const smallEdge = modelEdge !== null && Math.abs(modelEdge) < SMALL_EDGE_BAND_PP;
  const valueDisagrees = value_side !== null && value_side !== model_side;
  const meanDisagrees = mean_direction_side !== null && mean_direction_side !== model_side;
  const pressureDisagreesOrNull = market_pressure_side !== model_side; // includes null
  if (smallEdge && valueDisagrees && meanDisagrees && pressureDisagreesOrNull) {
    hold = true;
  }

  // Cap selection. Independent of hold (a hold also forces no_play
  // downstream; the cap field reflects the strength of the disagreement
  // even when the hold fires, so the auditor can sort by severity).
  let grade_cap: GradeCap = null;
  const strongNegativeEdge = modelEdge !== null && modelEdge < -NEGATIVE_EDGE_NO_PLAY_PP;
  if (strongNegativeEdge && (valueDisagrees || meanDisagrees)) {
    grade_cap = "no_play";
  } else if (modelEdge !== null && modelEdge < 0 && (valueDisagrees || meanDisagrees)) {
    grade_cap = "caution";
  } else if (valueDisagrees && meanDisagrees) {
    grade_cap = "caution";
  } else if (valueDisagrees || meanDisagrees || (market_pressure_side !== null && market_pressure_side !== model_side)) {
    grade_cap = "watchlist";
  }
  if (hold) grade_cap = "no_play";

  // Decide whether the system actually flips. The flip is only applied
  // when:
  //   - would_flip_side is non-null,
  //   - the env flag is enabled,
  //   - the row is unlocked,
  //   - no data-quality blocker is present.
  let displayed_side: TotalSide = model_side;
  let flip_blocked_reason: SideFlipBlockedReason | null = null;
  if (would_flip_side !== null) {
    if (!flipFlag) flip_blocked_reason = "flag_disabled";
    else if (input.isLocked) flip_blocked_reason = "locked";
    else if (input.hasFlipBlocker) flip_blocked_reason = "blocker_present";
    else displayed_side = would_flip_side;
  }
  // When the flip was applied, displayed_side differs from model_side
  // and flip_blocked_reason stays null. When would_flip_side is null,
  // flip_blocked_reason stays null too (nothing to block).

  // side_selection_reason — derived from the final state, not from any
  // intermediate flag, so the auditor reads a single stable code.
  let side_selection_reason: SideSelectionReason;
  if (displayed_side !== model_side) {
    side_selection_reason = "value_flipped_pre_lock";
  } else if (hold) {
    side_selection_reason = "all_disagree_hold";
  } else if (
    valueDisagrees && mean_direction_side === model_side
  ) {
    side_selection_reason = "value_disagree_keep_model";
  } else if (
    value_side === model_side && mean_direction_side !== null && mean_direction_side !== model_side
  ) {
    side_selection_reason = "model_value_agree_mean_disagree";
  } else if (
    value_side === null && mean_direction_side === null && market_pressure_side === null
  ) {
    side_selection_reason = "model_only_no_market_data";
  } else if (
    market_pressure_side !== null && market_pressure_side !== model_side &&
    value_side === model_side
  ) {
    side_selection_reason = "market_pressure_overrides_keep_model";
  } else {
    side_selection_reason = "all_agree";
  }

  return {
    model_side,
    value_side,
    mean_direction_side,
    market_pressure_side,
    displayed_side,
    side_selection_reason,
    grade_cap,
    hold,
    side_disagree_flags: flags,
    would_flip_side,
    flip_blocked_reason,
    flip_flag_enabled: flipFlag,
  };
}
