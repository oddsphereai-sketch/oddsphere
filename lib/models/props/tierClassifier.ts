/**
 * Edge tier classification for prop predictions.
 *
 * Thresholds (per the locked Foundation methodology):
 *   • PREMIUM ≥ 8.0   — surfaced with "verify lineup" caveat
 *   • STRONG  ≥ 5.0   — headline plays
 *   • GOOD    ≥ 3.0   — supporting plays
 *   • SKIP    < 3.0   — not surfaced to customers
 *
 * Negative edges (model thinks the market is right and the bet is -EV)
 * also map to "skip" — they're never published.
 */

import { EDGE_TIERS } from "../../config/constants";

export type PropTier = "premium" | "strong" | "good" | "skip";

export function classifyTier(edgePct: number): PropTier {
  if (edgePct >= EDGE_TIERS.PREMIUM_MIN) return "premium";
  if (edgePct >= EDGE_TIERS.STRONG_MIN) return "strong";
  if (edgePct >= EDGE_TIERS.GOOD_MIN) return "good";
  return "skip";
}

/**
 * Convenience for the UI / orchestrator: does this prop earn a slot on the
 * Daily Edge card / Player Props page?
 */
export function isSurfaced(tier: PropTier): boolean {
  return tier !== "skip";
}
