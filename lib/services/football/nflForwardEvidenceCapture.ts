import { createHash } from "node:crypto";
import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import type { NflForwardEvidencePayload, NflForwardPlaybookSplit } from "./nflForwardEvidence";
import type { NflRegularEvaluatedBetDecision, NflRegularDecisionMarket } from "./nflRegularDecisionEvidence";
import type { NflRegularSharpSplit } from "./sharpApiNflSplits";
import type { NflV1WeekOneOutcomeForecast } from "./nflV1WeekOneOutcome";

export const NFL_FORWARD_CONTEXT_CAPTURE_RELEASE =
  "nfl_daily_edge_forward_context_capture_2026_09_02_r1" as const;
export const NFL_FORWARD_CONTEXT_CAPTURE_SCHEMA = "nflfec1" as const;
export const NFL_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET = 8 as const;
export const NFL_FORWARD_CONTEXT_CAPTURE_MAX_PROVENANCE_RECORDS_PER_MARKET = 2 as const;
export const NFL_FORWARD_CONTEXT_CAPTURE_MAX_MARKET_BYTES = 8 * 1024;
export const NFL_FORWARD_CONTEXT_CAPTURE_MAX_GAME_BYTES = 24 * 1024;
export const NFL_FORWARD_CONTEXT_CAPTURE_FRESH_MINUTES = 120 as const;

type Market = NflRegularDecisionMarket;
type CanonicalSide = "h" | "a" | "o" | "u";
type Freshness = "f" | "s" | "x";
type Provider = "b";
type SourceClass = "c" | "n";

/** [observedAt, ageMinutes, freshness, line, away/over price, home/under price]. */
export type NflForwardContextLandmark = readonly [string, number, Freshness, number | null, number, number];
/** [family, provider, source class, ownership family, opening, current]. */
export type NflForwardContextFamily = readonly [
  string,
  Provider,
  SourceClass,
  null,
  NflForwardContextLandmark | null,
  NflForwardContextLandmark,
];

export type NflForwardContextMarket = {
  market: Market;
  evaluated: {
    identity: string;
    family: string;
    side: CanonicalSide;
    line: number | null;
    price: number;
    observedAt: string;
    completePairRetained: boolean;
  } | null;
  families: NflForwardContextFamily[];
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

export type NflForwardContextCapture = {
  release: typeof NFL_FORWARD_CONTEXT_CAPTURE_RELEASE;
  schema: typeof NFL_FORWARD_CONTEXT_CAPTURE_SCHEMA;
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
    status: "available" | "unavailable";
    reason: "week_one_artifact_target_free" | "no_fully_target_free_weekly_total_prior_loaded";
    release: string;
    outcome: ReturnType<typeof compactForecast> | null;
  };
  authoritative: ReturnType<typeof compactForecast> & {
    decisions: Array<NonNullable<ReturnType<typeof compactDecision>>>;
  };
  markets: Record<Market, NflForwardContextMarket>;
  context: {
    rosterDepthSha256: string;
    injurySha256: string | null;
    weatherSha256: string;
    quarterbacks: {
      away: readonly [string | null, string | null, string, string];
      home: readonly [string | null, string | null, string, string];
    };
    injury: readonly [string | null, string | null, string | null, number];
    weather: readonly [string, string, string];
  };
  coherence: {
    priorPmfValid: boolean | null;
    authoritativePmfValid: boolean;
    expectedScoresMatchPmf: boolean;
    winnerMatchesScore: boolean;
    allEvaluatedFamiliesExcluded: boolean;
    missingEvidenceNeutral: true;
  };
  bytes: number;
};

export function buildNflForwardContextCapture(args: {
  payload: NflForwardEvidencePayload;
  independentForecast: NflV1WeekOneOutcomeForecast;
  independentTargetFree: boolean;
  independentRelease: string;
  authoritativeForecast: NflV1WeekOneOutcomeForecast;
}): NflForwardContextCapture | null {
  try {
    const decisions = new Map(args.payload.decisions.evaluatedBets.map((row) => [row.market, row]));
    const markets = Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [
      market,
      buildMarket({
        market,
        capturedAt: args.payload.capturedAt,
        currentBooks: args.payload.market.comparableCurrentBooks,
        openingBooks: args.payload.market.comparableProviderOpeningBooks,
        operationalOpening: args.payload.market.operationalOpening.quote,
        decision: decisions.get(market) ?? null,
        homeTeam: args.payload.game.home.abbreviation,
        publicEvidence: args.payload.market.playbookSplits?.[market] ?? null,
        sharpEvidence: args.payload.market.sharpApiSplits?.[market] ?? null,
      }),
    ])) as Record<Market, NflForwardContextMarket>;
    if (Object.values(markets).some((market) => market.bytes > NFL_FORWARD_CONTEXT_CAPTURE_MAX_MARKET_BYTES)) return null;
    const firstDecision = args.payload.decisions.evaluatedBets[0] ?? null;
    const capture = withBytes({
      release: NFL_FORWARD_CONTEXT_CAPTURE_RELEASE,
      schema: NFL_FORWARD_CONTEXT_CAPTURE_SCHEMA,
      mode: "capture_only" as const,
      productionDecisionEffect: false as const,
      gameId: args.payload.game.providerGameId,
      capturedAt: args.payload.capturedAt,
      releases: {
        evidence: args.payload.schemaRelease,
        collector: args.payload.collectorRelease,
        member: args.payload.decisions.modelPromotionStatus,
        model: firstDecision?.modelRelease ?? null,
        calibration: firstDecision?.calibrationRelease ?? null,
        decision: firstDecision?.decisionRelease ?? null,
      },
      prior: {
        status: args.independentTargetFree ? "available" as const : "unavailable" as const,
        reason: args.independentTargetFree
          ? "week_one_artifact_target_free" as const
          : "no_fully_target_free_weekly_total_prior_loaded" as const,
        release: args.independentRelease,
        outcome: args.independentTargetFree ? compactForecast(args.independentForecast) : null,
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
        priorPmfValid: args.independentTargetFree ? validForecast(args.independentForecast) : null,
        authoritativePmfValid: validForecast(args.authoritativeForecast),
        expectedScoresMatchPmf: expectedScoresMatch(args.authoritativeForecast),
        winnerMatchesScore: (args.authoritativeForecast.homeWinProbability >= 0.5) ===
          (args.authoritativeForecast.expectedHomeScore >= args.authoritativeForecast.expectedAwayScore),
        allEvaluatedFamiliesExcluded: Object.values(markets).every((market) => market.coherence.evaluatedFamilyExcluded),
        missingEvidenceNeutral: true as const,
      },
      bytes: 0,
    });
    return nflForwardContextCaptureAddedBytes(capture) <= NFL_FORWARD_CONTEXT_CAPTURE_MAX_GAME_BYTES
      ? capture
      : null;
  } catch {
    return null;
  }
}

function buildMarket(args: {
  market: Market;
  capturedAt: string;
  currentBooks: NflPreviewBookOdds[];
  openingBooks: NflPreviewBookOdds[];
  operationalOpening: NflPreviewBookOdds;
  decision: NflRegularEvaluatedBetDecision | null;
  homeTeam: string;
  publicEvidence: NflForwardPlaybookSplit | null;
  sharpEvidence: NflRegularSharpSplit | null;
}): NflForwardContextMarket {
  const complete = uniqueFamilies(args.currentBooks.filter((book) => quote(book, args.market) !== null));
  const evaluatedFamily = canonicalBook(args.decision?.evaluatedQuote.sportsbook ?? "");
  const ordered = [...complete].sort((first, second) =>
    priority(first, evaluatedFamily) - priority(second, evaluatedFamily) ||
    canonicalBook(first.sportsbook).localeCompare(canonicalBook(second.sportsbook)));
  const retained = ordered.slice(0, NFL_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET);
  const openingByFamily = earliestByFamily([
    ...args.openingBooks,
    args.operationalOpening,
  ].filter((book) => quote(book, args.market) !== null));
  const families = retained.map((book): NflForwardContextFamily => {
    const family = canonicalBook(book.sportsbook);
    return [
      family,
      "b",
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
      args.decision.providerGameId, args.market, evaluatedFamily,
      args.decision.evaluatedQuote.line, args.decision.evaluatedQuote.price,
      args.decision.evaluatedQuote.observedAt,
    ]),
    family: evaluatedFamily,
    side: sideCode(args.decision.side, args.market, args.homeTeam),
    line: args.decision.evaluatedQuote.line,
    price: args.decision.evaluatedQuote.price,
    observedAt: args.decision.evaluatedQuote.observedAt,
    completePairRetained: retainedNames.has(evaluatedFamily),
  } : null;
  const market = {
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
  };
  return withBytes(market);
}

function compactForecast(forecast: NflV1WeekOneOutcomeForecast) {
  return {
    pmf: {
      margin: distributionSummary(forecast.marginDistribution),
      total: distributionSummary(forecast.totalDistribution),
    },
    expected: [forecast.expectedAwayScore, forecast.expectedHomeScore] as const,
    representative: [forecast.representativeAwayScore, forecast.representativeHomeScore] as const,
    win: [forecast.awayWinProbability, forecast.homeWinProbability, forecast.tieProbability] as const,
  };
}

function distributionSummary(distribution: { values: number[]; probabilities: number[] }) {
  const mass = distribution.probabilities.reduce((sum, value) => sum + value, 0);
  const mean = distribution.values.reduce((sum, value, index) => sum + value * distribution.probabilities[index]!, 0);
  const variance = distribution.values.reduce((sum, value, index) =>
    sum + (value - mean) ** 2 * distribution.probabilities[index]!, 0);
  return { sha256: hash(distribution), support: distribution.values.length, mass, mean, sd: Math.sqrt(Math.max(0, variance)) };
}

function compactDecision(decision: NflRegularEvaluatedBetDecision | null, homeTeam: string) {
  if (!decision) return null;
  return {
    market: decision.market,
    side: sideCode(decision.side, decision.market, homeTeam),
    probability: decision.modelProbability,
    marketFairProbability: decision.marketFairProbability,
    grade: decision.grade,
    edgePp: 100 * (decision.modelProbability - decision.marketFairProbability),
    ev: decision.expectedValue,
    stake: null,
    quoteIdentity: shortHash([
      decision.providerGameId, decision.market, canonicalBook(decision.evaluatedQuote.sportsbook),
      decision.evaluatedQuote.line, decision.evaluatedQuote.price, decision.evaluatedQuote.observedAt,
    ]),
  };
}

function compactPublic(value: NflForwardPlaybookSplit | null, market: Market = "moneyline") {
  if (!value) return null;
  return market === "total"
    ? ["p", value.capturedAt, value.booksUsed, value.overMoneyPct, value.overBetsPct, value.underMoneyPct, value.underBetsPct] as const
    : ["p", value.capturedAt, value.booksUsed, value.homeMoneyPct, value.homeBetsPct, value.awayMoneyPct, value.awayBetsPct] as const;
}

function compactSharp(value: NflRegularSharpSplit | null, market: Market = "moneyline") {
  if (!value) return null;
  const family = canonicalBook(value.sourceSportsbook ?? "");
  return market === "total"
    ? ["s", family, value.sourceEventId, value.providerFetchedAt, value.capturedAt, value.overMoneyPct, value.overBetsPct, value.underMoneyPct, value.underBetsPct] as const
    : ["s", family, value.sourceEventId, value.providerFetchedAt, value.capturedAt, value.homeMoneyPct, value.homeBetsPct, value.awayMoneyPct, value.awayBetsPct] as const;
}

function compactContext(payload: NflForwardEvidencePayload): NflForwardContextCapture["context"] {
  const qb = (side: "away" | "home") => {
    const value = payload.startersAndDepth[side];
    return [
      value.expectedStartingQuarterback?.playerId ?? null,
      bounded(value.expectedStartingQuarterback?.name ?? null),
      value.starterStatus,
      value.capturedAt,
    ] as const;
  };
  return {
    rosterDepthSha256: hash(payload.startersAndDepth),
    injurySha256: payload.injuries ? hash(payload.injuries) : null,
    weatherSha256: hash(payload.weather),
    quarterbacks: { away: qb("away"), home: qb("home") },
    injury: [payload.injuries?.source ?? null, payload.injuries?.reportUpdatedAt ?? null,
      payload.injuries?.freshnessStatus ?? null,
      payload.injuries?.teams.reduce((sum, team) => sum + team.players.length, 0) ?? 0],
    weather: [payload.weather.status, payload.weather.capturedAt, hash(payload.weather.forecast)],
  };
}

function quote(book: NflPreviewBookOdds, market: Market) {
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

function landmark(book: NflPreviewBookOdds | null, market: Market, capturedAt: string): NflForwardContextLandmark | null {
  if (!book) return null;
  const value = quote(book, market);
  if (!value) return null;
  const ageMinutes = (Date.parse(capturedAt) - Date.parse(book.observedAt)) / 60_000;
  const freshness: Freshness = ageMinutes < 0 ? "x" : ageMinutes <= NFL_FORWARD_CONTEXT_CAPTURE_FRESH_MINUTES ? "f" : "s";
  return [book.observedAt, ageMinutes, freshness, ...value];
}

function earliestByFamily(books: NflPreviewBookOdds[]) {
  const result = new Map<string, NflPreviewBookOdds>();
  for (const book of books) {
    const family = canonicalBook(book.sportsbook);
    const prior = result.get(family);
    if (!prior || prior.observedAt > book.observedAt) result.set(family, book);
  }
  return result;
}

function uniqueFamilies(books: NflPreviewBookOdds[]) {
  const result = new Map<string, NflPreviewBookOdds>();
  for (const book of books) if (!result.has(canonicalBook(book.sportsbook))) result.set(canonicalBook(book.sportsbook), book);
  return [...result.values()];
}

function priority(book: NflPreviewBookOdds, evaluated: string) {
  const family = canonicalBook(book.sportsbook);
  return family === evaluated ? 0 : family === "circa" ? 1 : 2;
}

function sideCode(side: string, market: Market, homeTeam: string): CanonicalSide {
  if (market === "total") return side.startsWith("Under") ? "u" : "o";
  return side === homeTeam || side.startsWith(`${homeTeam} `) ? "h" : "a";
}

function validForecast(forecast: NflV1WeekOneOutcomeForecast) {
  return Math.abs(distributionSummary(forecast.marginDistribution).mass - 1) < 0.000001 &&
    Math.abs(distributionSummary(forecast.totalDistribution).mass - 1) < 0.000001;
}

function expectedScoresMatch(forecast: NflV1WeekOneOutcomeForecast) {
  const margin = distributionSummary(forecast.marginDistribution).mean;
  const total = distributionSummary(forecast.totalDistribution).mean;
  return Math.abs((total - margin) / 2 - forecast.expectedAwayScore) < 0.00001 &&
    Math.abs((total + margin) / 2 - forecast.expectedHomeScore) < 0.00001;
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

export function nflForwardContextCaptureAddedBytes(capture: NflForwardContextCapture): number {
  return byteLength({ contextualEvidenceCapture: capture }) - byteLength({});
}
