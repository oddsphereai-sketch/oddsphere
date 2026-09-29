import type { OddsTrailStopDto } from "../../../app/lab/lib/labTypes";
import { canonicalizeNhlLineRows } from "./nhlLineBoard";

export type NhlPriceTrailRow = {
  market_type: string;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  observed_at: string | null;
};

export type NhlTwoSidedPriceTrail = {
  sportsbook: string | null;
  selected: OddsTrailStopDto[];
  opposing: OddsTrailStopDto[];
  line: OddsTrailStopDto[];
};

const BOOK_PRIORITY = [
  "circa", "pinnacle", "bookmaker", "fanduel", "draftkings", "betmgm",
  "caesars", "betrivers", "betparx", "betway", "ballybet", "saba",
] as const;

function closeLine(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 0.01;
}

function rowMatches(
  row: NhlPriceTrailRow,
  market: string,
  side: string,
  line: number | null,
  exactLine: boolean,
): boolean {
  if (row.market_type !== market || row.side !== side || row.odds_american === null) return false;
  if (market === "moneyline" || !exactLine) return true;
  return closeLine(row.line_value, line);
}

function latest(rows: NhlPriceTrailRow[]): NhlPriceTrailRow | null {
  return [...rows].sort((left, right) => (
    Date.parse(right.observed_at ?? "") - Date.parse(left.observed_at ?? "")
  ))[0] ?? null;
}

function bookRank(book: string): number {
  const normalized = book.toLowerCase().replace(/[^a-z0-9]/g, "");
  const index = BOOK_PRIORITY.findIndex((candidate) => normalized.includes(candidate));
  return index === -1 ? BOOK_PRIORITY.length : index;
}

function selectBook(args: {
  live: NhlPriceTrailRow[];
  history: NhlPriceTrailRow[];
  market: string;
  selectedSide: string;
  opposingSide: string;
  selectedLine: number | null;
  opposingLine: number | null;
  preferredBook: string | null;
}): string | null {
  const selectedBooks = new Set(args.live
    .filter((row) => rowMatches(row, args.market, args.selectedSide, args.selectedLine, true))
    .map((row) => row.sportsbook));
  const opposingBooks = new Set(args.live
    .filter((row) => rowMatches(row, args.market, args.opposingSide, args.opposingLine, true))
    .map((row) => row.sportsbook));
  const candidates = [...selectedBooks].filter((book) => opposingBooks.has(book));
  if (args.preferredBook && candidates.includes(args.preferredBook)) return args.preferredBook;
  return candidates.sort((left, right) => {
    const historyDepth = (book: string) => args.history.filter((row) => (
      row.sportsbook === book
      && row.market_type === args.market
      && (row.side === args.selectedSide || row.side === args.opposingSide)
      && row.odds_american !== null
    )).length;
    return historyDepth(right) - historyDepth(left) || bookRank(left) - bookRank(right) || left.localeCompare(right);
  })[0] ?? null;
}

function trailFor(args: {
  live: NhlPriceTrailRow[];
  history: NhlPriceTrailRow[];
  market: string;
  side: string;
  line: number | null;
  sportsbook: string;
  exactLine: boolean;
}): OddsTrailStopDto[] {
  const matches = (row: NhlPriceTrailRow) => (
    row.sportsbook === args.sportsbook
    && rowMatches(row, args.market, args.side, args.line, args.exactLine)
  );
  const historical = args.history.filter(matches).sort((left, right) => (
    Date.parse(left.observed_at ?? "") - Date.parse(right.observed_at ?? "")
  ));
  const current = latest(args.live.filter(matches));
  const rows: Array<NhlPriceTrailRow & { source: "line_history" | "current_line" }> = historical.map((row) => ({
    ...row,
    source: "line_history" as const,
  }));
  if (current) rows.push({ ...current, source: "current_line" });
  if (rows.length === 0) return [];

  const economic: typeof rows = [];
  for (const row of rows) {
    const prior = economic[economic.length - 1];
    if (prior && prior.odds_american === row.odds_american && closeLine(prior.line_value, row.line_value)) {
      // Keep the first observation as the opener and preserve the current
      // endpoint even when the quote has not moved.
      if (row.source === "current_line") economic.push(row);
      continue;
    }
    economic.push(row);
  }
  return economic.map((row, index) => ({
    american: row.odds_american!,
    line: row.line_value,
    observedAt: row.observed_at,
    sportsbook: row.sportsbook,
    source: row.source,
    label: row.source === "current_line"
      ? "current"
      : index === 0
        ? "first"
        : "move",
  }));
}

/**
 * Build the member-visible two-sided board and the same-book point-line trail
 * from the exact same append-only rows consumed by NHL market movement.
 */
export function buildNhlTwoSidedPriceTrail(args: {
  live: NhlPriceTrailRow[];
  history: NhlPriceTrailRow[];
  market: "moneyline" | "total" | "spread";
  selectedSide: "home" | "away" | "over" | "under";
  opposingSide: "home" | "away" | "over" | "under";
  selectedLine: number | null;
  opposingLine: number | null;
  preferredBook: string | null;
}): NhlTwoSidedPriceTrail {
  const live = canonicalizeNhlLineRows(args.live, { scopeKey: () => "current" });
  const history = canonicalizeNhlLineRows(args.history, {
    scopeKey: (row) => row.observed_at ?? "unknown",
  });
  const canonicalArgs = { ...args, live, history };
  const sportsbook = selectBook(canonicalArgs);
  if (!sportsbook) return { sportsbook: null, selected: [], opposing: [], line: [] };
  return {
    sportsbook,
    selected: trailFor({ ...canonicalArgs, side: args.selectedSide, line: args.selectedLine, sportsbook, exactLine: true }),
    opposing: trailFor({ ...canonicalArgs, side: args.opposingSide, line: args.opposingLine, sportsbook, exactLine: true }),
    line: args.market === "moneyline"
      ? []
      : trailFor({ ...canonicalArgs, side: args.selectedSide, line: args.selectedLine, sportsbook, exactLine: false }),
  };
}
