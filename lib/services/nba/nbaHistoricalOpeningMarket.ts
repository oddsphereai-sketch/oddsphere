/** Evaluation-only NBA opening-market helpers for chronological research. */

export type NbaHistoricalOpeningOdds = {
  rowId: number;
  gameId: number;
  vendor: string;
  openedAt: string;
  moneylineHomeOdds: number | null;
  moneylineAwayOdds: number | null;
};

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function implied(american: number): number {
  if (american === 0) throw new Error("NBA historical opening odds cannot contain zero American odds.");
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function normalizeNbaHistoricalOpeningOdds(
  row: Record<string, unknown>,
): NbaHistoricalOpeningOdds {
  const rowId = integer(row.id);
  const gameId = integer(row.game_id);
  const vendor = string(row.vendor);
  const openedAt = string(row.opened_at);
  if (
    rowId === null || gameId === null || vendor === null || openedAt === null ||
    !Number.isFinite(Date.parse(openedAt))
  ) {
    throw new Error("NBA historical opening-odds input contains a malformed identity.");
  }
  return {
    rowId,
    gameId,
    vendor: vendor.toLowerCase(),
    openedAt: new Date(openedAt).toISOString(),
    moneylineHomeOdds: finite(row.moneyline_home_odds),
    moneylineAwayOdds: finite(row.moneyline_away_odds),
  };
}

/**
 * Builds one target-book-agnostic opening benchmark per game. It is allowed
 * only for evaluation and is explicitly excluded from independent features.
 */
export function nbaOpeningHomeProbabilityByGame(args: {
  rows: NbaHistoricalOpeningOdds[];
  gameStartById: ReadonlyMap<number, string>;
}): Map<number, number> {
  const candidates = new Map<number, number[]>();
  const seenBook = new Set<string>();
  for (const row of args.rows) {
    const start = args.gameStartById.get(row.gameId);
    if (!start) continue;
    if (Date.parse(row.openedAt) >= Date.parse(start)) continue;
    if (row.moneylineHomeOdds === null || row.moneylineAwayOdds === null) continue;
    const bookKey = `${row.gameId}::${row.vendor}`;
    if (seenBook.has(bookKey)) {
      throw new Error(`NBA opening market contains duplicate ${bookKey}.`);
    }
    seenBook.add(bookKey);
    const home = implied(row.moneylineHomeOdds);
    const away = implied(row.moneylineAwayOdds);
    const total = home + away;
    if (!Number.isFinite(total) || total <= 0) continue;
    const values = candidates.get(row.gameId) ?? [];
    values.push(home / total);
    candidates.set(row.gameId, values);
  }
  return new Map(
    [...candidates].map(([gameId, values]) => [gameId, median(values)]),
  );
}

export const __NBA_HISTORICAL_OPENING_MARKET_TEST__ = { implied, median };
