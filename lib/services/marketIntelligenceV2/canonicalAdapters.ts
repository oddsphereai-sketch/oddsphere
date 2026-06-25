import { createHash } from "crypto";
import type { PlaybookSplitGame, PlaybookSplitMarket } from "../../providers/playbook/types";
import type {
  CanonicalObservationRejection,
  MarketIntelligenceMarketType,
  MarketIntelligenceSelectionSide,
  MarketPriceObservationV2,
  MarketSplitObservationV2,
  MarketSplitSourceBook,
  MarketSplitSourceType,
} from "../../types/domain/MarketIntelligenceV2";

export type CanonicalAdapterResult<T> = {
  observations: T[];
  rejected: CanonicalObservationRejection[];
};

type SidePair = readonly [MarketIntelligenceSelectionSide, MarketIntelligenceSelectionSide];

const MARKET_SIDES: Record<MarketIntelligenceMarketType, SidePair> = {
  moneyline: ["home", "away"],
  spread: ["home", "away"],
  total: ["over", "under"],
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function stablePayloadHash(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stable(payload)))
    .digest("hex");
}

export function normalizePercentToUnit(
  value: unknown,
  field: string,
  errors: string[],
): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    errors.push(`${field} malformed`);
    return null;
  }
  if (n < 0) {
    errors.push(`${field} below 0`);
    return null;
  }
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  errors.push(`${field} above 100%`);
  return null;
}

export function validateOpposingPercentages(opts: {
  market: MarketIntelligenceMarketType;
  metric: "bets_pct" | "money_pct";
  a: number | null;
  b: number | null;
  errors: string[];
  tolerance?: number;
}): void {
  if (opts.a === null || opts.b === null) return;
  const tolerance = opts.tolerance ?? 0.03;
  const sum = opts.a + opts.b;
  if (Math.abs(sum - 1) > tolerance) {
    opts.errors.push(
      `${opts.market} ${opts.metric} opposing sides sum ${sum.toFixed(4)} outside tolerance`,
    );
  }
}

function playbookMarket(row: PlaybookSplitGame, market: MarketIntelligenceMarketType): PlaybookSplitMarket | undefined {
  return row.splits?.[market];
}

function playbookPct(
  market: PlaybookSplitMarket | undefined,
  side: MarketIntelligenceSelectionSide,
): { bets: unknown; money: unknown } {
  if (!market) return { bets: null, money: null };
  if (side === "home") return { bets: market.bets?.homePercent, money: market.money?.homePercent };
  if (side === "away") return { bets: market.bets?.awayPercent, money: market.money?.awayPercent };
  if (side === "over") return { bets: market.bets?.overPercent, money: market.money?.overPercent };
  return { bets: market.bets?.underPercent, money: market.money?.underPercent };
}

function reject(provider: CanonicalObservationRejection["provider"], args: {
  providerEventId: string | null;
  market: MarketIntelligenceMarketType | null;
  selectionKey: string | null;
  reason: string;
}): CanonicalObservationRejection {
  return {
    provider,
    provider_event_id: args.providerEventId,
    market_type: args.market,
    selection_key: args.selectionKey,
    reason: args.reason,
  };
}

export function buildPlaybookSplitObservationsV2(opts: {
  row: PlaybookSplitGame;
  canonicalEventId: string;
  league: string;
  fetchedAt: string;
  minutesToStart?: number | null;
  canonicalMarketId: (market: MarketIntelligenceMarketType) => string;
  selectionKey: (market: MarketIntelligenceMarketType, side: MarketIntelligenceSelectionSide) => string;
}): CanonicalAdapterResult<MarketSplitObservationV2> {
  const observations: MarketSplitObservationV2[] = [];
  const rejected: CanonicalObservationRejection[] = [];
  const providerEventId = opts.row.gameId ?? null;

  for (const market of Object.keys(MARKET_SIDES) as MarketIntelligenceMarketType[]) {
    const rawMarket = playbookMarket(opts.row, market);
    if (!rawMarket) continue;

    const sideValues = MARKET_SIDES[market].map((side) => {
      const errors: string[] = [];
      const raw = playbookPct(rawMarket, side);
      const bets = normalizePercentToUnit(raw.bets, `${market}.${side}.bets`, errors);
      const money = normalizePercentToUnit(raw.money, `${market}.${side}.money`, errors);
      return { side, bets, money, errors };
    });
    validateOpposingPercentages({
      market,
      metric: "bets_pct",
      a: sideValues[0]?.bets ?? null,
      b: sideValues[1]?.bets ?? null,
      errors: sideValues[0]?.errors ?? [],
    });
    validateOpposingPercentages({
      market,
      metric: "money_pct",
      a: sideValues[0]?.money ?? null,
      b: sideValues[1]?.money ?? null,
      errors: sideValues[0]?.errors ?? [],
    });

    const sharedErrors = [...(sideValues[0]?.errors ?? []), ...(sideValues[1]?.errors ?? [])];
    if (sharedErrors.length > 0) {
      rejected.push(reject("playbook", {
        providerEventId,
        market,
        selectionKey: null,
        reason: sharedErrors.join("; "),
      }));
      continue;
    }

    for (const v of sideValues) {
      if (v.bets === null && v.money === null) continue;
      observations.push({
        canonical_event_id: opts.canonicalEventId,
        canonical_market_id: opts.canonicalMarketId(market),
        league: opts.league,
        market_type: market,
        selection_key: opts.selectionKey(market, v.side),
        provider: "playbook",
        source_book: "consensus",
        source_type: "multi_book_consensus",
        bets_pct: v.bets,
        money_pct: v.money,
        market_line: null,
        market_price: null,
        books_used: rawMarket.source?.booksUsed ?? null,
        provider_event_id: providerEventId,
        source_observed_at: null,
        fetched_at: opts.fetchedAt,
        source_timestamp_verified: false,
        minutes_to_start: opts.minutesToStart ?? null,
        raw_payload_hash: stablePayloadHash({ provider: "playbook", market, side: v.side, rawMarket }),
      });
    }
  }

  return { observations, rejected };
}

export type RawSharpApiSplitMarketV2 = {
  bets_pct?: Record<string, unknown> | null;
  handle_pct?: Record<string, unknown> | null;
  line?: unknown;
  odds_american?: unknown;
};

export type RawSharpApiSplitRowV2 = {
  event_id?: string | number | null;
  sportsbook?: string | null;
  league?: string | null;
  fetched_at?: string | null;
  moneyline?: RawSharpApiSplitMarketV2 | null;
  spread?: RawSharpApiSplitMarketV2 | null;
  total?: RawSharpApiSplitMarketV2 | null;
};

export function classifySharpApiSplitSourceBook(raw: string | null | undefined): {
  source_book: MarketSplitSourceBook | null;
  source_type: MarketSplitSourceType | null;
} {
  const v = (raw ?? "").toLowerCase().trim().replace(/\s+/g, "");
  if (v === "draftkings" || v === "dk") {
    return { source_book: "draftkings", source_type: "retail_book" };
  }
  if (v === "circa") {
    return { source_book: "circa", source_type: "sharp_adjacent_book" };
  }
  if (v === "betmgm") {
    return { source_book: "betmgm", source_type: "retail_book" };
  }
  return { source_book: null, source_type: null };
}

function sharpApiMarket(row: RawSharpApiSplitRowV2, market: MarketIntelligenceMarketType): RawSharpApiSplitMarketV2 | null | undefined {
  return row[market];
}

export function buildSharpApiSplitObservationsV2(opts: {
  row: RawSharpApiSplitRowV2;
  canonicalEventId: string;
  league: string;
  fetchedAt: string;
  minutesToStart?: number | null;
  canonicalMarketId: (market: MarketIntelligenceMarketType) => string;
  selectionKey: (market: MarketIntelligenceMarketType, side: MarketIntelligenceSelectionSide) => string;
}): CanonicalAdapterResult<MarketSplitObservationV2> {
  const observations: MarketSplitObservationV2[] = [];
  const rejected: CanonicalObservationRejection[] = [];
  const providerEventId = opts.row.event_id === null || opts.row.event_id === undefined
    ? null
    : String(opts.row.event_id);
  const source = classifySharpApiSplitSourceBook(opts.row.sportsbook);
  if (source.source_book === null || source.source_type === null) {
    return {
      observations,
      rejected: [reject("sharpapi", {
        providerEventId,
        market: null,
        selectionKey: null,
        reason: `unsupported SharpAPI split source_book=${opts.row.sportsbook ?? "null"}`,
      })],
    };
  }

  for (const market of Object.keys(MARKET_SIDES) as MarketIntelligenceMarketType[]) {
    const rawMarket = sharpApiMarket(opts.row, market);
    if (!rawMarket) continue;
    const sideValues = MARKET_SIDES[market].map((side) => {
      const errors: string[] = [];
      const bets = normalizePercentToUnit(rawMarket.bets_pct?.[side], `${market}.${side}.bets`, errors);
      const money = normalizePercentToUnit(rawMarket.handle_pct?.[side], `${market}.${side}.money`, errors);
      return { side, bets, money, errors };
    });
    validateOpposingPercentages({
      market,
      metric: "bets_pct",
      a: sideValues[0]?.bets ?? null,
      b: sideValues[1]?.bets ?? null,
      errors: sideValues[0]?.errors ?? [],
    });
    validateOpposingPercentages({
      market,
      metric: "money_pct",
      a: sideValues[0]?.money ?? null,
      b: sideValues[1]?.money ?? null,
      errors: sideValues[0]?.errors ?? [],
    });

    const sharedErrors = [...(sideValues[0]?.errors ?? []), ...(sideValues[1]?.errors ?? [])];
    if (sharedErrors.length > 0) {
      rejected.push(reject("sharpapi", {
        providerEventId,
        market,
        selectionKey: null,
        reason: sharedErrors.join("; "),
      }));
      continue;
    }

    const line = typeof rawMarket.line === "number" && Number.isFinite(rawMarket.line) ? rawMarket.line : null;
    const price = typeof rawMarket.odds_american === "number" && Number.isFinite(rawMarket.odds_american)
      ? rawMarket.odds_american
      : null;

    for (const v of sideValues) {
      if (v.bets === null && v.money === null) continue;
      observations.push({
        canonical_event_id: opts.canonicalEventId,
        canonical_market_id: opts.canonicalMarketId(market),
        league: opts.league,
        market_type: market,
        selection_key: opts.selectionKey(market, v.side),
        provider: "sharpapi",
        source_book: source.source_book,
        source_type: source.source_type,
        bets_pct: v.bets,
        money_pct: v.money,
        market_line: line,
        market_price: price,
        books_used: null,
        provider_event_id: providerEventId,
        source_observed_at: opts.row.fetched_at ?? null,
        fetched_at: opts.fetchedAt,
        source_timestamp_verified: opts.row.fetched_at !== null && opts.row.fetched_at !== undefined,
        minutes_to_start: opts.minutesToStart ?? null,
        raw_payload_hash: stablePayloadHash({ provider: "sharpapi", market, side: v.side, source: opts.row.sportsbook, rawMarket }),
      });
    }
  }

  return { observations, rejected };
}

export type RawSharpApiBetMgmTicketRowV2 = {
  event_id?: string | number | null;
  sportsbook?: string | null;
  market_type: MarketIntelligenceMarketType;
  selection_key: string;
  public_bet_pct?: unknown;
  line?: number | null;
  odds_american?: number | null;
  provider_timestamp?: string | null;
};

export function buildSharpApiBetMgmTicketObservationV2(opts: {
  row: RawSharpApiBetMgmTicketRowV2;
  canonicalEventId: string;
  canonicalMarketId: string;
  league: string;
  fetchedAt: string;
  minutesToStart?: number | null;
}): CanonicalAdapterResult<MarketSplitObservationV2> {
  const providerEventId = opts.row.event_id === null || opts.row.event_id === undefined
    ? null
    : String(opts.row.event_id);
  const errors: string[] = [];
  const bets = normalizePercentToUnit(opts.row.public_bet_pct, "betmgm.public_bet_pct", errors);
  if ((opts.row.sportsbook ?? "").toLowerCase() !== "betmgm") {
    errors.push("BetMGM ticket observation requires sportsbook=betmgm");
  }
  if (errors.length > 0) {
    return {
      observations: [],
      rejected: [reject("sharpapi", {
        providerEventId,
        market: opts.row.market_type,
        selectionKey: opts.row.selection_key,
        reason: errors.join("; "),
      })],
    };
  }
  if (bets === null) return { observations: [], rejected: [] };
  return {
    observations: [{
      canonical_event_id: opts.canonicalEventId,
      canonical_market_id: opts.canonicalMarketId,
      league: opts.league,
      market_type: opts.row.market_type,
      selection_key: opts.row.selection_key,
      provider: "sharpapi",
      source_book: "betmgm",
      source_type: "retail_book",
      bets_pct: bets,
      money_pct: null,
      market_line: opts.row.line ?? null,
      market_price: opts.row.odds_american ?? null,
      books_used: null,
      provider_event_id: providerEventId,
      source_observed_at: opts.row.provider_timestamp ?? null,
      fetched_at: opts.fetchedAt,
      source_timestamp_verified: opts.row.provider_timestamp !== null && opts.row.provider_timestamp !== undefined,
      minutes_to_start: opts.minutesToStart ?? null,
      raw_payload_hash: stablePayloadHash({ provider: "sharpapi", source: "betmgm", row: opts.row }),
    }],
    rejected: [],
  };
}

export function buildSharpApiPriceObservationV2(opts: {
  canonicalEventId: string;
  canonicalMarketId: string;
  league: string;
  sportsbook: string;
  sharpBook: boolean;
  marketType: MarketIntelligenceMarketType;
  selectionKey: string;
  line: number | null;
  americanPrice: number | null;
  decimalPrice: number | null;
  noVigProbability?: number | null;
  providerTimestamp?: string | null;
  fetchedAt: string;
  minutesToStart?: number | null;
}): MarketPriceObservationV2 {
  return {
    canonical_event_id: opts.canonicalEventId,
    canonical_market_id: opts.canonicalMarketId,
    league: opts.league,
    sportsbook: opts.sportsbook,
    sharp_book: opts.sharpBook,
    market_type: opts.marketType,
    selection_key: opts.selectionKey,
    line: opts.line,
    american_price: opts.americanPrice,
    decimal_price: opts.decimalPrice,
    no_vig_probability: opts.noVigProbability ?? null,
    provider_timestamp: opts.providerTimestamp ?? null,
    fetched_at: opts.fetchedAt,
    minutes_to_start: opts.minutesToStart ?? null,
  };
}
