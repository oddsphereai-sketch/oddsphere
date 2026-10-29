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

const NBA_SHARP_READER_BOOKS: ReadonlySet<string> = new Set([
  "bookmaker",
  "circa",
  "pinnacle",
]);

/** Real consumer books retained from BALLDONTLIE for retail market context. */
const NBA_CONSUMER_RETAIL_BOOKS: ReadonlySet<string> = new Set([
  "ballybet",
  "bet365",
  "betmgm",
  "betparx",
  "betrivers",
  "betway",
  "caesars",
  "draftkings",
  "fanatics",
  "fanduel",
  "hardrock",
  "hardrockbet",
  "rebet",
]);

/**
 * Broadly available regulated books that may own the member-facing executable
 * quote. Sharp books remain reader evidence, while smaller retail sources can
 * corroborate the market without deciding the displayed handicap.
 */
const NBA_CONSUMER_EXECUTION_BOOKS: ReadonlySet<string> = new Set([
  "bet365",
  "betmgm",
  "betrivers",
  "caesars",
  "draftkings",
  "fanatics",
  "fanduel",
  "hardrock",
  "hardrockbet",
]);

export function isNbaAuthoritativeSportsbook(name: string | null | undefined): boolean {
  if (name === null || name === undefined || name.trim() === "") return false;
  const canonical = name.trim().toLowerCase();
  return !isBlockedSportsbook(canonical) && !NBA_NON_SPORTSBOOK_MARKET_SOURCES.has(canonical);
}

export function isNbaSharpReaderSportsbook(name: string | null | undefined): boolean {
  return name !== null && name !== undefined && NBA_SHARP_READER_BOOKS.has(name.trim().toLowerCase());
}

export function isNbaConsumerRetailSportsbook(name: string | null | undefined): boolean {
  return name !== null && name !== undefined && NBA_CONSUMER_RETAIL_BOOKS.has(name.trim().toLowerCase());
}

export function isNbaConsumerExecutionSportsbook(name: string | null | undefined): boolean {
  return name !== null && name !== undefined && NBA_CONSUMER_EXECUTION_BOOKS.has(name.trim().toLowerCase());
}

export const __NBA_MARKET_SOURCE_ELIGIBILITY_TEST__ = {
  nonSportsbookMarketSources: NBA_NON_SPORTSBOOK_MARKET_SOURCES,
  sharpReaderBooks: NBA_SHARP_READER_BOOKS,
  consumerRetailBooks: NBA_CONSUMER_RETAIL_BOOKS,
  consumerExecutionBooks: NBA_CONSUMER_EXECUTION_BOOKS,
};
