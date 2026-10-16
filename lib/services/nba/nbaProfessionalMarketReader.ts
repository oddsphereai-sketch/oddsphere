import type { NbaMovementMarket } from "./nbaSameBookMovement";

export const NBA_PROFESSIONAL_MARKET_READER_RELEASE =
  "nba_professional_market_reader_2026_10_16_r4_total_disagreement_authority" as const;

export type NbaReaderSide = "home" | "away" | "over" | "under";
type Direction = -1 | 1;

export type NbaReaderSplitRow = {
  provider: string;
  sourceBook: string;
  sourceType: string;
  market: NbaMovementMarket;
  selectionKey: string;
  betsPct: number | null;
  moneyPct: number | null;
  marketLine: number | null;
  sourceObservedAt: string | null;
  fetchedAt: string;
};

export type NbaReaderPriceRow = {
  sportsbook: string;
  sharpBook: boolean;
  market: NbaMovementMarket;
  selectionKey: string;
  americanPrice: number | null;
  line: number | null;
  providerTimestamp: string | null;
  fetchedAt: string;
};

export type NbaReaderTrail = {
  sportsbook: string;
  sourceClass: "named" | "retail";
  openingAt: string;
  currentAt: string;
  observations: number;
  openingNumber: number | null;
  currentNumber: number | null;
  numberDelta: number | null;
  fairProbabilityDeltaPp: number;
  numberDirection: NbaReaderSide | null;
  priceDirection: NbaReaderSide | null;
  direction: NbaReaderSide | null;
  persistenceTimeShare: number;
  reversalMagnitude: number;
  buybackToOpening: boolean;
};

export type NbaReaderFlow = {
  source: "named_book" | "retail_book" | "public_consensus";
  sportsbook: string | null;
  side: NbaReaderSide;
  gapPp: number;
  observedAt: string;
  ageMinutes: number;
  exactLineMatched: boolean | null;
};

export type NbaProfessionalMarketRead = {
  status: "qualified" | "unavailable";
  side: NbaReaderSide | null;
  reason:
    | "stable_two_named_moneyline_prices"
    | "number_and_price_alignment"
    | "two_named_total_number_moves"
    | "reverse_flow_resistance"
    | "insufficient_sequence"
    | "stale_or_incomplete_flow"
    | "evidence_unavailable"
    | "book_disagreement"
    | "reversal_or_buyback";
  resistance: "none" | "flow_resistance" | "reverse_flow" | "book_disagreement";
  trails: NbaReaderTrail[];
  flows: NbaReaderFlow[];
  excludedSportsbooks: string[];
};

export type NbaProfessionalMarketReader = {
  release: typeof NBA_PROFESSIONAL_MARKET_READER_RELEASE;
  policy: "categorical_evidence_no_consensus_weight";
  authority: "conditional_spread_and_total_with_coherent_score_effects";
  forecastAuthority: {
    moneyline: "indirect_only_from_validated_spread_score";
    spread: "conditional_categorical_score_correction";
    total: "conditional_categorical_score_correction";
  };
  evidenceStatus: "complete" | "unavailable";
  evidenceErrors: string[];
  evaluatedAt: string;
  reads: Record<NbaMovementMarket, NbaProfessionalMarketRead>;
};

type PairedObservation = {
  observedAt: string;
  firstLine: number | null;
  firstPrice: number;
  secondPrice: number;
};

const NAMED_BOOKS = new Set(["pinnacle", "circa", "bookmaker"]);
const FRESH_MINUTES = 120;
const PRICE_MOVE_PP = 1;
const NUMBER_MOVE = 0.5;
const FLOW_MINIMUM_PP = 8;

export function buildNbaProfessionalMarketReader(args: {
  evaluatedAt: string;
  priceRows: readonly NbaReaderPriceRow[];
  splitRows: readonly NbaReaderSplitRow[];
  evidenceErrors?: readonly string[];
  selectedLines: { spreadHome: number | null; total: number | null };
  excludedSportsbooksByMarket?: Partial<Record<NbaMovementMarket, Iterable<string>>>;
}): NbaProfessionalMarketReader {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NBA professional market reader requires a valid evaluatedAt.");
  const evidenceErrors = [...(args.evidenceErrors ?? [])];
  const reads = Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => {
    if (evidenceErrors.length > 0) {
      return [market, {
        status: "unavailable",
        side: null,
        reason: "evidence_unavailable",
        resistance: "none",
        trails: [],
        flows: [],
        excludedSportsbooks: [],
      } satisfies NbaProfessionalMarketRead];
    }
    const excluded = new Set(
      [...(args.excludedSportsbooksByMarket?.[market] ?? [])].map(canonical).filter(Boolean),
    );
    const trails = buildTrails({
      market,
      rows: args.priceRows,
      evaluatedAt,
      excluded,
    });
    const flows = buildFlows({
      market,
      rows: args.splitRows,
      evaluatedAt,
      excluded,
      selectedLine: market === "spread" ? args.selectedLines.spreadHome
        : market === "total" ? args.selectedLines.total : null,
    });
    return [market, qualify(market, trails, flows, [...excluded].sort())];
  })) as Record<NbaMovementMarket, NbaProfessionalMarketRead>;
  return {
    release: NBA_PROFESSIONAL_MARKET_READER_RELEASE,
    policy: "categorical_evidence_no_consensus_weight",
    authority: "conditional_spread_and_total_with_coherent_score_effects",
    forecastAuthority: {
      moneyline: "indirect_only_from_validated_spread_score",
      spread: "conditional_categorical_score_correction",
      total: "conditional_categorical_score_correction",
    },
    evidenceStatus: evidenceErrors.length === 0 ? "complete" : "unavailable",
    evidenceErrors,
    evaluatedAt: args.evaluatedAt,
    reads,
  };
}

function buildTrails(args: {
  market: NbaMovementMarket;
  rows: readonly NbaReaderPriceRow[];
  evaluatedAt: number;
  excluded: Set<string>;
}): NbaReaderTrail[] {
  const sidePair = args.market === "total" ? ["over", "under"] as const : ["home", "away"] as const;
  const raw = args.rows.flatMap((row) => {
    const side = selectionSide(row.selectionKey);
    if (row.market !== args.market || row.americanPrice === null || !side) return [];
    return [{
      sportsbook: row.sportsbook,
      sharpBook: row.sharpBook,
      side,
      line: row.line,
      price: row.americanPrice,
      observedAt: row.providerTimestamp ?? row.fetchedAt,
      capturedAt: row.fetchedAt,
    }];
  });
  const books = new Set(raw.map((row) => canonical(row.sportsbook)));
  const trails: NbaReaderTrail[] = [];
  for (const book of books) {
    if (!book || args.excluded.has(book)) continue;
    const byTime = new Map<string, typeof raw>();
    for (const row of raw) {
      if (canonical(row.sportsbook) !== book || Date.parse(row.observedAt) > args.evaluatedAt) continue;
      byTime.set(row.capturedAt, [...(byTime.get(row.capturedAt) ?? []), row]);
    }
    const observations = [...byTime.entries()].flatMap(([, rows]): PairedObservation[] => {
      const first = rows.find((row) => row.side === sidePair[0] && Number.isFinite(row.price));
      const second = rows.find((row) => row.side === sidePair[1] && Number.isFinite(row.price));
      if (!first || !second || !coherentLines(args.market, first.line, second.line)) return [];
      const observedAt = new Date(Math.max(Date.parse(first.observedAt), Date.parse(second.observedAt))).toISOString();
      return [{ observedAt, firstLine: first.line, firstPrice: first.price, secondPrice: second.price }];
    }).sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
    const opening = observations[0];
    const current = observations.at(-1);
    if (!opening || !current || observations.length < 2 || !fresh(current.observedAt, args.evaluatedAt)) continue;
    const openingNumber = numberAxis(args.market, opening.firstLine);
    const currentNumber = numberAxis(args.market, current.firstLine);
    const numberDelta = openingNumber === null || currentNumber === null ? null : currentNumber - openingNumber;
    const probabilityDelta = 100 * (fairFirst(current) - fairFirst(opening));
    const numberDirection = numberDelta !== null && Math.abs(numberDelta) >= NUMBER_MOVE
      ? sideName(args.market, sign(numberDelta)) : null;
    const priceDirection = Math.abs(probabilityDelta) >= PRICE_MOVE_PP
      ? sideName(args.market, sign(probabilityDelta)) : null;
    const direction = numberDirection ?? priceDirection;
    const alignedAt = direction === null ? null : observations.findIndex((row) =>
      observationDirection(args.market, opening, row) === direction);
    const persistenceTimeShare = alignedAt === null || alignedAt < 0
      ? 0 : timeShare(observations, opening, direction!, alignedAt, args.evaluatedAt, args.market);
    const oppositeMagnitudes = direction === null ? [] : observations.flatMap((row) => {
      if (observationDirection(args.market, opening, row) !== opposite(direction)) return [];
      const number = numberAxis(args.market, row.firstLine);
      return [openingNumber !== null && number !== null ? Math.abs(number - openingNumber) : Math.abs(100 * (fairFirst(row) - fairFirst(opening))) / 100];
    });
    const everMoved = observations.some((row) => observationDirection(args.market, opening, row) !== null);
    trails.push({
      sportsbook: book,
      sourceClass: raw.some((row) => canonical(row.sportsbook) === book && row.sharpBook) || NAMED_BOOKS.has(book)
        ? "named" : "retail",
      openingAt: opening.observedAt,
      currentAt: current.observedAt,
      observations: observations.length,
      openingNumber,
      currentNumber,
      numberDelta,
      fairProbabilityDeltaPp: probabilityDelta,
      numberDirection,
      priceDirection,
      direction,
      persistenceTimeShare,
      reversalMagnitude: Math.max(0, ...oppositeMagnitudes),
      buybackToOpening: everMoved && direction === null,
    });
  }
  return trails.sort((left, right) => left.sportsbook.localeCompare(right.sportsbook));
}

function buildFlows(args: {
  market: NbaMovementMarket;
  rows: readonly NbaReaderSplitRow[];
  evaluatedAt: number;
  excluded: Set<string>;
  selectedLine: number | null;
}): NbaReaderFlow[] {
  const firstSide = args.market === "total" ? "over" : "home";
  const latest = new Map<string, NbaReaderSplitRow>();
  for (const row of args.rows) {
    if (row.market !== args.market || selectionSide(row.selectionKey) !== firstSide) continue;
    const book = canonical(row.sourceBook);
    if (book && args.excluded.has(book)) continue;
    const key = `${row.provider}|${book}|${row.sourceType}`;
    const prior = latest.get(key);
    if (!prior || Date.parse(observedAt(row)) > Date.parse(observedAt(prior))) latest.set(key, row);
  }
  return [...latest.values()].flatMap((row): NbaReaderFlow[] => {
    if (row.moneyPct === null || row.betsPct === null) return [];
    const observed = observedAt(row);
    const ageMinutes = (args.evaluatedAt - Date.parse(observed)) / 60_000;
    if (!Number.isFinite(ageMinutes) || ageMinutes < 0 || ageMinutes > FRESH_MINUTES) return [];
    const money = normalizePct(row.moneyPct);
    const bets = normalizePct(row.betsPct);
    const gap = money - bets;
    if (Math.abs(gap) < FLOW_MINIMUM_PP) return [];
    const exactLineMatched = args.market === "moneyline" ? null
      : row.marketLine === null || args.selectedLine === null ? false
      : Math.abs(Math.abs(row.marketLine) - Math.abs(args.selectedLine)) < 0.01;
    if (exactLineMatched === false) return [];
    const source = row.sourceType === "sharp_adjacent_book" ? "named_book" as const
      : row.sourceBook === "consensus" ? "public_consensus" as const : "retail_book" as const;
    return [{
      source,
      sportsbook: row.sourceBook === "consensus" ? null : canonical(row.sourceBook),
      side: sideName(args.market, sign(gap)),
      gapPp: gap,
      observedAt: observed,
      ageMinutes,
      exactLineMatched,
    }];
  }).sort((left, right) => flowAuthority(right) - flowAuthority(left) || Math.abs(right.gapPp) - Math.abs(left.gapPp));
}

function qualify(
  market: NbaMovementMarket,
  trails: NbaReaderTrail[],
  flows: NbaReaderFlow[],
  excludedSportsbooks: string[],
): NbaProfessionalMarketRead {
  const moved = trails.filter((trail) => trail.direction !== null);
  const movement = consensus(moved.map((trail) => trail.direction!));
  const bookDisagreement = new Set(moved.map((trail) => trail.direction)).size > 1;
  const strongestFlow = flows[0] ?? null;
  const resistance = bookDisagreement ? "book_disagreement" as const
    : strongestFlow && movement === null ? "flow_resistance" as const
    : strongestFlow && movement !== strongestFlow.side ? "reverse_flow" as const : "none" as const;
  const base = { trails, flows, excludedSportsbooks, resistance };
  if (bookDisagreement) return { ...base, status: "unavailable", side: null, reason: "book_disagreement" };
  if (trails.some((trail) => trail.buybackToOpening || trail.reversalMagnitude > 0)) {
    return { ...base, status: "unavailable", side: null, reason: "reversal_or_buyback" };
  }
  const stable = moved.filter((trail) => trail.persistenceTimeShare >= 2 / 3);
  const named = stable.filter((trail) => trail.sourceClass === "named");
  if (market === "moneyline") {
    const namedDirection = consensus(named.map((trail) => trail.direction!));
    if (named.length >= 2 && namedDirection !== null) {
      return { ...base, status: "qualified", side: namedDirection, reason: "stable_two_named_moneyline_prices" };
    }
  } else if (market === "spread") {
    const aligned = stable.filter((trail) => trail.numberDirection !== null && trail.numberDirection === trail.priceDirection);
    const alignedDirection = consensus(aligned.map((trail) => trail.numberDirection!));
    if (aligned.length >= 2 && alignedDirection !== null && strongestFlow?.side === alignedDirection) {
      return { ...base, status: "qualified", side: alignedDirection, reason: "number_and_price_alignment" };
    }
    if (
      aligned.length >= 2 && alignedDirection !== null && strongestFlow !== null &&
      strongestFlow.side !== alignedDirection && named.some((trail) => trail.direction === alignedDirection)
    ) {
      return { ...base, status: "qualified", side: alignedDirection, reason: "reverse_flow_resistance", resistance: "reverse_flow" };
    }
  } else {
    const namedNumbers = named.filter((trail) => trail.numberDirection !== null);
    const namedDirection = consensus(namedNumbers.map((trail) => trail.numberDirection!));
    if (namedNumbers.length >= 2 && namedDirection !== null) {
      return { ...base, status: "qualified", side: namedDirection, reason: "two_named_total_number_moves" };
    }
  }
  return {
    ...base,
    status: "unavailable",
    side: null,
    reason: flows.length === 0 ? "stale_or_incomplete_flow" : "insufficient_sequence",
  };
}

function coherentLines(market: NbaMovementMarket, first: number | null, second: number | null): boolean {
  if (market === "moneyline") return true;
  if (first === null || second === null) return false;
  return market === "total" ? Math.abs(first - second) < 0.01 : Math.abs(first + second) < 0.01;
}
function numberAxis(market: NbaMovementMarket, line: number | null): number | null {
  if (market === "moneyline" || line === null) return null;
  return market === "spread" ? -line : line;
}
function observationDirection(market: NbaMovementMarket, opening: PairedObservation, row: PairedObservation): NbaReaderSide | null {
  const first = numberAxis(market, opening.firstLine);
  const next = numberAxis(market, row.firstLine);
  if (first !== null && next !== null && Math.abs(next - first) >= NUMBER_MOVE) return sideName(market, sign(next - first));
  const delta = 100 * (fairFirst(row) - fairFirst(opening));
  return Math.abs(delta) >= PRICE_MOVE_PP ? sideName(market, sign(delta)) : null;
}
function timeShare(rows: PairedObservation[], opening: PairedObservation, direction: NbaReaderSide, startIndex: number, evaluatedAt: number, market: NbaMovementMarket): number {
  let aligned = 0;
  let total = 0;
  for (let index = startIndex; index < rows.length; index++) {
    const start = Date.parse(rows[index]!.observedAt);
    const end = index + 1 < rows.length ? Date.parse(rows[index + 1]!.observedAt) : evaluatedAt;
    const duration = Math.max(0, end - start);
    total += duration;
    if (observationDirection(market, opening, rows[index]!) === direction) aligned += duration;
  }
  return total > 0 ? aligned / total : 0;
}
function fairFirst(row: PairedObservation): number {
  const first = implied(row.firstPrice);
  const second = implied(row.secondPrice);
  return first / (first + second);
}
function consensus(values: NbaReaderSide[]): NbaReaderSide | null {
  if (values.length === 0) return null;
  const directions = values.map(directionForSide);
  const score = directions.reduce<number>((sum, value) => sum + value, 0);
  if (Math.abs(score) / directions.length < 2 / 3) return null;
  const market = values[0] === "over" || values[0] === "under" ? "total" : "spread";
  return sideName(market, sign(score));
}
function directionForSide(side: NbaReaderSide): Direction { return side === "home" || side === "over" ? 1 : -1; }
function sideName(market: NbaMovementMarket, direction: Direction): NbaReaderSide {
  return market === "total" ? direction === 1 ? "over" : "under" : direction === 1 ? "home" : "away";
}
function opposite(side: NbaReaderSide): NbaReaderSide {
  return side === "home" ? "away" : side === "away" ? "home" : side === "over" ? "under" : "over";
}
function selectionSide(selectionKey: string): string { return selectionKey.split(":").at(-1) ?? ""; }
function observedAt(row: NbaReaderSplitRow): string { return row.sourceObservedAt ?? row.fetchedAt; }
function normalizePct(value: number): number { return Math.abs(value) <= 1 ? value * 100 : value; }
function flowAuthority(flow: NbaReaderFlow): number { return flow.source === "named_book" ? 3 : flow.source === "public_consensus" ? 2 : 1; }
function fresh(value: string, evaluatedAt: number): boolean {
  const age = (evaluatedAt - Date.parse(value)) / 60_000;
  return Number.isFinite(age) && age >= 0 && age <= FRESH_MINUTES;
}
function canonical(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function sign(value: number): Direction { return value >= 0 ? 1 : -1; }
function implied(price: number): number { return price > 0 ? 100 / (price + 100) : -price / (-price + 100); }
