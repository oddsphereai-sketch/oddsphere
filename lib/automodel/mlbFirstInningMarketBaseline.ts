/**
 * Push 3B — FI V2 market baseline (Layer 2).
 *
 * Reads the first-inning total market (NRFI/YRFI line) and converts
 * implied prices into no-vig NRFI/YRFI probabilities. NRFI market lines
 * are not always available; when absent, the baseline returns null and
 * the caller treats the projection as independent-only (Layer 3 trust
 * = 1.0) but caps play grade to Lean.
 *
 * Today's MLB pricing convention for the FI total:
 *   • If the book lists "First 5 / First-Inning Total = 0.5" (or 0/0.5):
 *       Over 0.5 = YRFI ; Under 0.5 = NRFI
 *
 * Pure / no DB / no network. Caller passes pre-filtered FI line rows.
 */

import { noVigPair } from "./marketPrior";
import { isBlockedSportsbook } from "../config/blockedSportsbooks";
import { BOOK_PRIORITY } from "../config/bookPriority";

export type FiMarketBaseline = {
  /** Listed FI total (typically 0.5). null when no line. */
  listed_fi_total: number | null;
  /** Over (= YRFI) odds American. */
  yrfi_odds_american: number | null;
  /** Under (= NRFI) odds American. */
  nrfi_odds_american: number | null;
  /** No-vig P(YRFI). */
  yrfi_no_vig_prob: number | null;
  /** No-vig P(NRFI). */
  nrfi_no_vig_prob: number | null;
  /** Current-board consensus before the bounded movement residual. */
  current_nrfi_no_vig_prob: number | null;
  /** Comparable named-book opening consensus, when retained. */
  opening_nrfi_no_vig_prob: number | null;
  /** Current minus opening comparable-book movement, percentage points. */
  movement_nrfi_pp: number | null;
  /** Bounded movement contribution to the authoritative market probability. */
  movement_adjustment_pp: number;
  /** Same-book opening/current pairs contributing movement evidence. */
  movement_sportsbooks: string[];
  /** Number of same-book opening/current pairs contributing movement evidence. */
  movement_book_count: number;
  /** No-vig P(YRFI) at the exact same-book quote used for economics. */
  evaluation_yrfi_no_vig_prob: number | null;
  /** No-vig P(NRFI) at the exact same-book quote used for economics. */
  evaluation_nrfi_no_vig_prob: number | null;
  /** Exact named sportsbook used for price/break-even economics. */
  evaluation_sportsbook: string | null;
  /** Complete named-book pairs contributing to the projection consensus. */
  projection_sportsbooks: string[];
  /** Number of complete named-book pairs contributing to the consensus. */
  projection_book_count: number;
  /** Source quality: "ok" | "stale" | "missing". */
  data_quality: "ok" | "stale" | "missing";
  /** Most-recent line freshness, ISO timestamp or null. */
  freshness: string | null;
  /** Source / reason code. */
  reason: string;
};

export type FiLineRow = {
  market_type: string;        // "first_inning_total"
  sportsbook: string;
  side: string | null;        // "over" | "under"
  line_value: number | null;  // typically 0.5
  odds_american: number | null;
  fetched_at?: string | null;
  /** Current is the default for backward compatibility. */
  observation_type?: "current" | "opening";
};

const FI_BOOK_PRIORITY = BOOK_PRIORITY.filter(
  (book) => book !== "locked_snapshot" && book !== "recommendation_snapshot" && book !== "splits_consensus",
);
const FI_NAMED_BOOK_ALIASES: Readonly<Record<string, string>> = {
  dk: "draftkings",
  fd: "fanduel",
  "bet365us": "bet365 us",
};
const FI_SHARP_BOOKS = new Set(["pinnacle", "circa", "bookmaker"]);
const FI_RETAIL_BOOKS = new Set([
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "bet365",
  "bet365 us",
  "hardrock",
  "betrivers",
  "fanatics",
  "ballybet",
  "betparx",
  "betway",
  "rebet",
  "onexbet",
  "saba",
]);
const FI_PRICE_MAX_SOURCE_AGE_MS = 90 * 60 * 1000;
const FI_MAX_PAIR_SKEW_MS = 2 * 60 * 1000;
const FI_MOVEMENT_RESIDUAL_WEIGHT = 0.20;
const FI_MOVEMENT_MAX_ADJUSTMENT = 0.01;
const NRFI_YRFI_LINE_VALUE = 0.5;

function normalizedSportsbook(sportsbook: string): string {
  const normalized = sportsbook.trim().toLowerCase();
  return FI_NAMED_BOOK_ALIASES[normalized] ?? normalized;
}

function isSupportedNamedSportsbook(sportsbook: string): boolean {
  const normalized = normalizedSportsbook(sportsbook);
  return FI_SHARP_BOOKS.has(normalized) || FI_RETAIL_BOOKS.has(normalized);
}

function isFreshFiMarketPriceSource(observedAt: string | null | undefined, nowMs: number): boolean {
  if (observedAt === null || observedAt === undefined) return true;
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return false;
  return observedMs <= nowMs && nowMs - observedMs <= FI_PRICE_MAX_SOURCE_AGE_MS;
}

type CompleteFiPair = {
  book: string;
  over: FiLineRow;
  under: FiLineRow;
  yrfiNoVig: number;
  nrfiNoVig: number;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function completeNamedBookPairs(candidates: FiLineRow[]): CompleteFiPair[] {
  const pairs: CompleteFiPair[] = [];
  const books = Array.from(new Set(candidates.map((line) => normalizedSportsbook(line.sportsbook))));
  for (const book of books) {
    const bookRows = candidates.filter((line) => normalizedSportsbook(line.sportsbook) === book);
    const latestSide = (side: "over" | "under") => bookRows
      .filter((line) => (line.side ?? "").toLowerCase() === side)
      .sort((left, right) => {
        const leftMs = left.fetched_at ? Date.parse(left.fetched_at) : -Infinity;
        const rightMs = right.fetched_at ? Date.parse(right.fetched_at) : -Infinity;
        return rightMs - leftMs;
      })[0];
    const over = latestSide("over");
    const under = latestSide("under");
    if (over?.odds_american === null || over?.odds_american === undefined) continue;
    if (under?.odds_american === null || under?.odds_american === undefined) continue;
    if (over.odds_american === 0 || under.odds_american === 0) continue;
    const overMs = over.fetched_at ? Date.parse(over.fetched_at) : null;
    const underMs = under.fetched_at ? Date.parse(under.fetched_at) : null;
    if (
      overMs !== null &&
      underMs !== null &&
      Number.isFinite(overMs) &&
      Number.isFinite(underMs) &&
      Math.abs(overMs - underMs) > FI_MAX_PAIR_SKEW_MS
    ) continue;
    const noVig = noVigPair(over.odds_american, under.odds_american);
    pairs.push({
      book,
      over,
      under,
      yrfiNoVig: noVig.home,
      nrfiNoVig: noVig.away,
    });
  }
  return pairs;
}

function projectionConsensus(pairs: CompleteFiPair[]): number | null {
  const sharpMedian = median(
    pairs.filter((pair) => FI_SHARP_BOOKS.has(pair.book)).map((pair) => pair.nrfiNoVig),
  );
  const retailMedian = median(
    pairs.filter((pair) => FI_RETAIL_BOOKS.has(pair.book)).map((pair) => pair.nrfiNoVig),
  );
  if (sharpMedian !== null && retailMedian !== null) return (sharpMedian + retailMedian) / 2;
  return sharpMedian ?? retailMedian;
}

function selectEvaluationPair(pairs: CompleteFiPair[]): CompleteFiPair | null {
  const books = [...FI_BOOK_PRIORITY, ...pairs.map((pair) => pair.book)];
  for (const book of new Set(books)) {
    const pair = pairs.find((candidate) => candidate.book === book);
    if (pair) return pair;
  }
  return null;
}

export function computeFiMarketBaseline(
  linesForGame: FiLineRow[],
  asOfIso: string = new Date().toISOString(),
): FiMarketBaseline {
  const empty: FiMarketBaseline = {
    listed_fi_total: null,
    yrfi_odds_american: null,
    nrfi_odds_american: null,
    yrfi_no_vig_prob: null,
    nrfi_no_vig_prob: null,
    current_nrfi_no_vig_prob: null,
    opening_nrfi_no_vig_prob: null,
    movement_nrfi_pp: null,
    movement_adjustment_pp: 0,
    movement_sportsbooks: [],
    movement_book_count: 0,
    evaluation_yrfi_no_vig_prob: null,
    evaluation_nrfi_no_vig_prob: null,
    evaluation_sportsbook: null,
    projection_sportsbooks: [],
    projection_book_count: 0,
    data_quality: "missing",
    freshness: null,
    reason: "fi_market_missing",
  };
  if (!linesForGame || linesForGame.length === 0) return empty;
  const asOfMs = Date.parse(asOfIso);
  if (!Number.isFinite(asOfMs)) return { ...empty, reason: "fi_market_invalid_as_of" };

  // Projection evidence is every fresh, complete, supported named-book pair.
  // FI does not require a supported sharp book because the live market is
  // commonly retail-only. Public ticket/handle splits are a different source
  // and are deliberately absent from this price-derived probability map.
  const matchesFiPrice = (line: FiLineRow) =>
    line.market_type === "first_inning_total" &&
    line.line_value !== null &&
    Math.abs(line.line_value - NRFI_YRFI_LINE_VALUE) < 0.001 &&
    !isBlockedSportsbook(line.sportsbook) &&
    isSupportedNamedSportsbook(line.sportsbook);
  const candidates = linesForGame.filter(
    (l) =>
      l.observation_type !== "opening" &&
      matchesFiPrice(l) &&
      isFreshFiMarketPriceSource(l.fetched_at, asOfMs),
  );
  if (candidates.length === 0) return empty;
  const pairs = completeNamedBookPairs(candidates);
  if (pairs.length === 0) return { ...empty, reason: "fi_market_one_sided_or_incoherent" };
  const evaluation = selectEvaluationPair(pairs);
  const currentNrfiConsensus = projectionConsensus(pairs);
  if (evaluation === null || currentNrfiConsensus === null) return empty;

  // Opening rows are context, never evaluation quotes. Compare only books
  // that have a coherent current pair and coherent retained opening pair so
  // changing book composition cannot masquerade as movement. The current
  // board remains the primary market forecast; movement contributes only a
  // 20% residual, capped to one probability point. Missing movement is zero.
  const openingCandidates = linesForGame.filter((line) => {
    if (line.observation_type !== "opening" || !matchesFiPrice(line)) return false;
    if (line.fetched_at === null || line.fetched_at === undefined) return false;
    const observedMs = Date.parse(line.fetched_at);
    return Number.isFinite(observedMs) && observedMs <= asOfMs;
  });
  const openingPairs = completeNamedBookPairs(openingCandidates);
  const openingBooks = new Set(openingPairs.map((pair) => pair.book));
  const currentBooks = new Set(pairs.map((pair) => pair.book));
  const comparableCurrentPairs = pairs.filter((pair) => openingBooks.has(pair.book));
  const comparableOpeningPairs = openingPairs.filter((pair) => currentBooks.has(pair.book));
  const comparableCurrentConsensus = projectionConsensus(comparableCurrentPairs);
  const openingNrfiConsensus = projectionConsensus(comparableOpeningPairs);
  const movementNrfi = comparableCurrentConsensus !== null && openingNrfiConsensus !== null
    ? comparableCurrentConsensus - openingNrfiConsensus
    : null;
  const movementAdjustment = movementNrfi === null
    ? 0
    : Math.max(
        -FI_MOVEMENT_MAX_ADJUSTMENT,
        Math.min(FI_MOVEMENT_MAX_ADJUSTMENT, movementNrfi * FI_MOVEMENT_RESIDUAL_WEIGHT),
      );
  const nrfiConsensus = Math.max(0.02, Math.min(0.98, currentNrfiConsensus + movementAdjustment));
  const yrfiConsensus = 1 - nrfiConsensus;
  const freshness = evaluation.over.fetched_at ?? evaluation.under.fetched_at ?? null;
  const movementSportsbooks = comparableCurrentPairs.map((pair) => pair.book).sort();
  return {
    listed_fi_total: NRFI_YRFI_LINE_VALUE,
    yrfi_odds_american: evaluation.over.odds_american,
    nrfi_odds_american: evaluation.under.odds_american,
    yrfi_no_vig_prob: yrfiConsensus,
    nrfi_no_vig_prob: nrfiConsensus,
    current_nrfi_no_vig_prob: currentNrfiConsensus,
    opening_nrfi_no_vig_prob: openingNrfiConsensus,
    movement_nrfi_pp: movementNrfi === null ? null : movementNrfi * 100,
    movement_adjustment_pp: movementAdjustment * 100,
    movement_sportsbooks: movementSportsbooks,
    movement_book_count: movementSportsbooks.length,
    evaluation_yrfi_no_vig_prob: evaluation.yrfiNoVig,
    evaluation_nrfi_no_vig_prob: evaluation.nrfiNoVig,
    evaluation_sportsbook: evaluation.book,
    projection_sportsbooks: pairs.map((pair) => pair.book).sort(),
    projection_book_count: pairs.length,
    data_quality: "ok",
    freshness,
    reason: `fi_named_book_consensus_${pairs.length}_movement_${movementSportsbooks.length}_evaluation_${evaluation.book}`,
  };
}

export const __TEST__ = {
  FI_MAX_PAIR_SKEW_MS,
  FI_MOVEMENT_RESIDUAL_WEIGHT,
  FI_MOVEMENT_MAX_ADJUSTMENT,
  projectionConsensus,
};
