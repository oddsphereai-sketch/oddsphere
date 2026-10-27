import type { SupabaseClient } from "@supabase/supabase-js";

import { marketBrainCanonicalJson, marketBrainSha256 } from "./marketBrainCanonical";
import {
  MARKET_BRAIN_EVIDENCE_ROSTERS,
  type MarketBrainFeedPhase,
} from "./marketBrainEvidenceRoster";
import {
  MARKET_BRAIN_PRODUCT_REGISTRY,
  type MarketBrainActiveProductKey,
} from "./marketBrainProductRegistry";

export const MARKET_BRAIN_EVIDENCE_ATTEMPT_RELEASE =
  "market_brain_evidence_attempt_2026_10_27_r2_joint_scope_ledger" as const;

export const MARKET_BRAIN_EVIDENCE_ATTEMPT_OUTCOMES = [
  "success_with_rows",
  "success_empty",
  "partial",
  "failed",
  "skipped",
] as const;

export const MARKET_BRAIN_EVIDENCE_ATTEMPT_REASON_CODES = [
  "provider_returned_empty",
  "pagination_incomplete",
  "parser_partial",
  "identity_incomplete",
  "storage_partial",
  "provider_failure",
  "authentication_failure",
  "rate_limited",
  "timeout",
  "malformed_response",
  "parser_failure",
  "storage_failure",
  "cancelled",
  "not_due",
  "cadence_suppressed",
  "budget_suppressed",
  "capture_disabled",
  "no_active_events",
] as const;

export type MarketBrainEvidenceAttemptOutcome = typeof MARKET_BRAIN_EVIDENCE_ATTEMPT_OUTCOMES[number];
export type MarketBrainEvidenceAttemptReasonCode = typeof MARKET_BRAIN_EVIDENCE_ATTEMPT_REASON_CODES[number];

export type MarketBrainEvidenceAttemptAccounting = Readonly<{
  rawRows: number;
  parsedRows: number;
  unsupportedRows: number;
  malformedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  ambiguousRows: number;
  retainedRows: number;
  duplicateRows: number;
  filteredRows: number;
  writeFailedRows: number;
}>;

export type MarketBrainEvidenceAttemptPayload = Readonly<{
  attemptId: string;
  product: MarketBrainActiveProductKey;
  qualificationScopeKeys: readonly string[];
  provider: string;
  feed: string;
  participant: string | null;
  eventId: string | null;
  phase: MarketBrainFeedPhase;
  plannedAt: string;
  windowOpensAt: string;
  windowClosesAt: string;
  startedAt: string | null;
  completedAt: string;
  outcome: MarketBrainEvidenceAttemptOutcome;
  reasonCode: MarketBrainEvidenceAttemptReasonCode | null;
  requestCount: number;
  expectedPages: number | null;
  receivedPages: number;
  responseSha256: string | null;
  rawArchiveSha256: string | null;
  parserRelease: string | null;
  accounting: MarketBrainEvidenceAttemptAccounting;
  details: Readonly<Record<string, unknown>>;
}>;

export type MarketBrainEvidenceIdentity = Pick<MarketBrainEvidenceAttemptPayload,
  "product" | "qualificationScopeKeys" | "provider" | "feed" | "participant" | "phase">;

export type MarketBrainEvidenceAttempt = MarketBrainEvidenceAttemptPayload & Readonly<{
  release: typeof MARKET_BRAIN_EVIDENCE_ATTEMPT_RELEASE;
  checksum: string;
}>;

export type AttestedMarketBrainEvidenceAttempt = MarketBrainEvidenceAttempt & Readonly<{
  persistenceAttestation: Readonly<{
    serverCreatedAt: string;
    checksum: string;
  }>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const PARTIAL_REASONS = new Set<MarketBrainEvidenceAttemptReasonCode>([
  "pagination_incomplete", "parser_partial", "identity_incomplete", "storage_partial",
]);
const FAILURE_REASONS = new Set<MarketBrainEvidenceAttemptReasonCode>([
  "provider_failure", "authentication_failure", "rate_limited", "timeout",
  "malformed_response", "parser_failure", "storage_failure", "cancelled",
]);
const SKIPPED_REASONS = new Set<MarketBrainEvidenceAttemptReasonCode>([
  "not_due", "cadence_suppressed", "budget_suppressed", "capture_disabled", "no_active_events",
]);

export function createMarketBrainEvidenceAttempt(
  payload: MarketBrainEvidenceAttemptPayload,
): MarketBrainEvidenceAttempt {
  assertPayload(payload);
  const normalized = deepFreeze(structuredClone(payload));
  const attempt: MarketBrainEvidenceAttempt = Object.freeze({
    release: MARKET_BRAIN_EVIDENCE_ATTEMPT_RELEASE,
    ...normalized,
    checksum: marketBrainSha256({ release: MARKET_BRAIN_EVIDENCE_ATTEMPT_RELEASE, ...normalized }),
  });
  assertMarketBrainEvidenceAttempt(attempt);
  return attempt;
}

export function assertMarketBrainEvidenceAttempt(
  attempt: MarketBrainEvidenceAttempt,
): void {
  const { checksum, ...payload } = attempt;
  if (attempt.release !== MARKET_BRAIN_EVIDENCE_ATTEMPT_RELEASE ||
    checksum !== marketBrainSha256(payload)) {
    throw new Error("Market Brain evidence attempt release or checksum is invalid.");
  }
  const { release: _release, ...withoutRelease } = payload;
  assertPayload(withoutRelease);
}

export async function persistMarketBrainEvidenceAttempt(args: {
  client: SupabaseClient;
  attempt: MarketBrainEvidenceAttempt;
  signal?: AbortSignal;
}): Promise<AttestedMarketBrainEvidenceAttempt> {
  assertMarketBrainEvidenceAttempt(args.attempt);
  let insert = args.client.from("market_brain_evidence_attempts").insert(toRow(args.attempt))
    .select("attempt_payload,attempt_payload_text,checksum_payload_text,attempt_checksum,server_created_at");
  if (args.signal) insert = insert.abortSignal(args.signal);
  const inserted = await insert.maybeSingle();
  if (!inserted.error && inserted.data) return attest(inserted.data, args.attempt);

  let existingQuery = args.client.from("market_brain_evidence_attempts")
    .select("attempt_payload,attempt_payload_text,checksum_payload_text,attempt_checksum,server_created_at")
    .eq("release", args.attempt.release).eq("attempt_id", args.attempt.attemptId);
  if (args.signal) existingQuery = existingQuery.abortSignal(args.signal);
  const existing = await existingQuery.maybeSingle();
  if (existing.error || !existing.data) {
    throw new Error(`Market Brain evidence-attempt persistence failed: ${inserted.error?.message ?? existing.error?.message ?? "no row returned"}`);
  }
  return attest(existing.data, args.attempt);
}

function assertPayload(payload: MarketBrainEvidenceAttemptPayload): void {
  assertMarketBrainEvidenceIdentity(payload);
  const roster = MARKET_BRAIN_EVIDENCE_ROSTERS[payload.product];
  const feed = roster.feeds.find((row) => row.provider === payload.provider && row.feed === payload.feed &&
    row.phases.includes(payload.phase) && (row.participant === null || row.participant === payload.participant))!;
  if (!UUID.test(payload.attemptId) || !isTimestamp(payload.plannedAt) || !isTimestamp(payload.windowOpensAt) ||
    !isTimestamp(payload.windowClosesAt) || !isTimestamp(payload.completedAt) ||
    Date.parse(payload.windowOpensAt) > Date.parse(payload.plannedAt) ||
    Date.parse(payload.plannedAt) > Date.parse(payload.windowClosesAt) ||
    Date.parse(payload.completedAt) < Date.parse(payload.plannedAt) ||
    (payload.startedAt !== null && (!isTimestamp(payload.startedAt) ||
      Date.parse(payload.startedAt) < Date.parse(payload.windowOpensAt) ||
      Date.parse(payload.startedAt) > Date.parse(payload.completedAt)))) {
    throw new Error("Market Brain evidence attempt chronology is invalid.");
  }
  if (!Number.isInteger(payload.requestCount) || payload.requestCount < 0 ||
    !Number.isInteger(payload.receivedPages) || payload.receivedPages < 0 ||
    (payload.expectedPages !== null && (!Number.isInteger(payload.expectedPages) || payload.expectedPages < 0)) ||
    (payload.expectedPages !== null && payload.receivedPages > payload.expectedPages)) {
    throw new Error("Market Brain evidence attempt request/page accounting is invalid.");
  }
  assertOutcome(payload);
  assertAccounting(payload.accounting);
  if ((payload.responseSha256 !== null && !SHA256.test(payload.responseSha256)) ||
    (payload.rawArchiveSha256 !== null && !SHA256.test(payload.rawArchiveSha256)) ||
    (payload.accounting.rawRows > 0 && (!payload.parserRelease ||
      (feed.replayMode === "raw_replayable" && payload.rawArchiveSha256 === null))) ||
    (payload.requestCount > 0 && ["success_with_rows", "success_empty", "partial"].includes(payload.outcome) &&
      payload.responseSha256 === null)) {
    throw new Error("Market Brain evidence attempt provenance is incomplete.");
  }
}

export function assertMarketBrainEvidenceIdentity(payload: MarketBrainEvidenceIdentity): void {
  const registration = MARKET_BRAIN_PRODUCT_REGISTRY[payload.product];
  const roster = MARKET_BRAIN_EVIDENCE_ROSTERS[payload.product];
  const feed = roster?.feeds.find((row) => row.provider === payload.provider && row.feed === payload.feed &&
    row.phases.includes(payload.phase) && (row.participant === null || row.participant === payload.participant));
  const participantRoster = roster?.participantRosters.find((row) => row.provider === payload.provider);
  const requestedScopeSet = new Set(payload.qualificationScopeKeys);
  const canonicalScopeKeys = registration?.qualificationScopeKeys.filter((scope) => requestedScopeSet.has(scope));
  const participantAllowed = payload.participant === null || feed?.participant === payload.participant ||
    participantRoster?.mode === "provider_catalog" ||
    participantRoster?.namedParticipants.some((row) => row.participant === payload.participant);
  if (!registration || !roster || payload.qualificationScopeKeys.length < 1 ||
    requestedScopeSet.size !== payload.qualificationScopeKeys.length ||
    JSON.stringify(canonicalScopeKeys) !== JSON.stringify(payload.qualificationScopeKeys) ||
    !feed || !participantAllowed || participantRoster?.excludedParticipants.includes(payload.participant ?? "")) {
    throw new Error("Market Brain evidence attempt is outside its frozen product/feed/participant contract.");
  }
}

function assertOutcome(payload: MarketBrainEvidenceAttemptPayload): void {
  const reason = payload.reasonCode;
  const skipped = payload.outcome === "skipped";
  if ((skipped && (payload.startedAt !== null || payload.requestCount !== 0 || reason === null || !SKIPPED_REASONS.has(reason))) ||
    (!skipped && (payload.startedAt === null || payload.requestCount < 1)) ||
    (payload.outcome === "success_with_rows" && (reason !== null || payload.accounting.rawRows < 1)) ||
    (payload.outcome === "success_empty" && (reason !== "provider_returned_empty" || payload.accounting.rawRows !== 0)) ||
    (payload.outcome === "partial" && (reason === null || !PARTIAL_REASONS.has(reason))) ||
    (payload.outcome === "failed" && (reason === null || !FAILURE_REASONS.has(reason)))) {
    throw new Error("Market Brain evidence attempt outcome/reason semantics are invalid.");
  }
}

function assertAccounting(accounting: MarketBrainEvidenceAttemptAccounting): void {
  const values = Object.values(accounting);
  if (values.some((value) => !Number.isInteger(value) || value < 0) ||
    accounting.rawRows !== accounting.parsedRows + accounting.unsupportedRows + accounting.malformedRows ||
    accounting.parsedRows !== accounting.matchedRows + accounting.unmatchedRows + accounting.ambiguousRows ||
    accounting.matchedRows !== accounting.retainedRows + accounting.duplicateRows + accounting.filteredRows + accounting.writeFailedRows) {
    throw new Error("Market Brain evidence attempt has unaccounted source rows.");
  }
}

function isTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function toRow(attempt: MarketBrainEvidenceAttempt): Record<string, unknown> {
  const { checksum: _checksum, ...checksumPayload } = attempt;
  return {
    release: attempt.release, attempt_id: attempt.attemptId, product_key: attempt.product,
    qualification_scope_keys: attempt.qualificationScopeKeys, provider: attempt.provider, feed: attempt.feed,
    participant: attempt.participant, event_id: attempt.eventId, phase: attempt.phase,
    planned_at: attempt.plannedAt, window_opens_at: attempt.windowOpensAt, window_closes_at: attempt.windowClosesAt,
    started_at: attempt.startedAt, completed_at: attempt.completedAt, outcome: attempt.outcome,
    reason_code: attempt.reasonCode, request_count: attempt.requestCount, expected_pages: attempt.expectedPages,
    received_pages: attempt.receivedPages, raw_rows: attempt.accounting.rawRows,
    parsed_rows: attempt.accounting.parsedRows, unsupported_rows: attempt.accounting.unsupportedRows,
    malformed_rows: attempt.accounting.malformedRows, matched_rows: attempt.accounting.matchedRows,
    unmatched_rows: attempt.accounting.unmatchedRows, ambiguous_rows: attempt.accounting.ambiguousRows,
    retained_rows: attempt.accounting.retainedRows, duplicate_rows: attempt.accounting.duplicateRows,
    filtered_rows: attempt.accounting.filteredRows, write_failed_rows: attempt.accounting.writeFailedRows,
    response_sha256: attempt.responseSha256, raw_archive_sha256: attempt.rawArchiveSha256,
    parser_release: attempt.parserRelease, attempt_checksum: attempt.checksum,
    attempt_payload: attempt, attempt_payload_text: marketBrainCanonicalJson(attempt),
    checksum_payload_text: marketBrainCanonicalJson(checksumPayload),
  };
}

function attest(row: Record<string, unknown>, expected: MarketBrainEvidenceAttempt): AttestedMarketBrainEvidenceAttempt {
  const stored = row.attempt_payload as MarketBrainEvidenceAttempt;
  const { checksum: _checksum, ...checksumPayload } = expected;
  if (row.attempt_checksum !== expected.checksum || row.attempt_payload_text !== marketBrainCanonicalJson(expected) ||
    row.checksum_payload_text !== marketBrainCanonicalJson(checksumPayload) ||
    marketBrainCanonicalJson(stored) !== marketBrainCanonicalJson(expected) || !isTimestamp(String(row.server_created_at))) {
    throw new Error("Stored Market Brain evidence attempt differs from its immutable requested payload.");
  }
  return deepFreeze({ ...structuredClone(stored), persistenceAttestation: Object.freeze({
    serverCreatedAt: String(row.server_created_at), checksum: String(row.attempt_checksum),
  }) });
}
