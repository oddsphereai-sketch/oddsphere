/**
 * Push 3C-2 (Phase 6B.1.6m) — Recommendation Confidence helper tests.
 *
 * Pure unit tests against computeRecommendationConfidence. Asserts
 * the rules from the spec:
 *   • Toss-Up / Held → null
 *   • Negative edge → very low (≤ 25)
 *   • Small positive edge → low–moderate (30–50)
 *   • Strong edge → high (65–80), tier-capped
 *   • Low / fallback tier hard-caps regardless of edge
 *   • Underdogs with real edge are NOT suppressed
 *   • O/U uses run-delta path
 */

import { computeRecommendationConfidence } from "../lib/services/recommendationConfidence";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, msg?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`); fail++; }
}

console.log(`\n━━━ recommendationConfidence tests ━━━\n`);

// ── T1. Toss-Up / Held → null
check(
  "T1 Toss-Up returns null",
  computeRecommendationConfidence({ edgePctPp: 0, edgeUnits: null, tier: "high", playGrade: "toss_up", hasPick: true }) === null,
);
check(
  "T1 Held returns null",
  computeRecommendationConfidence({ edgePctPp: 5, edgeUnits: null, tier: "high", playGrade: "held", hasPick: true }) === null,
);
check(
  "T1 No pick returns null",
  computeRecommendationConfidence({ edgePctPp: 5, edgeUnits: null, tier: "high", playGrade: "lean", hasPick: false }) === null,
);

// Phase 6B.1.6n — launch-conservative ceilings:
//   tier:  high 75 / medium 60 / low 45 / fallback 30
//   play:  best_angle = tier ceiling
//          lean       = min(tier, 62)
//          no_bet     = min(tier, 40)
//          market_aligned = min(tier, 50)

// ── T2. Negative edge → low
const negEdge = computeRecommendationConfidence({ edgePctPp: -3, edgeUnits: null, tier: "high", playGrade: "lean", hasPick: true });
check("T2 negative-edge recommendation ≤ 25", negEdge !== null && negEdge <= 25);

// ── T3. Zero edge → low-moderate (lowered top end)
const zeroEdge = computeRecommendationConfidence({ edgePctPp: 0, edgeUnits: null, tier: "high", playGrade: "lean", hasPick: true });
check("T3 zero-edge recommendation in [25, 35]", zeroEdge !== null && zeroEdge >= 25 && zeroEdge <= 35);

// ── T4. +2pp edge → moderate (~45)
const midEdge = computeRecommendationConfidence({ edgePctPp: 2, edgeUnits: null, tier: "high", playGrade: "lean", hasPick: true });
check("T4 +2pp recommendation around 40-50", midEdge !== null && midEdge >= 40 && midEdge <= 50);

// ── T5. +5pp edge + high tier + Best Angle → 60+ but ≤ tier ceiling 75
const strongHigh = computeRecommendationConfidence({ edgePctPp: 5, edgeUnits: null, tier: "high", playGrade: "best_angle", hasPick: true });
check("T5 +5pp + high tier + Best Angle in [60, 75]", strongHigh !== null && strongHigh >= 60 && strongHigh <= 75);

// ── T6. +5pp + low tier → capped at 45
const strongLow = computeRecommendationConfidence({ edgePctPp: 5, edgeUnits: null, tier: "low", playGrade: "lean", hasPick: true });
check("T6 +5pp + low tier capped at 45", strongLow !== null && strongLow <= 45);

// ── T7. +5pp + fallback tier → capped at 30
const strongFallback = computeRecommendationConfidence({ edgePctPp: 5, edgeUnits: null, tier: "fallback", playGrade: "lean", hasPick: true });
check("T7 +5pp + fallback tier capped at 30", strongFallback !== null && strongFallback <= 30);

// ── T8. Underdog with +4pp edge + Best Angle + high tier: NOT suppressed
const underdogStrong = computeRecommendationConfidence({ edgePctPp: 4, edgeUnits: null, tier: "high", playGrade: "best_angle", hasPick: true });
check("T8 underdog +4pp Best Angle high-tier ≥ 55 (not suppressed)", underdogStrong !== null && underdogStrong >= 55);
// Underdog Lean SHOULD be capped — it's a lean, not a Best Angle
const underdogLean = computeRecommendationConfidence({ edgePctPp: 4, edgeUnits: null, tier: "high", playGrade: "lean", hasPick: true });
check("T8 underdog +4pp Lean capped at 62 (no lock language)", underdogLean !== null && underdogLean <= 62);

// ── T9. O/U run-delta path (lowered upper bound to 70)
const ouSmall = computeRecommendationConfidence({ edgePctPp: null, edgeUnits: 0.15, tier: "high", playGrade: "lean", hasPick: true });
check("T9 OU |Δ| 0.15 → low (≤ 30)", ouSmall !== null && ouSmall <= 30);
const ouMid = computeRecommendationConfidence({ edgePctPp: null, edgeUnits: 1.0, tier: "high", playGrade: "lean", hasPick: true });
check("T9 OU |Δ| 1.0 → 45-62 lean range", ouMid !== null && ouMid >= 45 && ouMid <= 62);
const ouStrong = computeRecommendationConfidence({ edgePctPp: null, edgeUnits: 2.5, tier: "high", playGrade: "best_angle", hasPick: true });
check("T9 OU |Δ| 2.5 Best Angle ≥ 65", ouStrong !== null && ouStrong >= 65);

// ── T10. Direction-agnostic for OU (uses abs)
const ouNegDelta = computeRecommendationConfidence({ edgePctPp: null, edgeUnits: -1.5, tier: "high", playGrade: "lean", hasPick: true });
const ouPosDelta = computeRecommendationConfidence({ edgePctPp: null, edgeUnits: 1.5, tier: "high", playGrade: "lean", hasPick: true });
check("T10 OU symmetric on sign", ouNegDelta === ouPosDelta);

// ── T11. Best Angle with +3pp + high tier
const ba = computeRecommendationConfidence({ edgePctPp: 3, edgeUnits: null, tier: "high", playGrade: "best_angle", hasPick: true });
check("T11 Best Angle +3pp returns 45-58", ba !== null && ba >= 45 && ba <= 58);

// ── T12 (NEW). Lean cap separation: same edge, Best Angle vs Lean.
// Best Angle should exceed Lean for the same +6pp / high tier inputs.
const baSame = computeRecommendationConfidence({ edgePctPp: 6, edgeUnits: null, tier: "high", playGrade: "best_angle", hasPick: true });
const leanSame = computeRecommendationConfidence({ edgePctPp: 6, edgeUnits: null, tier: "high", playGrade: "lean", hasPick: true });
check("T12 Best Angle > Lean for same +6pp", baSame !== null && leanSame !== null && baSame > leanSame);
check("T12 Lean capped at 62 even at +10pp", computeRecommendationConfidence({ edgePctPp: 10, edgeUnits: null, tier: "high", playGrade: "lean", hasPick: true })! <= 62);

// ── T13 (NEW). No Bet hard-capped at 40 regardless of edge.
const noBetEdge = computeRecommendationConfidence({ edgePctPp: 5, edgeUnits: null, tier: "high", playGrade: "no_bet", hasPick: true });
check("T13 No Bet hard-capped at 40 even with +5pp", noBetEdge !== null && noBetEdge <= 40);

// ── T14 (NEW). market_aligned capped at 50 — the pick agrees with market.
const marketAligned = computeRecommendationConfidence({ edgePctPp: 8, edgeUnits: null, tier: "high", playGrade: "market_aligned", hasPick: true });
check("T14 market_aligned capped at 50 even with +8pp", marketAligned !== null && marketAligned <= 50);

// ── T15 (NEW). Sanity: top-end tier ceiling is now 75.
const massiveEdge = computeRecommendationConfidence({ edgePctPp: 20, edgeUnits: null, tier: "high", playGrade: "best_angle", hasPick: true });
check("T15 +20pp Best Angle high tier capped at 75 (new ceiling)", massiveEdge !== null && massiveEdge <= 75);

console.log(`\n  result: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
