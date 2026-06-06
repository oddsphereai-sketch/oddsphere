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

// ── T2. Negative edge → low
const negEdge = computeRecommendationConfidence({ edgePctPp: -3, edgeUnits: null, tier: "high", playGrade: "lean", hasPick: true });
check("T2 negative-edge recommendation ≤ 25", negEdge !== null && negEdge <= 25);

// ── T3. Zero edge → low-moderate
const zeroEdge = computeRecommendationConfidence({ edgePctPp: 0, edgeUnits: null, tier: "high", playGrade: "lean", hasPick: true });
check("T3 zero-edge recommendation in [25, 35]", zeroEdge !== null && zeroEdge >= 25 && zeroEdge <= 35);

// ── T4. +2pp edge → moderate
const midEdge = computeRecommendationConfidence({ edgePctPp: 2, edgeUnits: null, tier: "high", playGrade: "lean", hasPick: true });
check("T4 +2pp recommendation around 50", midEdge !== null && midEdge >= 45 && midEdge <= 55);

// ── T5. +5pp edge + high tier → 70+
const strongHigh = computeRecommendationConfidence({ edgePctPp: 5, edgeUnits: null, tier: "high", playGrade: "best_angle", hasPick: true });
check("T5 +5pp + high tier ≥ 65", strongHigh !== null && strongHigh >= 65);

// ── T6. Same +5pp + low tier → CAPPED at 50
const strongLow = computeRecommendationConfidence({ edgePctPp: 5, edgeUnits: null, tier: "low", playGrade: "lean", hasPick: true });
check("T6 +5pp + low tier capped at 50", strongLow !== null && strongLow <= 50);

// ── T7. Same +5pp + fallback tier → CAPPED at 35
const strongFallback = computeRecommendationConfidence({ edgePctPp: 5, edgeUnits: null, tier: "fallback", playGrade: "lean", hasPick: true });
check("T7 +5pp + fallback tier capped at 35", strongFallback !== null && strongFallback <= 35);

// ── T8. Underdog with +4pp edge: high-tier should NOT be suppressed
const underdogStrong = computeRecommendationConfidence({ edgePctPp: 4, edgeUnits: null, tier: "high", playGrade: "lean", hasPick: true });
check("T8 underdog +4pp high-tier ≥ 60 (not suppressed)", underdogStrong !== null && underdogStrong >= 60);

// ── T9. O/U run-delta path
const ouSmall = computeRecommendationConfidence({ edgePctPp: null, edgeUnits: 0.15, tier: "high", playGrade: "lean", hasPick: true });
check("T9 OU |Δ| 0.15 → low (≤ 30)", ouSmall !== null && ouSmall <= 30);
const ouMid = computeRecommendationConfidence({ edgePctPp: null, edgeUnits: 1.0, tier: "high", playGrade: "lean", hasPick: true });
check("T9 OU |Δ| 1.0 → 50-65", ouMid !== null && ouMid >= 50 && ouMid <= 65);
const ouStrong = computeRecommendationConfidence({ edgePctPp: null, edgeUnits: 2.5, tier: "high", playGrade: "best_angle", hasPick: true });
check("T9 OU |Δ| 2.5 ≥ 70", ouStrong !== null && ouStrong >= 70);

// ── T10. Direction-agnostic for OU (uses abs)
const ouNegDelta = computeRecommendationConfidence({ edgePctPp: null, edgeUnits: -1.5, tier: "high", playGrade: "lean", hasPick: true });
const ouPosDelta = computeRecommendationConfidence({ edgePctPp: null, edgeUnits: 1.5, tier: "high", playGrade: "lean", hasPick: true });
check("T10 OU symmetric on sign", ouNegDelta === ouPosDelta);

// ── T11. Best Angle with +3pp + high tier
const ba = computeRecommendationConfidence({ edgePctPp: 3, edgeUnits: null, tier: "high", playGrade: "best_angle", hasPick: true });
check("T11 Best Angle +3pp returns 55-65", ba !== null && ba >= 55 && ba <= 65);

console.log(`\n  result: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
