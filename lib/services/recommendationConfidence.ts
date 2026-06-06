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

export const REC_TIER_CEILING: Record<RecommendationTier, number> = {
  high: 80,
  medium: 65,
  low: 50,
  fallback: 35,
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
  const ceiling = REC_TIER_CEILING[tier];

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
 * to 0-100 recommendation. Symmetric: negative edge gets very low
 * recommendation, positive edge ramps up.
 *
 *   edge ≤ -2pp  → 15
 *   edge -2..0   → 15..30  linear
 *   edge  0..2   → 30..50  linear
 *   edge  2..4   → 50..65  linear
 *   edge  4..6   → 65..75  linear
 *   edge >= 6    → 75..82  asymptotic
 */
function scoreFromPpEdge(edgePp: number): number {
  if (edgePp <= -2) return 15;
  if (edgePp <= 0)  return lerp(15, 30, (edgePp + 2) / 2);
  if (edgePp <= 2)  return lerp(30, 50, edgePp / 2);
  if (edgePp <= 4)  return lerp(50, 65, (edgePp - 2) / 2);
  if (edgePp <= 6)  return lerp(65, 75, (edgePp - 4) / 2);
  // > 6pp: ramp gently to 82, never above tier ceiling
  return 75 + Math.min(7, (edgePp - 6) * 1.5);
}

/**
 * Map O/U run-delta (|projected_total − listed_total|) to 0-100.
 * Sign-aware via absolute value — direction is encoded in the pick.
 *
 *   |Δ| ≤ 0.25  → 25  (effectively a coin flip in run terms)
 *   |Δ| ≤ 0.75  → 25..45
 *   |Δ| ≤ 1.25  → 45..62
 *   |Δ| ≤ 2.00  → 62..75
 *   |Δ| > 2.00  → 75 (rare for MLB)
 */
function scoreFromRunDelta(delta: number): number {
  const abs = Math.abs(delta);
  if (abs <= 0.25) return 25;
  if (abs <= 0.75) return lerp(25, 45, (abs - 0.25) / 0.5);
  if (abs <= 1.25) return lerp(45, 62, (abs - 0.75) / 0.5);
  if (abs <= 2.0)  return lerp(62, 75, (abs - 1.25) / 0.75);
  return 75;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}
