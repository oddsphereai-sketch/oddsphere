export type WnbaPriceTrailRow = {
  market_type: string;
  side: string;
  sportsbook?: string | null;
  line_value: number | null;
  odds_american: number | null;
  recorded_at?: string | null;
};

export type WnbaSameBookTrailSelection = {
  sportsbook: string;
  rows: WnbaPriceTrailRow[];
  terminalSource: "current_line" | "line_history";
};

const WNBA_MOVEMENT_BOOK_PRIORITY = [
  "fanduel",
  "betmgm",
  "hardrock",
  "pinnacle",
  "caesars",
  "betonline",
  "thescorebet",
];

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
 * Select a chronological, same-book trail for one WNBA market side.
 *
 * The current `lines` table is normally the terminal observation. During a
 * provider rollover it can be temporarily empty even though append-only
 * `line_history` has many recent observations for both sides. In that exact
 * condition, use the latest history row as the truthful terminal capture.
 * Never prefer a history-only book while any current row exists for the side.
 */
export function selectWnbaSameBookTrail(
  liveRows: WnbaPriceTrailRow[],
  historyRows: WnbaPriceTrailRow[],
  market: string,
  side: string | null,
  currentLine: number | null,
  allowLineChanges = false,
): WnbaSameBookTrailSelection | null {
  if (side === null) return null;
  const sideIsInScope = (row: WnbaPriceTrailRow) =>
    row.market_type === market &&
    row.side === side &&
    typeof row.odds_american === "number";
  const hasAnyLiveForSide = liveRows.some(sideIsInScope);
  const books = new Set(
    [...historyRows, ...liveRows]
      .filter((row) => sideIsInScope(row) && row.sportsbook)
      .map((row) => row.sportsbook as string),
  );
  const rankedBooks = [...books].sort((a, b) => {
    const aRank = WNBA_MOVEMENT_BOOK_PRIORITY.indexOf(a);
    const bRank = WNBA_MOVEMENT_BOOK_PRIORITY.indexOf(b);
    return (aRank < 0 ? 999 : aRank) - (bRank < 0 ? 999 : bRank) || a.localeCompare(b);
  });
  let currentOnlyFallback: WnbaSameBookTrailSelection | null = null;

  for (const sportsbook of rankedBooks) {
    const history = historyRows
      .filter((row) => sideIsInScope(row) && row.sportsbook === sportsbook)
      .sort((a, b) => new Date(a.recorded_at ?? 0).getTime() - new Date(b.recorded_at ?? 0).getTime());
    const trackedHistory = allowLineChanges || currentLine === null
      ? history
      : history.filter((row) => closeLine(row.line_value, currentLine));
    const liveCandidates = liveRows.filter((row) =>
      sideIsInScope(row) &&
      row.sportsbook === sportsbook &&
      (currentLine === null || closeLine(row.line_value, currentLine))
    );
    const liveTerminal = liveCandidates[liveCandidates.length - 1] ?? null;
    const historyTerminal = !hasAnyLiveForSide
      ? trackedHistory[trackedHistory.length - 1] ?? null
      : null;
    const terminal = liveTerminal ?? historyTerminal;
    if (trackedHistory.length === 0 || terminal === null) continue;

    const rows: WnbaPriceTrailRow[] = [];
    for (const row of [...trackedHistory, terminal]) {
      const prior = rows[rows.length - 1];
      if (
        prior &&
        prior.odds_american === row.odds_american &&
        prior.line_value === row.line_value &&
        prior.recorded_at === row.recorded_at
      ) continue;
      rows.push(row);
    }
    const selection = {
      sportsbook,
      rows,
      terminalSource: liveTerminal ? "current_line" : "line_history",
    } satisfies WnbaSameBookTrailSelection;
    if (rows.length >= 2) return selection;
    currentOnlyFallback ??= selection;
  }
  return currentOnlyFallback;
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
