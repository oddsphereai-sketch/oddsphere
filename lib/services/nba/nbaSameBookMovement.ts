export type NbaMovementMarket = "moneyline" | "spread" | "total";

export type NbaMovementHistoryRow = {
  externalGameId: number;
  market: NbaMovementMarket;
  side: string;
  sportsbook: string;
  line: number | null;
  americanPrice: number | null;
  observedAt: string | null;
};

export type NbaComparableOpening = {
  americanPrice: number;
  sportsbook: string;
  line: number | null;
  observedAt: string;
};

function normalizedBook(value: string): string {
  return value.trim().toLowerCase();
}

function lineToken(market: NbaMovementMarket, line: number | null): string | null {
  if (market === "moneyline") return "moneyline";
  return line !== null && Number.isFinite(line) ? line.toFixed(3) : null;
}

function implied(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

/**
 * Returns an opening price only when it is comparable with the evaluated
 * current quote: same game, market, side, sportsbook, and exact line for
 * Spread/Total. This may support a price-movement description; it does not by
 * itself authorize steam, RLM, resistance, or buyback classification.
 */
export function selectNbaComparableOpening(args: {
  rows: readonly NbaMovementHistoryRow[];
  externalGameId: number;
  market: NbaMovementMarket;
  side: string | null;
  sportsbook: string | null;
  line: number | null;
  maximumImpliedOutlier?: number;
}): NbaComparableOpening | null {
  if (args.side === null || args.sportsbook === null) return null;
  const targetLine = lineToken(args.market, args.line);
  if (targetLine === null) return null;
  const book = normalizedBook(args.sportsbook);
  const candidates = args.rows
    .filter((row) =>
      row.externalGameId === args.externalGameId &&
      row.market === args.market &&
      row.side === args.side &&
      normalizedBook(row.sportsbook) === book &&
      lineToken(row.market, row.line) === targetLine &&
      row.americanPrice !== null && row.americanPrice !== 0 &&
      row.observedAt !== null && Number.isFinite(Date.parse(row.observedAt)))
    .sort((left, right) => Date.parse(left.observedAt!) - Date.parse(right.observedAt!));
  if (candidates.length === 0) return null;
  const probabilities = candidates.map((row) => implied(row.americanPrice!)).sort((a, b) => a - b);
  const middle = Math.floor(probabilities.length / 2);
  const median = probabilities.length % 2 === 1
    ? probabilities[middle]!
    : (probabilities[middle - 1]! + probabilities[middle]!) / 2;
  const maximumOutlier = args.maximumImpliedOutlier ?? 0.30;
  const opening = candidates.find((row) =>
    Math.abs(implied(row.americanPrice!) - median) <= maximumOutlier);
  if (!opening) return null;
  return {
    americanPrice: opening.americanPrice!,
    sportsbook: opening.sportsbook,
    line: opening.line,
    observedAt: new Date(opening.observedAt!).toISOString(),
  };
}
