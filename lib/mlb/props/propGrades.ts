export const PROP_GRADES = [
  "BEST_ANGLE",
  "LEAN",
  "WATCHLIST",
  "NO_PLAY",
  "PENDING_DATA",
  "RESEARCH",
] as const;

export type PropGrade = (typeof PROP_GRADES)[number];

export type PropGradeColor = {
  text: string;
  border: string;
  background: string;
};

const GRADE_META: Record<PropGrade, { label: string; description: string; color: PropGradeColor }> = {
  BEST_ANGLE: {
    label: "Best Angle",
    description: "The model's strongest current alignment across projection, price, confidence, and data quality.",
    color: { text: "#a7f3d0", border: "#10b981", background: "rgba(16, 185, 129, 0.13)" },
  },
  LEAN: {
    label: "Lean",
    description: "Positive model value with a thinner margin or greater sensitivity to the available price.",
    color: { text: "#bae6fd", border: "#38bdf8", background: "rgba(56, 189, 248, 0.12)" },
  },
  WATCHLIST: {
    label: "Watchlist",
    description: "An interesting model read that still needs a cleaner price, role, or matchup setup.",
    color: { text: "#c7d2fe", border: "#6366f1", background: "rgba(99, 102, 241, 0.11)" },
  },
  NO_PLAY: {
    label: "No Edge",
    description: "The market is valid, but the current model and price do not show a meaningful advantage.",
    color: { text: "#9ca3af", border: "#4b5563", background: "rgba(75, 85, 99, 0.10)" },
  },
  PENDING_DATA: {
    label: "Data Check",
    description: "A required model input, mapping, timestamp, or valid market pair needs verification before this can be graded.",
    color: { text: "#fde68a", border: "#f59e0b", background: "rgba(245, 158, 11, 0.10)" },
  },
  RESEARCH: {
    label: "Research",
    description: "The market is visible, but the model or available features are not mature enough for action.",
    color: { text: "#cbd5e1", border: "#475569", background: "rgba(71, 85, 105, 0.10)" },
  },
};

const DATA_BLOCKER_CODES = new Set([
  "MAPPING_RISK",
  "STALE_ODDS",
  "STALE_BDL_ODDS",
  "MISSING_UPDATED_AT",
  "MISSING_TWO_WAY_PAIR",
  "SIDE_ODDS_MISMATCH",
  "LINE_MISMATCH",
  "NO_VIG_SUM_ANOMALY",
  "INVALID_PRICE_FORMAT",
]);

const RESEARCH_CODES = new Set([
  "BATTER_CONTEXT_INSUFFICIENT",
  "EXTREME_PRICE_RESEARCH_ONLY",
  "LINEUP_CONTEXT_INSUFFICIENT",
  "MARKET_RESEARCH_ONLY",
  "MILESTONE_MODEL_NOT_PROMOTED",
  "PITCHER_WIN_CONTEXT_INSUFFICIENT",
  "FIRST_HR_FIELD_MODEL_NOT_PROMOTED",
  "STOLEN_BASE_CONTEXT_INSUFFICIENT",
]);

export function getPropGradeLabel(grade: PropGrade): string {
  return GRADE_META[grade].label;
}

export function getPropGradeDescription(grade: PropGrade): string {
  return GRADE_META[grade].description;
}

export function getPropGradeColor(grade: PropGrade): PropGradeColor {
  return GRADE_META[grade].color;
}

export function isActionablePropGrade(grade: PropGrade): boolean {
  return grade === "BEST_ANGLE" || grade === "LEAN";
}

export function isInspectablePropGrade(grade: PropGrade): boolean {
  return PROP_GRADES.includes(grade);
}

export function mapLegacyPropStatusToGrade(
  status: string,
  options: { confidenceTier?: string | null; reasonCodes?: readonly string[] } = {},
): PropGrade {
  const reasons = options.reasonCodes ?? [];
  if (reasons.some((code) => RESEARCH_CODES.has(code))) return "RESEARCH";
  if (reasons.some((code) => DATA_BLOCKER_CODES.has(code))) return "PENDING_DATA";

  switch (status.toLowerCase()) {
    case "best_angle":
      return "BEST_ANGLE";
    case "recommended":
      return options.confidenceTier === "premium" ? "BEST_ANGLE" : "LEAN";
    case "lean":
      return "LEAN";
    case "watchlist":
      return "WATCHLIST";
    case "blocked":
    case "pending":
    case "pending_data":
      return "PENDING_DATA";
    case "research":
    case "research_only":
      return "RESEARCH";
    default:
      return "NO_PLAY";
  }
}
