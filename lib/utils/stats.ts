/**
 * Statistical helper functions — gamma, factorials, binomial coefficients.
 *
 * All functions are pure and self-contained. Distributions in
 * `/lib/models/props/distributions/` depend on these.
 *
 * Numerical stability strategy: small-argument computations use direct
 * multiplication; larger arguments use log-space (`logGamma` etc.) to avoid
 * overflow. For the prop-prediction use case (n ≤ ~30 PA, λ ≤ ~10), direct
 * computation is sufficient — but log-space variants are exported in case
 * future use cases need them.
 */

const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/**
 * Lanczos approximation of the natural log of the gamma function.
 *
 * Accurate to ~15 decimal places for positive real x. Used by distributions
 * for stable computation of binomial coefficients, factorials, and the
 * negative binomial PMF.
 */
export function logGamma(x: number): number {
  if (x < 0.5) {
    // Reflection formula: Γ(x)Γ(1−x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const xMinus1 = x - 1;
  let a = LANCZOS_COEFFICIENTS[0];
  for (let i = 1; i < LANCZOS_COEFFICIENTS.length; i++) {
    a += LANCZOS_COEFFICIENTS[i] / (xMinus1 + i);
  }
  const t = xMinus1 + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (xMinus1 + 0.5) * Math.log(t) - t + Math.log(a);
}

export function gamma(x: number): number {
  return Math.exp(logGamma(x));
}

/**
 * log(n!). Uses the gamma identity log(n!) = logGamma(n + 1).
 */
export function logFactorial(n: number): number {
  if (n < 0) {
    throw new Error(`logFactorial: n must be ≥ 0, got ${n}`);
  }
  if (n <= 1) return 0;
  return logGamma(n + 1);
}

/**
 * Exact factorial for small integer n. Up to 170 fits in a JS number.
 * Beyond that use logFactorial.
 */
export function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`factorial: n must be a non-negative integer, got ${n}`);
  }
  if (n > 170) {
    throw new Error(
      `factorial(${n}) overflows JS Number. Use logFactorial instead.`
    );
  }
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/**
 * log(n choose k). Stable for large n via logFactorial.
 */
export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/**
 * Binomial coefficient C(n, k). Stable for n ≤ ~1000 via log-space.
 *
 * Rounds to the nearest integer because C(n, k) is always an integer for
 * integer n, k — without rounding, `Math.exp(logChoose(...))` can return
 * values like 9.999999999999998 due to floating-point accumulation.
 */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  return Math.round(Math.exp(logChoose(n, k)));
}

/**
 * Clamp a value into [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
