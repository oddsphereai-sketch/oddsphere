import type { Sport } from "@/lib/types/domain/Sport";
import {
  buildAiAuditorCostPreviewFromDailyEdge,
  parseAiAuditorMarkets,
  type AiAuditorCostPreviewSummary,
} from "@/lib/services/aiAuditor/costPreview";

type Args = {
  sport: Sport;
  from: string;
  to: string;
  markets: string;
  refreshes: number;
  scenario: "slate" | "peaks";
  json: boolean;
};

const VALID_SPORTS = new Set(["mlb", "nba", "nfl", "cbb", "cfb", "nhl", "ucl", "soccer", "wnba"]);
const ACTIVE_PREVIEW_SPORTS: Sport[] = ["mlb", "wnba", "soccer"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sport: "mlb",
    from: todayIso(),
    to: todayIso(),
    markets: "ML,TOTAL,FI",
    refreshes: 8,
    scenario: "slate",
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
    if (key === "sport") {
      const sport = value.toLowerCase();
      if (!VALID_SPORTS.has(sport)) throw new Error(`Unsupported sport: ${value}`);
      out.sport = sport as Sport;
    } else if (key === "from") {
      out.from = value;
    } else if (key === "to") {
      out.to = value;
    } else if (key === "markets") {
      out.markets = value;
    } else if (key === "refreshes") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Invalid --refreshes=${value}`);
      out.refreshes = Math.ceil(parsed);
    } else if (key === "scenario") {
      if (value !== "slate" && value !== "peaks") throw new Error(`Invalid --scenario=${value}`);
      out.scenario = value;
    }
  }
  return out;
}

function money(value: number): string {
  return `$${value.toFixed(4)}`;
}

function printSummary(summary: AiAuditorCostPreviewSummary): void {
  const escalationRows = Object.keys(summary.estimatedMiniEscalationCalls)
    .map((key) => {
      const miniCalls = summary.estimatedMiniEscalationCalls[key] ?? 0;
      const totalCost = summary.estimatedTotalCostUsd[key] ?? summary.estimatedNanoCostUsd;
      return `  ${key}: ${miniCalls} mini calls, total ${money(totalCost)}`;
    })
    .join("\n");

  console.log(`AI Auditor Cost Preview (${summary.sport.toUpperCase()} ${summary.from} → ${summary.to})`);
  console.log("No OpenAI calls were made.");
  console.log("");
  console.log(`Base game cards: ${summary.auditOpportunities.baseGameCards}`);
  console.log(`Refreshes requested: ${summary.auditOpportunities.refreshesRequested}`);
  console.log(`Hourly audit opportunities: ${summary.auditOpportunities.hourlyAuditOpportunities}`);
  console.log(`Lock audits: ${summary.auditOpportunities.lockAudits}`);
  console.log(`Total audit opportunities: ${summary.auditOpportunities.totalAuditOpportunities}`);
  if (summary.auditOpportunities.note) console.log(`Historical change note: ${summary.auditOpportunities.note}`);
  console.log("");
  console.log(`Game-card payloads built: ${summary.gameCardPayloadsBuilt}`);
  console.log(`Expected calls after cache/change assumptions: ${summary.estimatedAiCalls}`);
  console.log(`Estimated cache skips: ${summary.estimatedCacheSkips}`);
  console.log(`Estimated nano calls: ${summary.estimatedNanoCalls}`);
  console.log(`Estimated input tokens: ${summary.estimatedInputTokens}`);
  console.log(`Estimated output tokens: ${summary.estimatedOutputTokens}`);
  console.log("");
  console.log("Cost scenarios:");
  console.log(`  One pass: ${money(summary.costScenarios.onePassCostUsd)}`);
  console.log(`  ${summary.auditOpportunities.refreshesRequested}-refresh hourly worst case: ${money(summary.costScenarios.hourlyRefreshWorstCaseCostUsd)}`);
  console.log(`  Hourly + lock worst case: ${money(summary.costScenarios.hourlyPlusLockWorstCaseCostUsd)}`);
  console.log(`  Changed-only/cache-adjusted: ${money(summary.costScenarios.changedOnlyCacheAdjustedCostUsd)}`);
  console.log(`  Realistic changed-only: ${money(summary.costScenarios.realisticChangedOnlyCostUsd)}`);
  console.log(`  Messy 10% mini escalation: ${money(summary.costScenarios.messy10PctMiniEscalationUsd)}`);
  console.log(`  Messy 20% mini escalation: ${money(summary.costScenarios.messy20PctMiniEscalationUsd)}`);
  console.log(`  Conservative ${summary.conservativeCostScenarios.multiplier}x hourly + lock: ${money(summary.conservativeCostScenarios.hourlyPlusLockWorstCaseCostUsd)}`);
  console.log(`  Conservative ${summary.conservativeCostScenarios.multiplier}x messy 10%: ${money(summary.conservativeCostScenarios.messy10PctMiniEscalationUsd)}`);
  console.log("Mini escalation assumptions:");
  console.log(escalationRows.length > 0 ? escalationRows : "  none");
  console.log("Escalation router:");
  console.log(`  estimated mini calls: ${summary.escalationRouter.estimatedMiniCalls}`);
  console.log(`  mini escalation rate: ${(summary.escalationRouter.miniEscalationRate * 100).toFixed(1)}%`);
  console.log(`  max configured rate: ${(summary.escalationRouter.maxMiniEscalationRate * 100).toFixed(1)}%`);
  console.log(`  exceeds max: ${summary.escalationRouter.exceedsConfiguredMax ? "yes" : "no"}`);
  console.log(`  total with router: ${money(summary.escalationRouter.estimatedTotalCostWithRouterUsd)}`);
  console.log(`  conservative with router: ${money(summary.escalationRouter.conservativeTotalCostWithRouterUsd)}`);
  console.log("  triggers:");
  for (const [trigger, count] of Object.entries(summary.escalationRouter.triggersByCategory)) {
    console.log(`    ${trigger}: ${count}`);
  }
  console.log("");
  console.log("Daily projections:");
  console.log(`  Best case changed-only: ${money(summary.costScenarios.dailyBestCaseChangedOnlyUsd)}`);
  console.log(`  Realistic hourly changes: ${money(summary.costScenarios.dailyRealisticHourlyChangesUsd)}`);
  console.log(`  Messy 10% mini: ${money(summary.costScenarios.dailyMessy10PctMiniEscalationUsd)}`);
  console.log(`  Bad case no cache hourly + lock: ${money(summary.costScenarios.dailyBadCaseNoCacheUsd)}`);
  console.log("");
  console.log("Projected monthly cost:");
  console.log(`  Best case with cache skips: ${money(summary.projectedMonthlyCostUsd.bestCaseWithCacheSkips)}`);
  console.log(`  Realistic historical payload changes: ${money(summary.projectedMonthlyCostUsd.realisticCaseFromHistoricalPayloads)}`);
  console.log(`  Realistic hourly changes on most cards: ${money(summary.projectedMonthlyCostUsd.realisticHourlyChangesOnMostCards)}`);
  console.log(`  Messy case 10% mini escalation: ${money(summary.projectedMonthlyCostUsd.messyCase10PctMiniEscalation)}`);
  console.log(`  Worst case every refresh: ${money(summary.projectedMonthlyCostUsd.worstCaseEveryHourlyRefresh)}`);
  console.log(`  Bad case no cache hourly + lock: ${money(summary.projectedMonthlyCostUsd.badCaseNoCacheHourlyPlusLock)}`);
  console.log(`  Conservative ${summary.conservativeCostScenarios.multiplier}x monthly realistic hourly: ${money(summary.conservativeCostScenarios.projectedMonthlyRealisticHourlyChangesUsd)}`);
  console.log(`  Conservative ${summary.conservativeCostScenarios.multiplier}x monthly bad case: ${money(summary.conservativeCostScenarios.projectedMonthlyBadCaseNoCacheUsd)}`);
  console.log("");
  console.log("Budget modes:");
  for (const [scenario, mode] of Object.entries(summary.budgetModeByScenario)) {
    console.log(`  ${scenario}: ${mode}`);
  }
  console.log("");
  console.log("Peak slate assumptions:");
  for (const row of summary.projectedPeakSlateCostUsd) {
    const label = row.synthetic ? `${row.label} (synthetic)` : row.label;
    console.log(`  ${label}: ${row.assumedGameCards} cards, ${row.hourlyAuditOpportunities} hourly + ${row.lockAudits} lock = ${row.totalAuditOpportunities} ops, ${money(row.estimatedHourlyPlusLockCostUsd)} (${summary.pricing.conservativeMultiplier}x ${money(row.conservativeHourlyPlusLockCostUsd)})`);
  }
  console.log("");
  console.log("Highest-cost dates:");
  for (const row of summary.highestCostDates) {
    console.log(`  ${row.date}: ${row.gameCards} cards, ${money(row.estimatedCostUsd)}`);
  }
  console.log("");
  console.log("Cost by market/card type:");
  for (const [market, cost] of Object.entries(summary.costByMarketCardType)) {
    console.log(`  ${market}: ${money(cost)}`);
  }
  console.log("");
  console.log("Pricing assumptions:");
  console.log(`  mode: ${summary.pricing.pricingMode}`);
  console.log(`  ${summary.pricing.nanoModel}: input $${summary.pricing.nanoInputUsdPerMillion}/1M, output $${summary.pricing.nanoOutputUsdPerMillion}/1M`);
  console.log(`  ${summary.pricing.miniModel}: input $${summary.pricing.miniInputUsdPerMillion}/1M, output $${summary.pricing.miniOutputUsdPerMillion}/1M`);
  console.log(`  conservative multiplier: ${summary.pricing.conservativeMultiplier}x`);
}

async function buildSummary(args: Args, sport: Sport, from: string, to: string): Promise<AiAuditorCostPreviewSummary> {
  return await buildAiAuditorCostPreviewFromDailyEdge({
    sport,
    from,
    to,
    markets: parseAiAuditorMarkets(args.markets),
    refreshesPerDay: args.refreshes,
  });
}

function printPeakRollup(rows: Array<{ label: string; summary: AiAuditorCostPreviewSummary }>): void {
  console.log("AI Auditor Cost Preview Peak Rollup");
  console.log("No OpenAI calls were made.");
  console.log("");
  const active = rows.filter((row) => row.label.includes("current slate"));
  if (active.length > 0) {
    const sum = (pick: (summary: AiAuditorCostPreviewSummary) => number) =>
      active.reduce((total, row) => total + pick(row.summary), 0);
    console.log("Current active sports total:");
    console.log(`  cards: ${sum((s) => s.auditOpportunities.baseGameCards)}`);
    console.log(`  refreshes: ${active[0]?.summary.auditOpportunities.refreshesRequested ?? 0}`);
    console.log(`  hourly opportunities: ${sum((s) => s.auditOpportunities.hourlyAuditOpportunities)}`);
    console.log(`  lock audits: ${sum((s) => s.auditOpportunities.lockAudits)}`);
    console.log(`  total opportunities: ${sum((s) => s.auditOpportunities.totalAuditOpportunities)}`);
    console.log(`  one pass: ${money(sum((s) => s.costScenarios.onePassCostUsd))}`);
    console.log(`  hourly refresh: ${money(sum((s) => s.costScenarios.hourlyRefreshWorstCaseCostUsd))}`);
    console.log(`  hourly + lock: ${money(sum((s) => s.costScenarios.hourlyPlusLockWorstCaseCostUsd))}`);
    console.log(`  changed-only/cache-adjusted: ${money(sum((s) => s.costScenarios.changedOnlyCacheAdjustedCostUsd))}`);
    console.log(`  messy 10% mini: ${money(sum((s) => s.costScenarios.messy10PctMiniEscalationUsd))}`);
    console.log(`  messy 20% mini: ${money(sum((s) => s.costScenarios.messy20PctMiniEscalationUsd))}`);
    console.log("");
  }
  for (const { label, summary } of rows) {
    console.log(`${label}:`);
    console.log(`  cards: ${summary.auditOpportunities.baseGameCards}`);
    console.log(`  refreshes: ${summary.auditOpportunities.refreshesRequested}`);
    console.log(`  hourly opportunities: ${summary.auditOpportunities.hourlyAuditOpportunities}`);
    console.log(`  lock audits: ${summary.auditOpportunities.lockAudits}`);
    console.log(`  total opportunities: ${summary.auditOpportunities.totalAuditOpportunities}`);
    console.log(`  one pass: ${money(summary.costScenarios.onePassCostUsd)}`);
    console.log(`  hourly refresh: ${money(summary.costScenarios.hourlyRefreshWorstCaseCostUsd)}`);
    console.log(`  hourly + lock: ${money(summary.costScenarios.hourlyPlusLockWorstCaseCostUsd)}`);
    console.log(`  conservative ${summary.conservativeCostScenarios.multiplier}x hourly + lock: ${money(summary.conservativeCostScenarios.hourlyPlusLockWorstCaseCostUsd)}`);
    console.log(`  router mini calls: ${summary.escalationRouter.estimatedMiniCalls} (${(summary.escalationRouter.miniEscalationRate * 100).toFixed(1)}%)`);
    console.log(`  router total: ${money(summary.escalationRouter.estimatedTotalCostWithRouterUsd)}`);
    console.log(`  changed-only/cache-adjusted: ${money(summary.costScenarios.changedOnlyCacheAdjustedCostUsd)}`);
    console.log(`  messy 10% mini: ${money(summary.costScenarios.messy10PctMiniEscalationUsd)}`);
    console.log(`  messy 20% mini: ${money(summary.costScenarios.messy20PctMiniEscalationUsd)}`);
  }
}

async function main() {
  if (process.env.AI_AUDITOR_COST_PREVIEW_ONLY !== "true") {
    process.env.AI_AUDITOR_COST_PREVIEW_ONLY = "true";
  }
  const args = parseArgs(process.argv.slice(2));
  const summary = await buildSummary(args, args.sport, args.from, args.to);
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else if (args.scenario === "peaks") {
    const activeRows = await Promise.all(
      ACTIVE_PREVIEW_SPORTS.map(async (sport) => ({
        label: `${sport.toUpperCase()} current slate`,
        summary: sport === args.sport
          ? summary
          : await buildSummary(args, sport, args.from, args.to),
      })),
    );
    printPeakRollup([
      ...activeRows,
      ...summary.projectedPeakSlateCostUsd
        .filter((row) => row.synthetic)
        .map((row) => ({
          label: row.label,
          summary: {
            ...summary,
            auditOpportunities: {
              ...summary.auditOpportunities,
              baseGameCards: row.assumedGameCards,
              hourlyAuditOpportunities: row.hourlyAuditOpportunities,
              lockAudits: row.lockAudits,
              totalAuditOpportunities: row.totalAuditOpportunities,
            },
            costScenarios: {
              ...summary.costScenarios,
              onePassCostUsd: row.estimatedOnePassCostUsd,
              hourlyRefreshWorstCaseCostUsd: row.estimatedHourlyRefreshCostUsd,
              hourlyPlusLockWorstCaseCostUsd: row.estimatedHourlyPlusLockCostUsd,
              changedOnlyCacheAdjustedCostUsd: row.estimatedOnePassCostUsd,
              messy10PctMiniEscalationUsd: row.estimatedMessy10PctMiniEscalationUsd,
              messy20PctMiniEscalationUsd: row.estimatedMessy20PctMiniEscalationUsd,
            },
            conservativeCostScenarios: {
              ...summary.conservativeCostScenarios,
              onePassCostUsd: row.estimatedOnePassCostUsd * summary.conservativeCostScenarios.multiplier,
              hourlyRefreshWorstCaseCostUsd: row.estimatedHourlyRefreshCostUsd * summary.conservativeCostScenarios.multiplier,
              hourlyPlusLockWorstCaseCostUsd: row.conservativeHourlyPlusLockCostUsd,
              changedOnlyCacheAdjustedCostUsd: row.estimatedOnePassCostUsd * summary.conservativeCostScenarios.multiplier,
              messy10PctMiniEscalationUsd: row.estimatedMessy10PctMiniEscalationUsd * summary.conservativeCostScenarios.multiplier,
              messy20PctMiniEscalationUsd: row.estimatedMessy20PctMiniEscalationUsd * summary.conservativeCostScenarios.multiplier,
            },
          },
        })),
    ]);
  } else {
    printSummary(summary);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
