import assert from "node:assert/strict";
import { acquireCronJobLeaseWithRetry } from "../lib/cron/leaseRetry";
import type { CronLeaseAcquireResult } from "../lib/cron/leases";

const skipped = (runId: string): CronLeaseAcquireResult => ({
  mode: "skipped_overlap",
  jobName: "prediction_pipeline:mlb",
  runId: "candidate-run",
  existingRunId: runId,
  leaseExpiresAt: "2026-08-11T21:45:30.000Z",
});

const acquired: CronLeaseAcquireResult = {
  mode: "acquired",
  jobName: "prediction_pipeline:mlb",
  runId: "candidate-run",
  leaseExpiresAt: "2026-08-11T21:51:00.000Z",
};

async function main(): Promise<void> {
  let clockMs = 0;
  const responses = [skipped("lineup-watch"), skipped("lineup-watch"), acquired];
  const recovered = await acquireCronJobLeaseWithRetry(
    {
      jobName: "prediction_pipeline:mlb",
      runId: "candidate-run",
      leaseSeconds: 360,
      maxWaitMs: 20_000,
      retryIntervalMs: 1_000,
    },
    {
      acquire: async () => responses.shift() ?? acquired,
      sleep: async (ms) => { clockMs += ms; },
      now: () => clockMs,
    },
  );

  assert.equal(recovered.lease.mode, "acquired", "a short writer collision is recovered in the same lock sweep");
  assert.equal(recovered.attempts, 3, "initial acquire plus two bounded retries");
  assert.equal(recovered.waitedMs, 2_000, "retry wait is observable and bounded");

  clockMs = 0;
  const timedOut = await acquireCronJobLeaseWithRetry(
    {
      jobName: "prediction_pipeline:mlb",
      runId: "candidate-run",
      leaseSeconds: 360,
      maxWaitMs: 2_500,
      retryIntervalMs: 1_000,
    },
    {
      acquire: async () => skipped("long-writer"),
      sleep: async (ms) => { clockMs += ms; },
      now: () => clockMs,
    },
  );

  assert.equal(timedOut.lease.mode, "skipped_overlap", "long collisions still fail closed under the shared lease");
  assert.equal(timedOut.waitedMs, 2_500, "wait never exceeds the configured bound");
  assert.equal(timedOut.attempts, 4, "the final partial interval receives one last acquire attempt");

  console.log("PASS cron lease retry recovers short lock collisions and bounds long contention");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
