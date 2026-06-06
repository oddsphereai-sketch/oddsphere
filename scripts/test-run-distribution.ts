/**
 * Phase 6B V2.1 — unit tests for runDistribution.ts (Poisson engine).
 * Pure tests, no DB, no env, no network.
 */

import {
  poissonPmf,
  poissonCdf,
  homeWinProbabilityPoisson,
  overProbabilityPoisson,
  homeMinus1_5Probability,
  awayPlus1_5Probability,
  probabilityToAmericanOdds,
  expectedValuePerDollar,
} from "../lib/automodel/runDistribution";

let pass = 0, fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; const m = `  ✗ ${label}${hint ? " — " + hint : ""}`; console.log(m); failures.push(m); }
}

function inRange(n: number, lo: number, hi: number): boolean {
  return Number.isFinite(n) && n >= lo && n <= hi;
}

function near(a: number, b: number, tol = 0.001): boolean {
  return Math.abs(a - b) <= tol;
}

function section(t: string) { console.log(`\n━━━ ${t} ━━━`); }

async function main() {
  // ─── poissonPmf ─────────────────────────────────────────────────────
  section("poissonPmf");
  check("PMF(0, λ=0) = 1 (degenerate)", poissonPmf(0, 0) === 1);
  check("PMF(1, λ=0) = 0", poissonPmf(1, 0) === 0);
  check("PMF(k, λ) in [0,1] for k=0..15, λ=4.5", (() => {
    for (let k = 0; k <= 15; k++) {
      const p = poissonPmf(k, 4.5);
      if (!inRange(p, 0, 1)) return false;
    }
    return true;
  })());
  check("PMF(5, λ=5) ≈ 0.1755 (known value)", near(poissonPmf(5, 5), 0.17547, 0.001));
  check("PMF(4, λ=4) ≈ 0.1954", near(poissonPmf(4, 4), 0.19537, 0.001));
  check("PMF negative k returns 0", poissonPmf(-1, 5) === 0);
  check("PMF non-integer k returns 0", poissonPmf(2.5, 5) === 0);
  check("no NaN for MLB-typical λ=8.7, k=10", Number.isFinite(poissonPmf(10, 8.7)));
  check("PMF sums to ~1 over 0..30 for λ=5", (() => {
    let sum = 0;
    for (let k = 0; k <= 30; k++) sum += poissonPmf(k, 5);
    return near(sum, 1, 0.001);
  })());

  // ─── poissonCdf ─────────────────────────────────────────────────────
  section("poissonCdf");
  check("CDF(0, λ=0) = 1", poissonCdf(0, 0) === 1);
  check("CDF monotonic non-decreasing for λ=5", (() => {
    let prev = -1;
    for (let k = 0; k <= 15; k++) {
      const c = poissonCdf(k, 5);
      if (c < prev) return false;
      prev = c;
    }
    return true;
  })());
  check("CDF(∞-ish, λ=5) ≈ 1", near(poissonCdf(50, 5), 1, 0.0001));
  check("CDF(4, λ=5) ≈ 0.4405", near(poissonCdf(4, 5), 0.4405, 0.001));

  // ─── homeWinProbabilityPoisson ─────────────────────────────────────
  section("homeWinProbabilityPoisson");
  check("symmetric λ=λ → ~0.5", near(homeWinProbabilityPoisson(4.5, 4.5), 0.5, 0.01));
  check("home λ > away λ → home prob > 0.5", homeWinProbabilityPoisson(5.0, 4.0) > 0.5);
  check("away λ > home λ → home prob < 0.5", homeWinProbabilityPoisson(4.0, 5.0) < 0.5);
  check("home prob in [0,1]", inRange(homeWinProbabilityPoisson(4.5, 4.5), 0, 1));
  check("MONOTONIC: P(home) increases as λ_home increases", (() => {
    const p1 = homeWinProbabilityPoisson(4.0, 4.5);
    const p2 = homeWinProbabilityPoisson(4.5, 4.5);
    const p3 = homeWinProbabilityPoisson(5.0, 4.5);
    return p1 < p2 && p2 < p3;
  })());
  check("MONOTONIC: P(home) decreases as λ_away increases", (() => {
    const p1 = homeWinProbabilityPoisson(4.5, 4.0);
    const p2 = homeWinProbabilityPoisson(4.5, 4.5);
    const p3 = homeWinProbabilityPoisson(4.5, 5.0);
    return p1 > p2 && p2 > p3;
  })());
  check("extreme λ_home → high P(home win)", homeWinProbabilityPoisson(10, 2) > 0.9);
  check("extreme λ_away → low P(home win)", homeWinProbabilityPoisson(2, 10) < 0.1);
  check("no NaN for MLB-typical lambdas (3-6)", (() => {
    for (let h = 3.0; h <= 6.0; h += 0.5) {
      for (let a = 3.0; a <= 6.0; a += 0.5) {
        if (!Number.isFinite(homeWinProbabilityPoisson(h, a))) return false;
      }
    }
    return true;
  })());

  // ─── overProbabilityPoisson ─────────────────────────────────────────
  section("overProbabilityPoisson");
  check("P(over) in [0,1] for λ=8.5, total=8.5", inRange(overProbabilityPoisson(4.5, 4.0, 8.5), 0, 1));
  check("MONOTONIC: P(over) decreases as listed_total increases", (() => {
    const p1 = overProbabilityPoisson(4.5, 4.0, 7.5);
    const p2 = overProbabilityPoisson(4.5, 4.0, 8.5);
    const p3 = overProbabilityPoisson(4.5, 4.0, 9.5);
    return p1 > p2 && p2 > p3;
  })());
  check("MONOTONIC: P(over) increases as λ_total increases", (() => {
    const p1 = overProbabilityPoisson(3.5, 3.5, 8.5);
    const p2 = overProbabilityPoisson(4.5, 4.0, 8.5);
    const p3 = overProbabilityPoisson(5.5, 5.0, 8.5);
    return p1 < p2 && p2 < p3;
  })());
  check(".5 line: P(over 8.5 | λ=8.5) ~ near 0.5", near(overProbabilityPoisson(4.25, 4.25, 8.5), 0.5, 0.05));
  check("very high total → P(over) low", overProbabilityPoisson(4.5, 4.0, 15.5) < 0.05);
  check("very low total → P(over) high", overProbabilityPoisson(4.5, 4.0, 4.5) > 0.9);

  // ─── run-line probabilities ─────────────────────────────────────────
  section("run-line probabilities");
  check("home -1.5 + away +1.5 sum to 1", near(
    homeMinus1_5Probability(4.5, 4.5) + awayPlus1_5Probability(4.5, 4.5), 1, 0.001
  ));
  check("home -1.5 prob in [0,1]", inRange(homeMinus1_5Probability(5.5, 4.0), 0, 1));
  check("MONOTONIC: home -1.5 prob increases with home λ", (() => {
    const p1 = homeMinus1_5Probability(4.0, 4.0);
    const p2 = homeMinus1_5Probability(5.0, 4.0);
    return p1 < p2;
  })());

  // ─── conversion helpers ─────────────────────────────────────────────
  section("conversion helpers");
  check("probabilityToAmericanOdds(0.5) → +100", probabilityToAmericanOdds(0.5) === -100 || probabilityToAmericanOdds(0.5) === 100);
  check("probabilityToAmericanOdds(0.6) → -150", probabilityToAmericanOdds(0.6) === -150);
  check("probabilityToAmericanOdds(0.4) → +150", probabilityToAmericanOdds(0.4) === 150);

  // ─── EV ─────────────────────────────────────────────────────────────
  section("expectedValuePerDollar");
  check("EV at fair odds = 0", near(expectedValuePerDollar(0.5, 100), 0, 0.001));
  check("EV(-110, 0.6) > 0 (positive edge)", expectedValuePerDollar(0.6, -110) > 0);
  check("EV(-110, 0.5) < 0 (vig)", expectedValuePerDollar(0.5, -110) < 0);
  check("EV(+200, 0.45) > 0", expectedValuePerDollar(0.45, 200) > 0);

  // ─── Summary ────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All runDistribution tests passed.`);
}

main().then(() => process.exit(0), (e) => { console.error("FATAL:", e); process.exit(1); });
