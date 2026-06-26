import { createHash } from "crypto";
import type {
  PlaybookLineGame,
  PlaybookSplitGame,
  PlaybookSplitMarket,
} from "../../providers/playbook/types";
import type {
  CanonicalObservationRejection,
  MarketIntelligenceMarketType,
  MarketIntelligenceSelectionSide,
  MarketPriceObservationV2,
  MarketSplitLineBasis,
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

export type PlaybookPairedLine = {
  line: number | null;
  price: number | null;
  basis: MarketSplitLineBasis;
};

export function playbookLineForSelection(
  row: PlaybookLineGame | null | undefined,
  market: MarketIntelligenceMarketType,
  side: MarketIntelligenceSelectionSide,
): PlaybookPairedLine {
  if (!row?.lines) return { line: null, price: null, basis: "unknown" };
  if (market === "moneyline") {
    const raw = side === "home" ? row.lines.moneyline?.home : row.lines.moneyline?.away;
    return typeof raw === "number" && Number.isFinite(raw)
      ? { line: null, price: raw, basis: "paired_same_ingestion" }
      : { line: null, price: null, basis: "unknown" };
  }
  if (market === "spread") {
    const raw = side === "home" ? row.lines.spread?.home : row.lines.spread?.away;
    return typeof raw === "number" && Number.isFinite(raw)
      ? { line: raw, price: null, basis: "paired_same_ingestion" }
      : { line: null, price: null, basis: "unknown" };
  }
  const raw = row.lines.total;
  return typeof raw === "number" && Number.isFinite(raw)
    ? { line: raw, price: null, basis: "paired_same_ingestion" }
    : { line: null, price: null, basis: "unknown" };
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
  ingestionRunId?: string | null;
  pairedLine?: (market: MarketIntelligenceMarketType, side: MarketIntelligenceSelectionSide) => PlaybookPairedLine;
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
      const pairedLine = opts.pairedLine?.(market, v.side) ?? {
        line: null,
        price: null,
        basis: "unknown" as const,
      };
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
        market_line: pairedLine.line,
        market_price: pairedLine.price,
        split_line_basis: pairedLine.basis,
        books_used: rawMarket.source?.booksUsed ?? null,
        provider_event_id: providerEventId,
        source_observed_at: null,
        fetched_at: opts.fetchedAt,
        source_timestamp_verified: false,
        minutes_to_start: opts.minutesToStart ?? null,
        ingestion_run_id: opts.ingestionRunId ?? null,
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

export type RawSharpApiSplitHistoryMarketV2 = {
  bets_pct?: Record<string, unknown> | null;
  handle_pct?: Record<string, unknown> | null;
  away_odds?: unknown;
  home_odds?: unknown;
  away_line?: unknown;
  home_line?: unknown;
  line?: unknown;
};

export type RawSharpApiSplitHistoryRowV2 = {
  book?: string | null;
  timestamp?: number | string | null;
  ts?: string | null;
  moneyline?: RawSharpApiSplitHistoryMarketV2 | null;
  spread?: RawSharpApiSplitHistoryMarketV2 | null;
  total?: RawSharpApiSplitHistoryMarketV2 | null;
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
    return { source_book: "betmgm", source_type: "retail_ticket_share" };
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
  ingestionRunId?: string | null;
  canonicalMarketId: (market: MarketIntelligenceMarketType) => string;
  selectionKey: (market: MarketIntelligenceMarketType, side: MarketIntelligenceSelectionSide) => string;
}): CanonicalAdapterResult<MarketSplitObservationV2> {
  const observations: MarketSplitObservationV2[] = [];
  const rejected: CanonicalObservationRejection[] = [];
  const providerEventId = opts.row.event_id === null || opts.row.event_id === undefined
    ? null
    : String(opts.row.event_id);
  const source = classifySharpApiSplitSourceBook(opts.row.sportsbook);
  if (source.source_book === "betmgm") {
    return {
      observations,
      rejected: [reject("sharpapi", {
        providerEventId,
        market: null,
        selectionKey: null,
        reason: "BetMGM ticket-share rows require public_bet_pct adapter; generic handle_pct mapping disabled",
      })],
    };
  }
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
        split_line_basis: "provider_explicit",
        books_used: null,
        provider_event_id: providerEventId,
        source_observed_at: opts.row.fetched_at ?? null,
        fetched_at: opts.fetchedAt,
        source_timestamp_verified: opts.row.fetched_at !== null && opts.row.fetched_at !== undefined,
        minutes_to_start: opts.minutesToStart ?? null,
        ingestion_run_id: opts.ingestionRunId ?? null,
        raw_payload_hash: stablePayloadHash({ provider: "sharpapi", market, side: v.side, source: opts.row.sportsbook, rawMarket }),
      });
    }
  }

  return { observations, rejected };
}

function sharpApiHistoryMarket(
  row: RawSharpApiSplitHistoryRowV2,
  market: MarketIntelligenceMarketType,
): RawSharpApiSplitHistoryMarketV2 | null | undefined {
  return row[market];
}

function historyMarketLine(
  rawMarket: RawSharpApiSplitHistoryMarketV2,
  market: MarketIntelligenceMarketType,
  side: MarketIntelligenceSelectionSide,
): number | null {
  if (market === "moneyline") return null;
  if (market === "total") {
    return typeof rawMarket.line === "number" && Number.isFinite(rawMarket.line)
      ? rawMarket.line
      : null;
  }
  const raw = side === "home" ? rawMarket.home_line : rawMarket.away_line;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function historyMarketPrice(
  rawMarket: RawSharpApiSplitHistoryMarketV2,
  market: MarketIntelligenceMarketType,
  side: MarketIntelligenceSelectionSide,
): number | null {
  if (market !== "moneyline") return null;
  const raw = side === "home" ? rawMarket.home_odds : rawMarket.away_odds;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

export function sharpApiSplitHistoryObservedAt(row: RawSharpApiSplitHistoryRowV2): string | null {
  if (typeof row.ts === "string" && Number.isFinite(Date.parse(row.ts))) return row.ts;
  if (typeof row.timestamp === "number" && Number.isFinite(row.timestamp)) {
    const ms = row.timestamp > 9_999_999_999 ? row.timestamp : row.timestamp * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

export function buildSharpApiSplitHistoryObservationsV2(opts: {
  row: RawSharpApiSplitHistoryRowV2;
  providerEventId: string;
  canonicalEventId: string;
  league: string;
  fetchedAt: string;
  minutesToStart?: number | null;
  ingestionRunId?: string | null;
  canonicalMarketId: (market: MarketIntelligenceMarketType) => string;
  selectionKey: (market: MarketIntelligenceMarketType, side: MarketIntelligenceSelectionSide) => string;
}): CanonicalAdapterResult<MarketSplitObservationV2> {
  const observations: MarketSplitObservationV2[] = [];
  const rejected: CanonicalObservationRejection[] = [];
  const source = classifySharpApiSplitSourceBook(opts.row.book);
  if (source.source_book === null || source.source_type === null || source.source_book === "betmgm") {
    return {
      observations,
      rejected: [reject("sharpapi", {
        providerEventId: opts.providerEventId,
        market: null,
        selectionKey: null,
        reason: `unsupported SharpAPI split history book=${opts.row.book ?? "null"}`,
      })],
    };
  }

  const observedAt = sharpApiSplitHistoryObservedAt(opts.row);
  for (const market of Object.keys(MARKET_SIDES) as MarketIntelligenceMarketType[]) {
    const rawMarket = sharpApiHistoryMarket(opts.row, market);
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
        providerEventId: opts.providerEventId,
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
        provider: "sharpapi",
        source_book: source.source_book,
        source_type: source.source_type,
        bets_pct: v.bets,
        money_pct: v.money,
        market_line: historyMarketLine(rawMarket, market, v.side),
        market_price: historyMarketPrice(rawMarket, market, v.side),
        split_line_basis: "provider_explicit",
        books_used: null,
        provider_event_id: opts.providerEventId,
        source_observed_at: observedAt,
        fetched_at: opts.fetchedAt,
        source_timestamp_verified: observedAt !== null,
        minutes_to_start: opts.minutesToStart ?? null,
        ingestion_run_id: opts.ingestionRunId ?? null,
        raw_payload_hash: stablePayloadHash({
          provider: "sharpapi",
          history: true,
          market,
          side: v.side,
          source: opts.row.book,
          rawMarket,
          observedAt,
        }),
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
      source_type: "retail_ticket_share",
      bets_pct: bets,
      money_pct: null,
      market_line: opts.row.line ?? null,
      market_price: opts.row.odds_american ?? null,
      split_line_basis: "provider_explicit",
      books_used: null,
      provider_event_id: providerEventId,
      source_observed_at: opts.row.provider_timestamp ?? null,
      fetched_at: opts.fetchedAt,
      source_timestamp_verified: opts.row.provider_timestamp !== null && opts.row.provider_timestamp !== undefined,
      minutes_to_start: opts.minutesToStart ?? null,
      ingestion_run_id: null,
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
