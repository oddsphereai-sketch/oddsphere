import { runDailyEdgeAiShadow } from "@/lib/services/aiAuditor/dailyEdgeShadowRunner";
import { currentSlateDate } from "@/lib/dates/slateDate";
import type { Sport } from "@/lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string | null;
  markets: string;
  dryRun: boolean;
  force: boolean;
  maxCostUsd: number | null;
  maxCalls: number | null;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sport: "mlb",
    date: null,
    markets: "ML,TOTAL",
    dryRun: false,
    force: false,
    maxCostUsd: null,
    maxCalls: null,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--force") {
      out.force = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "sport") out.sport = value.toLowerCase() as Sport;
    if (key === "date") out.date = value;
    if (key === "markets") out.markets = value;
    if (key === "max-cost-usd") out.maxCostUsd = Number(value);
    if (key === "max-calls") out.maxCalls = Number(value);
  }
  return out;
}

function compact(result: Awaited<ReturnType<typeof runDailyEdgeAiShadow>>) {
  return {
    runId: result.runId,
    mode: result.mode,
    sport: result.sport,
    date: result.date,
    markets: result.markets,
    evidenceRows: result.evidenceRows,
    eligibleRows: result.eligibleRows,
    skippedUnchangedRows: result.skippedUnchangedRows,
    deferredRows: result.deferredRows,
    callsAttempted: result.callsAttempted,
    ledgerRowsWritten: result.ledgerRowsWritten,
    evaluationRowsWritten: result.evaluationRowsWritten,
    appliedRows: result.appliedRows,
    estimatedCostUsd: result.estimatedCostUsd,
    actualCostUsd: result.actualCostUsd,
    statuses: result.statuses,
    validationErrorsByCode: result.validationErrorsByCode,
    examples: result.details
      .filter((row) => !row.skipped)
      .slice(0, 12)
      .map((row) => ({
        game: `${row.row.identity.awayTeam} @ ${row.row.identity.homeTeam}`,
        market: row.row.identity.normalizedMarket,
        pick: row.row.identity.pick,
        originalGrade: row.row.identity.originalPlayGrade,
        aiRecommendedGrade: row.aiRecommendedGrade,
        aiRecommendedMarketRead: row.aiRecommendedMarketRead,
        status: row.status,
        validationErrors: row.validationErrors,
      })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date ?? currentSlateDate(args.sport);
  const result = await runDailyEdgeAiShadow({
    sport: args.sport,
    date,
    markets: args.markets,
    dryRun: args.dryRun,
    force: args.force,
    maxCostUsd: args.maxCostUsd,
    maxCalls: args.maxCalls,
  });
  console.log(JSON.stringify(compact(result), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
