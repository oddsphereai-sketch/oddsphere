export type NflPlayerPropsCanonicalLineRow = {
  gameId: string;
  playerName: string;
  team: string;
  market: string;
  line: number;
  side: "over" | "under" | "yes";
  sportsbook: string;
  americanPrice: number;
  observedAt: string;
};

type LineSummary<T> = {
  line: number;
  rows: T[];
  books: number;
  complete: boolean;
  balance: number;
  latestObservedAt: number;
  votes: number;
};

/**
 * Returns one consensus main line for every game/player/category while
 * preserving every exact-price row at that selected line.
 */
export function selectNflPlayerPropsCanonicalLines<T extends NflPlayerPropsCanonicalLineRow>(
  rows: readonly T[],
): T[] {
  const scopes = new Map<string, T[]>();
  for (const row of rows) {
    const scope = nflPlayerPropsCanonicalMarketScopeKey(row);
    scopes.set(scope, [...(scopes.get(scope) ?? []), row]);
  }

  const selected = new Set<T>();
  for (const scopeRows of scopes.values()) {
    const line = selectCanonicalLine(scopeRows);
    for (const row of scopeRows) {
      if (row.line === line) selected.add(row);
    }
  }
  return rows.filter((row) => selected.has(row));
}

export function nflPlayerPropsCanonicalMarketScopeKey(
  row: Pick<NflPlayerPropsCanonicalLineRow, "gameId" | "playerName" | "team" | "market">,
): string {
  return [row.gameId, normalize(row.team), normalizePlayerIdentity(row.playerName), row.market].join("|");
}

export function normalizeNflPlayerPropsPlayerIdentity(playerName: string): string {
  return normalizePlayerIdentity(playerName);
}

function selectCanonicalLine<T extends NflPlayerPropsCanonicalLineRow>(rows: readonly T[]): number {
  const summaries = summarizeLines(rows);
  if (summaries.length === 1) return summaries[0]!.line;

  if (rows[0]?.market === "anytime_td") {
    return [...summaries].sort((a, b) => Math.abs(a.line - 0.5) - Math.abs(b.line - 0.5)
      || b.books - a.books
      || b.latestObservedAt - a.latestObservedAt
      || a.line - b.line)[0]!.line;
  }

  const votes = sportsbookMainLineVotes(rows);
  for (const vote of votes) {
    const summary = summaries.find((candidate) => candidate.line === vote);
    if (summary) summary.votes += 1;
  }
  const anchor = votes.length > 0 ? median(votes) : fallbackAnchor(summaries);
  const complete = summaries.filter((summary) => summary.complete);
  const candidates = complete.length > 0 ? complete : summaries;
  return [...candidates].sort((a, b) => Math.abs(a.line - anchor) - Math.abs(b.line - anchor)
    || b.votes - a.votes
    || b.books - a.books
    || a.balance - b.balance
    || b.latestObservedAt - a.latestObservedAt
    || a.line - b.line)[0]!.line;
}

function sportsbookMainLineVotes<T extends NflPlayerPropsCanonicalLineRow>(rows: readonly T[]): number[] {
  const books = new Map<string, T[]>();
  for (const row of rows) {
    const key = normalize(row.sportsbook);
    books.set(key, [...(books.get(key) ?? []), row]);
  }
  const votes: number[] = [];
  for (const bookRows of books.values()) {
    const complete = summarizeLines(bookRows).filter((summary) => summary.complete);
    if (complete.length === 0) continue;
    votes.push([...complete].sort((a, b) => a.balance - b.balance
      || b.latestObservedAt - a.latestObservedAt
      || a.line - b.line)[0]!.line);
  }
  return votes;
}

function summarizeLines<T extends NflPlayerPropsCanonicalLineRow>(rows: readonly T[]): LineSummary<T>[] {
  const lines = new Map<number, T[]>();
  for (const row of rows) lines.set(row.line, [...(lines.get(row.line) ?? []), row]);
  return [...lines.entries()].map(([line, lineRows]) => {
    const over = lineRows.filter((row) => row.side === "over");
    const under = lineRows.filter((row) => row.side === "under");
    const balances = over.flatMap((overRow) => under.map((underRow) => (
      Math.abs(implied(overRow.americanPrice) - implied(underRow.americanPrice))
    )));
    return {
      line,
      rows: lineRows,
      books: new Set(lineRows.map((row) => normalize(row.sportsbook))).size,
      complete: over.length > 0 && under.length > 0,
      balance: balances.length > 0 ? Math.min(...balances) : Number.POSITIVE_INFINITY,
      latestObservedAt: Math.max(...lineRows.map((row) => Date.parse(row.observedAt)).filter(Number.isFinite), 0),
      votes: 0,
    };
  });
}

function fallbackAnchor<T>(summaries: readonly LineSummary<T>[]): number {
  const broadest = Math.max(...summaries.map((summary) => summary.books));
  return median(summaries.filter((summary) => summary.books === broadest).map((summary) => summary.line));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function normalizePlayerIdentity(value: string): string {
  const tokens = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && ["jr", "sr", "ii", "iii", "iv"].includes(tokens.at(-1)!)) tokens.pop();
  return tokens.join("");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
