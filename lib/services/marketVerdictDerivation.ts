/**
 * marketVerdictDerivation — per-market verdict for a single Daily Edge
 * pick (moneyline / total / first_inning).
 *
 * Distinct from the existing game-level `verdictDerivation.ts` which
 * computes ONE verdict for an entire game using headline-pick reasoning.
 * The v13.1 UI port (4.1.10/4.1.11) needs a verdict PER market so each
 * card shows the right chip even when the user clicks a non-headline
 * market.
 *
 * Rules (Phase 4.1.10 base + R-16I Phase 1 reviewer authority):
 *   1. sharp_conflict grade OR sharpDirection="push_against" → caution
 *   1a. (R-16I Phase 1) reviewerSignals.sharpConflict → caution
 *       This routes the reviewer's `ou_sharp_conflict` (and future ML
 *       equivalent) flag directly to Caution even when the route's
 *       deriveSharpDirection didn't independently detect push_against.
 *       The reviewer is authoritative — its conflict flag should not
 *       be silently dropped just because the route's sharp helper read
 *       the signal differently.
 *   2. best_signal grade AND confidence ≥ 0.62 → best_angle
 *   3. sharp_confirmed grade AND confidence ≥ 0.58 AND no push-against → best_angle
 *   4. confidence ≥ 0.58 AND sharpDirection="support" → lean
 *   5. confidence ≥ LEAN_CONFIDENCE_FLOOR (0.58 post-R-16I) → lean
 *   6. confidence ≥ 0.52 → watchlist
 *   7. otherwise → no_play
 *   8. marketDataLimited downgrade: best_angle → lean (ML/Total only)
 *   8a. (R-16I Phase 1) Reviewer warnings cap the verdict ladder at
 *       Watchlist (no Best Angle, no Lean) for the following:
 *         • grade === "public_smoke" — public_smoke is a warning, not
 *           a green light. High confidence alone shouldn't be enough.
 *         • reviewerSignals.publicSmokeAligned === true — equivalent
 *           signal from the reviewer flag.
 *         • reviewerSignals.hasFragilityFlag === true — at least one
 *           strong fragility flag fired (extreme_run_diff_with_coinflip,
 *           small_sample_starter_driver, raw_conf_extreme_fragile,
 *           huge_model_market_gap). The reviewer's STRONG_INTERVENTION_CAP
 *           only fires when ≥2 strong flags hit; this rule catches the
 *           single-flag case so a fragile pick doesn't display as a
 *           normal Lean.
 *       A Watchlist cap is a downgrade only — a pick that already
 *       resolves below Watchlist (no_play) stays no_play.
 *   9. first_inning: sharpDirection is forced to "none" (no sharp data in V1)
 *      AND marketDataLimited never downgrades the verdict (different rule —
 *      first_inning quality is judged by model/matchup data, not splits).
 *      Reviewer-signal rules (1a, 8a) DO apply if the caller supplies them.
 */

import type { Grade } from "../types/domain/Grade";
import type { Verdict } from "./verdictDerivation";
import { MARKET_VERDICT_THRESHOLDS as T } from "./marketVerdictDerivation.constants";

export type MarketVerdict = Verdict;

export type SharpDirection = "support" | "push_against" | "none";

/**
 * R-16I Phase 1 — reviewer-derived signals that the verdict layer
 * treats as authoritative. These come from `sport_specific.review_v1.flags`
 * and let the reviewer's intelligence shape the final user-facing verdict
 * directly (previously the reviewer could flag a conflict but the grade
 * layer wouldn't propagate it, so the conflict was silently lost).
 *
 * All fields default to false when omitted — callers that don't have
 * reviewer data (legacy tests, first_inning) get the pre-R-16I behavior.
 */
export type ReviewerSignals = {
  /**
   * Reviewer flagged a sharp conflict for THIS market.
   *   • total → `ou_sharp_conflict`
   *   • moneyline → reserved for a future ML equivalent (none in V1)
   * When true, verdict routes directly to Caution.
   */
  sharpConflict: boolean;
  /**
   * Reviewer flagged `public_smoke_aligned_with_pick` — heavy + flat
   * public split matched the model's pick. Treated as a warning that
   * caps the verdict at Watchlist (same rule as grade=public_smoke).
   */
  publicSmokeAligned: boolean;
  /**
   * Reviewer fired AT LEAST ONE strong fragility flag for this market.
   * Strong flags: extreme_run_diff_with_coinflip_market,
   * small_sample_starter_driver, raw_conf_extreme_fragile,
   * huge_model_market_gap. The reviewer's STRONG_INTERVENTION_CAP only
   * triggers when ≥2 fire — this signal catches the single-flag case
   * so a still-fragile pick doesn't display as a normal Lean.
   */
  hasFragilityFlag: boolean;
};

export type MarketVerdictInput = {
  market: "moneyline" | "total" | "first_inning";
  /** 0-1. The route normalizes 0-100 storage into this scale upstream. */
  confidence: number;
  grade: Grade;
  /**
   * For moneyline/total: derived from sharp_signals (support vs the pick,
   * push_against the pick, or no signal at all).
   * For first_inning: ALWAYS treated as "none" inside this function
   * regardless of input — V1 has no first-inning sharp feed.
   */
  sharpDirection: SharpDirection;
  /**
   * True when this market has effectively zero quantitative market data
   * (no Pinnacle EV, no fair prob, no splits, no opening price).
   * Triggers a "best_angle → lean" downgrade for ML/Total only.
   * For first_inning, this input is IGNORED (rule 9 above).
   */
  marketDataLimited: boolean;
  /**
   * R-16I Phase 1 — optional reviewer-derived signals. Omitted by
   * callers that don't have reviewer data; defaults to all-false.
   */
  reviewerSignals?: ReviewerSignals;
};

export const VERDICT_LABEL: Record<MarketVerdict, string> = {
  best_angle: "Best Angle",
  lean: "Lean",
  watchlist: "Watchlist",
  caution: "Caution",
  no_play: "No Play",
};

export function marketVerdictFor(
  input: MarketVerdictInput
): { key: MarketVerdict; label: string } {
  // Rule 9 — first_inning never has a sharp direction in V1, and never
  // gets downgraded for "missing market data" the same way ML/Total do.
  const effectiveSharp: SharpDirection =
    input.market === "first_inning" ? "none" : input.sharpDirection;
  const effectiveLimited =
    input.market === "first_inning" ? false : input.marketDataLimited;
  const reviewer: ReviewerSignals = input.reviewerSignals ?? {
    sharpConflict: false,
    publicSmokeAligned: false,
    hasFragilityFlag: false,
  };

  // Rule 1 — sharp_conflict OR active push against → caution
  // Rule 1a (R-16I Phase 1) — reviewer's sharp-conflict flag is
  // authoritative regardless of what the route's sharp helper inferred
  // (e.g. ou_sharp_conflict fires because the reviewer compared model
  // pick to sharp +EV side directly).
  if (
    input.grade === "sharp_conflict" ||
    effectiveSharp === "push_against" ||
    reviewer.sharpConflict
  ) {
    return resolve("caution");
  }

  // R-16I Phase 1 — Rule 8a: reviewer warnings cap the verdict ladder
  // at Watchlist. Computed once here so both best_angle and lean rules
  // route through the cap. A warning-capped pick that already resolves
  // below Watchlist stays where it is (no_play stays no_play).
  const capAtWatchlist =
    input.grade === ("public_smoke" as Grade) ||
    reviewer.publicSmokeAligned ||
    reviewer.hasFragilityFlag;

  // Rules 2 + 3 — best_angle candidates
  if (
    input.grade === "best_signal" &&
    input.confidence >= T.BEST_ANGLE_CONFIDENCE_BEST_SIGNAL
  ) {
    return applyWarningCap(
      applyLimitedDowngrade("best_angle", effectiveLimited).key,
      capAtWatchlist
    );
  }
  // effectiveSharp is "support" | "none" here — rule 1 already returned
  // when it was "push_against".
  if (
    input.grade === "sharp_confirmed" &&
    input.confidence >= T.BEST_ANGLE_CONFIDENCE_SHARP_CONFIRMED
  ) {
    return applyWarningCap(
      applyLimitedDowngrade("best_angle", effectiveLimited).key,
      capAtWatchlist
    );
  }

  // Rules 4 + 5 — lean candidates
  if (
    input.confidence >= T.LEAN_CONFIDENCE_FLOOR_WITH_SHARP_SUPPORT &&
    effectiveSharp === "support"
  ) {
    return applyWarningCap("lean", capAtWatchlist);
  }
  if (input.confidence >= T.LEAN_CONFIDENCE_FLOOR) {
    return applyWarningCap("lean", capAtWatchlist);
  }

  // Rule 6 — watchlist
  if (input.confidence >= T.WATCHLIST_CONFIDENCE_FLOOR) {
    return resolve("watchlist");
  }

  // Rule 7 — fall-through. capAtWatchlist intentionally NOT applied
  // here — a sub-floor pick should not be promoted to Watchlist just
  // because a warning fired; if confidence is too low to clear
  // Watchlist's own floor, no_play is the right answer.
  return resolve("no_play");
}

function resolve(key: MarketVerdict): { key: MarketVerdict; label: string } {
  return { key, label: VERDICT_LABEL[key] };
}

function applyLimitedDowngrade(
  candidate: MarketVerdict,
  limited: boolean
): { key: MarketVerdict; label: string } {
  // Rule 8 — only the best_angle → lean transition. Other verdicts stay.
  if (limited && candidate === "best_angle") return resolve("lean");
  return resolve(candidate);
}

/**
 * R-16I Phase 1 — Rule 8a. When reviewer warnings (public_smoke or any
 * single fragility flag) fire, the verdict ladder is capped at Watchlist.
 * Best Angle and Lean both downgrade to Watchlist; Watchlist and No Play
 * are unchanged.
 */
function applyWarningCap(
  candidate: MarketVerdict,
  cap: boolean
): { key: MarketVerdict; label: string } {
  if (!cap) return resolve(candidate);
  if (candidate === "best_angle" || candidate === "lean") {
    return resolve("watchlist");
  }
  return resolve(candidate);
}

/**
 * Convenience for callers that have raw `ml/ou/nrfi` market keys (used by
 * the existing route's per-market loop). Normalizes legacy "nrfi" / "ou"
 * names to the canonical first_inning / total used by this helper.
 */
export function normalizeMarketKey(
  raw: "ml" | "moneyline" | "ou" | "total" | "nrfi" | "first_inning"
): "moneyline" | "total" | "first_inning" {
  if (raw === "ml" || raw === "moneyline") return "moneyline";
  if (raw === "ou" || raw === "total") return "total";
  return "first_inning";
}

// Re-export Verdict for callers that only import this module.
export type { Verdict };
