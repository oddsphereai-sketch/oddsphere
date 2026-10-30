import type { MarketBrainObservation } from "../services/marketBrain/marketBrainContract";
import { CBB_EVIDENCE_RELEASE } from "./releases";
import { cbbThresholdProbabilities } from "./model";
import type { CbbForecast, CbbMarket, CbbOdds, CbbQuote } from "./types";

export function cbbImpliedProbability(price: number) {
  if (!Number.isFinite(price) || Math.abs(price) < 100) throw new Error("invalid CBB American price");
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}
function lineNumber(value: string | number | null): number | null {
  if (value === null || value === "" || (typeof value === "string" && !value.trim())) return null;
  const n = Number(value); return Number.isFinite(n) && Number.isInteger(n * 2) ? n : null;
}

export function normalizeCbbOdds(rows: CbbOdds[], options: {
  gameId: number; startsAt: string; asOf: string; fetchedAt: string; phase: "opening" | "current";
}) {
  const quotes: CbbQuote[] = [], rejected: Array<{ rowId: number; market: CbbMarket | null; reason: string }> = [];
  for (const row of rows) {
    const reject = (market: CbbMarket | null, reason: string) => rejected.push({ rowId: row.id, market, reason });
    if (row.game_id !== options.gameId) { reject(null, "wrong_game"); continue; }
    const providerObservedAt = options.phase === "opening" ? row.opened_at : row.updated_at;
    const providerMs = Date.parse(providerObservedAt ?? ""), asOfMs = Date.parse(options.asOf), receiptMs = Date.parse(options.fetchedAt);
    if (!row.vendor?.trim() || !Number.isFinite(providerMs) || !Number.isFinite(asOfMs) || !Number.isFinite(receiptMs) ||
      providerMs > asOfMs || providerMs > receiptMs || receiptMs > asOfMs || providerMs >= Date.parse(options.startsAt)) {
      reject(null, "invalid_or_future_identity_time"); continue;
    }
    const spread = lineNumber(row.spread_home_value), oppositeSpread = lineNumber(row.spread_away_value);
    const total = lineNumber(row.total_value);
    const pairs: Array<[CbbMarket, number | null, number | null, number | null, boolean]> = [
      ["moneyline", null, row.moneyline_home_odds, row.moneyline_away_odds, true],
      ["spread", spread, row.spread_home_odds, row.spread_away_odds, spread !== null && oppositeSpread !== null && spread === -oppositeSpread],
      ["total", total, row.total_over_odds, row.total_under_odds, total !== null && total > 0],
    ];
    for (const [market, line, firstPrice, secondPrice, coherent] of pairs) {
      if (!coherent || firstPrice === null || secondPrice === null || !Number.isFinite(firstPrice) || !Number.isFinite(secondPrice) ||
        Math.abs(firstPrice) < 100 || Math.abs(secondPrice) < 100) { reject(market, "incomplete_two_sided_quote"); continue; }
      const hold = cbbImpliedProbability(firstPrice) + cbbImpliedProbability(secondPrice);
      if (hold < 0.98 || hold > 1.3) { reject(market, "incoherent_two_way_hold"); continue; }
      quotes.push({ gameId: row.game_id, sportsbook: row.vendor.toLowerCase(), market, line,
        firstPrice, secondPrice, providerObservedAt: providerObservedAt!, fetchedAt: options.fetchedAt, phase: options.phase });
    }
  }
  return { quotes, rejected };
}

/** Preserve each book, threshold and timestamp. Price shortening and point moves are different evidence. */
export function cbbSameBookMovement(opening: CbbQuote[], current: CbbQuote[]) {
  return current.map(quote => {
    const candidates = opening.filter(old => old.gameId === quote.gameId && old.market === quote.market && old.sportsbook === quote.sportsbook &&
      old.phase === "opening" && Date.parse(old.providerObservedAt) < Date.parse(quote.providerObservedAt));
    const old = candidates.length === 1 ? candidates[0] : null;
    const fair = (row: CbbQuote) => cbbImpliedProbability(row.firstPrice) /
      (cbbImpliedProbability(row.firstPrice) + cbbImpliedProbability(row.secondPrice));
    return { gameId: quote.gameId, market: quote.market, sportsbook: quote.sportsbook,
      opening: old, current: quote,
      lineDelta: old?.line !== null && old?.line !== undefined && quote.line !== null ? quote.line - old.line : null,
      // Comparing prices at different Spread/Total lines does not isolate price pressure.
      sameLineFairProbabilityDelta: old && old.line === quote.line ? fair(quote) - fair(old) : null,
      chronology: old ? "opening_to_current" : "current_only",
      observedLeader: "unknown", intermediatePathKnown: false,
    };
  });
}

/** Uses the existing shared contract; CBB remains explicitly unregistered for inference (sport='other'). */
export function cbbPriceObservations(quotes: CbbQuote[]): MarketBrainObservation[] {
  return quotes.map(quote => ({
    id: `cbb:${quote.gameId}:${quote.sportsbook}:${quote.market}:${quote.phase}:${quote.providerObservedAt}`,
    eventId: `cbb:${quote.gameId}`, sport: "other", market: quote.market, modality: "price_quote",
    source: { provider: "balldontlie", feed: `ncaab_${quote.phase}_odds`, participant: quote.sportsbook },
    sourcePrior: ["pinnacle", "circa", "bookmaker"].includes(quote.sportsbook) ? "professional_book" : "retail_book",
    observedRole: "unknown", observedAt: quote.providerObservedAt,
    timing: { providerObservedAt: quote.providerObservedAt, providerFetchedAt: quote.fetchedAt,
      ingestedAt: quote.fetchedAt, availableAt: quote.fetchedAt },
    availability: "observed", targetRelation: "unknown",
    values: { line: { value: quote.line, observed: quote.line === null ? 0 : 1 },
      firstPrice: { value: quote.firstPrice, observed: 1 }, secondPrice: { value: quote.secondPrice, observed: 1 } },
    categorical: { competition: "ncaab", product: "cbb_daily_edge", phase: quote.phase, sideOrientationVerified: false },
    audit: { sourceRelease: CBB_EVIDENCE_RELEASE, sourceObservationId: `${quote.gameId}:${quote.sportsbook}:${quote.phase}`,
      notes: ["CBB inference qualification pending", "Original provider orientation retained; independent verification required"] },
  }));
}

/** Review economics on the forecast side; never choose a different winner for a larger EV. */
export function reviewCbbQuote(forecast: CbbForecast, quote: CbbQuote) {
  const probabilities = cbbThresholdProbabilities(forecast, quote.market, quote.line);
  const selection = probabilities.first >= probabilities.second ? "first" : "second";
  const price = selection === "first" ? quote.firstPrice : quote.secondPrice;
  const p = selection === "first" ? probabilities.first : probabilities.second;
  const lose = selection === "first" ? probabilities.second : probabilities.first;
  const profit = price > 0 ? price / 100 : 100 / -price;
  return { quote, selection, probability: p, pushProbability: probabilities.push,
    expectedValue: p * profit - lose, playGrade: null, gradeStatus: "calibration_pending" as const, stake: 0 };
}
