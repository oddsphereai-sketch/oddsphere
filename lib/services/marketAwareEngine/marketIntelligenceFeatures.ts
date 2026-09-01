import { americanToImplied, timeToStartBucket } from "./core";
import type { MarketAwareMarket } from "./core";

export type MarketSplitFeatureRow = {
  provider: string | null;
  sourceBook: string | null;
  sourceType?: string | null;
  league: string | null;
  marketType: MarketAwareMarket;
  selectionKey: string | null;
  betsPct: number | null;
  moneyPct: number | null;
  marketLine?: number | null;
  marketPrice?: number | null;
  booksUsed?: number | null;
  sourceObservedAt?: string | null;
  fetchedAt: string | null;
  minutesToStart?: number | null;
};

export type PlaybookTemporalFeatures = {
  currentBetsPct: number | null;
  currentMoneyPct: number | null;
  firstTrackedBetsPct: number | null;
  firstTrackedMoneyPct: number | null;
  betsDelta15m: number | null;
  moneyDelta15m: number | null;
  betsDelta60m: number | null;
  moneyDelta60m: number | null;
  betsDeltaFullDay: number | null;
  moneyDeltaFullDay: number | null;
  moneyMinusBetsGap: number | null;
  moneyMinusBetsGapDelta: number | null;
  persistenceAbove50Pct: number | null;
  persistenceBelow50Pct: number | null;
  maxPregameBetsPct: number | null;
  minPregameBetsPct: number | null;
  maxPregameMoneyPct: number | null;
  minPregameMoneyPct: number | null;
  booksUsed: number | null;
  pairedConsensusLine: number | null;
  pairedConsensusPrice: number | null;
  timeToStartBucket: string;
  sampleCount: number;
};

export type MarketPriceFeatureRow = {
  sportsbook: string | null;
  sharpBook: boolean | null;
  marketType: MarketAwareMarket;
  selectionKey: string | null;
  line: number | null;
  americanPrice: number | null;
  noVigProbability: number | null;
  providerTimestamp: string | null;
  fetchedAt: string | null;
  minutesToStart?: number | null;
};

export type SharpRetailPriceFeatures = {
  medianSharpNoVigProbability: number | null;
  medianRetailNoVigProbability: number | null;
  sharpRetailProbabilityGap: number | null;
  pinnacleNoVigProbability: number | null;
  firstGroupToMove: "sharp" | "retail" | "simultaneous" | "none" | "unknown";
  sharpMove15m: number | null;
  retailMove15m: number | null;
  sharpMove60m: number | null;
  retailMove60m: number | null;
  bookMovementBreadth: number;
  sharpBookAgreement: number | null;
  retailBookAgreement: number | null;
  lineMovement: number | null;
  juiceMovement: number | null;
  movementVelocityPerHour: number | null;
  currentFreshnessMinutes: number | null;
  sharpBookCount: number;
  retailBookCount: number;
  primaryRetailBookCount: number;
  secondaryRetailBookCount: number;
  retailProbabilityRange: number | null;
  retailConsensusQuality: "strong" | "standard" | "thin" | "unavailable";
};

export const SHARP_PRICE_BOOKS = new Set(["pinnacle", "circa", "bookmaker"]);
export const PRIMARY_RETAIL_PRICE_BOOKS = new Set([
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "bet365",
]);
export const SECONDARY_RETAIL_PRICE_BOOKS = new Set([
  "hardrock",
  "betrivers",
  "ballybet",
  "betparx",
  "betway",
  "rebet",
  "fliff",
]);
export const RETAIL_PRICE_BOOKS = new Set([
  ...PRIMARY_RETAIL_PRICE_BOOKS,
  ...SECONDARY_RETAIL_PRICE_BOOKS,
]);

function finite(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function observedAt(row: { sourceObservedAt?: string | null; providerTimestamp?: string | null; fetchedAt: string | null }): string | null {
  return row.sourceObservedAt ?? row.providerTimestamp ?? row.fetchedAt ?? null;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function median(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function weightedMedian(values: Array<{ value: number; weight: number }>): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a.value - b.value);
  const totalWeight = ordered.reduce((sum, row) => sum + row.weight, 0);
  let cumulative = 0;
  for (const row of ordered) {
    cumulative += row.weight;
    if (cumulative >= totalWeight / 2) return row.value;
  }
  return ordered.at(-1)?.value ?? null;
}

function latestAtOrBefore<T extends { fetchedAt: string | null }>(
  rows: T[],
  asOfMs: number,
  timeFn: (row: T) => string | null,
): T | null {
  let best: T | null = null;
  let bestMs = -Infinity;
  for (const row of rows) {
    const t = parseTime(timeFn(row));
    if (t === null || t > asOfMs) continue;
    if (t >= bestMs) {
      best = row;
      bestMs = t;
    }
  }
  return best;
}

function deltaFromWindow(rows: MarketSplitFeatureRow[], current: MarketSplitFeatureRow, asOfMs: number, minutes: number, field: "betsPct" | "moneyPct"): number | null {
  const baseline = latestAtOrBefore(rows, asOfMs - minutes * 60_000, observedAt);
  const cur = finite(current[field]);
  const base = finite(baseline?.[field]);
  return cur === null || base === null ? null : cur - base;
}

export function derivePlaybookTemporalFeatures(
  rows: MarketSplitFeatureRow[],
  asOf: string | null,
): PlaybookTemporalFeatures {
  const asOfMs = parseTime(asOf) ?? Infinity;
  const eligible = rows
    .filter((row) => row.provider?.toLowerCase() === "playbook" && row.sourceBook?.toLowerCase() === "consensus")
    .filter((row) => {
      const t = parseTime(observedAt(row));
      return t === null || t <= asOfMs;
    })
    .sort((a, b) => (parseTime(observedAt(a)) ?? 0) - (parseTime(observedAt(b)) ?? 0));

  const empty: PlaybookTemporalFeatures = {
    currentBetsPct: null,
    currentMoneyPct: null,
    firstTrackedBetsPct: null,
    firstTrackedMoneyPct: null,
    betsDelta15m: null,
    moneyDelta15m: null,
    betsDelta60m: null,
    moneyDelta60m: null,
    betsDeltaFullDay: null,
    moneyDeltaFullDay: null,
    moneyMinusBetsGap: null,
    moneyMinusBetsGapDelta: null,
    persistenceAbove50Pct: null,
    persistenceBelow50Pct: null,
    maxPregameBetsPct: null,
    minPregameBetsPct: null,
    maxPregameMoneyPct: null,
    minPregameMoneyPct: null,
    booksUsed: null,
    pairedConsensusLine: null,
    pairedConsensusPrice: null,
    timeToStartBucket: "unknown",
    sampleCount: 0,
  };
  const current = eligible[eligible.length - 1];
  if (!current) return empty;

  const first = eligible[0];
  const bets = eligible.map((row) => finite(row.betsPct)).filter((v): v is number => v !== null);
  const money = eligible.map((row) => finite(row.moneyPct)).filter((v): v is number => v !== null);
  const currentBets = finite(current.betsPct);
  const currentMoney = finite(current.moneyPct);
  const firstGap = finite(first.moneyPct) !== null && finite(first.betsPct) !== null
    ? finite(first.moneyPct)! - finite(first.betsPct)!
    : null;
  const currentGap = currentMoney !== null && currentBets !== null ? currentMoney - currentBets : null;
  const above = eligible.filter((row) => finite(row.betsPct) !== null && finite(row.betsPct)! > 0.5).length;
  const below = eligible.filter((row) => finite(row.betsPct) !== null && finite(row.betsPct)! < 0.5).length;
  const directionalCount = above + below;

  return {
    currentBetsPct: currentBets,
    currentMoneyPct: currentMoney,
    firstTrackedBetsPct: finite(first.betsPct),
    firstTrackedMoneyPct: finite(first.moneyPct),
    betsDelta15m: deltaFromWindow(eligible, current, asOfMs, 15, "betsPct"),
    moneyDelta15m: deltaFromWindow(eligible, current, asOfMs, 15, "moneyPct"),
    betsDelta60m: deltaFromWindow(eligible, current, asOfMs, 60, "betsPct"),
    moneyDelta60m: deltaFromWindow(eligible, current, asOfMs, 60, "moneyPct"),
    betsDeltaFullDay: currentBets !== null && finite(first.betsPct) !== null ? currentBets - finite(first.betsPct)! : null,
    moneyDeltaFullDay: currentMoney !== null && finite(first.moneyPct) !== null ? currentMoney - finite(first.moneyPct)! : null,
    moneyMinusBetsGap: currentGap,
    moneyMinusBetsGapDelta: currentGap !== null && firstGap !== null ? currentGap - firstGap : null,
    persistenceAbove50Pct: directionalCount === 0 ? null : above / directionalCount,
    persistenceBelow50Pct: directionalCount === 0 ? null : below / directionalCount,
    maxPregameBetsPct: median([Math.max(...bets)]),
    minPregameBetsPct: median([Math.min(...bets)]),
    maxPregameMoneyPct: median([Math.max(...money)]),
    minPregameMoneyPct: median([Math.min(...money)]),
    booksUsed: current.booksUsed ?? null,
    pairedConsensusLine: current.marketLine ?? null,
    pairedConsensusPrice: current.marketPrice ?? null,
    timeToStartBucket: timeToStartBucket(current.minutesToStart ?? null),
    sampleCount: eligible.length,
  };
}

function groupForBook(row: MarketPriceFeatureRow): "sharp" | "retail" | null {
  const book = (row.sportsbook ?? "").toLowerCase();
  if (SHARP_PRICE_BOOKS.has(book) || row.sharpBook === true) return "sharp";
  if (RETAIL_PRICE_BOOKS.has(book)) return "retail";
  return null;
}

function retailTier(row: MarketPriceFeatureRow): "primary" | "secondary" | null {
  const book = (row.sportsbook ?? "").toLowerCase();
  if (PRIMARY_RETAIL_PRICE_BOOKS.has(book)) return "primary";
  if (SECONDARY_RETAIL_PRICE_BOOKS.has(book)) return "secondary";
  return null;
}

function latestByBook(rows: MarketPriceFeatureRow[], asOfMs: number): MarketPriceFeatureRow[] {
  const byBook = new Map<string, MarketPriceFeatureRow>();
  for (const row of rows) {
    const book = (row.sportsbook ?? "").toLowerCase();
    if (!book) continue;
    const t = parseTime(observedAt(row));
    if (t === null || t > asOfMs) continue;
    const prev = byBook.get(book);
    const prevT = parseTime(observedAt(prev ?? { fetchedAt: null })) ?? -Infinity;
    if (t >= prevT) byBook.set(book, row);
  }
  return [...byBook.values()];
}

function medianGroupProbability(rows: MarketPriceFeatureRow[], group: "sharp" | "retail"): number | null {
  const grouped = rows.filter((row) => groupForBook(row) === group);
  if (group === "sharp") {
    return median(grouped.map((row) => row.noVigProbability ?? americanToImplied(row.americanPrice)));
  }
  return weightedMedian(grouped.flatMap((row) => {
    const value = row.noVigProbability ?? americanToImplied(row.americanPrice);
    if (value === null) return [];
    return [{ value, weight: retailTier(row) === "primary" ? 1 : 0.65 }];
  }));
}

function medianGroupPrice(rows: MarketPriceFeatureRow[], group: "sharp" | "retail"): number | null {
  return median(rows.filter((row) => groupForBook(row) === group).map((row) => row.americanPrice));
}

function groupMove(rows: MarketPriceFeatureRow[], asOfMs: number, minutes: number, group: "sharp" | "retail"): number | null {
  const current = medianGroupProbability(latestByBook(rows, asOfMs), group);
  const previous = medianGroupProbability(latestByBook(rows, asOfMs - minutes * 60_000), group);
  return current === null || previous === null ? null : current - previous;
}

function firstMoveGroup(rows: MarketPriceFeatureRow[]): SharpRetailPriceFeatures["firstGroupToMove"] {
  const byBook = new Map<string, MarketPriceFeatureRow[]>();
  for (const row of rows) {
    const book = (row.sportsbook ?? "").toLowerCase();
    if (!book || groupForBook(row) === null) continue;
    const arr = byBook.get(book) ?? [];
    arr.push(row);
    byBook.set(book, arr);
  }
  let sharpFirst: number | null = null;
  let retailFirst: number | null = null;
  for (const arr of byBook.values()) {
    const sorted = arr
      .map((row) => ({ row, t: parseTime(observedAt(row)), p: row.noVigProbability ?? americanToImplied(row.americanPrice) }))
      .filter((x): x is { row: MarketPriceFeatureRow; t: number; p: number } => x.t !== null && x.p !== null)
      .sort((a, b) => a.t - b.t);
    const first = sorted[0];
    const moved = sorted.find((x) => Math.abs(x.p - first.p) >= 0.002);
    if (!first || !moved) continue;
    const group = groupForBook(moved.row);
    if (group === "sharp") sharpFirst = sharpFirst === null ? moved.t : Math.min(sharpFirst, moved.t);
    if (group === "retail") retailFirst = retailFirst === null ? moved.t : Math.min(retailFirst, moved.t);
  }
  if (sharpFirst === null && retailFirst === null) return "none";
  if (sharpFirst === null) return "retail";
  if (retailFirst === null) return "sharp";
  if (Math.abs(sharpFirst - retailFirst) <= 60_000) return "simultaneous";
  return sharpFirst < retailFirst ? "sharp" : "retail";
}

export function deriveSharpRetailPriceFeatures(
  rows: MarketPriceFeatureRow[],
  asOf: string | null,
): SharpRetailPriceFeatures {
  const asOfMs = parseTime(asOf) ?? Infinity;
  const current = latestByBook(rows, asOfMs);
  const sharp = current.filter((row) => groupForBook(row) === "sharp");
  const retail = current.filter((row) => groupForBook(row) === "retail");
  const primaryRetail = retail.filter((row) => retailTier(row) === "primary");
  const secondaryRetail = retail.filter((row) => retailTier(row) === "secondary");
  const retailProbabilities = retail
    .map((row) => row.noVigProbability ?? americanToImplied(row.americanPrice))
    .filter((value): value is number => value !== null);
  const retailProbabilityRange = retailProbabilities.length === 0
    ? null
    : Math.max(...retailProbabilities) - Math.min(...retailProbabilities);
  const retailConsensusQuality: SharpRetailPriceFeatures["retailConsensusQuality"] = retail.length === 0
    ? "unavailable"
    : retail.length >= 3 && primaryRetail.length >= 2 && (retailProbabilityRange ?? Infinity) <= 0.02
      ? "strong"
      : retail.length >= 2 && (retailProbabilityRange ?? Infinity) <= 0.04
        ? "standard"
        : "thin";
  const medianSharp = medianGroupProbability(current, "sharp");
  const medianRetail = medianGroupProbability(current, "retail");
  const currentLine = median(current.map((row) => row.line));
  const firstLine = median(rows.map((row) => row.line));
  const currentPrice = medianGroupPrice(current, "sharp") ?? median(current.map((row) => row.americanPrice));
  const firstPrice = medianGroupPrice(rows, "sharp") ?? median(rows.map((row) => row.americanPrice));
  const latestTs = median(current.map((row) => parseTime(observedAt(row))));
  const earliestTs = median(rows.map((row) => parseTime(observedAt(row))));
  const probMove = medianSharp !== null && medianGroupProbability(rows, "sharp") !== null
    ? medianSharp - medianGroupProbability(rows, "sharp")!
    : null;
  const hours = latestTs !== null && earliestTs !== null ? Math.max(1 / 60, (latestTs - earliestTs) / 3_600_000) : null;

  return {
    medianSharpNoVigProbability: medianSharp,
    medianRetailNoVigProbability: medianRetail,
    sharpRetailProbabilityGap: medianSharp !== null && medianRetail !== null ? medianSharp - medianRetail : null,
    pinnacleNoVigProbability: current.find((row) => row.sportsbook?.toLowerCase() === "pinnacle")?.noVigProbability ?? null,
    firstGroupToMove: rows.length === 0 ? "unknown" : firstMoveGroup(rows),
    sharpMove15m: groupMove(rows, asOfMs, 15, "sharp"),
    retailMove15m: groupMove(rows, asOfMs, 15, "retail"),
    sharpMove60m: groupMove(rows, asOfMs, 60, "sharp"),
    retailMove60m: groupMove(rows, asOfMs, 60, "retail"),
    bookMovementBreadth: [...new Set(rows.filter((row) => {
      const bookRows = rows.filter((other) => other.sportsbook?.toLowerCase() === row.sportsbook?.toLowerCase());
      const probs = bookRows.map((r) => r.noVigProbability ?? americanToImplied(r.americanPrice)).filter((v): v is number => v !== null);
      return probs.length >= 2 && Math.max(...probs) - Math.min(...probs) >= 0.002;
    }).map((row) => row.sportsbook?.toLowerCase()))].length,
    sharpBookAgreement: sharp.length === 0 ? null : sharp.filter((row) => (row.noVigProbability ?? americanToImplied(row.americanPrice) ?? 0.5) >= 0.5).length / sharp.length,
    retailBookAgreement: retail.length === 0 ? null : retail.filter((row) => (row.noVigProbability ?? americanToImplied(row.americanPrice) ?? 0.5) >= 0.5).length / retail.length,
    lineMovement: currentLine !== null && firstLine !== null ? currentLine - firstLine : null,
    juiceMovement: currentPrice !== null && firstPrice !== null ? currentPrice - firstPrice : null,
    movementVelocityPerHour: probMove !== null && hours !== null ? probMove / hours : null,
    currentFreshnessMinutes: latestTs === null || !Number.isFinite(asOfMs) ? null : Math.max(0, (asOfMs - latestTs) / 60_000),
    sharpBookCount: sharp.length,
    retailBookCount: retail.length,
    primaryRetailBookCount: primaryRetail.length,
    secondaryRetailBookCount: secondaryRetail.length,
    retailProbabilityRange,
    retailConsensusQuality,
  };
}
