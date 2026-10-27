import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MARKET_BRAIN_ATTEMPT_CLAIM_RELEASE,
  type MarketBrainClaimedAttempt,
} from "../lib/services/marketBrain/marketBrainAttemptClaim";
import {
  assertMarketBrainCapturePlanExecutable,
  createMarketBrainCapturePlan,
} from "../lib/services/marketBrain/marketBrainCapturePlan";
import {
  MARKET_BRAIN_CAPTURE_RUNNER_RELEASE,
  MarketBrainCaptureAdapterError,
  MarketBrainCaptureAdapterRegistry,
  runMarketBrainCaptureCycle,
  type MarketBrainCaptureAdapter,
} from "../lib/services/marketBrain/marketBrainCaptureRunner";
import type {
  AttestedMarketBrainEvidenceAttempt,
  MarketBrainEvidenceAttempt,
} from "../lib/services/marketBrain/marketBrainEvidenceAttempt";

const ZERO = Object.freeze({
  rawRows: 0, parsedRows: 0, unsupportedRows: 0, malformedRows: 0,
  matchedRows: 0, unmatchedRows: 0, ambiguousRows: 0, retainedRows: 0,
  duplicateRows: 0, filteredRows: 0, writeFailedRows: 0,
});

function claim(overrides: Partial<MarketBrainClaimedAttempt>): MarketBrainClaimedAttempt {
  return Object.freeze({
    attemptId: "60000000-0000-4000-8000-000000000001",
    product: "nba_daily_edge",
    qualificationScopeKeys: Object.freeze(["moneyline", "spread", "total"]),
    provider: "sharpapi",
    feed: "main_odds",
    adapterRelease: "sharpapi_main_odds_adapter_runner_test_r1",
    parserRelease: "sharpapi_main_odds_parser_runner_test_r1",
    participant: "circa",
    eventId: "nba:runner-proof",
    phase: "current",
    plannedAt: "2026-10-28T16:02:00.000Z",
    windowOpensAt: "2026-10-28T16:00:00.000Z",
    windowClosesAt: "2026-10-28T16:05:00.000Z",
    claimRelease: MARKET_BRAIN_ATTEMPT_CLAIM_RELEASE,
    claimToken: "60000000-0000-4000-8000-000000000011",
    claimMode: "due",
    claimedBy: "market-brain-runner-test",
    claimedAt: "2026-10-28T16:02:30.000Z",
    leaseExpiresAt: "2026-10-28T16:04:30.000Z",
    claimSequence: 1,
    ...overrides,
  });
}

const successfulAdapter: MarketBrainCaptureAdapter = Object.freeze({
  product: "nba_daily_edge",
  qualificationScopeKeys: Object.freeze(["moneyline", "spread", "total"]),
  provider: "sharpapi",
  feed: "main_odds",
  phase: "current",
  adapterRelease: "sharpapi_main_odds_adapter_runner_test_r1",
  parserRelease: "sharpapi_main_odds_parser_runner_test_r1",
  requestScope: "event",
  async execute({ claim: claimed, signal }) {
    assert.equal(claimed.attemptId, "60000000-0000-4000-8000-000000000001");
    assert.equal(signal.aborted, false);
    return {
      outcome: "success_with_rows",
      reasonCode: null,
      requestCount: 1,
      expectedPages: 1,
      receivedPages: 1,
      responseSha256: "a".repeat(64),
      rawArchiveSha256: "b".repeat(64),
      accounting: { ...ZERO, rawRows: 1, parsedRows: 1, matchedRows: 1, retainedRows: 1 },
      details: { httpStatus: 200 },
    };
  },
});

async function main(): Promise<void> {
  const registry = new MarketBrainCaptureAdapterRegistry([successfulAdapter]);
  const executablePlan = createMarketBrainCapturePlan({
    planId: "60000000-0000-4000-8000-000000000021",
    createdAt: "2026-10-28T15:00:00.000Z",
    horizonOpensAt: "2026-10-28T16:00:00.000Z",
    horizonClosesAt: "2026-10-28T17:00:00.000Z",
    attempts: [{
      attemptId: "60000000-0000-4000-8000-000000000001",
      product: "nba_daily_edge",
      qualificationScopeKeys: ["moneyline", "spread", "total"],
      provider: "sharpapi",
      feed: "main_odds",
      adapterRelease: "sharpapi_main_odds_adapter_runner_test_r1",
      parserRelease: "sharpapi_main_odds_parser_runner_test_r1",
      participant: "circa",
      eventId: "nba:runner-proof",
      phase: "current",
      plannedAt: "2026-10-28T16:02:00.000Z",
      windowOpensAt: "2026-10-28T16:00:00.000Z",
      windowClosesAt: "2026-10-28T16:05:00.000Z",
    }],
    details: { fixture: "runner_capability" },
  });
  assert.doesNotThrow(() => assertMarketBrainCapturePlanExecutable(executablePlan, registry));
  const unregisteredPlan = createMarketBrainCapturePlan({
    planId: "60000000-0000-4000-8000-000000000022",
    createdAt: executablePlan.createdAt,
    horizonOpensAt: executablePlan.horizonOpensAt,
    horizonClosesAt: executablePlan.horizonClosesAt,
    attempts: [{ ...executablePlan.attempts[0]!, parserRelease: "unregistered_parser_r2" }],
    details: { fixture: "unregistered_runner_capability" },
  });
  assert.throws(() => assertMarketBrainCapturePlanExecutable(unregisteredPlan, registry), /No exact/,
  "a plan cannot persist against an unregistered parser contract");
  assert.throws(() => registry.assertAttemptExecutable({
    ...executablePlan.attempts[0]!, eventId: null,
  }), /request scope/, "event adapters cannot execute slate-shaped obligations");

  const missed = claim({
    attemptId: "60000000-0000-4000-8000-000000000002",
    provider: "owls",
    feed: "named_book_splits_canonical",
    adapterRelease: "owls_named_book_splits_adapter_runner_test_r1",
    parserRelease: "owls_named_book_splits_parser_runner_test_r1",
    participant: null,
    eventId: null,
    claimToken: "60000000-0000-4000-8000-000000000012",
    claimMode: "missed_window_reconcile",
    claimedAt: "2026-10-28T16:06:00.000Z",
    leaseExpiresAt: "2026-10-28T16:08:00.000Z",
  });
  const unavailable = claim({
    attemptId: "60000000-0000-4000-8000-000000000003",
    provider: "owls",
    feed: "named_book_splits_canonical",
    adapterRelease: "owls_named_book_splits_adapter_runner_test_r1",
    parserRelease: "owls_named_book_splits_parser_runner_test_r1",
    participant: null,
    eventId: null,
    claimToken: "60000000-0000-4000-8000-000000000013",
  });
  const receipts: MarketBrainEvidenceAttempt[] = [];
  const result = await runMarketBrainCaptureCycle({
    client: {} as SupabaseClient,
    adapters: registry,
    workerId: "market-brain-runner-test",
    leaseSeconds: 120,
    timeoutMs: 5_000,
    now: () => new Date("2026-10-28T16:02:31.000Z"),
    dependencies: {
      claimExpired: async () => [missed],
      claimDue: async (claimArgs) => {
        assert.equal(claimArgs.limit, 1, "paid requests must be claimed just in time, one per runner invocation");
        return [claim({})];
      },
      persist: async ({ attempt }) => {
        receipts.push(attempt);
        return { ...attempt, persistenceAttestation: {
          serverCreatedAt: "2026-10-28T16:06:01.000Z", checksum: attempt.checksum,
        } } as AttestedMarketBrainEvidenceAttempt;
      },
    },
  });
  assert.equal(result.release, MARKET_BRAIN_CAPTURE_RUNNER_RELEASE);
  assert.deepEqual({
    missedClaimed: result.missedClaimed,
    missedPersisted: result.missedPersisted,
    dueClaimed: result.dueClaimed,
    duePersisted: result.duePersisted,
    adapterUnavailable: result.adapterUnavailable,
    executionFailures: result.executionFailures,
    persistenceFailures: result.persistenceFailures,
  }, {
    missedClaimed: 1, missedPersisted: 1, dueClaimed: 1, duePersisted: 1,
    adapterUnavailable: 0, executionFailures: 0, persistenceFailures: 0,
  });
  assert.deepEqual(receipts.map((receipt) => [receipt.attemptId, receipt.outcome, receipt.reasonCode]), [
    [missed.attemptId, "skipped", "missed_window"],
    ["60000000-0000-4000-8000-000000000001", "success_with_rows", null],
  ]);
  assert.equal(receipts[1]?.adapterRelease, successfulAdapter.adapterRelease);
  assert.equal(receipts[1]?.parserRelease, successfulAdapter.parserRelease);

  const unavailableResult = await runMarketBrainCaptureCycle({
    client: {} as SupabaseClient,
    adapters: registry,
    workerId: "market-brain-runner-test",
    leaseSeconds: 120,
    timeoutMs: 5_000,
    now: () => new Date("2026-10-28T16:02:31.000Z"),
    dependencies: {
      claimExpired: async () => [],
      claimDue: async () => [unavailable],
      persist: async ({ attempt }) => {
        receipts.push(attempt);
        return { ...attempt, persistenceAttestation: {
          serverCreatedAt: "2026-10-28T16:02:32.000Z", checksum: attempt.checksum,
        } } as AttestedMarketBrainEvidenceAttempt;
      },
    },
  });
  assert.equal(unavailableResult.adapterUnavailable, 1);
  assert.deepEqual([receipts[2]?.outcome, receipts[2]?.reasonCode], ["skipped", "adapter_unavailable"]);

  const invalidAdapter: MarketBrainCaptureAdapter = Object.freeze({
    ...successfulAdapter,
    adapterRelease: "sharpapi_main_odds_adapter_runner_invalid_r1",
    async execute() {
      return {
        outcome: "success_with_rows",
        reasonCode: null,
        requestCount: 1,
        expectedPages: 1,
        receivedPages: 1,
        responseSha256: "c".repeat(64),
        rawArchiveSha256: null,
        accounting: { ...ZERO, rawRows: 1 },
        details: { fixture: "invalid_adapter_result" },
      };
    },
  });
  const invalidReceipts: MarketBrainEvidenceAttempt[] = [];
  const invalidClaim = claim({
    attemptId: "60000000-0000-4000-8000-000000000005",
    adapterRelease: invalidAdapter.adapterRelease,
    claimToken: "60000000-0000-4000-8000-000000000015",
  });
  const invalid = await runMarketBrainCaptureCycle({
    client: {} as SupabaseClient,
    adapters: new MarketBrainCaptureAdapterRegistry([invalidAdapter]),
    workerId: "market-brain-runner-test",
    leaseSeconds: 120,
    timeoutMs: 5_000,
    now: () => new Date("2026-10-28T16:02:31.000Z"),
    dependencies: {
      claimExpired: async () => [],
      claimDue: async () => [invalidClaim],
      persist: async ({ attempt }) => {
        invalidReceipts.push(attempt);
        return { ...attempt, persistenceAttestation: {
          serverCreatedAt: "2026-10-28T16:02:32.000Z", checksum: attempt.checksum,
        } } as AttestedMarketBrainEvidenceAttempt;
      },
    },
  });
  assert.equal(invalid.executionFailures, 1);
  assert.equal(invalidReceipts[0]?.reasonCode, "parser_failure",
    "an invalid adapter result must become a bounded defect receipt instead of aborting the batch");
  assert.deepEqual(invalidReceipts[0]?.details, {
    runnerRelease: MARKET_BRAIN_CAPTURE_RUNNER_RELEASE, invalidAdapterResult: true,
  });

  const failingAdapter: MarketBrainCaptureAdapter = Object.freeze({
    ...successfulAdapter,
    adapterRelease: "sharpapi_main_odds_adapter_runner_test_r2",
    async execute() {
      throw new MarketBrainCaptureAdapterError({
        reasonCode: "rate_limited", message: "secret provider response", publicDetails: { httpStatus: 429 },
      });
    },
  });
  const failedReceipts: MarketBrainEvidenceAttempt[] = [];
  const failedClaim = claim({
    attemptId: "60000000-0000-4000-8000-000000000004",
    adapterRelease: failingAdapter.adapterRelease,
    claimToken: "60000000-0000-4000-8000-000000000014",
  });
  const failed = await runMarketBrainCaptureCycle({
    client: {} as SupabaseClient,
    adapters: new MarketBrainCaptureAdapterRegistry([failingAdapter]),
    workerId: "market-brain-runner-test",
    leaseSeconds: 120,
    timeoutMs: 5_000,
    now: () => new Date("2026-10-28T16:02:31.000Z"),
    dependencies: {
      claimExpired: async () => [],
      claimDue: async () => [failedClaim],
      persist: async ({ attempt }) => {
        failedReceipts.push(attempt);
        throw new Error("database unavailable");
      },
    },
  });
  assert.equal(failed.executionFailures, 1);
  assert.equal(failed.persistenceFailures, 1,
    "receipt persistence failure must remain visible and leave the lease retryable");
  assert.equal(failedReceipts[0]?.reasonCode, "rate_limited");
  assert.deepEqual(failedReceipts[0]?.details, {
    failureClass: "MarketBrainCaptureAdapterError", httpStatus: 429,
    runnerRelease: MARKET_BRAIN_CAPTURE_RUNNER_RELEASE,
  });
  assert.doesNotMatch(JSON.stringify(failedReceipts[0]?.details), /secret provider response/,
    "provider error messages may contain credentials and must not enter durable public details");

  console.log("Market Brain shadow-only exact-adapter capture runner contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
