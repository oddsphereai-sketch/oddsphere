/**
 * Phase 4.2.C.1.R-19 Phase 2 — `/api/cron/slate-cycle`.
 *
 * Cron-callable, non-interactive entrypoint to the slate-cycle pipeline.
 * Parallel to `scripts/operator/automation/run-slate-cycle.ts`; both
 * orchestrators call the same R-17 helpers and service functions, so
 * the per-step writes are identical when env flags allow them.
 *
 * Safety chain (every gate must pass before any write fires):
 *
 *   1. CRON_SECRET            — validated by `cronHandler` wrapper.
 *      Missing / invalid → 401.
 *   2. ORCHESTRATOR_SKIP_CONFIRMATION  — must be "true". Missing →
 *      route returns a structured blocked report without calling any
 *      providers or writing anything. Prevents accidental cron
 *      activation by callers who haven't explicitly opted in.
 *   3. Provider mode audit     — all required providers must be
 *      real_api. Otherwise every step's effective_write_mode is
 *      forced to false. (R-17 Step 2C)
 *   4. Slate reconciliation    — BDL vs SharpAPI /opportunities/ev
 *      overlap must not fail_closed. (R-17 Step 2B)
 *   5. Per-step env flag       — each step also gates on its own
 *      LINES_DB_WRITES_ENABLED / AUTOMODEL_DB_WRITES_ENABLED / etc.
 *   6. Publish gate            — hold-as-draft default
 *      (R-19 Phase 1 C4). MORNING_SLATE_AUTO_PUBLISH=true is the only
 *      opt-in for auto-publish.
 *
 * This route is NOT scheduled in `vercel.json` (R-19 Phase 2 does not
 * activate cron). A future phase will add the schedule once an end-to-end
 * dry-run has been observed.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { parseDateFromUrl } from "@/lib/cron/dates";
import {
  runSlateCycleAutomated,
  isOrchestratorGateEnabled,
  buildOrchestratorBlockedReport,
  summarizeSlateCycleCoreLifecycle,
} from "@/lib/services/automationOrchestrator";
import { isIntradayMode } from "@/lib/services/automationOrchestratorGates";
import { supabase } from "@/lib/db/supabase";
import { runScheduledMarketIntelligenceV2Collection } from "@/lib/services/marketIntelligenceV2/scheduledCollection";
import type { Sport } from "@/lib/types/domain/Sport";
import { refreshDailyEdgeResponseSnapshot } from "@/lib/services/labResponseSnapshotWriter";
import { assertMlbChampionRuntime } from "@/lib/automodel/mlbChampionRuntime";
import {
  assessSlateCyclePostludeBudget,
  buildSlateCyclePostludeTiming,
  SLATE_CYCLE_MARKET_INTELLIGENCE_BUDGET_MS,
  SLATE_CYCLE_RESPONSE_SNAPSHOT_BUDGET_MS,
  type SlateCyclePostludeStageTelemetry,
} from "@/lib/cron/slateCyclePostludeBudget";

export const maxDuration = 300; // Vercel Pro — full slate cycle can take ~3-5 min

export async function GET(request: Request) {
  const routeStartedAtMs = Date.now();
  const date = parseDateFromUrl(request);
  // R-19 Phase 5d — resolve intraday-mode flag from query OR env.
  // Morning cron entries omit ?intraday; afternoon/evening entries
  // pass ?intraday=true so G3 (in-progress games) becomes per-game
  // exclusion instead of slate-wide block.
  const intradayMode = isIntradayMode(request);

  // Sports — V1 launch scope is MLB only. Hardcoded here rather than
  // sportsInSeasonToday() because the orchestrator's per-step services
  // are MLB-specific and would no-op on others; explicit is clearer.
  const sports: Sport[] = ["mlb"];

  return cronHandlerPerSport(
    request,
    "slate_cycle_automation",
    sports,
    async ({ sport }) => {
      assertMlbChampionRuntime();
      // Hard gate #2 — orchestrator-skip-confirmation. Missing → return
      // a structured blocked report. No provider calls. No DB I/O. The
      // request is acknowledged (200) so the scheduler doesn't retry
      // forever, but the `partial:true` flag flags it for monitoring.
      if (!isOrchestratorGateEnabled(process.env)) {
        const blocked = buildOrchestratorBlockedReport({ sport, date });
        return {
          records_updated: 0,
          api_calls_made: 0,
          partial: true,
          details: blocked,
        };
      }

      const report = await runSlateCycleAutomated({ sport, date, intradayMode });
      const budgetAfterCore = assessSlateCyclePostludeBudget({
        routeStartedAtMs,
        nowMs: Date.now(),
        requiredWorkMs:
          SLATE_CYCLE_MARKET_INTELLIGENCE_BUDGET_MS +
          SLATE_CYCLE_RESPONSE_SNAPSHOT_BUDGET_MS,
      });
      let marketIntelligenceV2:
        | Awaited<ReturnType<typeof runScheduledMarketIntelligenceV2Collection>>
        | null = null;
      let responseSnapshot:
        | Awaited<ReturnType<typeof refreshDailyEdgeResponseSnapshot>>
        | null = null;
      let marketIntelligenceTelemetry: SlateCyclePostludeStageTelemetry;
      let responseSnapshotTelemetry: SlateCyclePostludeStageTelemetry;

      if (budgetAfterCore.canRun) {
        const marketIntelligenceStartedAtMs = Date.now();
        marketIntelligenceV2 = await runScheduledMarketIntelligenceV2Collection({
          supabase,
          sport,
          slateDate: date,
          phase: "slate_cycle",
        });
        marketIntelligenceTelemetry = {
          status: "completed",
          elapsed_ms: Date.now() - marketIntelligenceStartedAtMs,
          deferred_reason: null,
        };

        const budgetBeforeSnapshot = assessSlateCyclePostludeBudget({
          routeStartedAtMs,
          nowMs: Date.now(),
          requiredWorkMs: SLATE_CYCLE_RESPONSE_SNAPSHOT_BUDGET_MS,
        });
        if (budgetBeforeSnapshot.canRun) {
          const responseSnapshotStartedAtMs = Date.now();
          responseSnapshot = await refreshDailyEdgeResponseSnapshot({
            sport,
            date,
            source: "slate_cycle",
          });
          responseSnapshotTelemetry = {
            status: "completed",
            elapsed_ms: Date.now() - responseSnapshotStartedAtMs,
            deferred_reason: null,
          };
        } else {
          responseSnapshotTelemetry = {
            status: "deferred",
            elapsed_ms: 0,
            deferred_reason: "insufficient_time_after_market_intelligence",
          };
        }
      } else {
        marketIntelligenceTelemetry = {
          status: "deferred",
          elapsed_ms: 0,
          deferred_reason: "insufficient_time_after_core_orchestrator",
        };
        responseSnapshotTelemetry = {
          status: "deferred",
          elapsed_ms: 0,
          deferred_reason: "insufficient_time_after_core_orchestrator",
        };
      }

      // Aggregate write counts from per-step details for the
      // cron-handler return shape. `records_updated` is the sum across
      // every step that wrote, including committed work from a truthful
      // partial step, mirroring morning-slate's accounting.
      const coreLifecycle = summarizeSlateCycleCoreLifecycle(report);
      let recordsWritten = coreLifecycle.recordsWritten;
      let apiCalls = coreLifecycle.apiCalls;
      recordsWritten += marketIntelligenceV2?.recordsUpdated ?? 0;
      apiCalls += marketIntelligenceV2?.apiCallsMade ?? 0;

      const incomplete = coreLifecycle.incomplete || (marketIntelligenceV2?.errors.length ?? 0) > 0;
      return {
        records_updated: recordsWritten,
        api_calls_made: apiCalls,
        // Degraded can mean non-blocking provider warnings even when every
        // required write completed. Reserve partial for incomplete work.
        partial: incomplete,
        error_message: incomplete
          ? [
              ...(coreLifecycle.errorMessage ? [coreLifecycle.errorMessage] : []),
              ...(marketIntelligenceV2?.errors ?? []),
            ].slice(0, 5).join(" | ").slice(0, 1500)
          : null,
        details: {
          ...report,
          market_intelligence_v2: marketIntelligenceV2,
          response_snapshot: responseSnapshot,
          postlude_timing: buildSlateCyclePostludeTiming({
            routeStartedAtMs,
            nowMs: Date.now(),
            budgetAfterCore,
            marketIntelligenceV2: marketIntelligenceTelemetry,
            responseSnapshot: responseSnapshotTelemetry,
          }),
        },
      };
    },
    {
      leaseGroup: "prediction_pipeline",
      requireLease: true,
      lockMinutes: 6,
    },
  );
}

export const POST = GET;
