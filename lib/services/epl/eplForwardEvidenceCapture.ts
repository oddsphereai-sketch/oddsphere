import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { EplSharpFixtureMarket, EplSharpOddsRecord, EplSharpSplitsEvent } from "@/lib/providers/real_api/SharpApiEplMarketProvider";
import type { EplShadowSlate, EplShadowSlateMatch } from "./buildEplShadowSlate";

export const EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE = "epl_forward_evidence_capture_2026_09_02_r1" as const;
export const EPL_FORWARD_EVIDENCE_MAX_GAME_BYTES = 64 * 1024;
export const EPL_FORWARD_EVIDENCE_MAX_MARKET_BYTES = 16 * 1024;
export const EPL_FORWARD_EVIDENCE_MAX_VECTORS_PER_MARKET = 8;
export const EPL_FORWARD_EVIDENCE_MAX_LANDMARKS = 6;

const MARKET_ORDER = ["match_result", "double_chance", "total", "btts"] as const;
const BOOK_PRIORITY = ["pinnacle", "circa", "draftkings", "fanduel", "betmgm", "caesars"] as const;
const RETAIL_BOOKS = new Set(["draftkings", "fanduel", "betmgm", "caesars"]);
const ORIGINATOR_BOOKS = new Set(["pinnacle", "circa"]);

export type EplForwardMarket = (typeof MARKET_ORDER)[number];
type SourceClass = "named_originator" | "named_retail" | "named_other" | "provider_consensus" | "unknown";

export type EplForwardStoredPriceObservation = {
  providerId: number;
  market: EplForwardMarket;
  side: string;
  line: number | null;
  american: number;
  sportsbook: string | null;
  recordedAt: string;
  isOpener: boolean;
  provider?: "balldontlie" | "sharpapi" | null;
  providerEndpoint?: string | null;
};

export type EplForwardOutcomeQuote = {
  side: string;
  american: number;
  decimal: number;
  rawImpliedProbability: number;
  noVigProbability: number;
  fetchedAt: string | null;
  fetchedAtSource: "provider" | "oddsphere_capture" | null;
};

export type EplForwardBookVector = {
  identity: string;
  sportsbook: string;
  canonicalBook: string;
  sourceClass: SourceClass;
  provider: "sharpapi" | "balldontlie";
  providerEndpoint: string;
  providerEventId: string | null;
  market: EplForwardMarket;
  line: number | null;
  capturedAt: string;
  fetchedAtMin: string | null;
  fetchedAtMax: string | null;
  vectorSkewMs: number | null;
  overround: number;
  probabilityTotal: 1 | 2;
  outcomes: EplForwardOutcomeQuote[];
};

type EplForwardMovement = {
  vectorIdentity: string;
  sportsbook: string;
  scope: "same_book_market_outcome_line";
  openingObservedAtMin: string;
  openingObservedAtMax: string;
  openingVectorSkewMs: number;
  openingProvider: "balldontlie" | "sharpapi" | null;
  openingProviderEndpoint: string | null;
  openingProviderUnavailableReason: string | null;
  currentCapturedAt: string;
  currentFetchedAt: string | null;
  outcomes: Array<{ side: string; openingAmerican: number; currentAmerican: number; americanDelta: number; noVigProbabilityDelta: number }>;
};

export type EplForwardMarketSlice = {
  market: EplForwardMarket;
  line: number | null;
  requiredOutcomes: string[];
  evaluated: EplForwardBookVector | null;
  targetExcluded: EplForwardBookVector[];
  omittedVectorCount: number;
  completeVectorCount: number;
  namedCompleteBookCount: number;
  targetExcludedCount: number;
  sourceClassCounts: Partial<Record<SourceClass, number>>;
  outcomeProbabilityRanges: Array<{ side: string; min: number; max: number; spread: number }>;
  movements: EplForwardMovement[];
  circaVectorIdentity: string | null;
  publicEvidence: {
    state: "present" | "unavailable" | "error";
    provider: "sharpapi";
    providerEndpoint: "/splits";
    providerEventId: string | null;
    providerEventIdUnavailableReason: string | null;
    sportsbook: string | null;
    sportsbookUnavailableReason: string | null;
    fetchedAt: string | null;
    fetchedAtSource: "provider" | null;
    fetchedAtUnavailableReason: string | null;
    betsPct: Record<string, number | null>;
    handlePct: Record<string, number | null>;
  } | null;
  unavailableReasons: {
    evaluated: string | null;
    targetExcluded: string | null;
    movement: string | null;
    publicEvidence: string | null;
    circa: string | null;
  };
};

export type EplForwardEvidenceCapture = {
  schemaVersion: 1;
  captureRelease: typeof EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE;
  providerFixtureId: number;
  competition: "english_premier_league";
  kickoff: string;
  capturedAt: string;
  modelRelease: string;
  calibrationRelease: string;
  independent: {
    trainedThrough: string;
    trainingMatches: number;
    lambdaHome: number;
    lambdaAway: number;
    expectedTotal: number;
    probabilities: EplShadowSlateMatch["prediction"]["probabilities"];
    rawDerivedProbabilities: EplShadowSlateMatch["prediction"]["rawDerivedProbabilities"];
    confidence: EplShadowSlateMatch["prediction"]["confidence"];
    homeStrengthSource: EplShadowSlateMatch["prediction"]["homeStrengthSource"];
    awayStrengthSource: EplShadowSlateMatch["prediction"]["awayStrengthSource"];
    homeEffectiveMatches: number;
    awayEffectiveMatches: number;
    evidence: EplShadowSlateMatch["evidence"];
    unavailableReasons: string[];
  };
  champion: {
    projected: DailyEdgeGameDto["projected"];
    soccerProjection: DailyEdgeGameDto["soccerProjection"];
    markets: Record<EplForwardMarket, {
      pick: string | null;
      selectedSide: string | null;
      modelProbability: number | null;
      marketProbability: number | null;
      currentPriceAmerican: number | null;
      currentPriceSportsbook: string | null;
      grade: string | null;
    }>;
  };
  markets: Record<EplForwardMarket, EplForwardMarketSlice>;
};

export type EplForwardEvidenceHistory = {
  schemaVersion: 1;
  captureRelease: typeof EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE;
  omittedCaptureCount: number;
  captures: EplForwardEvidenceCapture[];
};

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function canonicalBook(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sourceClass(book: string): SourceClass {
  if (!book || book === "unknown" || book === "none" || book === "na") return "unknown";
  if (book === "consensus") return "provider_consensus";
  if (ORIGINATOR_BOOKS.has(book)) return "named_originator";
  if (RETAIL_BOOKS.has(book)) return "named_retail";
  return "named_other";
}

function isNamedBook(vector: EplForwardBookVector): boolean {
  return vector.sourceClass === "named_originator" || vector.sourceClass === "named_retail" || vector.sourceClass === "named_other";
}

function decimalFromAmerican(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

function validIso(value: string | null | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function requirements(market: EplForwardMarket): { outcomes: string[]; line: number | null; probabilityTotal: 1 | 2 } {
  if (market === "match_result") return { outcomes: ["home", "draw", "away"], line: null, probabilityTotal: 1 };
  if (market === "double_chance") return { outcomes: ["home_or_draw", "away_or_draw", "home_or_away"], line: null, probabilityTotal: 2 };
  if (market === "total") return { outcomes: ["over", "under"], line: 2.5, probabilityTotal: 1 };
  return { outcomes: ["yes", "no"], line: null, probabilityTotal: 1 };
}

function vectorFromRows(market: EplForwardMarket, rows: EplSharpOddsRecord[], capturedAt: string): EplForwardBookVector | null {
  const required = requirements(market);
  const latestBySide = new Map<string, EplSharpOddsRecord>();
  for (const row of rows) {
    const current = latestBySide.get(row.selection);
    if (!current || Date.parse(row.fetched_at) >= Date.parse(current.fetched_at)) latestBySide.set(row.selection, row);
  }
  const selected = required.outcomes.map((side) => latestBySide.get(side));
  if (selected.some((row) => !row)) return null;
  const decimals = selected.map((row) => row!.odds_decimal && row!.odds_decimal > 1
    ? row!.odds_decimal
    : row!.odds_american === null ? null : decimalFromAmerican(row!.odds_american));
  if (decimals.some((value) => value === null || !Number.isFinite(value) || value! <= 1)) return null;
  const american = selected.map((row, index) => row!.odds_american ?? Math.round(decimals[index]! >= 2 ? (decimals[index]! - 1) * 100 : -100 / (decimals[index]! - 1)));
  const raw = decimals.map((value) => 1 / value!);
  const overround = raw.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(overround) || overround <= 0) return null;
  const fetched = selected.map((row) => validIso(row!.fetched_at)).filter((value): value is string => value !== null).sort();
  const first = selected[0]!;
  const book = canonicalBook(first.sportsbook);
  if (!book) return null;
  const outcomes = required.outcomes.map((side, index): EplForwardOutcomeQuote => ({
    side,
    american: american[index]!,
    decimal: decimals[index]!,
    rawImpliedProbability: raw[index]!,
    noVigProbability: raw[index]! / overround * required.probabilityTotal,
    fetchedAt: validIso(selected[index]!.fetched_at),
    fetchedAtSource: selected[index]!.fetched_at_source,
  }));
  const endpoint = first.provider_endpoint;
  const eventId = first.provider_event_id;
  const line = market === "total" ? 2.5 : null;
  return {
    identity: [first.provider, endpoint, eventId ?? "none", book, market, line ?? "main", required.outcomes.join("+")].join(":"),
    sportsbook: first.sportsbook!,
    canonicalBook: book,
    sourceClass: sourceClass(book),
    provider: "sharpapi",
    providerEndpoint: endpoint,
    providerEventId: eventId,
    market,
    line,
    capturedAt,
    fetchedAtMin: fetched[0] ?? null,
    fetchedAtMax: fetched.at(-1) ?? null,
    vectorSkewMs: fetched.length === required.outcomes.length ? Date.parse(fetched.at(-1)!) - Date.parse(fetched[0]!) : null,
    overround,
    probabilityTotal: required.probabilityTotal,
    outcomes,
  };
}

function sharpVectors(fixture: EplSharpFixtureMarket, market: EplForwardMarket, capturedAt: string): EplForwardBookVector[] {
  const required = requirements(market);
  const groups = new Map<string, EplSharpOddsRecord[]>();
  for (const row of fixture.odds) {
    if (row.market !== market || (market === "total" && row.line !== required.line) || !row.sportsbook) continue;
    const key = `${row.provider_event_id ?? "none"}:${canonicalBook(row.sportsbook)}:${row.line ?? "main"}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()]
    .map((rows) => vectorFromRows(market, rows, capturedAt))
    .filter((row): row is EplForwardBookVector => row !== null)
    .sort((a, b) => {
      const ai = BOOK_PRIORITY.indexOf(a.canonicalBook as (typeof BOOK_PRIORITY)[number]);
      const bi = BOOK_PRIORITY.indexOf(b.canonicalBook as (typeof BOOK_PRIORITY)[number]);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.canonicalBook.localeCompare(b.canonicalBook) || a.identity.localeCompare(b.identity);
    });
}

function bdlEvaluatedVector(match: EplShadowSlateMatch, market: MarketEdgeDto, capturedAt: string): EplForwardBookVector | null {
  const board = market.soccerPriceBoard;
  const book = canonicalBook(board?.sportsbook ?? market.currentPriceSportsbook ?? null);
  if (!board || !book) return null;
  const required = requirements("match_result");
  const rows = required.outcomes.map((side) => board.rows.find((row) => row.side === side));
  if (rows.some((row) => row?.price_american === null || row?.price_american === undefined)) return null;
  const source = match.currentMoneylineOdds.find((row) => canonicalBook(row.vendor) === book
    && row.moneyline_home_odds === rows[0]!.price_american
    && row.moneyline_draw_odds === rows[1]!.price_american
    && row.moneyline_away_odds === rows[2]!.price_american);
  if (!source) return null;
  const decimals = rows.map((row) => decimalFromAmerican(row!.price_american!));
  const raw = decimals.map((value) => 1 / value);
  const overround = raw.reduce((sum, value) => sum + value, 0);
  const observedAt = validIso(source.updated_at ?? market.currentPriceObservedAt ?? null);
  return {
    identity: ["balldontlie", "/odds", String(match.id), book, "match_result", "main", required.outcomes.join("+")].join(":"),
    sportsbook: board.sportsbook ?? market.currentPriceSportsbook ?? book,
    canonicalBook: book,
    sourceClass: sourceClass(book),
    provider: "balldontlie",
    providerEndpoint: "/odds",
    providerEventId: String(match.id),
    market: "match_result",
    line: null,
    capturedAt,
    fetchedAtMin: observedAt,
    fetchedAtMax: observedAt,
    vectorSkewMs: observedAt ? 0 : null,
    overround,
    probabilityTotal: 1,
    outcomes: required.outcomes.map((side, index) => ({
      side,
      american: rows[index]!.price_american!,
      decimal: decimals[index]!,
      rawImpliedProbability: raw[index]!,
      noVigProbability: raw[index]! / overround,
      fetchedAt: observedAt,
      fetchedAtSource: observedAt ? "provider" : null,
    })),
  };
}

function marketDto(game: DailyEdgeGameDto, market: EplForwardMarket): MarketEdgeDto | null {
  if (market === "match_result") return game.markets.moneyline;
  if (market === "double_chance") return game.soccerDoubleChanceMarket ?? null;
  if (market === "total") return game.markets.total;
  return game.markets.first_inning;
}

function sameEvaluatedPrices(vector: EplForwardBookVector, dto: MarketEdgeDto): boolean {
  const board = dto.soccerPriceBoard;
  if (!board || canonicalBook(board.sportsbook) !== vector.canonicalBook) return false;
  return vector.outcomes.every((outcome) => board.rows.find((row) => row.side === outcome.side)?.price_american === outcome.american);
}

function splitForMarket(split: EplSharpSplitsEvent, market: EplForwardMarket): { bets: Record<string, number | null>; handle: Record<string, number | null> } | null {
  if (market === "match_result" && split.moneyline) return { bets: split.moneyline.bets_pct ?? {}, handle: split.moneyline.handle_pct ?? {} };
  if (market === "total" && split.total) return { bets: split.total.bets_pct ?? {}, handle: split.total.handle_pct ?? {} };
  if (market === "btts" && split.btts) return { bets: split.btts.bets_pct ?? {}, handle: split.btts.handle_pct ?? {} };
  return null;
}

function publicEvidence(fixture: EplSharpFixtureMarket, market: EplForwardMarket): EplForwardMarketSlice["publicEvidence"] {
  if (market === "double_chance") return null;
  const candidates = fixture.splits.flatMap((split) => {
    const values = splitForMarket(split, market);
    return values ? [{ split, values }] : [];
  });
  const selected = candidates.sort((a, b) => Number(Boolean(b.split.fetched_at)) - Number(Boolean(a.split.fetched_at)))[0];
  if (!selected) return null;
  return {
    state: "present",
    provider: "sharpapi",
    providerEndpoint: "/splits",
    providerEventId: selected.split.provider_event_id ?? null,
    providerEventIdUnavailableReason: selected.split.provider_event_id ? null : "provider_split_event_id_absent",
    sportsbook: selected.split.sportsbook ?? null,
    sportsbookUnavailableReason: selected.split.sportsbook ? null : "provider_split_sportsbook_absent",
    fetchedAt: validIso(selected.split.fetched_at),
    fetchedAtSource: selected.split.fetched_at_source ?? null,
    fetchedAtUnavailableReason: validIso(selected.split.fetched_at) ? null : "provider_split_timestamp_absent",
    betsPct: selected.values.bets,
    handlePct: selected.values.handle,
  };
}

function probabilitiesFromAmerican(outcomes: string[], prices: number[], probabilityTotal: 1 | 2): number[] {
  const raw = outcomes.map((_, index) => 1 / decimalFromAmerican(prices[index]!));
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total * probabilityTotal);
}

function movementsForVector(vector: EplForwardBookVector, stored: EplForwardStoredPriceObservation[]): EplForwardMovement | null {
  const relevant = stored.filter((row) => row.market === vector.market
    && canonicalBook(row.sportsbook) === vector.canonicalBook
    && (vector.market !== "total" || row.line === vector.line));
  const openingRows = vector.outcomes.map((outcome) => relevant
    .filter((row) => row.side === outcome.side)
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))[0]);
  if (openingRows.some((row) => !row)) return null;
  const openingPrices = openingRows.map((row) => row!.american);
  const openingProbabilities = probabilitiesFromAmerican(vector.outcomes.map((row) => row.side), openingPrices, vector.probabilityTotal);
  const openingObservedAt = openingRows.map((row) => new Date(row!.recordedAt).toISOString()).sort();
  const openingProviders = [...new Set(openingRows.map((row) => row!.provider).filter((value): value is "balldontlie" | "sharpapi" => Boolean(value)))];
  const openingEndpoints = [...new Set(openingRows.map((row) => row!.providerEndpoint).filter((value): value is string => Boolean(value)))];
  return {
    vectorIdentity: vector.identity,
    sportsbook: vector.sportsbook,
    scope: "same_book_market_outcome_line",
    openingObservedAtMin: openingObservedAt[0]!,
    openingObservedAtMax: openingObservedAt.at(-1)!,
    openingVectorSkewMs: Date.parse(openingObservedAt.at(-1)!) - Date.parse(openingObservedAt[0]!),
    openingProvider: openingProviders.length === 1 ? openingProviders[0]! : null,
    openingProviderEndpoint: openingEndpoints.length === 1 ? openingEndpoints[0]! : null,
    openingProviderUnavailableReason: openingProviders.length === 1 ? null : "line_history_does_not_retain_provider_provenance",
    currentCapturedAt: vector.capturedAt,
    currentFetchedAt: vector.fetchedAtMax,
    outcomes: vector.outcomes.map((outcome, index) => ({
      side: outcome.side,
      openingAmerican: openingPrices[index]!,
      currentAmerican: outcome.american,
      americanDelta: outcome.american - openingPrices[index]!,
      noVigProbabilityDelta: outcome.noVigProbability - openingProbabilities[index]!,
    })),
  };
}

function buildMarketSlice(input: {
  match: EplShadowSlateMatch;
  game: DailyEdgeGameDto;
  fixture: EplSharpFixtureMarket;
  market: EplForwardMarket;
  capturedAt: string;
  stored: EplForwardStoredPriceObservation[];
}): EplForwardMarketSlice {
  const required = requirements(input.market);
  const dto = marketDto(input.game, input.market);
  const vectors = sharpVectors(input.fixture, input.market, input.capturedAt);
  const evaluatedBook = canonicalBook(dto?.soccerPriceBoard?.sportsbook ?? dto?.currentPriceSportsbook ?? null);
  const evaluated = dto
    ? vectors.find((vector) => vector.canonicalBook === evaluatedBook && sameEvaluatedPrices(vector, dto))
      ?? (input.market === "match_result" ? bdlEvaluatedVector(input.match, dto, input.capturedAt) : null)
    : null;
  const allNamedByBook = new Map<string, EplForwardBookVector>();
  for (const vector of vectors) if (isNamedBook(vector) && !allNamedByBook.has(vector.canonicalBook)) allNamedByBook.set(vector.canonicalBook, vector);
  const alternatives = [...allNamedByBook.values()].filter((vector) => vector.canonicalBook !== evaluated?.canonicalBook);
  const totalAlternatives = alternatives.length;
  const targetExcluded = alternatives.slice(0, Math.max(0, EPL_FORWARD_EVIDENCE_MAX_VECTORS_PER_MARKET - Number(Boolean(evaluated))));
  const completeVectors = [...(evaluated ? [evaluated] : []), ...targetExcluded];
  const sourceClassCounts: EplForwardMarketSlice["sourceClassCounts"] = {};
  for (const vector of vectors) sourceClassCounts[vector.sourceClass] = (sourceClassCounts[vector.sourceClass] ?? 0) + 1;
  const outcomeProbabilityRanges = required.outcomes.map((side) => {
    const values = completeVectors.flatMap((vector) => vector.outcomes.find((row) => row.side === side)?.noVigProbability ?? []);
    const min = values.length ? Math.min(...values) : Number.NaN;
    const max = values.length ? Math.max(...values) : Number.NaN;
    return { side, min, max, spread: max - min };
  }).filter((row) => Number.isFinite(row.min));
  const capturedPublicEvidence = publicEvidence(input.fixture, input.market);
  const circaVectorIdentity = vectors.find((vector) => vector.canonicalBook === "circa")?.identity ?? null;
  const movements = completeVectors.flatMap((vector) => movementsForVector(vector, input.stored) ?? []);
  const slice: EplForwardMarketSlice = {
    market: input.market,
    line: required.line,
    requiredOutcomes: required.outcomes,
    evaluated,
    targetExcluded,
    omittedVectorCount: Math.max(0, totalAlternatives - targetExcluded.length),
    completeVectorCount: vectors.length,
    namedCompleteBookCount: allNamedByBook.size,
    targetExcludedCount: targetExcluded.length,
    sourceClassCounts,
    outcomeProbabilityRanges,
    movements,
    circaVectorIdentity,
    publicEvidence: capturedPublicEvidence,
    unavailableReasons: {
      evaluated: evaluated ? null : "complete_evaluated_vector_absent_from_incumbent_inputs",
      targetExcluded: targetExcluded.length ? null : "complete_target_excluded_named_book_vector_absent_from_incumbent_inputs",
      movement: movements.length ? null : "complete_same_book_market_outcome_line_history_absent",
      publicEvidence: capturedPublicEvidence
        ? null
        : input.market === "double_chance"
          ? "incumbent_splits_payload_has_no_double_chance_class"
          : input.fixture.splitsState === "error"
            ? "incumbent_splits_fetch_failed"
            : "authentic_market_split_absent_from_incumbent_payload",
      circa: circaVectorIdentity ? null : "authentic_circa_vector_absent_from_incumbent_payload",
    },
  };
  while (byteLength(slice) > EPL_FORWARD_EVIDENCE_MAX_MARKET_BYTES && slice.targetExcluded.length > 0) {
    const removed = slice.targetExcluded.pop()!;
    slice.movements = slice.movements.filter((movement) => movement.vectorIdentity !== removed.identity);
    slice.omittedVectorCount++;
    slice.targetExcludedCount = slice.targetExcluded.length;
  }
  if (byteLength(slice) > EPL_FORWARD_EVIDENCE_MAX_MARKET_BYTES) {
    throw new Error(`EPL ${input.market} evidence exceeds ${EPL_FORWARD_EVIDENCE_MAX_MARKET_BYTES} bytes after deterministic pruning`);
  }
  return slice;
}

function selectedSide(market: MarketEdgeDto | null): string | null {
  return market?.soccerPriceBoard?.rows.find((row) => row.selected)?.side ?? null;
}

function championMarket(game: DailyEdgeGameDto, market: EplForwardMarket): EplForwardEvidenceCapture["champion"]["markets"][EplForwardMarket] {
  const dto = marketDto(game, market);
  return {
    pick: dto?.pick ?? null,
    selectedSide: selectedSide(dto),
    modelProbability: dto?.modelProb ?? null,
    marketProbability: dto?.marketFairProb ?? null,
    currentPriceAmerican: dto?.currentPriceAmerican ?? null,
    currentPriceSportsbook: dto?.currentPriceSportsbook ?? null,
    grade: dto?.verdict?.label ?? dto?.grade ?? null,
  };
}

export function buildEplForwardEvidenceCaptures(input: {
  slate: EplShadowSlate;
  response: DailyEdgeResponse;
  fixtureMarkets: EplSharpFixtureMarket[];
  storedPriceHistory: EplForwardStoredPriceObservation[];
  capturedAt: string;
}): EplForwardEvidenceCapture[] {
  const gameById = new Map(input.response.games.map((game) => [Number(game.external_id), game]));
  return input.slate.matches.flatMap((match, index) => {
    const game = gameById.get(match.id);
    const fixture = input.fixtureMarkets[index];
    if (!game || !fixture) return [];
    const bdlOpeners: EplForwardStoredPriceObservation[] = match.openingOdds.flatMap((row) => {
      const recordedAt = row.opened_at ?? row.updated_at;
      if (!recordedAt || !row.vendor) return [];
      return ([
        ["home", row.moneyline_home_odds],
        ["draw", row.moneyline_draw_odds],
        ["away", row.moneyline_away_odds],
      ] as const).flatMap(([side, american]) => american === null ? [] : [{
        providerId: match.id,
        market: "match_result" as const,
        side,
        line: null,
        american,
        sportsbook: row.vendor,
        recordedAt,
        isOpener: true,
        provider: "balldontlie" as const,
        providerEndpoint: "/odds/opening",
      }]);
    });
    const stored = [...input.storedPriceHistory.filter((row) => row.providerId === match.id), ...bdlOpeners];
    const markets = Object.fromEntries(MARKET_ORDER.map((market) => [market, buildMarketSlice({ match, game, fixture, market, capturedAt: input.capturedAt, stored })])) as Record<EplForwardMarket, EplForwardMarketSlice>;
    return [{
      schemaVersion: 1,
      captureRelease: EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE,
      providerFixtureId: match.id,
      competition: "english_premier_league",
      kickoff: match.kickoff,
      capturedAt: input.capturedAt,
      modelRelease: input.slate.modelRelease,
      calibrationRelease: input.slate.calibrationRelease,
      independent: {
        trainedThrough: input.slate.trainedThrough,
        trainingMatches: input.slate.trainingMatches,
        lambdaHome: match.prediction.lambdaHome,
        lambdaAway: match.prediction.lambdaAway,
        expectedTotal: match.prediction.expectedTotal,
        probabilities: { ...match.prediction.probabilities },
        rawDerivedProbabilities: { ...match.prediction.rawDerivedProbabilities },
        confidence: match.prediction.confidence,
        homeStrengthSource: match.prediction.homeStrengthSource,
        awayStrengthSource: match.prediction.awayStrengthSource,
        homeEffectiveMatches: match.modelUncertainty.homeEffectiveMatches,
        awayEffectiveMatches: match.modelUncertainty.awayEffectiveMatches,
        evidence: structuredClone(match.evidence),
        unavailableReasons: [
          "news_source_not_present_on_incumbent_epl_path",
          ...(match.evidence.home.injuries.some((row) => !row.updatedAt) ? ["home_injury_updated_at_absent_for_one_or_more_rows"] : []),
          ...(match.evidence.away.injuries.some((row) => !row.updatedAt) ? ["away_injury_updated_at_absent_for_one_or_more_rows"] : []),
        ],
      },
      champion: {
        projected: structuredClone(game.projected),
        soccerProjection: structuredClone(game.soccerProjection),
        markets: Object.fromEntries(MARKET_ORDER.map((market) => [market, championMarket(game, market)])) as EplForwardEvidenceCapture["champion"]["markets"],
      },
      markets,
    }];
  });
}

function captureFingerprint(capture: EplForwardEvidenceCapture): string {
  return JSON.stringify({
    model: capture.modelRelease,
    champion: capture.champion,
    markets: MARKET_ORDER.map((market) => ({
      evaluated: capture.markets[market].evaluated?.identity ?? null,
      vectors: capture.markets[market].targetExcluded.map((row) => [row.identity, row.outcomes.map((outcome) => outcome.american)]),
      public: capture.markets[market].publicEvidence,
    })),
    injuries: [capture.independent.evidence.home.injuries, capture.independent.evidence.away.injuries],
  });
}

function chooseLandmarks(captures: EplForwardEvidenceCapture[]): EplForwardEvidenceCapture[] {
  const ordered = [...captures].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  if (ordered.length <= EPL_FORWARD_EVIDENCE_MAX_LANDMARKS) return ordered;
  const selected = new Set<EplForwardEvidenceCapture>([ordered[0]!, ordered.at(-1)!]);
  const kickoff = Date.parse(ordered[0]!.kickoff);
  for (const leadMs of [24 * 60 * 60_000, 6 * 60 * 60_000, 60 * 60_000]) {
    const target = kickoff - leadMs;
    const candidate = ordered.filter((row) => Date.parse(row.capturedAt) <= target)
      .sort((a, b) => Math.abs(Date.parse(a.capturedAt) - target) - Math.abs(Date.parse(b.capturedAt) - target))[0];
    if (candidate) selected.add(candidate);
  }
  const fingerprints = new Set([...selected].map(captureFingerprint));
  for (const candidate of [...ordered].reverse()) {
    if (selected.size >= EPL_FORWARD_EVIDENCE_MAX_LANDMARKS) break;
    const fingerprint = captureFingerprint(candidate);
    if (fingerprints.has(fingerprint)) continue;
    selected.add(candidate);
    fingerprints.add(fingerprint);
  }
  return [...selected].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

function parsePriorHistory(snapshot: Record<string, unknown> | null | undefined): EplForwardEvidenceHistory | null {
  const value = snapshot?.epl_forward_evidence_history;
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<EplForwardEvidenceHistory>;
  if (row.schemaVersion !== 1 || row.captureRelease !== EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE || !Array.isArray(row.captures)) return null;
  return row as EplForwardEvidenceHistory;
}

function shrinkCapture(capture: EplForwardEvidenceCapture): boolean {
  const candidates = MARKET_ORDER.map((market) => capture.markets[market]).sort((a, b) => b.targetExcluded.length - a.targetExcluded.length);
  const slice = candidates.find((row) => row.targetExcluded.length > 0);
  if (!slice) return false;
  const removed = slice.targetExcluded.pop()!;
  slice.movements = slice.movements.filter((movement) => movement.vectorIdentity !== removed.identity);
  slice.omittedVectorCount++;
  slice.targetExcludedCount = slice.targetExcluded.length;
  return true;
}

export function mergeEplForwardEvidenceHistory(
  priorSnapshot: Record<string, unknown> | null | undefined,
  nextCapture: EplForwardEvidenceCapture,
): EplForwardEvidenceHistory {
  const prior = parsePriorHistory(priorSnapshot);
  const combined = [...(prior?.captures ?? []), structuredClone(nextCapture)];
  const unique = combined.filter((capture, index, rows) => rows.findIndex((row) => row.capturedAt === capture.capturedAt) === index);
  let captures = chooseLandmarks(unique);
  let omittedCaptureCount = (prior?.omittedCaptureCount ?? 0) + Math.max(0, unique.length - captures.length);
  let history: EplForwardEvidenceHistory = { schemaVersion: 1, captureRelease: EPL_FORWARD_EVIDENCE_CAPTURE_RELEASE, omittedCaptureCount, captures };
  while (byteLength(history) > EPL_FORWARD_EVIDENCE_MAX_GAME_BYTES && captures.length > 2) {
    captures = captures.filter((_, index) => index !== 1);
    omittedCaptureCount++;
    history = { ...history, omittedCaptureCount, captures };
  }
  while (byteLength(history) > EPL_FORWARD_EVIDENCE_MAX_GAME_BYTES) {
    const shrinkable = captures
      .filter((capture) => MARKET_ORDER.some((market) => capture.markets[market].targetExcluded.length > 0))
      .sort((a, b) => byteLength(b) - byteLength(a))[0];
    if (!shrinkable || !shrinkCapture(shrinkable)) break;
    history = { ...history, captures };
  }
  if (byteLength(history) > EPL_FORWARD_EVIDENCE_MAX_GAME_BYTES) {
    throw new Error(`EPL forward evidence exceeds ${EPL_FORWARD_EVIDENCE_MAX_GAME_BYTES} bytes after deterministic pruning`);
  }
  return history;
}

export function eplForwardEvidenceByteLength(value: unknown): number {
  return byteLength(value);
}
