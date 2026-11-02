import assert from "node:assert/strict";
import { reconcileNflMarginMeanDirection } from "@/lib/services/football/nflJointMarketEpisodeRead";

// A skewed near-pick'em law can favor one winner while its mean favors the
// other. This was the legal-capture rejection, not missing sportsbook data.
const values = [-7, -1, 0, 1, 7];
const probabilities = [.12, .37, 0, .40, .11];
const probabilityAbove = (xs: number[], ps: number[], boundary: number) => {
  const win = ps.reduce((n, p, i) => n + (xs[i]! > boundary ? p : 0), 0);
  const lose = ps.reduce((n, p, i) => n + (xs[i]! < boundary ? p : 0), 0);
  return win / (win + lose);
};
for (const direction of [1, -1] as const) {
  const xs = direction === 1 ? values : values.map(x => -x).reverse();
  const ps = direction === 1 ? probabilities : [...probabilities].reverse();
  const home = probabilityAbove(xs, ps, 0);
  const spread = probabilityAbove(xs, ps, direction === 1 ? 1 : -1);
  const constraints = [
    { market: "moneyline" as const, boundary: 0, target: home },
    { market: "spread" as const, boundary: direction === 1 ? 1 : -1, target: spread },
  ];
  const result = reconcileNflMarginMeanDirection({ values: xs, probabilities: ps, constraints });
  assert.ok(result.probabilities, "the original conditional ML and Spread remain feasible");
  assert.equal(result.receipt.applied, true);
  assert.ok(direction * result.receipt.priorHomeMargin < 0);
  assert.ok(direction * result.receipt.finalHomeMargin > 0);
  assert.ok(Math.abs(probabilityAbove(xs, result.probabilities, 0) - home) < 1e-8);
  assert.ok(Math.abs(probabilityAbove(xs, result.probabilities, constraints[1]!.boundary) - spread) < 1e-8);
  assert.ok(result.probabilities.every(p => Number.isFinite(p) && p >= 0));
  assert.ok(Math.abs(result.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-10);
  assert.equal(result.probabilities[2], 0, "no invented support or push mass");
  const second = reconcileNflMarginMeanDirection({ values: xs, probabilities: result.probabilities, constraints });
  assert.equal(second.receipt.applied, false);
  assert.deepEqual(second.probabilities, result.probabilities, "identical law does not compound a correction");
}
const aligned = [.1, .3, 0, .4, .2];
assert.equal(reconcileNflMarginMeanDirection({ values, probabilities: aligned, constraints: [] }).probabilities, aligned,
  "an already coherent forecast is returned exactly");
const spreadOnly = reconcileNflMarginMeanDirection({ values, probabilities, constraints: [
  { market: "spread", boundary: 1, target: probabilityAbove(values, probabilities, 1) },
] });
assert.ok(spreadOnly.probabilities);
assert.ok(Math.abs(probabilityAbove(values, spreadOnly.probabilities, 0) - .51) < 1e-8,
  "spread-only reconciliation preserves the existing winner probability");
console.log("NFL joint mean coherence: conditional ML/Spread, mirror, zero support, identity and repeat checks passed.");
