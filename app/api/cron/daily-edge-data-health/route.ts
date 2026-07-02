/**
 * Daily Edge data-health monitor.
 *
 * Report-only guardrail for the exact evidence package used by the member
 * reader: locked snapshot first, current/live only for true pre-lock markets.
 * It does not call AI and does not change picks, grades, probabilities,
 * projections, tracking, or snapshots.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { parseDateFromUrl } from "@/lib/cron/dates";
import { runDailyEdgeDataHealthMonitor } from "@/lib/services/dailyEdge/dailyEdgeDataHealthMonitor";
import type { Sport } from "@/lib/types/domain/Sport";

export const maxDuration = 120;

const ENABLE_ENV = "DAILY_EDGE_DATA_HEALTH_MONITOR_ENABLED";

function parseSports(request: Request): Sport[] {
  const url = new URL(request.url);
  const raw = url.searchParams.get("sports");
  if (!raw) return ["mlb", "wnba", "soccer"];
  return raw.split(",").map((sport) => sport.trim().toLowerCase()).filter(Boolean) as Sport[];
}

export async function GET(request: Request) {
  const date = parseDateFromUrl(request);
  const sports = parseSports(request);
  const url = new URL(request.url);
  const markets = url.searchParams.get("markets") ?? "ML,TOTAL,FI";

  return cronHandlerPerSport(
    request,
    "daily_edge_data_health",
    sports,
    async ({ sport }) => {
      if (process.env[ENABLE_ENV] !== "true") {
        return {
          records_updated: 0,
          partial: false,
          details: {
            disabled: true,
            reason: `${ENABLE_ENV}!=true`,
            noOpenAiCalls: true,
            noPredictionChanges: true,
          },
        };
      }

      const report = await runDailyEdgeDataHealthMonitor({ sport, date, markets });
      for (const finding of report.findings) {
        if (finding.severity === "blocking" || finding.severity === "high") {
          console.log(`[daily-edge-data-health] ${finding.severity.toUpperCase()} ${finding.sport} ${finding.game} ${finding.market} ${finding.code}: ${finding.message}`);
        }
      }
      return {
        records_updated: 0,
        partial: report.unresolvedBlockingOrHigh > 0,
        details: {
          date,
          sport,
          markets: report.markets,
          gameCount: report.gameCount,
          predictionCount: report.predictionCount,
          safeForNormalReaderDisplay: report.safeForNormalReaderDisplay,
          evidenceSource: report.evidenceSource,
          coverage: report.coverage,
          bySeverity: report.bySeverity,
          byCode: report.byCode,
          findings: report.findings.slice(0, 50),
          noOpenAiCalls: true,
          noPredictionChanges: true,
          noGradeChanges: true,
          noTrackingChanges: true,
        },
      };
    },
    { lockMinutes: 10 },
  );
}

export const POST = GET;
