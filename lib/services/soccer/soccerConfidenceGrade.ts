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

export type SoccerGradeVerdict = "Caution" | "Watchlist" | "Lean" | "Best Angle";

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

  const grade = deriveGradeLadder({
    edge_pp: opts.edge_pp,
    agreement: opts.model_market_agreement,
    confidence,
    cap_effective,
    far_from_market: opts.ctx.is_far_from_market,
  });

  // Best Angle is structurally locked off at launch:
  //   1. edge_pp > best_angle_floor
  //   2. model_market_agreement
  //   3. market_supports_pick
  //   4. calibration_evidence_level >  "external_priors_only"
  const calibrationUpgraded = opts.ctx.calibration_evidence_level !== "external_priors_only";
  const best_angle =
    grade === "Best Angle" &&
    (opts.edge_pp ?? 0) > EXTERNAL_PRIORS_V1.edge_thresholds.best_angle_floor &&
    opts.model_market_agreement &&
    opts.ctx.market_supports_pick &&
    calibrationUpgraded;

  // If we'd have emitted Best Angle but the calibration lock blocks it,
  // grade down to Lean. This is the hard structural lock.
  const finalGrade: SoccerGradeVerdict = grade === "Best Angle" && !best_angle ? "Lean" : grade;

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
  };
}

function deriveGradeLadder(opts: {
  edge_pp: number | null;
  agreement: boolean;
  confidence: number;
  cap_effective: number;
  far_from_market: boolean;
}): SoccerGradeVerdict {
  const edge = opts.edge_pp ?? 0;
  const T = EXTERNAL_PRIORS_V1.edge_thresholds;

  // Edge-noise band collapses to Watchlist regardless of confidence.
  if (Math.abs(edge) < T.edge_noise_band && edge >= 0) return "Watchlist";

  if (edge >= T.best_angle_floor && opts.agreement && !opts.far_from_market) return "Best Angle";
  if (edge >= T.lean_floor && opts.agreement && !opts.far_from_market) return "Lean";
  if (edge >= T.watchlist_floor) return "Watchlist";
  return "Caution";
}
