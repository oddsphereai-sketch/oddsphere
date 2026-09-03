export const WNBA_TARGET_EXCLUDED_MARKET_DECISION_VERSION =
  "wnba_target_excluded_market_decision_v2_2026_09_02" as const;

export const WNBA_TARGET_EXCLUDED_MAX_AGE_MS = 15 * 60 * 1000;
export const WNBA_TARGET_EXCLUDED_MAX_PAIR_SKEW_MS = 30 * 1000;
export const WNBA_TARGET_EXCLUDED_MIN_ALTERNATIVE_BOOKS = 2;

export type WnbaTargetExcludedMarket = "moneyline" | "spread" | "total";
export type WnbaTargetExcludedSide = "home" | "away" | "over" | "under";
export type WnbaMarketSourceClass = "originator" | "named_retail" | "other";

export type WnbaTargetExcludedPriceRow = {
  market: WnbaTargetExcludedMarket;
  side: WnbaTargetExcludedSide;
  sportsbook: string;
  line: number | null;
  priceAmerican: number;
  observedAt: string | null;
  sharp: boolean;
  sourceClass?: WnbaMarketSourceClass;
  sourceFamily?: string;
};

export type WnbaCompleteMarketPair = {
  market: WnbaTargetExcludedMarket;
  sportsbook: string;
  canonicalLine: number | null;
  first: WnbaTargetExcludedPriceRow;
  second: WnbaTargetExcludedPriceRow;
  capturedAt: string;
  pairSkewMs: number;
  sourceClass: WnbaMarketSourceClass;
  sourceFamily: string;
};

export type WnbaLineConsensus = {
  line: number;
  bookCount: number;
  independentFamilyCount: number;
  unique: boolean;
};

export type WnbaMarginDistribution =
  | {
      kind: "maximum_entropy_sign_tilt";
      mean: number;
      standardDeviation: number;
      variance: number;
      positiveProbability: number;
      baseMean: number;
      baseStandardDeviation: number;
      thresholdZ: number;
    }
  | {
      kind: "independent_normal_fallback";
      mean: number;
      standardDeviation: number;
      variance: number;
      positiveProbability: number;
      fallbackReason: string;
    };

export type WnbaResolvedMarketDecision = {
  contract_version: typeof WNBA_TARGET_EXCLUDED_MARKET_DECISION_VERSION;
  market: "spread" | "total";
  line: number | null;
  evaluated: WnbaTargetExcludedPriceRow | null;
  target_excluded_fair_probability: number | null;
  target_excluded_book_count: number;
  target_excluded_independent_family_count: number;
  complete_pair_book_count: number;
  target_excluded_consensus_line: number | null;
  target_excluded_consensus_book_count: number;
  target_excluded_consensus_qualified: boolean;
  unavailable_reason: string | null;
  target_excluded_sources: Array<{
    sportsbook: string;
    source_class: WnbaMarketSourceClass;
    source_family: string;
    line: number | null;
  }>;
  target_excluded_lines: number[];
  target_excluded_sharp_lines: number[];
};

export type WnbaExactPriceValueGate = {
  grade: "Best Angle" | "Lean" | "Watchlist";
  eligibleBestAngle: boolean;
  eligibleLean: boolean;
  breakEvenProbability: number | null;
  probabilityEdge: number | null;
  expectedReturn: number | null;
};

const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);
const ORIGINATOR_FAMILY_BY_BOOK = new Map([
  ["circa", "originator:circa"],
  ["pinnacle", "originator:pinnacle"],
  ["bookmaker", "originator:bookmaker"],
]);
const NAMED_RETAIL_BOOKS = new Set([
  "bet365 us",
  "betmgm",
  "betrivers",
  "caesars",
  "draftkings",
  "espn bet",
  "fanduel",
  "fanatics",
]);
const NON_ORIGINATOR_SHARPAPI_FAMILY = "sharpapi:non_originator_unverified_lineage";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sameLine(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 0.01;
}

function normalizedBook(value: string): string {
  return value.trim().toLowerCase();
}

export function classifyWnbaMarketSource(sportsbook: string): {
  sourceClass: WnbaMarketSourceClass;
  sourceFamily: string;
} {
  const book = normalizedBook(sportsbook);
  const originatorFamily = ORIGINATOR_FAMILY_BY_BOOK.get(book);
  if (originatorFamily) return { sourceClass: "originator", sourceFamily: originatorFamily };
  return {
    sourceClass: NAMED_RETAIL_BOOKS.has(book) ? "named_retail" : "other",
    // SharpAPI exposes book labels, not feed-lineage proof. Conservatively treat
    // every non-originator as one correlated family until provenance says more.
    sourceFamily: NON_ORIGINATOR_SHARPAPI_FAMILY,
  };
}

export function wnbaIndependentSourceFamilyCount(
  pairs: readonly WnbaCompleteMarketPair[],
): number {
  return new Set(pairs.map((pair) => pair.sourceFamily)).size;
}

function rowMs(row: WnbaTargetExcludedPriceRow): number | null {
  if (typeof row.observedAt !== "string") return null;
  const parsed = Date.parse(row.observedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function standardNormalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / SQRT_TWO_PI;
}

export function standardNormalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

export function americanBreakEvenProbability(american: number): number {
  return american > 0
    ? 100 / (american + 100)
    : Math.abs(american) / (Math.abs(american) + 100);
}

export function americanExpectedReturn(probability: number, american: number): number {
  const profit = american > 0 ? american / 100 : 100 / Math.abs(american);
  return probability * profit - (1 - probability);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function validLine(row: WnbaTargetExcludedPriceRow): boolean {
  if (row.market === "moneyline") return row.line === null;
  if (!finite(row.line)) return false;
  return row.market === "spread"
    ? Math.abs(row.line) < 40
    : row.line > 120 && row.line < 220;
}

function complementary(
  market: WnbaTargetExcludedMarket,
  left: WnbaTargetExcludedPriceRow,
  right: WnbaTargetExcludedPriceRow,
): boolean {
  if (market === "moneyline") {
    return left.side === "home" && right.side === "away" && left.line === null && right.line === null;
  }
  if (market === "spread") {
    return left.side === "home" && right.side === "away" && finite(left.line) && finite(right.line) && sameLine(left.line, -right.line);
  }
  return left.side === "over" && right.side === "under" && finite(left.line) && sameLine(left.line, right.line);
}

/**
 * Builds at most one current observation per sportsbook. Repeated same-book rows
 * cannot manufacture breadth. Each observation first receives its nearest
 * complementary timestamp; the newest coherent capture then wins for the book.
 */
export function pairWnbaCompleteMarketRows(args: {
  rows: readonly WnbaTargetExcludedPriceRow[];
  market: WnbaTargetExcludedMarket;
  decisionAt: string;
  startsAt: string;
}): WnbaCompleteMarketPair[] {
  const decisionMs = Date.parse(args.decisionAt);
  const startsMs = Date.parse(args.startsAt);
  if (!Number.isFinite(decisionMs) || !Number.isFinite(startsMs)) return [];

  const clean = args.rows
    .filter((row) =>
      row.market === args.market &&
      normalizedBook(row.sportsbook).length > 0 &&
      validLine(row) &&
      finite(row.priceAmerican) &&
      row.priceAmerican !== 0
    )
    .map((row) => {
      const sportsbook = normalizedBook(row.sportsbook);
      const taxonomy = classifyWnbaMarketSource(sportsbook);
      return {
        ...row,
        sportsbook,
        sourceClass: taxonomy.sourceClass,
        sourceFamily: taxonomy.sourceFamily,
      };
    });
  const firstSide = args.market === "moneyline" || args.market === "spread" ? "home" : "over";
  const first = clean.filter((row) => row.side === firstSide);
  const second = clean.filter((row) => row.side !== firstSide);
  const candidates: WnbaCompleteMarketPair[] = [];

  for (const left of first) {
    const leftMs = rowMs(left);
    if (
      leftMs === null ||
      leftMs > decisionMs ||
      leftMs >= startsMs ||
      decisionMs - leftMs > WNBA_TARGET_EXCLUDED_MAX_AGE_MS
    ) continue;
    for (const right of second) {
      if (right.sportsbook !== left.sportsbook || !complementary(args.market, left, right)) continue;
      const rightMs = rowMs(right);
      if (
        rightMs === null ||
        rightMs > decisionMs ||
        rightMs >= startsMs ||
        decisionMs - rightMs > WNBA_TARGET_EXCLUDED_MAX_AGE_MS
      ) continue;
      const pairSkewMs = Math.abs(leftMs - rightMs);
      if (pairSkewMs > WNBA_TARGET_EXCLUDED_MAX_PAIR_SKEW_MS) continue;
      const capturedMs = Math.max(leftMs, rightMs);
      candidates.push({
        market: args.market,
        sportsbook: left.sportsbook,
        canonicalLine: args.market === "moneyline" ? null : left.line,
        first: left,
        second: right,
        capturedAt: new Date(capturedMs).toISOString(),
        pairSkewMs,
        sourceClass: left.sourceClass,
        sourceFamily: left.sourceFamily,
      });
    }
  }

  const nearestByFirstObservation = new Map<string, WnbaCompleteMarketPair>();
  for (const candidate of candidates.sort((left, right) =>
    left.first.observedAt!.localeCompare(right.first.observedAt!) ||
    left.sportsbook.localeCompare(right.sportsbook) ||
    left.pairSkewMs - right.pairSkewMs ||
    right.capturedAt.localeCompare(left.capturedAt)
  )) {
    const key = `${candidate.sportsbook}|${candidate.first.observedAt}|${candidate.first.line}`;
    if (!nearestByFirstObservation.has(key)) nearestByFirstObservation.set(key, candidate);
  }
  const bestByBook = new Map<string, WnbaCompleteMarketPair>();
  for (const candidate of [...nearestByFirstObservation.values()].sort((left, right) =>
    right.capturedAt.localeCompare(left.capturedAt) ||
    left.pairSkewMs - right.pairSkewMs ||
    (left.canonicalLine ?? 0) - (right.canonicalLine ?? 0) ||
    left.sportsbook.localeCompare(right.sportsbook)
  )) {
    if (!bestByBook.has(candidate.sportsbook)) bestByBook.set(candidate.sportsbook, candidate);
  }
  return [...bestByBook.values()].sort((left, right) =>
    right.capturedAt.localeCompare(left.capturedAt) ||
    left.sportsbook.localeCompare(right.sportsbook)
  );
}

export function uniqueWnbaModalLine(
  pairs: readonly WnbaCompleteMarketPair[],
  minimumBooks = 1,
  minimumIndependentFamilies = 1,
): WnbaLineConsensus | null {
  const booksByLine = new Map<number, Set<string>>();
  for (const pair of pairs) {
    if (!finite(pair.canonicalLine)) continue;
    const books = booksByLine.get(pair.canonicalLine) ?? new Set<string>();
    books.add(pair.sportsbook);
    booksByLine.set(pair.canonicalLine, books);
  }
  if (booksByLine.size === 0) return null;
  const maximum = Math.max(...[...booksByLine.values()].map((books) => books.size));
  const modes = [...booksByLine.entries()]
    .filter(([, books]) => books.size === maximum)
    .map(([line]) => line)
    .sort((left, right) => left - right);
  if (modes.length !== 1 || maximum < minimumBooks) return null;
  const modalPairs = pairs.filter((pair) => sameLine(pair.canonicalLine, modes[0]!));
  const independentFamilyCount = wnbaIndependentSourceFamilyCount(modalPairs);
  if (independentFamilyCount < minimumIndependentFamilies) return null;
  return { line: modes[0]!, bookCount: maximum, independentFamilyCount, unique: true };
}

export function wnbaPairRowForSide(
  pair: WnbaCompleteMarketPair,
  side: WnbaTargetExcludedSide,
): WnbaTargetExcludedPriceRow | null {
  return pair.first.side === side ? pair.first : pair.second.side === side ? pair.second : null;
}

export function wnbaNoVigProbabilityForSide(
  pair: WnbaCompleteMarketPair,
  side: WnbaTargetExcludedSide,
): number | null {
  const picked = wnbaPairRowForSide(pair, side);
  if (!picked) return null;
  const opposite = picked === pair.first ? pair.second : pair.first;
  const pickedImplied = americanBreakEvenProbability(picked.priceAmerican);
  const oppositeImplied = americanBreakEvenProbability(opposite.priceAmerican);
  const sum = pickedImplied + oppositeImplied;
  return sum > 0 ? pickedImplied / sum : null;
}

export function wnbaTargetExcludedFairProbability(args: {
  pairs: readonly WnbaCompleteMarketPair[];
  excludedBook: string;
  side: WnbaTargetExcludedSide;
  canonicalLine: number | null;
}): { probability: number | null; bookCount: number } {
  const values: number[] = [];
  const excluded = normalizedBook(args.excludedBook);
  for (const pair of args.pairs) {
    if (pair.sportsbook === excluded || !sameLine(pair.canonicalLine, args.canonicalLine)) continue;
    const probability = wnbaNoVigProbabilityForSide(pair, args.side);
    if (probability !== null) values.push(probability);
  }
  return { probability: median(values), bookCount: values.length };
}

export function selectWnbaUpperMedianEvaluatedRow(
  pairs: readonly WnbaCompleteMarketPair[],
  side: WnbaTargetExcludedSide,
  line: number | null,
): WnbaTargetExcludedPriceRow | null {
  const candidates = pairs
    .filter((pair) => sameLine(pair.canonicalLine, line))
    .map((pair) => wnbaPairRowForSide(pair, side))
    .filter((row): row is WnbaTargetExcludedPriceRow => row !== null);
  const selectedPrice = median(candidates.map((row) => row.priceAmerican));
  if (selectedPrice === null) return null;
  return candidates
    .filter((row) => row.priceAmerican === selectedPrice)
    .sort((left, right) =>
      (right.observedAt ?? "").localeCompare(left.observedAt ?? "") ||
      normalizedBook(left.sportsbook).localeCompare(normalizedBook(right.sportsbook))
    )[0] ?? null;
}

type SignTiltMoments = {
  standardizedMean: number;
  standardizedVariance: number;
};

function signTiltMoments(thresholdZ: number, positiveProbability: number): SignTiltMoments | null {
  const below = standardNormalCdf(thresholdZ);
  const above = 1 - below;
  if (!(below > 1e-12) || !(above > 1e-12)) return null;
  const density = standardNormalPdf(thresholdZ);
  const upperMills = density / above;
  const lowerMills = density / below;
  const negativeProbability = 1 - positiveProbability;
  const standardizedMean =
    -thresholdZ + density * (positiveProbability / above - negativeProbability / below);
  const secondMoment =
    positiveProbability * (1 - thresholdZ * upperMills + thresholdZ * thresholdZ) +
    negativeProbability * (1 + thresholdZ * lowerMills + thresholdZ * thresholdZ);
  const standardizedVariance = secondMoment - standardizedMean * standardizedMean;
  if (!(standardizedVariance > 0) || !finite(standardizedMean)) return null;
  return { standardizedMean, standardizedVariance };
}

function independentNormal(
  mean: number,
  standardDeviation: number,
  fallbackReason: string,
): WnbaMarginDistribution {
  return {
    kind: "independent_normal_fallback",
    mean,
    standardDeviation,
    variance: standardDeviation * standardDeviation,
    positiveProbability: 1 - standardNormalCdf((0 - mean) / standardDeviation),
    fallbackReason,
  };
}

/**
 * Maximum-entropy distribution under fixed mean, variance and sign mass. Its
 * density is a shared Gaussian kernel with one mass multiplier on x > 0.
 */
export function buildWnbaMaximumEntropyMarginDistribution(args: {
  desiredMean: number;
  independentMean: number;
  standardDeviation: number;
  positiveProbability: number;
}): WnbaMarginDistribution {
  const { desiredMean, independentMean, standardDeviation, positiveProbability } = args;
  if (
    !finite(desiredMean) ||
    !finite(independentMean) ||
    !finite(standardDeviation) ||
    standardDeviation <= 0 ||
    !finite(positiveProbability) ||
    positiveProbability <= 0 ||
    positiveProbability >= 1
  ) return independentNormal(independentMean, Math.max(Math.abs(standardDeviation) || 1, 1e-6), "invalid_constraint");

  const ratio = desiredMean / standardDeviation;
  const positive = positiveProbability;
  const negative = 1 - positive;
  const feasible = desiredMean > 0
    ? ratio * ratio < positive / negative
    : desiredMean < 0
      ? ratio * ratio < negative / positive
      : true;
  if (!feasible) return independentNormal(independentMean, standardDeviation, "cantelli_infeasible");

  const objective = (thresholdZ: number): number | null => {
    const moments = signTiltMoments(thresholdZ, positiveProbability);
    return moments === null
      ? null
      : moments.standardizedMean / Math.sqrt(moments.standardizedVariance) - ratio;
  };
  let lower: number | null = null;
  let upper: number | null = null;
  let previousZ: number | null = null;
  let previousValue: number | null = null;
  for (let index = 0; index <= 320; index += 1) {
    const z = -8 + index * 0.05;
    const value = objective(z);
    if (value === null) continue;
    if (Math.abs(value) < 1e-12) {
      lower = z;
      upper = z;
      break;
    }
    if (previousZ !== null && previousValue !== null && previousValue * value < 0) {
      lower = previousZ;
      upper = z;
      break;
    }
    previousZ = z;
    previousValue = value;
  }
  if (lower === null || upper === null) {
    return independentNormal(independentMean, standardDeviation, "constraint_not_bracketed");
  }
  let lowerBound = lower;
  let upperBound = upper;
  for (let iteration = 0; iteration < 120 && upperBound - lowerBound > 1e-13; iteration += 1) {
    const midpoint: number = (lowerBound + upperBound) / 2;
    const lowerValue = objective(lowerBound);
    const midpointValue = objective(midpoint);
    if (lowerValue === null || midpointValue === null) break;
    if (Math.abs(midpointValue) < 1e-13) {
      lowerBound = midpoint;
      upperBound = midpoint;
      break;
    }
    if (lowerValue * midpointValue <= 0) upperBound = midpoint;
    else lowerBound = midpoint;
  }
  const thresholdZ = (lowerBound + upperBound) / 2;
  const moments = signTiltMoments(thresholdZ, positiveProbability);
  if (moments === null) return independentNormal(independentMean, standardDeviation, "invalid_solution_moments");
  const baseStandardDeviation = standardDeviation / Math.sqrt(moments.standardizedVariance);
  const baseMean = -thresholdZ * baseStandardDeviation;
  const solvedMean = baseStandardDeviation * moments.standardizedMean;
  if (
    !finite(baseMean) ||
    !finite(baseStandardDeviation) ||
    baseStandardDeviation <= 0 ||
    Math.abs(solvedMean - desiredMean) > 1e-9
  ) return independentNormal(independentMean, standardDeviation, "constraint_not_converged");
  return {
    kind: "maximum_entropy_sign_tilt",
    mean: desiredMean,
    standardDeviation,
    variance: standardDeviation * standardDeviation,
    positiveProbability,
    baseMean,
    baseStandardDeviation,
    thresholdZ,
  };
}

export function wnbaMarginDistributionCdf(
  distribution: WnbaMarginDistribution,
  value: number,
): number {
  if (distribution.kind === "independent_normal_fallback") {
    return standardNormalCdf((value - distribution.mean) / distribution.standardDeviation);
  }
  const baseCdfAtZero = standardNormalCdf(distribution.thresholdZ);
  const z = (value - distribution.baseMean) / distribution.baseStandardDeviation;
  const baseCdf = standardNormalCdf(z);
  const positive = distribution.positiveProbability;
  const negative = 1 - positive;
  if (value <= 0) return negative * baseCdf / baseCdfAtZero;
  return negative + positive * (baseCdf - baseCdfAtZero) / (1 - baseCdfAtZero);
}

export function wnbaMarginProbabilityAbove(
  distribution: WnbaMarginDistribution,
  threshold: number,
): number {
  return Math.max(0, Math.min(1, 1 - wnbaMarginDistributionCdf(distribution, threshold)));
}

export function wnbaExactPriceValueGate(args: {
  modelProbability: number | null;
  evaluatedPriceAmerican: number | null;
  pointEdge: number | null;
}): WnbaExactPriceValueGate {
  if (
    args.modelProbability === null ||
    args.evaluatedPriceAmerican === null ||
    args.pointEdge === null ||
    !finite(args.modelProbability) ||
    !finite(args.evaluatedPriceAmerican) ||
    !finite(args.pointEdge) ||
    args.evaluatedPriceAmerican === 0
  ) {
    return {
      grade: "Watchlist",
      eligibleBestAngle: false,
      eligibleLean: false,
      breakEvenProbability: null,
      probabilityEdge: null,
      expectedReturn: null,
    };
  }
  const breakEvenProbability = americanBreakEvenProbability(args.evaluatedPriceAmerican);
  const probabilityEdge = args.modelProbability - breakEvenProbability;
  const expectedReturn = americanExpectedReturn(args.modelProbability, args.evaluatedPriceAmerican);
  const magnitude = Math.abs(args.pointEdge);
  const eligibleBestAngle = magnitude >= 4 && probabilityEdge >= 0.04 && expectedReturn >= 0.02;
  const eligibleLean = magnitude >= 2.5 && probabilityEdge >= 0.02 && expectedReturn >= 0.02;
  return {
    grade: eligibleBestAngle ? "Best Angle" : eligibleLean ? "Lean" : "Watchlist",
    eligibleBestAngle,
    eligibleLean,
    breakEvenProbability,
    probabilityEdge,
    expectedReturn,
  };
}

export function buildWnbaResolvedMarketDecision(args: {
  market: "spread" | "total";
  pairs: readonly WnbaCompleteMarketPair[];
  line: number | null;
  evaluated: WnbaTargetExcludedPriceRow | null;
}): WnbaResolvedMarketDecision {
  const excludedBook = args.evaluated?.sportsbook ?? "";
  const alternatives = args.evaluated
    ? args.pairs.filter((pair) => pair.sportsbook !== normalizedBook(excludedBook))
    : [];
  const bookQualifiedConsensus = uniqueWnbaModalLine(
    alternatives,
    WNBA_TARGET_EXCLUDED_MIN_ALTERNATIVE_BOOKS,
  );
  const consensus = uniqueWnbaModalLine(
    alternatives,
    WNBA_TARGET_EXCLUDED_MIN_ALTERNATIVE_BOOKS,
    2,
  );
  const selectedSide = args.evaluated?.side ?? null;
  const reference = selectedSide === null || args.line === null || args.evaluated === null
    ? { probability: null, bookCount: 0 }
    : wnbaTargetExcludedFairProbability({
        pairs: args.pairs,
        excludedBook,
        side: selectedSide,
        canonicalLine: args.line,
      });
  const consensusQualified =
    consensus !== null &&
    args.line !== null &&
    sameLine(consensus.line, args.line) &&
    reference.bookCount >= WNBA_TARGET_EXCLUDED_MIN_ALTERNATIVE_BOOKS;
  const alternativeLines = alternatives
    .map((pair) => pair.canonicalLine)
    .filter((line): line is number => finite(line));
  const sharpLines = alternatives
    .filter((pair) => pair.sourceClass === "originator")
    .map((pair) => pair.canonicalLine)
    .filter((line): line is number => finite(line));
  return {
    contract_version: WNBA_TARGET_EXCLUDED_MARKET_DECISION_VERSION,
    market: args.market,
    line: args.line,
    evaluated: args.evaluated,
    target_excluded_fair_probability: consensusQualified ? reference.probability : null,
    target_excluded_book_count: reference.bookCount,
    target_excluded_independent_family_count: bookQualifiedConsensus?.independentFamilyCount ?? 0,
    complete_pair_book_count: new Set(args.pairs.map((pair) => pair.sportsbook)).size,
    target_excluded_consensus_line: consensus?.line ?? null,
    target_excluded_consensus_book_count: consensus?.bookCount ?? 0,
    target_excluded_consensus_qualified: consensusQualified,
    unavailable_reason: args.evaluated === null
      ? args.pairs.length === 0 ? "no_fresh_complete_pairs" : "no_exact_evaluated_quote"
      : consensusQualified
        ? null
        : bookQualifiedConsensus !== null && bookQualifiedConsensus.independentFamilyCount < 2
          ? "insufficient_independent_source_families"
        : consensus === null
          ? "insufficient_or_tied_target_excluded_consensus"
          : "target_excluded_line_mismatch",
    target_excluded_sources: alternatives.slice(0, 24).map((pair) => ({
      sportsbook: pair.sportsbook,
      source_class: pair.sourceClass,
      source_family: pair.sourceFamily,
      line: pair.canonicalLine,
    })),
    target_excluded_lines: alternativeLines,
    target_excluded_sharp_lines: sharpLines,
  };
}
