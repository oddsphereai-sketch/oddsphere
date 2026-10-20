import type { NbaPlayerPropPriceObservation, NbaPlayerPropSide } from "./nbaPlayerPropsContract";

export const NBA_PLAYER_PROPS_MARKET_EVIDENCE_RELEASE =
  "nba_player_props_market_evidence_research_2026_10_20_r1" as const;

export type NbaPlayerPropsCanonicalOfferSet = {
  scopeKey: string;
  canonicalLine: number;
  observations: NbaPlayerPropPriceObservation[];
  completeBooks: number;
  allObservedLines: number[];
};

export type NbaPlayerPropsMarketEvidence = {
  release: typeof NBA_PLAYER_PROPS_MARKET_EVIDENCE_RELEASE;
  mode: "offline_research_only";
  actionable: false;
  scopeKey: string;
  targetSportsbook: string;
  targetLine: number;
  targetSide: NbaPlayerPropSide;
  targetAmericanPrice: number;
  targetExcludedOverProbability: number | null;
  targetExcludedBooks: number;
  targetExcludedReferenceBooks: number;
  openingLine: number | null;
  priorLine: number | null;
  currentLine: number;
  openingOverProbability: number | null;
  currentOverProbability: number | null;
  lineMovement: "toward_over" | "toward_under" | "flat" | "unverified";
  priceMovement: "toward_over" | "toward_under" | "flat" | "unverified";
  evidenceObservedAt: string;
  qualifiedForDecisionReplay: boolean;
  health: string[];
};

const REFERENCE_BOOKS = new Set(["pinnacle", "fanduel", "bet365", "novig", "profitx", "polymarket"]);

/** One listed main line per resolved game/player/market. Alternate ladders remain internal evidence. */
export function selectNbaPlayerPropsCanonicalOfferSets(
  rows: readonly NbaPlayerPropPriceObservation[],
): NbaPlayerPropsCanonicalOfferSet[] {
  const scopes = groupBy(rows.filter(resolvedObservation), marketScopeKey);
  return [...scopes.entries()].map(([scopeKey, scopeRows]) => {
    const summaries = summarizeLines(scopeRows);
    const complete = summaries.filter((summary) => summary.completeBooks > 0);
    const candidates = complete.length > 0 ? complete : summaries;
    const bookVotes = sportsbookLineVotes(scopeRows);
    for (const vote of bookVotes) {
      const summary = summaries.find((row) => row.line === vote);
      if (summary) summary.votes += 1;
    }
    const anchor = bookVotes.length > 0 ? median(bookVotes)! : median(candidates.map((row) => row.line))!;
    const selected = [...candidates].sort((left, right) =>
      Math.abs(left.line - anchor) - Math.abs(right.line - anchor)
      || right.votes - left.votes
      || right.completeBooks - left.completeBooks
      || right.books - left.books
      || right.latest - left.latest
      || left.line - right.line)[0]!;
    const freshest = freshestByBookSide(scopeRows.filter((row) => row.line === selected.line));
    return {
      scopeKey,
      canonicalLine: selected.line,
      observations: freshest,
      completeBooks: selected.completeBooks,
      allObservedLines: summaries.map((row) => row.line).sort((a, b) => a - b),
    };
  }).sort((a, b) => a.scopeKey.localeCompare(b.scopeKey));
}

/**
 * Builds evidence only. It intentionally contains no coefficient, flip,
 * projection mutation, grade, or stake. Those require release-pure replay.
 */
export function buildNbaPlayerPropsMarketEvidence(args: {
  target: NbaPlayerPropPriceObservation;
  observations: readonly NbaPlayerPropPriceObservation[];
  evaluatedAt: string;
}): NbaPlayerPropsMarketEvidence {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NBA props market evidence evaluatedAt is invalid.");
  if (!resolvedObservation(args.target)) throw new Error("NBA props market evidence requires resolved game and player identity.");
  const scopeKey = marketScopeKey(args.target);
  const targetBook = normalizeBook(args.target.sportsbook);
  const inScope = args.observations
    .filter(resolvedObservation)
    .filter((row) => marketScopeKey(row) === scopeKey && Date.parse(row.observedAt) <= evaluatedAt)
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const atLine = inScope.filter((row) => row.line === args.target.line);
  const pairProbabilities = completePairs(atLine)
    .filter((pair) => pair.book !== targetBook)
    .flatMap((pair) => {
      const probability = noVigOver(pair.over.americanPrice, pair.under.americanPrice);
      return probability === null ? [] : [{ book: pair.book, probability }];
    });
  const targetTrail = inScope.filter((row) => normalizeBook(row.sportsbook) === targetBook);
  const opening = earliestPairState(targetTrail);
  const current = latestPairState(targetTrail);
  const prior = priorPairState(targetTrail, current?.observedAt ?? null);
  const openingOverProbability = opening ? noVigOver(opening.over.americanPrice, opening.under.americanPrice) : null;
  const currentOverProbability = current ? noVigOver(current.over.americanPrice, current.under.americanPrice) : null;
  const health: string[] = [];
  if (pairProbabilities.length === 0) health.push("no_target_excluded_complete_pair");
  if (!opening) health.push("no_same_book_opening_pair");
  if (!current) health.push("no_same_book_current_pair");
  if (new Set(atLine.map((row) => normalizeBook(row.sportsbook))).size < 2) health.push("single_book_line");
  const evidenceObservedAt = inScope.reduce((latest, row) => Date.parse(row.observedAt) > Date.parse(latest) ? row.observedAt : latest, args.target.observedAt);
  return {
    release: NBA_PLAYER_PROPS_MARKET_EVIDENCE_RELEASE,
    mode: "offline_research_only",
    actionable: false,
    scopeKey,
    targetSportsbook: args.target.sportsbook,
    targetLine: args.target.line,
    targetSide: args.target.side,
    targetAmericanPrice: args.target.americanPrice,
    targetExcludedOverProbability: median(pairProbabilities.map((row) => row.probability)),
    targetExcludedBooks: pairProbabilities.length,
    targetExcludedReferenceBooks: pairProbabilities.filter((row) => REFERENCE_BOOKS.has(row.book)).length,
    openingLine: opening?.line ?? null,
    priorLine: prior?.line ?? null,
    currentLine: current?.line ?? args.target.line,
    openingOverProbability,
    currentOverProbability,
    lineMovement: opening && current ? direction(current.line - opening.line) : "unverified",
    priceMovement: openingOverProbability !== null && currentOverProbability !== null
      ? direction(currentOverProbability - openingOverProbability, 0.001)
      : "unverified",
    evidenceObservedAt,
    qualifiedForDecisionReplay: pairProbabilities.length >= 1 && current !== null,
    health,
  };
}

function resolvedObservation(row: NbaPlayerPropPriceObservation): boolean {
  return row.canonicalGameId !== null && (row.canonicalPlayerId !== null || row.providerPlayerId !== null || row.playerName !== null)
    && (row.side === "over" || row.side === "under") && row.offerType === "over_under";
}

function marketScopeKey(row: NbaPlayerPropPriceObservation): string {
  const player = row.canonicalPlayerId
    ?? (row.providerPlayerId ? `${row.provider}:${row.providerPlayerId}` : normalizeIdentity(row.playerName ?? ""));
  return [row.canonicalGameId, player, row.market].join("|");
}

type Pair = { book: string; line: number; observedAt: string; over: NbaPlayerPropPriceObservation; under: NbaPlayerPropPriceObservation };

function completePairs(rows: readonly NbaPlayerPropPriceObservation[]): Pair[] {
  const groups = groupBy(rows, (row) => `${normalizeBook(row.sportsbook)}|${row.line}|${row.observedAt}`);
  return [...groups.values()].flatMap((values) => {
    const over = values.find((row) => row.side === "over");
    const under = values.find((row) => row.side === "under");
    return over && under ? [{ book: normalizeBook(over.sportsbook), line: over.line, observedAt: over.observedAt, over, under }] : [];
  });
}

function earliestPairState(rows: readonly NbaPlayerPropPriceObservation[]): Pair | null {
  return completePairs(rows).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))[0] ?? null;
}

function latestPairState(rows: readonly NbaPlayerPropPriceObservation[]): Pair | null {
  return completePairs(rows).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0] ?? null;
}

function priorPairState(rows: readonly NbaPlayerPropPriceObservation[], currentObservedAt: string | null): Pair | null {
  if (!currentObservedAt) return null;
  return completePairs(rows)
    .filter((pair) => Date.parse(pair.observedAt) < Date.parse(currentObservedAt))
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0] ?? null;
}

function summarizeLines(rows: readonly NbaPlayerPropPriceObservation[]) {
  return [...groupBy(rows, (row) => String(row.line)).entries()].map(([lineText, values]) => {
    const pairs = completePairs(values);
    return {
      line: Number(lineText),
      books: new Set(values.map((row) => normalizeBook(row.sportsbook))).size,
      completeBooks: new Set(pairs.map((row) => row.book)).size,
      latest: Math.max(...values.map((row) => Date.parse(row.observedAt))),
      votes: 0,
    };
  });
}

function sportsbookLineVotes(rows: readonly NbaPlayerPropPriceObservation[]): number[] {
  const votes: number[] = [];
  for (const values of groupBy(rows, (row) => normalizeBook(row.sportsbook)).values()) {
    const pairs = completePairs(values);
    if (pairs.length === 0) continue;
    const closest = [...pairs].sort((a, b) => {
      const aBalance = Math.abs(implied(a.over.americanPrice) - implied(a.under.americanPrice));
      const bBalance = Math.abs(implied(b.over.americanPrice) - implied(b.under.americanPrice));
      return aBalance - bBalance || Date.parse(b.observedAt) - Date.parse(a.observedAt);
    })[0]!;
    votes.push(closest.line);
  }
  return votes;
}

function freshestByBookSide(rows: readonly NbaPlayerPropPriceObservation[]): NbaPlayerPropPriceObservation[] {
  const selected = new Map<string, NbaPlayerPropPriceObservation>();
  for (const row of rows) {
    const key = `${normalizeBook(row.sportsbook)}|${row.side}`;
    const previous = selected.get(key);
    if (!previous || Date.parse(row.observedAt) > Date.parse(previous.observedAt)) selected.set(key, row);
  }
  return [...selected.values()].sort((a, b) => normalizeBook(a.sportsbook).localeCompare(normalizeBook(b.sportsbook)) || a.side.localeCompare(b.side));
}

function noVigOver(overPrice: number, underPrice: number): number | null {
  const over = implied(overPrice);
  const under = implied(underPrice);
  const total = over + under;
  return total > 0 && Number.isFinite(total) ? over / total : null;
}

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function direction(value: number, epsilon = 0.000_001): "toward_over" | "toward_under" | "flat" {
  return value > epsilon ? "toward_over" : value < -epsilon ? "toward_under" : "flat";
}

function normalizeBook(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function normalizeIdentity(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) groups.set(key(value), [...(groups.get(key(value)) ?? []), value]);
  return groups;
}
