/**
 * Push 3C-2 (Phase 6B.1.6m) — Recommendation Confidence.
 *
 * Pure helper. Computes "how actionable is this pick relative to the
 * book?" on a 0-100 scale from edge + data quality + play grade.
 *
 * Separation of concerns:
 *   • Model Probability — the model's belief in the direction (raw)
 *   • Market Baseline — no-vig probability from the book
 *   • Edge — model_prob − market_no_vig (in percentage points for ML/FI)
 *   • Prediction Confidence — direction-confidence (existing `confidence`)
 *   • Recommendation Confidence — actionability of the pick relative
 *     to the market price. THIS file.
 *   • Play Grade — Best Angle / Lean / No Bet / Toss-Up / Held
 *
 * Rules:
 *   • Toss-Up / Held / null pick → null (no recommendation).
 *   • Negative edge → very low (≤ 25). The pick is going AGAINST the
 *     market consensus without independent edge.
 *   • Edge in [0, 2): low–moderate (30–50). Lean territory.
 *   • Edge in [2, 4): moderate (50–65). Stronger lean / candidate
 *     for Best Angle if tier allows.
 *   • Edge >= 4: high (65–80). Best Angle territory.
 *   • Tier cap: low / fallback tier hard-caps recommendation regardless
 *     of edge — the model is operating on partial data, so even a real
 *     edge shouldn't read as a strong actionable bet.
 *
 * Does NOT change predictions. Pure function over already-stored
 * model+market values.
 */

export type RecommendationTier = "high" | "medium" | "low" | "fallback";

export type RecommendationPlayGrade =
  | "best_angle"
  | "lean"
  | "no_bet"
  | "toss_up"
  | "held"
  | "market_aligned";

/**
 * Phase 6B.1.6n — Launch-conservative tier ceilings.
 *
 * Lowered slightly from the original (80/65/50/35) so the top end of
 * recommendation confidence reflects the limited tracking history we
 * have at launch. Tracking will tell us whether Rec 70+ outperforms
 * 50-60 enough to justify loosening these later.
 *
 * Combined with the play-grade caps below, a Lean pick can never read
 * as premium even on a +10pp edge — only a Best Angle on high-tier
 * data can approach the tier ceiling.
 */
export const REC_TIER_CEILING: Record<RecommendationTier, number> = {
  high: 75,
  medium: 60,
  low: 45,
  fallback: 30,
};

/**
 * Phase 6B.1.6n — Play-grade actionability ceilings.
 *
 * Stacked ON TOP of the tier ceiling. The effective max is
 * min(tier_ceiling, play_grade_ceiling). Rationale:
 *
 *   • best_angle    — model passed the edge + data-quality gate already,
 *                     so it's allowed to reach the tier ceiling.
 *   • lean          — modest by definition. Cap at 62 so even a +10pp
 *                     edge on a Lean grade reads as "interesting", not
 *                     "lock". Underdogs with real edge that DON'T hit
 *                     Best Angle (eg blocked by data tier) end up here.
 *   • no_bet        — hard cap 40. Visible but never actionable-looking.
 *   • market_aligned — hard cap 50. The model and market agree; not
 *                     a real edge play.
 *   • toss_up/held  — null from main path; not represented here.
 */
const REC_PLAY_GRADE_CAP: Record<RecommendationPlayGrade, number> = {
  best_angle: 100,        // bound only by tier ceiling
  lean: 62,
  no_bet: 40,
  market_aligned: 50,
  toss_up: 0,             // unreachable — returns null earlier
  held: 0,                // unreachable — returns null earlier
};

/**
 * @param edgePctPp        model_prob − market_no_vig in percentage points
 *                          (ML, FI). For O/U, pass null and use
 *                          edgeUnits for the run-delta path.
 * @param edgeUnits        Optional alternate edge expressed as units
 *                          (e.g. projected_total − listed_total in runs).
 *                          Used when edgePctPp is null (O/U).
 * @param tier              data quality tier
 * @param playGrade         current play grade. Toss-Up / Held / null
 *                          pick → null recommendation.
 */
export function computeRecommendationConfidence(args: {
  edgePctPp: number | null;
  edgeUnits: number | null;
  tier: RecommendationTier | null;
  playGrade: RecommendationPlayGrade | null;
  hasPick: boolean;
}): number | null {
  if (!args.hasPick) return null;
  if (args.playGrade === "held" || args.playGrade === "toss_up") return null;
  const tier: RecommendationTier = args.tier ?? "fallback";
  const tierCeiling = REC_TIER_CEILING[tier];
  // Phase 6B.1.6n — play-grade-aware ceiling. When the upstream play
  // grade is unknown, fall through to the tier ceiling only (safest
  // posture — don't cap below tier when we don't have a signal).
  // Defensive: if play grade is null OR an unknown string sneaks past
  // the type system (eg the upstream audit stored a value not in the
  // enum like "provisional"), fall through to tier ceiling only.
  const pgCeiling = args.playGrade !== null && REC_PLAY_GRADE_CAP[args.playGrade] !== undefined
    ? REC_PLAY_GRADE_CAP[args.playGrade]
    : 100;
  const ceiling = Math.min(tierCeiling, pgCeiling);

  // Pick which signal to use. Probability-pt edge first (ML/FI), then
  // run-delta units (O/U). When neither is available, return ceiling/2
  // as a baseline — we know the pick exists, we just can't quantify it
  // relative to market.
  let base: number;
  if (args.edgePctPp !== null) {
    base = scoreFromPpEdge(args.edgePctPp);
  } else if (args.edgeUnits !== null) {
    base = scoreFromRunDelta(args.edgeUnits);
  } else {
    base = ceiling / 2;
  }
  return clamp(base, 0, ceiling);
}

/**
 * Map ML/FI probability-point edge (model_prob − market_no_vig in %)
 * to 0-100 recommendation. Phase 6B.1.6n — slope tightened slightly
 * so 6pp+ edges no longer reach into the 80s before tier/play-grade
 * caps apply.
 *
 *   edge ≤ -2pp  → 15
 *   edge -2..0   → 15..28  linear
 *   edge  0..2   → 28..45  linear
 *   edge  2..4   → 45..58  linear
 *   edge  4..6   → 58..68  linear
 *   edge >= 6    → 68..75  asymptotic (never above tier ceiling)
 */
function scoreFromPpEdge(edgePp: number): number {
  if (edgePp <= -2) return 15;
  if (edgePp <= 0)  return lerp(15, 28, (edgePp + 2) / 2);
  if (edgePp <= 2)  return lerp(28, 45, edgePp / 2);
  if (edgePp <= 4)  return lerp(45, 58, (edgePp - 2) / 2);
  if (edgePp <= 6)  return lerp(58, 68, (edgePp - 4) / 2);
  // > 6pp: ramp gently to 75, then tier/play-grade caps take over.
  return 68 + Math.min(7, (edgePp - 6) * 0.875);
}

/**
 * Map O/U run-delta (|projected_total − listed_total|) to 0-100.
 * Phase 6B.1.6n — slightly tightened upper buckets.
 *
 *   |Δ| ≤ 0.25  → 25  (effectively a coin flip in run terms)
 *   |Δ| ≤ 0.75  → 25..42
 *   |Δ| ≤ 1.25  → 42..58
 *   |Δ| ≤ 2.00  → 58..70
 *   |Δ| > 2.00  → 70 (rare for MLB)
 */
function scoreFromRunDelta(delta: number): number {
  const abs = Math.abs(delta);
  if (abs <= 0.25) return 25;
  if (abs <= 0.75) return lerp(25, 42, (abs - 0.25) / 0.5);
  if (abs <= 1.25) return lerp(42, 58, (abs - 0.75) / 0.5);
  if (abs <= 2.0)  return lerp(58, 70, (abs - 1.25) / 0.75);
  return 70;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}
