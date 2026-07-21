/**
 * cronHandler / cronHandlerPerSport — wrappers that compose auth + lock +
 * refresh-log + try/catch around a cron handler function.
 *
 * Crons in /app/api/cron/<name>/route.ts become ~10-line shells:
 *
 *   export async function GET(request: Request) {
 *     return cronHandler(request, "daily_refresh", async ({ logId }) => {
 *       const { recordsUpdated, apiCallsMade } = await ...;
 *       return { records_updated: recordsUpdated, api_calls_made: apiCallsMade };
 *     });
 *   }
 *
 * For multi-sport crons:
 *
 *   export async function GET(request: Request) {
 *     return cronHandlerPerSport(request, "morning_slate", ["mlb"], async ({ logId, sport }) => {
 *       // sport-specific work
 *       return { records_updated: ... };
 *     });
 *   }
 *
 * Both wrappers:
 *   1. Validate CRON_SECRET — return 401 on failure.
 *   2. Check isAnotherRunActive — return 200 { skipped: true } if active.
 *   3. refreshLogger.start → log id.
 *   4. Run handler. On success: refreshLogger.complete(success). On throw:
 *      refreshLogger.complete(failed) + 500 response. Either way the run
 *      row is closed out (no orphan in_progress rows on crash).
 *   5. Return JSON response with logId + handler details.
 */

import type { Sport } from "../types/domain/Sport";
import { validateCronAuth } from "./auth";
import { refreshLogger } from "../services/refreshLogger";
import { randomUUID } from "node:crypto";
import {
  acquireCronJobLease,
  cronJobName,
  releaseCronJobLease,
  type CronLeaseAcquireResult,
} from "./leases";

export type CronHandlerResult = {
  records_updated?: number;
  api_calls_made?: number;
  /** If true, the run is marked 'partial' in the log instead of 'success'. */
  partial?: boolean;
  /** Optional compact summary persisted to data_refresh_log.error_message. */
  error_message?: string | null;
  /** Free-form additional payload echoed back in the JSON response. */
  details?: Record<string, unknown>;
};

export type CronHandlerContext = {
  logId: number;
  sport: Sport | null;
  runId: string;
};

/** Per-sport handler context — `sport` is guaranteed non-null. */
export type PerSportCronHandlerContext = {
  logId: number;
  sport: Sport;
  runId: string;
};

export type CronHandler = (ctx: CronHandlerContext) => Promise<CronHandlerResult>;
export type PerSportCronHandler = (
  ctx: PerSportCronHandlerContext
) => Promise<CronHandlerResult>;

export type CronHandlerOptions = {
  sport?: Sport | null;
  /** Window in minutes during which another in-progress run blocks a new one. */
  lockMinutes?: number;
  /** Shared namespace for jobs that mutate the same prediction pipeline. */
  leaseGroup?: string;
  /** Fail closed instead of falling back when the lease RPC is unavailable. */
  requireLease?: boolean;
  /** Suppress duplicate schedulers after a healthy recent completion. */
  minIntervalMinutes?: number;
};

/**
 * Single-call wrapper. Use for crons that touch one sport (or none).
 */
export async function cronHandler(
  request: Request,
  dataSource: string,
  handler: CronHandler,
  options: CronHandlerOptions = {}
): Promise<Response> {
  const auth = validateCronAuth(request);
  if (!auth.ok) return auth.response;

  const sport = options.sport ?? null;
  return runOne(dataSource, sport, options, handler);
}

/**
 * Multi-sport wrapper. Iterates the given sports array sequentially. Auth
 * checked once. Each sport gets its own (data_source, sport) lock + log row,
 * so a failure in one sport doesn't block the others.
 */
export async function cronHandlerPerSport(
  request: Request,
  dataSource: string,
  sports: readonly Sport[],
  handler: PerSportCronHandler,
  options: Omit<CronHandlerOptions, "sport"> = {}
): Promise<Response> {
  const auth = validateCronAuth(request);
  if (!auth.ok) return auth.response;
  const runs: Array<{
    sport: Sport;
    status: "ok" | "partial" | "skipped" | "failed";
    logId: number | null;
    runId?: string;
    error?: string;
    records_updated?: number;
    api_calls_made?: number;
    details?: Record<string, unknown>;
  }> = [];

  // PerSportCronHandler requires non-null sport. We wrap it to match the
  // wider CronHandler signature for runOneStructured's internal use.
  const wrapped: CronHandler = async (ctx) => handler({ logId: ctx.logId, sport: ctx.sport!, runId: ctx.runId });
  for (const sport of sports) {
    const single = await runOneStructured(dataSource, sport, options, wrapped);
    runs.push({ sport, ...single });
  }

  const anyFailed = runs.some((r) => r.status === "failed");
  return Response.json({ ok: !anyFailed, runs }, { status: anyFailed ? 500 : 200 });
}

// ─── Internal: shared execution body ─────────────────────────────────────

async function runOne(
  dataSource: string,
  sport: Sport | null,
  options: CronHandlerOptions,
  handler: CronHandler
): Promise<Response> {
  const r = await runOneStructured(dataSource, sport, options, handler);
  if (r.status === "skipped") {
    return Response.json({ ok: true, skipped: true, runId: r.runId, reason: r.error, details: r.details });
  }
  if (r.status === "failed") {
    return Response.json({ ok: false, logId: r.logId, runId: r.runId, error: r.error }, { status: 500 });
  }
  return Response.json({
    ok: true,
    logId: r.logId,
    runId: r.runId,
    status: r.status,
    records_updated: r.records_updated,
    api_calls_made: r.api_calls_made,
    details: r.details,
  });
}

type StructuredResult = {
  status: "ok" | "partial" | "skipped" | "failed";
  logId: number | null;
  runId?: string;
  error?: string;
  records_updated?: number;
  api_calls_made?: number;
  details?: Record<string, unknown>;
};

export function resolveCronLeaseJobName(
  dataSource: string,
  sport: Sport | null,
  leaseGroup?: string,
): string {
  return cronJobName(leaseGroup ?? dataSource, sport);
}

export function isWithinCronMinimumInterval(
  lastHealthy: Date | null,
  minimumMinutes: number,
  nowMs = Date.now(),
): boolean {
  if (lastHealthy === null || minimumMinutes <= 0) return false;
  const elapsedMs = nowMs - lastHealthy.getTime();
  return elapsedMs >= 0 && elapsedMs < minimumMinutes * 60_000;
}

async function runOneStructured(
  dataSource: string,
  sport: Sport | null,
  options: CronHandlerOptions,
  handler: CronHandler
): Promise<StructuredResult> {
  const runId = randomUUID();
  const lockMinutes = options.lockMinutes ?? 5;
  const jobName = resolveCronLeaseJobName(dataSource, sport, options.leaseGroup);
  let lease: CronLeaseAcquireResult | null = null;

  if ((options.minIntervalMinutes ?? 0) > 0) {
    let lastHealthy: Date | null;
    try {
      lastHealthy = await refreshLogger.getLastHealthyCompleted(dataSource, sport);
    } catch (e) {
      return { status: "failed", logId: null, runId, error: (e as Error).message };
    }
    if (isWithinCronMinimumInterval(lastHealthy, options.minIntervalMinutes ?? 0)) {
      const elapsedMs = Date.now() - lastHealthy!.getTime();
      return {
        status: "skipped",
        logId: null,
        runId,
        error: `minimum_interval: ${dataSource}${sport ? ":" + sport : ""} completed ${Math.round(elapsedMs / 1000)}s ago`,
        details: {
          job_name: jobName,
          run_id: runId,
          minimum_interval_minutes: options.minIntervalMinutes,
          last_healthy_completed_at: lastHealthy!.toISOString(),
          cadence_skip: true,
        },
      };
    }
  }

  try {
    lease = await acquireCronJobLease({
      jobName,
      runId,
      leaseSeconds: lockMinutes * 60,
    });
  } catch (e) {
    return {
      status: "failed",
      logId: null,
      runId,
      error: (e as Error).message,
    };
  }

  if (lease.mode === "skipped_overlap") {
    let logId: number | null = null;
    try {
      logId = await refreshLogger.start(dataSource, sport);
      await refreshLogger.complete(logId, {
        success: true,
        records_updated: 0,
        api_calls_made: 0,
        error_message: `skipped_overlap: active run ${lease.existingRunId ?? "unknown"} lease expires ${lease.leaseExpiresAt ?? "unknown"}`,
      });
    } catch (e) {
      console.error(`skipped_overlap log failed: ${(e as Error).message}`);
    }
    return {
      status: "skipped",
      logId,
      runId,
      error: `skipped_overlap: previous ${jobName} run lease still valid`,
      details: {
        job_name: jobName,
        run_id: runId,
        existing_run_id: lease.existingRunId,
        lease_expires_at: lease.leaseExpiresAt,
        overlap_skip: true,
      },
    };
  }

  if (lease.mode === "unavailable") {
    if (options.requireLease === true) {
      return {
        status: "failed",
        logId: null,
        runId,
        error: `required cron lease unavailable for ${jobName}: ${lease.reason}`,
      };
    }
    let active = false;
    try {
      active = await refreshLogger.isAnotherRunActive(dataSource, sport, lockMinutes);
    } catch (e) {
      console.error(`isAnotherRunActive check failed: ${(e as Error).message}`);
    }
    if (active) {
      return {
        status: "skipped",
        logId: null,
        runId,
        error: `previous ${dataSource}${sport ? "_" + sport : ""} run still in progress within ${lockMinutes}min`,
        details: {
          job_name: jobName,
          run_id: runId,
          lease_mode: "fallback_log_lock",
          overlap_skip: true,
        },
      };
    }
  }

  // Start log
  let logId: number;
  try {
    // A hard runtime termination cannot execute our catch/finally path. Once
    // this invocation owns the lease, reconcile only sufficiently old rows
    // for the same job before opening the new lifecycle row.
    await refreshLogger.closeStaleRuns(
      dataSource,
      sport,
      Math.max(15, lockMinutes * 3)
    );
    logId = await refreshLogger.start(dataSource, sport);
  } catch (e) {
    // If logger fails, surface a 500 but don't try to run the handler —
    // running without a log row creates orphan state.
    return {
      status: "failed",
      logId: null,
      runId,
      error: `refreshLogger.start failed: ${(e as Error).message}`,
    };
  }

  // Run handler
  try {
    const r = await handler({ logId, sport, runId });
    await refreshLogger.complete(logId, {
      success: !r.partial,
      partial: r.partial,
      records_updated: r.records_updated,
      api_calls_made: r.api_calls_made,
      error_message: r.error_message,
    });
    return {
      status: r.partial ? "partial" : "ok",
      logId,
      runId,
      records_updated: r.records_updated,
      api_calls_made: r.api_calls_made,
      details: {
        ...(r.details ?? {}),
        cron_lease: {
          job_name: jobName,
          run_id: runId,
          mode: lease.mode,
          lease_expires_at: lease.mode === "acquired" ? lease.leaseExpiresAt : null,
        },
      },
    };
  } catch (e) {
    const errorMessage = (e as Error).message;
    // Best-effort log close; swallow any secondary errors
    try {
      await refreshLogger.complete(logId, {
        success: false,
        error_message: errorMessage,
      });
    } catch (closeErr) {
      console.error(
        `refreshLogger.complete failed during error handling: ${(closeErr as Error).message}`
      );
    }
    return { status: "failed", logId, runId, error: errorMessage };
  } finally {
    if (lease?.mode === "acquired") {
      try {
        await releaseCronJobLease({ jobName, runId });
      } catch (e) {
        console.error(`cron lease release failed: ${(e as Error).message}`);
      }
    }
  }
}
