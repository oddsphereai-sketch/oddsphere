/**
 * Member-facing label for a reviewer action (2026-06-16).
 *
 * The Edge Stack's "Reviewer caution" badge previously rendered raw internal
 * jargon ("· confidence capped", "· projection dampened"). This maps the
 * internal `reviewActionSummary` enum to plain English for members. Raw
 * cap/dampen/grade_cap details stay admin/private (snapshot/audit only).
 *
 * Returns null when nothing should be shown ("keep" = no caution annotation).
 * Pure: no React, no DB.
 */
import type { MarketEdgeDto } from "./labTypes";

export function reviewActionLabel(
  action: MarketEdgeDto["reviewActionSummary"],
): string | null {
  switch (action) {
    case "cap_confidence":
    case "dampen_confidence":
      return "Confidence limited";
    case "hold":
      return "Market conflict";
    case "adjust_score_toward_market":
      return "Projection eased toward market";
    case "downgrade_grade":
    case "flip_side":
      return "Signal mixed";
    case "keep":
      return null;
    default:
      return null;
  }
}
