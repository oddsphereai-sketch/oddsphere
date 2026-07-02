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
import { runDailyEdgeDataHealthRepair } from "@/lib/services/dailyEdge/dailyEdgeDataHealthRepair";
import type { Sport } from "@/lib/types/domain/Sport";

export const maxDuration = 300;

const ENABLE_ENV = "DAILY_EDGE_DATA_HEALTH_MONITOR_ENABLED";
const REPAIR_ENV = "DAILY_EDGE_DATA_HEALTH_AUTO_REPAIR_ENABLED";

function parseSports(request: Request): Sport[] {
  const url = new URL(request.url);
  const raw = url.searchParams.get("sports");
  if (!raw) return ["mlb", "wnba", "soccer"];
  return raw.split(",").map((sport) => sport.trim().toLowerCase()).filter(Boolean) as Sport[];
}

function buildHealthAlertSummary(args: {
  sport: Sport;
  unresolved: number;
  findings: Array<{ game: string; market: string; code: string; severity: string }>;
  repair?: { eligibleGames: number; repairedGames: number; stillUnhealthyGames: number; errors: string[] } | null;
}): string | null {
  if (args.unresolved <= 0 && (args.repair?.errors.length ?? 0) === 0) return null;
  const findingSummary = args.findings
    .filter((finding) => finding.severity === "blocking" || finding.severity === "high")
    .slice(0, 6)
    .map((finding) => `${finding.game} ${finding.market} ${finding.code}`)
    .join("; ");
  const repairSummary = args.repair
    ? `repair eligible=${args.repair.eligibleGames} repaired=${args.repair.repairedGames} still=${args.repair.stillUnhealthyGames}`
    : "repair not run";
  const errorSummary = args.repair?.errors.length
    ? ` errors=${args.repair.errors.slice(0, 2).join(" | ")}`
    : "";
  return `Daily Edge health unresolved ${args.sport}: unresolved=${args.unresolved}; ${repairSummary}; ${findingSummary}${errorSummary}`.slice(0, 1000);
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
      const repairEnabled =
        process.env[REPAIR_ENV] === "true" &&
        url.searchParams.get("repair") !== "false";
      const repair = repairEnabled
        ? await runDailyEdgeDataHealthRepair({
            report,
            apply: true,
            postRepairMonitor: () => runDailyEdgeDataHealthMonitor({ sport, date, markets }),
          })
        : null;
      for (const finding of report.findings) {
        if (finding.severity === "blocking" || finding.severity === "high") {
          console.log(`[daily-edge-data-health] ${finding.severity.toUpperCase()} ${finding.sport} ${finding.game} ${finding.market} ${finding.code}: ${finding.message}`);
        }
      }
      const finalUnresolved =
        repair?.postRepairHealth?.unresolvedBlockingOrHigh ??
        report.unresolvedBlockingOrHigh;
      const repairErrors = repair?.errors.length ?? 0;
      const automodelRecordsUpdated =
        typeof repair?.steps.automodel?.recordsUpdated === "number"
          ? repair.steps.automodel.recordsUpdated
          : 0;
      const predictionOrGradeRepairRan = automodelRecordsUpdated > 0;
      return {
        records_updated: repair?.recordsUpdated ?? 0,
        api_calls_made: repair?.apiCallsMade ?? 0,
        partial: finalUnresolved > 0 || repairErrors > 0,
        error_message: buildHealthAlertSummary({
          sport,
          unresolved: finalUnresolved,
          findings: report.findings,
          repair,
        }),
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
          repairEnabled,
          repair,
          noOpenAiCalls: true,
          noPredictionChanges: !predictionOrGradeRepairRan,
          noGradeChanges: !predictionOrGradeRepairRan,
          noTrackingChanges: true,
        },
      };
    },
    { lockMinutes: 10 },
  );
}

export const POST = GET;
