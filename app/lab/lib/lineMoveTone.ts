/**
 * Phase 6B.13 — shared pick-relative tone helper for line move.
 *
 * Why this exists:
 *   Pre-6B.13 the compact reader and the expanded Edge Stack used two
 *   different rules for the same data point.
 *
 *   - Compact (buildEdgeRow in DailyEdgeShell): pick-relative via
 *     `americanToImpliedProb`. A move that LOWERS the picked side's
 *     implied probability is amber (caution), a move that RAISES it
 *     is emerald (supportive).
 *
 *   - Expanded (buildEdgeStackRows in edgeStackRows): raw arrow
 *     direction — `current > open` → "toward" → emerald regardless of
 *     whether the picked side's implied prob actually moved up or down.
 *
 *   For a favorite at -170 moving to -157, the picked side's implied
 *   prob drops from 62.96% to 61.09% — the market is fading our side.
 *   Compact rendered amber (correct). Expanded rendered emerald (wrong).
 *
 * This module unifies both call sites on the same pick-relative rule.
 * Pure, no React, no DB. Inputs are picked-side American odds.
 */

export type LineMoveTone = "emerald" | "amber" | "gray";

export type LineMoveDirection = "toward" | "against" | "flat";

/** Same threshold as the compact reader's Phase 6B.7 rule. */
const MIN_MOVE_AMERICAN = 5;
/** Same implied-prob threshold (1pp) for emerald/amber escalation. */
const MIN_IMPLIED_DELTA = 0.01;

/**
 * Convert American odds for the PICKED side into implied probability
 * (0..1). Mirrors the helper in DailyEdgeShell so both surfaces compute
 * the same number. Returns null on invalid input so callers can fall
 * through to a neutral tone rather than guess.
 */
export function americanToImpliedProb(american: number | null): number | null {
  if (
    american === null ||
    !Number.isFinite(american) ||
    american === 0
  ) {
    return null;
  }
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/**
 * Classify a line move from the picked side's perspective.
 *
 *   • returns `"flat"` when |current - open| < MIN_MOVE_AMERICAN (noise)
 *   • returns `"toward"` when the picked side's implied prob ROSE
 *     by ≥ MIN_IMPLIED_DELTA (market thinks the pick is stronger)
 *   • returns `"against"` when the picked side's implied prob FELL
 *     by ≥ MIN_IMPLIED_DELTA (market is fading the pick)
 *   • returns `"flat"` for smaller deltas (normal vig adjustment)
 *
 * Both inputs must be the picked-side American price (NOT the other
 * side's). The route's buildMarketEdge ensures `lineOpenAmerican` and
 * `priceAmerican` on the DTO always carry the picked side's prices.
 */
export function classifyPickRelativeLineMove(
  openAmerican: number | null,
  currentAmerican: number | null
): LineMoveDirection {
  if (openAmerican === null || currentAmerican === null) return "flat";
  if (Math.abs(currentAmerican - openAmerican) < MIN_MOVE_AMERICAN) {
    return "flat";
  }
  const openProb = americanToImpliedProb(openAmerican);
  const curProb = americanToImpliedProb(currentAmerican);
  if (openProb === null || curProb === null) return "flat";
  const delta = curProb - openProb;
  if (delta >= MIN_IMPLIED_DELTA) return "toward";
  if (delta <= -MIN_IMPLIED_DELTA) return "against";
  return "flat";
}

/** Map a pick-relative direction to UI tone. */
export function lineMoveTone(direction: LineMoveDirection): LineMoveTone {
  if (direction === "toward") return "emerald";
  if (direction === "against") return "amber";
  return "gray";
}

/** Arrow glyph shared by collapsed + expanded surfaces. */
export function lineMoveArrow(direction: LineMoveDirection): "↗" | "↘" | "→" {
  if (direction === "toward") return "↗";
  if (direction === "against") return "↘";
  return "→";
}
