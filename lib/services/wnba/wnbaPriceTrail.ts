export type WnbaPriceTrailRow = {
  market_type: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  recorded_at?: string | null;
};

function closeLine(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 0.01;
}

function lineDistance(a: number | null, b: number | null): number {
  if (a === null || b === null) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b);
}

function medianNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function pickedRows(
  rows: WnbaPriceTrailRow[],
  market: string,
  side: string | null,
  line: number | null,
): WnbaPriceTrailRow[] {
  if (side === null) return [];
  const sideRows = rows.filter((row) =>
    row.market_type === market &&
    row.side === side &&
    typeof row.odds_american === "number"
  );
  if (line === null) return sideRows;
  const exactRows = sideRows.filter((row) => closeLine(row.line_value, line));
  if (exactRows.length > 0) return exactRows;
  const nearest = sideRows
    .filter((row) => row.line_value !== null)
    .sort((a, b) => lineDistance(a.line_value, line) - lineDistance(b.line_value, line))[0];
  return nearest
    ? sideRows.filter((row) => closeLine(row.line_value, nearest.line_value))
    : [];
}

/**
 * Return one consensus price per provider observation timestamp.
 *
 * `line_history` contains one row per sportsbook, so selecting the first row
 * at the opening timestamp makes the member-visible trail depend on provider
 * ordering and lets a single bad book print as the market opener. Collapse
 * every timestamp to the same median consensus used for current WNBA prices.
 */
export function wnbaObservedConsensusPrices(
  rows: WnbaPriceTrailRow[],
  market: string,
  side: string | null,
  line: number | null,
): number[] {
  const candidates = pickedRows(rows, market, side, line);
  const byTimestamp = new Map<number, number[]>();
  for (const row of candidates) {
    if (!row.recorded_at) continue;
    const timestamp = Date.parse(row.recorded_at);
    if (!Number.isFinite(timestamp)) continue;
    const prices = byTimestamp.get(timestamp) ?? [];
    prices.push(row.odds_american as number);
    byTimestamp.set(timestamp, prices);
  }
  if (byTimestamp.size === 0) {
    const fallback = medianNumber(candidates.map((row) => row.odds_american as number));
    return fallback === null ? [] : [fallback];
  }
  return [...byTimestamp.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, prices]) => medianNumber(prices))
    .filter((price): price is number => price !== null);
}
