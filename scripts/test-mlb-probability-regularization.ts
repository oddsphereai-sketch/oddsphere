/**
 * MLB-P0 probability-space regularization tests (deterministic, pure).
 *
 * Proves the E-first fix:
 *   • raw probability is preserved alongside the regularized one;
 *   • regularized is strictly closer to market than raw;
 *   • the audit's overconfidence cases (ML 78/58, O/U 84/51) collapse to
 *     a bounded, honest edge BEFORE grading;
 *   • the distance cap fires (capApplied) on huge raw edges;
 *   • null market / null raw degrade safely.
 *
 * Run: npx tsx scripts/test-mlb-probability-regularization.ts
 */

import {
  regularizeProbability,
  type RegularizationInput,
} from "../lib/automodel/mlbProbabilityRegularization";

let failures = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    failures++;
    console.error(`✗ ${name}${detail ? `  — ${detail}` : ""}`);
  }
}
function approx(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) <= eps;
}

const ML = { k: 0.6, maxDistancePp: 10.0 };
const OU = { k: 0.5, maxDistancePp: 9.0 };
function reg(over: Partial<RegularizationInput>): ReturnType<typeof regularizeProbability> {
  return regularizeProbability({ rawProb: 0.6, marketProb: 0.55, ...ML, ...over });
}

// 1 — raw is preserved.
const r1 = reg({ rawProb: 0.6, marketProb: 0.55 });
ok("raw probability preserved", r1.rawProb === 0.6);
ok("regularized probability present", r1.regularizedProb !== null);

// 2 — regularized is strictly closer to market than raw.
ok(
  "regularized closer to market than raw",
  Math.abs((r1.regularizedProb as number) - 0.55) < Math.abs(0.6 - 0.55),
);
// 0.55 + 0.6*(0.60-0.55) = 0.58
ok("ML +5pp raw → +3pp regularized edge", approx(r1.regularizedEdgePct as number, 3.0));
ok("ML +5pp raw edge recorded", approx(r1.rawEdgePct as number, 5.0));
ok("ML +5pp does NOT hit cap", r1.capApplied === false);

// 3 — ML raw 78% vs market 58% → reasonable regularized prob (capped to 68%).
const r3 = reg({ rawProb: 0.78, marketProb: 0.58 });
// shrunk = 0.58 + 0.6*0.20 = 0.70 → distance 12pp > 10pp cap → 0.68
ok("ML 78/58 regularized prob ≈ 0.68 (capped)", approx(r3.regularizedProb as number, 0.68));
ok("ML 78/58 regularized edge ≈ 10pp (at cap)", approx(r3.regularizedEdgePct as number, 10.0));
ok("ML 78/58 raw edge ≈ 20pp preserved", approx(r3.rawEdgePct as number, 20.0));
ok("ML 78/58 cap applied", r3.capApplied === true);
ok("ML 78/58 raw prob preserved", r3.rawProb === 0.78);

// 4 — O/U raw 84% vs market 51% → regularized + capped before edge.
const r4 = regularizeProbability({ rawProb: 0.84, marketProb: 0.51, ...OU });
// shrunk = 0.51 + 0.5*0.33 = 0.675 → distance 16.5pp > 9pp cap → 0.60
ok("O/U 84/51 regularized prob ≈ 0.60 (capped)", approx(r4.regularizedProb as number, 0.6));
ok("O/U 84/51 regularized edge ≈ 9pp (at cap)", approx(r4.regularizedEdgePct as number, 9.0));
ok("O/U 84/51 raw edge ≈ 33pp preserved", approx(r4.rawEdgePct as number, 33.0));
ok("O/U 84/51 cap applied", r4.capApplied === true);

// 5 — reason + shrink factor are surfaced for audit.
ok("reason is probability_space_regularization", r1.reason === "probability_space_regularization");
ok("shrink factor echoed", r1.shrinkFactor === 0.6 && r4.shrinkFactor === 0.5);

// 6 — null market → raw passes through, no edge defined (no fake edge).
const r6 = reg({ rawProb: 0.7, marketProb: null });
ok("null market → regularized = raw", r6.regularizedProb === 0.7);
ok("null market → raw edge null", r6.rawEdgePct === null);
ok("null market → regularized edge null", r6.regularizedEdgePct === null);
ok("null market → cap not applied", r6.capApplied === false);

// 7 — null raw → everything null.
const r7 = reg({ rawProb: null, marketProb: 0.55 });
ok("null raw → regularized null", r7.regularizedProb === null);
ok("null raw → edges null", r7.rawEdgePct === null && r7.regularizedEdgePct === null);

// 8 — a modest favorite (raw 0.62 vs market 0.60) keeps a real edge, no cap.
const r8 = reg({ rawProb: 0.62, marketProb: 0.6 });
// 0.60 + 0.6*0.02 = 0.612 → edge 1.2pp
ok("ML modest favorite keeps positive regularized edge", (r8.regularizedEdgePct as number) > 0);
ok("ML modest favorite not capped", r8.capApplied === false);

// 9 — negative raw edge (model below market) shrinks toward market, stays negative.
const r9 = reg({ rawProb: 0.5, marketProb: 0.58 });
ok("negative raw edge stays negative after shrink", (r9.regularizedEdgePct as number) < 0);
ok("negative edge magnitude reduced by shrink", Math.abs(r9.regularizedEdgePct as number) < 8.0);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll MLB-P0 probability-regularization assertions passed.");
