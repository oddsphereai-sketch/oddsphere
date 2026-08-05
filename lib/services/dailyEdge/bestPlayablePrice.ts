import { BOOK_PRIORITY, bookPriorityRank } from "@/lib/config/bookPriority";
import { isBlockedSportsbook } from "@/lib/config/blockedSportsbooks";
import { isDisplayableAmericanOdds } from "@/lib/streaming/oddsSanity";

export type PlayablePriceSide = "home" | "away" | "over" | "under";

export type PlayablePriceRow = {
  sportsbook: string;
  side: string | null;
  line_value?: number | null;
  odds_american: number | null;
  fetched_at?: string | null;
  odds_american_observed_at?: string | null;
};

const SYNTHETIC_PRICE_BOOKS = new Set([
  "locked_snapshot",
  "recommendation_snapshot",
  "splits_consensus",
]);

const trustedBooks = new Set<string>(
  BOOK_PRIORITY.filter((book) => !SYNTHETIC_PRICE_BOOKS.has(book)),
);

function impliedProbability(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

function oppositeSide(side: PlayablePriceSide): PlayablePriceSide {
  if (side === "home") return "away";
  if (side === "away") return "home";
  if (side === "over") return "under";
  return "over";
}

function sameLine(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  return Math.abs(a - b) < 0.001;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function observedAt(row: PlayablePriceRow): string | null {
  return row.odds_american_observed_at ?? row.fetched_at ?? null;
}

function isFresh(row: PlayablePriceRow, nowMs: number, maxAgeMinutes: number): boolean {
  const timestamp = observedAt(row);
  if (timestamp === null) return false;
  const observedMs = Date.parse(timestamp);
  return Number.isFinite(observedMs) && nowMs - observedMs <= maxAgeMinutes * 60_000;
}

/**
 * Price-shop only across fresh, trusted, coherent two-sided markets.
 *
 * A raw maximum is unsafe because provider rows occasionally contain flipped
 * sides or malformed outliers. Eligible pairs must share a book and line,
 * carry plausible hold, and remain near the multi-book no-vig center. Requiring
 * at least two pairs means a single book can never establish its own truth.
 */
export function selectBestCoherentPlayablePrice<T extends PlayablePriceRow>(args: {
  rows: T[];
  preferredSide: PlayablePriceSide | null;
  expectedLine: number | null;
  nowMs?: number;
  maxAgeMinutes?: number;
  /** Locked recommendations are immutable snapshots and cannot expose live prices. */
  locked?: boolean;
}): T | null {
  if (args.locked === true) return null;
  if (args.preferredSide === null) return null;
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMinutes = args.maxAgeMinutes ?? 60;
  const opposingSide = oppositeSide(args.preferredSide);
  const fresh = args.rows.filter((row) =>
    row.odds_american !== null &&
    isDisplayableAmericanOdds(row.odds_american) &&
    trustedBooks.has(row.sportsbook) &&
    !isBlockedSportsbook(row.sportsbook) &&
    isFresh(row, nowMs, maxAgeMinutes) &&
    (args.expectedLine === null || sameLine(row.line_value, args.expectedLine))
  );

  type Pair = { picked: T; noVigPicked: number };
  const pairs: Pair[] = [];
  for (const book of trustedBooks) {
    const bookRows = fresh.filter((row) => row.sportsbook === book);
    const bookPairs: Pair[] = [];
    for (const picked of bookRows.filter((row) => row.side === args.preferredSide)) {
      const opposite = bookRows.find((row) =>
        row.side === opposingSide && sameLine(row.line_value, picked.line_value)
      );
      if (picked.odds_american === null || opposite?.odds_american === null || opposite?.odds_american === undefined) continue;
      const pickedImplied = impliedProbability(picked.odds_american);
      const oppositeImplied = impliedProbability(opposite.odds_american);
      const hold = pickedImplied + oppositeImplied;
      if (hold < 0.98 || hold > 1.12) continue;
      bookPairs.push({ picked, noVigPicked: pickedImplied / hold });
    }
    const latestPair = bookPairs.sort((left, right) =>
      Date.parse(observedAt(right.picked) ?? "") - Date.parse(observedAt(left.picked) ?? "")
    )[0];
    if (latestPair) pairs.push(latestPair);
  }

  if (pairs.length < 2) return null;
  const center = median(pairs.map((pair) => pair.noVigPicked));
  if (center === null) return null;
  return pairs
    .filter((pair) => Math.abs(pair.noVigPicked - center) <= 0.04)
    .sort((left, right) => {
      const priceDelta = (right.picked.odds_american ?? -Infinity) - (left.picked.odds_american ?? -Infinity);
      if (priceDelta !== 0) return priceDelta;
      return bookPriorityRank(left.picked.sportsbook) - bookPriorityRank(right.picked.sportsbook);
    })[0]?.picked ?? null;
}
