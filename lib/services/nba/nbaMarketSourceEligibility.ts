import { isBlockedSportsbook } from "../../config/blockedSportsbooks";

/**
 * Prediction-market exchanges are useful raw observations, but their binary
 * contracts are not interchangeable with an executable sportsbook game line.
 * Keep them in the evidence store for audit; never let them own an NBA member
 * price, market consensus, movement read, grade, or projection correction.
 */
const NBA_NON_SPORTSBOOK_MARKET_SOURCES: ReadonlySet<string> = new Set([
  "kalshi",
  "polymarket",
  "robinhood",
]);

export function isNbaAuthoritativeSportsbook(name: string | null | undefined): boolean {
  if (name === null || name === undefined || name.trim() === "") return false;
  const canonical = name.trim().toLowerCase();
  return !isBlockedSportsbook(canonical) && !NBA_NON_SPORTSBOOK_MARKET_SOURCES.has(canonical);
}

export const __NBA_MARKET_SOURCE_ELIGIBILITY_TEST__ = {
  nonSportsbookMarketSources: NBA_NON_SPORTSBOOK_MARKET_SOURCES,
};
