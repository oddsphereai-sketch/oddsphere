/**
 * Hold / no-play logic for soccer — WC-3 pure module.
 *
 * Pure. No DB. No HTTP.
 *
 * Returns a decision per market (match_result / double_chance / total /
 * btts) for one fixture. The decision is either:
 *   • { hold: false }                       → publish a pick
 *   • { hold: true,  reason: "<code>" }     → held with a code/reason
 *
 * Codes are stable strings so the auditor + UI can index on them.
 *
 * Per project-wc-model-standard §7, EVERY hold reason must be a concrete
 * data-state condition — not a hand-wave. "Awaiting calibration" is also
 * a valid pre-launch hold reason for match_result + DC at WC-3c launch.
 */

import { EXTERNAL_PRIORS_V1 } from "./_externalPriorsV1";
import type { ScoreDistribution } from "./dixonColes";
import type { ReconciliationKind } from "@/lib/providers/real_api/_soccerReconciler";
import type { SoccerSplitsStatus } from "@/lib/providers/real_api/SharpApiSoccerOddsProvider";

export type HoldDecision =
  | { hold: false }
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
  if (ctx.market === "total" && ctx.total_lines_diverge) {
    return { hold: true, code: "TOTAL_LINES_DIVERGE", reason: "BDL + SharpAPI main total lines disagree by ≥ 1.0 — hold total only" };
  }

  // 6. Splits falsely claimed (defensive — should be impossible by design).
  if (ctx.splits_falsely_claimed && ctx.splits_status !== "present") {
    return { hold: true, code: "SPLITS_FALSE_CLAIM", reason: "Code path would claim splits support without source rows — held until pipeline fixed" };
  }

  // 7. Hard hold on negative edge below the floor.
  if (ctx.edge_pp !== null && ctx.edge_pp < EXTERNAL_PRIORS_V1.edge_thresholds.hold_negative_floor) {
    return { hold: true, code: "MODEL_WRONG_SIDE_OF_MARKET", reason: `Model on wrong side by ${(-(ctx.edge_pp ?? 0)).toFixed(1)} pp (below ${EXTERNAL_PRIORS_V1.edge_thresholds.hold_negative_floor} pp floor)` };
  }

  // 8. Far-from-market AND no calibration upgrade → hard hold.
  if (ctx.is_far_from_market_hard && ctx.calibration_evidence_level === "external_priors_only") {
    return { hold: true, code: "FAR_FROM_MARKET_NO_CALIBRATION", reason: `|edge_pp| > ${EXTERNAL_PRIORS_V1.edge_thresholds.far_from_market_hard_hold} pp with only external priors — hold until in-tournament calibration` };
  }

  // 9. Total push-risk: |predicted_total − line| < push_risk_band.
  if (ctx.market === "total" && ctx.listed_total_line !== null) {
    const gap = Math.abs(ctx.predicted_total - ctx.listed_total_line);
    if (gap < EXTERNAL_PRIORS_V1.hold_thresholds.total_push_risk_band) {
      return { hold: true, code: "TOTAL_PUSH_RISK", reason: `Predicted total ${ctx.predicted_total.toFixed(2)} within ${EXTERNAL_PRIORS_V1.hold_thresholds.total_push_risk_band} of line ${ctx.listed_total_line}` };
    }
  }

  // 10. Pre-calibration publish whitelist: at WC-3c launch, only the
  //     whitelisted markets are eligible for public publish; others are
  //     held with a calibration reason. Once operator upgrades
  //     calibration_evidence_level, the whitelist becomes ignored.
  if (
    ctx.calibration_evidence_level === "external_priors_only" &&
    ctx.pre_calibration_publish_whitelist.length > 0 &&
    !ctx.pre_calibration_publish_whitelist.includes(ctx.market)
  ) {
    return { hold: true, code: "AWAITING_IN_TOURNAMENT_CALIBRATION", reason: `${ctx.market} is held at launch under external_priors_only; awaiting in-tournament calibration` };
  }

  return { hold: false };
}
