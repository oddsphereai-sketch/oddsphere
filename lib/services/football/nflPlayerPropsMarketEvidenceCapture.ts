import { createHash } from "node:crypto";
import type { NflPlayerPropMarket } from "./nflPlayerPropsContract";
import type { NflPlayerPropsExactOffer } from "./nflPlayerPropsMarketBoard";

export const NFL_PLAYER_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE =
  "nfl_player_props_market_evidence_capture_2026_09_02_r1" as const;
export const NFL_PLAYER_PROPS_MARKET_EVIDENCE_SCHEMA = "nflpme1" as const;
export const NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY = 8 as const;
export const NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_ADDED_BYTES = 512 * 1024;
export const NFL_PLAYER_PROPS_MARKET_EVIDENCE_RETENTION =
  "category_hash_round_robin_v1" as const;

type MarketCode = "td" | "pa" | "pc" | "py" | "ry" | "rc" | "ra" | "ru";
type ProviderCode = "b" | "s" | "u";
type SourceClassCode = "s" | "r" | "u";
type BreadthReasonCode = "c" | "1" | "i" | "t" | "m";
type GradeCode = "b" | "l" | "w" | "n" | "h";

/**
 * Compact book tuple. Positional fields are intentionally versioned to avoid
 * repeating property labels hundreds of times in the snapshot:
 * [book, provider, class, currentObservedAt, currentFetchedAt, clockSkewMs,
 *  openingObservedAt, openingLine, over, under, yes, openingOver,
 *  openingUnder, openingYes, evaluatedSideMask].
 * evaluatedSideMask is 1=Over, 2=Under, 4=Yes.
 */
export type NflPlayerPropsMarketEvidenceBook = readonly [
  string,
  ProviderCode,
  SourceClassCode,
  string,
  string,
  number | null,
  string | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number,
];

/**
 * Breadth tuple:
 * [completeObserved, completeRetained, sharpRetained, retailRetained,
 *  unknownRetained, incompleteObserved, staleCompleteObserved,
 *  Over reason, Under reason, Yes reason].
 */
export type NflPlayerPropsMarketEvidenceBreadth = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  BreadthReasonCode,
  BreadthReasonCode,
  BreadthReasonCode,
];

/**
 * Output tuple:
 * [incumbent residual coefficient, QB point-market coefficient,
 *  independent projection, published projection,
 *  Over raw/market/final/edge/EV/grade,
 *  Under raw/market/final/edge/EV/grade,
 *  Yes raw/market/final/edge/EV/grade].
 */
export type NflPlayerPropsMarketEvidenceOutput = readonly [
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  GradeCode | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  GradeCode | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  GradeCode | null,
];

/** [deterministic id, market, books, breadth, incumbent output]. */
export type NflPlayerPropsMarketEvidenceIdentity = readonly [
  string,
  MarketCode,
  readonly NflPlayerPropsMarketEvidenceBook[],
  NflPlayerPropsMarketEvidenceBreadth,
  NflPlayerPropsMarketEvidenceOutput,
];

export type NflPlayerPropsMarketEvidenceCapture = Readonly<{
  r: typeof NFL_PLAYER_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE;
  s: typeof NFL_PLAYER_PROPS_MARKET_EVIDENCE_SCHEMA;
  mb: typeof NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY;
  hb: number;
  rt: typeof NFL_PLAYER_PROPS_MARKET_EVIDENCE_RETENTION;
  sp: "n";
  n: number;
  k: number;
  o: number;
  c: ReadonlyArray<readonly [MarketCode, number, number, number]>;
  i: readonly NflPlayerPropsMarketEvidenceIdentity[];
}>;

type CaptureDecision = Readonly<{
  gameId: string;
  playerName: string;
  market: NflPlayerPropMarket;
  line: number;
  side: "over" | "under" | "yes";
  sportsbook: string;
  projection: number | null;
  rawModelProbability: number;
  marketProbability: number;
  finalProbability: number;
  probabilityEdge: number;
  expectedValue: number;
  grade: "Best Angle" | "Lean" | "Watchlist" | "No Play" | "Held";
  projectionEvidence?: {
    source: "market_dominant_expected_starter";
    marketWeight: number;
    roleProjection: number;
  } | {
    source: "probability_inverse_market_calibrated";
    independentProjection: number;
  };
  marketEvidenceId?: string;
}>;

type Candidate = Readonly<{
  id: string;
  market: MarketCode;
  identity: NflPlayerPropsMarketEvidenceIdentity;
}>;

const SHARP_BOOKS = new Set(["pinnacle", "circa", "bookmaker"]);
const RETAIL_BOOKS = new Set([
  "bet365",
  "betmgm",
  "betrivers",
  "bovada",
  "caesars",
  "draftkings",
  "espnbet",
  "fanduel",
  "fanatics",
  "hardrockbet",
]);

const MARKET_CODES: Partial<Record<NflPlayerPropMarket, MarketCode>> = {
  anytime_td: "td",
  passing_attempts: "pa",
  passing_completions: "pc",
  passing_yards: "py",
  receiving_yards: "ry",
  receptions: "rc",
  rushing_attempts: "ra",
  rushing_yards: "ru",
};

export function nflPlayerPropsMarketEvidenceId(value: Pick<CaptureDecision,
  "gameId" | "playerName" | "market" | "line"
>): string {
  const key = [value.gameId, normalizeName(value.playerName), value.market, value.line].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function buildNflPlayerPropsMarketEvidenceCapture(args: {
  offers: readonly NflPlayerPropsExactOffer[];
  decisions: readonly CaptureDecision[];
  evaluatedAt: string;
  maximumQuoteAgeHours: number;
  incumbentCoefficientByMarket: Readonly<Partial<Record<NflPlayerPropMarket, number>>>;
  referenceCopies?: number;
}): { capture: NflPlayerPropsMarketEvidenceCapture; retainedIds: ReadonlySet<string>; addedBytes: number } {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL props evidence evaluatedAt is invalid.");
  const offerGroups = groupBy(
    args.offers.filter((offer) => offer.gradeEligibleMarket),
    offerIdentityKey,
  );
  const decisionGroups = groupBy(args.decisions, decisionIdentityKey);
  const allKeys = [...new Set([...offerGroups.keys(), ...decisionGroups.keys()])].sort();
  const candidates = allKeys.map((key) => buildCandidate({
    offers: offerGroups.get(key) ?? [],
    decisions: decisionGroups.get(key) ?? [],
    evaluatedAt,
    maximumQuoteAgeHours: args.maximumQuoteAgeHours,
    incumbentCoefficientByMarket: args.incumbentCoefficientByMarket,
  }));
  const referenceOccurrences = new Map<string, number>();
  const copies = Math.max(1, Math.floor(args.referenceCopies ?? 1));
  for (const decision of args.decisions) {
    const id = nflPlayerPropsMarketEvidenceId(decision);
    referenceOccurrences.set(id, (referenceOccurrences.get(id) ?? 0) + copies);
  }
  return finalizeCapture(candidates, referenceOccurrences);
}

export function mergeNflPlayerPropsMarketEvidenceCaptures(args: {
  current?: NflPlayerPropsMarketEvidenceCapture | null;
  previous?: NflPlayerPropsMarketEvidenceCapture | null;
  decisions: readonly CaptureDecision[];
  memberReferenceCopies?: boolean;
}): { capture: NflPlayerPropsMarketEvidenceCapture | null; retainedIds: ReadonlySet<string>; addedBytes: number } {
  if (!args.current && !args.previous) return { capture: null, retainedIds: new Set(), addedBytes: 0 };
  const referenced = new Set(args.decisions.flatMap((decision) =>
    decision.marketEvidenceId ? [decision.marketEvidenceId] : []));
  const tuples = new Map<string, NflPlayerPropsMarketEvidenceIdentity>();
  for (const identity of args.previous?.i ?? []) tuples.set(identity[0], identity);
  for (const identity of args.current?.i ?? []) tuples.set(identity[0], identity);
  const candidates = [...tuples.values()].filter((identity) => referenced.has(identity[0])).map((identity) => ({
    id: identity[0],
    market: identity[1],
    identity,
  }));
  const referenceOccurrences = new Map<string, number>();
  for (const decision of args.decisions) {
    const id = decision.marketEvidenceId;
    if (!id) continue;
    const copies = args.memberReferenceCopies !== false && decision.grade !== "Held" ? 2 : 1;
    referenceOccurrences.set(id, (referenceOccurrences.get(id) ?? 0) + copies);
  }
  return finalizeCapture(candidates, referenceOccurrences);
}

export function subsetNflPlayerPropsMarketEvidenceCapture(args: {
  capture?: NflPlayerPropsMarketEvidenceCapture | null;
  decisions: readonly CaptureDecision[];
}): { capture: NflPlayerPropsMarketEvidenceCapture | null; retainedIds: ReadonlySet<string>; addedBytes: number } {
  if (!args.capture) return { capture: null, retainedIds: new Set(), addedBytes: 0 };
  const referenced = new Set(args.decisions.flatMap((decision) => decision.marketEvidenceId ? [decision.marketEvidenceId] : []));
  const candidates = args.capture.i
    .filter((identity) => referenced.has(identity[0]))
    .map((identity) => ({ id: identity[0], market: identity[1], identity }));
  const referenceOccurrences = new Map<string, number>();
  for (const decision of args.decisions) {
    if (!decision.marketEvidenceId) continue;
    referenceOccurrences.set(
      decision.marketEvidenceId,
      (referenceOccurrences.get(decision.marketEvidenceId) ?? 0) + 1,
    );
  }
  return finalizeCapture(candidates, referenceOccurrences);
}

export function withoutUnretainedNflPlayerPropsEvidenceReference<T extends CaptureDecision>(
  decision: T,
  retainedIds: ReadonlySet<string>,
): T {
  if (!decision.marketEvidenceId || retainedIds.has(decision.marketEvidenceId)) return decision;
  const rest = { ...decision };
  Reflect.deleteProperty(rest, "marketEvidenceId");
  return rest;
}

function buildCandidate(args: {
  offers: readonly NflPlayerPropsExactOffer[];
  decisions: readonly CaptureDecision[];
  evaluatedAt: number;
  maximumQuoteAgeHours: number;
  incumbentCoefficientByMarket: Readonly<Partial<Record<NflPlayerPropMarket, number>>>;
}): Candidate {
  const representative = args.decisions[0] ?? args.offers[0];
  if (!representative) throw new Error("NFL props evidence identity is empty.");
  const id = nflPlayerPropsMarketEvidenceId(representative);
  const market = MARKET_CODES[representative.market];
  if (!market) throw new Error(`NFL props evidence market is unsupported: ${representative.market}`);
  const decisions = new Map(args.decisions.map((decision) => [decision.side, decision]));
  const targets = new Map([...decisions].map(([side, decision]) => [side, normalizeBook(decision.sportsbook)]));
  const offersByBook = new Map<string, NflPlayerPropsExactOffer>();
  for (const offer of args.offers) {
    const book = normalizeBook(offer.sportsbook);
    const previous = offersByBook.get(book);
    if (!previous || Date.parse(offer.observedAt) > Date.parse(previous.observedAt)) offersByBook.set(book, offer);
  }
  const allOffers = [...offersByBook.values()];
  const complete = allOffers.filter(isCompleteOffer);
  const freshComplete = complete.filter((offer) => isFresh(offer, args.evaluatedAt, args.maximumQuoteAgeHours));
  const targetBooks = new Set([...targets.values()]);
  const targetOffers = freshComplete.filter((offer) => targetBooks.has(normalizeBook(offer.sportsbook)));
  const alternatives = sourceStratified(
    freshComplete.filter((offer) => !targetBooks.has(normalizeBook(offer.sportsbook))),
  );
  const retainedOffers = uniqueByBook([
    ...targetOffers,
    ...alternatives,
  ]).slice(0, NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY);
  const books = retainedOffers.map((offer) => bookTuple(offer, targets));
  const retainedComplete = books.length;
  const incompleteObserved = allOffers.filter((offer) => !isCompleteOffer(offer)).length;
  const staleCompleteObserved = complete.length - freshComplete.length;
  const reasonFor = (side: "over" | "under" | "yes"): BreadthReasonCode => {
    const target = targets.get(side);
    const eligible = freshComplete.filter((offer) => normalizeBook(offer.sportsbook) !== target);
    if (eligible.length >= 2) return "c";
    if (eligible.length === 1) return "1";
    if (incompleteObserved > 0) return "i";
    if (staleCompleteObserved > 0) return "t";
    return "m";
  };
  const breadth: NflPlayerPropsMarketEvidenceBreadth = [
    freshComplete.length,
    retainedComplete,
    books.filter((book) => book[2] === "s").length,
    books.filter((book) => book[2] === "r").length,
    books.filter((book) => book[2] === "u").length,
    incompleteObserved,
    staleCompleteObserved,
    representative.market === "anytime_td" ? "m" : reasonFor("over"),
    representative.market === "anytime_td" ? "m" : reasonFor("under"),
    representative.market === "anytime_td" ? reasonFor("yes") : "m",
  ];
  const over = decisions.get("over");
  const under = decisions.get("under");
  const yes = decisions.get("yes");
  const projectionDecision = over ?? under ?? yes;
  const independentProjection = projectionDecision?.projectionEvidence?.source === "market_dominant_expected_starter"
    ? projectionDecision.projectionEvidence.roleProjection
    : projectionDecision?.projectionEvidence?.source === "probability_inverse_market_calibrated"
      ? projectionDecision.projectionEvidence.independentProjection
      : projectionDecision?.projection ?? null;
  const qbMarketWeight = projectionDecision?.projectionEvidence?.source === "market_dominant_expected_starter"
    ? projectionDecision.projectionEvidence.marketWeight
    : null;
  const sideOutput = (decision: CaptureDecision | undefined): readonly [
    number | null, number | null, number | null, number | null, number | null, GradeCode | null,
  ] => decision ? [
    decision.rawModelProbability,
    decision.marketProbability,
    decision.finalProbability,
    decision.probabilityEdge,
    decision.expectedValue,
    gradeCode(decision.grade),
  ] : [null, null, null, null, null, null];
  const output: NflPlayerPropsMarketEvidenceOutput = [
    args.incumbentCoefficientByMarket[representative.market] ?? null,
    qbMarketWeight,
    independentProjection,
    projectionDecision?.projection ?? null,
    ...sideOutput(over),
    ...sideOutput(under),
    ...sideOutput(yes),
  ];
  return { id, market, identity: [id, market, books, breadth, output] };
}

function finalizeCapture(
  candidates: readonly Candidate[],
  referenceOccurrences: ReadonlyMap<string, number>,
): { capture: NflPlayerPropsMarketEvidenceCapture; retainedIds: ReadonlySet<string>; addedBytes: number } {
  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) unique.set(candidate.id, candidate);
  const all = [...unique.values()];
  const ordered = stratifiedIdentityOrder(all);
  const markets = [...new Set(all.map((candidate) => candidate.market))].sort();
  const minimum = Math.min(markets.length, ordered.length);
  let low = minimum;
  let high = ordered.length;
  let best = materializeCapture(ordered.slice(0, minimum), all);
  if (addedBytes(best, referenceOccurrences) > NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_ADDED_BYTES) {
    best = materializeCapture([], all);
    low = 0;
    high = 0;
  } else {
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const trial = materializeCapture(ordered.slice(0, middle), all);
      if (addedBytes(trial, referenceOccurrences) <= NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_ADDED_BYTES) {
        best = trial;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
  }
  const retainedIds = new Set(best.i.map((identity) => identity[0]));
  const bytes = addedBytes(best, referenceOccurrences, retainedIds);
  return { capture: best, retainedIds, addedBytes: bytes };
}

function materializeCapture(
  selected: readonly Candidate[],
  all: readonly Candidate[],
): NflPlayerPropsMarketEvidenceCapture {
  const markets = [...new Set(all.map((candidate) => candidate.market))].sort();
  const identities = [...selected]
    .sort((first, second) => first.market.localeCompare(second.market) || first.id.localeCompare(second.id))
    .map((candidate) => candidate.identity);
  return {
    r: NFL_PLAYER_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE,
    s: NFL_PLAYER_PROPS_MARKET_EVIDENCE_SCHEMA,
    mb: NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY,
    hb: NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_ADDED_BYTES,
    rt: NFL_PLAYER_PROPS_MARKET_EVIDENCE_RETENTION,
    sp: "n",
    n: all.length,
    k: identities.length,
    o: all.length - identities.length,
    c: markets.map((market) => {
      const observed = all.filter((candidate) => candidate.market === market).length;
      const retained = identities.filter((identity) => identity[1] === market).length;
      return [market, observed, retained, observed - retained] as const;
    }),
    i: identities,
  };
}

function addedBytes(
  capture: NflPlayerPropsMarketEvidenceCapture,
  referenceOccurrences: ReadonlyMap<string, number>,
  retainedIds = new Set(capture.i.map((identity) => identity[0])),
): number {
  let bytes = Buffer.byteLength(`,"marketEvidence":${JSON.stringify(capture)}`);
  for (const [id, occurrences] of referenceOccurrences) {
    if (!retainedIds.has(id)) continue;
    bytes += occurrences * Buffer.byteLength(`,"marketEvidenceId":"${id}"`);
  }
  return bytes;
}

function stratifiedIdentityOrder(candidates: readonly Candidate[]): Candidate[] {
  const groups = [...groupBy(candidates, (candidate) => candidate.market).entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([, rows]) => [...rows].sort((first, second) => first.id.localeCompare(second.id)));
  const ordered: Candidate[] = [];
  for (let index = 0; groups.some((rows) => index < rows.length); index += 1) {
    for (const rows of groups) if (rows[index]) ordered.push(rows[index]!);
  }
  return ordered;
}

function sourceStratified(offers: readonly NflPlayerPropsExactOffer[]): NflPlayerPropsExactOffer[] {
  const groups = (["s", "r", "u"] as const).map((sourceClass) => offers
    .filter((offer) => sourceClassForBook(offer.sportsbook) === sourceClass)
    .sort((first, second) => normalizeBook(first.sportsbook).localeCompare(normalizeBook(second.sportsbook))));
  const ordered: NflPlayerPropsExactOffer[] = [];
  for (let index = 0; groups.some((rows) => index < rows.length); index += 1) {
    for (const rows of groups) if (rows[index]) ordered.push(rows[index]!);
  }
  return ordered;
}

function bookTuple(
  offer: NflPlayerPropsExactOffer,
  targets: ReadonlyMap<"over" | "under" | "yes", string>,
): NflPlayerPropsMarketEvidenceBook {
  const book = normalizeBook(offer.sportsbook);
  const observed = Date.parse(offer.observedAt);
  const fetched = Date.parse(offer.fetchedAt);
  const skew = Number.isFinite(observed) && Number.isFinite(fetched) ? fetched - observed : null;
  const targetMask = (targets.get("over") === book ? 1 : 0)
    | (targets.get("under") === book ? 2 : 0)
    | (targets.get("yes") === book ? 4 : 0);
  return [
    book,
    providerCode(offer.provider),
    sourceClassForBook(book),
    offer.observedAt,
    offer.fetchedAt,
    skew,
    offer.openingObservedAt,
    offer.openingLine,
    offer.overPrice,
    offer.underPrice,
    offer.yesPrice,
    offer.openingOverPrice,
    offer.openingUnderPrice,
    offer.openingYesPrice,
    targetMask,
  ];
}

function isCompleteOffer(offer: NflPlayerPropsExactOffer): boolean {
  return offer.market === "anytime_td"
    ? offer.yesPrice !== null
    : offer.overPrice !== null && offer.underPrice !== null;
}

function isFresh(offer: NflPlayerPropsExactOffer, evaluatedAt: number, maximumQuoteAgeHours: number): boolean {
  const age = evaluatedAt - Date.parse(offer.observedAt);
  return Number.isFinite(age) && age >= 0 && age <= maximumQuoteAgeHours * 3_600_000;
}

function offerIdentityKey(offer: NflPlayerPropsExactOffer): string {
  return [offer.canonicalGameId, normalizeName(offer.playerName), offer.market, offer.line].join("|");
}

function decisionIdentityKey(decision: CaptureDecision): string {
  return [decision.gameId, normalizeName(decision.playerName), decision.market, decision.line].join("|");
}

function providerCode(provider: string): ProviderCode {
  if (provider === "balldontlie") return "b";
  if (provider === "sharpapi") return "s";
  return "u";
}

function sourceClassForBook(value: string): SourceClassCode {
  const book = normalizeBook(value);
  if (SHARP_BOOKS.has(book)) return "s";
  if (RETAIL_BOOKS.has(book)) return "r";
  return "u";
}

function gradeCode(grade: CaptureDecision["grade"]): GradeCode {
  if (grade === "Best Angle") return "b";
  if (grade === "Lean") return "l";
  if (grade === "Watchlist") return "w";
  if (grade === "Held") return "h";
  return "n";
}

function uniqueByBook(offers: readonly NflPlayerPropsExactOffer[]): NflPlayerPropsExactOffer[] {
  const unique = new Map<string, NflPlayerPropsExactOffer>();
  for (const offer of offers) if (!unique.has(normalizeBook(offer.sportsbook))) unique.set(normalizeBook(offer.sportsbook), offer);
  return [...unique.values()];
}

function groupBy<T, K>(rows: readonly T[], keyFor: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]/g, "");
}
