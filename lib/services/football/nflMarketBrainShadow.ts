import {
  buildMarketBrainCaptureOnlyDecision,
  buildMarketBrainCase,
  numericFeature,
  type MarketBrainAvailability,
  type MarketBrainAxis,
  type MarketBrainCase,
  type MarketBrainMarket,
  type MarketBrainModality,
  type MarketBrainObservation,
  type MarketBrainSourceRole,
  type MarketBrainShadowDecision,
} from "@/lib/services/marketBrain/marketBrainContract";
import type {
  NflFullGameEvidenceLedger,
  NflFullGameEvidenceSignal,
} from "./nflFullGameEvidenceLedger";

export const NFL_MARKET_BRAIN_SHADOW_RELEASE =
  "nfl_market_brain_shadow_2026_10_26_r1_complete_ledger_adapter" as const;

export type NflMarketBrainShadow = {
  release: typeof NFL_MARKET_BRAIN_SHADOW_RELEASE;
  case: MarketBrainCase;
  decision: MarketBrainShadowDecision;
};

/**
 * Converts the complete NFL evidence ledger into the cross-sport Market Brain
 * contract. It has no production call site and cannot alter a forecast.
 */
export function buildNflMarketBrainShadow(args: {
  eventId: string;
  ledger: NflFullGameEvidenceLedger;
  targetMarket: MarketBrainCase["targetMarket"];
}): NflMarketBrainShadow {
  const targetExcludedMarket = targetExcludedMarketState(args.ledger);
  const marketBrainCase = buildMarketBrainCase({
    sport: "nfl",
    eventId: args.eventId,
    evaluatedAt: args.ledger.evaluatedAt,
    jointPrior: {
      homeMargin: args.ledger.finalAxes.homeMargin,
      total: args.ledger.finalAxes.total,
    },
    targetMarket: args.targetMarket,
    targetExcludedMarket,
    observations: args.ledger.signals.map((signal) => observation({
      eventId: args.eventId,
      ledger: args.ledger,
      signal,
    })),
  });
  return {
    release: NFL_MARKET_BRAIN_SHADOW_RELEASE,
    case: marketBrainCase,
    decision: buildMarketBrainCaptureOnlyDecision(marketBrainCase),
  };
}

function observation(args: {
  eventId: string;
  ledger: NflFullGameEvidenceLedger;
  signal: NflFullGameEvidenceSignal;
}): MarketBrainObservation {
  const { signal } = args;
  const market = signal.market as MarketBrainMarket;
  return {
    id: signal.id,
    sport: "nfl",
    eventId: args.eventId,
    market,
    axis: axis(signal),
    modality: modality(signal),
    source: signal.source,
    sourceRole: sourceRole(signal),
    observedAt: signal.observedAt,
    availability: availability(signal),
    direction: direction(signal),
    targetExcluded: signal.targetExcluded,
    exactLineMatched: signal.splitContext?.exactLineMatched ?? null,
    denominatorKnown: signal.splitContext?.denominatorKnown ?? null,
    features: {
      raw_value: numericFeature(signal.value),
      continuous_magnitude: numericFeature(signal.continuousMagnitude),
      opening_number: numericFeature(signal.marketObservation?.openingNumber),
      current_number: numericFeature(signal.marketObservation?.currentNumber),
      number_delta: numericFeature(signal.marketObservation?.numberDelta),
      opening_fair_probability: numericFeature(signal.marketObservation?.openingFairFirstProbability),
      current_fair_probability: numericFeature(signal.marketObservation?.currentFairFirstProbability),
      fair_probability_delta_pp: numericFeature(signal.marketObservation?.fairProbabilityDeltaPp),
      hold_delta_pp: numericFeature(signal.marketObservation?.holdDeltaPp),
      persistence_time_share: numericFeature(signal.marketPath?.persistenceTimeShare),
      reversal_magnitude: numericFeature(signal.marketPath?.reversalMagnitude),
      crossed_key_number_count: numericFeature(signal.marketPath?.crossedKeyNumbers.length),
      split_age_minutes: numericFeature(signal.splitContext?.ageMinutes),
      money_pct: numericFeature(signal.splitContext?.moneyPct),
      ticket_pct: numericFeature(signal.splitContext?.ticketPct),
      split_gap_pp: numericFeature(splitGap(signal)),
      books_used: numericFeature(signal.splitContext?.booksUsed),
      reportable_players: numericFeature(signal.availabilityContext?.reportablePlayers),
    },
    tags: tags(args.ledger, signal),
    provenance: {
      sourceRelease: args.ledger.release,
      sourceObservationId: signal.id,
    },
  };
}

function axis(signal: NflFullGameEvidenceSignal): MarketBrainAxis {
  return signal.market === "total" ? "total"
    : signal.market === "moneyline" || signal.market === "spread" ? "margin"
    : "context";
}

function modality(signal: NflFullGameEvidenceSignal): MarketBrainModality {
  if (signal.kind === "forecast_expert") return "forecast";
  if (signal.kind === "target_excluded_market") return "target_excluded_consensus";
  if (signal.kind === "book_trail") return "book_path";
  if (signal.kind === "split") return "split";
  if (signal.kind === "availability") return signal.source === "weather" ? "weather" : "availability";
  return "other_context";
}

function sourceRole(signal: NflFullGameEvidenceSignal): MarketBrainSourceRole {
  if (signal.kind === "forecast_expert") {
    return /player|availability/i.test(signal.source) ? "player_aware_model" : "independent_model";
  }
  if (signal.kind === "target_excluded_market") return "target_excluded_consensus";
  if (signal.kind === "book_trail") return signal.sourceClass === "named" ? "originating_book" : "retail_book";
  if (signal.kind === "split") {
    return signal.source === "public_consensus" ? "public_consensus" : "identified_sportsbook";
  }
  if (signal.kind === "availability") return "context_provider";
  return "unknown";
}

function availability(signal: NflFullGameEvidenceSignal): MarketBrainAvailability {
  if (signal.status === "usable") return "observed";
  if (signal.status === "stale") return "stale";
  if (signal.status === "future") return "future";
  if (signal.disposition === "identity_mismatch") return "identity_mismatch";
  return "unavailable";
}

function direction(signal: NflFullGameEvidenceSignal): -1 | 0 | 1 | null {
  return signal.side === "home" || signal.side === "over" ? 1
    : signal.side === "away" || signal.side === "under" ? -1
    : signal.status === "usable" ? 0 : null;
}

function splitGap(signal: NflFullGameEvidenceSignal) {
  const money = signal.splitContext?.moneyPct;
  const tickets = signal.splitContext?.ticketPct;
  return typeof money === "number" && typeof tickets === "number" ? money - tickets : null;
}

function tags(ledger: NflFullGameEvidenceLedger, signal: NflFullGameEvidenceSignal) {
  const values = [
    `kind:${signal.kind}`,
    `legacy_disposition:${signal.disposition}`,
    `influence:${signal.influenceClass}`,
    `reason:${signal.reason}`,
    signal.marketPath?.buybackToOpening ? "path:buyback_to_opening" : null,
    (signal.marketPath?.reversalMagnitude ?? 0) > 0 ? "path:reversal" : null,
    signal.marketPath?.moveOrder ? `move_order:${signal.marketPath.moveOrder}` : null,
    signal.splitContext ? `legacy_split_qualified:${signal.splitContext.qualifiedForDirection}` : null,
    signal.availabilityContext?.relativeToFirstMarketMove
      ? `availability_sequence:${signal.availabilityContext.relativeToFirstMarketMove}`
      : null,
    signal.market === "game" ? null : `market_resistance:${ledger.marketContexts[signal.market].resistance}`,
  ];
  return values.filter((value): value is string => value !== null).sort();
}

function targetExcludedMarketState(ledger: NflFullGameEvidenceLedger) {
  const target = (market: "moneyline" | "spread" | "total") => ledger.signals.find((signal) =>
    signal.kind === "target_excluded_market" && signal.market === market && signal.status === "usable");
  const moneyline = target("moneyline")?.value;
  const spread = target("spread")?.value;
  const total = target("total")?.value;
  return {
    homeMargin: typeof spread === "number" && Number.isFinite(spread) ? spread : null,
    total: typeof total === "number" && Number.isFinite(total) ? total : null,
    homeMoneylineFairProbability: typeof moneyline === "number" && Number.isFinite(moneyline) ? moneyline : null,
  };
}
