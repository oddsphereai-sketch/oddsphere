import { createHash } from "node:crypto";
import type { PlayerPropPreviewRow } from "@/app/mlb/props/components/PlayerPropsDashboard";
import type { MlbPropMarketKey } from "./config";
import type { MlbPropMarketContext } from "./marketAwareContext";
import type { PropOddsSnapshot } from "./providers";

export const MLB_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE =
  "mlb_props_market_evidence_capture_2026_09_02_r1" as const;
export const MLB_PROPS_MARKET_EVIDENCE_SCHEMA = "mlbpme1" as const;
export const MLB_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY = 8 as const;
export const MLB_PROPS_MARKET_EVIDENCE_MAX_CANONICAL_ADDED_BYTES = 1024 * 1024;
export const MLB_PROPS_MARKET_EVIDENCE_CANONICAL_TARGET_BYTES = 960 * 1024;
export const MLB_PROPS_MARKET_EVIDENCE_MAX_MEMBER_ADDED_BYTES = 256 * 1024;
export const MLB_PROPS_MARKET_EVIDENCE_MEMBER_TARGET_BYTES = 240 * 1024;
// Display-lock reconciliation is an in-memory intermediate. It may need the
// union of several independently bounded historical captures before the
// member publisher subsets that union back to the existing per-payload cap.
// Never use this allowance for a stored canonical or member capture.
export const MLB_PROPS_MARKET_EVIDENCE_MAX_TRANSIENT_LOCK_MERGE_BYTES = 8 * 1024 * 1024;
export const MLB_PROPS_MARKET_EVIDENCE_RETENTION = "category_hash_round_robin_v1" as const;

export const MLB_PROPS_MARKET_EVIDENCE_INPUT = Symbol.for(
  "oddsphere.mlb-props.market-evidence-input.v1",
);

type MarketCode = "pk" | "po" | "ph" | "pw" | "pe" | "bk" | "bh" | "bt" | "hr"
  | "bi" | "rs" | "bx" | "bs" | "bd" | "bp" | "bw" | "sb";
type ProviderCode = "b" | "s" | "u";
type SourceClassCode = "s" | "r" | "u";
type SplitClassCode = "c" | "s" | "p" | "u";
type BreadthReasonCode = "c" | "1" | "i" | "t" | "m";
type SideCode = "o" | "u";

export type MlbPropsMarketEvidenceInput = Readonly<{
  independentProjection: number | null;
  context: MlbPropMarketContext | null;
}>;

export type MlbPropsMarketEvidenceRow = PlayerPropPreviewRow & {
  marketEvidenceId?: string;
  [MLB_PROPS_MARKET_EVIDENCE_INPUT]?: MlbPropsMarketEvidenceInput;
};

/** [side, source class, source timestamp, tickets, money]. */
export type MlbPropsMarketEvidenceSplit = readonly [
  SideCode,
  SplitClassCode,
  string,
  number,
  number,
];

/**
 * Compact book tuple:
 * [book, provider, source class, current observed/fetched timestamp,
 *  provider changed timestamp, provider/fetch skew ms, opening timestamp,
 *  opening line, over, under, opening over, opening under, verified splits].
 */
export type MlbPropsMarketEvidenceBook = readonly [
  string,
  ProviderCode,
  SourceClassCode,
  string,
  string | null,
  number | null,
  string | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  readonly MlbPropsMarketEvidenceSplit[],
];

/**
 * Breadth tuple:
 * [complete fresh observed, complete retained, sharp retained, retail retained,
 *  unknown retained, incomplete observed, stale complete observed,
 *  minimum evaluated-book-excluded comparators, comparator reason,
 *  opening books, opening reason, split rows, split reason].
 */
export type MlbPropsMarketEvidenceBreadth = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  BreadthReasonCode,
  number,
  BreadthReasonCode,
  number,
  BreadthReasonCode,
];

/**
 * Incumbent context tuple:
 * [all-book current Over, opening movement, related movement, split adjustment,
 *  opening books used, related markets used, split rows used].
 */
export type MlbPropsMarketEvidenceContext = readonly [
  number | null,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * Incumbent output tuple:
 * [independent projection, published projection, independent/model coefficient,
 *  independent Over, independent Under, final Over, final Under].
 */
export type MlbPropsMarketEvidenceOutput = readonly [
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];

/** [id, market, books, breadth, incumbent context, incumbent output]. */
export type MlbPropsMarketEvidenceIdentity = readonly [
  string,
  MarketCode,
  readonly MlbPropsMarketEvidenceBook[],
  MlbPropsMarketEvidenceBreadth,
  MlbPropsMarketEvidenceContext,
  MlbPropsMarketEvidenceOutput,
];

export type MlbPropsMarketEvidenceCapture = Readonly<{
  r: typeof MLB_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE;
  s: typeof MLB_PROPS_MARKET_EVIDENCE_SCHEMA;
  mb: typeof MLB_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY;
  hb: number;
  hm: number;
  tb: number;
  rt: typeof MLB_PROPS_MARKET_EVIDENCE_RETENTION;
  sp: "n" | "v";
  fm: number;
  n: number;
  k: number;
  o: number;
  c: ReadonlyArray<readonly [MarketCode, number, number, number]>;
  i: readonly MlbPropsMarketEvidenceIdentity[];
}>;

type Candidate = Readonly<{
  id: string;
  market: MarketCode;
  identity: MlbPropsMarketEvidenceIdentity;
}>;

const MARKET_CODES: Partial<Record<MlbPropMarketKey, MarketCode>> = {
  pitcher_strikeouts: "pk",
  pitcher_outs: "po",
  pitcher_hits_allowed: "ph",
  pitcher_walks: "pw",
  pitcher_earned_runs: "pe",
  batter_strikeouts: "bk",
  batter_hits: "bh",
  batter_total_bases: "bt",
  batter_home_runs: "hr",
  batter_rbis: "bi",
  batter_runs_scored: "rs",
  batter_hits_runs_rbis: "bx",
  batter_singles: "bs",
  batter_doubles: "bd",
  batter_triples: "bp",
  batter_walks: "bw",
  batter_stolen_bases: "sb",
};

const SHARP_BOOKS = new Set(["pinnacle", "circa", "bookmaker"]);
const RETAIL_BOOKS = new Set([
  "bet365", "betmgm", "betrivers", "bovada", "caesars", "draftkings",
  "espnbet", "fanduel", "fanatics", "hardrock", "hardrockbet",
]);

export function mlbPropsMarketEvidenceId(row: Pick<PlayerPropPreviewRow,
  "player" | "market" | "line" | "providerIds"
>): string {
  const key = [
    normalizeProviderId(row.providerIds?.bdlGameId ?? row.providerIds?.gameId ?? ""),
    normalizeProviderId(String(row.providerIds?.bdlPlayerId ?? normalizeName(row.player))),
    row.market,
    row.line,
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function mlbPropsMarketEvidenceInput(args: MlbPropsMarketEvidenceInput): {
  [MLB_PROPS_MARKET_EVIDENCE_INPUT]: MlbPropsMarketEvidenceInput;
} {
  return { [MLB_PROPS_MARKET_EVIDENCE_INPUT]: args };
}

export function buildMlbPropsMarketEvidenceCapture(args: {
  currentOdds: readonly PropOddsSnapshot[];
  openingOdds: readonly PropOddsSnapshot[];
  contexts: ReadonlyMap<string, MlbPropMarketContext>;
  rows: readonly MlbPropsMarketEvidenceRow[];
  evaluatedAt: string;
  maximumQuoteAgeMinutes: number;
}): { capture: MlbPropsMarketEvidenceCapture; retainedIds: ReadonlySet<string>; addedBytes: number } {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("MLB props evidence evaluatedAt is invalid.");
  const maximumQuoteAgeMinutes = Number.isFinite(args.maximumQuoteAgeMinutes) && args.maximumQuoteAgeMinutes > 0
    ? args.maximumQuoteAgeMinutes
    : 45;
  const rowGroups = groupBy(args.rows, rowIdentityKey);
  const currentGroups = groupBy(args.currentOdds, oddsIdentityKey);
  const openingGroups = groupBy(args.openingOdds, oddsIdentityBaseKey);
  const candidates = [...rowGroups.entries()].map(([key, rows]) => buildCandidate({
    rows,
    currentOdds: currentGroups.get(key) ?? [],
    openingOdds: openingGroups.get(rowIdentityBaseKey(rows[0]!)) ?? [],
    contexts: args.contexts,
    evaluatedAt,
    maximumQuoteAgeMinutes,
  }));
  return finalizeCapture({
    candidates,
    rows: args.rows,
    maximumQuoteAgeMinutes,
    budgetBytes: MLB_PROPS_MARKET_EVIDENCE_CANONICAL_TARGET_BYTES,
    hardBytes: MLB_PROPS_MARKET_EVIDENCE_MAX_CANONICAL_ADDED_BYTES,
  });
}

export function attachMlbPropsMarketEvidenceReferences<T extends MlbPropsMarketEvidenceRow>(
  rows: readonly T[],
  retainedIds: ReadonlySet<string>,
): T[] {
  return rows.map((row) => {
    const clean = withoutMlbPropsMarketEvidenceInput(row);
    const id = mlbPropsMarketEvidenceId(row);
    return retainedIds.has(id) ? { ...clean, marketEvidenceId: id } : clean;
  });
}

export function subsetMlbPropsMarketEvidenceCapture(args: {
  capture?: MlbPropsMarketEvidenceCapture | null;
  rows: readonly MlbPropsMarketEvidenceRow[];
  preserveLocked?: boolean;
}): { capture: MlbPropsMarketEvidenceCapture | null; retainedIds: ReadonlySet<string>; addedBytes: number } {
  if (!args.capture) return { capture: null, retainedIds: new Set(), addedBytes: 0 };
  const referenced = new Set(args.rows.flatMap((row) => row.marketEvidenceId ? [row.marketEvidenceId] : []));
  const candidates = args.capture.i
    .filter((identity) => referenced.has(identity[0]))
    .map((identity) => ({ id: identity[0], market: identity[1], identity }));
  const requiredIds = new Set(args.preserveLocked === false
    ? []
    : args.rows.flatMap((row) => row.lockStatus?.status === "locked" && row.marketEvidenceId
      ? [row.marketEvidenceId]
      : []));
  return finalizeCapture({
    candidates,
    rows: args.rows,
    maximumQuoteAgeMinutes: args.capture.fm,
    budgetBytes: MLB_PROPS_MARKET_EVIDENCE_MEMBER_TARGET_BYTES,
    hardBytes: MLB_PROPS_MARKET_EVIDENCE_MAX_MEMBER_ADDED_BYTES,
    requiredIds,
  });
}

export function mergeMlbPropsMarketEvidenceCaptures(args: {
  captures: readonly (MlbPropsMarketEvidenceCapture | null | undefined)[];
  rows: readonly MlbPropsMarketEvidenceRow[];
  allowTransientLockedOverflow?: true;
}): { capture: MlbPropsMarketEvidenceCapture | null; retainedIds: ReadonlySet<string>; addedBytes: number } {
  const tuples = new Map<string, MlbPropsMarketEvidenceIdentity>();
  for (const capture of args.captures) {
    for (const identity of capture?.i ?? []) tuples.set(identity[0], identity);
  }
  const referenced = new Set(args.rows.flatMap((row) => row.marketEvidenceId ? [row.marketEvidenceId] : []));
  const candidates = [...tuples.values()]
    .filter((identity) => referenced.has(identity[0]))
    .map((identity) => ({ id: identity[0], market: identity[1], identity }));
  if (!candidates.length) return { capture: null, retainedIds: new Set(), addedBytes: 0 };
  const requiredIds = new Set(args.rows.flatMap((row) =>
    row.lockStatus?.status === "locked" && row.marketEvidenceId ? [row.marketEvidenceId] : []));
  return finalizeCapture({
    candidates,
    rows: args.rows,
    maximumQuoteAgeMinutes: args.captures.find(Boolean)?.fm ?? 45,
    budgetBytes: MLB_PROPS_MARKET_EVIDENCE_CANONICAL_TARGET_BYTES,
    hardBytes: args.allowTransientLockedOverflow
      ? MLB_PROPS_MARKET_EVIDENCE_MAX_TRANSIENT_LOCK_MERGE_BYTES
      : MLB_PROPS_MARKET_EVIDENCE_MAX_CANONICAL_ADDED_BYTES,
    requiredIds,
  });
}

export function withoutUnretainedMlbPropsEvidenceReference<T extends MlbPropsMarketEvidenceRow>(
  row: T,
  retainedIds: ReadonlySet<string>,
): T {
  if (!row.marketEvidenceId || retainedIds.has(row.marketEvidenceId)) return row;
  if (row.lockStatus?.status === "locked") {
    throw new Error(`MLB props evidence cap cannot discard locked identity ${row.marketEvidenceId}.`);
  }
  const rest = { ...row };
  Reflect.deleteProperty(rest, "marketEvidenceId");
  return rest;
}

function withoutMlbPropsMarketEvidenceInput<T extends MlbPropsMarketEvidenceRow>(row: T): T {
  if (!(MLB_PROPS_MARKET_EVIDENCE_INPUT in row)) return row;
  const rest = { ...row };
  Reflect.deleteProperty(rest, MLB_PROPS_MARKET_EVIDENCE_INPUT);
  return rest;
}

function buildCandidate(args: {
  rows: readonly MlbPropsMarketEvidenceRow[];
  currentOdds: readonly PropOddsSnapshot[];
  openingOdds: readonly PropOddsSnapshot[];
  contexts: ReadonlyMap<string, MlbPropMarketContext>;
  evaluatedAt: number;
  maximumQuoteAgeMinutes: number;
}): Candidate {
  const representative = args.rows[0];
  if (!representative) throw new Error("MLB props evidence identity is empty.");
  const market = MARKET_CODES[representative.market as MlbPropMarketKey];
  if (!market) throw new Error(`MLB props evidence market is unsupported: ${representative.market}`);
  const id = mlbPropsMarketEvidenceId(representative);
  const milestone = args.rows.some((row) => row.offerContract === "milestone");
  const currentByBook = latestOddsByBookAndSide(args.currentOdds);
  const openingByBook = latestOddsByBookAndSide(args.openingOdds);
  const bookNames = [...new Set([...currentByBook.keys()].map((key) => key.split("|")[0]!))];
  const completeBooks = bookNames.filter((book) => isCompleteBook(currentByBook, book, milestone));
  const freshCompleteBooks = completeBooks.filter((book) => isFreshBook(
    currentByBook,
    book,
    milestone,
    args.evaluatedAt,
    args.maximumQuoteAgeMinutes,
  ));
  const incompleteObserved = bookNames.length - completeBooks.length;
  const staleCompleteObserved = completeBooks.length - freshCompleteBooks.length;
  const retainedBookNames = sourceStratifiedBooks(freshCompleteBooks)
    .slice(0, MLB_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY);
  const books = retainedBookNames.map((book) => bookTuple(book, currentByBook, openingByBook));
  const evaluatedBooks = [...new Set(args.rows.map((row) => normalizeBook(row.book)))];
  const minimumTargetExcludedComparators = evaluatedBooks.length
    ? Math.min(...evaluatedBooks.map((target) => freshCompleteBooks.filter((book) => book !== target).length))
    : freshCompleteBooks.length;
  const comparatorReason = reasonForBreadth({
    complete: minimumTargetExcludedComparators,
    incompleteObserved,
    staleCompleteObserved,
  });
  const openingBooks = books.filter((book) => book[6] !== null).length;
  const splitRows = books.reduce((sum, book) => sum + book[12].length, 0);
  const breadth: MlbPropsMarketEvidenceBreadth = [
    freshCompleteBooks.length,
    books.length,
    books.filter((book) => book[2] === "s").length,
    books.filter((book) => book[2] === "r").length,
    books.filter((book) => book[2] === "u").length,
    incompleteObserved,
    staleCompleteObserved,
    minimumTargetExcludedComparators,
    comparatorReason,
    openingBooks,
    openingBooks >= 2 ? "c" : openingBooks === 1 ? "1" : "m",
    splitRows,
    splitRows >= 2 ? "c" : splitRows === 1 ? "1" : "m",
  ];
  const over = args.rows.find((row) => row.side === "over");
  const under = args.rows.find((row) => row.side === "under");
  const evidenceInput = (over ?? under)?.[MLB_PROPS_MARKET_EVIDENCE_INPUT];
  const context = evidenceInput?.context
    ?? contextForRows(args.rows, args.contexts);
  const contextTuple: MlbPropsMarketEvidenceContext = [
    context?.currentOverProbability ?? null,
    context?.movementAdjustmentOver ?? 0,
    context?.relatedMovementAdjustmentOver ?? 0,
    context?.splitAdjustmentOver ?? 0,
    context?.openingBooks ?? 0,
    context?.relatedMarkets ?? 0,
    context?.splitEvidenceRows ?? 0,
  ];
  const output: MlbPropsMarketEvidenceOutput = [
    evidenceInput?.independentProjection ?? null,
    (over ?? under)?.projection ?? null,
    (over ?? under)?.shrinkageWeight ?? null,
    over?.independentProbability ?? (under?.independentProbability === null || under?.independentProbability === undefined
      ? null
      : 1 - under.independentProbability),
    under?.independentProbability ?? (over?.independentProbability === null || over?.independentProbability === undefined
      ? null
      : 1 - over.independentProbability),
    over?.overProbability ?? under?.overProbability ?? null,
    over?.underProbability ?? under?.underProbability ?? null,
  ];
  return { id, market, identity: [id, market, books, breadth, contextTuple, output] };
}

function finalizeCapture(args: {
  candidates: readonly Candidate[];
  rows: readonly MlbPropsMarketEvidenceRow[];
  maximumQuoteAgeMinutes: number;
  budgetBytes: number;
  hardBytes: number;
  requiredIds?: ReadonlySet<string>;
}): { capture: MlbPropsMarketEvidenceCapture; retainedIds: ReadonlySet<string>; addedBytes: number } {
  const unique = new Map(args.candidates.map((candidate) => [candidate.id, candidate]));
  const all = [...unique.values()];
  const required = all.filter((candidate) => args.requiredIds?.has(candidate.id))
    .sort(compareCandidate);
  const optionalCandidates = all.filter((candidate) => !args.requiredIds?.has(candidate.id));
  const requiredMarkets = new Set(required.map((candidate) => candidate.market));
  const categorySeeds = [...groupBy(optionalCandidates, (candidate) => candidate.market).entries()]
    .filter(([market]) => !requiredMarkets.has(market))
    .sort(([first], [second]) => first.localeCompare(second))
    .flatMap(([, rows]) => [...rows].sort(compareCandidate).slice(0, 1));
  const seedIds = new Set(categorySeeds.map((candidate) => candidate.id));
  const optional = stratifiedIdentityOrder(optionalCandidates.filter((candidate) => !seedIds.has(candidate.id)));
  const minimum = [...required, ...categorySeeds];
  const referenceOccurrences = countReferences(args.rows);
  let best = materializeCapture(minimum, all, args.maximumQuoteAgeMinutes, args.budgetBytes);
  if (addedBytes(best, referenceOccurrences) > args.hardBytes) {
    throw new Error(`MLB props evidence required identities exceed ${args.hardBytes} bytes.`);
  }
  let low = 0;
  let high = optional.length;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const trial = materializeCapture(
      [...minimum, ...optional.slice(0, middle)],
      all,
      args.maximumQuoteAgeMinutes,
      args.budgetBytes,
    );
    if (addedBytes(trial, referenceOccurrences) <= args.budgetBytes) {
      best = trial;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const retainedIds = new Set(best.i.map((identity) => identity[0]));
  const bytes = addedBytes(best, referenceOccurrences, retainedIds);
  if (bytes > args.hardBytes) throw new Error(`MLB props evidence exceeds ${args.hardBytes} bytes.`);
  return { capture: best, retainedIds, addedBytes: bytes };
}

function materializeCapture(
  selected: readonly Candidate[],
  all: readonly Candidate[],
  maximumQuoteAgeMinutes: number,
  targetBytes: number,
): MlbPropsMarketEvidenceCapture {
  const identities = [...new Map(selected.map((candidate) => [candidate.id, candidate])).values()]
    .sort(compareCandidate)
    .map((candidate) => candidate.identity);
  const markets = [...new Set(all.map((candidate) => candidate.market))].sort();
  return {
    r: MLB_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE,
    s: MLB_PROPS_MARKET_EVIDENCE_SCHEMA,
    mb: MLB_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY,
    hb: MLB_PROPS_MARKET_EVIDENCE_MAX_CANONICAL_ADDED_BYTES,
    hm: MLB_PROPS_MARKET_EVIDENCE_MAX_MEMBER_ADDED_BYTES,
    tb: targetBytes,
    rt: MLB_PROPS_MARKET_EVIDENCE_RETENTION,
    sp: identities.some((identity) => identity[3][11] > 0) ? "v" : "n",
    fm: maximumQuoteAgeMinutes,
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
  capture: MlbPropsMarketEvidenceCapture,
  references: ReadonlyMap<string, number>,
  retainedIds = new Set(capture.i.map((identity) => identity[0])),
): number {
  let bytes = Buffer.byteLength(`,"marketEvidence":${JSON.stringify(capture)}`);
  for (const [id, count] of references) {
    if (retainedIds.has(id)) bytes += count * Buffer.byteLength(`,"marketEvidenceId":"${id}"`);
  }
  return bytes;
}

function bookTuple(
  book: string,
  current: ReadonlyMap<string, PropOddsSnapshot>,
  openings: ReadonlyMap<string, PropOddsSnapshot>,
): MlbPropsMarketEvidenceBook {
  const over = current.get(`${book}|over`);
  const under = current.get(`${book}|under`);
  const currentRow = later(over, under);
  if (!currentRow) throw new Error(`MLB props evidence book ${book} has no current quote.`);
  const openingOver = openings.get(`${book}|over`);
  const openingUnder = openings.get(`${book}|under`);
  const opening = earlier(openingOver, openingUnder);
  const providerChangedAt = providerChangedTimestamp(currentRow);
  const observedAt = Date.parse(currentRow.asOfTimestamp);
  const changedAt = providerChangedAt ? Date.parse(providerChangedAt) : Number.NaN;
  const skew = Number.isFinite(observedAt) && Number.isFinite(changedAt) ? observedAt - changedAt : null;
  const openingLine = openingOver && openingUnder && openingOver.line !== openingUnder.line
    ? null
    : opening?.line ?? null;
  const splits = [over, under].flatMap((row) => row ? verifiedSplit(row) : []);
  return [
    book,
    providerCode(currentRow.provider),
    sourceClassForBook(book),
    currentRow.asOfTimestamp,
    providerChangedAt,
    skew,
    opening?.asOfTimestamp ?? null,
    openingLine,
    over?.americanOdds ?? null,
    under?.americanOdds ?? null,
    openingOver?.americanOdds ?? null,
    openingUnder?.americanOdds ?? null,
    splits,
  ];
}

function verifiedSplit(row: PropOddsSnapshot): MlbPropsMarketEvidenceSplit[] {
  const raw = asRecord(row.rawPayload);
  const source = stringValue(raw.split_source);
  const timestamp = stringValue(raw.split_updated_at);
  const tickets = percentage(raw.bet_percentage ?? raw.public_bets_percentage);
  const money = percentage(raw.money_percentage ?? raw.handle_percentage ?? raw.public_money_percentage);
  if (!source || !timestamp || tickets === null || money === null) return [];
  const age = Date.parse(row.asOfTimestamp) - Date.parse(timestamp);
  if (!Number.isFinite(age) || age < 0 || age > 2 * 60 * 60 * 1000) return [];
  return [[row.side === "over" ? "o" : "u", splitClass(source), timestamp, tickets, money]];
}

function contextForRows(
  rows: readonly MlbPropsMarketEvidenceRow[],
  contexts: ReadonlyMap<string, MlbPropMarketContext>,
): MlbPropMarketContext | null {
  for (const row of rows) {
    const gameId = normalizeProviderId(row.providerIds?.bdlGameId ?? row.providerIds?.gameId ?? "");
    const playerId = normalizeProviderId(String(row.providerIds?.bdlPlayerId ?? ""));
    const key = [
      `balldontlie-game-${gameId}`,
      `balldontlie-player-${playerId}`,
      row.market,
      row.line,
      normalizeBook(row.book),
      row.side,
    ].join("|");
    const context = contexts.get(key);
    if (context) return context;
  }
  return null;
}

function countReferences(rows: readonly MlbPropsMarketEvidenceRow[]): Map<string, number> {
  const references = new Map<string, number>();
  for (const row of rows) {
    const id = row.marketEvidenceId ?? mlbPropsMarketEvidenceId(row);
    references.set(id, (references.get(id) ?? 0) + 1);
  }
  return references;
}

function latestOddsByBookAndSide(rows: readonly PropOddsSnapshot[]): Map<string, PropOddsSnapshot> {
  const selected = new Map<string, PropOddsSnapshot>();
  for (const row of rows) {
    const key = `${normalizeBook(row.sportsbook)}|${row.side}`;
    const previous = selected.get(key);
    if (!previous || Date.parse(row.asOfTimestamp) > Date.parse(previous.asOfTimestamp)) selected.set(key, row);
  }
  return selected;
}

function isCompleteBook(
  rows: ReadonlyMap<string, PropOddsSnapshot>,
  book: string,
  milestone: boolean,
): boolean {
  return milestone ? rows.has(`${book}|over`) : rows.has(`${book}|over`) && rows.has(`${book}|under`);
}

function isFreshBook(
  rows: ReadonlyMap<string, PropOddsSnapshot>,
  book: string,
  milestone: boolean,
  evaluatedAt: number,
  maximumQuoteAgeMinutes: number,
): boolean {
  const required = milestone
    ? [rows.get(`${book}|over`)]
    : [rows.get(`${book}|over`), rows.get(`${book}|under`)];
  return required.every((row) => {
    if (!row) return false;
    const age = evaluatedAt - Date.parse(row.asOfTimestamp);
    return Number.isFinite(age) && age >= 0 && age <= maximumQuoteAgeMinutes * 60_000;
  });
}

function reasonForBreadth(args: {
  complete: number;
  incompleteObserved: number;
  staleCompleteObserved: number;
}): BreadthReasonCode {
  if (args.complete >= 2) return "c";
  if (args.complete === 1) return "1";
  if (args.incompleteObserved > 0) return "i";
  if (args.staleCompleteObserved > 0) return "t";
  return "m";
}

function stratifiedIdentityOrder(candidates: readonly Candidate[]): Candidate[] {
  const groups = [...groupBy(candidates, (candidate) => candidate.market).entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([, rows]) => [...rows].sort(compareCandidate));
  const ordered: Candidate[] = [];
  for (let index = 0; groups.some((rows) => index < rows.length); index += 1) {
    for (const rows of groups) if (rows[index]) ordered.push(rows[index]!);
  }
  return ordered;
}

function sourceStratifiedBooks(books: readonly string[]): string[] {
  const groups = (["s", "r", "u"] as const).map((sourceClass) => books
    .filter((book) => sourceClassForBook(book) === sourceClass)
    .sort());
  const ordered: string[] = [];
  for (let index = 0; groups.some((rows) => index < rows.length); index += 1) {
    for (const rows of groups) if (rows[index]) ordered.push(rows[index]!);
  }
  return ordered;
}

function compareCandidate(first: Candidate, second: Candidate): number {
  return first.market.localeCompare(second.market) || first.id.localeCompare(second.id);
}

function rowIdentityKey(row: PlayerPropPreviewRow): string {
  return [
    normalizeProviderId(row.providerIds?.bdlGameId ?? row.providerIds?.gameId ?? ""),
    normalizeProviderId(String(row.providerIds?.bdlPlayerId ?? normalizeName(row.player))),
    row.market,
    row.line,
  ].join("|");
}

function rowIdentityBaseKey(row: PlayerPropPreviewRow): string {
  return [
    normalizeProviderId(row.providerIds?.bdlGameId ?? row.providerIds?.gameId ?? ""),
    normalizeProviderId(String(row.providerIds?.bdlPlayerId ?? normalizeName(row.player))),
    row.market,
  ].join("|");
}

function oddsIdentityKey(row: PropOddsSnapshot): string {
  return [
    normalizeProviderId(rawId(row, "bdl_game_id") ?? row.gameId),
    normalizeProviderId(rawId(row, "bdl_player_id") ?? row.playerId),
    row.marketKey,
    row.line,
  ].join("|");
}

function oddsIdentityBaseKey(row: PropOddsSnapshot): string {
  return [
    normalizeProviderId(rawId(row, "bdl_game_id") ?? row.gameId),
    normalizeProviderId(rawId(row, "bdl_player_id") ?? row.playerId),
    row.marketKey,
  ].join("|");
}

function rawId(row: PropOddsSnapshot, key: string): string | null {
  return stringValue(asRecord(row.rawPayload)[key]);
}

function providerChangedTimestamp(row: PropOddsSnapshot): string | null {
  return stringValue(asRecord(row.rawPayload).updated_at);
}

function providerCode(value: string): ProviderCode {
  const normalized = value.toLowerCase();
  if (normalized.includes("balldontlie")) return "b";
  if (normalized.includes("sharp")) return "s";
  return "u";
}

function sourceClassForBook(value: string): SourceClassCode {
  const book = normalizeBook(value);
  if (SHARP_BOOKS.has(book)) return "s";
  if (RETAIL_BOOKS.has(book)) return "r";
  return "u";
}

function splitClass(value: string): SplitClassCode {
  const normalized = value.toLowerCase();
  if (normalized.includes("circa")) return "c";
  if (normalized.includes("sharp")) return "s";
  if (normalized.includes("public") || normalized.includes("ticket")) return "p";
  return "u";
}

function later(
  first: PropOddsSnapshot | undefined,
  second: PropOddsSnapshot | undefined,
): PropOddsSnapshot | undefined {
  if (!first) return second;
  if (!second) return first;
  return Date.parse(first.asOfTimestamp) >= Date.parse(second.asOfTimestamp) ? first : second;
}

function earlier(
  first: PropOddsSnapshot | undefined,
  second: PropOddsSnapshot | undefined,
): PropOddsSnapshot | undefined {
  if (!first) return second;
  if (!second) return first;
  return Date.parse(first.asOfTimestamp) <= Date.parse(second.asOfTimestamp) ? first : second;
}

function percentage(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  const decimal = parsed > 1 ? parsed / 100 : parsed;
  return decimal >= 0 && decimal <= 1 ? decimal : null;
}

function groupBy<T, K>(rows: readonly T[], keyFor: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim()
    : typeof value === "number" && Number.isFinite(value) ? String(value)
      : null;
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeProviderId(value: string): string {
  return value.toLowerCase().replace(/^(balldontlie|mlbstats)-(game|player)-/, "").replace(/[^a-z0-9]/g, "");
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]/g, "");
}
