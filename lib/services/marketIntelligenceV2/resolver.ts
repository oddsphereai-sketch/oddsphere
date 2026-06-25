import { americanToImpliedProb } from "../../streaming/lineDirection";
import type {
  MarketIntelligenceMarketType,
  MarketSplitObservationV2,
} from "../../types/domain/MarketIntelligenceV2";

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
  | "books_used"
  | "source_observed_at"
  | "fetched_at"
>;

export type ResolverEvidence = {
  price: {
    score: number;
    direction: "toward_pick" | "against_pick" | "none";
    openAmerican: number | null;
    currentAmerican: number | null;
    impliedDeltaPct: number | null;
    booksMovingWithPick: number;
    booksMovingAgainstPick: number;
    trackedBooks: number;
    note: string;
  };
  playbookConsensus: {
    score: number;
    betsPct: number | null;
    moneyPct: number | null;
    booksUsed: number | null;
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
    }>;
    normalizationStatus: "unavailable" | "available";
    note: string;
  };
};

export type MarketReadResolverInput = {
  marketType: MarketIntelligenceMarketType;
  selectionKey: string;
  splitObservations: readonly SplitObservationForResolver[];
  priceObservations: readonly PriceObservationForResolver[];
};

export type MarketReadResolverOutput = {
  score: number;
  label: MarketReadLabel;
  explanation: string;
  evidence: ResolverEvidence;
};

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

function obsTimeMs(row: { provider_timestamp?: string | null; fetched_at: string }): number {
  const raw = row.provider_timestamp ?? row.fetched_at;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function latestSplit(
  rows: readonly SplitObservationForResolver[],
  predicate: (row: SplitObservationForResolver) => boolean,
): SplitObservationForResolver | null {
  const candidates = rows.filter(predicate);
  candidates.sort((a, b) => Date.parse(b.fetched_at) - Date.parse(a.fetched_at));
  return candidates[0] ?? null;
}

function resolvePriceEvidence(rows: readonly PriceObservationForResolver[]): ResolverEvidence["price"] {
  const usable = rows
    .filter((r) => r.american_price !== null)
    .sort((a, b) => obsTimeMs(a) - obsTimeMs(b));
  if (usable.length < 2) {
    return {
      score: 0,
      direction: "none",
      openAmerican: usable[0]?.american_price ?? null,
      currentAmerican: usable[0]?.american_price ?? null,
      impliedDeltaPct: null,
      booksMovingWithPick: 0,
      booksMovingAgainstPick: 0,
      trackedBooks: new Set(usable.map((r) => r.sportsbook)).size,
      note: "Not enough distinct price observations yet.",
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
  let sharpDelta: number | null = null;
  let openAmerican: number | null = null;
  let currentAmerican: number | null = null;

  for (const list of byBook.values()) {
    list.sort((a, b) => obsTimeMs(a) - obsTimeMs(b));
    const first = list.find((r) => r.american_price !== null);
    const last = [...list].reverse().find((r) => r.american_price !== null);
    if (!first || !last || first.american_price === null || last.american_price === null) continue;
    if (first.american_price === last.american_price && list.length < 2) continue;
    const firstProb = americanToImpliedProb(first.american_price);
    const lastProb = americanToImpliedProb(last.american_price);
    if (firstProb === null || lastProb === null) continue;
    const delta = lastProb - firstProb;
    tracked++;
    if (delta >= 0.01) withPick++;
    else if (delta <= -0.01) againstPick++;

    if (first.sharp_book && sharpDelta === null) {
      sharpDelta = delta;
      openAmerican = first.american_price;
      currentAmerican = last.american_price;
    }
  }

  if (sharpDelta === null) {
    const first = usable[0]!;
    const last = usable[usable.length - 1]!;
    const firstProb = americanToImpliedProb(first.american_price);
    const lastProb = americanToImpliedProb(last.american_price);
    sharpDelta = firstProb !== null && lastProb !== null ? lastProb - firstProb : 0;
    openAmerican = first.american_price;
    currentAmerican = last.american_price;
  }

  const breadth = tracked > 0 ? withPick / tracked : 0;
  const againstBreadth = tracked > 0 ? againstPick / tracked : 0;
  let score = 0;
  if (sharpDelta >= 0.03 && breadth >= 0.6) score = 3;
  else if (sharpDelta >= 0.02) score = 2;
  else if (sharpDelta >= 0.01) score = 1;
  else if (sharpDelta <= -0.03 && againstBreadth >= 0.6) score = -3;
  else if (sharpDelta <= -0.02) score = -2;
  else if (sharpDelta <= -0.01) score = -1;

  return {
    score,
    direction: score > 0 ? "toward_pick" : score < 0 ? "against_pick" : "none",
    openAmerican,
    currentAmerican,
    impliedDeltaPct: sharpDelta === null ? null : +(sharpDelta * 100).toFixed(2),
    booksMovingWithPick: withPick,
    booksMovingAgainstPick: againstPick,
    trackedBooks: tracked,
    note:
      score === 0
        ? "Price action has not established a meaningful direction."
        : score > 0
          ? "Sharp-book pricing has moved toward the selected side."
          : "Sharp-book pricing has moved against the selected side.",
  };
}

function resolvePlaybookEvidence(rows: readonly SplitObservationForResolver[]): ResolverEvidence["playbookConsensus"] {
  const row = latestSplit(
    rows,
    (r) => r.provider === "playbook" && r.source_book === "consensus",
  );
  return {
    score: 0,
    betsPct: row?.bets_pct ?? null,
    moneyPct: row?.money_pct ?? null,
    booksUsed: row?.books_used ?? null,
    normalizationStatus: "unavailable",
    note: row
      ? "Consensus split captured; scoring waits for source-specific percentile baselines."
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
  }));
  return {
    score: 0,
    sources,
    normalizationStatus: "unavailable",
    note: sources.length > 0
      ? "Source-specific splits captured; scoring waits for source-specific percentile baselines."
      : "No source-specific split evidence captured yet.",
  };
}

function explanationFor(score: number, evidence: ResolverEvidence): string {
  if (score >= 2) {
    return "Sharp-book pricing has moved toward our projection.";
  }
  if (score === 1) {
    return "Market-maker pricing is showing slight support for our projection.";
  }
  if (score <= -2) {
    return "Sharp-book pricing has moved against this side despite the model edge.";
  }
  if (score === -1) {
    return "Market-maker pricing is showing slight resistance to this side.";
  }
  if (evidence.playbookConsensus.betsPct !== null || evidence.sharpApiSourceSpecific.sources.length > 0) {
    return "The recommendation remains model-led while market evidence builds enough history for calibrated scoring.";
  }
  return "The recommendation remains model-led because the betting market has not established a meaningful direction.";
}

export function resolveMarketReadV2(input: MarketReadResolverInput): MarketReadResolverOutput {
  const splitRows = input.splitObservations.filter(
    (r) => r.market_type === input.marketType && r.selection_key === input.selectionKey,
  );
  const priceRows = input.priceObservations.filter(
    (r) => r.market_type === input.marketType && r.selection_key === input.selectionKey,
  );

  const evidence: ResolverEvidence = {
    price: resolvePriceEvidence(priceRows),
    playbookConsensus: resolvePlaybookEvidence(splitRows),
    sharpApiSourceSpecific: resolveSharpApiSourceEvidence(splitRows),
  };
  const score = clampScore(
    evidence.price.score +
      evidence.playbookConsensus.score +
      evidence.sharpApiSourceSpecific.score,
  );
  return {
    score,
    label: labelForMarketReadScore(score),
    explanation: explanationFor(score, evidence),
    evidence,
  };
}
