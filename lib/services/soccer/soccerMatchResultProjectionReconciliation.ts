/**
 * Soccer (FIFA World Cup) match_result projection / pick reconciliation —
 * pure module.
 *
 * Sibling of lib/services/soccer/soccerTotalProjectionReconciliation.ts,
 * applying the SAME score↔pick coherence invariant to the 3-way market.
 *
 * Why this exists (Daniel, 2026-06-14):
 *   The displayed match_result pick used to be argmax(model_probability)
 *   per market, with NO reconciliation against the projected scoreline —
 *   even though totals already had one. So a coin-flip projection like
 *   λ_home 1.05 / λ_away 0.95 (essentially a 1-1 draw) could print a
 *   confident HOME WIN because home edged draw by ~1.6 pp in raw
 *   probability. The card's pick then contradicted its own projected
 *   score, and the model could "never call a draw" in the group stage —
 *   the symptom Daniel kept flagging (SUI@QAT drew 1-1 with a projection
 *   gap of 0.1, yet the pick was a team ML).
 *
 *   The fix is NOT a draw-specific hack. It is the projection-coherence
 *   contract: the displayed read is the outcome implied by the projected
 *   SCORELINE. When the projected margin sits inside the draw band the
 *   teams are projected even → the coherent read is DRAW. A team read
 *   only stands when the projection actually separates them.
 *
 * Contract (mirrors the totals module):
 *
 *   1. projection_outcome = the outcome implied by the projected
 *      scoreline margin (λ_home − λ_away):
 *        margin >  +band → home
 *        margin <  −band → away
 *        |margin| ≤ band → draw   (projected even → coin flip)
 *      This is the coherence anchor, exactly like mean_direction_side
 *      for totals.
 *
 *      DRAW IS GROUP-STAGE ONLY (Daniel, 2026-06-14). The 1X2 market
 *      settles on 90' in both stages, but surfacing a bare "Draw" pick
 *      in a KNOCKOUT game is product-wrong: the tournament resolves a
 *      winner via extra time / penalties. So when drawPickable is false
 *      (knockout) the draw band collapses — an even projection resolves
 *      to the projected favorite (margin sign; the higher win-prob side
 *      on an exact tie) at caution conviction, never "draw". The caller
 *      passes drawPickable = !games.postseason (the seeder maps the
 *      provider stage_name → postseason: group=false, knockout=true).
 *
 *   2. The DISPLAYED pick is always projection_outcome, so the pick can
 *      never contradict the projected scoreline.
 *
 *   3. Conviction is honest and value-gated:
 *        • draw projection → grade caps to WATCHLIST. A draw is a
 *          coin-flip read: we SHOW it (the model can finally call it)
 *          but never over-sell it as a hard Lean pre-calibration.
 *        • team projection + value agrees (best edge on the same side,
 *          positive) → no cap; the grade ladder may reach Lean.
 *        • team projection + value disagrees (best edge elsewhere, or
 *          the projected side is negative-edge) → caps to CAUTION; we
 *          project the team but the market/value leans away, so it is
 *          low conviction.
 *        • no market odds → WATCHLIST (no edge to confirm with).
 *
 *   4. Confidence is HONEST: reconciled_confidence_pct = raw model
 *      P(displayed_outcome) × 100. No inflation.
 *
 *   5. Locked snapshots returned verbatim.
 *
 * Pure module. No DB. No HTTP.
 */

// ─── Tunables ──────────────────────────────────────────────────────────

/**
 * |λ_home − λ_away| at or below this (in expected goals) means the
 * projected scoreline is essentially even → the coherent read is a draw.
 * Matches the spirit of the totals MEAN_DIRECTION_NULL_EPSILON (0.25
 * goals): a quarter-goal of projected separation is a coin flip. Daniel's
 * SUI@QAT example sat at a 0.1 gap — comfortably inside this band.
 */
export const MARGIN_DRAW_BAND_GOALS = 0.25;

/**
 * A projected-side edge below this (pp) is treated as the value leaning
 * away from our projection → caution.
 *
 * NOTE: unlike the totals module there is deliberately NO absolute
 * probability floor here. Totals are binary (50% = coin flip), but
 * match_result is 3-way — the neutral baseline is ~33%, so a favorite
 * winning 41% of the time is genuine conviction, not a coin flip.
 * Conviction is governed by EDGE (the grade ladder), not raw P. The only
 * "even game" guard is the projected-margin draw band above.
 */
export const NEGATIVE_EDGE_CAUTION_PP = 0;

// ─── Types ─────────────────────────────────────────────────────────────

export type MatchOutcome = "home" | "draw" | "away";

export type GradeCap = "no_play" | "caution" | "watchlist" | null;

export type MatchResultSelectionReason =
  | "team_projection_value_agrees"
  | "team_projection_value_disagrees"
  | "team_projection_no_market"
  | "draw_projection_even"
  | "knockout_even_favorite";

export type SoccerMatchResultReconciliationInput = {
  /** λ_home from Dixon-Coles. */
  lambdaHome: number;
  /** λ_away from Dixon-Coles. */
  lambdaAway: number;
  /** Model P(home win) over the joint. */
  modelHome: number;
  /** Model P(draw) over the joint. */
  modelDraw: number;
  /** Model P(away win) over the joint. */
  modelAway: number;
  /** No-vig market P(home). NULL when no market data. */
  marketHome: number | null;
  /** No-vig market P(draw). NULL when no market data. */
  marketDraw: number | null;
  /** No-vig market P(away). NULL when no market data. */
  marketAway: number | null;
  /**
   * True in the GROUP STAGE (draw is a callable outcome); false in the
   * KNOCKOUT stage (an even projection resolves to the favorite, never a
   * bare "Draw"). Caller passes !games.postseason.
   */
  drawPickable: boolean;
  /** True if the prediction row is locked. */
  isLocked: boolean;
  /** Locked snapshot to return verbatim when isLocked is true. */
  lockedReconciliation: SoccerMatchResultReconciliation | null;
};

export type SoccerMatchResultReconciliation = {
  // ─── RAW values preserved for audit ───────────────────────────────
  raw_projected_home_goals: number;
  raw_projected_away_goals: number;
  raw_projected_margin: number;
  model_home: number;
  model_draw: number;
  model_away: number;
  probability_outcome: MatchOutcome;
  value_outcome: MatchOutcome | null;
  home_edge_pp: number | null;
  draw_edge_pp: number | null;
  away_edge_pp: number | null;
  projection_outcome: MatchOutcome;

  // ─── RECONCILED (displayed) values ────────────────────────────────
  reconciled_outcome: MatchOutcome;
  reconciled_confidence_pct: number;
  reconciled_edge_pp: number | null;
  displayed_outcome: MatchOutcome;

  // ─── Audit ────────────────────────────────────────────────────────
  selection_reason: MatchResultSelectionReason;
  side_disagree_flags: ReadonlyArray<string>;
  grade_cap: GradeCap;
  hold: boolean;
  invariant_pick_matches_projection: boolean;
  used_locked_snapshot: boolean;
};

// ─── Internal helpers ─────────────────────────────────────────────────

function argmaxOutcome(h: number, d: number, a: number): MatchOutcome {
  if (h >= d && h >= a) return "home";
  if (a >= d && a >= h) return "away";
  return "draw";
}

/** True when the projected scoreline is essentially even (coin flip). */
function inEvenBand(margin: number): boolean {
  return Math.abs(margin) <= MARGIN_DRAW_BAND_GOALS;
}

/**
 * Outcome implied by the projected scoreline.
 * Group stage: an even projection → draw.
 * Knockout: draws collapse to the projected favorite (margin sign; higher
 * win-prob on an exact tie) — never a bare "Draw".
 */
function projectionOutcome(
  margin: number,
  drawPickable: boolean,
  modelHome: number,
  modelAway: number,
): MatchOutcome {
  if (margin > MARGIN_DRAW_BAND_GOALS) return "home";
  if (margin < -MARGIN_DRAW_BAND_GOALS) return "away";
  // Even projection.
  if (drawPickable) return "draw";
  // Knockout: resolve to the favorite. Margin sign first, model win-prob
  // as the tiebreak on an exact 0.0 margin.
  if (margin > 0) return "home";
  if (margin < 0) return "away";
  return modelHome >= modelAway ? "home" : "away";
}

function modelProbFor(input: SoccerMatchResultReconciliationInput, o: MatchOutcome): number {
  return o === "home" ? input.modelHome : o === "away" ? input.modelAway : input.modelDraw;
}

function marketProbFor(input: SoccerMatchResultReconciliationInput, o: MatchOutcome): number | null {
  return o === "home" ? input.marketHome : o === "away" ? input.marketAway : input.marketDraw;
}

function edgePpFor(input: SoccerMatchResultReconciliationInput, o: MatchOutcome): number | null {
  const mkt = marketProbFor(input, o);
  if (mkt === null) return null;
  return (modelProbFor(input, o) - mkt) * 100;
}

function valueOutcome(input: SoccerMatchResultReconciliationInput): {
  side: MatchOutcome | null;
  homeEdge: number | null;
  drawEdge: number | null;
  awayEdge: number | null;
} {
  const homeEdge = edgePpFor(input, "home");
  const drawEdge = edgePpFor(input, "draw");
  const awayEdge = edgePpFor(input, "away");
  if (homeEdge === null || drawEdge === null || awayEdge === null) {
    return { side: null, homeEdge, drawEdge, awayEdge };
  }
  let side: MatchOutcome = "home";
  let best = homeEdge;
  if (drawEdge > best) {
    side = "draw";
    best = drawEdge;
  }
  if (awayEdge > best) {
    side = "away";
    best = awayEdge;
  }
  return { side, homeEdge, drawEdge, awayEdge };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ─── Main reconciliation ──────────────────────────────────────────────

export function reconcileSoccerMatchResult(
  input: SoccerMatchResultReconciliationInput,
): SoccerMatchResultReconciliation {
  if (input.isLocked && input.lockedReconciliation !== null) {
    return { ...input.lockedReconciliation, used_locked_snapshot: true };
  }

  const margin = input.lambdaHome - input.lambdaAway;
  const even = inEvenBand(margin);
  const projection_outcome = projectionOutcome(
    margin,
    input.drawPickable,
    input.modelHome,
    input.modelAway,
  );
  const probability_outcome = argmaxOutcome(input.modelHome, input.modelDraw, input.modelAway);
  const { side: value_outcome, homeEdge, drawEdge, awayEdge } = valueOutcome(input);

  // The DISPLAYED pick always follows the projected scoreline. This is the
  // coherence invariant: pick can never contradict the projection.
  const reconciled_outcome = projection_outcome;
  const reconciled_confidence_pct = round1(modelProbFor(input, reconciled_outcome) * 100);
  const reconciled_edge_pp = edgePpFor(input, reconciled_outcome);

  const hasMarket = homeEdge !== null && drawEdge !== null && awayEdge !== null;

  // ─── Disagree flags ───────────────────────────────────────────────
  const flags: string[] = [];
  if (probability_outcome !== reconciled_outcome) {
    flags.push("probability_outcome_disagrees_with_projection");
  }
  if (value_outcome !== null && value_outcome !== reconciled_outcome) {
    flags.push("value_outcome_disagrees_with_projection");
  }
  if (reconciled_edge_pp !== null && reconciled_edge_pp < NEGATIVE_EDGE_CAUTION_PP) {
    flags.push("projected_side_negative_edge");
  }

  // ─── Selection reason + grade cap ─────────────────────────────────
  let selection_reason: MatchResultSelectionReason;
  let grade_cap: GradeCap = null;

  if (projection_outcome === "draw") {
    // Group-stage projected even → coin flip. We SHOW the draw (the model
    // can finally call it) but never over-sell it as a hard Lean
    // pre-calibration.
    selection_reason = "draw_projection_even";
    grade_cap = "watchlist";
  } else if (even) {
    // Knockout even projection: we picked the slim favorite (no draw in
    // knockout). It is a coin flip dressed as a side → caution, never Lean.
    selection_reason = "knockout_even_favorite";
    grade_cap = "caution";
  } else if (!hasMarket) {
    selection_reason = "team_projection_no_market";
    grade_cap = "watchlist";
  } else if (value_outcome === reconciled_outcome && (reconciled_edge_pp ?? -1) >= NEGATIVE_EDGE_CAUTION_PP) {
    // Projection AND value agree on the same team with non-negative edge:
    // coherent value. Let the grade ladder decide (can reach Lean).
    selection_reason = "team_projection_value_agrees";
    grade_cap = null;
  } else {
    // We project a team but the value/market leans away (or the projected
    // side is negative-edge): low conviction.
    selection_reason = "team_projection_value_disagrees";
    grade_cap = "caution";
  }

  const invariant_pick_matches_projection = reconciled_outcome === projection_outcome;

  return {
    raw_projected_home_goals: input.lambdaHome,
    raw_projected_away_goals: input.lambdaAway,
    raw_projected_margin: round3(margin),
    model_home: round3(input.modelHome),
    model_draw: round3(input.modelDraw),
    model_away: round3(input.modelAway),
    probability_outcome,
    value_outcome,
    home_edge_pp: homeEdge === null ? null : round1(homeEdge),
    draw_edge_pp: drawEdge === null ? null : round1(drawEdge),
    away_edge_pp: awayEdge === null ? null : round1(awayEdge),
    projection_outcome,

    reconciled_outcome,
    reconciled_confidence_pct,
    reconciled_edge_pp: reconciled_edge_pp === null ? null : round1(reconciled_edge_pp),
    displayed_outcome: reconciled_outcome,

    selection_reason,
    side_disagree_flags: flags,
    grade_cap,
    hold: false,
    invariant_pick_matches_projection,
    used_locked_snapshot: false,
  };
}
