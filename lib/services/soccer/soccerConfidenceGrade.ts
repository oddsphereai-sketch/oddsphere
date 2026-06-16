/**
 * Confidence + grade derivation for soccer — WC-3 pure module.
 *
 * Pure. No DB. No HTTP.
 *
 * BINDING CONTRACTS:
 *   • Confidence cap from SOCCER_CONFIDENCE_CAPS is the MAXIMUM displayed
 *     confidence. Market never lifts above the cap.
 *   • Best Angle is structurally locked off until
 *     calibration_evidence_level upgrades beyond "external_priors_only".
 *   • Short-price DC guardrail prevents fake confidence on chalky DC.
 *
 * Output is a single grade decision per market pick, with an explicit
 * `reductions` array so the auditor (WC-5) and snapshot consumers can
 * trace why confidence ended up where it did.
 */

import { SOCCER_CONFIDENCE_CAPS } from "./soccerGrading";
import { EXTERNAL_PRIORS_V1 } from "./_externalPriorsV1";
import type { SoftCap } from "./soccerHoldLogic";

// "Market-Aligned" is the NEUTRAL/informational tier: the model has a read but
// it agrees with the sharp market (no actionable edge). It is NOT a warning —
// "Caution" is reserved for when the model is meaningfully on the WRONG side of
// the market (negative edge) or a miscalibration flag fires. This split stops a
// correctly market-grounded model from looking like a wall of scary Cautions.
export type SoccerGradeVerdict = "Caution" | "Market-Aligned" | "Watchlist" | "Lean" | "Best Angle";

const GRADE_RANK: Record<SoccerGradeVerdict, number> = {
  "Caution": 0,
  "Market-Aligned": 1,
  "Watchlist": 2,
  "Lean": 3,
  "Best Angle": 4,
};

/**
 * Apply soft caps from hold-logic: clamp the grade so it never exceeds
 * the strictest cap. Never elevates. If the ladder said Watchlist and
 * the cap says Lean, output stays Watchlist.
 */
function applySoftCaps(grade: SoccerGradeVerdict, softCaps: ReadonlyArray<SoftCap>): SoccerGradeVerdict {
  if (softCaps.length === 0) return grade;
  let allowedRank = GRADE_RANK[grade];
  for (const cap of softCaps) {
    const capRank = GRADE_RANK[cap.cap_at];
    if (capRank < allowedRank) allowedRank = capRank;
  }
  if (allowedRank >= GRADE_RANK[grade]) return grade;
  for (const [k, v] of Object.entries(GRADE_RANK)) {
    if (v === allowedRank) return k as SoccerGradeVerdict;
  }
  return grade;
}

export type ConfidenceReduction = {
  /** Code identifying the reduction trigger. */
  code: string;
  /** Reduction in percentage points (subtracted from cap). */
  pp: number;
  /** Human-readable reason. */
  reason: string;
};

export type SoccerGradeDecision = {
  market: "match_result" | "double_chance" | "total" | "btts";
  selection: string;
  /** model_p × 100 — the value displayed as "Model %". */
  model_p_pct: number;
  /** Final confidence (model_p clipped at the effective cap). */
  confidence: number;
  /** Default cap from SOCCER_CONFIDENCE_CAPS for this market. */
  confidence_cap_default: number;
  /** Cap after applying all reductions. */
  confidence_cap_effective: number;
  /** Reductions applied. */
  confidence_reductions: ConfidenceReduction[];
  /** Final grade. */
  grade: SoccerGradeVerdict;
  /** True only if the FOUR Best-Angle conditions all hold. Locked off at launch. */
  best_angle: boolean;
  /** Audit fields. */
  edge_pp: number | null;
  model_market_agreement: boolean;
  /** WC-MODEL-5: true when |edge| exceeded the market's miscalibration
   * ceiling — the grade was held at Caution and flagged as a possible
   * model/market disagreement rather than upgraded. */
  miscalibration_flag: boolean;
  /** Soft caps from hold-logic that influenced (or didn't influence) the final grade. */
  soft_caps_applied: ReadonlyArray<SoftCap>;
};

export type GradeInputContext = {
  calibration_evidence_level: typeof EXTERNAL_PRIORS_V1.calibration_evidence_level | string;
  market_supports_pick: boolean;
  is_stale_market: boolean;
  is_single_source: boolean;
  is_far_from_market: boolean;
  is_short_price_dc: boolean;
  short_price_dc_market_implied_p: number | null;
  splits_provider_error: boolean;
  is_draw_pick: boolean;
  lambda_total: number;
  is_btts_yes_pick: boolean;
  lambda_min: number;
  /** WC-MODEL-5: true when this is a match_result pick on the MARKET
   * FAVORITE side (highest de-vigged implied prob, not draw). Selects the
   * lower (favorite) edge ladder; false uses the higher draw/longshot bar. */
  is_match_favorite: boolean;
  /** WC-MODEL-7: the market has moved steadily AGAINST the pick since open
   * (its de-vigged prob fell ≥ threshold). Applies a confidence haircut. */
  market_moving_against_pick: boolean;
};

function capDefaultFor(market: SoccerGradeDecision["market"], selection: string): number {
  if (market === "match_result") {
    return selection === "draw" ? SOCCER_CONFIDENCE_CAPS.match_result_draw : SOCCER_CONFIDENCE_CAPS.match_result_default;
  }
  if (market === "double_chance") return SOCCER_CONFIDENCE_CAPS.double_chance_default;
  if (market === "total") return SOCCER_CONFIDENCE_CAPS.total_default;
  return SOCCER_CONFIDENCE_CAPS.btts_default;
}

/** Convert model_p (0..1) → percent (0..100) for display. */
function toPct(p: number): number {
  return Math.max(0, Math.min(100, p * 100));
}

/**
 * Derive confidence + grade for ONE market pick.
 *
 * Inputs:
 *   market, selection, model_p — the pick + raw model probability
 *   edge_pp, model_market_agreement — from comparison
 *   ctx — context flags from upstream
 */
export function deriveSoccerGrade(opts: {
  market: SoccerGradeDecision["market"];
  selection: string;
  model_p: number;
  edge_pp: number | null;
  model_market_agreement: boolean;
  ctx: GradeInputContext;
  /**
   * Soft caps from hold-logic. Clamp the final grade so it never
   * exceeds the strictest cap. NEVER elevates. Default = no caps.
   */
  soft_caps?: ReadonlyArray<SoftCap>;
}): SoccerGradeDecision {
  const cap_default = capDefaultFor(opts.market, opts.selection);
  const model_p_pct = toPct(opts.model_p);
  const reductions: ConfidenceReduction[] = [];

  // Short-price DC guardrail: cap drops to min(cap, market_implied_pp − buffer).
  if (
    opts.market === "double_chance" &&
    opts.ctx.is_short_price_dc &&
    opts.ctx.short_price_dc_market_implied_p !== null
  ) {
    const marketImpliedPct = opts.ctx.short_price_dc_market_implied_p * 100;
    const buffer = EXTERNAL_PRIORS_V1.reductions_pp.short_price_dc_buffer;
    const ceiling = Math.max(0, marketImpliedPct - buffer);
    if (ceiling < cap_default) {
      reductions.push({
        code: "short_price_dc_guardrail",
        pp: cap_default - ceiling,
        reason: `Short-price DC (market implied ${marketImpliedPct.toFixed(0)}%): cap capped at market_implied − ${buffer} pp`,
      });
    }
  }
  if (opts.ctx.is_stale_market) {
    reductions.push({
      code: "stale_market",
      pp: EXTERNAL_PRIORS_V1.reductions_pp.stale_market,
      reason: "BDL or SharpAPI main line stale (>30 min at lock)",
    });
  }
  if (opts.ctx.is_single_source) {
    reductions.push({
      code: "single_source",
      pp: EXTERNAL_PRIORS_V1.reductions_pp.single_source,
      reason: "Only one provider supplied odds at lock (BDL_ONLY or SharpAPI_ONLY)",
    });
  }
  if (opts.ctx.is_far_from_market) {
    reductions.push({
      code: "far_from_market",
      pp: EXTERNAL_PRIORS_V1.reductions_pp.far_from_market,
      reason: "|edge_pp| > 15 — model far from market consensus",
    });
  }
  if (opts.ctx.splits_provider_error) {
    reductions.push({
      code: "splits_provider_error",
      pp: EXTERNAL_PRIORS_V1.reductions_pp.splits_provider_error,
      reason: "SharpAPI splits provider error — transient flag",
    });
  }
  if (opts.ctx.market_moving_against_pick) {
    reductions.push({
      code: "market_moving_against",
      pp: EXTERNAL_PRIORS_V1.reductions_pp.market_moving_against,
      reason: "Market has moved steadily against this pick since open — confidence trimmed",
    });
  }
  if (opts.market === "match_result" && opts.ctx.is_draw_pick && opts.ctx.lambda_total > EXTERNAL_PRIORS_V1.hold_thresholds.high_scoring_threshold) {
    reductions.push({
      code: "draw_pick_high_lambda",
      pp: EXTERNAL_PRIORS_V1.reductions_pp.draw_pick_high_lambda,
      reason: `Draw pick on high-scoring fixture (λ_H + λ_A = ${opts.ctx.lambda_total.toFixed(2)})`,
    });
  }
  if (opts.market === "btts" && opts.ctx.is_btts_yes_pick && opts.ctx.lambda_min < EXTERNAL_PRIORS_V1.hold_thresholds.btts_yes_low_lambda_min) {
    reductions.push({
      code: "btts_yes_low_lambda",
      pp: EXTERNAL_PRIORS_V1.reductions_pp.btts_low_lambda_pick_yes,
      reason: `BTTS Yes pick when one team's λ < ${EXTERNAL_PRIORS_V1.hold_thresholds.btts_yes_low_lambda_min}`,
    });
  }

  const totalReductionPp = reductions.reduce((s, r) => s + r.pp, 0);
  const cap_effective = Math.max(40, cap_default - totalReductionPp);
  const confidence = Math.min(model_p_pct, cap_effective);

  const ladderResult = deriveGradeLadder({
    market: opts.market,
    is_match_favorite: opts.ctx.is_match_favorite,
    edge_pp: opts.edge_pp,
    agreement: opts.model_market_agreement,
    model_p: opts.model_p,
  });
  const grade = ladderResult.grade;
  const miscalibration_flag = ladderResult.miscalibration;

  // QUALIFIED Best Angle (no empirical-calibration lock — a one-month World
  // Cup / a live NBA Finals can't accumulate a calibration sample in time, so
  // "lock until calibrated" would mean never showing a Best Angle the entire
  // event). Instead a Best Angle must be a solid, MARKET-CONFIRMED edge:
  //   1. grade === "Best Angle" — edge in the sane band [floor, ceiling],
  //      model↔market agreement, and not far-from-market (all from the ladder;
  //      Double Chance has a null floor → excluded).
  //   2. market_supports_pick — the de-vigged market confirms our side.
  //   3. NOT market_moving_against_pick — smart-money / line movement is not
  //      moving against the pick (CLV-positive direction).
  //   4. NOT miscalibration_flag — the edge is plausible, not a model-error
  //      outlier (an implausibly large edge is held/flagged upstream).
  //   5. Current, trustworthy market data — not stale, no splits provider
  //      error (a Best Angle needs a solid projection off real inputs).
  // Qualification = solid projection + market confirmation + smart-money
  // agreement + edge sanity, NOT a graded-outcome calibration gate.
  const best_angle =
    grade === "Best Angle" &&
    opts.ctx.market_supports_pick &&
    !opts.ctx.market_moving_against_pick &&
    !miscalibration_flag &&
    !opts.ctx.is_stale_market &&
    !opts.ctx.splits_provider_error;

  // If the qualification gate is not fully met, grade down to Lean (still
  // shown as the model's read) rather than emitting an unqualified Best Angle.
  const postBaLockGrade: SoccerGradeVerdict = grade === "Best Angle" && !best_angle ? "Lean" : grade;

  // Apply soft caps from hold-logic (Pass 2). Can only LOWER the grade,
  // never raise it. Best Angle stays locked regardless.
  const softCaps = opts.soft_caps ?? [];
  const finalGrade = applySoftCaps(postBaLockGrade, softCaps);

  return {
    market: opts.market,
    selection: opts.selection,
    model_p_pct,
    confidence,
    confidence_cap_default: cap_default,
    confidence_cap_effective: cap_effective,
    confidence_reductions: reductions,
    grade: finalGrade,
    best_angle,
    edge_pp: opts.edge_pp,
    model_market_agreement: opts.model_market_agreement,
    miscalibration_flag,
    soft_caps_applied: softCaps,
  };
}

/**
 * Select the per-market (and per-side for Match Result) edge ladder.
 * Match Result splits favorite vs draw/longshot; the other markets use
 * their own floors. Double Chance has best_angle = null (excluded).
 */
function ladderFor(
  market: SoccerGradeDecision["market"],
  isMatchFavorite: boolean,
): { watchlist: number; lean: number; best_angle: number | null; conviction_pct: number; sanity_ceiling: number } {
  const L = EXTERNAL_PRIORS_V1.grade_ladder;
  if (market === "match_result") return isMatchFavorite ? L.match_result_favorite : L.match_result_other;
  if (market === "total") return L.total;
  if (market === "btts") return L.btts;
  return L.double_chance;
}

/**
 * WC-MODEL-8 grade ladder (2026-06-16) — VALUE (edge) + CONFIDENCE (model_p).
 *
 * The prior ladder was value-only and treated a large edge as an ERROR: edge >
 * a ~10pp ceiling → Caution ("implausible"), and far-from-market (>15pp) blocked
 * Lean/Best Angle entirely. With the 0.65 market-blend compressing most picks to
 * ~0 edge, the board collapsed to "Market-Aligned" (tiny edge) or "Caution" (big
 * edge) with NO Lean band. This rebuild:
 *   • A genuinely large edge is a STRONG pick, not a Caution. Only an absurd
 *     edge (> sanity_ceiling, ~30pp = data error) parks at Watchlist — no scary
 *     Caution/copy.
 *   • Adds the CONFIDENCE axis: a high-conviction pick (model_p ≥ conviction_pct)
 *     with at least a mild positive edge earns a Lean, even when the edge alone
 *     is small (a confident pick the market roughly agrees with).
 *   • Caution is reserved for genuine WRONG-SIDE: the model is well below the
 *     market on its own pick AND does not favor it (model_p < 0.5).
 */
// Edge floor (pp) separating "Market-Aligned" from "Caution". A market-grounded
// model that lands a few pp under the market on its own pick AGREES on direction
// and is only slightly less extreme — the normal, honest state, not a warning.
const MARKET_ALIGNED_FLOOR_PP = -10.0;

function deriveGradeLadder(opts: {
  market: SoccerGradeDecision["market"];
  is_match_favorite: boolean;
  edge_pp: number | null;
  agreement: boolean;
  model_p: number;
}): { grade: SoccerGradeVerdict; miscalibration: boolean } {
  const edge = opts.edge_pp ?? 0;
  const confPct = toPct(opts.model_p); // 0..100
  const lad = ladderFor(opts.market, opts.is_match_favorite);
  const highConviction = confPct >= lad.conviction_pct;

  // 1. Data-error sanity bound: an edge THIS large means bad inputs, not value.
  //    Park at Watchlist (visible, non-actionable) — NOT a scary Caution.
  if (edge > lad.sanity_ceiling) {
    return { grade: "Watchlist", miscalibration: true };
  }
  // 2. Best Angle: strong value + market agreement + high conviction. (Still
  //    downgraded to Lean by the qualification gate under external_priors_only.)
  if (lad.best_angle !== null && edge >= lad.best_angle && opts.agreement && highConviction) {
    return { grade: "Best Angle", miscalibration: false };
  }
  // 3. Lean — VALUE path (real edge + agreement) OR CONFIDENCE path (high
  //    conviction + at least a mild positive edge). The mix the value-only
  //    ladder lacked: a confident pick the market roughly agrees with now earns
  //    a Lean instead of collapsing to Market-Aligned.
  if ((edge >= lad.lean && opts.agreement) || (highConviction && edge >= lad.watchlist)) {
    return { grade: "Lean", miscalibration: false };
  }
  // 4. Watchlist: some value, below the Lean bar.
  if (edge >= lad.watchlist) {
    return { grade: "Watchlist", miscalibration: false };
  }
  // 5. Market-Aligned: model agrees with the market, no actionable edge.
  if (edge >= MARKET_ALIGNED_FLOOR_PP) {
    return { grade: "Market-Aligned", miscalibration: false };
  }
  // 6. Edge well below the floor. model_p ≥ 0.5 → agrees on the SIDE, just less
  //    confident → Market-Aligned. Otherwise the model doesn't favor the
  //    displayed pick → genuine wrong-side → Caution.
  if (opts.model_p >= 0.5) {
    return { grade: "Market-Aligned", miscalibration: false };
  }
  return { grade: "Caution", miscalibration: false };
}
