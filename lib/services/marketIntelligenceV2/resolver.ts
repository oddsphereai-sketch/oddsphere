import { americanToImpliedProb } from "../../streaming/lineDirection";
import type {
  MarketIntelligenceMarketType,
  MarketReadValidityStatus,
  MarketSplitObservationV2,
} from "../../types/domain/MarketIntelligenceV2";
import {
  deriveSharpRetailPriceFeatures,
  type MarketPriceFeatureRow,
} from "../marketAwareEngine/marketIntelligenceFeatures";

export type MarketReadLabel =
  | "Strong Market Support"
  | "Market Support"
  | "Slight Market Support"
  | "Model-Led"
  | "Slight Market Resistance"
  | "Market Resistance"
  | "Strong Market Resistance";

export type PriceObservationForResolver = {
  sportsbook: string;
  sharp_book: boolean;
  market_type: MarketIntelligenceMarketType;
  selection_key: string;
  american_price: number | null;
  no_vig_probability?: number | null;
  line: number | null;
  provider_timestamp: string | null;
  fetched_at: string;
};

export type SplitObservationForResolver = Pick<
  MarketSplitObservationV2,
  | "provider"
  | "source_book"
  | "source_type"
  | "market_type"
  | "selection_key"
  | "bets_pct"
  | "money_pct"
  | "market_line"
  | "market_price"
  | "split_line_basis"
  | "books_used"
  | "source_observed_at"
  | "fetched_at"
>;

export type MovementDirection = "support" | "resistance" | "neutral";

export type ExactLineEvidenceStatus =
  | "available"
  | "moneyline_line_not_required"
  | "missing_selected_price"
  | "missing_selected_line"
  | "missing_exact_line_price"
  | "stale_exact_line_price"
  | "post_start_exact_line_price";

export type ResolverEvidence = {
  exactLinePriceEvidence: {
    status: ExactLineEvidenceStatus;
    available: boolean;
    selectedLine: number | null;
    selectedPrice: number | null;
    observedLine: number | null;
    observedAmerican: number | null;
    observedAt: string | null;
    note: string;
  };
  marketMovementEvidence: {
    score: number;
    direction: "toward_pick" | "against_pick" | "none";
    directionRelativeToPick: MovementDirection;
    firstTrackedLine: number | null;
    firstTrackedPrice: number | null;
    currentLine: number | null;
    currentPrice: number | null;
    impliedDeltaPct: number | null;
    booksMovingWithPick: number;
    booksMovingAgainstPick: number;
    sharpBooksMovingWithPick: number;
    sharpBooksMovingAgainstPick: number;
    sharpBooksTracked: number;
    trackedBooks: number;
    observedAt: string | null;
    note: string;
  };
  price: {
    score: number;
    direction: "toward_pick" | "against_pick" | "none";
    openLine: number | null;
    openAmerican: number | null;
    currentLine: number | null;
    currentAmerican: number | null;
    openBasis: "provider_opener" | "first_tracked";
    impliedDeltaPct: number | null;
    booksMovingWithPick: number;
    booksMovingAgainstPick: number;
    trackedBooks: number;
    observedAt: string | null;
    note: string;
  };
  playbookConsensus: {
    score: number;
    betsPct: number | null;
    moneyPct: number | null;
    booksUsed: number | null;
    marketLine: number | null;
    marketPrice: number | null;
    lineBasis: "provider_explicit" | "paired_same_ingestion" | "unknown";
    observedAt: string | null;
    normalizationStatus: "unavailable" | "available";
    note: string;
  };
  sharpApiSourceSpecific: {
    score: number;
    sources: Array<{
      sourceBook: string;
      betsPct: number | null;
      moneyPct: number | null;
      sourceType: string;
      marketLine: number | null;
      marketPrice: number | null;
    }>;
    normalizationStatus: "unavailable" | "available";
    note: string;
  };
  sharpRetailPriceMap: {
    status: "available" | "missing_sharp" | "missing_retail" | "unavailable";
    sharpProbability: number | null;
    retailProbability: number | null;
    probabilityGap: number | null;
    sharpBookCount: number;
    retailBookCount: number;
    primaryRetailBookCount: number;
    secondaryRetailBookCount: number;
    retailConsensusQuality: "strong" | "standard" | "thin" | "unavailable";
    retailProbabilityRange: number | null;
    firstGroupToMove: "sharp" | "retail" | "simultaneous" | "none" | "unknown";
    sharpMove60m: number | null;
    retailMove60m: number | null;
    movementBreadth: number;
    freshnessMinutes: number | null;
    observedAt: string | null;
    signalRelativeToPick: "support" | "resistance" | "aligned" | "unavailable";
    reverseLineMovement: "support" | "resistance" | "none";
    note: string;
  };
  trace: {
    priceScore: number;
    playbookScore: number;
    sharpApiSplitScore: number;
    totalScore: number;
    normalizationStatus: "split_normalization_unavailable";
    qualityGates: string[];
    evidenceUsed: string[];
    evidenceRejected: string[];
    explanationReasonCodes: string[];
  };
};

export type MarketReadResolverInput = {
  marketType: MarketIntelligenceMarketType;
  selectionKey: string;
  selectedLine?: number | null;
  selectedPrice?: number | null;
  recommendationLockedAt?: string | null;
  splitObservations: readonly SplitObservationForResolver[];
  priceObservations: readonly PriceObservationForResolver[];
  asOf?: string;
  eventStartTime?: string | null;
  providerFailures?: readonly string[];
  maxEvidenceAgeMinutes?: number;
};

export type MarketReadResolverOutput = {
  score: number;
  label: MarketReadLabel | null;
  validityStatus: MarketReadValidityStatus;
  explanation: string | null;
  evidenceAsOf: string | null;
  evidence: ResolverEvidence;
};

type Timed = { provider_timestamp?: string | null; source_observed_at?: string | null; fetched_at: string };

const DEFAULT_MAX_EVIDENCE_AGE_MINUTES = 180;

function clampScore(n: number): number {
  if (n > 5) return 5;
  if (n < -5) return -5;
  return Math.round(n);
}

export function labelForMarketReadScore(score: number): MarketReadLabel {
  if (score >= 4) return "Strong Market Support";
  if (score >= 2) return "Market Support";
  if (score === 1) return "Slight Market Support";
  if (score === -1) return "Slight Market Resistance";
  if (score <= -4) return "Strong Market Resistance";
  if (score <= -2) return "Market Resistance";
  return "Model-Led";
}

function obsIso(row: Timed): string {
  return row.provider_timestamp ?? row.source_observed_at ?? row.fetched_at;
}

function obsTimeMs(row: Timed): number {
  const t = Date.parse(obsIso(row));
  return Number.isFinite(t) ? t : 0;
}

function parseSide(selectionKey: string): "home" | "away" | "over" | "under" | null {
  const side = selectionKey.split(":").pop();
  return side === "home" || side === "away" || side === "over" || side === "under" ? side : null;
}

function stale(row: Timed, asOf: string | undefined, maxAgeMinutes: number): boolean {
  if (!asOf) return false;
  const a = Date.parse(asOf);
  const t = obsTimeMs(row);
  if (!Number.isFinite(a) || t === 0) return false;
  return a - t > maxAgeMinutes * 60_000;
}

function afterStart(row: Timed, eventStartTime: string | null | undefined): boolean {
  if (!eventStartTime) return false;
  const start = Date.parse(eventStartTime);
  const t = obsTimeMs(row);
  return Number.isFinite(start) && t > start;
}

function afterCutoff(row: Timed, cutoffIso: string | null | undefined): boolean {
  if (!cutoffIso) return false;
  const cutoff = Date.parse(cutoffIso);
  const t = obsTimeMs(row);
  return Number.isFinite(cutoff) && t > cutoff;
}

function samePriceState(a: PriceObservationForResolver, b: PriceObservationForResolver): boolean {
  return a.line === b.line && a.american_price === b.american_price;
}

function sameLine(a: number | null | undefined, b: number | null | undefined): boolean {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 0.001;
}

function lineMovementDirection(
  market: MarketIntelligenceMarketType,
  side: "home" | "away" | "over" | "under" | null,
  firstLine: number | null,
  lastLine: number | null,
): MovementDirection {
  if (firstLine === null || lastLine === null || Math.abs(lastLine - firstLine) < 0.001) return "neutral";
  if (market === "total") {
    if (side === "over") return lastLine > firstLine ? "support" : "resistance";
    if (side === "under") return lastLine < firstLine ? "support" : "resistance";
  }
  if (market === "spread") {
    return lastLine < firstLine ? "support" : "resistance";
  }
  return "neutral";
}

function priceMovementDirection(first: number | null, last: number | null): MovementDirection {
  const a = americanToImpliedProb(first);
  const b = americanToImpliedProb(last);
  if (a === null || b === null) return "neutral";
  const delta = b - a;
  if (Math.abs(delta) < 0.005) return "neutral";
  return delta > 0 ? "support" : "resistance";
}

function movementDirectionForState(
  market: MarketIntelligenceMarketType,
  side: "home" | "away" | "over" | "under" | null,
  first: PriceObservationForResolver,
  last: PriceObservationForResolver,
): MovementDirection {
  if (market === "moneyline") return priceMovementDirection(first.american_price, last.american_price);
  const lineDirection = lineMovementDirection(market, side, first.line, last.line);
  return lineDirection === "neutral"
    ? priceMovementDirection(first.american_price, last.american_price)
    : lineDirection;
}

function movementMagnitude(
  market: MarketIntelligenceMarketType,
  first: PriceObservationForResolver,
  last: PriceObservationForResolver,
): number {
  if (market !== "moneyline" && first.line !== null && last.line !== null && first.line !== last.line) {
    return Math.abs(last.line - first.line);
  }
  const a = americanToImpliedProb(first.american_price);
  const b = americanToImpliedProb(last.american_price);
  return a !== null && b !== null ? Math.abs(b - a) : 0;
}

function mainLineRank(row: PriceObservationForResolver): number {
  const implied = americanToImpliedProb(row.american_price);
  return implied === null ? Number.POSITIVE_INFINITY : Math.abs(implied - 0.5);
}

function representativeMovementRows(
  rows: readonly PriceObservationForResolver[],
  market: MarketIntelligenceMarketType,
): PriceObservationForResolver[] {
  if (market === "moneyline") return [...rows];
  const byBookTime = new Map<string, PriceObservationForResolver>();
  for (const row of rows) {
    const key = `${row.sportsbook}:${obsIso(row)}`;
    const prev = byBookTime.get(key);
    if (!prev) {
      byBookTime.set(key, row);
      continue;
    }
    const prevRank = mainLineRank(prev);
    const nextRank = mainLineRank(row);
    if (nextRank < prevRank) byBookTime.set(key, row);
  }
  return [...byBookTime.values()];
}

function scoreFromMovement(
  market: MarketIntelligenceMarketType,
  direction: MovementDirection,
  magnitude: number,
  breadth: number,
): number {
  if (direction === "neutral") return 0;
  let raw = 0;
  if (market === "moneyline") {
    if (magnitude >= 0.03 && breadth >= 0.6) raw = 3;
    else if (magnitude >= 0.02) raw = 2;
    else if (magnitude >= 0.01) raw = 1;
  } else {
    if (magnitude >= 1 && breadth >= 0.6) raw = 3;
    else if (magnitude >= 0.5) raw = 2;
    else if (magnitude > 0) raw = 1;
  }
  return direction === "support" ? raw : -raw;
}

function latestSplit(
  rows: readonly SplitObservationForResolver[],
  predicate: (row: SplitObservationForResolver) => boolean,
): SplitObservationForResolver | null {
  const candidates = rows.filter(predicate);
  candidates.sort((a, b) => Date.parse(b.fetched_at) - Date.parse(a.fetched_at));
  return candidates[0] ?? null;
}

function resolveExactLinePriceEvidence(input: {
  rows: readonly PriceObservationForResolver[];
  market: MarketIntelligenceMarketType;
  selectedLine?: number | null;
  selectedPrice?: number | null;
}): ResolverEvidence["exactLinePriceEvidence"] {
  if (input.selectedPrice === null || input.selectedPrice === undefined) {
    return {
      status: "missing_selected_price",
      available: false,
      selectedLine: input.selectedLine ?? null,
      selectedPrice: input.selectedPrice ?? null,
      observedLine: null,
      observedAmerican: null,
      observedAt: null,
      note: "Recommendation selected price is missing.",
    };
  }
  if (input.market !== "moneyline" && (input.selectedLine === null || input.selectedLine === undefined)) {
    return {
      status: "missing_selected_line",
      available: false,
      selectedLine: input.selectedLine ?? null,
      selectedPrice: input.selectedPrice,
      observedLine: null,
      observedAmerican: null,
      observedAt: null,
      note: "Recommendation selected line is missing.",
    };
  }

  const exact = input.rows
    .filter((row) => {
      if (input.market === "moneyline") return row.american_price !== null;
      return sameLine(row.line, input.selectedLine) && row.american_price !== null;
    })
    .sort((a, b) => obsTimeMs(b) - obsTimeMs(a));
  const row = exact[0] ?? null;
  if (!row) {
    return {
      status: "missing_exact_line_price",
      available: false,
      selectedLine: input.selectedLine ?? null,
      selectedPrice: input.selectedPrice,
      observedLine: null,
      observedAmerican: null,
      observedAt: null,
      note: input.market === "moneyline"
        ? "No same-selection moneyline price evidence is available."
        : "No price evidence is available at the exact selected line.",
    };
  }

  return {
    status: input.market === "moneyline" ? "moneyline_line_not_required" : "available",
    available: true,
    selectedLine: input.selectedLine ?? null,
    selectedPrice: input.selectedPrice,
    observedLine: row.line,
    observedAmerican: row.american_price,
    observedAt: obsIso(row),
    note: input.market === "moneyline"
      ? "Moneyline exact-line evidence does not require a line value."
      : "Exact selected-line price evidence is available.",
  };
}

function resolveMarketMovementEvidence(
  rows: readonly PriceObservationForResolver[],
  market: MarketIntelligenceMarketType,
  side: "home" | "away" | "over" | "under" | null,
): ResolverEvidence["marketMovementEvidence"] {
  const usable = representativeMovementRows(rows, market)
    .filter((r) => r.american_price !== null || r.line !== null)
    .sort((a, b) => obsTimeMs(a) - obsTimeMs(b));
  if (usable.length === 0) {
    return {
      score: 0,
      direction: "none",
      directionRelativeToPick: "neutral",
      firstTrackedLine: null,
      firstTrackedPrice: null,
      currentLine: null,
      currentPrice: null,
      impliedDeltaPct: null,
      booksMovingWithPick: 0,
      booksMovingAgainstPick: 0,
      sharpBooksMovingWithPick: 0,
      sharpBooksMovingAgainstPick: 0,
      sharpBooksTracked: 0,
      trackedBooks: 0,
      observedAt: null,
      note: "No usable price observations.",
    };
  }

  const byBook = new Map<string, PriceObservationForResolver[]>();
  for (const row of usable) {
    const list = byBook.get(row.sportsbook) ?? [];
    list.push(row);
    byBook.set(row.sportsbook, list);
  }

  let withPick = 0;
  let againstPick = 0;
  let tracked = 0;
  let sharpWithPick = 0;
  let sharpAgainstPick = 0;
  let sharpTracked = 0;
  let bestFirst: PriceObservationForResolver | null = null;
  let bestLast: PriceObservationForResolver | null = null;
  let bestDirection: MovementDirection = "neutral";
  let bestMagnitude = 0;

  for (const list of byBook.values()) {
    list.sort((a, b) => obsTimeMs(a) - obsTimeMs(b));
    const first = list[0] ?? null;
    const last = [...list].reverse().find((r) => first !== null && !samePriceState(first, r)) ?? null;
    if (!first || !last) continue;
    const direction = movementDirectionForState(market, side, first, last);
    const magnitude = movementMagnitude(market, first, last);
    if (market !== "moneyline" && (first.line === null || last.line === null || sameLine(first.line, last.line))) {
      continue;
    }
    tracked++;
    if (direction === "support") withPick++;
    else if (direction === "resistance") againstPick++;
    if (first.sharp_book || last.sharp_book) {
      sharpTracked++;
      if (direction === "support") sharpWithPick++;
      else if (direction === "resistance") sharpAgainstPick++;
    }

    const prefer = first.sharp_book && !bestFirst?.sharp_book;
    if (bestFirst === null || prefer || (first.sharp_book === bestFirst.sharp_book && magnitude > bestMagnitude)) {
      bestFirst = first;
      bestLast = last;
      bestDirection = direction;
      bestMagnitude = magnitude;
    }
  }

  if (!bestFirst || !bestLast) {
    const only = usable[usable.length - 1] ?? usable[0]!;
    return {
      score: 0,
      direction: "none",
      directionRelativeToPick: "neutral",
      firstTrackedLine: only.line,
      firstTrackedPrice: only.american_price,
      currentLine: only.line,
      currentPrice: only.american_price,
      impliedDeltaPct: null,
      booksMovingWithPick: 0,
      booksMovingAgainstPick: 0,
      sharpBooksMovingWithPick: 0,
      sharpBooksMovingAgainstPick: 0,
      sharpBooksTracked: 0,
      trackedBooks: new Set(usable.map((r) => r.sportsbook)).size,
      observedAt: obsIso(only),
      note: "Not enough distinct price states yet.",
    };
  }

  const supportBreadth = tracked > 0 ? withPick / tracked : 0;
  const resistanceBreadth = tracked > 0 ? againstPick / tracked : 0;
  const breadth = bestDirection === "resistance" ? resistanceBreadth : supportBreadth;
  const score = scoreFromMovement(market, bestDirection, bestMagnitude, breadth);
  const firstProb = americanToImpliedProb(bestFirst.american_price);
  const lastProb = americanToImpliedProb(bestLast.american_price);
  const impliedDeltaPct =
    firstProb !== null && lastProb !== null ? +((lastProb - firstProb) * 100).toFixed(2) : null;

  return {
    score,
    direction: score > 0 ? "toward_pick" : score < 0 ? "against_pick" : "none",
    directionRelativeToPick: bestDirection,
    firstTrackedLine: bestFirst.line,
    firstTrackedPrice: bestFirst.american_price,
    currentLine: bestLast.line,
    currentPrice: bestLast.american_price,
    impliedDeltaPct,
    booksMovingWithPick: withPick,
    booksMovingAgainstPick: againstPick,
    sharpBooksMovingWithPick: sharpWithPick,
    sharpBooksMovingAgainstPick: sharpAgainstPick,
    sharpBooksTracked: sharpTracked,
    trackedBooks: tracked,
    observedAt: obsIso(bestLast),
    note:
      score === 0
        ? "Price action has not established a meaningful direction."
        : score > 0
          ? "Market-maker pricing has moved toward the selected side."
          : "Market-maker pricing has moved against the selected side.",
  };
}

function legacyPriceEvidenceFromMovement(
  movement: ResolverEvidence["marketMovementEvidence"],
): ResolverEvidence["price"] {
  return {
    score: movement.score,
    direction: movement.direction,
    openLine: movement.firstTrackedLine,
    openAmerican: movement.firstTrackedPrice,
    currentLine: movement.currentLine,
    currentAmerican: movement.currentPrice,
    openBasis: "first_tracked",
    impliedDeltaPct: movement.impliedDeltaPct,
    booksMovingWithPick: movement.booksMovingWithPick,
    booksMovingAgainstPick: movement.booksMovingAgainstPick,
    trackedBooks: movement.trackedBooks,
    observedAt: movement.observedAt,
    note: movement.note,
  };
}

function resolvePlaybookEvidence(rows: readonly SplitObservationForResolver[]): ResolverEvidence["playbookConsensus"] {
  const row = latestSplit(rows, (r) => r.provider === "playbook" && r.source_book === "consensus");
  return {
    score: 0,
    betsPct: row?.bets_pct ?? null,
    moneyPct: row?.money_pct ?? null,
    booksUsed: row?.books_used ?? null,
    marketLine: row?.market_line ?? null,
    marketPrice: row?.market_price ?? null,
    lineBasis: row?.split_line_basis ?? "unknown",
    observedAt: row ? row.source_observed_at ?? row.fetched_at : null,
    normalizationStatus: "unavailable",
    note: row
      ? "Consensus split captured as factual context; scoring waits for source-specific normalization."
      : "No quality-approved consensus split captured yet.",
  };
}

function resolveSharpApiSourceEvidence(rows: readonly SplitObservationForResolver[]): ResolverEvidence["sharpApiSourceSpecific"] {
  const latestBySource = new Map<string, SplitObservationForResolver>();
  for (const row of rows.filter((r) => r.provider === "sharpapi")) {
    const prev = latestBySource.get(row.source_book);
    if (!prev || Date.parse(row.fetched_at) > Date.parse(prev.fetched_at)) {
      latestBySource.set(row.source_book, row);
    }
  }
  const sources = [...latestBySource.values()].map((row) => ({
    sourceBook: row.source_book,
    betsPct: row.bets_pct,
    moneyPct: row.money_pct,
    sourceType: row.source_type,
    marketLine: row.market_line,
    marketPrice: row.market_price,
  }));
  return {
    score: 0,
    sources,
    normalizationStatus: "unavailable",
    note: sources.length > 0
      ? "Source-specific splits captured as calibration context; scoring waits for source-specific normalization."
      : "No source-specific split evidence captured yet.",
  };
}

function resolveSharpRetailPriceMap(args: {
  rows: readonly PriceObservationForResolver[];
  market: MarketIntelligenceMarketType;
  selectedLine?: number | null;
  asOf?: string;
  consensus: ResolverEvidence["playbookConsensus"];
  movement: ResolverEvidence["marketMovementEvidence"];
}): ResolverEvidence["sharpRetailPriceMap"] {
  const comparable = args.rows.filter((row) =>
    typeof row.no_vig_probability === "number" && Number.isFinite(row.no_vig_probability) && (
      args.market === "moneyline" || sameLine(row.line, args.selectedLine)
    ));
  const toFeature = (row: PriceObservationForResolver): MarketPriceFeatureRow => ({
    sportsbook: row.sportsbook,
    sharpBook: row.sharp_book,
    marketType: row.market_type,
    selectionKey: row.selection_key,
    line: row.line,
    americanPrice: row.american_price,
    noVigProbability: row.no_vig_probability ?? null,
    providerTimestamp: row.provider_timestamp,
    fetchedAt: row.fetched_at,
  });
  const current = deriveSharpRetailPriceFeatures(comparable.map(toFeature), args.asOf ?? null);
  const movement = deriveSharpRetailPriceFeatures(args.rows.map(toFeature), args.asOf ?? null);
  const status = current.sharpBookCount < 1
    ? "missing_sharp"
    : current.retailBookCount < 1
      ? "missing_retail"
      : current.sharpRetailProbabilityGap === null
        ? "unavailable"
        : "available";
  const observedAt = comparable
    .map(obsIso)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const probabilityGap = current.sharpRetailProbabilityGap;
  const signalRelativeToPick = status !== "available" || probabilityGap === null
    ? "unavailable"
    : probabilityGap >= 0.005
      ? "support"
      : probabilityGap <= -0.005
        ? "resistance"
        : "aligned";
  const tickets = args.consensus.betsPct;
  const sharpMovementSupports = args.movement.sharpBooksMovingWithPick > args.movement.sharpBooksMovingAgainstPick
    && args.movement.sharpBooksMovingWithPick > 0;
  const sharpMovementResists = args.movement.sharpBooksMovingAgainstPick > args.movement.sharpBooksMovingWithPick
    && args.movement.sharpBooksMovingAgainstPick > 0;
  const reverseLineMovement = typeof tickets !== "number"
    ? "none"
    : tickets <= 0.4 && args.movement.directionRelativeToPick === "support" && sharpMovementSupports
      ? "support"
      : tickets >= 0.6 && args.movement.directionRelativeToPick === "resistance" && sharpMovementResists
        ? "resistance"
        : "none";
  return {
    status,
    sharpProbability: current.medianSharpNoVigProbability,
    retailProbability: current.medianRetailNoVigProbability,
    probabilityGap,
    sharpBookCount: current.sharpBookCount,
    retailBookCount: current.retailBookCount,
    primaryRetailBookCount: current.primaryRetailBookCount,
    secondaryRetailBookCount: current.secondaryRetailBookCount,
    retailConsensusQuality: current.retailConsensusQuality,
    retailProbabilityRange: current.retailProbabilityRange,
    firstGroupToMove: movement.firstGroupToMove,
    sharpMove60m: movement.sharpMove60m,
    retailMove60m: movement.retailMove60m,
    movementBreadth: movement.bookMovementBreadth,
    freshnessMinutes: current.currentFreshnessMinutes,
    observedAt,
    signalRelativeToPick,
    reverseLineMovement,
    note: status === "available"
      ? "Exact-line sharp and retail price context is available."
      : "A comparable exact-line price pair is unavailable.",
  };
}

function explanationFor(score: number): { text: string; codes: string[] } {
  if (score >= 2) return { text: "Market-maker pricing has moved toward our projection.", codes: ["price_support"] };
  if (score === 1) return { text: "Market-maker pricing is showing slight support for our projection.", codes: ["price_slight_support"] };
  if (score <= -2) return { text: "Market-maker pricing has moved against this side despite the model edge.", codes: ["price_resistance"] };
  if (score === -1) return { text: "Market-maker pricing is showing slight resistance to this side.", codes: ["price_slight_resistance"] };
  return {
    text: "Valid market-maker pricing is present, but it has not established a meaningful directional lean.",
    codes: ["valid_nondirectional_price"],
  };
}

export function resolveMarketReadV2(input: MarketReadResolverInput): MarketReadResolverOutput {
  const maxAge = input.maxEvidenceAgeMinutes ?? DEFAULT_MAX_EVIDENCE_AGE_MINUTES;
  const side = parseSide(input.selectionKey);
  const rejected: string[] = [];
  const evidenceCutoff = input.recommendationLockedAt ?? input.asOf ?? null;
  const splitRows = input.splitObservations.filter((r) => {
    if (r.market_type !== input.marketType || r.selection_key !== input.selectionKey) return false;
    if (afterStart(r, input.eventStartTime)) {
      rejected.push(`${r.provider}:${r.source_book}:post_start`);
      return false;
    }
    if (afterCutoff(r, evidenceCutoff)) {
      rejected.push(`${r.provider}:${r.source_book}:post_cutoff`);
      return false;
    }
    if (stale(r, input.asOf, maxAge)) {
      rejected.push(`${r.provider}:${r.source_book}:stale`);
      return false;
    }
    return true;
  });
  const sameSelectionPriceRows = input.priceObservations.filter((r) => {
    if (r.market_type !== input.marketType || r.selection_key !== input.selectionKey) return false;
    if (afterStart(r, input.eventStartTime)) {
      rejected.push(`${r.sportsbook}:post_start`);
      return false;
    }
    if (afterCutoff(r, evidenceCutoff)) {
      rejected.push(`${r.sportsbook}:post_cutoff`);
      return false;
    }
    if (stale(r, input.asOf, maxAge)) {
      rejected.push(`${r.sportsbook}:stale`);
      return false;
    }
    return true;
  });

  const exactLinePriceEvidence = resolveExactLinePriceEvidence({
    rows: sameSelectionPriceRows,
    market: input.marketType,
    selectedLine: input.selectedLine,
    selectedPrice: input.selectedPrice,
  });
  const marketMovementEvidence = resolveMarketMovementEvidence(sameSelectionPriceRows, input.marketType, side);
  const price = legacyPriceEvidenceFromMovement(marketMovementEvidence);
  const playbookConsensus = resolvePlaybookEvidence(splitRows);
  const sharpApiSourceSpecific = resolveSharpApiSourceEvidence(splitRows);
  const sharpRetailPriceMap = resolveSharpRetailPriceMap({
    rows: sameSelectionPriceRows,
    market: input.marketType,
    selectedLine: input.selectedLine,
    asOf: input.asOf,
    consensus: playbookConsensus,
    movement: marketMovementEvidence,
  });
  const score = clampScore(marketMovementEvidence.score + playbookConsensus.score + sharpApiSourceSpecific.score);
  const evidenceUsed: string[] = [];
  if (exactLinePriceEvidence.available) evidenceUsed.push("exact_line_price_context");
  if (marketMovementEvidence.trackedBooks > 0) evidenceUsed.push("sharpapi_price_movement");
  if (playbookConsensus.betsPct !== null || playbookConsensus.moneyPct !== null) evidenceUsed.push("playbook_consensus_context");
  if (sharpApiSourceSpecific.sources.length > 0) evidenceUsed.push("sharpapi_source_specific_context");
  if (sharpRetailPriceMap.status === "available") evidenceUsed.push("sharp_retail_exact_line_price_map_context");
  const hasDirectionalMovement =
    marketMovementEvidence.trackedBooks > 0 && marketMovementEvidence.directionRelativeToPick !== "neutral";

  let validityStatus: MarketReadValidityStatus;
  if ((input.providerFailures?.length ?? 0) > 0 && marketMovementEvidence.trackedBooks === 0 && !exactLinePriceEvidence.available) {
    validityStatus = "provider_failure";
  } else if (hasDirectionalMovement) {
    validityStatus = score === 0 ? "valid_nondirectional" : "valid_directional";
  } else if (exactLinePriceEvidence.available) {
    validityStatus = "valid_nondirectional";
  } else {
    validityStatus = rejected.some((r) => r.endsWith(":stale")) ? "stale_evidence" : "insufficient_evidence";
  }

  const valid = validityStatus === "valid_directional" || validityStatus === "valid_nondirectional";
  const explanation = valid ? explanationFor(score) : { text: null, codes: [validityStatus] };
  const evidenceAsOf = [
    marketMovementEvidence.observedAt,
    exactLinePriceEvidence.observedAt,
    playbookConsensus.observedAt,
    ...sharpApiSourceSpecific.sources.map(() => null),
  ]
    .filter((x): x is string => typeof x === "string")
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

  const evidence: ResolverEvidence = {
    exactLinePriceEvidence,
    marketMovementEvidence,
    price,
    playbookConsensus,
    sharpApiSourceSpecific,
    sharpRetailPriceMap,
    trace: {
      priceScore: marketMovementEvidence.score,
      playbookScore: playbookConsensus.score,
      sharpApiSplitScore: sharpApiSourceSpecific.score,
      totalScore: score,
      normalizationStatus: "split_normalization_unavailable",
      qualityGates: valid
        ? [
          exactLinePriceEvidence.status,
          marketMovementEvidence.trackedBooks > 0 ? "market_movement_evidence_valid" : "exact_line_price_context_only",
        ]
        : [exactLinePriceEvidence.status, validityStatus],
      evidenceUsed,
      evidenceRejected: rejected,
      explanationReasonCodes: valid ? explanation.codes : [exactLinePriceEvidence.status, validityStatus],
    },
  };

  return {
    score,
    label: valid ? labelForMarketReadScore(score) : null,
    validityStatus,
    explanation: explanation.text,
    evidenceAsOf,
    evidence,
  };
}
