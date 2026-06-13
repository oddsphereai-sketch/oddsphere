/**
 * Soccer (FIFA World Cup) totals projection / side reconciliation —
 * pure module.
 *
 * Direct port of the MLB v1 contract (lib/automodel/totalProjectionReconciliation.ts)
 * adapted for the Dixon-Coles model output shape:
 *
 *   • `posterior_total` (= λ_home + λ_away) drives mean direction.
 *   • `raw_probability_over` comes from the Dixon-Coles joint score
 *     distribution at the canonical line — same field that already
 *     populates the model.total probabilities.
 *   • `market_implied_over` is the de-vigged no-vig market P(over) at
 *     the line, computed upstream by `soccerMarketComparison`.
 *   • `market_pressure_side` is null in V1 — WC has the
 *     `empty_as_of_probe` SharpAPI splits contract per
 *     [[project-wc-launch-contract]]; no line_history wired yet.
 *
 * Daniel's contract (carried over from the MLB patch — see
 * lib/automodel/totalProjectionReconciliation.ts for the original
 * narrative):
 *
 *   1. Holistic weighted vote across all four signals:
 *        mean × 1.5
 *        probability × 1.0
 *        value × 1.0
 *        market_pressure × 0.5  (null in V1 → 0)
 *      Mean direction is HEAVILY weighted as the coherence guard but
 *      does NOT automatically win.
 *
 *   2. Coherence check after the holistic vote:
 *        • holistic_side === mean_direction_side → displayed_side =
 *          holistic_side. Raw goals stay raw.
 *        • holistic_side !== mean_direction_side → V1 reverts to mean
 *          direction and caps grade to no_play, preserving the
 *          score↔side coherence invariant. V2 (future) will allow
 *          holistic to override when a documented reviewer/lineup/
 *          referee adjustment justifies revising the projection.
 *        • mean_direction_side === null (exact tie at the line) →
 *          push-risk hold + no_play.
 *
 *   3. Confidence is HONEST. `reconciled_confidence_pct` = raw
 *      Dixon-Coles P(displayed_side) × 100. No inflation.
 *
 *   4. Goals stay raw in V1 (no cosmetic scaling). A future PR can
 *      wire a documented adjustment input.
 *
 *   5. Locked snapshots returned verbatim.
 *
 * Pure module. No DB. No HTTP.
 */

// ─── Tunables (binding — matches MLB v1) ───────────────────────────────

export const MEAN_WEIGHT = 1.5;
export const PROBABILITY_WEIGHT = 1.0;
export const VALUE_WEIGHT = 1.0;
export const PRESSURE_WEIGHT = 0.5;

/** |posterior − line| in expected goals at max strength. Soccer totals run
 * at much lower magnitudes than MLB (~2.5 line vs ~8.5 line), so the
 * normalization is tighter than MLB's 1.0 runs. 0.5 goals → strength 1. */
export const MEAN_STRENGTH_NORM_GOALS = 0.5;
/** |edge_pp| at max strength. Soccer market spreads are tighter than MLB
 * for top markets; 5 pp keeps parity with the MLB norm. */
export const VALUE_STRENGTH_NORM_PP = 5.0;
export const PRESSURE_STRENGTH = 0.5;

/**
 * Reconciled confidence below this is "low conviction" — automatic
 * cap to caution. Matches MLB at 50% (also below the standard 53%
 * playable floor in verdictDerivation).
 */
export const LOW_CONVICTION_CONFIDENCE_PCT = 50;
export const SMALL_EDGE_BAND_PP = 2.0;
export const NEGATIVE_EDGE_NO_PLAY_PP = 1.0;

// 2026-06-13: widened from 1e-9 to a real push band. The mean (E[total]) can sit
// a hair over the line while the right-skewed score distribution makes P(under) >
// P(over) — so picking the side by "mean vs line" showed "Over 2.5" for a 0.9–1.6
// low-scoring projection that the model actually thinks goes UNDER. When the
// projection is within a quarter-goal of the line it's a coin flip: resolve to
// the model's more-likely (probability) side and hold it as a no-play, so the
// displayed side never contradicts the projection.
const MEAN_DIRECTION_NULL_EPSILON = 0.25;

// ─── Types ────────────────────────────────────────────────────────────

export type TotalSide = "over" | "under";

export type GradeCap = "no_play" | "caution" | "watchlist" | null;

export type SideSelectionReason =
  | "all_agree"
  | "holistic_aligned_with_mean"
  | "holistic_overruled_by_mean_coherence"
  | "push_risk_default_to_probability";

export type ProjectionReconciliationReason =
  | "raw_aligned"
  | "push_risk_no_adjustment";

export type SoccerTotalReconciliationInput = {
  /** λ_away from Dixon-Coles. */
  rawProjectedAwayGoals: number;
  /** λ_home from Dixon-Coles. */
  rawProjectedHomeGoals: number;
  /** λ_home + λ_away. */
  rawProjectedTotal: number;
  /** Market line. NULL when no market data. */
  marketTotal: number | null;
  /** Dixon-Coles raw P(over) at the canonical line. */
  rawProbabilityOver: number;
  /** No-vig market P(over) at the line. NULL if missing. */
  marketImpliedOver: number | null;
  /** V1 caller passes null (WC sharp_signals empty_as_of_probe). */
  marketPressureSide: TotalSide | null;
  /** True if the prediction row is locked. */
  isLocked: boolean;
  /** Locked snapshot to return verbatim when isLocked is true. */
  lockedReconciliation: SoccerTotalReconciliation | null;
};

export type SignalAuditTrail = {
  side: TotalSide | null;
  strength: number;
  weighted_vote: number;
};

export type SoccerTotalReconciliation = {
  // ─── RAW values preserved for audit ───────────────────────────────
  raw_projected_away_goals: number;
  raw_projected_home_goals: number;
  raw_projected_total: number;
  raw_probability_side: TotalSide;
  raw_probability_pct: number;
  raw_value_side: TotalSide | null;
  raw_over_edge_pp: number | null;
  raw_under_edge_pp: number | null;
  mean_direction_side: TotalSide | null;
  market_pressure_side: TotalSide | null;

  // ─── Holistic vote audit ──────────────────────────────────────────
  holistic_side: TotalSide;
  signal_audit: {
    probability: SignalAuditTrail;
    value: SignalAuditTrail;
    mean: SignalAuditTrail;
    market_pressure: SignalAuditTrail;
  };
  over_vote_total: number;
  under_vote_total: number;

  // ─── RECONCILED (displayed) values ────────────────────────────────
  reconciled_total_side: TotalSide;
  reconciled_total: number;
  reconciled_away_goals: number;
  reconciled_home_goals: number;
  reconciled_confidence_pct: number;
  reconciled_edge_pp: number | null;
  displayed_total_side: TotalSide;

  // ─── Audit ────────────────────────────────────────────────────────
  side_selection_reason: SideSelectionReason;
  projection_reconciliation_reason: ProjectionReconciliationReason;
  side_disagree_flags: ReadonlyArray<string>;
  grade_cap: GradeCap;
  hold: boolean;
  invariant_side_matches_total: boolean;
  used_locked_snapshot: boolean;
};

// ─── Internal helpers ─────────────────────────────────────────────────

function chooseRawProbabilitySide(p: number): TotalSide {
  return p >= 0.5 ? "over" : "under";
}

function chooseMeanDirection(
  projectedTotal: number,
  marketTotal: number | null,
): TotalSide | null {
  if (marketTotal === null) return null;
  if (projectedTotal > marketTotal + MEAN_DIRECTION_NULL_EPSILON) return "over";
  if (projectedTotal < marketTotal - MEAN_DIRECTION_NULL_EPSILON) return "under";
  return null;
}

function computeEdges(modelOverProb: number, marketOverProb: number | null): {
  overEdgePp: number | null;
  underEdgePp: number | null;
  valueSide: TotalSide | null;
} {
  if (marketOverProb === null) return { overEdgePp: null, underEdgePp: null, valueSide: null };
  const overEdgePp = (modelOverProb - marketOverProb) * 100;
  const underEdgePp = ((1 - modelOverProb) - (1 - marketOverProb)) * 100;
  let valueSide: TotalSide | null = null;
  if (overEdgePp > underEdgePp) valueSide = "over";
  else if (underEdgePp > overEdgePp) valueSide = "under";
  return { overEdgePp, underEdgePp, valueSide };
}

function probabilityForSide(modelOverProb: number, side: TotalSide): number {
  return side === "over" ? modelOverProb : 1 - modelOverProb;
}

function edgeForSide(
  side: TotalSide,
  overEdgePp: number | null,
  underEdgePp: number | null,
): number | null {
  return side === "over" ? overEdgePp : underEdgePp;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function probabilityStrength(p: number): number {
  return clamp01(Math.abs(p - 0.5) * 2);
}

function meanStrength(projectedTotal: number, marketTotal: number | null): number {
  if (marketTotal === null) return 0;
  return clamp01(Math.abs(projectedTotal - marketTotal) / MEAN_STRENGTH_NORM_GOALS);
}

function valueStrength(
  overEdgePp: number | null,
  underEdgePp: number | null,
  side: TotalSide | null,
): number {
  if (side === null) return 0;
  const edge = side === "over" ? overEdgePp : underEdgePp;
  if (edge === null) return 0;
  return clamp01(Math.abs(edge) / VALUE_STRENGTH_NORM_PP);
}

// ─── Main reconciliation ──────────────────────────────────────────────

export function reconcileSoccerTotal(
  input: SoccerTotalReconciliationInput,
): SoccerTotalReconciliation {
  if (input.isLocked && input.lockedReconciliation !== null) {
    return { ...input.lockedReconciliation, used_locked_snapshot: true };
  }

  const raw_probability_side = chooseRawProbabilitySide(input.rawProbabilityOver);
  const raw_probability_pct = round1(
    probabilityForSide(input.rawProbabilityOver, raw_probability_side) * 100,
  );
  const mean_direction_side = chooseMeanDirection(input.rawProjectedTotal, input.marketTotal);
  const { overEdgePp, underEdgePp, valueSide: raw_value_side } = computeEdges(
    input.rawProbabilityOver,
    input.marketImpliedOver,
  );
  const market_pressure_side = input.marketPressureSide;

  // ─── Holistic weighted vote ───────────────────────────────────────
  const probStrength = probabilityStrength(input.rawProbabilityOver);
  const meanStr = meanStrength(input.rawProjectedTotal, input.marketTotal);
  const valStr = valueStrength(overEdgePp, underEdgePp, raw_value_side);
  const pressureStr = market_pressure_side === null ? 0 : PRESSURE_STRENGTH;

  const probWeightedVote = probStrength * PROBABILITY_WEIGHT;
  const meanWeightedVote = meanStr * MEAN_WEIGHT;
  const valueWeightedVote = valStr * VALUE_WEIGHT;
  const pressureWeightedVote = pressureStr * PRESSURE_WEIGHT;

  let over_vote_total = 0;
  let under_vote_total = 0;
  if (raw_probability_side === "over") over_vote_total += probWeightedVote;
  else under_vote_total += probWeightedVote;
  if (raw_value_side === "over") over_vote_total += valueWeightedVote;
  else if (raw_value_side === "under") under_vote_total += valueWeightedVote;
  if (mean_direction_side === "over") over_vote_total += meanWeightedVote;
  else if (mean_direction_side === "under") under_vote_total += meanWeightedVote;
  if (market_pressure_side === "over") over_vote_total += pressureWeightedVote;
  else if (market_pressure_side === "under") under_vote_total += pressureWeightedVote;

  let holistic_side: TotalSide;
  if (Math.abs(over_vote_total - under_vote_total) < 1e-9) {
    holistic_side = raw_probability_side;
  } else {
    holistic_side = over_vote_total > under_vote_total ? "over" : "under";
  }

  // ─── Side reconciliation + coherence check ───────────────────────
  let reconciled_total_side: TotalSide;
  let side_selection_reason: SideSelectionReason;
  let hold = false;

  if (mean_direction_side === null) {
    // Projection within a hair of the line. 2026-06-13 (Daniel): the over/under
    // pick must AGREE with the projected total — if we project 2.59 we should say
    // Over 2.5, never Under. So the side follows the projection's sign vs the
    // line (not the right-skew probability, which can disagree near the line).
    // Only a projection EXACTLY on the line falls back to the probability side.
    // It's a neutral read (Watchlist cap below), never a hard hold.
    const mt = input.marketTotal;
    reconciled_total_side =
      mt === null
        ? raw_probability_side
        : input.rawProjectedTotal > mt
          ? "over"
          : input.rawProjectedTotal < mt
            ? "under"
            : raw_probability_side;
    side_selection_reason = "push_risk_default_to_probability";
    hold = false;
  } else if (holistic_side === mean_direction_side) {
    reconciled_total_side = holistic_side;
    const allAgree =
      raw_probability_side === mean_direction_side &&
      (raw_value_side === mean_direction_side || raw_value_side === null) &&
      (market_pressure_side === mean_direction_side || market_pressure_side === null);
    side_selection_reason = allAgree ? "all_agree" : "holistic_aligned_with_mean";
  } else {
    reconciled_total_side = mean_direction_side;
    side_selection_reason = "holistic_overruled_by_mean_coherence";
  }

  // ─── Goals stay raw in V1 ────────────────────────────────────────
  const reconciled_total = input.rawProjectedTotal;
  const reconciled_away_goals = input.rawProjectedAwayGoals;
  const reconciled_home_goals = input.rawProjectedHomeGoals;
  const projection_reconciliation_reason: ProjectionReconciliationReason =
    mean_direction_side !== null ? "raw_aligned" : "push_risk_no_adjustment";

  // ─── Confidence + edge for reconciled side (honest) ──────────────
  const reconciled_confidence_pct = round1(
    probabilityForSide(input.rawProbabilityOver, reconciled_total_side) * 100,
  );
  const reconciled_edge_pp = edgeForSide(reconciled_total_side, overEdgePp, underEdgePp);

  // ─── Disagree flags ───────────────────────────────────────────────
  const flags: string[] = [];
  if (raw_probability_side !== reconciled_total_side) {
    flags.push("probability_side_disagrees_with_reconciled");
  }
  if (raw_value_side !== null && raw_value_side !== reconciled_total_side) {
    flags.push("value_side_disagrees_with_reconciled");
  }
  if (market_pressure_side !== null && market_pressure_side !== reconciled_total_side) {
    flags.push("market_pressure_disagrees_with_reconciled");
  }
  if (reconciled_edge_pp !== null && reconciled_edge_pp < 0) {
    flags.push("reconciled_side_negative_edge");
  }
  if (reconciled_edge_pp !== null && reconciled_edge_pp < -NEGATIVE_EDGE_NO_PLAY_PP) {
    flags.push("reconciled_side_strong_negative_edge");
  }
  if (reconciled_confidence_pct < LOW_CONVICTION_CONFIDENCE_PCT) {
    flags.push("reconciled_confidence_below_conviction");
  }
  if (side_selection_reason === "holistic_overruled_by_mean_coherence") {
    flags.push("holistic_vote_overruled_by_coherence");
  }
  if (hold) flags.push("push_risk_hold");

  // ─── Grade cap ────────────────────────────────────────────────────
  let grade_cap: GradeCap = null;
  if (side_selection_reason === "push_risk_default_to_probability") {
    // Projection on the line → a neutral read, capped at Watchlist (never No
    // Play, never an actionable Lean on a coin-flip total).
    grade_cap = "watchlist";
  } else if (side_selection_reason === "holistic_overruled_by_mean_coherence") {
    grade_cap = "no_play";
  } else if (reconciled_edge_pp !== null && reconciled_edge_pp < -NEGATIVE_EDGE_NO_PLAY_PP) {
    grade_cap = "no_play";
  } else if (reconciled_confidence_pct < LOW_CONVICTION_CONFIDENCE_PCT) {
    grade_cap = "caution";
  } else if (
    reconciled_edge_pp !== null && reconciled_edge_pp < 0 &&
    (flags.includes("value_side_disagrees_with_reconciled") ||
      flags.includes("market_pressure_disagrees_with_reconciled"))
  ) {
    grade_cap = "caution";
  } else if (
    flags.includes("value_side_disagrees_with_reconciled") &&
    flags.includes("market_pressure_disagrees_with_reconciled")
  ) {
    grade_cap = "caution";
  } else if (
    flags.includes("probability_side_disagrees_with_reconciled") ||
    flags.includes("value_side_disagrees_with_reconciled") ||
    flags.includes("market_pressure_disagrees_with_reconciled")
  ) {
    grade_cap = "watchlist";
  }

  // ─── Coherence invariant assertion ────────────────────────────────
  let invariant_side_matches_total: boolean;
  if (mean_direction_side === null) {
    invariant_side_matches_total = true;
  } else {
    invariant_side_matches_total =
      (reconciled_total_side === "over" && reconciled_total > (input.marketTotal ?? Infinity)) ||
      (reconciled_total_side === "under" && reconciled_total < (input.marketTotal ?? -Infinity));
  }

  return {
    raw_projected_away_goals: input.rawProjectedAwayGoals,
    raw_projected_home_goals: input.rawProjectedHomeGoals,
    raw_projected_total: input.rawProjectedTotal,
    raw_probability_side,
    raw_probability_pct,
    raw_value_side,
    raw_over_edge_pp: overEdgePp,
    raw_under_edge_pp: underEdgePp,
    mean_direction_side,
    market_pressure_side,

    holistic_side,
    signal_audit: {
      probability: {
        side: raw_probability_side,
        strength: round3(probStrength),
        weighted_vote: round3(probWeightedVote),
      },
      value: {
        side: raw_value_side,
        strength: round3(valStr),
        weighted_vote: round3(valueWeightedVote),
      },
      mean: {
        side: mean_direction_side,
        strength: round3(meanStr),
        weighted_vote: round3(meanWeightedVote),
      },
      market_pressure: {
        side: market_pressure_side,
        strength: round3(pressureStr),
        weighted_vote: round3(pressureWeightedVote),
      },
    },
    over_vote_total: round3(over_vote_total),
    under_vote_total: round3(under_vote_total),

    reconciled_total_side,
    reconciled_total,
    reconciled_away_goals,
    reconciled_home_goals,
    reconciled_confidence_pct,
    reconciled_edge_pp,
    displayed_total_side: reconciled_total_side,

    side_selection_reason,
    projection_reconciliation_reason,
    side_disagree_flags: flags,
    grade_cap,
    hold,
    invariant_side_matches_total,
    used_locked_snapshot: false,
  };
}
