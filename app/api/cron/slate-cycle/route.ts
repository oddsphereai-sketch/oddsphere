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
} from "@/lib/services/automationOrchestrator";
import { isIntradayMode } from "@/lib/services/automationOrchestratorGates";
import { supabase } from "@/lib/db/supabase";
import { runScheduledMarketIntelligenceV2Collection } from "@/lib/services/marketIntelligenceV2/scheduledCollection";
import type { Sport } from "@/lib/types/domain/Sport";
import { refreshDailyEdgeResponseSnapshot } from "@/lib/services/labResponseSnapshotWriter";

export const maxDuration = 300; // Vercel Pro — full slate cycle can take ~3-5 min

export async function GET(request: Request) {
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
      const marketIntelligenceV2 = await runScheduledMarketIntelligenceV2Collection({
        supabase,
        sport,
        slateDate: date,
        phase: "slate_cycle",
      });

      // Aggregate write counts from per-step details for the
      // cron-handler return shape. `records_updated` is the sum across
      // every step that wrote, mirroring morning-slate's accounting.
      let recordsWritten = 0;
      let apiCalls = 0;
      for (const s of report.steps) {
        const d = s.details ?? {};
        const r = typeof (d as Record<string, unknown>).records_updated === "number"
          ? ((d as Record<string, unknown>).records_updated as number)
          : 0;
        const a = typeof (d as Record<string, unknown>).api_calls === "number"
          ? ((d as Record<string, unknown>).api_calls as number)
          : 0;
        if (s.mode === "wrote") recordsWritten += r;
        apiCalls += a;
      }
      recordsWritten += marketIntelligenceV2.recordsUpdated;
      apiCalls += marketIntelligenceV2.apiCallsMade;
      const responseSnapshot = await refreshDailyEdgeResponseSnapshot({
        sport,
        date,
        source: "slate_cycle",
      });

      return {
        records_updated: recordsWritten,
        api_calls_made: apiCalls,
        partial: report.overall_status !== "ok" || marketIntelligenceV2.errors.length > 0,
        details: { ...report, market_intelligence_v2: marketIntelligenceV2, response_snapshot: responseSnapshot },
      };
    }
  );
}

export const POST = GET;
