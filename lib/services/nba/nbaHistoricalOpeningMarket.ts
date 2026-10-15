/** Evaluation-only NBA opening-market helpers for chronological research. */

export type NbaHistoricalOpeningOdds = {
  rowId: number;
  gameId: number;
  vendor: string;
  openedAt: string;
  moneylineHomeOdds: number | null;
  moneylineAwayOdds: number | null;
  spreadHomeValue: number | null;
  spreadHomeOdds: number | null;
  spreadAwayValue: number | null;
  spreadAwayOdds: number | null;
  totalValue: number | null;
  totalOverOdds: number | null;
  totalUnderOdds: number | null;
};

export type NbaHistoricalOpeningMarket = {
  homeWinProbability: number | null;
  homeMoneylinePrice: number | null;
  homeMoneylineSportsbook: string | null;
  awayMoneylinePrice: number | null;
  awayMoneylineSportsbook: string | null;
  homeSpread: number | null;
  homeCoverProbability: number | null;
  homeSpreadPrice: number | null;
  homeSpreadSportsbook: string | null;
  awaySpreadPrice: number | null;
  awaySpreadSportsbook: string | null;
  total: number | null;
  overProbability: number | null;
  overPrice: number | null;
  overSportsbook: string | null;
  underPrice: number | null;
  underSportsbook: string | null;
};

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function american(value: unknown): number | null {
  const number = finite(value);
  return number === 0 ? null : number;
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
    moneylineHomeOdds: american(row.moneyline_home_odds),
    moneylineAwayOdds: american(row.moneyline_away_odds),
    spreadHomeValue: finite(row.spread_home_value),
    spreadHomeOdds: american(row.spread_home_odds),
    spreadAwayValue: finite(row.spread_away_value),
    spreadAwayOdds: american(row.spread_away_odds),
    totalValue: finite(row.total_value),
    totalOverOdds: american(row.total_over_odds),
    totalUnderOdds: american(row.total_under_odds),
  };
}

type ExactLineCandidate = {
  vendor: string;
  line: number;
  probability: number;
  firstPrice: number;
  secondPrice: number;
};

function exactLineConsensus(candidates: ExactLineCandidate[]): {
  line: number;
  probability: number;
  firstPrice: number;
  firstSportsbook: string;
  secondPrice: number;
  secondSportsbook: string;
} | null {
  if (candidates.length === 0) return null;
  const lineMedian = median(candidates.map((item) => item.line));
  const byLine = new Map<string, ExactLineCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.line.toFixed(3);
    const values = byLine.get(key) ?? [];
    values.push(candidate);
    byLine.set(key, values);
  }
  const selected = [...byLine.values()].sort((left, right) =>
    right.length - left.length ||
    Math.abs(left[0]!.line - lineMedian) - Math.abs(right[0]!.line - lineMedian) ||
    left[0]!.line - right[0]!.line)[0]!;
  const bestFirst = [...selected].sort((left, right) =>
    right.firstPrice - left.firstPrice || left.vendor.localeCompare(right.vendor))[0]!;
  const bestSecond = [...selected].sort((left, right) =>
    right.secondPrice - left.secondPrice || left.vendor.localeCompare(right.vendor))[0]!;
  return {
    line: selected[0]!.line,
    probability: median(selected.map((item) => item.probability)),
    firstPrice: bestFirst.firstPrice,
    firstSportsbook: bestFirst.vendor,
    secondPrice: bestSecond.secondPrice,
    secondSportsbook: bestSecond.vendor,
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
  return new Map(
    [...nbaOpeningMarketByGame(args)].flatMap(([gameId, market]) =>
      market.homeWinProbability === null ? [] : [[gameId, market.homeWinProbability] as const]),
  );
}

export function nbaOpeningMarketByGame(args: {
  rows: NbaHistoricalOpeningOdds[];
  gameStartById: ReadonlyMap<number, string>;
}): Map<number, NbaHistoricalOpeningMarket> {
  const moneylines = new Map<number, Array<{
    vendor: string;
    probability: number;
    homePrice: number;
    awayPrice: number;
  }>>();
  const spreads = new Map<number, ExactLineCandidate[]>();
  const totals = new Map<number, ExactLineCandidate[]>();
  const seenBook = new Set<string>();
  for (const row of args.rows) {
    const start = args.gameStartById.get(row.gameId);
    if (!start) continue;
    if (Date.parse(row.openedAt) >= Date.parse(start)) continue;
    const bookKey = `${row.gameId}::${row.vendor}`;
    if (seenBook.has(bookKey)) {
      throw new Error(`NBA opening market contains duplicate ${bookKey}.`);
    }
    seenBook.add(bookKey);
    if (row.moneylineHomeOdds !== null && row.moneylineAwayOdds !== null) {
      const home = implied(row.moneylineHomeOdds);
      const away = implied(row.moneylineAwayOdds);
      const total = home + away;
      if (Number.isFinite(total) && total > 0) {
        const values = moneylines.get(row.gameId) ?? [];
        values.push({
          vendor: row.vendor,
          probability: home / total,
          homePrice: row.moneylineHomeOdds,
          awayPrice: row.moneylineAwayOdds,
        });
        moneylines.set(row.gameId, values);
      }
    }
    if (
      row.spreadHomeValue !== null && row.spreadAwayValue !== null &&
      Math.abs(row.spreadHomeValue + row.spreadAwayValue) < 1e-9 &&
      row.spreadHomeOdds !== null && row.spreadAwayOdds !== null
    ) {
      const home = implied(row.spreadHomeOdds);
      const away = implied(row.spreadAwayOdds);
      const total = home + away;
      if (Number.isFinite(total) && total > 0) {
        const values = spreads.get(row.gameId) ?? [];
        values.push({
          vendor: row.vendor,
          line: row.spreadHomeValue,
          probability: home / total,
          firstPrice: row.spreadHomeOdds,
          secondPrice: row.spreadAwayOdds,
        });
        spreads.set(row.gameId, values);
      }
    }
    if (row.totalValue !== null && row.totalOverOdds !== null && row.totalUnderOdds !== null) {
      const over = implied(row.totalOverOdds);
      const under = implied(row.totalUnderOdds);
      const total = over + under;
      if (Number.isFinite(total) && total > 0) {
        const values = totals.get(row.gameId) ?? [];
        values.push({
          vendor: row.vendor,
          line: row.totalValue,
          probability: over / total,
          firstPrice: row.totalOverOdds,
          secondPrice: row.totalUnderOdds,
        });
        totals.set(row.gameId, values);
      }
    }
  }
  const gameIds = new Set([...moneylines.keys(), ...spreads.keys(), ...totals.keys()]);
  return new Map([...gameIds].map((gameId) => {
    const spread = exactLineConsensus(spreads.get(gameId) ?? []);
    const total = exactLineConsensus(totals.get(gameId) ?? []);
    const moneyline = moneylines.get(gameId) ?? [];
    const bestHomeMoneyline = [...moneyline].sort((left, right) =>
      right.homePrice - left.homePrice || left.vendor.localeCompare(right.vendor))[0] ?? null;
    const bestAwayMoneyline = [...moneyline].sort((left, right) =>
      right.awayPrice - left.awayPrice || left.vendor.localeCompare(right.vendor))[0] ?? null;
    return [gameId, {
      homeWinProbability: moneyline.length > 0
        ? median(moneyline.map((item) => item.probability))
        : null,
      homeMoneylinePrice: bestHomeMoneyline?.homePrice ?? null,
      homeMoneylineSportsbook: bestHomeMoneyline?.vendor ?? null,
      awayMoneylinePrice: bestAwayMoneyline?.awayPrice ?? null,
      awayMoneylineSportsbook: bestAwayMoneyline?.vendor ?? null,
      homeSpread: spread?.line ?? null,
      homeCoverProbability: spread?.probability ?? null,
      homeSpreadPrice: spread?.firstPrice ?? null,
      homeSpreadSportsbook: spread?.firstSportsbook ?? null,
      awaySpreadPrice: spread?.secondPrice ?? null,
      awaySpreadSportsbook: spread?.secondSportsbook ?? null,
      total: total?.line ?? null,
      overProbability: total?.probability ?? null,
      overPrice: total?.firstPrice ?? null,
      overSportsbook: total?.firstSportsbook ?? null,
      underPrice: total?.secondPrice ?? null,
      underSportsbook: total?.secondSportsbook ?? null,
    }];
  }));
}

export const __NBA_HISTORICAL_OPENING_MARKET_TEST__ = { exactLineConsensus, implied, median };
