export type NhlCanonicalLineRow = {
  game_id?: number | string | null;
  market_type: string;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  observed_at?: string | null;
  source_timestamp?: string | null;
};

function normalizedBook(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function lineKey(value: number | null): string {
  return value === null ? "null" : value.toFixed(3);
}

function observationTime(row: NhlCanonicalLineRow): number {
  const parsed = Date.parse(row.source_timestamp ?? row.observed_at ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function chooseCurrent<T extends NhlCanonicalLineRow>(rows: readonly T[]): T {
  const newest = Math.max(...rows.map(observationTime));
  const current = rows.filter((row) => observationTime(row) === newest);
  if (current.length === 1) return current[0]!;
  const priced = current.filter((row) => row.odds_american !== null);
  if (priced.length === 0) return current[0]!;
  const center = median(priced.map((row) => row.odds_american!));
  return [...priced].sort((left, right) => (
    Math.abs(left.odds_american! - center) - Math.abs(right.odds_american! - center)
    || left.odds_american! - right.odds_american!
  ))[0]!;
}

function hasComplement<T extends NhlCanonicalLineRow>(row: T, rows: readonly T[]): boolean {
  if (row.market_type === "moneyline") {
    const other = row.side === "home" ? "away" : row.side === "away" ? "home" : null;
    return other !== null && rows.some((candidate) => candidate.side === other);
  }
  if (row.market_type === "total") {
    const other = row.side === "over" ? "under" : row.side === "under" ? "over" : null;
    return other !== null && rows.some((candidate) => (
      candidate.side === other
      && candidate.line_value !== null
      && row.line_value !== null
      && Math.abs(candidate.line_value - row.line_value) < 0.01
    ));
  }
  if (row.market_type === "spread") {
    const other = row.side === "home" ? "away" : row.side === "away" ? "home" : null;
    return other !== null && rows.some((candidate) => (
      candidate.side === other
      && candidate.line_value !== null
      && row.line_value !== null
      && Math.abs(candidate.line_value + row.line_value) < 0.01
    ));
  }
  return false;
}

function impliedProbability(american: number): number {
  return american > 0
    ? 100 / (american + 100)
    : -american / (-american + 100);
}

/** NHL's full-game Moneyline, Total, and puck line are two-way markets. A
 * provider occasionally labels a regulation/three-way quote as `moneyline`
 * while omitting the draw (for example both teams at plus money). Such a pair
 * is complete by side name but is not a coherent two-way price and must not
 * drive consensus, best-price grading, or movement. The same bounded hold
 * check also rejects malformed promotional pairs without excluding normal
 * sharp, retail, exchange, or heavily favored two-way markets. */
function hasCoherentComplement<T extends NhlCanonicalLineRow>(row: T, rows: readonly T[]): boolean {
  const candidates = rows.filter((candidate) => {
    if (candidate.odds_american === null) return false;
    if (row.market_type === "moneyline") {
      return (row.side === "home" && candidate.side === "away")
        || (row.side === "away" && candidate.side === "home");
    }
    if (row.market_type === "total") {
      return ((row.side === "over" && candidate.side === "under")
        || (row.side === "under" && candidate.side === "over"))
        && row.line_value !== null
        && candidate.line_value !== null
        && Math.abs(row.line_value - candidate.line_value) < 0.01;
    }
    if (row.market_type === "spread") {
      return ((row.side === "home" && candidate.side === "away")
        || (row.side === "away" && candidate.side === "home"))
        && row.line_value !== null
        && candidate.line_value !== null
        && Math.abs(row.line_value + candidate.line_value) < 0.01;
    }
    return false;
  });
  return candidates.some((candidate) => {
    const twoWayHold = impliedProbability(row.odds_american!) + impliedProbability(candidate.odds_american!);
    return twoWayHold >= 0.94 && twoWayHold <= 1.20;
  });
}

/**
 * Collapse a provider snapshot to one deterministic quote per
 * book/market/side/line and retain only complete two-sided pairs. A partial
 * provider response therefore cannot replace the last complete database
 * group or become an internal market-reading input.
 */
export function canonicalizeNhlLineRows<T extends NhlCanonicalLineRow>(
  rows: readonly T[],
  options?: { scopeKey?: (row: T) => string },
): T[] {
  const valid = rows.filter((row) => (
    row.odds_american !== null
    && Number.isFinite(row.odds_american)
    && (row.market_type === "moneyline" || row.market_type === "total" || row.market_type === "spread")
  ));
  const perQuote = new Map<string, T[]>();
  for (const row of valid) {
    const scope = options?.scopeKey?.(row) ?? String(row.game_id ?? "slate");
    const key = [
      scope,
      normalizedBook(row.sportsbook),
      row.market_type,
      row.side,
      lineKey(row.line_value),
    ].join("|");
    const group = perQuote.get(key) ?? [];
    group.push(row);
    perQuote.set(key, group);
  }
  const current = [...perQuote.values()].map(chooseCurrent);
  const byBookMarket = new Map<string, T[]>();
  for (const row of current) {
    const scope = options?.scopeKey?.(row) ?? String(row.game_id ?? "slate");
    const key = `${scope}|${normalizedBook(row.sportsbook)}|${row.market_type}`;
    const group = byBookMarket.get(key) ?? [];
    group.push(row);
    byBookMarket.set(key, group);
  }
  return [...byBookMarket.values()].flatMap((group) => group.filter((row) => (
    hasComplement(row, group) && hasCoherentComplement(row, group)
  )));
}
