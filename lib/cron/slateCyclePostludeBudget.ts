/**
 * Pure wall-time budget for the recoverable slate-cycle postlude.
 *
 * The route's core orchestrator is authoritative. Market Intelligence v2 and
 * the response snapshot have dedicated scheduled recovery owners, so the route
 * may defer either duplicate stage rather than start it inside the shutdown
 * reserve. This helper intentionally does not attempt to cancel an operation
 * that has already started.
 */

export const SLATE_CYCLE_MAX_DURATION_MS = 300_000;
export const SLATE_CYCLE_TIMEOUT_SAFETY_RESERVE_MS = 30_000;
export const SLATE_CYCLE_MARKET_INTELLIGENCE_BUDGET_MS = 45_000;
export const SLATE_CYCLE_RESPONSE_SNAPSHOT_BUDGET_MS = 15_000;

export type SlateCyclePostludeBudget = {
  canRun: boolean;
  elapsedMs: number;
  remainingMs: number;
  requiredWorkMs: number;
  safetyReserveMs: number;
  requiredRemainingMs: number;
};

export type SlateCyclePostludeStageTelemetry = {
  status: "completed" | "deferred";
  elapsed_ms: number;
  deferred_reason: string | null;
};

export type SlateCyclePostludeTiming = {
  max_duration_ms: number;
  core_elapsed_ms: number;
  remaining_after_core_ms: number;
  required_remaining_after_core_ms: number;
  safety_reserve_ms: number;
  market_intelligence_v2: SlateCyclePostludeStageTelemetry;
  response_snapshot: SlateCyclePostludeStageTelemetry;
  total_elapsed_ms: number;
  remaining_at_return_ms: number;
};

export function assessSlateCyclePostludeBudget(args: {
  routeStartedAtMs: number;
  nowMs: number;
  requiredWorkMs: number;
  maxDurationMs?: number;
  safetyReserveMs?: number;
}): SlateCyclePostludeBudget {
  const maxDurationMs = args.maxDurationMs ?? SLATE_CYCLE_MAX_DURATION_MS;
  const safetyReserveMs = args.safetyReserveMs ?? SLATE_CYCLE_TIMEOUT_SAFETY_RESERVE_MS;
  const elapsedMs = Math.max(0, args.nowMs - args.routeStartedAtMs);
  const remainingMs = Math.max(0, maxDurationMs - elapsedMs);
  const requiredWorkMs = Math.max(0, args.requiredWorkMs);
  const requiredRemainingMs = safetyReserveMs + requiredWorkMs;
  return {
    canRun: remainingMs >= requiredRemainingMs,
    elapsedMs,
    remainingMs,
    requiredWorkMs,
    safetyReserveMs,
    requiredRemainingMs,
  };
}

export function buildSlateCyclePostludeTiming(args: {
  routeStartedAtMs: number;
  nowMs: number;
  budgetAfterCore: SlateCyclePostludeBudget;
  marketIntelligenceV2: SlateCyclePostludeStageTelemetry;
  responseSnapshot: SlateCyclePostludeStageTelemetry;
  maxDurationMs?: number;
}): SlateCyclePostludeTiming {
  const maxDurationMs = args.maxDurationMs ?? SLATE_CYCLE_MAX_DURATION_MS;
  const totalElapsedMs = Math.max(0, args.nowMs - args.routeStartedAtMs);
  return {
    max_duration_ms: maxDurationMs,
    core_elapsed_ms: args.budgetAfterCore.elapsedMs,
    remaining_after_core_ms: args.budgetAfterCore.remainingMs,
    required_remaining_after_core_ms: args.budgetAfterCore.requiredRemainingMs,
    safety_reserve_ms: args.budgetAfterCore.safetyReserveMs,
    market_intelligence_v2: args.marketIntelligenceV2,
    response_snapshot: args.responseSnapshot,
    total_elapsed_ms: totalElapsedMs,
    remaining_at_return_ms: Math.max(0, maxDurationMs - totalElapsedMs),
  };
}
