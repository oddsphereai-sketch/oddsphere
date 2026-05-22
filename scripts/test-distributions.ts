/**
 * Unit tests for distribution functions.
 *
 * Known-answer tests verify each function against hand-computed reference
 * values. Run via: npm run test:distributions
 *
 * If any assertion fails, the script exits non-zero — wire into CI later.
 */

import {
  binomialPmf,
  binomialCdf,
  binomialProbabilityOver,
  binomialMean,
  binomialVariance,
} from "../lib/models/props/distributions/binomial";
import {
  poissonPmf,
  poissonCdf,
  poissonProbabilityOver,
  poissonMean,
  poissonVariance,
} from "../lib/models/props/distributions/poisson";
import {
  negativeBinomialPmf,
  negativeBinomialCdf,
  negativeBinomialProbabilityOver,
  negativeBinomialMeanVar,
} from "../lib/models/props/distributions/negativeBinomial";
import {
  americanToImplied,
  americanToDecimal,
  impliedToAmerican,
  decimalToAmerican,
  evPercent,
  profitMultiplier,
} from "../lib/utils/odds";
import {
  logGamma,
  factorial,
  logFactorial,
  choose,
  logChoose,
} from "../lib/utils/stats";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function approxEq(actual: number, expected: number, tol = 1e-4): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  return Math.abs(actual - expected) < tol;
}

function check(label: string, actual: number, expected: number, tol = 1e-4) {
  const ok = approxEq(actual, expected, tol);
  if (ok) {
    pass++;
    console.log(`  ✓ ${label.padEnd(60)} = ${actual.toFixed(6)} (expected ~${expected.toFixed(6)})`);
  } else {
    fail++;
    const msg = `  ✗ ${label.padEnd(60)} = ${actual} (expected ${expected})`;
    console.log(msg);
    failures.push(msg);
  }
}

function checkExact(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  if (ok) {
    pass++;
    console.log(`  ✓ ${label.padEnd(60)} = ${actual}`);
  } else {
    fail++;
    const msg = `  ✗ ${label.padEnd(60)} = ${actual} (expected ${expected})`;
    console.log(msg);
    failures.push(msg);
  }
}

function checkThrows(label: string, fn: () => unknown) {
  try {
    fn();
    fail++;
    const msg = `  ✗ ${label.padEnd(60)} did NOT throw`;
    console.log(msg);
    failures.push(msg);
  } catch {
    pass++;
    console.log(`  ✓ ${label.padEnd(60)} threw as expected`);
  }
}

function section(title: string) {
  console.log(`\n━━━ ${title} ━━━`);
}

// ─── Utils — odds ────────────────────────────────────────────────────────
section("utils/odds.ts");

check("americanToImplied(-145)", americanToImplied(-145), 0.59184);
check("americanToImplied(+160)", americanToImplied(160), 0.38462);
check("americanToImplied(-100)", americanToImplied(-100), 0.5);
check("americanToImplied(+100)", americanToImplied(100), 0.5);
check("americanToDecimal(-145)", americanToDecimal(-145), 1.6897);
check("americanToDecimal(+160)", americanToDecimal(160), 2.6);
checkExact("impliedToAmerican(0.5)", impliedToAmerican(0.5), -100);
checkExact("impliedToAmerican(0.59184)", impliedToAmerican(0.59184), -145);
checkExact("decimalToAmerican(1.69)", decimalToAmerican(1.69), -145);
checkExact("decimalToAmerican(2.6)", decimalToAmerican(2.6), 160);
check("profitMultiplier(-145)", profitMultiplier(-145), 0.6897);
check("profitMultiplier(+160)", profitMultiplier(160), 1.6);
// EV against the SharpAPI fair price: book offers +160, model thinks 0.40
// fair_prob → EV = 0.40 × 1.6 - 0.60 × 1 = +0.04 = +4%
check("evPercent(+160, 0.40)", evPercent(160, 0.40), 4.0);
checkThrows("impliedToAmerican(0)", () => impliedToAmerican(0));
checkThrows("decimalToAmerican(1.0)", () => decimalToAmerican(1.0));

// ─── Utils — stats ───────────────────────────────────────────────────────
section("utils/stats.ts");

checkExact("factorial(0)", factorial(0), 1);
checkExact("factorial(5)", factorial(5), 120);
checkExact("factorial(10)", factorial(10), 3628800);
check("logFactorial(10)", logFactorial(10), Math.log(3628800));
check("logGamma(1)", logGamma(1), 0); // Γ(1) = 1
check("logGamma(2)", logGamma(2), 0); // Γ(2) = 1
check("logGamma(5)", logGamma(5), Math.log(24)); // Γ(5) = 4! = 24
check("logGamma(0.5)", logGamma(0.5), Math.log(Math.sqrt(Math.PI))); // Γ(0.5) = √π
checkExact("choose(5, 2)", choose(5, 2), 10);
checkExact("choose(10, 3)", choose(10, 3), 120);
check("choose(4, 2) = 6", choose(4, 2), 6);
check("logChoose(10, 3)", logChoose(10, 3), Math.log(120));

// ─── Distributions — Binomial ────────────────────────────────────────────
section("distributions/binomial.ts");

// Known-answer test (per Daniel's spec): P(X >= 1) when n=4, p=0.30 ≈ 0.7599
// Derivation: P(X = 0) = 0.7^4 = 0.2401, so P(X >= 1) = 1 - 0.2401 = 0.7599
check(
  "P(X >= 1 | n=4, p=0.30)",
  binomialProbabilityOver(4, 0.30, 1),
  0.7599
);
check("P(X = 0 | n=4, p=0.30)", binomialPmf(4, 0.30, 0), 0.2401);
check("P(X = 4 | n=4, p=0.30)", binomialPmf(4, 0.30, 4), Math.pow(0.30, 4));
check("P(X <= 4 | n=4, p=0.30) = 1", binomialCdf(4, 0.30, 4), 1.0);

// Realistic prop scenario: Aaron Judge ~0.30 hit-rate, 4 PA in a game,
// over 1.5 hits → threshold = 2 → P(X >= 2)
//   = 1 - P(X=0) - P(X=1) = 1 - 0.2401 - 4*0.3*0.343 = 1 - 0.2401 - 0.4116 = 0.3483
check(
  "Judge prop: over 1.5 hits @ p=0.30, n=4",
  binomialProbabilityOver(4, 0.30, 2),
  0.3483
);

// Boundaries
checkExact("P(X >= 0 | anything) = 1", binomialProbabilityOver(4, 0.30, 0), 1);
checkExact("P(X >= 5 | n=4) = 0", binomialProbabilityOver(4, 0.30, 5), 0);
checkExact("E[X] | n=4, p=0.30", binomialMean(4, 0.30), 1.2);
check("Var[X] | n=4, p=0.30", binomialVariance(4, 0.30), 0.84);

// PMF sums to 1 over [0, n]
let binomSum = 0;
for (let k = 0; k <= 4; k++) binomSum += binomialPmf(4, 0.30, k);
check("Σ PMF | n=4, p=0.30 = 1", binomSum, 1.0);

// ─── Distributions — Poisson ─────────────────────────────────────────────
section("distributions/poisson.ts");

// Known-answer test: P(X >= 1) when λ=1.5 ≈ 0.7769
// Derivation: P(X = 0) = e^-1.5 = 0.22313, so P(X >= 1) = 1 - 0.22313 = 0.77687
check(
  "P(X >= 1 | λ=1.5)",
  poissonProbabilityOver(1.5, 1),
  0.7769
);
check("P(X = 0 | λ=1.5)", poissonPmf(1.5, 0), Math.exp(-1.5));
check("P(X = 1 | λ=1.5)", poissonPmf(1.5, 1), 1.5 * Math.exp(-1.5));
check("P(X = 2 | λ=1.5)", poissonPmf(1.5, 2), (1.5 * 1.5 / 2) * Math.exp(-1.5));

// Realistic prop scenario: HR over 0.5 with λ = 4.3 PA × 0.035 HR/PA = 0.1505
// P(X >= 1) = 1 - e^-0.1505 ≈ 0.1397
check(
  "Judge HR prop: λ=0.1505, threshold=1",
  poissonProbabilityOver(0.1505, 1),
  0.1397
);

// Pitcher K prop: Cole at λ = 22 BFP × 0.25 K/BFP = 5.5, over 7.5 → threshold = 8
// P(X >= 8 | λ=5.5) ≈ 0.1906
check("Cole K prop: λ=5.5, threshold=8", poissonProbabilityOver(5.5, 8), 0.1906);

// Boundaries
checkExact("P(X >= 0 | λ=1.5) = 1", poissonProbabilityOver(1.5, 0), 1);
check("E[X] | λ=1.5", poissonMean(1.5), 1.5);
check("Var[X] | λ=1.5 = E[X]", poissonVariance(1.5), poissonMean(1.5));

// PMF sums to ~1 over a wide range
let poissonSum = 0;
for (let k = 0; k <= 50; k++) poissonSum += poissonPmf(5, k);
check("Σ PMF | λ=5, k=[0..50] ≈ 1", poissonSum, 1.0, 1e-6);

// ─── Distributions — Negative Binomial ───────────────────────────────────
section("distributions/negativeBinomial.ts");

// Mean/variance relationship: NB(mean=4, var=8) recovers (4, 8)
const nbMeanVar = negativeBinomialMeanVar(4, 8);
check("NB mean recovery | μ=4, σ²=8", nbMeanVar.mean, 4);
check("NB variance recovery | μ=4, σ²=8", nbMeanVar.variance, 8);

// Mean/variance: NB(mean=5, var=12.5) recovers
const nbMeanVar2 = negativeBinomialMeanVar(5, 12.5);
check("NB mean recovery | μ=5, σ²=12.5", nbMeanVar2.mean, 5);
check("NB variance recovery | μ=5, σ²=12.5", nbMeanVar2.variance, 12.5);

// PMF integrates over a reasonable range to ~1 (NB tail is heavier;
// we sum more terms).
let nbSum = 0;
for (let k = 0; k <= 100; k++) nbSum += negativeBinomialPmf(4, 8, k);
check("Σ PMF | μ=4, σ²=8, k=[0..100] ≈ 1", nbSum, 1.0, 1e-4);

// PMF non-negative throughout the range
const nbPmf0 = negativeBinomialPmf(4, 8, 0);
const nbPmf4 = negativeBinomialPmf(4, 8, 4);
const nbPmf10 = negativeBinomialPmf(4, 8, 10);
console.log(`  ✓ NB PMF samples · k=0: ${nbPmf0.toFixed(4)} · k=4: ${nbPmf4.toFixed(4)} · k=10: ${nbPmf10.toFixed(4)}`);
if (nbPmf0 > 0 && nbPmf4 > 0 && nbPmf10 > 0) pass++;
else {
  fail++;
  failures.push("NB PMF returned non-positive sample");
}

// Realistic prop: Total Bases over 1.5 — say a STAR hitter has μ=1.8 TB, σ²=3.0
// P(X >= 2 | NB(μ=1.8, σ²=3.0))
const tbOver = negativeBinomialProbabilityOver(1.8, 3.0, 2);
console.log(`  ✓ TB prop: μ=1.8, σ²=3.0, over 1.5 (threshold=2) → ${tbOver.toFixed(4)}`);
if (tbOver > 0 && tbOver < 1) pass++;
else {
  fail++;
  failures.push("TB prop returned out-of-range probability");
}

// CDF monotonicity: cdf(k) ≤ cdf(k+1)
const nbCdf2 = negativeBinomialCdf(4, 8, 2);
const nbCdf3 = negativeBinomialCdf(4, 8, 3);
if (nbCdf2 <= nbCdf3) {
  pass++;
  console.log(`  ✓ CDF monotonic: cdf(2)=${nbCdf2.toFixed(4)} ≤ cdf(3)=${nbCdf3.toFixed(4)}`);
} else {
  fail++;
  failures.push(`NB CDF not monotonic: cdf(2)=${nbCdf2} > cdf(3)=${nbCdf3}`);
}

// Throws on non-overdispersed input
checkThrows("NB with var ≤ mean throws", () => negativeBinomialPmf(5, 5, 3));
checkThrows("NB with var < mean throws", () => negativeBinomialPmf(5, 4, 3));

// ─── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log(`\nFailures:`);
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log(`\n✅ All distribution tests passed.`);
