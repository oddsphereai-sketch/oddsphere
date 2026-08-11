import type { CronLeaseAcquireResult } from "./leases";

type AcquireLease = (opts: {
  jobName: string;
  runId: string;
  leaseSeconds: number;
}) => Promise<CronLeaseAcquireResult>;

export async function acquireCronJobLeaseWithRetry(
  opts: {
    jobName: string;
    runId: string;
    leaseSeconds: number;
    maxWaitMs?: number;
    retryIntervalMs?: number;
  },
  deps: {
    acquire: AcquireLease;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<{
  lease: CronLeaseAcquireResult;
  attempts: number;
  waitedMs: number;
}> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const maxWaitMs = Math.max(0, opts.maxWaitMs ?? 0);
  const retryIntervalMs = Math.max(100, opts.retryIntervalMs ?? 1_000);
  const startedAt = now();
  let attempts = 1;
  let lease = await deps.acquire({
    jobName: opts.jobName,
    runId: opts.runId,
    leaseSeconds: opts.leaseSeconds,
  });

  while (lease.mode === "skipped_overlap") {
    const elapsedMs = Math.max(0, now() - startedAt);
    const remainingMs = maxWaitMs - elapsedMs;
    if (remainingMs <= 0) break;
    await sleep(Math.min(retryIntervalMs, remainingMs));
    attempts++;
    lease = await deps.acquire({
      jobName: opts.jobName,
      runId: opts.runId,
      leaseSeconds: opts.leaseSeconds,
    });
  }

  return {
    lease,
    attempts,
    waitedMs: Math.min(maxWaitMs, Math.max(0, now() - startedAt)),
  };
}
