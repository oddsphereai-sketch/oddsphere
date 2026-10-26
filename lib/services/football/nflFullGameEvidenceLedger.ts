import { createHash } from "node:crypto";

import type {
  NflForwardPlaybookSplit,
  NflForwardPlaybookSplitSet,
} from "./nflForwardEvidence";
import type { NflMarketState, NflMarketStateMarket, NflMarketStateSide } from "./nflMarketState";
import type { NflRegularSharpSplit, NflRegularSharpSplitSet } from "./sharpApiNflSplits";
import type { NflV1WeekOneOutcomeForecast } from "./nflV1WeekOneOutcome";

export const NFL_FULL_GAME_EVIDENCE_LEDGER_RELEASE =
  "nfl_full_game_evidence_ledger_2026_10_26_r3_interpretable_market_path" as const;

type Market = NflMarketStateMarket;
type Disposition = "supports" | "resists" | "uncertainty" | "stale" | "identity_mismatch" | "unavailable";
type SignalStatus = "usable" | "stale" | "future" | "unavailable";

export type NflFullGameEvidenceSignal = {
  id: string;
  kind: "forecast_expert" | "target_excluded_market" | "book_trail" | "split" | "availability";
  market: Market | "game";
  source: string;
  targetExcluded: boolean | null;
  observedAt: string | null;
  status: SignalStatus;
  side: "home" | "away" | "over" | "under" | null;
  value: number | null;
  continuousMagnitude: number | null;
  sourceClass?: "named" | "retail" | null;
  marketObservation?: {
    openingAt: string;
    currentAt: string;
    firstNumberMoveAt: string | null;
    firstPriceMoveAt: string | null;
    lastEconomicMoveAt: string | null;
    openingNumber: number | null;
    currentNumber: number | null;
    numberDelta: number | null;
    openingFairFirstProbability: number;
    currentFairFirstProbability: number;
    fairProbabilityDeltaPp: number;
    holdDeltaPp: number;
    numberDirection: NflMarketStateSide | null;
    priceDirection: NflMarketStateSide | null;
  } | null;
  marketPath?: {
    persistenceTimeShare: number;
    reversalMagnitude: number;
    buybackToOpening: boolean;
    moveOrder: NflMarketState["trails"][number]["moveOrder"];
    crossedKeyNumbers: number[];
  } | null;
  splitContext?: {
    ageMinutes: number | null;
    moneyPct: number | null;
    ticketPct: number | null;
    booksUsed: number | null;
    exactLineMatched: boolean | null;
    denominatorKnown: false;
    qualifiedForDirection: boolean;
  } | null;
  availabilityContext?: {
    reportUpdatedAt: string | null;
    reportablePlayers: number | null;
    relativeToFirstMarketMove: "before" | "after" | "same_time" | "unknown";
    causalAttributionProven: false;
  } | null;
  disposition: Disposition;
  reason: string;
  submittedTo: "full_game_evidence_arbiter";
  influenceClass: "forecast_candidate" | "continuous_market_evidence" | "uncertainty" | "data_quality";
};

export type NflFullGameEvidenceLedger = {
  release: typeof NFL_FULL_GAME_EVIDENCE_LEDGER_RELEASE;
  evaluatedAt: string;
  finalAxes: {
    homeMargin: number;
    total: number;
    moneylineSide: "home" | "away" | null;
    spreadSide: "home" | "away" | null;
    totalSide: "over" | "under" | null;
  };
  marketContexts: Record<Market, {
    namedDirection: NflMarketStateSide | null;
    namedLeadCompletedAt: string | null;
    followerSources: string[];
    followerDelaysMinutes: number[];
    resistance: NflMarketState["resistance"];
  }>;
  signals: NflFullGameEvidenceSignal[];
  accounting: {
    captured: number;
    usable: number;
    accountedUsable: number;
    supports: number;
    resists: number;
    uncertainty: number;
    stale: number;
    unavailable: number;
    allUsableAccounted: boolean;
  };
};

type ForecastCandidate = {
  source: string;
  forecast: Pick<NflV1WeekOneOutcomeForecast, "expectedHomeScore" | "expectedAwayScore"> | null;
};

export function buildNflFullGameEvidenceLedger(args: {
  evaluatedAt: string;
  finalForecast: Pick<NflV1WeekOneOutcomeForecast, "expectedHomeScore" | "expectedAwayScore">;
  currentSpreadBoundary: number | null;
  currentTotalLine: number | null;
  targetExcludedMarket: {
    homeMargin: number;
    total: number;
    moneylineHomeFairProbability: number;
    spreadHomeFairProbability: number;
    totalOverFairProbability: number;
    marginFamilyCount: number;
    totalFamilyCount: number;
  } | null;
  states: Record<Market, NflMarketState>;
  excludedFamiliesByMarket: Record<Market, string[]>;
  playbookSplits: NflForwardPlaybookSplitSet | null;
  sharpSplits: NflRegularSharpSplitSet | null;
  forecastCandidates: ForecastCandidate[];
  availability: {
    injuriesAvailable: boolean;
    injuryReportUpdatedAt: string | null;
    injuryPlayerCount: number | null;
    expectedQuarterbacksAvailable: boolean;
    playerAwareForecastAvailable: boolean;
    weatherAvailable: boolean;
  };
}): NflFullGameEvidenceLedger {
  const finalHomeMargin = args.finalForecast.expectedHomeScore - args.finalForecast.expectedAwayScore;
  const finalTotal = args.finalForecast.expectedHomeScore + args.finalForecast.expectedAwayScore;
  const finalSides: {
    moneyline: "home" | "away" | null;
    spread: "home" | "away" | null;
    total: "over" | "under" | null;
  } = {
    moneyline: sideName("moneyline", signOrNull(finalHomeMargin)),
    spread: args.currentSpreadBoundary === null
      ? null
      : sideName("spread", signOrNull(finalHomeMargin - args.currentSpreadBoundary)),
    total: args.currentTotalLine === null
      ? null
      : sideName("total", signOrNull(finalTotal - args.currentTotalLine)),
  };
  const signals: NflFullGameEvidenceSignal[] = [];

  for (const candidate of args.forecastCandidates) {
    if (!candidate.forecast) {
      signals.push(signal({
        kind: "forecast_expert", market: "game", source: candidate.source,
        targetExcluded: null,
        observedAt: null, status: "unavailable", side: null, value: null,
        continuousMagnitude: null, disposition: "unavailable",
        reason: "forecast_candidate_not_available", influenceClass: "data_quality",
      }));
      continue;
    }
    const margin = candidate.forecast.expectedHomeScore - candidate.forecast.expectedAwayScore;
    signals.push(signal({
      kind: "forecast_expert", market: "moneyline", source: candidate.source,
      targetExcluded: null,
      observedAt: args.evaluatedAt, status: "usable", side: sideName("moneyline", signOrNull(margin)),
      value: margin, continuousMagnitude: Math.abs(margin),
      disposition: disposition(sideName("moneyline", signOrNull(margin)), finalSides.moneyline),
      reason: "coherent_forecast_candidate_margin", influenceClass: "forecast_candidate",
    }));
    const total = candidate.forecast.expectedHomeScore + candidate.forecast.expectedAwayScore;
    signals.push(signal({
      kind: "forecast_expert", market: "total", source: candidate.source,
      targetExcluded: null,
      observedAt: args.evaluatedAt, status: "usable",
      side: args.currentTotalLine === null ? null : sideName("total", signOrNull(total - args.currentTotalLine)),
      value: total, continuousMagnitude: args.currentTotalLine === null ? null : Math.abs(total - args.currentTotalLine),
      disposition: disposition(
        args.currentTotalLine === null ? null : sideName("total", signOrNull(total - args.currentTotalLine)),
        finalSides.total,
      ),
      reason: args.currentTotalLine === null ? "current_total_line_unavailable" : "coherent_forecast_candidate_total",
      influenceClass: args.currentTotalLine === null ? "uncertainty" : "forecast_candidate",
    }));
  }

  if (args.targetExcludedMarket) {
    const market = args.targetExcludedMarket;
    signals.push(signal({
      kind: "target_excluded_market", market: "moneyline", source: "target_excluded_market_consensus",
      targetExcluded: true,
      observedAt: args.evaluatedAt, status: "usable",
      side: sideName("moneyline", signOrNull(market.moneylineHomeFairProbability - 0.5)),
      value: market.moneylineHomeFairProbability,
      continuousMagnitude: Math.abs(market.moneylineHomeFairProbability - 0.5),
      disposition: disposition(
        sideName("moneyline", signOrNull(market.moneylineHomeFairProbability - 0.5)),
        finalSides.moneyline,
      ),
      reason: `target_excluded_no_vig_market_${market.marginFamilyCount}_families`,
      influenceClass: "continuous_market_evidence",
    }));
    signals.push(signal({
      kind: "target_excluded_market", market: "spread", source: "target_excluded_market_consensus",
      targetExcluded: true,
      observedAt: args.evaluatedAt, status: "usable",
      side: args.currentSpreadBoundary === null
        ? null
        : sideName("spread", signOrNull(market.homeMargin - args.currentSpreadBoundary)),
      value: market.homeMargin,
      continuousMagnitude: args.currentSpreadBoundary === null
        ? null
        : Math.abs(market.homeMargin - args.currentSpreadBoundary),
      disposition: disposition(
        args.currentSpreadBoundary === null
          ? null
          : sideName("spread", signOrNull(market.homeMargin - args.currentSpreadBoundary)),
        finalSides.spread,
      ),
      reason: args.currentSpreadBoundary === null
        ? "current_spread_boundary_unavailable"
        : `target_excluded_spread_market_${market.marginFamilyCount}_families`,
      influenceClass: args.currentSpreadBoundary === null ? "uncertainty" : "continuous_market_evidence",
    }));
    signals.push(signal({
      kind: "target_excluded_market", market: "total", source: "target_excluded_market_consensus",
      targetExcluded: true,
      observedAt: args.evaluatedAt, status: "usable",
      side: args.currentTotalLine === null ? null : sideName("total", signOrNull(market.total - args.currentTotalLine)),
      value: market.total,
      continuousMagnitude: args.currentTotalLine === null ? null : Math.abs(market.total - args.currentTotalLine),
      disposition: disposition(
        args.currentTotalLine === null ? null : sideName("total", signOrNull(market.total - args.currentTotalLine)),
        finalSides.total,
      ),
      reason: args.currentTotalLine === null
        ? "current_total_line_unavailable"
        : `target_excluded_total_market_${market.totalFamilyCount}_families`,
      influenceClass: args.currentTotalLine === null ? "uncertainty" : "continuous_market_evidence",
    }));
  } else {
    signals.push(signal({
      kind: "target_excluded_market", market: "game", source: "target_excluded_market_consensus",
      targetExcluded: true,
      observedAt: null, status: "unavailable", side: null, value: null, continuousMagnitude: null,
      disposition: "unavailable", reason: "target_excluded_market_unavailable", influenceClass: "data_quality",
    }));
  }

  for (const market of ["moneyline", "spread", "total"] as const) {
    const state = args.states[market];
    const excluded = new Set(args.excludedFamiliesByMarket[market].map(normalizeBook));
    const finalSide = finalSides[market];
    for (const trail of state.trails) {
      const direction = sideName(market, trail.direction);
      const magnitude = market === "moneyline"
        ? Math.abs(trail.fairProbabilityDeltaPp) / 100
        : Math.abs(trail.numberDelta ?? 0);
      signals.push(signal({
        kind: "book_trail", market, source: trail.source, observedAt: trail.currentAt,
        targetExcluded: !excluded.has(normalizeBook(trail.source)),
        status: "usable", side: direction, value: trail.currentNumber ?? trail.currentFairFirstProbability,
        continuousMagnitude: magnitude,
        sourceClass: trail.sourceClass,
        marketObservation: {
          openingAt: trail.openingAt,
          currentAt: trail.currentAt,
          firstNumberMoveAt: trail.firstNumberMoveAt,
          firstPriceMoveAt: trail.firstPriceMoveAt,
          lastEconomicMoveAt: trail.lastEconomicMoveAt,
          openingNumber: trail.openingNumber,
          currentNumber: trail.currentNumber,
          numberDelta: trail.numberDelta,
          openingFairFirstProbability: trail.openingFairFirstProbability,
          currentFairFirstProbability: trail.currentFairFirstProbability,
          fairProbabilityDeltaPp: trail.fairProbabilityDeltaPp,
          holdDeltaPp: trail.holdDeltaPp,
          numberDirection: trail.numberDirection,
          priceDirection: trail.priceDirection,
        },
        marketPath: {
          persistenceTimeShare: trail.persistenceTimeShare,
          reversalMagnitude: trail.reversalMagnitude,
          buybackToOpening: trail.buybackToOpening,
          moveOrder: trail.moveOrder,
          crossedKeyNumbers: [...trail.crossedKeyNumbers],
        },
        disposition: disposition(direction, finalSide),
        reason: trail.direction === null
          ? trail.buybackToOpening ? "complete_buyback_or_return_to_opening" : "continuous_move_without_directional_materiality"
          : trail.reversalMagnitude > 0 ? "direction_with_material_reversal"
          : "continuous_opening_to_current_market_trail",
        influenceClass: trail.direction === null ? "uncertainty" : "continuous_market_evidence",
      }));
    }
    const splitCandidates: Array<{ source: string; value: NflForwardPlaybookSplit | NflRegularSharpSplit | null }> = [
      { source: "public_consensus", value: args.playbookSplits?.[market] ?? null },
      { source: normalizeBook(args.sharpSplits?.[market]?.sourceSportsbook ?? "sharp_split"), value: args.sharpSplits?.[market] ?? null },
    ];
    for (const candidate of splitCandidates) {
      if (!candidate.value) continue;
      const observedAt = "providerFetchedAt" in candidate.value
        ? candidate.value.providerFetchedAt ?? candidate.value.capturedAt
        : candidate.value.capturedAt;
      const ageMinutes = (Date.parse(args.evaluatedAt) - Date.parse(observedAt)) / 60_000;
      const gap = splitGap(candidate.value, market);
      const status: SignalStatus = !Number.isFinite(ageMinutes) ? "unavailable"
        : ageMinutes < 0 ? "future"
        : ageMinutes > 120 ? "stale"
        : "usable";
      const splitSide = gap === null ? null : sideName(market, signOrNull(gap));
      const moneyPct = market === "total" ? candidate.value.overMoneyPct : candidate.value.homeMoneyPct;
      const ticketPct = market === "total" ? candidate.value.overBetsPct : candidate.value.homeBetsPct;
      const isPublic = candidate.source === "public_consensus";
      const exactLineMatched = state.splits.find((item) => item.source === "public_consensus")?.exactLineMatched ?? null;
      const qualifiedForDirection = status === "usable" && gap !== null &&
        Math.abs(gap) >= (isPublic ? 8 : 10) && exactLineMatched !== false;
      signals.push(signal({
        kind: "split", market, source: candidate.source, observedAt,
        targetExcluded: candidate.source === "public_consensus" || !excluded.has(normalizeBook(candidate.source)),
        status, side: splitSide, value: gap, continuousMagnitude: gap === null ? null : Math.abs(gap),
        splitContext: {
          ageMinutes: Number.isFinite(ageMinutes) ? ageMinutes : null,
          moneyPct: typeof moneyPct === "number" ? moneyPct : null,
          ticketPct: typeof ticketPct === "number" ? ticketPct : null,
          booksUsed: "booksUsed" in candidate.value ? candidate.value.booksUsed : 1,
          exactLineMatched,
          denominatorKnown: false,
          qualifiedForDirection,
        },
        disposition: status === "stale" || status === "future" ? "stale"
          : status === "unavailable" ? "unavailable"
          : disposition(splitSide, finalSide),
        reason: gap === null ? "money_ticket_gap_unavailable"
          : status !== "usable" ? `split_${status}`
          : "continuous_money_minus_ticket_gap_denominator_unknown",
        influenceClass: status === "usable" && gap !== null ? "continuous_market_evidence" : "data_quality",
      }));
    }
  }

  const firstMarketMoveAt = earliestMarketMoveAt(args.states);
  for (const [source, available] of Object.entries({
    injuries: args.availability.injuriesAvailable,
    expected_quarterbacks: args.availability.expectedQuarterbacksAvailable,
    player_aware_forecast: args.availability.playerAwareForecastAvailable,
    weather: args.availability.weatherAvailable,
  })) {
    const reportUpdatedAt = source === "injuries" ? args.availability.injuryReportUpdatedAt : null;
    signals.push(signal({
      kind: "availability", market: "game", source, observedAt: reportUpdatedAt ?? args.evaluatedAt,
      targetExcluded: null,
      status: available ? "usable" : "unavailable", side: null, value: available ? 1 : 0,
      continuousMagnitude: null, disposition: "uncertainty",
      reason: available ? `${source}_available_for_context` : `${source}_unavailable`,
      availabilityContext: {
        reportUpdatedAt,
        reportablePlayers: source === "injuries" ? args.availability.injuryPlayerCount : null,
        relativeToFirstMarketMove: timingRelation(reportUpdatedAt, firstMarketMoveAt),
        causalAttributionProven: false,
      },
      influenceClass: available ? "uncertainty" : "data_quality",
    }));
  }

  const usable = signals.filter((item) => item.status === "usable");
  const accountedUsable = usable.filter((item) => item.submittedTo === "full_game_evidence_arbiter");
  return {
    release: NFL_FULL_GAME_EVIDENCE_LEDGER_RELEASE,
    evaluatedAt: args.evaluatedAt,
    finalAxes: {
      homeMargin: finalHomeMargin,
      total: finalTotal,
      moneylineSide: finalSides.moneyline,
      spreadSide: finalSides.spread,
      totalSide: finalSides.total,
    },
    marketContexts: Object.fromEntries(([
      "moneyline", "spread", "total",
    ] as const).map((market) => [market, {
      namedDirection: args.states[market].namedDirection,
      namedLeadCompletedAt: args.states[market].namedLeadCompletedAt,
      followerSources: [...args.states[market].followerSources],
      followerDelaysMinutes: [...args.states[market].followerDelaysMinutes],
      resistance: args.states[market].resistance,
    }])) as NflFullGameEvidenceLedger["marketContexts"],
    signals,
    accounting: {
      captured: signals.length,
      usable: usable.length,
      accountedUsable: accountedUsable.length,
      supports: signals.filter((item) => item.disposition === "supports").length,
      resists: signals.filter((item) => item.disposition === "resists").length,
      uncertainty: signals.filter((item) => item.disposition === "uncertainty").length,
      stale: signals.filter((item) => item.disposition === "stale").length,
      unavailable: signals.filter((item) => item.disposition === "unavailable").length,
      allUsableAccounted: usable.length === accountedUsable.length,
    },
  };
}

function signal(value: Omit<NflFullGameEvidenceSignal, "id" | "submittedTo">): NflFullGameEvidenceSignal {
  return {
    ...value,
    id: createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16),
    submittedTo: "full_game_evidence_arbiter",
  };
}

function splitGap(value: NflForwardPlaybookSplit | NflRegularSharpSplit, market: Market): number | null {
  const money = market === "total" ? value.overMoneyPct : value.homeMoneyPct;
  const bets = market === "total" ? value.overBetsPct : value.homeBetsPct;
  return typeof money === "number" && typeof bets === "number" ? money - bets : null;
}

function disposition(
  signalSide: NflFullGameEvidenceSignal["side"],
  finalSide: NflFullGameEvidenceSignal["side"],
): Disposition {
  if (signalSide === null || finalSide === null) return "uncertainty";
  return signalSide === finalSide ? "supports" : "resists";
}

function sideName(
  market: "moneyline" | "spread",
  side: NflMarketStateSide | null,
): "home" | "away" | null;
function sideName(market: "total", side: NflMarketStateSide | null): "over" | "under" | null;
function sideName(
  market: Market,
  side: NflMarketStateSide | null,
): "home" | "away" | "over" | "under" | null;
function sideName(market: Market, side: NflMarketStateSide | null) {
  if (side === null) return null;
  return market === "total" ? side === 1 ? "over" as const : "under" as const
    : side === 1 ? "home" as const : "away" as const;
}

function signOrNull(value: number): NflMarketStateSide | null {
  return !Number.isFinite(value) || value === 0 ? null : value > 0 ? 1 : -1;
}

function normalizeBook(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "") || "unknown_split";
}

function earliestMarketMoveAt(states: Record<Market, NflMarketState>) {
  const values = Object.values(states).flatMap((state) => state.trails.flatMap((trail) =>
    [trail.firstNumberMoveAt, trail.firstPriceMoveAt].filter((value): value is string => value !== null)));
  return values.sort()[0] ?? null;
}

function timingRelation(first: string | null, second: string | null) {
  if (!first || !second) return "unknown" as const;
  const delta = Date.parse(first) - Date.parse(second);
  if (!Number.isFinite(delta)) return "unknown" as const;
  if (Math.abs(delta) < 60_000) return "same_time" as const;
  return delta < 0 ? "before" as const : "after" as const;
}
