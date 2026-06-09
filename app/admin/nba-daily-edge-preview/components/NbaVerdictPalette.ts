/**
 * Phase 7B v0c-DE — NBA Daily Edge verdict palette.
 *
 * Mirrors the MLB Daily Edge palette tokens (R-16H locked) so the
 * NBA preview reads visually like the production Daily Edge product:
 *
 *   best_angle → emerald + strong glow (peak actionable, rare)
 *   lean       → sky                   (moderate actionable)
 *   watchlist  → indigo                (informational secondary)
 *   caution    → amber + subtle glow   (warning)
 *   no_play    → dim gray              (skip)
 *   no_market  → dim gray              (no comparison possible)
 *   held       → dim gray              (model held)
 *
 * Pure constants. No imports from MLB code — kept parallel/independent
 * so MLB visual tweaks can land separately.
 */

import type { RecommendationGrade } from "@/lib/services/nba/nbaMarketReview";

export const GRADE_LABEL: Record<RecommendationGrade, string> = {
  best_angle: "Best Angle",
  lean: "Lean",
  watch: "Watchlist",
  caution: "Caution",
  no_market: "No Market",
  held: "Held",
};

export const GRADE_GLYPH: Record<RecommendationGrade, string> = {
  best_angle: "★",
  lean: "↗",
  watch: "◐",
  caution: "⚠",
  no_market: "·",
  held: "○",
};

export const GRADE_TEXT_COLOR: Record<RecommendationGrade, string> = {
  best_angle: "text-emerald-300",
  lean: "text-sky-300",
  watch: "text-indigo-300",
  caution: "text-amber-300",
  no_market: "text-gray-400",
  held: "text-gray-500",
};

export const GRADE_BAND_TINT: Record<RecommendationGrade, string> = {
  best_angle:
    "from-emerald-500/[0.12] via-emerald-500/[0.04] to-transparent border-emerald-500/30",
  lean: "from-sky-500/[0.10] via-sky-500/[0.03] to-transparent border-sky-500/25",
  watch:
    "from-white/[0.04] via-white/[0.015] to-transparent border-white/[0.08]",
  caution:
    "from-amber-500/[0.12] via-amber-500/[0.04] to-transparent border-amber-500/30",
  no_market: "from-gray-800/40 via-gray-800/15 to-transparent border-gray-700/40",
  held: "from-gray-800/40 via-gray-800/15 to-transparent border-gray-700/40",
};

export const GRADE_PILL_TINT: Record<RecommendationGrade, string> = {
  best_angle:
    "bg-emerald-500/[0.12] border-emerald-500/35 hover:bg-emerald-500/[0.18] hover:border-emerald-400/50",
  lean: "bg-sky-500/[0.09] border-sky-500/25 hover:bg-sky-500/[0.16] hover:border-sky-400/45",
  watch:
    "bg-indigo-500/[0.08] border-indigo-500/25 hover:bg-indigo-500/[0.14] hover:border-indigo-400/45",
  caution:
    "bg-amber-500/[0.10] border-amber-500/30 hover:bg-amber-500/[0.16] hover:border-amber-400/45",
  no_market: "bg-gray-900/40 border-gray-700/40",
  held: "bg-gray-900/40 border-gray-700/40",
};

export const GRADE_GLOW: Record<RecommendationGrade, string> = {
  best_angle: "drop-shadow-[0_0_6px_rgba(110,231,183,0.55)]",
  lean: "",
  watch: "",
  caution: "drop-shadow-[0_0_5px_rgba(251,191,36,0.50)]",
  no_market: "",
  held: "",
};

export const CONFLICT_TINT: Record<string, { text: string; bg: string; label: string }> = {
  support: { text: "text-emerald-300", bg: "bg-emerald-500/10 border-emerald-500/30", label: "market supports" },
  neutral: { text: "text-gray-300", bg: "bg-gray-700/30 border-gray-700/40", label: "market neutral" },
  mild_conflict: { text: "text-amber-300", bg: "bg-amber-500/10 border-amber-500/30", label: "market mildly disagrees" },
  strong_conflict: { text: "text-rose-300", bg: "bg-rose-500/10 border-rose-500/30", label: "market strongly disagrees" },
  market_unavailable: { text: "text-gray-500", bg: "bg-gray-800/40 border-gray-700/40", label: "market unavailable" },
};

export const DIVERGENCE_TINT: Record<string, { text: string; bg: string; label: string }> = {
  none: { text: "text-gray-400", bg: "bg-gray-800/30 border-gray-700/40", label: "balanced" },
  mild_sharp: { text: "text-violet-300", bg: "bg-violet-500/10 border-violet-500/30", label: "sharp lean" },
  strong_sharp: { text: "text-violet-200", bg: "bg-violet-500/15 border-violet-500/40", label: "sharp signal" },
  mild_square: { text: "text-amber-300", bg: "bg-amber-500/10 border-amber-500/30", label: "public lean" },
  strong_square: { text: "text-amber-200", bg: "bg-amber-500/15 border-amber-500/40", label: "public heavy" },
};
