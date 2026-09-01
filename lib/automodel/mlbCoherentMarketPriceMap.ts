import { poissonPmf, overProbabilityPoisson } from "./runDistribution";
import type {
  MlbCoherentMarketPriceMapSide,
  MlbCoherentMarketPriceMapSnapshot,
} from "./types";

export const MLB_COHERENT_MARKET_PRICE_MAP_RELEASE_ID =
  "mlb_coherent_market_price_map_v1_2026_09_01" as const;

const SHARP_BOOKS = new Set(["pinnacle", "circa", "bookmaker"]);
const RETAIL_BOOKS = new Set([
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "bet365",
  "hardrock",
  "betrivers",
  "ballybet",
  "betparx",
  "betway",
  "rebet",
]);
// Match the established feature-snapshot price freshness contract. A shorter
// second freshness cliff would let a normal collector delay turn this
// forecast input off while the same quotes remain valid everywhere else.
const MAX_FRESHNESS_MINUTES = 90;
const MAX_PAIR_SKEW_MINUTES = 2;
const MIN_BOOKS_PER_GROUP = 2;

export type MlbMarketPriceRow = {
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  fetched_at?: string | null;
};

type PairedProbability = {
  book: string;
  probability: number;
  observedAtMs: number;
};

export function buildMlbCoherentMarketPriceMap(args: {
  rows: ReadonlyArray<MlbMarketPriceRow>;
  listedTotal: number | null;
  asOf: string;
}): MlbCoherentMarketPriceMapSnapshot {
  const asOfMs = Date.parse(args.asOf);
  return {
    release_id: MLB_COHERENT_MARKET_PRICE_MAP_RELEASE_ID,
    as_of: args.asOf,
    moneyline_home: buildSide({
      rows: args.rows,
      market: "moneyline",
      selectedSide: "home",
      oppositeSide: "away",
      exactLine: null,
      asOfMs,
    }),
    total_over: args.listedTotal === null
      ? emptySide("missing_exact_line")
      : buildSide({
          rows: args.rows,
          market: "total",
          selectedSide: "over",
          oppositeSide: "under",
          exactLine: args.listedTotal,
          asOfMs,
        }),
  };
}

export function inferPoissonMeanFromNoVigTotalPrice(args: {
  listedTotal: number;
  overNoVigProbability: number;
}): number | null {
  if (
    !Number.isFinite(args.listedTotal)
    || !Number.isFinite(args.overNoVigProbability)
    || args.overNoVigProbability <= 0.02
    || args.overNoVigProbability >= 0.98
  ) return null;

  let low = Math.max(0.2, args.listedTotal - 6);
  let high = args.listedTotal + 6;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    const probability = conditionalOverProbability(mid, args.listedTotal);
    if (probability < args.overNoVigProbability) low = mid;
    else high = mid;
  }
  const mean = (low + high) / 2;
  return Number.isFinite(mean) ? mean : null;
}

export function splitConflictsWithPriceMap(args: {
  priceMap: MlbCoherentMarketPriceMapSide;
  publicBettingPct: number | null;
  publicMoneyPct: number | null;
}): boolean {
  if (
    args.priceMap.sharp_retail_gap === null
    || args.publicBettingPct === null
    || args.publicMoneyPct === null
  ) return false;
  const bets = normalizePct(args.publicBettingPct);
  const money = normalizePct(args.publicMoneyPct);
  if (bets === null || money === null) return false;
  const splitGap = money - bets;
  if (Math.abs(splitGap) < 0.1) return false;
  if (Math.abs(args.priceMap.sharp_retail_gap) < 0.01) return false;
  return Math.sign(splitGap) !== Math.sign(args.priceMap.sharp_retail_gap);
}

function buildSide(args: {
  rows: ReadonlyArray<MlbMarketPriceRow>;
  market: "moneyline" | "total";
  selectedSide: "home" | "over";
  oppositeSide: "away" | "under";
  exactLine: number | null;
  asOfMs: number;
}): MlbCoherentMarketPriceMapSide {
  if (!Number.isFinite(args.asOfMs)) return emptySide("invalid_as_of");
  const paired = pairByBook(args);
  const sharp = paired.filter((row) => SHARP_BOOKS.has(row.book));
  const retail = paired.filter((row) => RETAIL_BOOKS.has(row.book));
  const sharpProbability = median(sharp.map((row) => row.probability));
  const retailProbability = median(retail.map((row) => row.probability));
  const observedAt = median([...sharp, ...retail].map((row) => row.observedAtMs));
  const freshnessMinutes = observedAt === null
    ? null
    : Math.max(0, (args.asOfMs - observedAt) / 60_000);
  const gap = sharpProbability === null || retailProbability === null
    ? null
    : sharpProbability - retailProbability;

  let reason: string | null = null;
  if (sharp.length < MIN_BOOKS_PER_GROUP || retail.length < MIN_BOOKS_PER_GROUP) {
    reason = "insufficient_book_breadth";
  } else if (freshnessMinutes === null || freshnessMinutes > MAX_FRESHNESS_MINUTES) {
    reason = "stale_price_map";
  }
  return {
    sharp_no_vig_probability: sharpProbability,
    retail_no_vig_probability: retailProbability,
    sharp_book_count: sharp.length,
    retail_book_count: retail.length,
    sharp_retail_gap: gap,
    freshness_minutes: freshnessMinutes,
    eligible: reason === null,
    ineligible_reason: reason,
  };
}

function pairByBook(args: {
  rows: ReadonlyArray<MlbMarketPriceRow>;
  market: "moneyline" | "total";
  selectedSide: string;
  oppositeSide: string;
  exactLine: number | null;
  asOfMs: number;
}): PairedProbability[] {
  const byBook = new Map<string, { selected: MlbMarketPriceRow | null; opposite: MlbMarketPriceRow | null }>();
  for (const row of args.rows) {
    if (row.market_type !== args.market) continue;
    if (args.exactLine !== null && row.line_value !== args.exactLine) continue;
    if (row.side !== args.selectedSide && row.side !== args.oppositeSide) continue;
    if (row.odds_american === null || !Number.isFinite(row.odds_american)) continue;
    const observedAtMs = row.fetched_at ? Date.parse(row.fetched_at) : NaN;
    if (!Number.isFinite(observedAtMs) || observedAtMs > args.asOfMs) continue;
    const book = row.sportsbook.trim().toLowerCase();
    if (!SHARP_BOOKS.has(book) && !RETAIL_BOOKS.has(book)) continue;
    const pair = byBook.get(book) ?? { selected: null, opposite: null };
    const key = row.side === args.selectedSide ? "selected" : "opposite";
    const prior = pair[key];
    const priorMs = prior?.fetched_at ? Date.parse(prior.fetched_at) : -Infinity;
    if (observedAtMs >= priorMs) pair[key] = row;
    byBook.set(book, pair);
  }

  const output: PairedProbability[] = [];
  for (const [book, pair] of byBook) {
    if (pair.selected?.odds_american === null || pair.selected?.odds_american === undefined) continue;
    if (pair.opposite?.odds_american === null || pair.opposite?.odds_american === undefined) continue;
    const selectedMs = Date.parse(pair.selected.fetched_at!);
    const oppositeMs = Date.parse(pair.opposite.fetched_at!);
    if (Math.abs(selectedMs - oppositeMs) > MAX_PAIR_SKEW_MINUTES * 60_000) continue;
    try {
      const probability = noVigSelectedProbability(
        pair.selected.odds_american,
        pair.opposite.odds_american,
      );
      output.push({ book, probability, observedAtMs: Math.min(selectedMs, oppositeMs) });
    } catch {
      // Invalid price pairs are missing evidence, never a synthetic fallback.
    }
  }
  return output;
}

function noVigSelectedProbability(selectedAmerican: number, oppositeAmerican: number): number {
  const selected = americanImpliedProbability(selectedAmerican);
  const opposite = americanImpliedProbability(oppositeAmerican);
  const total = selected + opposite;
  if (!Number.isFinite(total) || total <= 0) throw new Error("invalid price pair");
  return selected / total;
}

function americanImpliedProbability(american: number): number {
  if (!Number.isFinite(american) || american === 0) throw new Error("invalid American price");
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}

function conditionalOverProbability(mean: number, line: number): number {
  const over = overProbabilityPoisson(mean, 0, line);
  if (!Number.isInteger(line)) return over;
  const push = poissonPmf(line, mean);
  const nonPush = 1 - push;
  return nonPush <= 0 ? 0.5 : over / nonPush;
}

function normalizePct(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const normalized = value > 1 ? value / 100 : value;
  return normalized >= 0 && normalized <= 1 ? normalized : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function emptySide(reason: string): MlbCoherentMarketPriceMapSide {
  return {
    sharp_no_vig_probability: null,
    retail_no_vig_probability: null,
    sharp_book_count: 0,
    retail_book_count: 0,
    sharp_retail_gap: null,
    freshness_minutes: null,
    eligible: false,
    ineligible_reason: reason,
  };
}
