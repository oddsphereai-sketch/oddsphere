/**
 * MLB totals projection / side reconciliation — pure module.
 *
 * Daniel's 2026-06-12 contract (revised after first iteration was too
 * coarse): the customer-facing card MUST show one coherent final
 * prediction. Raw model internals can disagree, but the displayed
 * side + total + scores + confidence + edge + grade must all come
 * from the same final reconciled view.
 *
 * SIDE-SELECTION POLICY (binding).
 *
 *   The final side is chosen by a HOLISTIC weighted vote across all
 *   four signals — NOT by any single signal automatically winning.
 *
 *     • raw_probability_side  — argmax of Poisson probability
 *     • raw_value_side        — argmax of edge_pp vs no-vig market
 *     • mean_direction_side   — sign(raw_projected_total − line)
 *     • market_pressure_side  — money + line-movement direction
 *                               (null when either input is missing;
 *                               V1 caller always passes null)
 *
 *   Each signal votes for its side weighted by:
 *     vote = signal_strength × signal_weight
 *
 *   where signal_strength is in [0,1] (higher = stronger signal) and
 *   signal_weight reflects how much we trust that signal class.
 *
 *   `mean_direction_side` carries a HEAVIER weight (MEAN_WEIGHT = 1.5)
 *   because it directly controls the score/side coherence invariant,
 *   but it does NOT automatically win — strong opposing signals can
 *   outvote it.
 *
 * COHERENCE CHECK (binding).
 *
 *   After the holistic vote produces a `holistic_side`:
 *
 *     1. If holistic_side agrees with mean_direction_side (or mean
 *        is null at exact-equality push risk), the holistic side IS
 *        the final reconciled side. Scores stay raw. Done.
 *
 *     2. If holistic_side disagrees with mean_direction_side, the
 *        raw projected scores would contradict the holistic side
 *        on the card. V1 does NOT scale scores cosmetically AND
 *        does not yet have access to documented model/reviewer
 *        adjustment signals that would justify overriding the raw
 *        projection. So V1 REVISES THE SIDE back to mean_direction
 *        and surfaces the conflict via a strong grade cap
 *        (no_play). The holistic reasoning is preserved in audit —
 *        the auditor sees holistic_side, the disagreement flags,
 *        and side_selection_reason = "holistic_overruled_by_mean_coherence".
 *
 *   V2 (future) will allow holistic_side to actually override
 *   mean_direction_side when a documented adjustment signal
 *   (reviewer override, RLM, etc.) justifies adjusting the
 *   projection. That's deferred — V1 must not silently fabricate
 *   scaled scores.
 *
 * CONFIDENCE (binding).
 *
 *   `reconciled_confidence_pct` = the raw model probability for the
 *   reconciled side, expressed 0–100. NO inflation. NO floor lift.
 *   NO market lift. If the model says 49.2% Over and the reconciler
 *   displays Over, the card shows 49% — that's the model's honest
 *   read on Over. Daniel's rule: "Do not improve the product by
 *   making the model less honest."
 *
 * LOCK CONTRACT (binding).
 *
 *   When `isLocked === true` AND `lockedReconciliation !== null`,
 *   the locked snapshot is returned verbatim. Post-lock recomputes
 *   never mutate the displayed side / total / scores / confidence.
 *
 * Pure module. No DB. No HTTP.
 */

// ─── Tunables (binding) ────────────────────────────────────────────────

/**
 * Signal weights for the holistic vote. Mean direction is heavier
 * because it controls the score/side coherence invariant; it does NOT
 * automatically win. Market pressure is lighter because public money
 * + line movement can lag or be noisy in V1.
 */
export const MEAN_WEIGHT = 1.5;
export const PROBABILITY_WEIGHT = 1.0;
export const VALUE_WEIGHT = 1.0;
export const PRESSURE_WEIGHT = 0.5;

/** Normalization caps for converting raw signal magnitude → [0,1] strength. */
export const MEAN_STRENGTH_NORM_RUNS = 1.0;   // |posterior − line| in runs at max strength
export const VALUE_STRENGTH_NORM_PP = 5.0;    // |edge_pp| in pp at max strength

/**
 * V1 market_pressure_side strength. The V1 caller passes null for
 * marketPressureSide; this only matters when a future PR injects it.
 */
export const PRESSURE_STRENGTH = 0.5;

/**
 * Reconciled confidence below this is "low conviction" — automatic
 * cap to caution. Mirrors the spirit of
 * verdictDerivation.PLAYABLE_CONFIDENCE_FLOOR (53) at a stricter 50
 * so the cap fires before the global verdict-level no_play kicks in.
 */
export const LOW_CONVICTION_CONFIDENCE_PCT = 50;

/**
 * |edge_pp| below this on the reconciled side counts as "small edge."
 */
export const SMALL_EDGE_BAND_PP = 2.0;

/**
 * Strong negative edge threshold. Below this on the reconciled side
 * forces the cap to "no_play."
 */
export const NEGATIVE_EDGE_NO_PLAY_PP = 1.0;

/**
 * 2026-06-15 model-coherence rule (ported from soccer). Below this
 * displayed-side confidence an MLB total is a coin flip — capped at Watchlist
 * (market_watch), never a public Lean/Best Angle. A public play needs
 * probability support (confidence ≥ this floor) AND market value (positive
 * edge, enforced by the grade ladder). Matches the 53% playable floor.
 */
export const TOTALS_PUBLIC_CONFIDENCE_FLOOR = 53;

/** Tolerance for treating posterior as exactly on the line (push risk). */
const MEAN_DIRECTION_NULL_EPSILON = 1e-9;

// ─── Types ────────────────────────────────────────────────────────────

export type TotalSide = "over" | "under";

export type GradeCap = "no_play" | "caution" | "watchlist" | null;

export type SideSelectionReason =
  // 2026-06-15 probability-driven rule — displayed side = model's more-likely side.
  | "probability_aligned_with_mean"          // probability side == mean direction (clean)
  | "probability_over_mean"                  // divergence: right-skew lifts the mean above the line, P favors the other side
  | "probability_coin_flip"                  // displayed-side confidence below the public floor
  // legacy reasons retained for verbatim-returned LOCKED snapshots persisted pre-change.
  | "all_agree"                              // every available signal pointed to the same side
  | "holistic_aligned_with_mean"             // weighted vote winner matches mean direction
  | "holistic_overruled_by_mean_coherence"   // weighted vote disagreed with mean; V1 reverts to mean
  | "push_risk_default_to_probability";      // mean is null (exact tie); hold

export type ProjectionReconciliationReason =
  | "raw_aligned"               // reconciled side agrees with raw total direction → keep raw scores
  | "push_risk_no_adjustment";  // mean is null → keep raw scores + hold

export type TotalProjectionReconciliationInput = {
  rawProjectedAwayScore: number;
  rawProjectedHomeScore: number;
  rawProjectedTotal: number;
  marketTotal: number | null;
  rawProbabilityOver: number;            // [0, 1]
  marketImpliedOver: number | null;       // no-vig market P(Over), null if missing
  marketPressureSide: TotalSide | null;   // V1 caller passes null
  isLocked: boolean;
  lockedReconciliation: TotalProjectionReconciliation | null;
};

export type SignalAuditTrail = {
  /** Side this signal voted for. null when the signal is unavailable. */
  side: TotalSide | null;
  /** Normalized strength in [0, 1] — 0 means "no contribution," 1 = max. */
  strength: number;
  /** Final weighted contribution = strength × class weight. */
  weighted_vote: number;
};

export type TotalProjectionReconciliation = {
  // ─── RAW values preserved internally for audit ────────────────────
  raw_projected_away_score: number;
  raw_projected_home_score: number;
  raw_projected_total: number;
  raw_probability_side: TotalSide;
  raw_probability_pct: number;
  raw_value_side: TotalSide | null;
  raw_over_edge_pp: number | null;
  raw_under_edge_pp: number | null;
  mean_direction_side: TotalSide | null;
  /** 2026-06-15 — true when the mean implies one side of the line but the
   *  probability favors the other (right-skew). Descriptive + a low-conviction
   *  signal for the grade cap. */
  mean_probability_divergence: boolean;
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

  // ─── RECONCILED values for customer-facing display + tracking ────
  reconciled_total_side: TotalSide;
  reconciled_total: number;
  reconciled_away_score: number;
  reconciled_home_score: number;
  /** HONEST raw probability of reconciled side, expressed 0–100. */
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

function chooseMeanDirection(projectedTotal: number, marketTotal: number | null): TotalSide | null {
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
  // 0 at p=0.5; 1 at p=0 or p=1. Linear scaling so a 60/40 read carries
  // strength 0.2, a 70/30 read carries strength 0.4, etc.
  return clamp01(Math.abs(p - 0.5) * 2);
}

function meanStrength(projectedTotal: number, marketTotal: number | null): number {
  if (marketTotal === null) return 0;
  return clamp01(Math.abs(projectedTotal - marketTotal) / MEAN_STRENGTH_NORM_RUNS);
}

function valueStrength(overEdgePp: number | null, underEdgePp: number | null, side: TotalSide | null): number {
  if (side === null) return 0;
  const edge = side === "over" ? overEdgePp : underEdgePp;
  if (edge === null) return 0;
  return clamp01(Math.abs(edge) / VALUE_STRENGTH_NORM_PP);
}

// ─── Main reconciliation ──────────────────────────────────────────────

export function reconcileTotalProjection(
  input: TotalProjectionReconciliationInput,
): TotalProjectionReconciliation {
  // Lock invariant — locked snapshots are returned verbatim.
  if (input.isLocked && input.lockedReconciliation !== null) {
    return { ...input.lockedReconciliation, used_locked_snapshot: true };
  }

  const raw_probability_side = chooseRawProbabilitySide(input.rawProbabilityOver);
  const raw_probability_pct = round1(probabilityForSide(input.rawProbabilityOver, raw_probability_side) * 100);
  const mean_direction_side = chooseMeanDirection(input.rawProjectedTotal, input.marketTotal);
  const { overEdgePp, underEdgePp, valueSide: raw_value_side } = computeEdges(
    input.rawProbabilityOver,
    input.marketImpliedOver,
  );
  const market_pressure_side = input.marketPressureSide;

  // ─── Holistic weighted vote ───────────────────────────────────────
  //
  // Each signal contributes vote = strength × class_weight to its
  // side. The side with the higher total weighted vote is the
  // holistic winner. Ties default to raw_probability_side (always
  // non-null), preserving the model's read when signals are silent.
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
    // Tie — fall back to raw probability side (the model's own read).
    holistic_side = raw_probability_side;
  } else {
    holistic_side = over_vote_total > under_vote_total ? "over" : "under";
  }

  // ─── Side = probability-driven (2026-06-15 model-coherence rule) ──
  // An Over/Under bet is binary: the side follows the model's MORE-LIKELY
  // outcome — P(over) vs P(under) — NOT the mean (projected total) vs the line.
  // A right-skewed run distribution can put the mean above the line while
  // P(under) > P(over); the old reconciler then reverted to the mean side and
  // published the LESS-likely outcome. The projected total/scores stay
  // DESCRIPTIVE; they no longer pick the side. The holistic vote is preserved
  // for the audit trail only. (Empirically MLB diverges far less than soccer —
  // ~1/117 — because run totals sit well above the skew; this is mostly a
  // structural guarantee that the published side is never the less-likely one.)
  const reconciled_total_side: TotalSide = raw_probability_side;
  // Push risk — projected total within a hair of the line (whole-line totals
  // can land exactly on the number). Kept as a hold so a coin-flip-at-the-line
  // total is never actionable.
  const hold = mean_direction_side === null;

  // Divergence: the mean implies one side of the line while the probability
  // favors the other (mean > median right-skew).
  const mean_probability_divergence =
    input.marketTotal !== null &&
    (input.rawProjectedTotal > input.marketTotal) !== (input.rawProbabilityOver >= 0.5);

  // ─── Scores + projection stay raw (descriptive) ──────────────────
  const reconciled_total = input.rawProjectedTotal;
  const reconciled_away_score = input.rawProjectedAwayScore;
  const reconciled_home_score = input.rawProjectedHomeScore;
  const projection_reconciliation_reason: ProjectionReconciliationReason =
    mean_direction_side !== null ? "raw_aligned" : "push_risk_no_adjustment";

  // ─── Confidence + edge for the displayed (probability) side ──────
  const reconciled_confidence_pct = round1(probabilityForSide(input.rawProbabilityOver, reconciled_total_side) * 100);
  const reconciled_edge_pp = edgeForSide(reconciled_total_side, overEdgePp, underEdgePp);

  // ─── Side selection reason (audit) ───────────────────────────────
  let side_selection_reason: SideSelectionReason;
  if (hold) side_selection_reason = "push_risk_default_to_probability";
  else if (mean_probability_divergence) side_selection_reason = "probability_over_mean";
  else if (reconciled_confidence_pct < TOTALS_PUBLIC_CONFIDENCE_FLOOR) side_selection_reason = "probability_coin_flip";
  else side_selection_reason = "probability_aligned_with_mean";

  // ─── Disagree flags ───────────────────────────────────────────────
  const flags: string[] = [];
  if (mean_direction_side !== null && mean_direction_side !== reconciled_total_side) {
    flags.push("mean_direction_disagrees_with_probability");
  }
  if (mean_probability_divergence) flags.push("mean_probability_divergence");
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
  if (reconciled_confidence_pct < TOTALS_PUBLIC_CONFIDENCE_FLOOR) {
    flags.push("below_public_confidence_floor");
  }
  if (hold) {
    flags.push("push_risk_hold");
  }

  // ─── Grade cap (coherence only — value-grading is the ladder's job) ─
  // Enforces only the PROBABILITY-SUPPORT half of a public play: push-risk
  // holds, coin-flips, and mean/probability divergence are capped (a read,
  // never a public Lean/Best Angle). It does NOT cap on negative value: the
  // displayed side is now ALWAYS the model's favored side (P ≥ 0.5), so the
  // grade ladder already lands a no-value pick at Market-Aligned (the
  // "Germany ML" principle) rather than a false Caution. Market-signal
  // confirmation (sharp money / line movement) will fold in here in a later,
  // evidence-backed pass (after the #48 calibration diagnostic).
  // 2026-06-15 — the pure-confidence coin-flip cap (confidence < public floor)
  // is intentionally NOT applied for MLB: evidence shows MLB total confidence is
  // poorly calibrated to outcomes (thin 50–53% Leans actually outperformed
  // higher-confidence ones in the 6/7+ sample), so a blind confidence floor is
  // not justified. The right totals confidence/edge thresholds are an
  // evidence-backed decision in the #48 calibration diagnostic (per the
  // "validate before hard cut" rule). The `below_public_confidence_floor` flag
  // + `probability_coin_flip` reason are still surfaced so #48 can find them.
  let grade_cap: GradeCap = null;
  if (hold) {
    grade_cap = "no_play"; // push risk at the line
  } else if (reconciled_confidence_pct < LOW_CONVICTION_CONFIDENCE_PCT) {
    grade_cap = "caution"; // safety — model barely favors its own side (≈ exact coin flip)
  } else if (mean_probability_divergence) {
    grade_cap = "watchlist"; // near-line right-skew → not a public play
  }

  // ─── Coherence invariant: displayed side IS the more-likely side ─
  const invariant_side_matches_total = reconciled_total_side === raw_probability_side;

  return {
    raw_projected_away_score: input.rawProjectedAwayScore,
    raw_projected_home_score: input.rawProjectedHomeScore,
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
    reconciled_away_score,
    reconciled_home_score,
    reconciled_confidence_pct,
    reconciled_edge_pp,
    displayed_total_side: reconciled_total_side,
    mean_probability_divergence,

    side_selection_reason,
    projection_reconciliation_reason,
    side_disagree_flags: flags,
    grade_cap,
    hold,
    invariant_side_matches_total,
    used_locked_snapshot: false,
  };
}
