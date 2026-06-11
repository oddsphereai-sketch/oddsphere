/**
 * Tests for the score-distribution → market probabilities derivation.
 *
 * Key contract tests:
 *   • DC is derived from match_result only.
 *   • Total + BTTS derive from joint distribution only.
 *   • No market input touches any output.
 */

import { bivariatePoissonScoreDistribution } from "../lib/services/soccer/dixonColes";
import {
  matchResultFromDistribution,
  doubleChanceFromMatchResult,
  totalFromDistribution,
  bttsFromDistribution,
  deriveSoccerMarketProbabilities,
} from "../lib/services/soccer/soccerMarketProbabilities";
import { EXTERNAL_PRIORS_V1 } from "../lib/services/soccer/_externalPriorsV1";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void { if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`); }
function close(a: number, b: number, eps = 1e-9): boolean { return Math.abs(a - b) < eps; }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-soccer-market-probabilities.ts");
console.log("─".repeat(60));

const joint = bivariatePoissonScoreDistribution(1.5, 1.2, EXTERNAL_PRIORS_V1.tau);

test("match_result probabilities sum to 1", () => {
  const mr = matchResultFromDistribution(joint);
  const total = mr.home + mr.draw + mr.away;
  assert(Math.abs(total - 1) < 1e-9, `match_result sum = ${total}`);
});

test("double_chance is strictly derived from match_result", () => {
  const mr = matchResultFromDistribution(joint);
  const dc = doubleChanceFromMatchResult(mr);
  assert(close(dc.home_or_draw, mr.home + mr.draw));
  assert(close(dc.away_or_draw, mr.away + mr.draw));
  assert(close(dc.home_or_away, mr.home + mr.away));
});

test("double_chance does NOT consult market — same MR input → same output regardless of any other state", () => {
  const mr = { home: 0.45, draw: 0.27, away: 0.28 };
  const dc1 = doubleChanceFromMatchResult(mr);
  const dc2 = doubleChanceFromMatchResult(mr);
  assert(dc1.home_or_draw === dc2.home_or_draw);
  assert(dc1.away_or_draw === dc2.away_or_draw);
  assert(dc1.home_or_away === dc2.home_or_away);
});

test("total over+under+push = 1", () => {
  const t = totalFromDistribution(joint, 2.5);
  assert(Math.abs(t.over + t.under + t.push - 1) < 1e-9);
});

test("half-line total never pushes", () => {
  const t = totalFromDistribution(joint, 2.5);
  assert(close(t.push, 0), `half-line push should be 0; got ${t.push}`);
});

test("whole-line total CAN push", () => {
  const t = totalFromDistribution(joint, 2);
  assert(t.push > 0, "whole-line push should be > 0");
});

test("btts yes + no = 1", () => {
  const b = bttsFromDistribution(joint);
  assert(Math.abs(b.yes + b.no - 1) < 1e-9);
});

test("btts yes only counts joint cells where both teams have at least 1 goal", () => {
  // Verify manually with a tiny custom distribution.
  const tiny = [
    [0.2, 0.1, 0.0],
    [0.1, 0.3, 0.1], // (1,1) and (1,2) are BTTS yes; (1,0) is BTTS no
    [0.0, 0.1, 0.1],
  ];
  // Pad to 9x9 like the real distribution.
  const grid = Array.from({ length: 9 }, (_, h) => Array.from({ length: 9 }, (_, a) => (tiny[h] && tiny[h][a]) ?? 0));
  const b = bttsFromDistribution(grid);
  // BTTS yes cells: (1,1)=0.3, (1,2)=0.1, (2,1)=0.1, (2,2)=0.1 = 0.6
  assert(Math.abs(b.yes - 0.6) < 1e-9, `expected btts.yes = 0.6, got ${b.yes}`);
});

test("deriveSoccerMarketProbabilities returns all four markets coherently", () => {
  const out = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  assert(close(out.match_result.home + out.match_result.draw + out.match_result.away, 1));
  assert(close(out.double_chance.home_or_draw, out.match_result.home + out.match_result.draw));
  assert(close(out.total.over + out.total.under + out.total.push, 1));
  assert(close(out.btts.yes + out.btts.no, 1));
});

test("none of the derivation functions take a market argument", () => {
  // This is a static-shape sanity test: market probabilities are
  // derived from the joint distribution only. We assert the function
  // signatures by attempting calls with no market input — TypeScript
  // already enforces this at compile time.
  const mr = matchResultFromDistribution(joint);
  const dc = doubleChanceFromMatchResult(mr);
  const t = totalFromDistribution(joint, 2.5);
  const b = bttsFromDistribution(joint);
  assert(mr.home + mr.draw + mr.away > 0);
  assert(dc.home_or_draw > 0);
  assert(t.over + t.under > 0);
  assert(b.yes + b.no > 0);
});

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("❌ market-probabilities tests FAILED"); process.exit(1); }
console.log(`✅ All ${pass} tests passed.`);
