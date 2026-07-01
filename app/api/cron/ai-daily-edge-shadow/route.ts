/**
 * Daily Edge AI Shadow cron.
 *
 * Admin/evaluation only:
 *   - ML + Totals only by default.
 *   - FI remains deterministic.
 *   - Writes ai_audit_usage_ledger + ai_audit_evaluation_results only.
 *   - applied=false always.
 *   - No member-facing copy, grade, pick, probability, projection, or tracking changes.
 *
 * Gates:
 *   - AI_DAILY_EDGE_SHADOW_ENABLED=true
 *   - AI_DAILY_EDGE_INTELLIGENCE_ENABLED=true
 *   - Guarded QC / apply / mutation flags must remain false.
 */

import { cronHandler } from "@/lib/cron/runCron";
import { currentSlateDate } from "@/lib/dates/slateDate";
import { runDailyEdgeAiShadow } from "@/lib/services/aiAuditor/dailyEdgeShadowRunner";
import type { Sport } from "@/lib/types/domain/Sport";

export const maxDuration = 300;

const DEFAULT_MARKETS = "ML,TOTAL";

function parseSport(raw: string | null): Sport {
  const sport = (raw ?? "mlb").toLowerCase();
  return (["mlb", "nba", "nhl", "soccer", "wnba"].includes(sport) ? sport : "mlb") as Sport;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sport = parseSport(url.searchParams.get("sport"));
  const date = url.searchParams.get("date") ?? currentSlateDate(sport);
  const markets = url.searchParams.get("markets") ?? DEFAULT_MARKETS;
  const dryRun = url.searchParams.get("dryRun") === "true";
  const force = url.searchParams.get("force") === "true";
  const maxCostRaw = url.searchParams.get("maxCostUsd");
  const maxCostUsd = maxCostRaw ? Number(maxCostRaw) : null;
  const maxCallsRaw = url.searchParams.get("maxCalls");
  const maxCalls = maxCallsRaw ? Number(maxCallsRaw) : null;

  return cronHandler(
    request,
    "ai_daily_edge_shadow",
    async () => {
      const result = await runDailyEdgeAiShadow({
        sport,
        date,
        markets,
        dryRun,
        force,
        maxCostUsd: Number.isFinite(maxCostUsd) ? maxCostUsd : null,
        maxCalls: Number.isFinite(maxCalls) ? maxCalls : null,
      });
      return {
        records_updated: result.ledgerRowsWritten + result.evaluationRowsWritten,
        api_calls_made: result.callsAttempted,
        partial: result.statuses.block > 0 || result.statuses.warn > 0,
        details: {
          run_id: result.runId,
          mode: result.mode,
          sport: result.sport,
          date: result.date,
          markets: result.markets,
          evidence_rows: result.evidenceRows,
          eligible_rows: result.eligibleRows,
          skipped_unchanged_rows: result.skippedUnchangedRows,
          deferred_rows: result.deferredRows,
          calls_attempted: result.callsAttempted,
          ledger_rows_written: result.ledgerRowsWritten,
          evaluation_rows_written: result.evaluationRowsWritten,
          applied_rows: result.appliedRows,
          estimated_cost_usd: result.estimatedCostUsd,
          actual_cost_usd: result.actualCostUsd,
          statuses: result.statuses,
          validation_errors_by_code: result.validationErrorsByCode,
          examples: result.details
            .filter((row) => !row.skipped)
            .slice(0, 8)
            .map((row) => ({
              game: `${row.row.identity.awayTeam} @ ${row.row.identity.homeTeam}`,
              market: row.row.identity.normalizedMarket,
              pick: row.row.identity.pick,
              original_grade: row.row.identity.originalPlayGrade,
              ai_recommended_grade: row.aiRecommendedGrade,
              ai_recommended_market_read: row.aiRecommendedMarketRead,
              status: row.status,
              validation_errors: row.validationErrors,
            })),
        },
      };
    },
    { sport, lockMinutes: 20 },
  );
}

export const POST = GET;
