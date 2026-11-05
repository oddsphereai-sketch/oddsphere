import { cbbImpliedProbability } from "./marketEvidence";
import { cbbAvailabilityUpperBoundMs, cbbEvidenceReceiptBounds } from "./marketReceiptTime";
import { cbbPathBookFamily, cbbSameNativePressureState, expandCbbMarketBehaviorPathStream,
  type CbbMarketBehaviorPathTape } from "./marketBehaviorPath";
import type { CbbDecisionSplitContext } from "./decisionSplitContext";
import type { CbbPressureDecision } from "./sourcePressureDecision";
import type { CbbCanonicalReceipt, CbbMarket, CbbQuote, CbbUncertainty } from "./types";

/** Offline research schema. No production reader/writer imports this module.
 * Columns describe observations, not source weights or forecast components.
 * Selected picks/payout EV, published forecasts, grades and episode score
 * deltas are not inputs. A two-sided consumer observation may also be the
 * execution book; its scope is explicit and supplies no independent action
 * corroboration. Market ranges are descriptive coordinates, not forecasts. */
export const CBB_CONTEXTUAL_FEATURE_SCHEMA = "cbb_contextual_features_v3" as const;
export type CbbContextualQuote = CbbQuote & { orientationVerified?: boolean;
  /** Only a retained native quote-fixture identity, never borrowed from splits. */
  sourceEventId?: string };
/** General consumer price observations are not professional action receipts.
 * A legacy snapshot may prove only an availability upper bound; never invent
 * HTTP completion from capturedAt. Scope records how the pair was retained,
 * not which side the previous engine picked or what its execution EV was. */
export type CbbContextualConsumerQuote = Pick<CbbQuote, "gameId" | "sportsbook" | "market" | "line" | "firstPrice" | "secondPrice" | "providerObservedAt"> & {
  availableBy: string;
  availabilityKind: "http_response" | "db_inserted_upper_bound" | "stored_snapshot_upper_bound";
  orientationProof: "stored_labeled_pair" | "named_fixture_attested" | "native_home_away_fields" | "canonical_named_fixture_join";
  provider?: CbbQuote["provider"]; fetchedAt?: string; requestedAt?: string; receivedAt?: string;
  canonicalReceipt?: CbbCanonicalReceipt; sourceEventId?: string; providerEventId?: string;
  observationScope?: "retained_market_pair" | "selected_execution_pair";
};
export type CbbContextualFeatureInput = {
  independent: { gameId: number; asOf: string; release: string; inputStatus: "complete" | "incomplete";
    margin: number; total: number; homeWinProbability?: number; uncertainty?: Partial<CbbUncertainty> | null };
  asOf: string;
  startsAt: string;
  currentQuotes: readonly CbbContextualQuote[];
  historyQuotes?: readonly CbbContextualQuote[];
  /** Earliest qualified price endpoint only; never a synthetic history leg. */
  sourceBaselineQuotes?: readonly ((CbbContextualQuote | CbbContextualConsumerQuote) & { knownBy: string })[];
  consumerCurrentQuotes?: readonly CbbContextualConsumerQuote[];
  consumerHistoryQuotes?: readonly CbbContextualConsumerQuote[];
  consumerQuarantinedSources?: readonly { book: string; market: CbbMarket; sourceAt: string; reason: string }[];
  consumerTruncatedSources?: readonly { book: string; market: CbbMarket }[];
  pathTape?: CbbMarketBehaviorPathTape | null;
  splitContext?: readonly CbbDecisionSplitContext[];
  pressureDecisions?: readonly CbbPressureDecision[];
};
type Column = { name: string; mirrorParity: 1 | -1; linear: boolean };
type Issue = { source: string; code: string };
export type CbbContextualFeatureAudit = { unsupported: Issue[]; missing: string[] };
const BOOKS = ["circa", "pinnacle", "bookmaker"] as const;
/** Actual retained retail journal roster plus the observed BDL Fanatics book.
 * This is an identity dictionary, never a vote, ranking or source weight. */
export const CBB_CONTEXTUAL_CONSUMER_BOOKS = Object.freeze(["draftkings", "fanduel", "betmgm", "fanatics", "bovada",
  "hardrock", "betr", "stations", "south_point", "wynn"] as const);
const consumerAliases: Readonly<Record<string, string>> = { draft_kings: "draftkings", fan_duel: "fanduel", bet_mgm: "betmgm",
  hard_rock: "hardrock", hard_rock_bet: "hardrock", hardrockbet: "hardrock", "hard rock": "hardrock", southpoint: "south_point", "south point": "south_point" };
export const cbbContextualConsumerBook = (book: string) => consumerAliases[book.trim().toLowerCase()] ?? book.trim().toLowerCase();
const MARKETS: readonly CbbMarket[] = ["moneyline", "spread", "total"];
const CONTEXTS = ["retail_draftkings", "retail_betmgm", "retail_fanduel", "public_network", "public_consensus"] as const;
const SIDE = new Set(["logit", "line", "first_logit", "first_line", "net_logit", "net_line", "leg_logit", "leg_line",
  "own_line", "money_balance", "ticket_balance", "money_ticket_gap", "baseline_logit", "baseline_line",
  "response_logit", "response_line", "response_net_logit", "response_net_line", "line_center", "logit_center"]);
const CURRENT = ["present", "conflict", "logit", "line_present", "line", "overround"];
const CLOCKS = ["native_age_hours", "available_age_hours", "receipt_delay_hours"];
const HISTORY = ["present", "conflict", "truncated", "quote_count", "span_hours", "first_logit", "first_line",
  "net_logit", "net_line", "leg_present", "leg_logit", "leg_line", "leg_age_hours", "changes_count",
  "logit_total_variation", "line_total_variation", "logit_reversals", "line_reversals"];
const CONSUMER_SCOPE = ["retained_pair_scope", "selected_execution_scope", "scope_unknown"];
// As in the professional columns, receipt_delay_hours is elapsed native-to-
// available-bound time, not an invented HTTP duration. Completion is separate.
const CONSUMER_CLOCKS = [...CLOCKS, "receipt_completion_present", "receipt_completion_age_hours", "availability_upper_bound_only"];
const CONSUMER_RANGE = ["present", "book_count", "line_present", "line_count", "same_line_max_book_count", "same_line_logit_width",
  "logit_center", "logit_width", "line_center", "line_width", ...CONSUMER_SCOPE];
const SPLITS = ["present", "conflict", "native_clock_present", "capture_clock_only", "own_line_present", "own_line",
  "money_present", "money_balance", "money_sum", "tickets_present", "ticket_balance", "ticket_sum", "money_ticket_gap",
  "native_age_hours", "available_age_hours"];
const RESPONSE = ["bound", "historical_bound", "conflict", "current_match_economics", "current_native_gap_hours",
  "current_available_gap_hours", "current_identity_proven", "current_continuity_unknown",
  "baseline_logit", "baseline_line", "response_logit", "response_line",
  "response_net_logit", "response_net_line", "baseline_age_hours", "response_age_hours", "pressure_age_hours",
  "pressure_available_age_hours", "baseline_to_pressure_hours", "pressure_to_response_hours",
  "pressure_available_to_response_receipt_hours", "retained_repeat", "latest_observation_age_hours",
  "latest_available_age_hours"];
const independentColumns: Column[] = [
  { name: "independent.margin", mirrorParity: -1, linear: true },
  { name: "independent.total", mirrorParity: 1, linear: true },
  { name: "independent.win_probability_present", mirrorParity: 1, linear: true },
  { name: "independent.win_logit", mirrorParity: -1, linear: true },
  ...["margin_sd", "total_sd", "margin_total_correlation"].flatMap(name => [
    { name: `independent.${name}_present`, mirrorParity: 1 as const, linear: true },
    { name: `independent.${name}`, mirrorParity: (name === "margin_total_correlation" ? -1 : 1) as 1 | -1, linear: true }]),
  ...["r3", "r4", "other"].map(name => ({ name: `independent.release_${name}`, mirrorParity: 1 as const, linear: true })),
  { name: "independent.age_hours", mirrorParity: 1, linear: false },
  { name: "fixture.hours_to_start", mirrorParity: 1, linear: false },
];
const columns: Column[] = [...independentColumns];
for (const book of BOOKS) for (const market of MARKETS) {
  for (const [section, fields, linear] of [["current", CURRENT, true], ["clock", CLOCKS, false],
    ["history", HISTORY, false], ["pressure", SPLITS, false], ["response", RESPONSE, false]] as const) {
    for (const field of fields) columns.push({ name: `${book}.${market}.${section}.${field}`,
      mirrorParity: market !== "total" && SIDE.has(field) ? -1 : 1, linear });
  }
}
for (const context of CONTEXTS) for (const market of MARKETS) for (const field of SPLITS) {
  columns.push({ name: `${context}.${market}.${field}`, mirrorParity: market !== "total" && SIDE.has(field) ? -1 : 1, linear: false });
}
for (const book of CBB_CONTEXTUAL_CONSUMER_BOOKS) for (const market of MARKETS) {
  for (const [section, fields, linear] of [["current", [...CURRENT, ...CONSUMER_SCOPE], true], ["clock", CONSUMER_CLOCKS, false],
    ["history", [...HISTORY, ...CONSUMER_SCOPE], false]] as const) {
    for (const field of fields) columns.push({ name: `consumer_${book}.${market}.${section}.${field}`,
      mirrorParity: market !== "total" && SIDE.has(field) ? -1 : 1, linear });
  }
}
for (const market of MARKETS) for (const field of CONSUMER_RANGE) columns.push({
  name: `consumer_market_range.${market}.current.${field}`, mirrorParity: market !== "total" && SIDE.has(field) ? -1 : 1, linear: true,
});
export const CBB_CONTEXTUAL_FEATURE_NAMES: readonly string[] = Object.freeze(columns.map(c => c.name));
/** +1: unchanged by exchanging home/away; -1: negate. Total Over/Under is not exchanged. */
export const CBB_CONTEXTUAL_FEATURE_MIRROR_PARITY: readonly (1 | -1)[] = Object.freeze(columns.map(c => c.mirrorParity));
/** Native paths, shares, response timing and all ages are context-only. */
export const CBB_CONTEXTUAL_LINEAR_FEATURE_MASK: readonly boolean[] = Object.freeze(columns.map(c => c.linear));
export const CBB_CONTEXTUAL_LINEAR_FEATURE_INDICES: readonly number[] = Object.freeze(columns.flatMap((c, i) => c.linear ? [i] : []));
const index = new Map(columns.map((c, i) => [c.name, i]));
type PriceQuote = Pick<CbbQuote, "gameId" | "sportsbook" | "market" | "line" | "firstPrice" | "secondPrice" | "providerObservedAt"> & {
  canonicalReceipt?: CbbCanonicalReceipt; sourceEventId?: string };
const tuple = (q: PriceQuote) => JSON.stringify([q.line, q.firstPrice, q.secondPrice]);
const native = (q: PriceQuote) => Date.parse(q.providerObservedAt);
const event = (q: Pick<PriceQuote, "canonicalReceipt" | "sourceEventId">) => q.canonicalReceipt?.providerEventId ?? q.sourceEventId ?? null;
/** Preserve the part Date.parse truncates while accepting equivalent ISO offsets. */
const instant = (value: string) => `${Date.parse(value)}:${(value.match(/\.\d{3}(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1] ?? "").replace(/0+$/, "")}`;
const sameInstant = (a: string, b: string) => Number.isFinite(Date.parse(a)) && Number.isFinite(Date.parse(b)) && instant(a) === instant(b);
const quoteProof = (q: CbbContextualQuote) => JSON.stringify([q.gameId, cbbPathBookFamily(q.sportsbook), q.market,
  q.provider, tuple(q), instant(q.providerObservedAt), instant(q.fetchedAt), event(q), q.canonicalReceipt ? [q.canonicalReceipt.kind,
    instant(q.canonicalReceipt.availableBy), q.canonicalReceipt.ingestionRunId, q.canonicalReceipt.observationIds,
    q.canonicalReceipt.rawPayloadHashes] : null]);
const logit = (q: PriceQuote) => Math.log(cbbImpliedProbability(q.firstPrice) / cbbImpliedProbability(q.secondPrice));
const line = (q: PriceQuote) => q.line ?? 0;
const HOURS = 3_600_000;
const sourceKey = (book: string, market: CbbMarket) => `${cbbPathBookFamily(book)}.${market}`;

function contextKey(row: CbbDecisionSplitContext): string | null {
  if (row.sourceClass === "multi_book_consensus") return "public_consensus";
  if (row.sourceClass === "retail_network") return "public_network";
  const book = cbbPathBookFamily(row.physicalFamily);
  return ["retail_named_book", "retail_ticket_share"].includes(row.sourceClass) && ["draftkings", "betmgm", "fanduel"].includes(book) ? `retail_${book}` : null;
}

/** Missing numeric values are zero ONLY with explicit masks. No imputation of
 * a missing quote/shape/history as neutral evidence; inspect audit alongside values. */
export function buildCbbContextualFeatures(input: CbbContextualFeatureInput): {
  values: number[]; audit: CbbContextualFeatureAudit;
} {
  const f = input.independent, at = Date.parse(input.asOf), start = Date.parse(input.startsAt), forecastAt = Date.parse(f.asOf);
  if (f.inputStatus !== "complete" || !Number.isSafeInteger(f.gameId) || f.gameId <= 0 || !f.release ||
    ![at, start, forecastAt, f.margin, f.total].every(Number.isFinite) || forecastAt > at || at >= start || f.total <= Math.abs(f.margin)) {
    throw new Error("Contextual features require a complete, available pregame independent point forecast");
  }
  const values = columns.map(() => 0), audit: CbbContextualFeatureAudit = { unsupported: [], missing: [] };
  const issue = (source: string, code: string) => { if (!audit.unsupported.some(x => x.source === source && x.code === code)) audit.unsupported.push({ source, code }); };
  const put = (name: string, value: number) => {
    const i = index.get(name);
    if (i === undefined || !Number.isFinite(value)) throw new Error(`Invalid contextual feature ${name}`);
    values[i] = Object.is(value, -0) ? 0 : value;
  };
  const missing = (name: string) => { if (!audit.missing.includes(name)) audit.missing.push(name); };
  put("independent.margin", f.margin); put("independent.total", f.total);
  if (f.homeWinProbability !== undefined && Number.isFinite(f.homeWinProbability) && f.homeWinProbability > 0 && f.homeWinProbability < 1) {
    put("independent.win_probability_present", 1); put("independent.win_logit", Math.log(f.homeWinProbability / (1 - f.homeWinProbability)));
  } else missing("independent.win_probability");
  for (const [name, value, valid] of [["margin_sd", f.uncertainty?.marginSd, (n: number) => n > 0],
    ["total_sd", f.uncertainty?.totalSd, (n: number) => n > 0],
    ["margin_total_correlation", f.uncertainty?.marginTotalCorrelation, (n: number) => Math.abs(n) < 1]] as const) {
    if (value !== undefined && Number.isFinite(value) && valid(value)) { put(`independent.${name}_present`, 1); put(`independent.${name}`, value); }
    else missing(`independent.${name}`);
  }
  const release = /_r3_/.test(f.release) ? "r3" : /_r4_/.test(f.release) ? "r4" : "other";
  put(`independent.release_${release}`, 1); put("independent.age_hours", (at - forecastAt) / HOURS); put("fixture.hours_to_start", (start - at) / HOURS);

  const quoteValid = (q: CbbContextualQuote, key: string) => {
    const bounds = cbbEvidenceReceiptBounds(q), time = native(q);
    if (q.gameId !== f.gameId || q.orientationVerified !== true || q.phase !== "current") { issue(key, "quote_identity_orientation_or_phase_unattested"); return false; }
    if (q.sourceEventId !== undefined && (!q.sourceEventId || q.canonicalReceipt && q.sourceEventId !== q.canonicalReceipt.providerEventId)) {
      issue(key, "quote_native_event_identity_conflict"); return false;
    }
    if (![time, bounds.earliest, bounds.available].every(Number.isFinite) || time > bounds.available || bounds.available > at ||
      (q.requestedAt !== undefined && (!Number.isFinite(Date.parse(q.requestedAt)) || Date.parse(q.requestedAt) > bounds.earliest))) {
      issue(key, "quote_clock_or_availability_invalid"); return false;
    }
    if (!Number.isFinite(q.firstPrice) || !Number.isFinite(q.secondPrice) || Math.abs(q.firstPrice) < 100 || Math.abs(q.secondPrice) < 100 ||
      (q.market === "moneyline" ? q.line !== null : q.line === null || !Number.isFinite(q.line) || !Number.isInteger(q.line * 2))) {
      issue(key, "quote_contract_or_prices_invalid"); return false;
    }
    return true;
  };
  let history: CbbContextualQuote[] = [...(input.historyQuotes ?? [])];
  const splitRows: CbbDecisionSplitContext[] = [];
  const flatten = (rows: readonly CbbDecisionSplitContext[]) => {
    for (const row of rows) { splitRows.push(row); if (row.sourceHistory) flatten(row.sourceHistory); }
  };
  flatten(input.splitContext ?? []);
  const truncated = new Set<string>(), quarantined = new Set<string>();
  const quarantineTimes = new Map<string, string[]>();
  if (input.pathTape) {
    const tape = input.pathTape;
    if (tape.gameId !== f.gameId || tape.startsAt !== input.startsAt || !Number.isFinite(Date.parse(tape.capturedAt)) || Date.parse(tape.capturedAt) > at) issue("path", "tape_identity_or_availability_invalid");
    else for (const stream of tape.streams) {
      const key = sourceKey(stream.book, stream.market);
      if (stream.truncatedBefore !== null) truncated.add(key);
      if (stream.quarantined || stream.quarantinedSourceTimes.length > 0) quarantined.add(key);
      quarantineTimes.set(key, [...(quarantineTimes.get(key) ?? []), ...stream.quarantinedSourceTimes.filter(time =>
        Number.isFinite(Date.parse(time)) && Date.parse(time) <= at)]);
      const expanded = expandCbbMarketBehaviorPathStream(tape, stream);
      history.push(...expanded.quotes);
      splitRows.push(...expanded.flows.map(flow => ({ gameId: flow.gameId, market: flow.market, sourceBook: flow.sourceBook,
        physicalFamily: cbbPathBookFamily(flow.sourceBook), sourceClass: "professional_adjacent_named_book" as const,
        provider: "owls" as const, sourceEventId: flow.sourceEventId ?? null, line: flow.line,
        firstMoney: flow.firstMoney, secondMoney: flow.secondMoney, firstTickets: flow.firstTickets, secondTickets: flow.secondTickets,
        observedAt: flow.observedAt, availableBy: flow.canonicalReceipt?.availableBy ?? flow.fetchedAt,
        receiptEarliest: flow.fetchedAt, clockBasis: flow.canonicalReceipt ? "db_inserted_upper_bound" as const : "verified_provider_observation" as const,
        observationIds: flow.canonicalReceipt?.observationIds ?? [] })));
    }
  }
  history = [...history, ...input.currentQuotes];
  for (const q of [...input.currentQuotes, ...history]) if (!BOOKS.includes(cbbPathBookFamily(q.sportsbook) as typeof BOOKS[number])) issue(q.sportsbook, "nonprofessional_quote_not_a_prediction_level");

  const currentByKey = new Map<string, CbbContextualQuote>();
  function readPriceFeatures<Q extends PriceQuote>(key: string, rawCurrent: readonly Q[], priceHistory: readonly Q[],
    eligibleQuote: (quote: Q) => boolean, bounds: (quote: Q) => { available: number; earliest: number }, consumer = false): Q | undefined {
    const scope = (section: "current" | "history", rows: readonly Q[]) => {
      const source = rows as readonly (Q & { observationScope?: CbbContextualConsumerQuote["observationScope"] })[];
      put(`${key}.${section}.retained_pair_scope`, Number(source.some(q => q.observationScope === "retained_market_pair")));
      put(`${key}.${section}.selected_execution_scope`, Number(source.some(q => q.observationScope === "selected_execution_pair")));
      put(`${key}.${section}.scope_unknown`, Number(source.some(q => !["retained_market_pair", "selected_execution_pair"].includes(q.observationScope ?? ""))));
    };
    const valid = rawCurrent.filter(eligibleQuote);
    const currentTime = Math.max(...valid.map(native));
    const frontier = valid.filter(q => native(q) === currentTime);
    const conflicts = (rows: Q[]) => new Set(rows.map(tuple)).size > 1 || new Set(rows.map(event).filter(x => x !== null)).size > 1;
    const malformedFrontier = rawCurrent.some(q => q.gameId === f.gameId && native(q) >= currentTime && native(q) <= at &&
      bounds(q).available <= at && !valid.includes(q));
    const newerHistory = frontier.length > 0 && priceHistory.some(q => native(q) > currentTime && eligibleQuote(q));
    // An older path ambiguity says the sequence cannot be bridged. It does
    // not contradict an independently attested later current price pair.
    const currentQuarantined = frontier.some(q => (quarantineTimes.get(key) ?? []).some(time => Date.parse(time) >= native(q)));
    const conflict = currentQuarantined || conflicts(frontier) || malformedFrontier || newerHistory;
    put(`${key}.current.conflict`, Number(conflict));
    put(`${key}.history.conflict`, Number(quarantined.has(key)));
    put(`${key}.history.truncated`, Number(truncated.has(key)));
    if (conflict) issue(key, "current_physical_frontier_conflict");
    const current = !conflict ? [...frontier].sort((a, b) => bounds(a).available - bounds(b).available)[0] : undefined;
    if (!current) { missing(`${key}.current`); return undefined; }
    put(`${key}.current.present`, 1); put(`${key}.current.logit`, logit(current));
    put(`${key}.current.line_present`, Number(current.line !== null)); put(`${key}.current.line`, line(current));
    put(`${key}.current.overround`, cbbImpliedProbability(current.firstPrice) + cbbImpliedProbability(current.secondPrice) - 1);
    const receipt = bounds(current);
    put(`${key}.clock.native_age_hours`, (at - native(current)) / HOURS);
    put(`${key}.clock.available_age_hours`, (at - receipt.available) / HOURS);
    put(`${key}.clock.receipt_delay_hours`, (receipt.available - native(current)) / HOURS);
    if (consumer) scope("current", frontier);
    const eligible = priceHistory.filter(q => eligibleQuote(q) && native(q) <= currentTime);
    if (consumer) scope("history", eligible);
    const times = new Map<number, Q[]>();
    for (const q of eligible) times.set(native(q), [...(times.get(native(q)) ?? []), q]);
    const historyConflict = quarantined.has(key) || [...times.values()].some(conflicts) || new Set(eligible.map(event).filter(x => x !== null)).size > 1;
    put(`${key}.history.conflict`, Number(historyConflict)); put(`${key}.history.truncated`, Number(truncated.has(key)));
    if (historyConflict) { issue(key, "history_ambiguity_no_bridge"); return current; }
    const ordered = [...times.entries()].sort((a, b) => a[0] - b[0]).map(([, quotes]) => [...quotes].sort((a, b) => bounds(a).available - bounds(b).available)[0]);
    put(`${key}.history.quote_count`, ordered.length);
    if (ordered.length < 2) { missing(`${key}.history`); return current; }
    const first = ordered[0];
    put(`${key}.history.present`, 1); put(`${key}.history.span_hours`, (native(current) - native(first)) / HOURS);
    put(`${key}.history.first_logit`, logit(first)); put(`${key}.history.first_line`, line(first));
    put(`${key}.history.net_logit`, logit(current) - logit(first)); put(`${key}.history.net_line`, line(current) - line(first));
    const legs = ordered.slice(1).flatMap((after, i) => tuple(after) === tuple(ordered[i]) ? [] : [{ before: ordered[i], after }]);
    put(`${key}.history.changes_count`, legs.length);
    const latest = legs.at(-1);
    if (latest) {
      put(`${key}.history.leg_present`, 1); put(`${key}.history.leg_logit`, logit(latest.after) - logit(latest.before));
      put(`${key}.history.leg_line`, line(latest.after) - line(latest.before)); put(`${key}.history.leg_age_hours`, (at - native(latest.after)) / HOURS);
    }
    for (const [field, read] of [["logit", logit], ["line", line]] as const) {
      const deltas = legs.map(leg => read(leg.after) - read(leg.before)).filter(d => d !== 0);
      put(`${key}.history.${field}_total_variation`, deltas.reduce((sum, d) => sum + Math.abs(d), 0));
      put(`${key}.history.${field}_reversals`, deltas.slice(1).filter((d, i) => Math.sign(d) !== Math.sign(deltas[i])).length);
    }
    return current;
  }
  for (const book of BOOKS) for (const market of MARKETS) {
    const key = `${book}.${market}`, match = (q: CbbContextualQuote) => cbbPathBookFamily(q.sportsbook) === book && q.market === market;
    const current = readPriceFeatures(key, input.currentQuotes.filter(match), history.filter(match), q => quoteValid(q, key), cbbEvidenceReceiptBounds);
    if (current) currentByKey.set(key, current);
  }

  const consumerBounds = (q: CbbContextualConsumerQuote) => q.availabilityKind === "db_inserted_upper_bound" && q.fetchedAt !== undefined
    ? cbbEvidenceReceiptBounds({ fetchedAt: q.fetchedAt, canonicalReceipt: q.canonicalReceipt })
    : { available: cbbAvailabilityUpperBoundMs(q.availableBy), earliest: q.fetchedAt === undefined ? NaN : Date.parse(q.fetchedAt) };
  const consumerValid = (q: CbbContextualConsumerQuote, key: string) => {
    const receipt = consumerBounds(q), available = cbbAvailabilityUpperBoundMs(q.availableBy), observed = native(q);
    const orientation = ["stored_labeled_pair", "named_fixture_attested", "native_home_away_fields", "canonical_named_fixture_join"].includes(q.orientationProof);
    if (q.gameId !== f.gameId || !orientation) { issue(key, "consumer_identity_or_orientation_unattested"); return false; }
    if (!Number.isFinite(q.firstPrice) || !Number.isFinite(q.secondPrice) || Math.abs(q.firstPrice) < 100 || Math.abs(q.secondPrice) < 100 ||
      (q.market === "moneyline" ? q.line !== null : q.line === null || !Number.isFinite(q.line) || !Number.isInteger(q.line * 2))) {
      issue(key, "consumer_contract_or_prices_invalid"); return false;
    }
    const completion = q.receivedAt ?? (q.availabilityKind === "http_response" ? q.fetchedAt : undefined);
    if (![observed, available, receipt.available].every(Number.isFinite) || observed > available || available > at || observed >= start ||
      !["http_response", "db_inserted_upper_bound", "stored_snapshot_upper_bound"].includes(q.availabilityKind) ||
      q.fetchedAt !== undefined && (!Number.isFinite(Date.parse(q.fetchedAt)) || Date.parse(q.fetchedAt) > available) ||
      completion !== undefined && (!Number.isFinite(Date.parse(completion)) || observed > Date.parse(completion) || Date.parse(completion) > available) ||
      completion !== undefined && q.fetchedAt !== undefined && Date.parse(q.fetchedAt) > Date.parse(completion) ||
      q.requestedAt !== undefined && (!Number.isFinite(Date.parse(q.requestedAt)) || Date.parse(q.requestedAt) > (completion === undefined ? available : Date.parse(completion)))) {
      issue(key, "consumer_clock_or_availability_invalid"); return false;
    }
    if (q.availabilityKind === "http_response" && (completion === undefined || !sameInstant(completion, q.availableBy) ||
      q.fetchedAt !== undefined && q.receivedAt !== undefined && !sameInstant(q.fetchedAt, q.receivedAt)) ||
      q.availabilityKind === "db_inserted_upper_bound" && (!q.canonicalReceipt || q.fetchedAt === undefined || !sameInstant(q.availableBy, q.canonicalReceipt.availableBy)) ||
      q.availabilityKind !== "db_inserted_upper_bound" && q.canonicalReceipt !== undefined) {
      issue(key, "consumer_availability_provenance_invalid"); return false;
    }
    if (q.sourceEventId !== undefined && (!q.sourceEventId || q.canonicalReceipt && q.sourceEventId !== q.canonicalReceipt.providerEventId)) {
      issue(key, "consumer_native_event_identity_conflict"); return false;
    }
    if (q.observationScope !== undefined && !["retained_market_pair", "selected_execution_pair"].includes(q.observationScope)) issue(key, "consumer_scope_unrecognized");
    return true;
  };
  const consumerCurrent = input.consumerCurrentQuotes ?? [], consumerHistory = [...(input.consumerHistoryQuotes ?? []), ...consumerCurrent];
  for (const q of [...consumerCurrent, ...consumerHistory]) if (!CBB_CONTEXTUAL_CONSUMER_BOOKS.includes(cbbContextualConsumerBook(q.sportsbook) as typeof CBB_CONTEXTUAL_CONSUMER_BOOKS[number])) {
    issue(q.sportsbook, "consumer_book_not_in_frozen_roster");
  }
  for (const source of input.consumerTruncatedSources ?? []) truncated.add(`consumer_${cbbContextualConsumerBook(source.book)}.${source.market}`);
  for (const source of input.consumerQuarantinedSources ?? []) {
    const key = `consumer_${cbbContextualConsumerBook(source.book)}.${source.market}`;
    if (!Number.isFinite(Date.parse(source.sourceAt)) || Date.parse(source.sourceAt) > at) { issue(key, "consumer_quarantine_clock_unavailable"); continue; }
    quarantined.add(key); quarantineTimes.set(key, [...(quarantineTimes.get(key) ?? []), source.sourceAt]);
  }
  const admittedConsumers = new Map<CbbMarket, CbbContextualConsumerQuote[]>();
  const admittedConsumerScope = new Map<CbbMarket, CbbContextualConsumerQuote[]>();
  for (const book of CBB_CONTEXTUAL_CONSUMER_BOOKS) for (const market of MARKETS) {
    const key = `consumer_${book}.${market}`, match = (q: CbbContextualConsumerQuote) => cbbContextualConsumerBook(q.sportsbook) === book && q.market === market;
    const current = readPriceFeatures(key, consumerCurrent.filter(match), consumerHistory.filter(match), q => consumerValid(q, key), consumerBounds, true);
    if (!current) continue;
    admittedConsumers.set(market, [...(admittedConsumers.get(market) ?? []), current]);
    admittedConsumerScope.set(market, [...(admittedConsumerScope.get(market) ?? []), ...consumerCurrent.filter(q => match(q) &&
      sameInstant(q.providerObservedAt, current.providerObservedAt) && tuple(q) === tuple(current) && consumerValid(q, key))]);
    const completion = current.receivedAt ?? (current.availabilityKind === "http_response" ? current.fetchedAt : undefined);
    put(`${key}.clock.receipt_completion_present`, Number(completion !== undefined));
    put(`${key}.clock.availability_upper_bound_only`, Number(current.availabilityKind !== "http_response"));
    if (completion !== undefined) put(`${key}.clock.receipt_completion_age_hours`, (at - Date.parse(completion)) / HOURS);
    else missing(`${key}.clock.receipt_completion`);
  }
  for (const market of MARKETS) {
    const key = `consumer_market_range.${market}.current`, quotes = admittedConsumers.get(market) ?? [];
    if (!quotes.length) { missing(key); continue; }
    put(`${key}.present`, 1); put(`${key}.book_count`, quotes.length);
    const logits = quotes.map(logit), lines = quotes.flatMap(q => q.line === null ? [] : [q.line]);
    put(`${key}.logit_center`, (Math.min(...logits) + Math.max(...logits)) / 2); put(`${key}.logit_width`, Math.max(...logits) - Math.min(...logits));
    put(`${key}.line_present`, Number(lines.length > 0)); put(`${key}.line_count`, new Set(lines).size);
    if (lines.length) { put(`${key}.line_center`, (Math.min(...lines) + Math.max(...lines)) / 2); put(`${key}.line_width`, Math.max(...lines) - Math.min(...lines)); }
    const byLine = new Map<number | null, CbbContextualConsumerQuote[]>();
    for (const q of quotes) byLine.set(q.line, [...(byLine.get(q.line) ?? []), q]);
    put(`${key}.same_line_max_book_count`, Math.max(...[...byLine.values()].map(rows => rows.length)));
    put(`${key}.same_line_logit_width`, Math.max(...[...byLine.values()].map(rows => {
      const values = rows.map(logit); return Math.max(...values) - Math.min(...values);
    })));
    const scopeQuotes = admittedConsumerScope.get(market) ?? [];
    put(`${key}.retained_pair_scope`, Number(scopeQuotes.some(q => q.observationScope === "retained_market_pair")));
    put(`${key}.selected_execution_scope`, Number(scopeQuotes.some(q => q.observationScope === "selected_execution_pair")));
    put(`${key}.scope_unknown`, Number(scopeQuotes.some(q => !["retained_market_pair", "selected_execution_pair"].includes(q.observationScope ?? ""))));
  }

  const availableSplits = splitRows.filter(row => {
    const key = `${row.sourceBook}.${row.market}`, available = cbbAvailabilityUpperBoundMs(row.availableBy), observed = row.observedAt === null ? null : Date.parse(row.observedAt);
    if (row.gameId !== f.gameId || ![available, ...(observed === null ? [] : [observed])].every(Number.isFinite) || available > at ||
      observed !== null && observed > available || row.receiptEarliest !== undefined && (!Number.isFinite(Date.parse(row.receiptEarliest)) || Date.parse(row.receiptEarliest) > available)) {
      issue(key, "split_identity_or_clock_invalid"); return false;
    }
    if (row.sourceClass === "professional_adjacent_named_book" && cbbPathBookFamily(row.sourceBook) !== cbbPathBookFamily(row.physicalFamily)) {
      issue(key, "split_physical_book_identity_mismatch"); return false;
    }
    return true;
  });
  const splitStates = new Map<string, CbbDecisionSplitContext[]>();
  for (const row of availableSplits) {
    const key = row.sourceClass === "professional_adjacent_named_book" && BOOKS.includes(cbbPathBookFamily(row.physicalFamily) as typeof BOOKS[number])
      ? `${cbbPathBookFamily(row.physicalFamily)}.${row.market}.pressure` : contextKey(row) ? `${contextKey(row)}.${row.market}` : null;
    if (key) splitStates.set(key, [...(splitStates.get(key) ?? []), row]);
    else issue(row.sourceBook, "split_source_role_not_in_schema");
  }
  for (const key of [...BOOKS.flatMap(book => MARKETS.map(market => `${book}.${market}.pressure`)),
    ...CONTEXTS.flatMap(context => MARKETS.map(market => `${context}.${market}`))]) {
    const rows = splitStates.get(key) ?? [];
    const time = (r: CbbDecisionSplitContext) => r.observedAt === null ? cbbAvailabilityUpperBoundMs(r.availableBy) : Date.parse(r.observedAt);
    const latestTime = Math.max(...rows.map(time)), frontier = rows.filter(r => time(r) === latestTime);
    const selected = [...frontier].sort((a, b) => cbbAvailabilityUpperBoundMs(a.availableBy) - cbbAvailabilityUpperBoundMs(b.availableBy))[0];
    if (!selected) { missing(key); continue; }
    const splitIdentity = (r: CbbDecisionSplitContext) => JSON.stringify([cbbPathBookFamily(r.physicalFamily), r.sourceClass,
      r.sourceEventId, r.line, r.firstMoney, r.secondMoney, r.firstTickets, r.secondTickets]);
    const conflict = frontier.some(r => r.sourceConflict || splitIdentity(r) !== splitIdentity(selected));
    put(`${key}.conflict`, Number(conflict));
    if (conflict) { issue(key, "split_frontier_conflict"); continue; }
    put(`${key}.present`, 1); put(`${key}.native_clock_present`, Number(selected.observedAt !== null));
    put(`${key}.capture_clock_only`, Number(selected.clockBasis === "capture_upper_bound"));
    put(`${key}.own_line_present`, Number(selected.line !== null)); put(`${key}.own_line`, selected.line ?? 0);
    put(`${key}.available_age_hours`, (at - cbbAvailabilityUpperBoundMs(selected.availableBy)) / HOURS);
    if (selected.observedAt !== null) put(`${key}.native_age_hours`, (at - Date.parse(selected.observedAt)) / HOURS);
    const pairs = [["money", selected.firstMoney, selected.secondMoney], ["tickets", selected.firstTickets, selected.secondTickets]] as const;
    const balances = new Map<string, number>();
    for (const [kind, first, second] of pairs) {
      if (first === null || second === null || ![first, second].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) { missing(`${key}.${kind}`); continue; }
      const name = kind === "money" ? "money" : "ticket";
      put(`${key}.${kind}_present`, 1); put(`${key}.${name}_balance`, first - second); put(`${key}.${name}_sum`, first + second); balances.set(kind, first - second);
    }
    if (balances.size === 2) put(`${key}.money_ticket_gap`, balances.get("money")! - balances.get("tickets")!);
  }

  for (const book of BOOKS) for (const market of MARKETS) {
    const key = `${book}.${market}`, rows = (input.pressureDecisions ?? []).filter(row => cbbPathBookFamily(row.book) === book && row.market === market && row.sourceClass === "professional_adjacent_named_book");
    if (rows.length > 1) { put(`${key}.response.conflict`, 1); issue(key, "multiple_pressure_frontiers"); continue; }
    const row = rows[0], current = currentByKey.get(key);
    if (!row || !row.baseline || !row.current || row.sourceAt === null || row.reaction === "unbound") { missing(`${key}.response`); continue; }
    const before = row.baseline as CbbContextualQuote, after = row.current as CbbContextualQuote;
    const sourceAt = Date.parse(row.sourceAt), available = cbbAvailabilityUpperBoundMs(row.availableBy), beforeReceipt = cbbEvidenceReceiptBounds(before), afterReceipt = cbbEvidenceReceiptBounds(after);
    const states = splitStates.get(`${key}.pressure`) ?? [];
    const latest = row.latestObservation;
    const original = states.find(s => s.observedAt !== null && sameInstant(s.observedAt, row.sourceAt!) &&
      sameInstant(s.availableBy, row.availableBy) && s.line === row.ownLine && s.sourceEventId !== null && s.sourceEventId.length > 0 &&
      s.clockBasis !== "capture_upper_bound" && (s.clockBasis !== "db_inserted_upper_bound" || s.receiptEarliest !== undefined) &&
      [s.firstMoney, s.secondMoney, s.firstTickets, s.secondTickets].every(n => n !== null && Number.isFinite(n) && n >= 0 && n <= 1));
    const changed = original && states.some(s => s.observedAt !== null && Date.parse(s.observedAt) >= sourceAt &&
      (s.sourceConflict || !cbbSameNativePressureState(s, original)));
    const changedBeforeResponse = original && states.some(s => s.observedAt !== null && Date.parse(s.observedAt) >= sourceAt &&
      Date.parse(s.observedAt) <= native(after) && (s.sourceConflict || !cbbSameNativePressureState(s, original)));
    const proofRows = history.filter(q => cbbPathBookFamily(q.sportsbook) === book && q.market === market && quoteValid(q, key));
    const baselineProved = proofRows.some(q => quoteProof(q) === quoteProof(before));
    const responseProved = proofRows.some(q => quoteProof(q) === quoteProof(after));
    const preflowInterrupted = proofRows.some(q => native(q) >= native(before) && native(q) <= sourceAt &&
      (tuple(q) !== tuple(before) || event(q) !== null && event(before) !== null && event(q) !== event(before)));
    const unknownQuarantineInterval = quarantined.has(key) && !(quarantineTimes.get(key)?.length);
    const responseCrossesAmbiguity = unknownQuarantineInterval || (quarantineTimes.get(key) ?? []).some(time =>
      Date.parse(time) >= native(before) && Date.parse(time) <= native(after));
    const pressureEarliest = original ? Date.parse(original.receiptEarliest ?? original.availableBy) : NaN;
    const historicalValid = Boolean(original) && baselineProved && responseProved && !preflowInterrupted && !changedBeforeResponse && !responseCrossesAmbiguity &&
      quoteValid(before, key) && quoteValid(after, key) && before.gameId === after.gameId &&
      before.provider === original!.provider && after.provider === original!.provider &&
      cbbPathBookFamily(before.sportsbook) === book && cbbPathBookFamily(after.sportsbook) === book && before.market === market && after.market === market &&
      before.line === row.ownLine && [sourceAt, available].every(Number.isFinite) && sourceAt <= available && available <= at &&
      event(before) !== null && event(before) === event(after) && event(after) === original!.sourceEventId &&
      native(before) <= sourceAt && beforeReceipt.available <= pressureEarliest && native(after) > sourceAt && afterReceipt.earliest >= available;
    const latestValid = !latest || latest.sourceAt !== null && Number.isFinite(Date.parse(latest.sourceAt)) && Date.parse(latest.sourceAt) >= sourceAt &&
        Date.parse(latest.sourceAt) <= cbbAvailabilityUpperBoundMs(latest.availableBy) && cbbAvailabilityUpperBoundMs(latest.availableBy) <= at &&
        latest.line === row.ownLine && Boolean(original) && latest.sourceEventId === original!.sourceEventId &&
        states.some(s => s.observedAt !== null && sameInstant(s.observedAt, latest.sourceAt!) && sameInstant(s.availableBy, latest.availableBy) && cbbSameNativePressureState(s, original!));
    if (!historicalValid) {
      put(`${key}.response.conflict`, 1);
      issue(key, !original ? "pressure_original_raw_state_unproved" : !baselineProved || !responseProved ? "pressure_raw_quote_receipt_unproved" :
        event(before) === null || event(after) === null ? "pressure_quote_native_event_unproved" : responseCrossesAmbiguity ? "pressure_response_bridges_history_ambiguity" : "pressure_response_clock_contract_or_continuity_invalid");
      continue;
    }
    // A proved past episode remains data when the latest direct refresh lacks
    // native event identity. It is NOT relabeled as current support. Keep the
    // old clocks, and describe the latest state's proof/gap independently.
    put(`${key}.response.historical_bound`, 1);
    const currentMatches = Boolean(current && tuple(current) === tuple(after));
    const currentIdentity = Boolean(current && proofRows.some(q => q.provider === original!.provider && event(q) === original!.sourceEventId &&
      tuple(q) === tuple(current) && sameInstant(q.providerObservedAt, current.providerObservedAt)));
    const exactCurrent = Boolean(current && currentMatches && currentIdentity && sameInstant(current.providerObservedAt, after.providerObservedAt));
    const knownIdentityConflict = Boolean(current && event(current) !== null && event(current) !== original!.sourceEventId);
    put(`${key}.response.current_match_economics`, Number(currentMatches));
    put(`${key}.response.current_identity_proven`, Number(currentIdentity));
    put(`${key}.response.current_continuity_unknown`, Number(!current || !currentIdentity || !latestValid));
    put(`${key}.response.bound`, Number(exactCurrent && !changed && latestValid));
    put(`${key}.response.conflict`, Number(Boolean(changed) || knownIdentityConflict || Boolean(current && !currentMatches)));
    if (current) {
      put(`${key}.response.current_native_gap_hours`, (native(current) - native(after)) / HOURS);
      put(`${key}.response.current_available_gap_hours`, (cbbEvidenceReceiptBounds(current).available - afterReceipt.available) / HOURS);
    }
    if (!currentIdentity) missing(`${key}.response.current_identity`);
    if (!latestValid) issue(key, "pressure_latest_observation_proof_invalid");
    for (const [prefix, q] of [["baseline", before], ["response", after]] as const) { put(`${key}.response.${prefix}_logit`, logit(q)); put(`${key}.response.${prefix}_line`, line(q)); }
    put(`${key}.response.response_net_logit`, logit(after) - logit(before)); put(`${key}.response.response_net_line`, line(after) - line(before));
    put(`${key}.response.baseline_age_hours`, (at - native(before)) / HOURS); put(`${key}.response.response_age_hours`, (at - native(after)) / HOURS);
    put(`${key}.response.pressure_age_hours`, (at - sourceAt) / HOURS); put(`${key}.response.pressure_available_age_hours`, (at - available) / HOURS);
    put(`${key}.response.baseline_to_pressure_hours`, (sourceAt - native(before)) / HOURS);
    put(`${key}.response.pressure_to_response_hours`, (native(after) - sourceAt) / HOURS);
    put(`${key}.response.pressure_available_to_response_receipt_hours`, (afterReceipt.earliest - available) / HOURS);
    put(`${key}.response.retained_repeat`, Number(Boolean(latest) && latestValid));
    if (latest && latestValid) { put(`${key}.response.latest_observation_age_hours`, (at - Date.parse(latest.sourceAt!)) / HOURS); put(`${key}.response.latest_available_age_hours`, (at - cbbAvailabilityUpperBoundMs(latest.availableBy)) / HOURS); }
  }
  return { values, audit };
}
