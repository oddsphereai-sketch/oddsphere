import { CBB_CONTEXTUAL_CONSUMER_BOOKS, cbbContextualConsumerBook, type CbbContextualFeatureInput, type CbbContextualQuote, type CbbContextualConsumerQuote } from "./contextualForecastFeatures";
import type { CbbDecisionSplitContext } from "./decisionSplitContext";
import type { CbbMarket } from "./types";
import { cbbPathBookFamily, expandCbbMarketBehaviorPathStream } from "./marketBehaviorPath";
import { cbbAvailabilityUpperBoundMs, cbbEvidenceReceiptBounds } from "./marketReceiptTime";

/** Observations and their economic ordering only. This receipt neither identifies
 * bettors/intent nor supplies a forecast correction, probability or grade. */
export const CBB_CONTEXTUAL_MARKET_INTERPRETATION_RELEASE = "cbb_contextual_market_interpretation_2026_11_05_v2_source_baseline_namespaces" as const;
export type CbbEconomicDirection = -1 | 0 | 1 | null;
export type CbbIdentityContinuity = "exact_native" | "independently_fixture_bound" | "conflict";
export type CbbInterpretationRole = "professional" | "consumer" | "retail_context" | "public_context";
export type CbbInterpretedQuote = {
  line: number | null; firstPrice: number; secondPrice: number; logit: number;
  nativeAt: string; availableBy: string; receiptEarliest: string | null;
  eventId: string | null; provider: string | null; phase: "opening" | "current";
  observedAgainAt: string[]; isCurrentInput: boolean;
  rawQuote: CbbContextualQuote | CbbContextualConsumerQuote;
};
export type CbbEconomicChange = { lineDelta: number; logitDelta: number; direction: CbbEconomicDirection };
export type CbbInterpretedPriceLeg = CbbEconomicChange & { before: CbbInterpretedQuote; after: CbbInterpretedQuote };
export type CbbInterpretedPressure = {
  nativeAt: string | null; availableBy: string; receiptEarliest: string | null;
  eventId: string | null; provider: string | null; line: number | null; moneyBalance: number | null; ticketBalance: number | null;
  firstMoney: number | null; secondMoney: number | null; firstTickets: number | null; secondTickets: number | null;
  sourceClass: CbbDecisionSplitContext["sourceClass"]; clockBasis: CbbDecisionSplitContext["clockBasis"];
  composition: "cumulative_share_not_money_flow"; observedAgainAt: string[]; conflict: boolean;
};
export type CbbInterpretedPressureResponse = {
  pressure: CbbInterpretedPressure; baseline: CbbInterpretedQuote | null; response: CbbInterpretedQuote | null;
  continuity: CbbIdentityContinuity; direction: CbbEconomicDirection;
  relation: "toward_composition" | "against_composition" | "held_observed" | "returned_to_baseline" | "unknown";
  net: CbbEconomicChange | null; latest: CbbEconomicChange | null;
  laterReversal: boolean; hadActualMove: boolean; currentPressureMatch: boolean; responseIsCurrent: boolean;
  laterPressureChanged: boolean; activeCurrent: boolean; reason: string;
};
export type CbbInterpretationSequenceEntry = { kind: "quote" | "pressure"; index: number; nativeAt: string | null; availableBy: string };
export type CbbInterpretedMarketStream = {
  book: string; market: CbbMarket; role: CbbInterpretationRole;
  continuity: CbbIdentityContinuity; currentQuote: CbbInterpretedQuote | null; quotes: CbbInterpretedQuote[]; legs: CbbInterpretedPriceLeg[];
  chronology: { nativeSequence: CbbInterpretationSequenceEntry[]; availabilitySequence: CbbInterpretationSequenceEntry[] };
  pressures: CbbInterpretedPressure[]; pressureResponses: CbbInterpretedPressureResponse[];
  net: CbbEconomicChange | null; latest: CbbEconomicChange | null;
  baselineNet: { baseline:CbbInterpretedQuote;current:CbbInterpretedQuote;change:CbbEconomicChange;continuity:CbbIdentityContinuity;spanHours:number;openingProven:boolean;historyGap:boolean } | null;
  pathResolution: "unavailable" | "held_observed" | "ongoing" | "buyback" | "resumption" | "ambiguous";
  latestObservation: "actual_native_move" | "fresh_receipt_same_native_state" | "later_native_unchanged_price" | "single_observation" | "conflict";
  coverage: { firstRetainedAt: string | null; lastRetainedAt: string | null; interpretedFromAt: string | null; truncated: boolean; interrupted: boolean; openingProven: boolean };
  unknowns: string[];
};
export type CbbCrossMarketInterpretation = {
  book: string; continuity: CbbIdentityContinuity; totalNetDirection: CbbEconomicDirection; totalLatestDirection: CbbEconomicDirection; netRelation: "aligned" | "opposed" | "flat_or_missing" | "ambiguous";
  latestRelation: "aligned" | "opposed" | "flat_or_missing" | "ambiguous";
  currentMoneylineFavorite: -1 | 0 | 1 | null; spreadHomeHandicap: number | null;
  favoriteWinUnderdogCover: { favorite: "home" | "away"; homeMarginLowerExclusive: number; homeMarginUpperExclusive: number; minimumIntegerHomeMargin: number; maximumIntegerHomeMargin: number } | null;
  meaning: "movement_disagreement_is_not_outcome_contradiction; middle_is_contract_geometry_not_probability";
};
export type CbbContextualMarketInterpretation = {
  release: typeof CBB_CONTEXTUAL_MARKET_INTERPRETATION_RELEASE; gameId: number; asOf: string;
  streams: CbbInterpretedMarketStream[]; crossMarket: CbbCrossMarketInterpretation[];
  rejected: { book: string; market: CbbMarket; reason: string }[];
  caveats: readonly string[];
};
const sign = (n: number): -1 | 0 | 1 => n === 0 ? 0 : n > 0 ? 1 : -1;
const family = (book: string) => cbbContextualConsumerBook(cbbPathBookFamily(book.trim().toLowerCase())).replace(/^draftkings_network$/, "draftkings");
const pro = (book: string) => ["circa", "pinnacle", "bookmaker"].includes(book);
const implied = (p: number) => p > 0 ? 100 / (100 + p) : -p / (100 - p);
const economic = (q: Pick<CbbInterpretedQuote, "line" | "firstPrice" | "secondPrice">) => JSON.stringify([q.line, q.firstPrice, q.secondPrice]);
const validMarket = (m: string): m is CbbMarket => ["moneyline", "spread", "total"].includes(m);
/** Opposed line/juice cannot be ordered without a score-shape assumption. */
export function cbbPartialEconomicChange(market: CbbMarket, before: Pick<CbbInterpretedQuote, "line" | "logit">, after: Pick<CbbInterpretedQuote, "line" | "logit">): CbbEconomicChange {
  const lineDelta = (after.line ?? 0) - (before.line ?? 0), logitDelta = after.logit - before.logit;
  const axis = market === "moneyline" ? 0 : market === "spread" ? -lineDelta : lineDelta;
  const direction = axis === 0 ? sign(logitDelta) : logitDelta === 0 || sign(axis) === sign(logitDelta) ? sign(axis) : null;
  return { lineDelta, logitDelta, direction };
}
const change = (market: CbbMarket, a: CbbInterpretedQuote, b: CbbInterpretedQuote) => cbbPartialEconomicChange(market, a, b);
export const cbbInterpretationIdentityContinuity = (rows: readonly {eventId:string|null;provider:string|null}[]): CbbIdentityContinuity => {
  const namespaces=new Map<string,Set<string>>();for(const r of rows)if(r.provider&&r.eventId){const ids=namespaces.get(r.provider)??new Set<string>();ids.add(r.eventId);namespaces.set(r.provider,ids);}
  if([...namespaces.values()].some(ids=>ids.size>1))return "conflict";
  return rows.length>0&&rows.every(r=>r.provider!==null&&r.eventId!==null)&&namespaces.size===1?"exact_native":"independently_fixture_bound";
};
const identity=cbbInterpretationIdentityContinuity;
const priceValid = (market: CbbMarket, line: number | null, first: number, second: number) =>
  [first, second].every(p => Number.isFinite(p) && Math.abs(p) >= 100) &&
  (market === "moneyline" ? line === null : line !== null && Number.isFinite(line) && Number.isInteger(line * 2) && (market !== "total" || line > 0));
const validPair = (a: number | null, b: number | null) => a === null && b === null || a !== null && b !== null && [a, b].every(v => Number.isFinite(v) && v >= 0 && v <= 1) && Math.abs(a + b - 1) <= .03;
const composition = (a: number | null, b: number | null) => a === null || b === null ? null : a - b;
const clock = (value: string) => cbbAvailabilityUpperBoundMs(value);
const comparable = (a: CbbEconomicDirection | undefined, b: CbbEconomicDirection | undefined): CbbCrossMarketInterpretation["netRelation"] =>
  a === null || b === null ? "ambiguous" : !a || !b ? "flat_or_missing" : a === b ? "aligned" : "opposed";

export function buildCbbContextualMarketInterpretation(input: CbbContextualFeatureInput): CbbContextualMarketInterpretation {
  const at = Date.parse(input.asOf), start = Date.parse(input.startsAt), gameId = input.independent.gameId;
  if (!Number.isSafeInteger(gameId) || gameId <= 0 || !Number.isFinite(at) || !Number.isFinite(start) || at >= start) throw Error("CBB interpretation requires exact pregame fixture/cutoff");
  const rejected: CbbContextualMarketInterpretation["rejected"] = [];
  const buckets = new Map<string, { book: string; market: CbbMarket; role: CbbInterpretationRole; quotes: CbbInterpretedQuote[]; baselines: CbbInterpretedQuote[]; pressures: CbbInterpretedPressure[]; unknowns: Set<string>; conflictTimes: Set<number>; truncated: boolean; interrupted: boolean }>();
  const bucket = (book: string, market: CbbMarket, role: CbbInterpretationRole) => {
    const key = `${role}:${book}:${market}`;
    if (!buckets.has(key)) buckets.set(key, { book, market, role, quotes: [], baselines: [], pressures: [], unknowns: new Set(), conflictTimes: new Set(), truncated: false, interrupted: false });
    return buckets.get(key)!;
  };
  const reject = (book: string, market: CbbMarket, reason: string) => { rejected.push({ book, market, reason }); };
  const addQuote = (q: CbbContextualQuote | CbbContextualConsumerQuote, consumer: boolean, isCurrentInput = false, isBaseline = false) => {
    const book = family(q.sportsbook), market = q.market;
    if (!book || !validMarket(market)) return;
    const b = bucket(book, market, pro(book) ? "professional" : "consumer");
    try {
      const cq = q as CbbContextualConsumerQuote, pq = q as CbbContextualQuote;
      const native = clock(q.providerObservedAt);
      const bounds = consumer ? { available: clock(cq.availableBy), earliest: cq.fetchedAt ? Date.parse(cq.fetchedAt) : NaN } : cbbEvidenceReceiptBounds(pq);
      const oriented = consumer ? ["stored_labeled_pair", "named_fixture_attested", "native_home_away_fields", "canonical_named_fixture_join"].includes(cq.orientationProof) : pq.orientationVerified === true;
      const eventId = q.canonicalReceipt?.providerEventId ?? q.sourceEventId ?? null;
      const canonical = q.canonicalReceipt ? cbbEvidenceReceiptBounds({ fetchedAt: q.fetchedAt ?? "", canonicalReceipt: q.canonicalReceipt }) : null;
      const requested = q.requestedAt === undefined ? null : Date.parse(q.requestedAt);
      if (!isBaseline && q.sourceEventId && q.canonicalReceipt?.providerEventId && q.sourceEventId !== q.canonicalReceipt.providerEventId && q.gameId === gameId && oriented && Number.isFinite(native) && native <= at && Number.isFinite(bounds.available) && bounds.available <= at) b.conflictTimes.add(native);
      const hold = implied(q.firstPrice) + implied(q.secondPrice);
      const invalid = ("canonicalReceipt" in q && q.canonicalReceipt !== undefined && !q.canonicalReceipt) || hold < .98 || hold > 1.3 || q.gameId !== gameId || !oriented || !consumer && isCurrentInput && pq.phase !== "current" || !priceValid(market, q.line, q.firstPrice, q.secondPrice) ||
        !Number.isFinite(native) || !Number.isFinite(bounds.available) || native > bounds.available || bounds.available > at ||
        (canonical !== null && (!Number.isFinite(canonical.available) || canonical.available !== bounds.available)) ||
        (q.sourceEventId !== undefined && (!q.sourceEventId || q.canonicalReceipt && q.sourceEventId !== q.canonicalReceipt.providerEventId)) ||
        (requested !== null && (!Number.isFinite(requested) || !Number.isFinite(bounds.earliest) || requested > bounds.earliest)) ||
        (Number.isFinite(bounds.earliest) && bounds.earliest > bounds.available);
      if (invalid) { reject(book, market, "invalid_quote_identity_orientation_contract_or_availability"); return; }
      if (consumer && (!["http_response", "db_inserted_upper_bound", "stored_snapshot_upper_bound"].includes(cq.availabilityKind) || cq.availabilityKind === "http_response" && (!Number.isFinite(bounds.earliest) || bounds.earliest !== bounds.available || native > bounds.earliest))) { reject(book, market, "unknown_consumer_availability_kind"); return; }
      if (!eventId) b.unknowns.add("opaque_native_quote_identity_missing_fixture_binding_only");
      (isBaseline?b.baselines:b.quotes).push({ line: q.line, firstPrice: q.firstPrice, secondPrice: q.secondPrice, logit: Math.log(implied(q.firstPrice) / implied(q.secondPrice)), nativeAt: q.providerObservedAt,
        availableBy: consumer ? cq.availableBy : q.canonicalReceipt?.availableBy ?? q.fetchedAt!, receiptEarliest: Number.isFinite(bounds.earliest) ? q.fetchedAt ?? null : null,
        eventId, provider: q.provider ?? null, phase: "phase" in q ? q.phase : "current", observedAgainAt: [], isCurrentInput, rawQuote: structuredClone(q) });
    } catch { reject(book, market, "invalid_quote_receipt"); }
  };
  for(const q of input.sourceBaselineQuotes??[]){if(!Number.isFinite(clock(q.knownBy))||clock(q.knownBy)>at||("availabilityKind"in q?clock(q.availableBy):cbbEvidenceReceiptBounds(q).available)>clock(q.knownBy)){reject(family(q.sportsbook),q.market,"baseline_knowledge_after_cutoff");continue;}addQuote(q,"availabilityKind"in q,false,true);}
  for (const q of input.historyQuotes ?? []) addQuote(q, false);
  for (const q of input.currentQuotes) addQuote(q, false, true);
  for (const q of input.consumerHistoryQuotes ?? []) addQuote(q, true);
  for (const q of input.consumerCurrentQuotes ?? []) addQuote(q, true, true);
  const rawPressure: CbbDecisionSplitContext[] = [];
  const flatten = (rows: readonly CbbDecisionSplitContext[]) => { for (const r of rows) { rawPressure.push(r); if (r.sourceHistory) flatten(r.sourceHistory); } };
  flatten(input.splitContext ?? []);
  if (input.pathTape) {
    const tape = input.pathTape;
    if (tape.gameId !== gameId || tape.startsAt !== input.startsAt || !Number.isFinite(clock(tape.capturedAt)) || clock(tape.capturedAt) > at) reject("path", "moneyline", "path_fixture_or_cutoff_mismatch");
    else for (const stream of tape.streams) {
      const book = family(stream.book), b = bucket(book, stream.market, pro(book) ? "professional" : "consumer");
      b.truncated ||= stream.truncatedBefore != null || stream.flowTruncatedBefore != null;
      b.interrupted ||= stream.quarantined || stream.quarantinedSourceTimes.length > 0;
      const expanded = expandCbbMarketBehaviorPathStream(tape, stream);
      expanded.quotes.forEach(q => addQuote(q, false));
      for (const f of expanded.flows) rawPressure.push({ gameId, market: f.market, sourceBook: f.sourceBook, physicalFamily: family(f.sourceBook), sourceClass: pro(book) ? "professional_adjacent_named_book" : "retail_named_book", provider: "owls", sourceEventId: f.sourceEventId ?? null,
        line: f.line, firstMoney: f.firstMoney, secondMoney: f.secondMoney, firstTickets: f.firstTickets, secondTickets: f.secondTickets, observedAt: f.observedAt,
        availableBy: f.canonicalReceipt?.availableBy ?? f.fetchedAt, receiptEarliest: f.fetchedAt, clockBasis: f.canonicalReceipt ? "db_inserted_upper_bound" : "verified_provider_observation", observationIds: f.canonicalReceipt?.observationIds ?? [] });
    }
  }
  for (const t of input.consumerTruncatedSources ?? []) bucket(family(t.book), t.market, pro(family(t.book)) ? "professional" : "consumer").truncated = true;
  for (const q of input.consumerQuarantinedSources ?? []) if (clock(q.sourceAt) <= at) bucket(family(q.book), q.market, pro(family(q.book)) ? "professional" : "consumer").interrupted = true;
  for (const r of rawPressure) {
    const book = family(r.physicalFamily || r.sourceBook);
    const namedTicketBook = r.sourceClass === "retail_ticket_share" && (CBB_CONTEXTUAL_CONSUMER_BOOKS as readonly string[]).includes(book) && family(r.sourceBook) === book;
    const role: CbbInterpretationRole = r.sourceClass === "professional_adjacent_named_book" && pro(book) ? "professional" : r.sourceClass === "multi_book_consensus" ? "public_context" :
      r.sourceClass === "retail_network" || r.sourceClass === "retail_ticket_share" && !namedTicketBook ? "retail_context" : "consumer";
    const b = bucket(book, r.market, role), available = clock(r.availableBy), native = r.observedAt === null ? null : clock(r.observedAt), earliest = r.receiptEarliest ? Date.parse(r.receiptEarliest) : null;
    if (r.gameId !== gameId || !validMarket(r.market) || !Number.isFinite(available) || available > at || native !== null && (!Number.isFinite(native) || native > available) ||
      earliest !== null && (!Number.isFinite(earliest) || earliest > available) || !validPair(r.firstMoney, r.secondMoney) || !validPair(r.firstTickets, r.secondTickets) ||
      (r.market === "moneyline" ? r.line !== null : r.line !== null && (!Number.isFinite(r.line) || !Number.isInteger(r.line * 2) || r.market === "total" && r.line <= 0))) { reject(book, r.market, "invalid_pressure_identity_contract_composition_or_availability"); continue; }
    b.pressures.push({ nativeAt: r.observedAt, availableBy: r.availableBy, receiptEarliest: r.receiptEarliest ?? null, eventId: r.sourceEventId, provider: r.provider,
      line: r.line, firstMoney: r.firstMoney, secondMoney: r.secondMoney, firstTickets: r.firstTickets, secondTickets: r.secondTickets,
      moneyBalance: composition(r.firstMoney, r.secondMoney), ticketBalance: composition(r.firstTickets, r.secondTickets), sourceClass: r.sourceClass, clockBasis: r.clockBasis,
      composition: "cumulative_share_not_money_flow", observedAgainAt: [], conflict: Boolean(r.sourceConflict) });
  }
  const streams: CbbInterpretedMarketStream[] = [...buckets.values()].map(b => {
    const unknowns = new Set(b.unknowns), byNative = new Map<number, CbbInterpretedQuote[]>();
    for (const q of b.quotes) byNative.set(clock(q.nativeAt), [...(byNative.get(clock(q.nativeAt)) ?? []), q]);
    const conflictTimes = new Set<number>(b.conflictTimes);
    const quotes = [...byNative.entries()].sort((a, c) => a[0] - c[0]).flatMap(([, rows]) => {
      if (new Set(rows.map(economic)).size > 1 || identity(rows) === "conflict") { conflictTimes.add(clock(rows[0].nativeAt)); return rows; }
      const namespaces=new Map<string,CbbInterpretedQuote[]>();for(const q of rows){const key=q.provider??"unknown";namespaces.set(key,[...(namespaces.get(key)??[]),q]);}
      return [...namespaces.values()].map(same=>{same.sort((a,c)=>clock(a.availableBy)-clock(c.availableBy)||(c.receiptEarliest?Date.parse(c.receiptEarliest):-Infinity)-(a.receiptEarliest?Date.parse(a.receiptEarliest):-Infinity)||JSON.stringify(a.rawQuote).localeCompare(JSON.stringify(c.rawQuote)));return{...same[0],isCurrentInput:same.some(q=>q.isCurrentInput),observedAgainAt:[...new Set(same.slice(1).map(q=>q.availableBy))].filter(t=>t!==same[0].availableBy)};});
    });
    const pressures: CbbInterpretedPressure[] = [];
    for (const p of b.pressures.sort((a, c) => clock(a.nativeAt ?? a.availableBy) - clock(c.nativeAt ?? c.availableBy) || clock(a.availableBy) - clock(c.availableBy))) {
      const state = (x: CbbInterpretedPressure) => JSON.stringify([x.nativeAt, x.provider, x.eventId, x.line, x.firstMoney, x.secondMoney, x.firstTickets, x.secondTickets, x.sourceClass]);
      const previous = pressures.find(x => state(x) === state(p));
      if (previous) { if (p.availableBy !== previous.availableBy) previous.observedAgainAt.push(p.availableBy); continue; }
      pressures.push({ ...p, observedAgainAt: [] });
    }
    for (const p of pressures) if (pressures.some(other => other !== p && p.nativeAt !== null && clock(other.nativeAt ?? "") === clock(p.nativeAt) && (identity([p,other])==="conflict"||JSON.stringify([p.line,p.firstMoney,p.secondMoney,p.firstTickets,p.secondTickets])!==JSON.stringify([other.line,other.firstMoney,other.secondMoney,other.firstTickets,other.secondTickets])))) p.conflict = true;
    // A historic ambiguity interrupts a path; it cannot invalidate a separately
    // attested newer current pair. Nor can that newer pair repair the old path.
    let suffixStart = 0;
    for (let j = 0; j < quotes.length; j++) {
      if (conflictTimes.has(clock(quotes[j].nativeAt))) suffixStart = j + 1;
      else if (j > 0 && identity([quotes[j - 1], quotes[j]]) === "conflict") suffixStart = j;
    }
    const lastConflictAt = conflictTimes.size ? Math.max(...conflictTimes) : -Infinity;
    const afterConflict = quotes.findIndex(q => clock(q.nativeAt) > lastConflictAt);
    if (Number.isFinite(lastConflictAt)) suffixStart = Math.max(suffixStart, afterConflict < 0 ? quotes.length : afterConflict);
    const pathQuotes = quotes.slice(suffixStart), lastRetained = quotes.at(-1);
    const frontierConflict = Boolean(lastRetained && lastConflictAt >= clock(lastRetained.nativeAt));
    const continuity: CbbIdentityContinuity = frontierConflict ? "conflict" : identity(pathQuotes);
    const interrupted = b.interrupted || suffixStart > 0;
    if (suffixStart > 0 || frontierConflict) unknowns.add("known_native_quote_identity_or_same_clock_conflict");
    if (interrupted) unknowns.add("retained_history_interrupted_no_episode_bridge");
    if (b.truncated) unknowns.add("retained_start_is_not_proven_opening");
    const readable = continuity !== "conflict" && !b.interrupted;
    const legs = readable ? pathQuotes.slice(1).flatMap((q, j) => economic(q) === economic(pathQuotes[j]) ? [] : [{ before: pathQuotes[j], after: q, ...change(b.market, pathQuotes[j], q) }]) : [];
    const net = readable && pathQuotes.length >= 2 ? change(b.market, pathQuotes[0], pathQuotes.at(-1)!) : null;
    const lastLeg = legs.at(-1), latest = lastLeg ? { lineDelta: lastLeg.lineDelta, logitDelta: lastLeg.logitDelta, direction: lastLeg.direction } : readable && pathQuotes.length >= 2 ? { lineDelta: 0, logitDelta: 0, direction: 0 as const } : null;
    const nonflat = legs.map(l => l.direction).filter((d): d is -1 | 1 => d !== null && d !== 0), reversals = nonflat.filter((d, i) => i > 0 && d !== nonflat[i - 1]).length;
    const pathResolution: CbbInterpretedMarketStream["pathResolution"] = !readable || !net ? "unavailable" : legs.some(l => l.direction === null) ? "ambiguous" : !legs.length ? "held_observed" : reversals >= 2 ? "resumption" : reversals === 1 ? "buyback" : "ongoing";
    const pressureResponses = pressures.map((pressure): CbbInterpretedPressureResponse => {
      const sameState = (a: CbbInterpretedPressure, c: CbbInterpretedPressure) => a.line === c.line && a.sourceClass === c.sourceClass &&
        a.firstMoney === c.firstMoney && a.secondMoney === c.secondMoney && a.firstTickets === c.firstTickets && a.secondTickets === c.secondTickets &&
        identity([a,c]) !== "conflict";
      const frontier = pressures.at(-1), currentPressureMatch = Boolean(frontier && !frontier.conflict && sameState(pressure, frontier));
      const laterChanged = pressures.filter(p => p !== pressure && clock(p.nativeAt ?? p.availableBy) > clock(pressure.nativeAt ?? pressure.availableBy) && (!sameState(pressure, p) || p.conflict));
      const nextChanged = laterChanged[0], laterPressureChanged = laterChanged.length > 0;
      const fail = (reason: string, continuity: CbbIdentityContinuity = "independently_fixture_bound"): CbbInterpretedPressureResponse => ({ pressure, baseline: null, response: null, continuity, direction: null, relation: "unknown", net: null, latest: null, laterReversal: false, hadActualMove: false, currentPressureMatch, responseIsCurrent: false, laterPressureChanged, activeCurrent: false, reason });
      if (!readable || pressure.conflict) return fail("quote_or_pressure_history_conflict", "conflict");
      if (b.role === "public_context" || b.role === "retail_context" || pressure.clockBasis === "capture_upper_bound" || !pressure.nativeAt) return fail("context_capture_cannot_bind_native_book_response");
      const native = clock(pressure.nativeAt), pEarliest = pressure.receiptEarliest ? Date.parse(pressure.receiptEarliest) : clock(pressure.availableBy);
      const baseline = pathQuotes.filter(q => clock(q.nativeAt) <= native && clock(q.availableBy) <= pEarliest && q.line === pressure.line).at(-1);
      if (!baseline) return fail("no_available_own_contract_prepressure_quote");
      // A changed own contract before pressure cannot borrow an older matching line.
      const latestBefore = pathQuotes.filter(q => clock(q.nativeAt) <= native).at(-1);
      if (latestBefore && economic(latestBefore) !== economic(baseline)) return fail("intervening_prepressure_quote_state");
      const later = pathQuotes.filter(q => clock(q.nativeAt) > native && q.receiptEarliest !== null && clock(pressure.availableBy) <= Date.parse(q.receiptEarliest) &&
        (!nextChanged || nextChanged.nativeAt !== null && clock(q.nativeAt) < clock(nextChanged.nativeAt) && clock(q.availableBy) <= clock(nextChanged.receiptEarliest ?? nextChanged.availableBy)));
      if (!later.length) return fail("no_provably_later_native_quote; reread_is_not_response");
      const response = later.at(-1)!, id = identity([...pathQuotes.filter(q=>clock(q.nativeAt)===clock(baseline.nativeAt)),pressure,...later]);
      if (id === "conflict") return fail("known_quote_pressure_native_identity_conflict", id);
      const net = change(b.market, baseline, response), responseLegs = later.map((q, i) => change(b.market, i ? later[i - 1] : baseline, q));
      const latest = [...responseLegs].reverse().find(l => l.lineDelta !== 0 || l.logitDelta !== 0) ?? responseLegs.at(-1)!;
      const compositionDirection = pressure.moneyBalance === null ? null : sign(pressure.moneyBalance);
      const hadActualMove = responseLegs.some(l => l.lineDelta !== 0 || l.logitDelta !== 0);
      const relation = net.direction === null ? "unknown" : net.direction === 0 ? hadActualMove ? "returned_to_baseline" : "held_observed" : !compositionDirection ? "unknown" : net.direction === compositionDirection ? "toward_composition" : "against_composition";
      const current = quotes.at(-1), responseIsCurrent = Boolean(current && clock(current.nativeAt) === clock(response.nativeAt) && economic(current) === economic(response));
      const activeCurrent = currentPressureMatch && responseIsCurrent && current?.isCurrentInput === true && !laterPressureChanged;
      const initial = responseLegs.find(l => l.direction !== 0 && l.direction !== null)?.direction;
      return { pressure, baseline, response, continuity: id, direction: net.direction, relation, net, latest,
        laterReversal: Boolean(initial && responseLegs.some(l => l.direction !== null && l.direction !== 0 && l.direction !== initial)), hadActualMove, currentPressureMatch, responseIsCurrent, laterPressureChanged, activeCurrent, reason: id === "exact_native" ? "observed_own_book_sequence_exact_native; not_bettor_intent" : "observed_own_book_sequence_fixture_bound; opaque_native_continuity_unproved" };
    });
    if (pressures.length) unknowns.add("share_composition_does_not_identify_new_money_volume_or_sharp_bettors");
    if (pressures.some(p => p.nativeAt === null)) unknowns.add("pressure_native_clock_unknown");
    if (legs.some(l => l.direction === null)) unknowns.add("line_and_juice_oppose_without_identified_economic_order");
    const last = quotes.at(-1), lastBefore = quotes.at(-2);
    const currentQuote = !frontierConflict && last?.isCurrentInput ? last : null;
    const baselineCandidates=[...b.baselines].sort((a,c)=>clock(a.nativeAt)-clock(c.nativeAt)||clock(a.availableBy)-clock(c.availableBy));
    const baseline=baselineCandidates[0],baselinePeers=baseline?baselineCandidates.filter(q=>clock(q.nativeAt)===clock(baseline.nativeAt)):[];
    const endpointContinuity=baseline&&currentQuote?identity([...baselinePeers,currentQuote]):"conflict";
    const baselineNet=baseline&&currentQuote&&clock(baseline.nativeAt)<=clock(currentQuote.nativeAt)&&endpointContinuity!=="conflict"&&new Set(baselinePeers.map(economic)).size===1?{baseline,current:currentQuote,change:change(b.market,baseline,currentQuote),continuity:endpointContinuity,spanHours:(Date.parse(currentQuote.nativeAt)-Date.parse(baseline.nativeAt))/3600000,openingProven:baseline.phase==="opening",historyGap:interrupted||b.truncated||!pathQuotes.some(q=>clock(q.nativeAt)===clock(baseline.nativeAt)&&economic(q)===economic(baseline))}:null;
    if(baseline&&currentQuote&&!baselineNet)unknowns.add("baseline_endpoint_identity_or_economics_conflict_net_withheld");
    const latestObservation: CbbInterpretedMarketStream["latestObservation"] = !readable ? "conflict" : last?.observedAgainAt.length ? "fresh_receipt_same_native_state" : !lastBefore ? "single_observation" : economic(last!) === economic(lastBefore) ? "later_native_unchanged_price" : "actual_native_move";
    const sequence: CbbInterpretationSequenceEntry[] = [...quotes.map((q, index) => ({ kind: "quote" as const, index, nativeAt: q.nativeAt, availableBy: q.availableBy })),
      ...pressures.map((p, index) => ({ kind: "pressure" as const, index, nativeAt: p.nativeAt, availableBy: p.availableBy }))];
    const chronology = { nativeSequence: sequence.filter(row => row.nativeAt !== null).sort((a, c) => clock(a.nativeAt!) - clock(c.nativeAt!)),
      availabilitySequence: [...sequence].sort((a, c) => clock(a.availableBy) - clock(c.availableBy)) };
    return { book: b.book, market: b.market, role: b.role, continuity, currentQuote, quotes, legs, chronology, pressures, pressureResponses, net, latest, baselineNet, pathResolution, latestObservation,
      coverage: { firstRetainedAt: quotes[0]?.nativeAt ?? null, lastRetainedAt: last?.nativeAt ?? null, interpretedFromAt: readable ? pathQuotes[0]?.nativeAt ?? null : null, truncated: b.truncated, interrupted, openingProven: quotes[0]?.phase === "opening" && !b.truncated }, unknowns: [...unknowns] };
  }).sort((a, b) => a.book.localeCompare(b.book) || a.market.localeCompare(b.market) || a.role.localeCompare(b.role));
  const crossMarket: CbbCrossMarketInterpretation[] = [];
  for (const book of new Set(streams.filter(s => s.role === "professional" || s.role === "consumer").map(s => s.book))) {
    const ml = streams.find(s => s.book === book && s.market === "moneyline" && ["professional", "consumer"].includes(s.role));
    const sp = streams.find(s => s.book === book && s.market === "spread" && ["professional", "consumer"].includes(s.role));
    const total = streams.find(s => s.book === book && s.market === "total" && ["professional", "consumer"].includes(s.role));
    const mq = ml?.currentQuote ?? undefined, sq = sp?.currentQuote ?? undefined;
    const crossContinuity = identity([mq,sq].filter((q):q is CbbInterpretedQuote=>Boolean(q)));
    const favorite = mq ? sign(mq.logit) : null, handicap = sq?.line ?? null;
    const boundary = handicap === null ? null : -handicap;
    const lower = favorite === 1 ? 0 : boundary, upper = favorite === 1 ? boundary : 0;
    const minimum = lower === null ? 0 : Math.floor(lower) + 1, maximum = upper === null ? -1 : Math.ceil(upper) - 1;
    const middle = crossContinuity !== "conflict" && favorite && boundary !== null && lower !== null && upper !== null && minimum <= maximum && (favorite === 1 ? boundary > 0 : boundary < 0) ? { favorite: favorite === 1 ? "home" as const : "away" as const, homeMarginLowerExclusive: lower, homeMarginUpperExclusive: upper, minimumIntegerHomeMargin: minimum, maximumIntegerHomeMargin: maximum } : null;
    crossMarket.push({ book, continuity: crossContinuity, totalNetDirection: total?.net?.direction ?? null, totalLatestDirection: total?.latest?.direction ?? null, netRelation: crossContinuity === "conflict" ? "ambiguous" : comparable(ml?.net?.direction, sp?.net?.direction), latestRelation: crossContinuity === "conflict" ? "ambiguous" : comparable(ml?.latest?.direction, sp?.latest?.direction), currentMoneylineFavorite: favorite, spreadHomeHandicap: handicap, favoriteWinUnderdogCover: middle, meaning: "movement_disagreement_is_not_outcome_contradiction; middle_is_contract_geometry_not_probability" });
  }
  return { release: CBB_CONTEXTUAL_MARKET_INTERPRETATION_RELEASE, gameId, asOf: input.asOf, streams, crossMarket, rejected,
    caveats: ["No forecast, grade, price-value or bettor-intent consequence is implied by this factual receipt.", "Native observations and receipt availability are distinct; unchanged shares and rereads do not prove new money or a later response.", "Missing or cross-provider opaque identity permits independently attested fixture binding only; conflicting known IDs within one provider namespace never become continuity.", "Current contract middle geometry does not certify joint probabilities or market inefficiency."] };
}
