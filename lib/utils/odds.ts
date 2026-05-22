/**
 * Odds format conversions.
 *
 * Three representations are used across the system:
 *   American    — sportsbook-native (-145, +160, ...). Convention: -100 is
 *                 even; magnitudes ≥100 always.
 *   Decimal     — Pinnacle / European style (1.690 for -145).
 *   Implied %   — Probability the bet hits (0.5918 for -145).
 *
 * All functions are pure. No rounding except where stated; the caller decides
 * presentation precision.
 */

export function americanToImplied(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return -american / (-american + 100);
}

export function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / -american + 1;
}

export function impliedToAmerican(probability: number): number {
  if (probability <= 0 || probability >= 1) {
    throw new Error(`impliedToAmerican: probability must be in (0, 1), got ${probability}`);
  }
  if (probability >= 0.5) return Math.round((-100 * probability) / (1 - probability));
  return Math.round((100 * (1 - probability)) / probability);
}

export function impliedToDecimal(probability: number): number {
  if (probability <= 0 || probability >= 1) {
    throw new Error(`impliedToDecimal: probability must be in (0, 1), got ${probability}`);
  }
  return 1 / probability;
}

export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) {
    throw new Error(`decimalToAmerican: decimal must be > 1, got ${decimal}`);
  }
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export function decimalToImplied(decimal: number): number {
  if (decimal <= 1) {
    throw new Error(`decimalToImplied: decimal must be > 1, got ${decimal}`);
  }
  return 1 / decimal;
}

/**
 * Profit-on-win as a fraction of stake.
 *   -145 → 0.6897  (bet 100, win 68.97)
 *   +160 → 1.6000  (bet 100, win 160)
 *
 * Used by EV calculations.
 */
export function profitMultiplier(american: number): number {
  if (american > 0) return american / 100;
  return 100 / -american;
}

/**
 * EV percent against a "true" probability.
 *   ev = fairProb × profitOnWin − (1 − fairProb)
 *
 * Positive → +EV bet; negative → −EV.
 * Result is a percent (×100), rounded to 2 dp.
 */
export function evPercent(americanOdds: number, fairProbability: number): number {
  const profit = profitMultiplier(americanOdds);
  const ev = fairProbability * profit - (1 - fairProbability);
  return +(ev * 100).toFixed(2);
}
