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

export type NbaCanonicalPriceHistoryRow = {
  sportsbook: string;
  market: NbaMovementMarket;
  selectionKey: string;
  americanPrice: number | null;
  line: number | null;
  providerTimestamp: string | null;
  fetchedAt: string;
};

/**
 * Reuse the fully paginated canonical price-observation lane for NBA opening
 * and same-book evidence. The former direct `line_history` read was capped by
 * PostgREST at 1,000 rows, so a multi-game slate silently lost later games.
 */
export function buildNbaMovementHistoryFromCanonicalPrices(args: {
  rowsByExternalGameId: ReadonlyMap<number, readonly NbaCanonicalPriceHistoryRow[]>;
}): NbaMovementHistoryRow[] {
  return [...args.rowsByExternalGameId.entries()].flatMap(([externalGameId, rows]) => rows.flatMap((row) => {
    const side = row.selectionKey.split(":").at(-1) ?? "";
    const validSide = row.market === "total"
      ? side === "over" || side === "under"
      : side === "home" || side === "away";
    const observedAt = row.providerTimestamp ?? row.fetchedAt;
    if (!validSide || !row.sportsbook.trim() || !Number.isFinite(Date.parse(observedAt))) return [];
    return [{
      externalGameId,
      market: row.market,
      side,
      sportsbook: row.sportsbook,
      line: row.line,
      americanPrice: row.americanPrice,
      observedAt,
    }];
  })).sort((left, right) =>
    Date.parse(left.observedAt ?? "") - Date.parse(right.observedAt ?? "") ||
    left.externalGameId - right.externalGameId ||
    left.market.localeCompare(right.market) ||
    left.sportsbook.localeCompare(right.sportsbook) ||
    left.side.localeCompare(right.side));
}

export type NbaComparableOpening = {
  americanPrice: number;
  sportsbook: string;
  line: number | null;
  observedAt: string;
};

export type NbaConsensusOpeningSpread = {
  spreadHome: number;
  observedAt: string;
  sportsbooks: string[];
  basis: "first_tracked_per_book_consensus";
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

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Reconstructs the first tracked multi-book home spread for a game. This is
 * deliberately not called a provider opener: each included book contributes
 * its earliest canonical home-spread observation before the current snapshot.
 */
export function selectNbaConsensusOpeningSpread(args: {
  rows: readonly NbaMovementHistoryRow[];
  externalGameId: number;
  acceptedSportsbooks: readonly string[];
  currentObservedAt: string | null;
  maximumConsensusOutlier?: number;
}): NbaConsensusOpeningSpread | null {
  const currentObservedMs = Date.parse(args.currentObservedAt ?? "");
  if (!Number.isFinite(currentObservedMs)) return null;
  const accepted = new Set(args.acceptedSportsbooks.map(normalizedBook));
  if (accepted.size === 0) return null;
  const firstByBook = new Map<string, NbaMovementHistoryRow>();
  for (const row of args.rows) {
    const book = normalizedBook(row.sportsbook);
    const observedMs = Date.parse(row.observedAt ?? "");
    if (
      row.externalGameId !== args.externalGameId || row.market !== "spread" ||
      row.side !== "home" || row.line === null || !Number.isFinite(row.line) ||
      !accepted.has(book) || !Number.isFinite(observedMs) || observedMs >= currentObservedMs
    ) continue;
    const existing = firstByBook.get(book);
    if (!existing || observedMs < Date.parse(existing.observedAt!)) firstByBook.set(book, row);
  }
  if (firstByBook.size === 0) return null;
  const center = median([...firstByBook.values()].map((row) => row.line!));
  const maximumOutlier = args.maximumConsensusOutlier ?? 4;
  const retained = [...firstByBook.entries()].filter(([, row]) =>
    Math.abs(row.line! - center) <= maximumOutlier);
  if (retained.length === 0) return null;
  return {
    spreadHome: median(retained.map(([, row]) => row.line!)),
    observedAt: new Date(Math.min(...retained.map(([, row]) => Date.parse(row.observedAt!)))).toISOString(),
    sportsbooks: retained.map(([book]) => book).sort(),
    basis: "first_tracked_per_book_consensus",
  };
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
  currentObservedAt: string | null;
  maximumImpliedOutlier?: number;
}): NbaComparableOpening | null {
  if (args.side === null || args.sportsbook === null) return null;
  const currentObservedMs = Date.parse(args.currentObservedAt ?? "");
  if (!Number.isFinite(currentObservedMs)) return null;
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
      row.observedAt !== null && Number.isFinite(Date.parse(row.observedAt)) &&
      Date.parse(row.observedAt) < currentObservedMs)
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
