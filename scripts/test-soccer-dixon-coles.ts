/**
 * Tests for the Dixon-Coles math module — WC-3.
 */

import {
  computeLambda,
  bivariatePoissonScoreDistribution,
  expectedTotalFromDistribution,
  probabilityOfDraw,
  GOAL_GRID_SIZE,
} from "../lib/services/soccer/dixonColes";
import { EXTERNAL_PRIORS_V1 } from "../lib/services/soccer/_externalPriorsV1";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void { if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`); }
function close(a: number, b: number, eps = 1e-6): boolean { return Math.abs(a - b) < eps; }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-soccer-dixon-coles.ts");
console.log("─".repeat(60));

test("computeLambda matches the exponential formula", () => {
  const lambda = computeLambda({ att: 0.2, def: 0.1, alpha: 0.3, ownHostAdj: 0.15, opposingHostAdj: 0, venueAdj: 0 });
  const expected = Math.exp(0.3 + 0.2 - 0.1 + 0.15);
  assert(close(lambda, expected), `expected ${expected}, got ${lambda}`);
});

test("computeLambda subtracts opposingHostAdj from the side's exponent", () => {
  const lambda = computeLambda({ att: 0, def: 0, alpha: 0.3, ownHostAdj: 0, opposingHostAdj: 0.15, venueAdj: 0 });
  const expected = Math.exp(0.3 - 0.15);
  assert(close(lambda, expected), `expected ${expected}, got ${lambda}`);
});

test("computeLambda clamps extreme exponents", () => {
  const huge = computeLambda({ att: 100, def: -100, alpha: 0, ownHostAdj: 0, opposingHostAdj: 0, venueAdj: 0 });
  assert(huge < Math.exp(5) + 0.001, `clamped λ must be ≤ exp(5)`);
  const tiny = computeLambda({ att: -100, def: 100, alpha: 0, ownHostAdj: 0, opposingHostAdj: 0, venueAdj: 0 });
  assert(tiny > Math.exp(-5) - 0.001, `clamped λ must be ≥ exp(-5)`);
});

test("score distribution has size GOAL_GRID_SIZE x GOAL_GRID_SIZE", () => {
  const d = bivariatePoissonScoreDistribution(1.3, 1.0, EXTERNAL_PRIORS_V1.tau);
  assert(d.length === GOAL_GRID_SIZE);
  for (const row of d) assert(row.length === GOAL_GRID_SIZE);
});

test("score distribution sums to 1.0", () => {
  const d = bivariatePoissonScoreDistribution(1.5, 1.2, EXTERNAL_PRIORS_V1.tau);
  let total = 0;
  for (const row of d) for (const v of row) total += v;
  assert(close(total, 1.0), `total mass should be 1, got ${total}`);
});

test("expectedTotalFromDistribution roughly equals λ_H + λ_A for typical params", () => {
  const lh = 1.4;
  const la = 1.0;
  const d = bivariatePoissonScoreDistribution(lh, la, EXTERNAL_PRIORS_V1.tau);
  const expectedTotal = expectedTotalFromDistribution(d);
  // The Dixon-Coles τ correction perturbs total slightly; tolerance 0.05.
  assert(Math.abs(expectedTotal - (lh + la)) < 0.05, `expected ≈ ${lh + la}, got ${expectedTotal}`);
});

test("probabilityOfDraw is higher with Dixon-Coles τ correction than without", () => {
  const lh = 1.2;
  const la = 1.2;
  const dWith = bivariatePoissonScoreDistribution(lh, la, EXTERNAL_PRIORS_V1.tau);
  const dWithout = bivariatePoissonScoreDistribution(lh, la, 0);
  assert(probabilityOfDraw(dWith) > probabilityOfDraw(dWithout), "τ < 0 should inflate draw probability");
});

test("score distribution is non-negative everywhere", () => {
  const d = bivariatePoissonScoreDistribution(2.5, 0.5, EXTERNAL_PRIORS_V1.tau);
  for (const row of d) for (const v of row) assert(v >= 0, `non-negative cells; got ${v}`);
});

test("symmetric λs → roughly symmetric P(home) ≈ P(away)", () => {
  const d = bivariatePoissonScoreDistribution(1.3, 1.3, EXTERNAL_PRIORS_V1.tau);
  let home = 0, away = 0;
  for (let h = 0; h < d.length; h++) {
    for (let a = 0; a < d[h].length; a++) {
      if (h > a) home += d[h][a];
      else if (a > h) away += d[h][a];
    }
  }
  assert(Math.abs(home - away) < 0.01, `symmetric fixture should produce P(home) ≈ P(away); got ${home} vs ${away}`);
});

test("higher home λ → higher P(home)", () => {
  let pHomeStrong = 0;
  let pHomeWeak = 0;
  {
    const d = bivariatePoissonScoreDistribution(2.0, 1.0, EXTERNAL_PRIORS_V1.tau);
    for (let h = 0; h < d.length; h++) for (let a = 0; a < d[h].length; a++) if (h > a) pHomeStrong += d[h][a];
  }
  {
    const d = bivariatePoissonScoreDistribution(0.8, 1.4, EXTERNAL_PRIORS_V1.tau);
    for (let h = 0; h < d.length; h++) for (let a = 0; a < d[h].length; a++) if (h > a) pHomeWeak += d[h][a];
  }
  assert(pHomeStrong > pHomeWeak, "higher home λ must produce higher P(home)");
});

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("❌ dixon-coles tests FAILED"); process.exit(1); }
console.log(`✅ All ${pass} tests passed.`);
