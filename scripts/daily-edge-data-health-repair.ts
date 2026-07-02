import { runDailyEdgeDataHealthMonitor } from "@/lib/services/dailyEdge/dailyEdgeDataHealthMonitor";
import { runDailyEdgeDataHealthRepair } from "@/lib/services/dailyEdge/dailyEdgeDataHealthRepair";
import type { Sport } from "@/lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string;
  markets: string;
  apply: boolean;
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
    apply: false,
    json: false,
  };
  for (const arg of argv) {
    if (arg === "--apply") {
      out.apply = true;
      continue;
    }
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
  const before = await runDailyEdgeDataHealthMonitor({
    sport: args.sport,
    date: args.date,
    markets: args.markets,
  });
  const repair = await runDailyEdgeDataHealthRepair({
    report: before,
    apply: args.apply,
    postRepairMonitor: args.apply
      ? () => runDailyEdgeDataHealthMonitor({
          sport: args.sport,
          date: args.date,
          markets: args.markets,
        })
      : undefined,
  });

  if (args.json) {
    console.log(JSON.stringify({ before, repair }, null, 2));
    return;
  }

  console.log(`Daily Edge Data Health Repair — ${args.sport} ${args.date}`);
  console.log(`Apply: ${args.apply ? "yes" : "no (dry-run)"}`);
  console.log(`Before: blocking/high=${before.unresolvedBlockingOrHigh} safe=${before.safeForNormalReaderDisplay ? "yes" : "no"}`);
  console.log(`Eligible games: ${repair.eligibleGames}`);
  console.log(`Repaired games: ${repair.repairedGames}`);
  console.log(`Still unhealthy games: ${repair.stillUnhealthyGames}`);
  console.log(`Records updated: ${repair.recordsUpdated} · API calls: ${repair.apiCallsMade}`);
  console.log(JSON.stringify({
    skipped: repair.skipped,
    steps: repair.steps,
    attempts: repair.attempts,
    postRepairHealth: repair.postRepairHealth,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
