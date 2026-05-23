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

export type CronHandlerResult = {
  records_updated?: number;
  api_calls_made?: number;
  /** If true, the run is marked 'partial' in the log instead of 'success'. */
  partial?: boolean;
  /** Free-form additional payload echoed back in the JSON response. */
  details?: Record<string, unknown>;
};

export type CronHandlerContext = {
  logId: number;
  sport: Sport | null;
};

/** Per-sport handler context — `sport` is guaranteed non-null. */
export type PerSportCronHandlerContext = {
  logId: number;
  sport: Sport;
};

export type CronHandler = (ctx: CronHandlerContext) => Promise<CronHandlerResult>;
export type PerSportCronHandler = (
  ctx: PerSportCronHandlerContext
) => Promise<CronHandlerResult>;

export type CronHandlerOptions = {
  sport?: Sport | null;
  /** Window in minutes during which another in-progress run blocks a new one. */
  lockMinutes?: number;
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
  const lockMinutes = options.lockMinutes ?? 5;

  return runOne(dataSource, sport, lockMinutes, handler);
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
  const lockMinutes = options.lockMinutes ?? 5;

  const runs: Array<{
    sport: Sport;
    status: "ok" | "partial" | "skipped" | "failed";
    logId: number | null;
    error?: string;
    records_updated?: number;
    api_calls_made?: number;
    details?: Record<string, unknown>;
  }> = [];

  // PerSportCronHandler requires non-null sport. We wrap it to match the
  // wider CronHandler signature for runOneStructured's internal use.
  const wrapped: CronHandler = async (ctx) => handler({ logId: ctx.logId, sport: ctx.sport! });
  for (const sport of sports) {
    const single = await runOneStructured(dataSource, sport, lockMinutes, wrapped);
    runs.push({ sport, ...single });
  }

  const anyFailed = runs.some((r) => r.status === "failed");
  return Response.json({ ok: !anyFailed, runs }, { status: anyFailed ? 500 : 200 });
}

// ─── Internal: shared execution body ─────────────────────────────────────

async function runOne(
  dataSource: string,
  sport: Sport | null,
  lockMinutes: number,
  handler: CronHandler
): Promise<Response> {
  const r = await runOneStructured(dataSource, sport, lockMinutes, handler);
  if (r.status === "skipped") {
    return Response.json({ ok: true, skipped: true, reason: r.error });
  }
  if (r.status === "failed") {
    return Response.json({ ok: false, logId: r.logId, error: r.error }, { status: 500 });
  }
  return Response.json({
    ok: true,
    logId: r.logId,
    status: r.status,
    records_updated: r.records_updated,
    api_calls_made: r.api_calls_made,
    details: r.details,
  });
}

type StructuredResult = {
  status: "ok" | "partial" | "skipped" | "failed";
  logId: number | null;
  error?: string;
  records_updated?: number;
  api_calls_made?: number;
  details?: Record<string, unknown>;
};

async function runOneStructured(
  dataSource: string,
  sport: Sport | null,
  lockMinutes: number,
  handler: CronHandler
): Promise<StructuredResult> {
  // Lock check
  let active = false;
  try {
    active = await refreshLogger.isAnotherRunActive(dataSource, sport, lockMinutes);
  } catch (e) {
    // If the lock check itself fails, fall back to allowing the run rather
    // than blocking indefinitely. The error is non-fatal.
    console.error(`isAnotherRunActive check failed: ${(e as Error).message}`);
  }
  if (active) {
    return {
      status: "skipped",
      logId: null,
      error: `previous ${dataSource}${sport ? "_" + sport : ""} run still in progress within ${lockMinutes}min`,
    };
  }

  // Start log
  let logId: number;
  try {
    logId = await refreshLogger.start(dataSource, sport);
  } catch (e) {
    // If logger fails, surface a 500 but don't try to run the handler —
    // running without a log row creates orphan state.
    return {
      status: "failed",
      logId: null,
      error: `refreshLogger.start failed: ${(e as Error).message}`,
    };
  }

  // Run handler
  try {
    const r = await handler({ logId, sport });
    await refreshLogger.complete(logId, {
      success: !r.partial,
      partial: r.partial,
      records_updated: r.records_updated,
      api_calls_made: r.api_calls_made,
    });
    return {
      status: r.partial ? "partial" : "ok",
      logId,
      records_updated: r.records_updated,
      api_calls_made: r.api_calls_made,
      details: r.details,
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
    return { status: "failed", logId, error: errorMessage };
  }
}
