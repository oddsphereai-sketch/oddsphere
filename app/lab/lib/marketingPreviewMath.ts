import { americanToImplied } from "./marketImplied";

/**
 * Fixture-only market math for the public Daily Edge preview.
 *
 * The preview uses the same no-vig normalization as the authenticated
 * Daily Edge reader: convert every displayed American price to its raw
 * implied probability, then divide the selected outcome by the market's
 * full implied-probability total. This keeps illustrative market context
 * numerically coherent without introducing a second grading calculation.
 */
export function marketingNoVigProbability(
  selectedAmerican: number,
  opposingAmerican: readonly number[],
): number {
  const selectedRaw = americanToImplied(selectedAmerican);
  const marketRaw = opposingAmerican.reduce(
    (sum, american) => sum + americanToImplied(american),
    selectedRaw,
  );

  if (!Number.isFinite(marketRaw) || marketRaw <= 0) {
    throw new Error("Illustrative market prices must produce a positive implied-probability total.");
  }

  return selectedRaw / marketRaw;
}

export function marketingModelGapPct(
  modelProbability: number,
  selectedAmerican: number,
  opposingAmerican: readonly number[],
): number {
  return (modelProbability - marketingNoVigProbability(selectedAmerican, opposingAmerican)) * 100;
}

export function marketingProjectedTotal(away: number, home: number): number {
  return away + home;
}

export const MARKETING_SOCCER_MATCH_RESULT_PRICES = {
  selected: 110,
  draw: 240,
  away: 220,
} as const;
