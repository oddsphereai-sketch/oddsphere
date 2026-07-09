/**
 * Phase 6B V2.1 — run distribution probability helpers.
 *
 * Models MLB game scoring as two independent Poissons. Computes:
 *   - P(home wins) numerically from joint Poisson PMF
 *   - P(over total) via convolution (sum of Poissons is Poisson)
 *   - Future run-line probabilities (-1.5 / +1.5 cover) via joint sum
 *
 * Pure functions. No DB, no I/O. Inputs are continuous lambdas (expected
 * runs); outputs are probabilities in [0, 1].
 *
 * Design notes:
 *   - Numerical sum over 0..MAX_RUNS (default 20) covers MLB's empirical
 *     scoring distribution; missed mass < 1e-6 for typical lambdas (3–6).
 *   - Factorials up to 25! fit comfortably in IEEE-754 double precision.
 *   - Ties (h == a) are reallocated proportional to lambda ratio because
 *     MLB has no in-line ties (extra innings break them) — historical
 *     home-team-winning-when-tied-at-9 rate is mild edge to higher-lambda
 *     team; the lambda ratio is a defensible approximation.
 *
 * V2.1 uses these helpers in place of the run-share-inverse heuristic V2
 * used. Probability-based decisions don't suffer from 1-decimal score
 * rounding ties.
 */

/** Maximum runs summed over for joint Poisson PMF. */
const MAX_RUNS = 20;

/** Precomputed factorials 0! ... 25!. */
const FACTORIALS: number[] = (() => {
  const f: number[] = [1];
  for (let i = 1; i <= 25; i++) f.push(f[i - 1] * i);
  return f;
})();

/** Poisson PMF: P(X = k | lambda). */
export function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k > 25) {
    // Fall back to log-space to avoid overflow.
    const logP = -lambda + k * Math.log(lambda) - logFactorial(k);
    return Math.exp(logP);
  }
  return Math.exp(-lambda) * Math.pow(lambda, k) / FACTORIALS[k];
}

/** Poisson CDF: P(X <= k | lambda). */
export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPmf(i, lambda);
  return Math.min(1, sum);
}

function logFactorial(n: number): number {
  // Stirling's approximation good enough for n > 25.
  if (n <= 25) return Math.log(FACTORIALS[n]);
  return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n);
}

function logGamma(z: number): number {
  // Lanczos approximation, coefficients from Numerical Recipes.
  const p = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019571e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.9999999999998099;
  for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
  const t = z + p.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Probability the home team's run total exceeds the away team's, given
 * independent Poisson scoring. Ties are reallocated proportional to
 * lambdas (lambda_home / (lambda_home + lambda_away)).
 *
 * Returns a probability in [0, 1]. Symmetric: P(home) + P(away) === 1.
 */
export function homeWinProbabilityPoisson(
  lambdaHome: number,
  lambdaAway: number,
): number {
  if (lambdaHome <= 0 && lambdaAway <= 0) return 0.5;
  if (lambdaHome <= 0) return 0;
  if (lambdaAway <= 0) return 1;

  // Pre-compute marginals.
  const pmfHome: number[] = [];
  const pmfAway: number[] = [];
  for (let i = 0; i <= MAX_RUNS; i++) {
    pmfHome.push(poissonPmf(i, lambdaHome));
    pmfAway.push(poissonPmf(i, lambdaAway));
  }

  let pHome = 0, pAway = 0, pTie = 0;
  for (let h = 0; h <= MAX_RUNS; h++) {
    for (let a = 0; a <= MAX_RUNS; a++) {
      const joint = pmfHome[h] * pmfAway[a];
      if (h > a) pHome += joint;
      else if (a > h) pAway += joint;
      else pTie += joint;
    }
  }
  // Reallocate ties.
  const totalLambda = lambdaHome + lambdaAway;
  pHome += pTie * (lambdaHome / totalLambda);
  pAway += pTie * (lambdaAway / totalLambda);

  // Numerical drift correction — sum to 1.
  const total = pHome + pAway;
  return pHome / total;
}

/**
 * Probability total runs exceed `listedTotal`. Sum of two Poissons is
 * a Poisson(lambda_home + lambda_away).
 *
 * Half-integer lines (e.g., 8.5): P(over) = P(X >= 9) = 1 - P(X <= 8).
 * Integer lines (push): split refund convention — return P(X > listed).
 */
export function overProbabilityPoisson(
  lambdaHome: number,
  lambdaAway: number,
  listedTotal: number,
): number {
  const lambdaTotal = Math.max(0, lambdaHome) + Math.max(0, lambdaAway);
  if (lambdaTotal <= 0) return 0;
  if (!Number.isInteger(listedTotal)) {
    // .5 line — over fires at >= ceil(listed)
    return 1 - poissonCdf(Math.floor(listedTotal), lambdaTotal);
  }
  // Integer — over fires at > listed (push refunds aren't modeled)
  return 1 - poissonCdf(listedTotal, lambdaTotal);
}

/**
 * Negative-binomial PMF using mean/dispersion parameterization:
 *
 *   mean = μ
 *   variance = μ + αμ²
 *
 * α=0 collapses to Poisson. Larger α creates heavier tails, which is useful
 * as a candidate model for MLB totals because real scoring is often more
 * dispersed than a pure Poisson assumption.
 */
export function negativeBinomialPmf(k: number, mean: number, alpha: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (mean <= 0) return k === 0 ? 1 : 0;
  if (alpha <= 0) return poissonPmf(k, mean);

  const r = 1 / alpha;
  const p = r / (r + mean);
  const logP =
    logGamma(k + r) -
    logGamma(r) -
    logFactorial(k) +
    r * Math.log(p) +
    k * Math.log(1 - p);
  return Math.exp(logP);
}

/** Negative-binomial CDF: P(X <= k). */
export function negativeBinomialCdf(k: number, mean: number, alpha: number): number {
  if (k < 0) return 0;
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += negativeBinomialPmf(i, mean, alpha);
  return Math.min(1, sum);
}

/**
 * Probability total runs exceed `listedTotal` under a negative-binomial
 * total-runs model. This is research/audit-ready and not used by production
 * unless explicitly wired in by a future model change.
 */
export function overProbabilityNegativeBinomial(
  lambdaHome: number,
  lambdaAway: number,
  listedTotal: number,
  alpha: number,
): number {
  const mean = Math.max(0, lambdaHome) + Math.max(0, lambdaAway);
  if (mean <= 0) return 0;
  const cutoff = Math.floor(listedTotal);
  return 1 - negativeBinomialCdf(cutoff, mean, alpha);
}

/**
 * Probability total runs exceed `listedTotal` under a zero-inflated Poisson
 * total-runs model. `zeroInflation` is the extra mass assigned to zero total
 * runs before scaling the ordinary Poisson distribution by (1 - pi).
 */
export function overProbabilityZeroInflatedPoisson(
  lambdaHome: number,
  lambdaAway: number,
  listedTotal: number,
  zeroInflation: number,
): number {
  const mean = Math.max(0, lambdaHome) + Math.max(0, lambdaAway);
  if (mean <= 0) return 0;
  const pi = Math.max(0, Math.min(0.95, zeroInflation));
  const cutoff = Math.floor(listedTotal);
  const poissonCdfAtCutoff = poissonCdf(cutoff, mean);
  const zeroIncluded = cutoff >= 0 ? pi : 0;
  const cdf = zeroIncluded + (1 - pi) * poissonCdfAtCutoff;
  return 1 - Math.min(1, cdf);
}

/**
 * Probability home team wins by 2+ runs (covers home −1.5 run line).
 */
export function homeMinus1_5Probability(
  lambdaHome: number,
  lambdaAway: number,
): number {
  if (lambdaHome <= 0) return 0;
  if (lambdaAway <= 0) return 1; // home will score, away won't
  const pmfHome: number[] = [];
  const pmfAway: number[] = [];
  for (let i = 0; i <= MAX_RUNS; i++) {
    pmfHome.push(poissonPmf(i, lambdaHome));
    pmfAway.push(poissonPmf(i, lambdaAway));
  }
  let pCover = 0;
  for (let h = 2; h <= MAX_RUNS; h++) {
    for (let a = 0; a <= h - 2; a++) {
      pCover += pmfHome[h] * pmfAway[a];
    }
  }
  return pCover;
}

/**
 * Probability away team's deficit ≤ 1 (covers away +1.5 run line).
 * = 1 - P(home wins by 2+).
 */
export function awayPlus1_5Probability(
  lambdaHome: number,
  lambdaAway: number,
): number {
  return 1 - homeMinus1_5Probability(lambdaHome, lambdaAway);
}

/**
 * No-vig probability → fair American odds (positive integer or negative).
 * Used to compute EV from model probability vs market odds.
 */
export function probabilityToAmericanOdds(prob: number): number {
  if (prob <= 0 || prob >= 1) return 0;
  if (prob < 0.5) return Math.round((1 - prob) / prob * 100);
  return Math.round(-prob / (1 - prob) * 100);
}

/**
 * Expected value of a $1 bet at given American odds and model probability.
 * Positive EV means +EV bet. Common threshold: EV >= 0.02 (2%).
 */
export function expectedValuePerDollar(
  modelProb: number,
  americanOdds: number,
): number {
  if (modelProb <= 0 || modelProb >= 1) return 0;
  const decimalOdds = americanOdds > 0
    ? 1 + americanOdds / 100
    : 1 + 100 / Math.abs(americanOdds);
  const payoff = decimalOdds - 1;
  return modelProb * payoff - (1 - modelProb);
}
