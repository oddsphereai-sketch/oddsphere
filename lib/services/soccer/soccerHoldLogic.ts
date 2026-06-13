/**
 * Hold / no-play logic for soccer — WC-3 pure module.
 *
 * Pure. No DB. No HTTP.
 *
 * Returns a decision per market (match_result / double_chance / total /
 * btts) for one fixture. The decision is either:
 *   • { hold: false, soft_caps?: [...] }    → publish a pick (with optional
 *                                             soft caps that clamp the
 *                                             grade ladder downstream)
 *   • { hold: true,  reason: "<code>" }     → held with a code/reason
 *
 * Codes are stable strings so the auditor + UI can index on them.
 *
 * Per project-wc-model-standard §7, EVERY hold reason must be a concrete
 * data-state condition — not a hand-wave.
 *
 * Pass 2 (2026-06-11): two early-tournament guardrails that previously
 * hard-held are now SOFT CAPS — they let the market into the grade
 * ladder but clamp the maximum displayed grade. This avoids
 * all-No-Play card outcomes during external_priors_only calibration
 * while preserving every true blocker and the Best Angle structural lock.
 *   • FAR_FROM_MARKET_NO_CALIBRATION → soft cap at "Lean"
 *   • AWAITING_IN_TOURNAMENT_CALIBRATION whitelist → removed entirely
 *     (the Best Angle structural lock in soccerConfidenceGrade already
 *     prevents over-confident outputs pre-calibration; rule 10 was
 *     redundant overkill that produced all-hold cards).
 */

import { EXTERNAL_PRIORS_V1 } from "./_externalPriorsV1";
import type { ScoreDistribution } from "./dixonColes";
import type { ReconciliationKind } from "@/lib/providers/real_api/_soccerReconciler";
import type { SoccerSplitsStatus } from "@/lib/providers/real_api/SharpApiSoccerOddsProvider";

/**
 * Soft cap signaled from hold-logic to the grade ladder.
 *
 * Tells `deriveSoccerGrade` "this market may publish, but the final
 * grade must not exceed `cap_at`". A cap NEVER elevates a grade — it
 * only clamps from above.
 */
export type SoftCap = {
  /** Stable code; surfaced to the auditor + card metadata. */
  code: string;
  /**
   * Maximum grade allowed after applying this cap. NEVER elevates.
   *
   * WC-MODEL-2 (2026-06-12): "Caution" was added to support the
   * "model probability and value-edge disagree on side" downgrade.
   * When the selector picks the model_side but the market says
   * value is on the OTHER side, we still publish (so users see
   * the model's read), but the grade clamps to Caution / Watchlist
   * so it never looks like an actionable Lean.
   */
  cap_at: "Caution" | "Watchlist" | "Lean";
  /** Human-readable reason. */
  reason: string;
};

export type HoldDecision =
  | { hold: false; soft_caps?: ReadonlyArray<SoftCap> }
  | { hold: true; code: string; reason: string };

export type HoldInputContext = {
  market: "match_result" | "double_chance" | "total" | "btts";
  /** True if we have no normalized odds rows for this market across both providers. */
  market_odds_missing: boolean;
  /** Reconciliation kind for the fixture. */
  reconciliation: ReconciliationKind;
  /** True if either home_team_source or away_team_source is unresolved (knockout placeholder). */
  has_unresolved_placeholder: boolean;
  /** True if BOTH BDL + SharpAPI lines are > 60 min stale. */
  both_providers_stale: boolean;
  /** True if BDL total line and SharpAPI total line disagree by ≥ 1.0 (e.g., 2.5 vs 3.5). */
  total_lines_diverge: boolean;
  /** True if any code path would claim splits support without rows. */
  splits_falsely_claimed: boolean;
  /** Splits provider status. Drives the "splits falsely claimed" check upstream. */
  splits_status: SoccerSplitsStatus["status"];
  /** Edge in pp; null if market data missing. */
  edge_pp: number | null;
  /** |Edge| above this and no calibration upgrade → hard hold. */
  is_far_from_market_hard: boolean;
  /** Predicted total from λ_H + λ_A (only used for total push-risk check). */
  predicted_total: number;
  /** Listed total line (for push-risk check). */
  listed_total_line: number | null;
  /** Total predicted lambdas (for draw + btts hold checks). */
  lambda_home: number;
  lambda_away: number;
  /** Joint score distribution — used for total push-risk + BTTS Yes/No diagnostics. */
  joint: ScoreDistribution | null;
  /** Calibration evidence level — pre-calibration soft holds. */
  calibration_evidence_level: typeof EXTERNAL_PRIORS_V1.calibration_evidence_level | string;
  /** Operator-set gate: WC-3c initial publish allows total + BTTS only. */
  pre_calibration_publish_whitelist: ReadonlyArray<HoldInputContext["market"]>;
  /**
   * WC-MODEL-2/3 (2026-06-12) — side policy inputs.
   *
   * The selector writes the model_side (highest model probability). The
   * value_side is the side with the highest +edge vs the market. When
   * those differ, the row should NOT publish as an actionable Lean even
   * if the edge passes the ladder threshold.
   *
   * For totals, the mean_direction_side is the direction implied by
   * `expected_total = λ_home + λ_away` relative to the listed line.
   * For low-λ Dixon-Coles fits, the mean and the probability median can
   * diverge — this is mathematically correct, not a bug, but it produces
   * a confusing "Projected 2.6, Pick Under" optical contradiction. The
   * direction guard catches it and surfaces TOTAL_MEAN_PROBABILITY_SPLIT.
   *
   * All three fields are optional for backward compatibility — old call
   * sites that don't pass them retain the pre-WC-MODEL-2/3 behavior.
   */
  model_side?: string;
  value_side?: string;
  mean_direction_side?: "over" | "under" | null;
};

export function deriveHold(ctx: HoldInputContext): HoldDecision {
  // 1. Reconciliation = SHARP_ONLY → hold entire fixture's market.
  if (ctx.reconciliation === "SHARP_ONLY") {
    return { hold: true, code: "SHARP_ONLY_RECONCILIATION", reason: "SharpAPI event has no BDL counterpart at probe time — provenance unverified" };
  }

  // 2. Unresolved placeholder (knockout fixtures before group stage finishes).
  if (ctx.has_unresolved_placeholder) {
    return { hold: true, code: "UNRESOLVED_PLACEHOLDER", reason: "Fixture has unresolved team placeholder (knockout pre-resolution)" };
  }

  // 3. Missing odds for this market across both providers.
  if (ctx.market_odds_missing) {
    return { hold: true, code: "MARKET_ODDS_MISSING", reason: `No normalized odds rows for ${ctx.market} from BDL or SharpAPI at lock` };
  }

  // 4. Both providers stale beyond hard cap.
  if (ctx.both_providers_stale) {
    return { hold: true, code: "BOTH_PROVIDERS_STALE", reason: `BDL + SharpAPI main lines both stale > ${EXTERNAL_PRIORS_V1.hold_thresholds.both_providers_stale_seconds}s` };
  }

  // 5. Total lines diverge ≥ 1.0 between providers.
  //    WC-MODEL-4 (2026-06-12) — DEGRADED from hard hold to a soft Caution
  //    cap (see softCaps section below). The comparator now compares each
  //    provider's MAIN total line (most balanced book line), so this only
  //    fires on genuine main-vs-main disagreement, not alt-ladder noise.
  //    When it does fire, the selected/canonical line is still known and
  //    gradeable, so we publish at Caution with a provider-divergence note
  //    rather than blanking the market to No Play.

  // 6. Splits falsely claimed (defensive — should be impossible by design).
  if (ctx.splits_falsely_claimed && ctx.splits_status !== "present") {
    return { hold: true, code: "SPLITS_FALSE_CLAIM", reason: "Code path would claim splits support without source rows — held until pipeline fixed" };
  }

  // 7. Hard hold on negative edge below the floor.
  if (ctx.edge_pp !== null && ctx.edge_pp < EXTERNAL_PRIORS_V1.edge_thresholds.hold_negative_floor) {
    return { hold: true, code: "MODEL_WRONG_SIDE_OF_MARKET", reason: `Model on wrong side by ${(-(ctx.edge_pp ?? 0)).toFixed(1)} pp (below ${EXTERNAL_PRIORS_V1.edge_thresholds.hold_negative_floor} pp floor)` };
  }

  // 7b. WC Tier-0 — UNCALIBRATED LARGE-EDGE HOLD. On external_priors_only, an
  // edge beyond the per-market miscalibration ceiling is far more likely model
  // error than real value (esp. BTTS / double_chance, which the bivariate
  // Poisson structurally over-predicts even after the market-λ blend). Soccer
  // closes are efficient, so a large gap on an uncalibrated model is a red flag
  // on US, not value. HOLD it with an exact reason instead of shipping an
  // overconfident Caution pick. Sane sub-ceiling edges still publish.
  if (ctx.calibration_evidence_level === "external_priors_only" && ctx.edge_pp !== null) {
    const CEILING_BY_MARKET: Record<string, number> = {
      match_result: 10, total: 9, btts: 10, double_chance: 9,
    };
    const ceil = CEILING_BY_MARKET[ctx.market] ?? 10;
    if (Math.abs(ctx.edge_pp) > ceil) {
      return {
        hold: true,
        code: "UNCALIBRATED_EDGE_EXCEEDS_CEILING",
        reason: `|edge| ${Math.abs(ctx.edge_pp).toFixed(1)}pp exceeds the ${ctx.market} miscalibration ceiling (${ceil}pp) on an uncalibrated (external-priors-only) model — held until WC calibration data exists`,
      };
    }
  }

  // 9. Total push-risk: |predicted_total − line| < push_risk_band.
  //    (Numbered "9" historically; kept here above the soft caps so
  //    push risk on totals still hard-holds.)
  if (ctx.market === "total" && ctx.listed_total_line !== null) {
    const gap = Math.abs(ctx.predicted_total - ctx.listed_total_line);
    if (gap < EXTERNAL_PRIORS_V1.hold_thresholds.total_push_risk_band) {
      return { hold: true, code: "TOTAL_PUSH_RISK", reason: `Predicted total ${ctx.predicted_total.toFixed(2)} within ${EXTERNAL_PRIORS_V1.hold_thresholds.total_push_risk_band} of line ${ctx.listed_total_line}` };
    }
  }

  // 11 (WC-MODEL-3 2026-06-12). TOTAL_DIRECTION_CONFLICT — hard hold.
  //
  // When the totals selected side (model_side, P>0.5 side) disagrees with
  // BOTH the value side AND the mean direction implied by expected_total,
  // and the edge is small, the row is too directionally noisy to publish
  // as an actionable pick. Hold rather than ship contradictory signals.
  //
  // Threshold derivation: 2.0 pp of |edge_pp| is small enough that the
  // value layer's signal is statistically inseparable from the de-vig
  // noise band. Above that, we still surface the row but clamp the
  // grade ladder via the soft caps below.
  if (
    ctx.market === "total" &&
    ctx.model_side !== undefined &&
    ctx.value_side !== undefined &&
    ctx.mean_direction_side !== undefined &&
    ctx.mean_direction_side !== null
  ) {
    const meanVsModel = ctx.mean_direction_side !== ctx.model_side;
    const modelVsValue = ctx.value_side !== ctx.model_side;
    const smallEdge = ctx.edge_pp !== null && Math.abs(ctx.edge_pp) < 2.0;
    if (meanVsModel && modelVsValue && smallEdge) {
      return {
        hold: true,
        code: "TOTAL_DIRECTION_CONFLICT",
        reason:
          `Selected ${ctx.model_side} but mean direction is ${ctx.mean_direction_side} ` +
          `and value side is ${ctx.value_side} with small edge (${ctx.edge_pp?.toFixed(2)} pp) — directional conflict hold`,
      };
    }
  }

  // No true blockers above — collect any SOFT CAPS that should clamp
  // the grade ladder downstream. The market still publishes.

  const softCaps: SoftCap[] = [];

  // 12 (WC-MODEL-2 2026-06-12). MODEL_VALUE_SIDE_DISAGREE — soft cap
  //    at Watchlist. The model picks side A (highest probability) but the
  //    market-edge layer says side B has better value. We still publish
  //    the model's read so users see the model's opinion, but it must
  //    not display as an actionable Lean/Best Angle. The disagreement
  //    is informational and is preserved in audit metadata.
  if (
    ctx.model_side !== undefined &&
    ctx.value_side !== undefined &&
    ctx.model_side !== ctx.value_side
  ) {
    softCaps.push({
      code: "model_value_side_disagree",
      cap_at: "Watchlist",
      reason:
        `Model probability favors ${ctx.model_side} but value side is ${ctx.value_side} — ` +
        `directionally mixed signal, grade capped at Watchlist`,
    });
  }

  // 13 (WC-MODEL-2 2026-06-12). MODEL_SIDE_NEGATIVE_EDGE — soft cap at
  //    Caution. When the model's selected side has any negative edge vs.
  //    the de-vigged market (i.e., the market thinks the model is on the
  //    "wrong" side, even by a small margin), the row is not actionable
  //    even though the existing MODEL_WRONG_SIDE_OF_MARKET hold (floor at
  //    -5 pp) didn't fire.
  if (ctx.edge_pp !== null && ctx.edge_pp < 0) {
    softCaps.push({
      code: "model_side_negative_edge",
      cap_at: "Caution",
      reason:
        `Selected side has negative edge ${ctx.edge_pp.toFixed(2)} pp vs market — ` +
        `not actionable as a recommendation`,
    });
  }

  // 14 (WC-MODEL-3 2026-06-12). TOTAL_MEAN_PROBABILITY_SPLIT — soft cap
  //    at Watchlist. The Dixon-Coles joint at low λ is right-skewed, so
  //    E[total] can sit above the line while P(Under) > P(Over). This
  //    is mathematically correct, not a bug, but it produces an "expected
  //    2.6, pick Under" optical contradiction. Mark it so the audit
  //    trail and the card display can speak to it.
  if (
    ctx.market === "total" &&
    ctx.model_side !== undefined &&
    ctx.mean_direction_side !== undefined &&
    ctx.mean_direction_side !== null &&
    ctx.mean_direction_side !== ctx.model_side
  ) {
    softCaps.push({
      code: "total_mean_probability_split",
      cap_at: "Watchlist",
      reason:
        `E[total] direction (${ctx.mean_direction_side}) differs from probability direction ` +
        `(${ctx.model_side}) — distribution skew, not a bug; grade capped at Watchlist`,
    });
  }

  // 5 (WC-MODEL-4, formerly hard hold). TOTAL_LINES_DIVERGE — soft cap at
  //    Caution. Providers' MAIN total lines disagree by ≥ 1.0; the selected
  //    line is still known, so publish at Caution with a divergence note
  //    instead of a full No Play.
  if (ctx.market === "total" && ctx.total_lines_diverge) {
    softCaps.push({
      code: "total_lines_diverge",
      cap_at: "Caution",
      reason:
        "BDL + SharpAPI main total lines disagree by ≥ 1.0 — providers differ on the total; grade capped at Caution",
    });
  }

  // 8 (formerly hard hold). Far-from-market AND no calibration upgrade
  //    → soft cap at "Lean". Confidence reduction is still applied
  //    independently in soccerConfidenceGrade.
  if (ctx.is_far_from_market_hard && ctx.calibration_evidence_level === "external_priors_only") {
    softCaps.push({
      code: "model_far_from_market_uncalibrated",
      cap_at: "Lean",
      reason: `|edge_pp| > ${EXTERNAL_PRIORS_V1.edge_thresholds.far_from_market_hard_hold} pp with only external priors — grade capped at Lean until in-tournament calibration`,
    });
  }

  // 10 (REMOVED). The pre_calibration_publish_whitelist field is kept
  //    on HoldInputContext to avoid breaking the type contract upstream,
  //    but is no longer consulted. The Best Angle structural lock in
  //    soccerConfidenceGrade.ts already prevents over-confident outputs
  //    pre-calibration. See file header for rationale.

  return softCaps.length > 0 ? { hold: false, soft_caps: softCaps } : { hold: false };
}
