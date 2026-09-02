import { createHash } from "node:crypto";
import type { NcaafBookOdds } from "./balldontlieNcaafSlate";
import type {
  CfbForwardEvidencePayload,
  CfbForwardPlaybookSplit,
} from "./cfbForwardEvidence";
import type { CfbSharpApiSplitRecord } from "./cfbSharpApiSplits";
import type { CfbV1ExactPriceDecision, CfbV1Forecast, CfbV1Market } from "./cfbV1Decision";

export const CFB_FORWARD_CONTEXT_CAPTURE_RELEASE =
  "cfb_daily_edge_forward_context_capture_2026_09_02_r1" as const;
export const CFB_FORWARD_CONTEXT_CAPTURE_SCHEMA = "cfbfec1" as const;
export const CFB_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET = 8 as const;
export const CFB_FORWARD_CONTEXT_CAPTURE_MAX_PROVENANCE_RECORDS_PER_MARKET = 2 as const;
export const CFB_FORWARD_CONTEXT_CAPTURE_MAX_MARKET_BYTES = 8 * 1024;
export const CFB_FORWARD_CONTEXT_CAPTURE_MAX_GAME_BYTES = 24 * 1024;
export const CFB_FORWARD_CONTEXT_CAPTURE_FRESH_MINUTES = 120 as const;

type Market = CfbV1Market;
type CanonicalSide = "h" | "a" | "o" | "u";
type Freshness = "f" | "s" | "x";
type Provider = "b" | "s";
type SourceClass = "c" | "n";

/** [observedAt, ageMinutes, freshness, line, away/over price, home/under price]. */
export type CfbForwardContextLandmark = readonly [string, number, Freshness, number | null, number, number];
/** [family, provider, source class, ownership family, opening, current]. */
export type CfbForwardContextFamily = readonly [
  string,
  Provider,
  SourceClass,
  null,
  CfbForwardContextLandmark | null,
  CfbForwardContextLandmark,
];

export type CfbForwardContextMarket = {
  market: Market;
  evaluated: {
    identity: string;
    family: string;
    provider: Provider;
    side: CanonicalSide;
    line: number | null;
    price: number;
    observedAt: string;
    completePairRetained: boolean;
  } | null;
  families: CfbForwardContextFamily[];
  targetExcludedFamilies: string[];
  coverage: {
    completeObserved: number;
    completeRetained: number;
    completeOmitted: number;
    targetExcludedObserved: number;
    targetExcludedRetained: number;
    chronologyPairsRetained: number;
    ownershipMetadata: "not_loaded";
    truncated: boolean;
  };
  public: ReturnType<typeof compactPublic>;
  sharp: ReturnType<typeof compactSharp>;
  final: ReturnType<typeof compactDecision>;
  coherence: {
    evaluatedFamilyExcluded: boolean;
    exactPairComplete: boolean;
  };
  bytes: number;
};

export type CfbForwardContextCapture = {
  release: typeof CFB_FORWARD_CONTEXT_CAPTURE_RELEASE;
  schema: typeof CFB_FORWARD_CONTEXT_CAPTURE_SCHEMA;
  mode: "capture_only";
  productionDecisionEffect: false;
  gameId: string;
  capturedAt: string;
  releases: {
    evidence: string;
    collector: string;
    member: string;
    model: string | null;
    calibration: string | null;
    decision: string | null;
  };
  prior: {
    status: "available";
    reason: "pre_market_independent_weekly_pmf";
    release: string;
    outcome: ReturnType<typeof compactForecast>;
  };
  authoritative: ReturnType<typeof compactForecast> & {
    decisions: Array<NonNullable<ReturnType<typeof compactDecision>>>;
  };
  markets: Record<Market, CfbForwardContextMarket>;
  context: {
    quarterbacksSha256: string;
    availabilitySha256: string;
    weatherSha256: string | null;
    quarterbacks: {
      away: readonly [string | null, string | null, string, string];
      home: readonly [string | null, string | null, string, string];
    };
    injury: readonly ["provider_unavailable"];
    weather: readonly [string, string, number, string] | null;
  };
  coherence: {
    priorPmfValid: boolean;
    authoritativePmfValid: boolean;
    expectedScoresMatchPmf: boolean;
    winnerMatchesScore: boolean;
    allEvaluatedFamiliesExcluded: boolean;
    missingEvidenceNeutral: true;
  };
  bytes: number;
};

export function buildCfbForwardContextCapture(args: {
  payload: CfbForwardEvidencePayload;
  independentForecast: CfbV1Forecast;
  independentRelease: string;
  authoritativeForecast: CfbV1Forecast;
  openingBooks: NcaafBookOdds[];
}): CfbForwardContextCapture | null {
  try {
    const decisions = new Map(args.payload.decisions.evaluatedBets.map((row) => [row.market, row]));
    const markets = Object.fromEntries(((["moneyline", "spread", "total"] as const).map((market) => [
      market,
      buildMarket({
        market,
        capturedAt: args.payload.capturedAt,
        currentBooks: args.payload.market.currentBooks,
        openingBooks: args.openingBooks,
        operationalOpening: args.payload.market.operationalOpening?.quote ?? null,
        decision: decisions.get(market) ?? null,
        homeTeam: args.payload.game.home.abbreviation,
        publicEvidence: args.payload.market.playbookSplits?.[market] ?? null,
        sharpEvidence: selectSharp(args.payload.market.sharpApiSplits ?? [], market),
      }),
    ]))) as Record<Market, CfbForwardContextMarket>;
    if (Object.values(markets).some((market) => market.bytes > CFB_FORWARD_CONTEXT_CAPTURE_MAX_MARKET_BYTES)) return null;
    const firstDecision = args.payload.decisions.evaluatedBets[0] ?? null;
    const capture = withBytes({
      release: CFB_FORWARD_CONTEXT_CAPTURE_RELEASE,
      schema: CFB_FORWARD_CONTEXT_CAPTURE_SCHEMA,
      mode: "capture_only" as const,
      productionDecisionEffect: false as const,
      gameId: args.payload.game.providerGameId,
      capturedAt: args.payload.capturedAt,
      releases: {
        evidence: args.payload.schemaRelease,
        collector: args.payload.collectorRelease,
        member: args.payload.memberRelease,
        model: firstDecision?.modelRelease ?? null,
        calibration: firstDecision?.calibrationRelease ?? null,
        decision: firstDecision?.decisionRelease ?? null,
      },
      prior: {
        status: "available" as const,
        reason: "pre_market_independent_weekly_pmf" as const,
        release: args.independentRelease,
        outcome: compactForecast(args.independentForecast),
      },
      authoritative: {
        ...compactForecast(args.authoritativeForecast),
        decisions: args.payload.decisions.evaluatedBets
          .map((decision) => compactDecision(decision, args.payload.game.home.abbreviation))
          .filter(nonNull),
      },
      markets,
      context: compactContext(args.payload),
      coherence: {
        priorPmfValid: validForecast(args.independentForecast),
        authoritativePmfValid: validForecast(args.authoritativeForecast),
        expectedScoresMatchPmf: expectedScoresMatch(args.authoritativeForecast),
        winnerMatchesScore: (args.authoritativeForecast.homeWinProbability >= 0.5) ===
          (args.authoritativeForecast.expectedHomePoints >= args.authoritativeForecast.expectedAwayPoints),
        allEvaluatedFamiliesExcluded: Object.values(markets).every((market) => market.coherence.evaluatedFamilyExcluded),
        missingEvidenceNeutral: true as const,
      },
      bytes: 0,
    });
    return cfbForwardContextCaptureAddedBytes(capture) <= CFB_FORWARD_CONTEXT_CAPTURE_MAX_GAME_BYTES
      ? capture
      : null;
  } catch {
    return null;
  }
}

function buildMarket(args: {
  market: Market;
  capturedAt: string;
  currentBooks: NcaafBookOdds[];
  openingBooks: NcaafBookOdds[];
  operationalOpening: NcaafBookOdds | null;
  decision: CfbV1ExactPriceDecision | null;
  homeTeam: string;
  publicEvidence: CfbForwardPlaybookSplit | null;
  sharpEvidence: CfbSharpApiSplitRecord | null;
}): CfbForwardContextMarket {
  const complete = uniqueFamilies(args.currentBooks.filter((book) => quote(book, args.market) !== null));
  const evaluatedFamily = canonicalBook(args.decision?.evaluatedQuote.sportsbook ?? "");
  const ordered = [...complete].sort((first, second) =>
    priority(first, evaluatedFamily) - priority(second, evaluatedFamily) ||
    canonicalBook(first.sportsbook).localeCompare(canonicalBook(second.sportsbook)));
  const retained = ordered.slice(0, CFB_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET);
  const openingByFamily = earliestByFamily([
    ...args.openingBooks,
    ...(args.operationalOpening ? [args.operationalOpening] : []),
  ].filter((book) => quote(book, args.market) !== null));
  const families = retained.map((book): CfbForwardContextFamily => {
    const family = canonicalBook(book.sportsbook);
    return [
      family,
      providerCode(book),
      family === "circa" ? "c" : "n",
      null,
      landmark(openingByFamily.get(family) ?? null, args.market, args.capturedAt),
      landmark(book, args.market, args.capturedAt)!,
    ];
  });
  const retainedNames = new Set(families.map((family) => family[0]));
  const targetExcludedObserved = complete.filter((book) => canonicalBook(book.sportsbook) !== evaluatedFamily).length;
  const targetExcludedFamilies = families.map((family) => family[0]).filter((family) => family !== evaluatedFamily);
  const evaluated = args.decision ? {
    identity: shortHash([
      args.decision.providerGameId, args.market, args.decision.evaluatedQuote.provider,
      evaluatedFamily, args.decision.evaluatedQuote.line, args.decision.evaluatedQuote.price,
      args.decision.evaluatedQuote.observedAt,
    ]),
    family: evaluatedFamily,
    provider: args.decision.evaluatedQuote.provider === "sharpapi" ? "s" as const : "b" as const,
    side: sideCode(args.decision.side, args.market, args.homeTeam),
    line: args.decision.evaluatedQuote.line,
    price: args.decision.evaluatedQuote.price,
    observedAt: args.decision.evaluatedQuote.observedAt,
    completePairRetained: retainedNames.has(evaluatedFamily),
  } : null;
  return withBytes({
    market: args.market,
    evaluated,
    families,
    targetExcludedFamilies,
    coverage: {
      completeObserved: complete.length,
      completeRetained: families.length,
      completeOmitted: Math.max(0, complete.length - families.length),
      targetExcludedObserved,
      targetExcludedRetained: targetExcludedFamilies.length,
      chronologyPairsRetained: families.filter((family) => family[4] !== null).length,
      ownershipMetadata: "not_loaded" as const,
      truncated: complete.length > families.length,
    },
    public: compactPublic(args.publicEvidence, args.market),
    sharp: compactSharp(args.sharpEvidence, args.market),
    final: compactDecision(args.decision, args.homeTeam),
    coherence: {
      evaluatedFamilyExcluded: evaluated === null || !targetExcludedFamilies.includes(evaluated.family),
      exactPairComplete: evaluated === null || evaluated.completePairRetained,
    },
    bytes: 0,
  });
}

function compactForecast(forecast: CfbV1Forecast) {
  return {
    pmf: {
      sha256: hash(forecast.pmf),
      cells: forecast.pmf.length,
      mass: forecast.pmf.reduce((sum, cell) => sum + cell.probability, 0),
    },
    expected: [forecast.expectedAwayPoints, forecast.expectedHomePoints] as const,
    representative: [forecast.representativeScore.away, forecast.representativeScore.home] as const,
    homeWin: forecast.homeWinProbability,
    interval80: forecast.interval80,
  };
}

function compactDecision(decision: CfbV1ExactPriceDecision | null, homeTeam: string) {
  if (!decision) return null;
  return {
    market: decision.market,
    side: sideCode(decision.side, decision.market, homeTeam),
    probability: decision.modelProbability,
    marketFairProbability: decision.marketFairProbability,
    grade: decision.grade,
    edgePp: decision.edgePercentagePoints,
    ev: decision.expectedValue,
    stake: null,
    quoteIdentity: shortHash([
      decision.providerGameId, decision.market, decision.evaluatedQuote.provider,
      canonicalBook(decision.evaluatedQuote.sportsbook), decision.evaluatedQuote.line,
      decision.evaluatedQuote.price, decision.evaluatedQuote.observedAt,
    ]),
  };
}

function compactPublic(value: CfbForwardPlaybookSplit | null, market: Market) {
  if (!value) return null;
  return market === "total"
    ? ["p", value.capturedAt, value.booksUsed, value.overMoneyPct, value.overBetsPct, value.underMoneyPct, value.underBetsPct] as const
    : ["p", value.capturedAt, value.booksUsed, value.homeMoneyPct, value.homeBetsPct, value.awayMoneyPct, value.awayBetsPct] as const;
}

function compactSharp(value: CfbSharpApiSplitRecord | null, market: Market) {
  if (!value) return null;
  const semantics = value.sourceSemantics === "sharp_adjacent" ? "c" as const : "p" as const;
  const source = ["s", value.sportsbook, semantics, value.providerEventId, value.capturedAt] as const;
  if (market === "total" && value.total) return [...source,
    value.total.over.moneyPct, value.total.over.ticketsPct,
    value.total.under.moneyPct, value.total.under.ticketsPct] as const;
  const marketValue = market === "moneyline" ? value.moneyline : value.spread;
  return marketValue ? [...source,
    marketValue.home.moneyPct, marketValue.home.ticketsPct,
    marketValue.away.moneyPct, marketValue.away.ticketsPct] as const : null;
}

function selectSharp(rows: CfbSharpApiSplitRecord[], market: Market) {
  return [...rows].filter((row) => row[market] !== null)
    .sort((first, second) => sharpPriority(first) - sharpPriority(second))[0] ?? null;
}

function compactContext(payload: CfbForwardEvidencePayload): CfbForwardContextCapture["context"] {
  const quarterback = (side: "away" | "home") => {
    const value = payload.quarterbacks[side];
    return [
      value.expectedStartingQuarterback?.playerId ?? null,
      bounded(value.expectedStartingQuarterback?.name ?? null),
      value.starterStatus,
      value.capturedAt,
    ] as const;
  };
  const weather = payload.availability.weather;
  return {
    quarterbacksSha256: hash(payload.quarterbacks),
    availabilitySha256: hash(payload.availability),
    weatherSha256: weather ? hash(weather) : null,
    quarterbacks: { away: quarterback("away"), home: quarterback("home") },
    injury: ["provider_unavailable"] as const,
    weather: weather
      ? [weather.status, weather.capturedAt, weather.independentTotalAdjustmentPoints, hash(weather.forecast)] as const
      : null,
  };
}

function quote(book: NcaafBookOdds, market: Market) {
  if (market === "moneyline") {
    const value = book.moneyline;
    return value ? [null, value.awayPrice, value.homePrice] as const : null;
  }
  if (market === "spread") {
    const value = book.spread;
    return value ? [value.homeLine, value.awayPrice, value.homePrice] as const : null;
  }
  const value = book.total;
  return value ? [value.line, value.overPrice, value.underPrice] as const : null;
}

function landmark(book: NcaafBookOdds | null, market: Market, capturedAt: string): CfbForwardContextLandmark | null {
  if (!book) return null;
  const value = quote(book, market);
  if (!value) return null;
  const observedAt = book.marketObservedAt?.[market] ?? book.observedAt;
  const ageMinutes = (Date.parse(capturedAt) - Date.parse(observedAt)) / 60_000;
  const freshness: Freshness = ageMinutes < 0 ? "x" : ageMinutes <= CFB_FORWARD_CONTEXT_CAPTURE_FRESH_MINUTES ? "f" : "s";
  return [observedAt, ageMinutes, freshness, ...value];
}

function earliestByFamily(books: NcaafBookOdds[]) {
  const result = new Map<string, NcaafBookOdds>();
  for (const book of books) {
    const family = canonicalBook(book.sportsbook);
    const prior = result.get(family);
    if (!prior || prior.observedAt > book.observedAt) result.set(family, book);
  }
  return result;
}

function uniqueFamilies(books: NcaafBookOdds[]) {
  const result = new Map<string, NcaafBookOdds>();
  for (const book of books) if (!result.has(canonicalBook(book.sportsbook))) result.set(canonicalBook(book.sportsbook), book);
  return [...result.values()];
}

function priority(book: NcaafBookOdds, evaluated: string) {
  const family = canonicalBook(book.sportsbook);
  return family === evaluated ? 0 : family === "circa" ? 1 : 2;
}
function sharpPriority(row: CfbSharpApiSplitRecord) { return row.sportsbook === "circa" ? 0 : 1; }
function providerCode(book: NcaafBookOdds): Provider { return book.provider === "sharpapi" ? "s" : "b"; }
function sideCode(side: string, market: Market, homeTeam: string): CanonicalSide {
  if (market === "total") return side.toLowerCase().startsWith("under") ? "u" : "o";
  return side === homeTeam || side.startsWith(`${homeTeam} `) || side === "home" ? "h" : "a";
}
function validForecast(forecast: CfbV1Forecast) {
  return Math.abs(forecast.pmf.reduce((sum, cell) => sum + cell.probability, 0) - 1) < 0.000001;
}
function expectedScoresMatch(forecast: CfbV1Forecast) {
  const away = forecast.pmf.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
  const home = forecast.pmf.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
  return Math.abs(away - forecast.expectedAwayPoints) < 0.00001 &&
    Math.abs(home - forecast.expectedHomePoints) < 0.00001;
}
function canonicalBook(value: string) { return bounded(value.toLowerCase().replace(/[^a-z0-9]/g, "")) ?? "unknown"; }
function bounded(value: string | null) { return value === null ? null : value.slice(0, 64); }
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex"); }
function shortHash(values: unknown[]) { return hash(values).slice(0, 16); }
function byteLength(value: unknown) { return Buffer.byteLength(JSON.stringify(value)); }
function withBytes<T extends { bytes: number }>(value: T): T {
  let bytes = byteLength(value);
  let next = { ...value, bytes };
  for (let index = 0; index < 3; index++) {
    bytes = byteLength(next);
    next = { ...next, bytes };
  }
  return next;
}
function nonNull<T>(value: T | null): value is T { return value !== null; }

export function cfbForwardContextCaptureAddedBytes(capture: CfbForwardContextCapture): number {
  return byteLength({ contextualEvidenceCapture: capture }) - byteLength({});
}
