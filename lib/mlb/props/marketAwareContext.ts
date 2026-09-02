import type { MlbPropMarketKey } from "./config";
import { poissonProbabilityOver } from "@/lib/models/props/distributions/poisson";
import { american_to_implied_probability, expected_value, remove_vig_two_way } from "./oddsMath";
import type { PropOddsSnapshot } from "./providers";

export const MLB_PROPS_MARKET_AWARE_CONTEXT_RELEASE =
  "mlb_props_market_aware_context_2026_09_02_r2_target_excluded_forecast";

const MAX_MOVEMENT_ADJUSTMENT = 0.015;
const MAX_RELATED_MOVEMENT_ADJUSTMENT = 0.0075;
const MAX_SPLIT_ADJUSTMENT = 0.005;
const MATERIAL_PRICE_MOVE = 0.015;

export type MlbPropMarketContext = Readonly<{
  currentOverProbability: number | null;
  targetExcludedOverProbability: number | null;
  completePairBooks: number;
  targetExcludedBooks: number;
  movementAdjustmentOver: number;
  relatedMovementAdjustmentOver: number;
  splitAdjustmentOver: number;
  openingBooks: number;
  relatedMarkets: number;
  splitEvidenceRows: number;
}>;

export type MlbPropMarketAwareForecast = Readonly<{
  overProbability: number;
  underProbability: number;
  projection: number;
  marketAdjustment: number;
}>;

/**
 * A milestone is a one-sided event contract, not a two-way choice offered at
 * the same line. Its forecast remains the priced event with its calibrated
 * probability; majority-side selection is reserved for true two-way offers.
 */
export function resolveMlbPropForecastSide(args: {
  marketKey: MlbPropMarketKey;
  offerContract: "two_way" | "milestone";
  offeredSide: "over" | "under";
  overProbability: number;
  underProbability: number;
}): "over" | "under" {
  return args.marketKey === "batter_home_runs" && args.offerContract === "milestone"
    ? args.offeredSide
    : args.overProbability >= args.underProbability ? "over" : "under";
}

export function buildMlbPropMarketContexts(args: {
  currentOdds: readonly PropOddsSnapshot[];
  openingOdds: readonly PropOddsSnapshot[];
}): Map<string, MlbPropMarketContext> {
  const openingsByBase = groupBy(args.openingOdds, quoteBaseKey);
  const currentByGroup = groupBy(args.currentOdds, quoteGroupKey);
  const groupSummaries = new Map<string, GroupSummary>();

  for (const [groupKey, rows] of currentByGroup) {
    const pairs = completeBookPairs(rows);
    const pairProbabilities = [...pairs.values()].flatMap((pair) => {
      try {
        return [remove_vig_two_way(pair.over.americanOdds, pair.under.americanOdds).over];
      } catch {
        return [];
      }
    });
    const oneSidedOver = rows
      .filter((row) => row.side === "over")
      .map((row) => safeImplied(row.americanOdds))
      .filter((value): value is number => value !== null);
    const currentOverProbability = median(pairProbabilities.length ? pairProbabilities : oneSidedOver);
    const movementByBook = new Map<string, number>();
    for (const [book, bookRows] of groupBy(rows, (row) => normalizeBook(row.sportsbook))) {
      const adjustment = sameBookMovementAdjustment(bookRows, openingsByBase);
      if (adjustment !== null) {
        movementByBook.set(book, adjustment);
      }
    }
    const splitByBook = new Map<string, number[]>();
    for (const row of rows) {
      const adjustment = strictSplitAdjustmentOver(row);
      if (adjustment === null) continue;
      const book = normalizeBook(row.sportsbook);
      splitByBook.set(book, [...(splitByBook.get(book) ?? []), adjustment]);
    }
    groupSummaries.set(groupKey, {
      rows,
      pairs,
      currentOverProbability,
      movementByBook,
      splitByBook,
    });
  }

  const contexts = new Map<string, MlbPropMarketContext>();
  for (const summary of groupSummaries.values()) {
    const first = summary.rows[0];
    if (!first) continue;
    for (const row of summary.rows) {
      const targetBook = normalizeBook(row.sportsbook);
      const excludedPairProbabilities = [...summary.pairs.entries()].flatMap(([book, pair]) => {
        if (book === targetBook) return [];
        try {
          return [remove_vig_two_way(pair.over.americanOdds, pair.under.americanOdds).over];
        } catch {
          return [];
        }
      });
      const excludedOneSided = summary.rows
        .filter((candidate) => candidate.side === "over" && normalizeBook(candidate.sportsbook) !== targetBook)
        .map((candidate) => safeImplied(candidate.americanOdds))
        .filter((value): value is number => value !== null);
      const targetExcludedOverProbability = median(
        excludedPairProbabilities.length ? excludedPairProbabilities : excludedOneSided,
      );
      const movementAdjustmentOver = targetExcludedMedian(summary.movementByBook, targetBook);
      const splitRows = [...summary.splitByBook.entries()]
        .filter(([book]) => book !== targetBook)
        .flatMap(([, values]) => values);
      const related = targetExcludedRelatedAdjustments({
        summaries: groupSummaries,
        row,
        targetBook,
      });
      contexts.set(marketContextQuoteKey(row), {
        currentOverProbability: summary.currentOverProbability,
        targetExcludedOverProbability,
        completePairBooks: summary.pairs.size,
        targetExcludedBooks: excludedPairProbabilities.length || excludedOneSided.length,
        movementAdjustmentOver,
        relatedMovementAdjustmentOver: coherentRelatedAdjustment(related.map((value) => value.adjustment)),
        splitAdjustmentOver: clamp(median(splitRows) ?? 0, MAX_SPLIT_ADJUSTMENT),
        openingBooks: [...summary.movementByBook.keys()].filter((book) => book !== targetBook).length,
        relatedMarkets: related.length,
        splitEvidenceRows: splitRows.length,
      });
    }
  }
  return contexts;
}

export function applyMlbPropMarketAwareForecast(args: {
  marketKey: MlbPropMarketKey;
  line: number;
  independentOverProbability: number;
  independentProjection: number;
  modelWeight: number;
  context: MlbPropMarketContext | null;
}): MlbPropMarketAwareForecast {
  const independentOver = clampProbability(args.independentOverProbability);
  const marketOver = args.context?.targetExcludedOverProbability;
  const modelWeight = Math.max(0, Math.min(1, args.modelWeight));
  const anchored = marketOver === null || marketOver === undefined
    ? independentOver
    : independentOver * modelWeight + marketOver * (1 - modelWeight);
  const contextualAdjustment = marketOver === null || marketOver === undefined
    ? 0
    : (args.context?.movementAdjustmentOver ?? 0)
      + (args.context?.relatedMovementAdjustmentOver ?? 0)
      + (args.context?.splitAdjustmentOver ?? 0);
  const overProbability = clampProbability(anchored + contextualAdjustment);
  const projection = mlbPropProjectionForPosterior({
    marketKey: args.marketKey,
    line: args.line,
    independentProjection: args.independentProjection,
    independentOverProbability: independentOver,
    authoritativeOverProbability: overProbability,
  });
  return {
    overProbability: round(overProbability, 6),
    underProbability: round(1 - overProbability, 6),
    projection,
    marketAdjustment: round(overProbability - independentOver, 6),
  };
}

export function qualifiesMlbPropMarketAwareWatchlist(args: {
  side: "over" | "under";
  americanOdds: number;
  overProbability: number;
  context: MlbPropMarketContext | null;
}): boolean {
  const referenceOver = args.context?.targetExcludedOverProbability;
  if (referenceOver === null || referenceOver === undefined || (args.context?.targetExcludedBooks ?? 0) < 1) return false;
  const probability = args.side === "over" ? args.overProbability : 1 - args.overProbability;
  const reference = args.side === "over" ? referenceOver : 1 - referenceOver;
  const edge = probability - reference;
  let ev: number;
  try {
    ev = expected_value(probability, args.americanOdds);
  } catch {
    return false;
  }
  const directionalContext = args.side === "over"
    ? (args.context?.movementAdjustmentOver ?? 0) + (args.context?.relatedMovementAdjustmentOver ?? 0) + (args.context?.splitAdjustmentOver ?? 0)
    : -((args.context?.movementAdjustmentOver ?? 0) + (args.context?.relatedMovementAdjustmentOver ?? 0) + (args.context?.splitAdjustmentOver ?? 0));
  return edge >= 0.01 && ev >= 0.02 && directionalContext >= -0.0025;
}

export function marketContextQuoteKey(row: Pick<PropOddsSnapshot,
  "gameId" | "playerId" | "marketKey" | "line" | "sportsbook" | "side"
>): string {
  return [row.gameId, row.playerId, row.marketKey, row.line, normalizeBook(row.sportsbook), row.side].join("|");
}

type BookPair = { over: PropOddsSnapshot; under: PropOddsSnapshot };
type GroupSummary = {
  rows: PropOddsSnapshot[];
  pairs: Map<string, BookPair>;
  currentOverProbability: number | null;
  movementByBook: Map<string, number>;
  splitByBook: Map<string, number[]>;
};

function targetExcludedMedian(values: Map<string, number>, targetBook: string): number {
  return clamp(median([...values.entries()]
    .filter(([book]) => book !== targetBook)
    .map(([, value]) => value)) ?? 0, MAX_MOVEMENT_ADJUSTMENT);
}

function targetExcludedRelatedAdjustments(args: {
  summaries: Map<string, GroupSummary>;
  row: PropOddsSnapshot;
  targetBook: string;
}): Array<{ market: MlbPropMarketKey; adjustment: number }> {
  const byMarket = new Map<MlbPropMarketKey, number[]>();
  for (const summary of args.summaries.values()) {
    const related = summary.rows[0];
    if (!related
      || related.gameId !== args.row.gameId
      || related.playerId !== args.row.playerId
      || related.marketKey === args.row.marketKey
      || relatedCluster(related.marketKey) !== relatedCluster(args.row.marketKey)) continue;
    const adjustment = targetExcludedMedian(summary.movementByBook, args.targetBook);
    if (Math.abs(adjustment) < 1e-9) continue;
    byMarket.set(related.marketKey, [...(byMarket.get(related.marketKey) ?? []), adjustment]);
  }
  return [...byMarket.entries()].flatMap(([market, adjustments]) => {
    const adjustment = median(adjustments);
    return adjustment === null ? [] : [{ market, adjustment }];
  });
}

function completeBookPairs(rows: readonly PropOddsSnapshot[]): Map<string, BookPair> {
  const grouped = groupBy(rows, (row) => normalizeBook(row.sportsbook));
  const out = new Map<string, BookPair>();
  for (const [book, bookRows] of grouped) {
    const over = latest(bookRows.filter((row) => row.side === "over"));
    const under = latest(bookRows.filter((row) => row.side === "under"));
    if (over && under && over.line === under.line) out.set(book, { over, under });
  }
  return out;
}

function sameBookMovementAdjustment(
  currentRows: readonly PropOddsSnapshot[],
  openingsByBase: Map<string, PropOddsSnapshot[]>,
): number | null {
  const currentOver = latest(currentRows.filter((row) => row.side === "over"));
  const currentUnder = latest(currentRows.filter((row) => row.side === "under"));
  const representative = currentOver ?? currentUnder;
  if (!representative) return null;
  const openingOver = currentOver ? nearestOpening(currentOver, openingsByBase.get(quoteBaseKey(currentOver)) ?? []) : null;
  const openingUnder = currentUnder ? nearestOpening(currentUnder, openingsByBase.get(quoteBaseKey(currentUnder)) ?? []) : null;
  const opening = openingOver ?? openingUnder;
  if (!opening) return null;
  const currentLine = representative.line;
  const openingLine = opening.line;
  if (Math.abs(currentLine - openingLine) >= 0.25) {
    // A higher current total reflects a market move toward more of the
    // underlying stat; a lower current total reflects the opposite. Apply the
    // direction to the latent projection, rather than treating an easier
    // current threshold as bullish information by itself.
    return clamp((currentLine - openingLine) * 0.01, MAX_MOVEMENT_ADJUSTMENT);
  }
  if (currentOver && currentUnder && openingOver && openingUnder) {
    try {
      const current = remove_vig_two_way(currentOver.americanOdds, currentUnder.americanOdds).over;
      const opened = remove_vig_two_way(openingOver.americanOdds, openingUnder.americanOdds).over;
      const delta = current - opened;
      return Math.abs(delta) >= MATERIAL_PRICE_MOVE ? clamp(delta * 0.35, MAX_MOVEMENT_ADJUSTMENT) : 0;
    } catch {
      return 0;
    }
  }
  if (currentOver && openingOver) {
    const current = safeImplied(currentOver.americanOdds);
    const opened = safeImplied(openingOver.americanOdds);
    if (current === null || opened === null) return 0;
    const delta = current - opened;
    return Math.abs(delta) >= MATERIAL_PRICE_MOVE ? clamp(delta * 0.35, MAX_MOVEMENT_ADJUSTMENT) : 0;
  }
  if (currentUnder && openingUnder) {
    const current = safeImplied(currentUnder.americanOdds);
    const opened = safeImplied(openingUnder.americanOdds);
    if (current === null || opened === null) return 0;
    const delta = current - opened;
    return Math.abs(delta) >= MATERIAL_PRICE_MOVE ? clamp(-delta * 0.35, MAX_MOVEMENT_ADJUSTMENT) : 0;
  }
  return 0;
}

function strictSplitAdjustmentOver(row: PropOddsSnapshot): number | null {
  const raw = asRecord(row.rawPayload);
  const source = stringValue(raw.split_source);
  const timestamp = stringValue(raw.split_updated_at);
  const bets = percentage(raw.bet_percentage ?? raw.public_bets_percentage);
  const money = percentage(raw.money_percentage ?? raw.handle_percentage ?? raw.public_money_percentage);
  if (!source || !timestamp || bets === null || money === null) return null;
  const age = Date.parse(row.asOfTimestamp) - Date.parse(timestamp);
  if (!Number.isFinite(age) || age < 0 || age > 2 * 60 * 60 * 1000) return null;
  const divergence = money - bets;
  if (Math.abs(divergence) < 0.05) return 0;
  const selectedSideAdjustment = clamp(divergence * 0.05, MAX_SPLIT_ADJUSTMENT);
  return row.side === "over" ? selectedSideAdjustment : -selectedSideAdjustment;
}

function coherentRelatedAdjustment(values: readonly number[]): number {
  const material = values.filter((value) => Math.abs(value) >= 0.0025);
  if (material.length < 2) return 0;
  const sign = Math.sign(material[0]);
  if (!sign || material.some((value) => Math.sign(value) !== sign)) return 0;
  return clamp((median(material) ?? 0) * 0.5, MAX_RELATED_MOVEMENT_ADJUSTMENT);
}

export function mlbPropProjectionForPosterior(args: {
  marketKey: MlbPropMarketKey;
  line: number;
  independentProjection: number;
  independentOverProbability: number;
  authoritativeOverProbability: number;
}): number {
  if (![args.line, args.independentProjection].every(Number.isFinite)) return args.independentProjection;
  if (Math.abs(args.authoritativeOverProbability - args.independentOverProbability) < 1e-12) {
    return args.independentProjection;
  }
  const threshold = Math.floor(args.line) + 1;
  const authoritativeMean = inversePoissonOverProbability(args.authoritativeOverProbability, threshold);
  // Probability influence is already bounded upstream by the established
  // category priors and context caps. The projected count is the inverse of
  // that one final count distribution; applying a second shift cap here would
  // describe a different forecast.
  return authoritativeMean;
}

function inversePoissonOverProbability(probability: number, threshold: number): number {
  const target = clampProbability(probability);
  let lower = 0;
  let upper = Math.max(4, threshold + 4);
  while (poissonProbabilityOver(upper, threshold) < target && upper < 512) upper *= 2;
  for (let iteration = 0; iteration < 80; iteration++) {
    const midpoint = (lower + upper) / 2;
    if (poissonProbabilityOver(midpoint, threshold) < target) lower = midpoint;
    else upper = midpoint;
  }
  return (lower + upper) / 2;
}

function relatedCluster(market: MlbPropMarketKey): string {
  if (["pitcher_hits_allowed", "pitcher_walks", "pitcher_earned_runs"].includes(market)) return "pitcher_damage";
  if (["pitcher_outs", "pitcher_strikeouts"].includes(market)) return "pitcher_workload";
  if (market === "batter_strikeouts") return "batter_strikeouts";
  return "batter_production";
}

function quoteGroupKey(row: PropOddsSnapshot): string {
  return [row.gameId, row.playerId, row.marketKey, row.line].join("|");
}

function quoteBaseKey(row: PropOddsSnapshot): string {
  return [row.gameId, row.playerId, row.marketKey, normalizeBook(row.sportsbook), row.side].join("|");
}

function nearestOpening(current: PropOddsSnapshot, rows: readonly PropOddsSnapshot[]): PropOddsSnapshot | null {
  return [...rows].sort((left, right) =>
    Math.abs(left.line - current.line) - Math.abs(right.line - current.line)
    || Date.parse(left.asOfTimestamp) - Date.parse(right.asOfTimestamp)
  )[0] ?? null;
}

function latest(rows: readonly PropOddsSnapshot[]): PropOddsSnapshot | null {
  return [...rows].sort((left, right) => Date.parse(right.asOfTimestamp) - Date.parse(left.asOfTimestamp))[0] ?? null;
}

function groupBy<T>(rows: readonly T[], keyFor: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) out.set(keyFor(row), [...(out.get(keyFor(row)) ?? []), row]);
  return out;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function safeImplied(americanOdds: number): number | null {
  try {
    return american_to_implied_probability(americanOdds);
  } catch {
    return null;
  }
}

function percentage(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  const normalized = parsed > 1 ? parsed / 100 : parsed;
  return normalized >= 0 && normalized <= 1 ? normalized : null;
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function clamp(value: number, maxAbs: number): number {
  return Math.max(-maxAbs, Math.min(maxAbs, value));
}

function clampProbability(value: number): number {
  return Math.max(0.01, Math.min(0.99, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
