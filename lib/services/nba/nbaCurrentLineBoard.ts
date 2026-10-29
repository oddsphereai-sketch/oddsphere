import {
  isNbaAuthoritativeSportsbook,
  isNbaConsumerExecutionSportsbook,
} from "./nbaMarketSourceEligibility";

export const NBA_CURRENT_LINE_RELATIVE_FRESH_MINUTES = 120 as const;

export type NbaCurrentLineBoardRow = {
  market_type: string;
  sportsbook: string;
  side: string | null;
  fetched_at?: string | null;
};

function observedMs(row: NbaCurrentLineBoardRow): number {
  if (row.fetched_at === null || row.fetched_at === undefined) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(row.fetched_at);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Collapse append-only line history into one current quote per
 * sportsbook/market/side, then reject a book whose newest quote materially
 * predates the freshest quote available for the same game and market.
 *
 * The relative cutoff is intentional. Future rolling-board games may be
 * collected less frequently than today's slate, but an abandoned old book
 * must never win price shopping merely because its historical American price
 * is numerically larger.
 */
export function selectNbaCurrentLineBoard<T extends NbaCurrentLineBoardRow>(
  rows: readonly T[],
  maxRelativeAgeMinutes: number = NBA_CURRENT_LINE_RELATIVE_FRESH_MINUTES,
): T[] {
  if (!Number.isFinite(maxRelativeAgeMinutes) || maxRelativeAgeMinutes < 0) {
    throw new Error("NBA current-line relative freshness must be non-negative.");
  }

  const latestByIdentity = new Map<string, T>();
  for (const row of rows) {
    if (!isNbaAuthoritativeSportsbook(row.sportsbook)) continue;
    const key = [
      row.sportsbook.trim().toLowerCase(),
      row.market_type.trim().toLowerCase(),
      row.side?.trim().toLowerCase() ?? "",
    ].join("::");
    const previous = latestByIdentity.get(key);
    if (previous === undefined || observedMs(row) >= observedMs(previous)) {
      latestByIdentity.set(key, row);
    }
  }

  const latest = [...latestByIdentity.values()];
  const anchorByMarket = new Map<string, number>();
  for (const row of latest) {
    const market = row.market_type.trim().toLowerCase();
    anchorByMarket.set(market, Math.max(anchorByMarket.get(market) ?? Number.NEGATIVE_INFINITY, observedMs(row)));
  }

  return latest.filter((row) => {
    const anchorMs = anchorByMarket.get(row.market_type.trim().toLowerCase()) ?? Number.NEGATIVE_INFINITY;
    if (!Number.isFinite(anchorMs)) return false;
    return observedMs(row) >= anchorMs - maxRelativeAgeMinutes * 60_000;
  });
}

/**
 * Member execution is a real, broadly available consumer sportsbook quote.
 * Circa/Pinnacle stay in the separate professional reader evidence lane. When
 * consumer books disagree around pick'em, a non-zero offered line takes
 * precedence; a zero is never converted into a synthetic -1 or -1.5.
 */
export function selectNbaConsumerExecutionBoard<T extends NbaCurrentLineBoardRow & { line_value?: number | null }>(
  rows: readonly T[],
): T[] {
  const consumer = rows.filter((row) => isNbaConsumerExecutionSportsbook(row.sportsbook));
  const hasNonZeroSpread = consumer.some((row) =>
    row.market_type.trim().toLowerCase() === "spread" &&
    typeof row.line_value === "number" && Math.abs(row.line_value) >= 0.01
  );
  return consumer.filter((row) => !(
    hasNonZeroSpread && row.market_type.trim().toLowerCase() === "spread" &&
    typeof row.line_value === "number" && Math.abs(row.line_value) < 0.01
  ));
}
