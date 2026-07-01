const MAX_DISPLAY_AMERICAN_ODDS_ABS = 1200;
const MAX_ONE_TICK_IMPLIED_PROB_DELTA = 0.25;

export function isDisplayableAmericanOdds(american: number | null): boolean {
  if (american === null || !Number.isFinite(american)) return false;
  if (!Number.isInteger(american) || american === 0) return false;
  return Math.abs(american) >= 100 && Math.abs(american) <= MAX_DISPLAY_AMERICAN_ODDS_ABS;
}

export function americanToImpliedProbability(american: number): number {
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}

export function isDisplayableOddsMove(prev: number | null, next: number | null): boolean {
  if (!isDisplayableAmericanOdds(prev) || !isDisplayableAmericanOdds(next)) return false;
  const delta = Math.abs(americanToImpliedProbability(next!) - americanToImpliedProbability(prev!));
  return delta <= MAX_ONE_TICK_IMPLIED_PROB_DELTA;
}
