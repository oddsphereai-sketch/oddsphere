/** Confidence is an outcome opinion; offered value remains a separate fact.
 * This qualifies a bounded confidence Lean, never a forecast or Best Angle. */
export const CONFIDENCE_LEAN_PRICE_RELEASE = "daily_edge_confidence_lean_price_2026_11_06_r1_paired_margin" as const;

export function assessConfidenceLeanPrice(args: {
  winProbability: number;
  loseProbability: number;
  price: number;
  opposingPrice: number;
  minimumWinProbability: number;
  probabilityErrorEstimate?: number;
}) {
  const { winProbability: p, loseProbability: loss, price, opposingPrice, minimumWinProbability: floor } = args;
  const error = args.probabilityErrorEstimate ?? 0;
  const implied = (n: number) => n > 0 ? 100 / (100 + n) : -n / (100 - n);
  const valid = [p, loss, price, opposingPrice, floor, error].every(Number.isFinite) &&
    p >= 0 && loss >= 0 && p + loss > 0 && p + loss <= 1 + 1e-10 &&
    Math.abs(price) >= 100 && Math.abs(opposingPrice) >= 100 && floor > .5 && floor < 1 && error >= 0;
  const hold = valid ? implied(price) + implied(opposingPrice) : null;
  const coherent = hold !== null && hold >= .98 && hold <= 1.3;
  const breakEven = coherent ? implied(price) : null;
  const allowance = coherent ? Math.max(0, hold - 1) : null;
  const requiredProbability = breakEven !== null && allowance !== null ? (breakEven - allowance) * (p + loss) : null;
  const confidenceQualified = valid && p - error >= floor;
  const withinPairedMargin = coherent && requiredProbability !== null && p - error >= requiredProbability;
  return { release: CONFIDENCE_LEAN_PRICE_RELEASE, coherentPair: coherent, confidenceQualified,
    withinPairedMargin, qualified: confidenceQualified && withinPairedMargin, minimumWinProbability: floor,
    pairedImpliedSum: hold, breakEvenProbability: breakEven, observedMarginAllowance: allowance,
    requiredUnconditionalWinProbability: requiredProbability,
    meaning: "outcome_confidence_with_observed_paired_price_margin;not_a_positive_value_claim" as const };
}
