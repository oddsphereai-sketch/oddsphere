import { createHash } from "node:crypto";
import type { NhlBookPathReceipt } from "./nhlMarketEpisodeArbiter";

export const NHL_LEGACY_READER_RECEIPT_RELEASE = "nhl_reader_receipt_2026_11_04_r2_identity_bound_market_evidence" as const;
export const NHL_READER_RECEIPT_RELEASE =
  "nhl_reader_receipt_2026_11_04_r3_exact_price_professional_best" as const;
export const NHL_READER_RECEIPT_SCHEMA_VERSION = 2 as const;
export const NHL_READER_RECEIPT_MAX_BYTES = 64 * 1024;

export type NhlReaderMarket = "moneyline" | "total" | "spread";
export type NhlReaderSide = "home" | "away" | "over" | "under";
export type NhlReaderVerdict = "best_angle" | "lean" | "watchlist" | "pass";
export type NhlReaderPathState = "stable" | "buyback" | "reversal" | "flat" | "unavailable";
export type NhlReaderInterpretation = "confirmation" | "resistance" | "discovery" | "disagreement" | "unresolved" | "unavailable";

export type NhlReaderEvidenceClock = {
  sourceObservedAt: string | null;
  receivedAt: string;
  capturedAt: string;
};

export type NhlReaderQuoteStop = {
  sportsbook: string;
  side: NhlReaderSide;
  line: number | null;
  american: number;
  clock: NhlReaderEvidenceClock;
};

export type NhlReaderSplitReceipt = {
  family: "public_consensus" | "professional_book";
  provider: string;
  sourceBook: string | null;
  selectedSide: NhlReaderSide;
  selectedMoneyPct: number;
  selectedBetsPct: number;
  opposingMoneyPct: number;
  opposingBetsPct: number;
  marketLine: number | null;
  confidence: "high" | "medium" | "low" | "none";
  selectedForPressure: boolean;
  rejectionReason: string | null;
  clock: NhlReaderEvidenceClock;
};

export type NhlReaderConsideredPath = {
  sportsbook: string;
  sourceClass: "named" | "broad";
  state: NhlReaderPathState;
  direction: NhlReaderSide | null;
  selected: boolean;
  rejectionReason: string | null;
  openingCoordinate: number | null;
  currentCoordinate: number | null;
  netMove: number | null;
  latestLeg: number | null;
  clock: NhlReaderEvidenceClock;
};

export type NhlReaderDecisionPoint = {
  awayScore: number;
  homeScore: number;
  pick: string;
  probability: number;
  verdict: NhlReaderVerdict;
};

export type NhlReaderMarketReceipt = {
  /** Exact current author pair; absent on immutable R2 receipts. */
  confirmationQuotePair?: { home: NhlReaderQuoteStop; away: NhlReaderQuoteStop } | null;
  /** Native professional paths retain causal legs and competing sources across older volatility. */
  confirmationSourcePaths?: NhlBookPathReceipt[];
  evaluatedQuote: NhlReaderQuoteStop | null;
  opposingQuote: NhlReaderQuoteStop | null;
  selectedTrail: NhlReaderQuoteStop[];
  opposingTrail: NhlReaderQuoteStop[];
  lineTrail: NhlReaderQuoteStop[];
  splits: {
    publicConsensus: NhlReaderSplitReceipt | null;
    professionalBooks: NhlReaderSplitReceipt[];
  };
  consideredPaths: NhlReaderConsideredPath[];
  interpretation: {
    state: NhlReaderInterpretation;
    side: NhlReaderSide | null;
    pressureBasis: "consensus" | "money_differential" | "consensus_and_money_differential" | null;
    authoritySource: "independent" | "market_episode";
    observedInnovation: number | null;
    appliedInnovation: number;
    selectedMoveAt: string | null;
    reasonCodes: string[];
  };
  before: NhlReaderDecisionPoint;
  after: NhlReaderDecisionPoint;
};

export type NhlReaderReceiptBody = {
  schemaVersion: typeof NHL_READER_RECEIPT_SCHEMA_VERSION;
  release: typeof NHL_READER_RECEIPT_RELEASE | typeof NHL_LEGACY_READER_RECEIPT_RELEASE;
  capturedAt: string;
  cutoffAt: string;
  identity: {
    gameId: number;
    externalId: number;
    slateDate: string;
    gameStartAt: string;
    awayAbbr: string;
    homeAbbr: string;
    lockBoundaryAt: string;
  };
  modelRelease: {
    modelVersion: string;
    calibrationVersion: string;
    decisionVersion: string;
  };
  markets: Record<NhlReaderMarket, NhlReaderMarketReceipt>;
  finalDecision: {
    independentAwayGoals: number;
    independentHomeGoals: number;
    finalAwayGoals: number;
    finalHomeGoals: number;
  };
};

export type NhlReaderReceipt = NhlReaderReceiptBody & {
  receiptHash: string;
};

export type NhlReaderReceiptDecodeResult =
  | { status: "absent"; receipt: null; reason: "legacy_or_unwritten" }
  | { status: "invalid"; receipt: null; reason: string }
  | { status: "valid"; receipt: NhlReaderReceipt; reason: null };

export type NhlReaderReceiptExpectedIdentity = NhlReaderReceiptBody["identity"] & NhlReaderReceiptBody["modelRelease"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalValue(value: unknown, active: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NHL reader receipt cannot encode a non-finite number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (active.has(value)) throw new Error("NHL reader receipt cannot encode a cycle");
    active.add(value);
    const encoded = `[${value.map((entry) => {
      if (entry === undefined) throw new Error("NHL reader receipt cannot encode undefined array entries");
      return canonicalValue(entry, active);
    }).join(",")}]`;
    active.delete(value);
    return encoded;
  }
  if (!isPlainObject(value)) throw new Error("NHL reader receipt accepts only JSON plain objects");
  if (active.has(value)) throw new Error("NHL reader receipt cannot encode a cycle");
  active.add(value);
  const encoded = `{${Object.keys(value).sort().map((key) => {
    const entry = value[key];
    if (entry === undefined) throw new Error(`NHL reader receipt cannot encode undefined field ${key}`);
    return `${JSON.stringify(key)}:${canonicalValue(entry, active)}`;
  }).join(",")}}`;
  active.delete(value);
  return encoded;
}

export function canonicalNhlReaderReceiptJson(value: unknown): string {
  return canonicalValue(value, new Set());
}

export function hashNhlReaderReceiptBody(body: NhlReaderReceiptBody): string {
  return createHash("sha256").update(canonicalNhlReaderReceiptJson(body)).digest("hex");
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFinite(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isSide(value: unknown): value is NhlReaderSide {
  return value === "home" || value === "away" || value === "over" || value === "under";
}

function isVerdict(value: unknown): value is NhlReaderVerdict {
  return value === "best_angle" || value === "lean" || value === "watchlist" || value === "pass";
}

function validClock(value: unknown): value is NhlReaderEvidenceClock {
  if (!isPlainObject(value)) return false;
  return (value.sourceObservedAt === null || isIso(value.sourceObservedAt))
    && isIso(value.receivedAt)
    && isIso(value.capturedAt);
}

function validQuote(value: unknown): value is NhlReaderQuoteStop {
  if (!isPlainObject(value)) return false;
  return typeof value.sportsbook === "string"
    && value.sportsbook.length > 0
    && isSide(value.side)
    && isNullableFinite(value.line)
    && isFiniteNumber(value.american)
    && value.american !== 0
    && validClock(value.clock);
}

function validSplit(value: unknown): value is NhlReaderSplitReceipt {
  if (!isPlainObject(value)) return false;
  const pct = (candidate: unknown) => isFiniteNumber(candidate) && candidate >= 0 && candidate <= 100;
  return (value.family === "public_consensus" || value.family === "professional_book")
    && typeof value.provider === "string"
    && value.provider.length > 0
    && (value.sourceBook === null || typeof value.sourceBook === "string")
    && isSide(value.selectedSide)
    && pct(value.selectedMoneyPct)
    && pct(value.selectedBetsPct)
    && pct(value.opposingMoneyPct)
    && pct(value.opposingBetsPct)
    && isNullableFinite(value.marketLine)
    && (value.confidence === "high" || value.confidence === "medium" || value.confidence === "low" || value.confidence === "none")
    && typeof value.selectedForPressure === "boolean"
    && (value.rejectionReason === null || typeof value.rejectionReason === "string")
    && validClock(value.clock);
}

function validPath(value: unknown): value is NhlReaderConsideredPath {
  if (!isPlainObject(value)) return false;
  return typeof value.sportsbook === "string"
    && value.sportsbook.length > 0
    && (value.sourceClass === "named" || value.sourceClass === "broad")
    && (value.state === "stable" || value.state === "buyback" || value.state === "reversal" || value.state === "flat" || value.state === "unavailable")
    && (value.direction === null || isSide(value.direction))
    && typeof value.selected === "boolean"
    && (value.rejectionReason === null || typeof value.rejectionReason === "string")
    && isNullableFinite(value.openingCoordinate)
    && isNullableFinite(value.currentCoordinate)
    && isNullableFinite(value.netMove)
    && isNullableFinite(value.latestLeg)
    && validClock(value.clock);
}

function validDecisionPoint(value: unknown): value is NhlReaderDecisionPoint {
  if (!isPlainObject(value)) return false;
  return isFiniteNumber(value.awayScore)
    && value.awayScore >= 0
    && isFiniteNumber(value.homeScore)
    && value.homeScore >= 0
    && typeof value.pick === "string"
    && value.pick.length > 0
    && isFiniteNumber(value.probability)
    && value.probability >= 0
    && value.probability <= 1
    && isVerdict(value.verdict);
}

function sideFitsMarket(side: NhlReaderSide, market: NhlReaderMarket): boolean {
  return market === "total" ? side === "over" || side === "under" : side === "home" || side === "away";
}

function validMarket(value: unknown, market: NhlReaderMarket): value is NhlReaderMarketReceipt {
  if (!isPlainObject(value)) return false;
  if (value.confirmationSourcePaths != null) {
    if (!Array.isArray(value.confirmationSourcePaths)) return false;
    for (const path of value.confirmationSourcePaths) {
    if (!isPlainObject(path) || path.market !== "moneyline" || typeof path.sportsbook !== "string"
      || typeof path.sportsbookFamily !== "string" || typeof path.contractKey !== "string"
      || typeof path.complete !== "boolean" || (path.sourceClass !== "named" && path.sourceClass !== "broad")
      || !["stable", "flat", "buyback", "reversal", "incomplete", "unavailable"].includes(String(path.state))
      || !isFiniteNumber(path.openingValue) || !isFiniteNumber(path.currentValue)
      || !isIso(path.openingObservedAt) || !isIso(path.currentObservedAt)
      || (path.firstMaterialMoveAt !== null && !isIso(path.firstMaterialMoveAt))
      || !Array.isArray(path.observations) || !path.observations.every(point => isPlainObject(point)
        && isIso(point.at) && isFiniteNumber(point.value))) return false;
    }
  }
  if (value.confirmationQuotePair != null && (!isPlainObject(value.confirmationQuotePair)
    || !validQuote(value.confirmationQuotePair.home) || !validQuote(value.confirmationQuotePair.away))) return false;
  if (value.evaluatedQuote !== null && !validQuote(value.evaluatedQuote)) return false;
  if (value.opposingQuote !== null && !validQuote(value.opposingQuote)) return false;
  if (!Array.isArray(value.selectedTrail) || !value.selectedTrail.every(validQuote)) return false;
  if (!Array.isArray(value.opposingTrail) || !value.opposingTrail.every(validQuote)) return false;
  if (!Array.isArray(value.lineTrail) || !value.lineTrail.every(validQuote)) return false;
  const quotes = [
    value.evaluatedQuote,
    value.opposingQuote,
    ...value.selectedTrail,
    ...value.opposingTrail,
    ...value.lineTrail,
  ].filter((quote): quote is NhlReaderQuoteStop => quote !== null);
  if (!quotes.every((quote) => sideFitsMarket(quote.side, market))) return false;
  if (!isPlainObject(value.splits)) return false;
  if (value.splits.publicConsensus !== null && !validSplit(value.splits.publicConsensus)) return false;
  if (!Array.isArray(value.splits.professionalBooks) || !value.splits.professionalBooks.every(validSplit)) return false;
  if (value.splits.publicConsensus !== null && value.splits.publicConsensus.family !== "public_consensus") return false;
  if (value.splits.professionalBooks.some((split) => split.family !== "professional_book")) return false;
  const splitRows = [
    value.splits.publicConsensus,
    ...value.splits.professionalBooks,
  ].filter((split): split is NhlReaderSplitReceipt => split !== null);
  if (!splitRows.every((split) => sideFitsMarket(split.selectedSide, market))) return false;
  if (!Array.isArray(value.consideredPaths) || !value.consideredPaths.every(validPath)) return false;
  if (!value.consideredPaths.every((path) => path.direction === null || sideFitsMarket(path.direction, market))) return false;
  if (!isPlainObject(value.interpretation)) return false;
  const interpretation = value.interpretation;
  if (!(interpretation.state === "confirmation" || interpretation.state === "resistance" || interpretation.state === "discovery" || interpretation.state === "disagreement" || interpretation.state === "unresolved" || interpretation.state === "unavailable")) return false;
  if (interpretation.side !== null && !isSide(interpretation.side)) return false;
  if (!(interpretation.pressureBasis === null || interpretation.pressureBasis === "consensus" || interpretation.pressureBasis === "money_differential" || interpretation.pressureBasis === "consensus_and_money_differential")) return false;
  if (!(interpretation.authoritySource === "independent" || interpretation.authoritySource === "market_episode")) return false;
  if (!isNullableFinite(interpretation.observedInnovation) || !isFiniteNumber(interpretation.appliedInnovation)) return false;
  if (!(interpretation.selectedMoveAt === null || isIso(interpretation.selectedMoveAt))) return false;
  if (!Array.isArray(interpretation.reasonCodes) || !interpretation.reasonCodes.every((reason) => typeof reason === "string" && reason.length > 0)) return false;
  return validDecisionPoint(value.before) && validDecisionPoint(value.after);
}

export function validateNhlReaderReceiptBody(value: unknown): value is NhlReaderReceiptBody {
  if (!isPlainObject(value)) return false;
  if (value.schemaVersion !== NHL_READER_RECEIPT_SCHEMA_VERSION || value.release !== NHL_READER_RECEIPT_RELEASE && value.release !== NHL_LEGACY_READER_RECEIPT_RELEASE) return false;
  if (!isIso(value.capturedAt) || !isIso(value.cutoffAt) || !isPlainObject(value.markets)) return false;
  if (!isPlainObject(value.identity)
    || !Number.isInteger(value.identity.gameId)
    || !Number.isInteger(value.identity.externalId)
    || typeof value.identity.slateDate !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.identity.slateDate)
    || !isIso(value.identity.gameStartAt)
    || typeof value.identity.awayAbbr !== "string"
    || typeof value.identity.homeAbbr !== "string"
    || !isIso(value.identity.lockBoundaryAt)) return false;
  if (!isPlainObject(value.modelRelease)
    || typeof value.modelRelease.modelVersion !== "string"
    || typeof value.modelRelease.calibrationVersion !== "string"
    || typeof value.modelRelease.decisionVersion !== "string"
    || !value.modelRelease.modelVersion || !value.modelRelease.calibrationVersion || !value.modelRelease.decisionVersion) return false;
  if (!validMarket(value.markets.moneyline, "moneyline")
    || !validMarket(value.markets.total, "total")
    || !validMarket(value.markets.spread, "spread")) return false;
  if (!isPlainObject(value.finalDecision)) return false;
  return isFiniteNumber(value.finalDecision.independentAwayGoals)
    && isFiniteNumber(value.finalDecision.independentHomeGoals)
    && isFiniteNumber(value.finalDecision.finalAwayGoals)
    && isFiniteNumber(value.finalDecision.finalHomeGoals);
}

function bodyFromReceipt(receipt: NhlReaderReceipt): NhlReaderReceiptBody {
  const { receiptHash: _receiptHash, ...body } = receipt;
  return body;
}

export function buildNhlReaderReceipt(body: NhlReaderReceiptBody): NhlReaderReceipt {
  if (!validateNhlReaderReceiptBody(body)) throw new Error("Invalid NHL reader receipt body");
  const bytes = Buffer.byteLength(canonicalNhlReaderReceiptJson(body), "utf8");
  if (bytes > NHL_READER_RECEIPT_MAX_BYTES) {
    throw new Error(`NHL reader receipt exceeds ${NHL_READER_RECEIPT_MAX_BYTES} bytes (${bytes})`);
  }
  return { ...body, receiptHash: hashNhlReaderReceiptBody(body) };
}

export function decodeNhlReaderReceipt(
  value: unknown,
  expected?: NhlReaderReceiptExpectedIdentity,
): NhlReaderReceiptDecodeResult {
  if (value === null || value === undefined) {
    return { status: "absent", receipt: null, reason: "legacy_or_unwritten" };
  }
  if (!isPlainObject(value) || typeof value.receiptHash !== "string") {
    return { status: "invalid", receipt: null, reason: "invalid_envelope" };
  }
  const receipt = value as NhlReaderReceipt;
  const body = bodyFromReceipt(receipt);
  if (!validateNhlReaderReceiptBody(body)) {
    return { status: "invalid", receipt: null, reason: "invalid_body" };
  }
  let canonical: string;
  try {
    canonical = canonicalNhlReaderReceiptJson(body);
  } catch (error) {
    return { status: "invalid", receipt: null, reason: error instanceof Error ? error.message : "canonicalization_failed" };
  }
  if (Buffer.byteLength(canonical, "utf8") > NHL_READER_RECEIPT_MAX_BYTES) {
    return { status: "invalid", receipt: null, reason: "size_limit_exceeded" };
  }
  const expectedHash = createHash("sha256").update(canonical).digest("hex");
  if (expectedHash !== receipt.receiptHash) {
    return { status: "invalid", receipt: null, reason: "hash_mismatch" };
  }
  if (expected) {
    const identity = receipt.identity;
    const release = receipt.modelRelease;
    if (identity.gameId !== expected.gameId
      || identity.externalId !== expected.externalId
      || identity.slateDate !== expected.slateDate
      || identity.gameStartAt !== expected.gameStartAt
      || identity.awayAbbr !== expected.awayAbbr
      || identity.homeAbbr !== expected.homeAbbr
      || identity.lockBoundaryAt !== expected.lockBoundaryAt) {
      return { status: "invalid", receipt: null, reason: "identity_mismatch" };
    }
    if (release.modelVersion !== expected.modelVersion
      || release.calibrationVersion !== expected.calibrationVersion
      || release.decisionVersion !== expected.decisionVersion) {
      return { status: "invalid", receipt: null, reason: "release_mismatch" };
    }
  }
  return { status: "valid", receipt, reason: null };
}

