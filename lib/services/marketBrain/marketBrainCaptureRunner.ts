import type { SupabaseClient } from "@supabase/supabase-js";

import {
  claimDueMarketBrainAttempts,
  claimExpiredMarketBrainAttemptsForReconciliation,
  type MarketBrainClaimedAttempt,
} from "./marketBrainAttemptClaim";
import type {
  MarketBrainCaptureCapabilityRegistry,
  MarketBrainPlannedAttempt,
} from "./marketBrainCapturePlan";
import {
  createMarketBrainEvidenceAttempt,
  persistMarketBrainEvidenceAttempt,
  type AttestedMarketBrainEvidenceAttempt,
  type MarketBrainEvidenceAttempt,
  type MarketBrainEvidenceAttemptAccounting,
  type MarketBrainEvidenceAttemptPayload,
  type MarketBrainEvidenceAttemptReasonCode,
} from "./marketBrainEvidenceAttempt";
import { marketBrainCanonicalJson } from "./marketBrainCanonical";

export const MARKET_BRAIN_CAPTURE_RUNNER_RELEASE =
  "market_brain_capture_runner_2026_10_27_r1_shadow_only_exact_adapter" as const;

export type MarketBrainCaptureRequestScope = "slate" | "event";

export type MarketBrainCaptureExecution = Readonly<{
  outcome: "success_with_rows" | "success_empty" | "partial" | "failed";
  reasonCode: MarketBrainEvidenceAttemptReasonCode | null;
  requestCount: number;
  expectedPages: number | null;
  receivedPages: number;
  responseSha256: string | null;
  rawArchiveSha256: string | null;
  accounting: MarketBrainEvidenceAttemptAccounting;
  details: Readonly<Record<string, unknown>>;
}>;

export type MarketBrainCaptureAdapter = Readonly<{
  product: MarketBrainClaimedAttempt["product"];
  qualificationScopeKeys: readonly string[];
  provider: string;
  feed: string;
  phase: MarketBrainClaimedAttempt["phase"];
  adapterRelease: string;
  parserRelease: string;
  requestScope: MarketBrainCaptureRequestScope;
  execute(args: Readonly<{
    claim: MarketBrainClaimedAttempt;
    signal: AbortSignal;
  }>): Promise<MarketBrainCaptureExecution>;
}>;

export class MarketBrainCaptureAdapterError extends Error {
  readonly reasonCode: Extract<MarketBrainEvidenceAttemptReasonCode,
    "provider_failure" | "authentication_failure" | "rate_limited" | "timeout" |
    "malformed_response" | "parser_failure" | "storage_failure" | "cancelled">;
  readonly requestCount: number;
  readonly expectedPages: number | null;
  readonly receivedPages: number;
  readonly responseSha256: string | null;
  readonly rawArchiveSha256: string | null;
  readonly publicDetails: Readonly<Record<string, unknown>>;

  constructor(args: Readonly<{
    reasonCode: MarketBrainCaptureAdapterError["reasonCode"];
    message: string;
    requestCount?: number;
    expectedPages?: number | null;
    receivedPages?: number;
    responseSha256?: string | null;
    rawArchiveSha256?: string | null;
    publicDetails?: Readonly<Record<string, unknown>>;
  }>) {
    super(args.message);
    this.name = "MarketBrainCaptureAdapterError";
    this.reasonCode = args.reasonCode;
    this.requestCount = args.requestCount ?? 1;
    this.expectedPages = args.expectedPages ?? null;
    this.receivedPages = args.receivedPages ?? 0;
    this.responseSha256 = args.responseSha256 ?? null;
    this.rawArchiveSha256 = args.rawArchiveSha256 ?? null;
    this.publicDetails = Object.freeze(structuredClone(args.publicDetails ?? {}));
  }
}

export class MarketBrainCaptureAdapterRegistry implements MarketBrainCaptureCapabilityRegistry {
  readonly #adapters: ReadonlyMap<string, MarketBrainCaptureAdapter>;

  constructor(adapters: readonly MarketBrainCaptureAdapter[]) {
    const indexed = new Map<string, MarketBrainCaptureAdapter>();
    for (const adapter of adapters) {
      const key = adapterKey(adapter);
      if (indexed.has(key)) throw new Error(`Duplicate Market Brain capture adapter capability: ${key}`);
      indexed.set(key, Object.freeze({ ...adapter,
        qualificationScopeKeys: Object.freeze([...adapter.qualificationScopeKeys]) }));
    }
    this.#adapters = indexed;
  }

  assertAttemptExecutable(attempt: MarketBrainPlannedAttempt | MarketBrainClaimedAttempt): void {
    this.require(attempt);
  }

  require(attempt: MarketBrainPlannedAttempt | MarketBrainClaimedAttempt): MarketBrainCaptureAdapter {
    const adapter = this.#adapters.get(adapterKey(attempt));
    if (!adapter) {
      throw new Error("No exact Market Brain adapter/parser capability is registered for the planned attempt.");
    }
    if ((adapter.requestScope === "slate" && attempt.eventId !== null) ||
      (adapter.requestScope === "event" && attempt.eventId === null)) {
      throw new Error("Market Brain planned-attempt event identity does not match adapter request scope.");
    }
    return adapter;
  }
}

export type MarketBrainCaptureCycleResult = Readonly<{
  release: typeof MARKET_BRAIN_CAPTURE_RUNNER_RELEASE;
  missedClaimed: number;
  missedPersisted: number;
  dueClaimed: number;
  duePersisted: number;
  adapterUnavailable: number;
  executionFailures: number;
  persistenceFailures: number;
  deferredAfterWindow: number;
  receiptAttemptIds: readonly string[];
}>;

type RunnerDependencies = Readonly<{
  claimDue: typeof claimDueMarketBrainAttempts;
  claimExpired: typeof claimExpiredMarketBrainAttemptsForReconciliation;
  persist(args: Readonly<{
    client: SupabaseClient;
    attempt: MarketBrainEvidenceAttempt;
    claim: MarketBrainClaimedAttempt;
    signal?: AbortSignal;
  }>): Promise<AttestedMarketBrainEvidenceAttempt>;
}>;

const DEFAULT_DEPENDENCIES: RunnerDependencies = Object.freeze({
  claimDue: claimDueMarketBrainAttempts,
  claimExpired: claimExpiredMarketBrainAttemptsForReconciliation,
  persist: persistMarketBrainEvidenceAttempt,
});

const ZERO_ACCOUNTING: MarketBrainEvidenceAttemptAccounting = Object.freeze({
  rawRows: 0, parsedRows: 0, unsupportedRows: 0, malformedRows: 0,
  matchedRows: 0, unmatchedRows: 0, ambiguousRows: 0, retainedRows: 0,
  duplicateRows: 0, filteredRows: 0, writeFailedRows: 0,
});

export async function runMarketBrainCaptureCycle(args: Readonly<{
  client: SupabaseClient;
  adapters: MarketBrainCaptureAdapterRegistry;
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  now?: () => Date;
  dependencies?: RunnerDependencies;
}>): Promise<MarketBrainCaptureCycleResult> {
  const limit = args.limit ?? 25;
  const leaseSeconds = args.leaseSeconds ?? 120;
  const timeoutMs = args.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > (leaseSeconds * 1_000) - 5_000) {
    throw new Error("Market Brain capture timeout must be bounded and finish before claim expiry.");
  }
  const dependencies = args.dependencies ?? DEFAULT_DEPENDENCIES;
  const now = args.now ?? (() => new Date());
  const receiptAttemptIds: string[] = [];
  let missedPersisted = 0;
  let duePersisted = 0;
  let adapterUnavailable = 0;
  let executionFailures = 0;
  let persistenceFailures = 0;
  let deferredAfterWindow = 0;
  let due: readonly MarketBrainClaimedAttempt[] = [];

  const missed = await dependencies.claimExpired({
    client: args.client, workerId: args.workerId, limit, leaseSeconds, signal: args.signal,
  });
  for (const claim of missed) {
    const receipt = createMarketBrainEvidenceAttempt(receiptBase(claim, {
      startedAt: null,
      completedAt: claim.claimedAt,
      outcome: "skipped",
      reasonCode: "missed_window",
      requestCount: 0,
      expectedPages: null,
      receivedPages: 0,
      responseSha256: null,
      rawArchiveSha256: null,
      accounting: ZERO_ACCOUNTING,
      details: { runnerRelease: MARKET_BRAIN_CAPTURE_RUNNER_RELEASE },
    }));
    try {
      await dependencies.persist({ client: args.client, attempt: receipt, claim, signal: args.signal });
      missedPersisted += 1;
      receiptAttemptIds.push(claim.attemptId);
    } catch {
      persistenceFailures += 1;
    }
  }

  if (args.signal?.aborted) return result();
  due = await dependencies.claimDue({
    client: args.client, workerId: args.workerId, limit: 1, leaseSeconds, signal: args.signal,
  });
  if (due.length > 1) {
    throw new Error("Market Brain due-claim contract returned more than one paid request obligation.");
  }
  for (const claim of due) {
    if (args.signal?.aborted) break;
    let adapter: MarketBrainCaptureAdapter;
    try {
      adapter = args.adapters.require(claim);
    } catch {
      adapterUnavailable += 1;
      const receipt = createMarketBrainEvidenceAttempt(receiptBase(claim, {
        startedAt: null,
        completedAt: claim.claimedAt,
        outcome: "skipped",
        reasonCode: "adapter_unavailable",
        requestCount: 0,
        expectedPages: null,
        receivedPages: 0,
        responseSha256: null,
        rawArchiveSha256: null,
        accounting: ZERO_ACCOUNTING,
        details: { runnerRelease: MARKET_BRAIN_CAPTURE_RUNNER_RELEASE },
      }));
      try {
        await dependencies.persist({ client: args.client, attempt: receipt, claim, signal: args.signal });
        duePersisted += 1;
        receiptAttemptIds.push(claim.attemptId);
      } catch {
        persistenceFailures += 1;
      }
      continue;
    }

    const startedAt = maxTimestamp(claim.claimedAt, now().toISOString());
    if (Date.parse(startedAt) > Date.parse(claim.windowClosesAt)) {
      deferredAfterWindow += 1;
      continue;
    }
    const execution = await executeBounded(adapter, claim, timeoutMs, args.signal);
    if (execution.outcome === "failed") executionFailures += 1;
    const completedAt = maxTimestamp(startedAt, now().toISOString());
    let receipt: MarketBrainEvidenceAttempt;
    try {
      receipt = createMarketBrainEvidenceAttempt(receiptBase(claim, {
        ...execution,
        startedAt,
        completedAt,
        details: { ...execution.details, runnerRelease: MARKET_BRAIN_CAPTURE_RUNNER_RELEASE },
      }));
    } catch {
      executionFailures += execution.outcome === "failed" ? 0 : 1;
      receipt = createMarketBrainEvidenceAttempt(receiptBase(claim, {
        startedAt,
        completedAt,
        outcome: "failed",
        reasonCode: "parser_failure",
        requestCount: Math.max(1, Number.isInteger(execution.requestCount) ? execution.requestCount : 1),
        expectedPages: null,
        receivedPages: 0,
        responseSha256: null,
        rawArchiveSha256: null,
        accounting: ZERO_ACCOUNTING,
        details: {
          runnerRelease: MARKET_BRAIN_CAPTURE_RUNNER_RELEASE,
          invalidAdapterResult: true,
        },
      }));
    }
    try {
      await dependencies.persist({ client: args.client, attempt: receipt, claim, signal: args.signal });
      duePersisted += 1;
      receiptAttemptIds.push(claim.attemptId);
    } catch {
      persistenceFailures += 1;
    }
  }

  return result();

  function result(): MarketBrainCaptureCycleResult {
    return Object.freeze({
      release: MARKET_BRAIN_CAPTURE_RUNNER_RELEASE,
      missedClaimed: missed.length,
      missedPersisted,
      dueClaimed: due.length,
      duePersisted,
      adapterUnavailable,
      executionFailures,
      persistenceFailures,
      deferredAfterWindow,
      receiptAttemptIds: Object.freeze([...receiptAttemptIds]),
    });
  }
}

async function executeBounded(
  adapter: MarketBrainCaptureAdapter,
  claim: MarketBrainClaimedAttempt,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<MarketBrainCaptureExecution> {
  const controller = new AbortController();
  const cancel = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", cancel, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort(new Error("Market Brain capture adapter timed out."));
        reject(new MarketBrainCaptureAdapterError({ reasonCode: "timeout", message: "capture timeout" }));
      }, timeoutMs);
    });
    return await Promise.race([adapter.execute({ claim, signal: controller.signal }), timeoutPromise]);
  } catch (error) {
    const normalized = normalizeAdapterError(error, parentSignal?.aborted === true);
    return {
      outcome: "failed",
      reasonCode: normalized.reasonCode,
      requestCount: normalized.requestCount,
      expectedPages: normalized.expectedPages,
      receivedPages: normalized.receivedPages,
      responseSha256: normalized.responseSha256,
      rawArchiveSha256: normalized.rawArchiveSha256,
      accounting: ZERO_ACCOUNTING,
      details: { failureClass: normalized.name, ...normalized.publicDetails },
    };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", cancel);
  }
}

function normalizeAdapterError(error: unknown, cancelled: boolean): MarketBrainCaptureAdapterError {
  if (error instanceof MarketBrainCaptureAdapterError) return error;
  return new MarketBrainCaptureAdapterError({
    reasonCode: cancelled ? "cancelled" : "provider_failure",
    message: "Market Brain capture adapter failed.",
    publicDetails: { thrownType: error instanceof Error ? error.name : typeof error },
  });
}

function receiptBase(
  claim: MarketBrainClaimedAttempt,
  execution: Pick<MarketBrainEvidenceAttemptPayload,
    "startedAt" | "completedAt" | "outcome" | "reasonCode" | "requestCount" |
    "expectedPages" | "receivedPages" | "responseSha256" | "rawArchiveSha256" |
    "accounting" | "details">,
): Parameters<typeof createMarketBrainEvidenceAttempt>[0] {
  return {
    attemptId: claim.attemptId,
    product: claim.product,
    qualificationScopeKeys: claim.qualificationScopeKeys,
    provider: claim.provider,
    feed: claim.feed,
    adapterRelease: claim.adapterRelease,
    parserRelease: claim.parserRelease,
    participant: claim.participant,
    eventId: claim.eventId,
    phase: claim.phase,
    plannedAt: claim.plannedAt,
    windowOpensAt: claim.windowOpensAt,
    windowClosesAt: claim.windowClosesAt,
    ...execution,
  };
}

function adapterKey(value: Pick<MarketBrainCaptureAdapter,
  "product" | "qualificationScopeKeys" | "provider" | "feed" | "phase" |
  "adapterRelease" | "parserRelease">): string {
  return marketBrainCanonicalJson({
    product: value.product,
    qualificationScopeKeys: value.qualificationScopeKeys,
    provider: value.provider,
    feed: value.feed,
    phase: value.phase,
    adapterRelease: value.adapterRelease,
    parserRelease: value.parserRelease,
  });
}

function maxTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
