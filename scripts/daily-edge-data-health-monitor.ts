import { runDailyEdgeDataHealthMonitor } from "@/lib/services/dailyEdge/dailyEdgeDataHealthMonitor";
import type { Sport } from "@/lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string;
  markets: string;
  json: boolean;
};

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sport: "mlb",
    date: todayEt(),
    markets: "ML,TOTAL,FI",
    json: false,
  };
  for (const arg of argv) {
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "sport") out.sport = value.toLowerCase() as Sport;
    if (key === "date") out.date = value === "today" ? todayEt() : value;
    if (key === "markets") out.markets = value;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runDailyEdgeDataHealthMonitor({
    sport: args.sport,
    date: args.date,
    markets: args.markets,
  });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Daily Edge Data Health Monitor — ${args.sport} ${args.date}`);
  console.log(`Predictions: ${report.predictionCount} · Games: ${report.gameCount}`);
  console.log(`Safe for normal reader display: ${report.safeForNormalReaderDisplay ? "yes" : "no"}`);
  console.log(JSON.stringify({
    coverage: report.coverage,
    bySeverity: report.bySeverity,
    byCode: report.byCode,
    findings: report.findings.slice(0, 30),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
