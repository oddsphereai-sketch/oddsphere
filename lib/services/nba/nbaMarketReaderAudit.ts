import type { MarketIntelligenceMarketType } from "../../types/domain/MarketIntelligenceV2";
import {
  resolveMarketReadV2,
  type MarketReadResolverOutput,
  type PriceObservationForResolver,
  type SplitObservationForResolver,
} from "../marketIntelligenceV2/resolver";

export const NBA_MARKET_READER_AUDIT_RELEASE =
  "nba_market_reader_audit_2026_10_15_r1_shared_v2_observation_only" as const;

export type NbaMarketAuditEvent = {
  canonicalEventId: string;
  startTime: string | null;
};

export type NbaMarketAuditSplitRow = SplitObservationForResolver & {
  canonical_event_id: string;
};

export type NbaMarketAuditPriceRow = PriceObservationForResolver & {
  canonical_event_id: string;
};

export type NbaMarketAuditCandidate = {
  canonicalEventId: string;
  marketType: MarketIntelligenceMarketType;
  selectionKey: string;
  selectedLine: number | null;
  selectedPrice: number | null;
  recommendationLockedAt: string | null;
  eventStartTime: string | null;
};

const MARKETS: MarketIntelligenceMarketType[] = ["moneyline", "spread", "total"];
const FRESH_MINUTES = 180;

function observedAt(row: NbaMarketAuditSplitRow | NbaMarketAuditPriceRow): string {
  if ("provider_timestamp" in row) return row.provider_timestamp ?? row.fetched_at;
  return row.source_observed_at ?? row.fetched_at;
}

function side(selectionKey: string): "home" | "away" | "over" | "under" | null {
  const value = selectionKey.split(":").at(-1);
  return value === "home" || value === "away" || value === "over" || value === "under"
    ? value
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function latestBySide(rows: NbaMarketAuditPriceRow[]): Map<string, NbaMarketAuditPriceRow> {
  const latest = new Map<string, NbaMarketAuditPriceRow>();
  for (const row of rows) {
    const key = side(row.selection_key);
    if (!key) continue;
    const prior = latest.get(key);
    if (!prior || Date.parse(observedAt(row)) >= Date.parse(observedAt(prior))) latest.set(key, row);
  }
  return latest;
}

function coherentPair(
  market: MarketIntelligenceMarketType,
  rows: NbaMarketAuditPriceRow[],
): boolean {
  const latest = latestBySide(rows);
  const first = latest.get(market === "total" ? "over" : "home");
  const second = latest.get(market === "total" ? "under" : "away");
  if (!first || !second || !finite(first.american_price) || !finite(second.american_price)) return false;
  if (market === "moneyline") return true;
  if (!finite(first.line) || !finite(second.line)) return false;
  return market === "total"
    ? Math.abs(first.line - second.line) < 1e-9
    : Math.abs(first.line + second.line) < 1e-9;
}

function ageMinutes(iso: string, asOfMs: number): number | null {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? (asOfMs - time) / 60_000 : null;
}

function pct(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100;
}

export function summarizeNbaMarketEvidence(args: {
  events: readonly NbaMarketAuditEvent[];
  splitRows: readonly NbaMarketAuditSplitRow[];
  priceRows: readonly NbaMarketAuditPriceRow[];
  asOf: string;
}): Record<string, unknown> {
  const eventIds = new Set(args.events.map((event) => event.canonicalEventId));
  const asOfMs = Date.parse(args.asOf);
  if (!Number.isFinite(asOfMs)) throw new Error("NBA market audit asOf is invalid.");

  const splitRows = args.splitRows.filter((row) => eventIds.has(String(row.canonical_event_id)));
  const priceRows = args.priceRows.filter((row) => eventIds.has(String(row.canonical_event_id)));
  const sources = new Map<string, NbaMarketAuditSplitRow[]>();
  for (const row of splitRows) {
    const key = `${row.provider}|${row.source_book}|${row.source_type}`;
    sources.set(key, [...(sources.get(key) ?? []), row]);
  }

  const sourceCoverage = [...sources.entries()].map(([source, rows]) => ({
    source,
    rows: rows.length,
    events: new Set(rows.map((row) => String(row.canonical_event_id))).size,
    ticketRows: rows.filter((row) => finite(row.bets_pct)).length,
    moneyRows: rows.filter((row) => finite(row.money_pct)).length,
    ticketOnlyRows: rows.filter((row) => finite(row.bets_pct) && !finite(row.money_pct)).length,
    sourceTimestampRows: rows.filter((row) => row.source_observed_at !== null).length,
    latestObservedAt: rows.map(observedAt).sort().at(-1) ?? null,
  })).sort((left, right) => left.source.localeCompare(right.source));

  const byMarket = Object.fromEntries(MARKETS.map((market) => {
    const marketSplits = splitRows.filter((row) => row.market_type === market);
    const marketPrices = priceRows.filter((row) => row.market_type === market);
    const priceGroups = new Map<string, NbaMarketAuditPriceRow[]>();
    const trails = new Map<string, NbaMarketAuditPriceRow[]>();
    for (const row of marketPrices) {
      const pairKey = `${row.canonical_event_id}|${row.sportsbook}`;
      priceGroups.set(pairKey, [...(priceGroups.get(pairKey) ?? []), row]);
      const trailKey = `${pairKey}|${row.selection_key}`;
      trails.set(trailKey, [...(trails.get(trailKey) ?? []), row]);
    }
    const coherentPairs = [...priceGroups.entries()].filter(([, rows]) => coherentPair(market, rows));
    const movementTrails = [...trails.entries()].filter(([, rows]) =>
      new Set(rows.map((row) => `${row.line ?? "null"}|${row.american_price ?? "null"}`)).size >= 2
    );
    const freshSplits = marketSplits.filter((row) => {
      const age = ageMinutes(observedAt(row), asOfMs);
      return age !== null && age >= 0 && age <= FRESH_MINUTES;
    });
    const freshPrices = marketPrices.filter((row) => {
      const age = ageMinutes(observedAt(row), asOfMs);
      return age !== null && age >= 0 && age <= FRESH_MINUTES;
    });
    return [market, {
      expectedEvents: eventIds.size,
      splitRows: marketSplits.length,
      splitEvents: new Set(marketSplits.map((row) => String(row.canonical_event_id))).size,
      splitEventCoveragePct: pct(
        new Set(marketSplits.map((row) => String(row.canonical_event_id))).size,
        eventIds.size,
      ),
      freshSplitRows: freshSplits.length,
      priceRows: marketPrices.length,
      priceEvents: new Set(marketPrices.map((row) => String(row.canonical_event_id))).size,
      priceBooks: [...new Set(marketPrices.map((row) => row.sportsbook))].sort(),
      freshPriceRows: freshPrices.length,
      coherentSameBookPairs: coherentPairs.length,
      coherentSameBookPairEvents: new Set(coherentPairs.map(([key]) => key.split("|")[0])).size,
      sameBookSelectionMovementTrails: movementTrails.length,
      sameBookMovementEvents: new Set(movementTrails.map(([key]) => key.split("|")[0])).size,
      openerStatus: "first_tracked_only",
    }];
  }));

  const sharpRows = splitRows.filter((row) => row.provider === "sharpapi");
  return {
    release: NBA_MARKET_READER_AUDIT_RELEASE,
    asOf: args.asOf,
    events: eventIds.size,
    splitRows: splitRows.length,
    priceRows: priceRows.length,
    sourceCoverage,
    markets: byMarket,
    integrity: {
      sharpApiRowsWithSourceBook: sharpRows.filter((row) =>
        typeof row.source_book === "string" && row.source_book.length > 0 && row.source_book !== "consensus"
      ).length,
      sharpApiRows: sharpRows.length,
      ticketOnlyRowsPreserved: splitRows.filter((row) => finite(row.bets_pct) && !finite(row.money_pct)).length,
      missingMoneyRowsImputed: 0,
      crossBookMovementAllowed: false,
      providerOpenerClaimAllowed: false,
    },
    authority: {
      observationOnly: true,
      predictionEffectAuthorized: false,
      gradeEffectAuthorized: false,
      reason: "NBA thresholds and incremental decision value have not cleared a complete point-in-time settled replay.",
    },
  };
}

export function evaluateNbaMarketCandidates(args: {
  candidates: readonly NbaMarketAuditCandidate[];
  splitRows: readonly NbaMarketAuditSplitRow[];
  priceRows: readonly NbaMarketAuditPriceRow[];
  asOf: string;
}): Array<NbaMarketAuditCandidate & { resolved: MarketReadResolverOutput }> {
  return args.candidates.map((candidate) => ({
    ...candidate,
    resolved: resolveMarketReadV2({
      marketType: candidate.marketType,
      selectionKey: candidate.selectionKey,
      selectedLine: candidate.selectedLine,
      selectedPrice: candidate.selectedPrice,
      recommendationLockedAt: candidate.recommendationLockedAt,
      eventStartTime: candidate.eventStartTime,
      asOf: args.asOf,
      splitObservations: args.splitRows.filter((row) =>
        String(row.canonical_event_id) === candidate.canonicalEventId
      ),
      priceObservations: args.priceRows.filter((row) =>
        String(row.canonical_event_id) === candidate.canonicalEventId
      ),
    }),
  }));
}
