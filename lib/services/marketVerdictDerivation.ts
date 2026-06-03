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
 * Rules (Phase 4.1.10, threshold values are tunable post-launch):
 *   1. sharp_conflict grade OR sharpDirection="push_against" → caution
 *   2. best_signal grade AND confidence ≥ 0.62 → best_angle
 *   3. sharp_confirmed grade AND confidence ≥ 0.58 AND no push-against → best_angle
 *   4. confidence ≥ 0.58 AND sharpDirection="support" → lean
 *   5. confidence ≥ 0.55 → lean
 *   6. confidence ≥ 0.52 → watchlist
 *   7. otherwise → no_play
 *   8. marketDataLimited downgrade: best_angle → lean (ML/Total only)
 *   9. first_inning: sharpDirection is forced to "none" (no sharp data in V1)
 *      AND marketDataLimited never downgrades the verdict (different rule —
 *      first_inning quality is judged by model/matchup data, not splits)
 */

import type { Grade } from "../types/domain/Grade";
import type { Verdict } from "./verdictDerivation";
import { MARKET_VERDICT_THRESHOLDS as T } from "./marketVerdictDerivation.constants";

export type MarketVerdict = Verdict;

export type SharpDirection = "support" | "push_against" | "none";

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

  // Rule 1 — sharp_conflict OR active push against → caution
  if (input.grade === "sharp_conflict" || effectiveSharp === "push_against") {
    return resolve("caution");
  }

  // Rules 2 + 3 — best_angle candidates
  if (
    input.grade === "best_signal" &&
    input.confidence >= T.BEST_ANGLE_CONFIDENCE_BEST_SIGNAL
  ) {
    return applyLimitedDowngrade("best_angle", effectiveLimited);
  }
  // effectiveSharp is "support" | "none" here — rule 1 already returned
  // when it was "push_against".
  if (
    input.grade === "sharp_confirmed" &&
    input.confidence >= T.BEST_ANGLE_CONFIDENCE_SHARP_CONFIRMED
  ) {
    return applyLimitedDowngrade("best_angle", effectiveLimited);
  }

  // Rules 4 + 5 — lean candidates
  if (
    input.confidence >= T.LEAN_CONFIDENCE_FLOOR_WITH_SHARP_SUPPORT &&
    effectiveSharp === "support"
  ) {
    return resolve("lean");
  }
  if (input.confidence >= T.LEAN_CONFIDENCE_FLOOR) {
    return resolve("lean");
  }

  // Rule 6 — watchlist
  if (input.confidence >= T.WATCHLIST_CONFIDENCE_FLOOR) {
    return resolve("watchlist");
  }

  // Rule 7 — fall-through
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
