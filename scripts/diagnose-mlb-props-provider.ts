import { diagnoseSharpApiMlbPropsAvailability } from "../lib/mlb/props/sharpApiAvailabilityDiagnostics";
import { diagnoseBallDontLieMlbPropsAvailability } from "../lib/mlb/props/ballDontLiePropsDiagnostics";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

async function main() {
  const args = parseArgs();
  if (args.provider === "balldontlie") {
    const report = await diagnoseBallDontLieMlbPropsAvailability({
      date: args.date,
      deep: args.deep,
      maxPages: args.maxPages,
    });
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (args.provider === "all") {
    const sharpapi = await diagnoseSharpApiMlbPropsAvailability({
      date: args.date,
      discoverMarkets: args.discoverMarkets,
      sweep: args.sweep,
      deep: args.deep,
      maxEvents: args.maxEvents,
      maxPages: args.maxPages,
      maxMarkets: args.maxMarkets,
    });
    const balldontlie = await diagnoseBallDontLieMlbPropsAvailability({
      date: args.date,
      deep: args.deep,
      maxPages: args.maxPages,
    });
    console.log(JSON.stringify({
      date: args.date,
      providers: { sharpapi, balldontlie },
      writesToSupabase: false,
    }, null, 2));
    return;
  }
  if (args.provider !== "sharpapi") {
    throw new Error(`Unsupported MLB props provider diagnostic: ${args.provider}`);
  }
  const report = await diagnoseSharpApiMlbPropsAvailability({
    date: args.date,
    discoverMarkets: args.discoverMarkets,
    sweep: args.sweep,
    deep: args.deep,
    maxEvents: args.maxEvents,
    maxPages: args.maxPages,
    maxMarkets: args.maxMarkets,
  });
  const productProofPath = await writeSharpApiProductProof(report);
  console.log(JSON.stringify({
    provider: report.provider,
    date: report.date,
    sweep: report.sweep,
    deep: report.deepDiscovery !== null,
    datesTested: report.datesTested,
    outputPath: report.outputPath,
    productProofPath,
    eventCount: report.eventCount,
    eventsFoundByDate: report.eventsFoundByDate,
    eventIdsTested: report.eventIdsTested,
    marketsFromEvents: report.marketsFromEvents,
    marketsTested: report.marketsTested,
    eventSummaries: report.eventSummaries,
    endpointVariantProbes: report.endpointVariantProbes,
    deepDiscovery: report.deepDiscovery,
    summary: report.summary,
    supportSummary: report.supportSummary,
    writesToSupabase: report.writesToSupabase,
  }, null, 2));
}

async function writeSharpApiProductProof(report: Awaited<ReturnType<typeof diagnoseSharpApiMlbPropsAvailability>>): Promise<string> {
  const outputDir = path.join(process.cwd(), "tmp/mlb-props/reports");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${report.date}-sharpapi-product-proof.json`);
  await writeFile(outputPath, JSON.stringify({
    provider: "sharpapi",
    date: report.date,
    generatedAt: new Date().toISOString(),
    writesToSupabase: false,
    endpointsTested: [
      ...report.supportSummary.endpointVariantsTested.map((row) => row.variant),
      ...(report.deepDiscovery ? [
        ...report.deepDiscovery.referenceEndpoints,
        ...report.deepDiscovery.eventsByFilterVariant,
        ...report.deepDiscovery.eventDetailProbes,
        ...report.deepDiscovery.eventMarketProbes,
        ...report.deepDiscovery.eventOddsProbes,
        ...report.deepDiscovery.globalOddsProbes,
        ...report.deepDiscovery.bestOddsProbes,
        ...report.deepDiscovery.comparisonOddsProbes,
        ...report.deepDiscovery.batchOddsProbes,
        ...report.deepDiscovery.paginationProbes,
      ].map((row) => row.label) : []),
    ],
    eventCount: report.eventCount,
    unfilteredEventOddsRowCount: report.deepDiscovery?.endpointComparison.eventOddsRows ?? null,
    marketRowCount: report.supportSummary.rowCounts.total,
    playerPropLikeRowCount: report.supportSummary.rowCounts.total,
    marketsDiscovered: report.deepDiscovery?.marketDiscovery.map((row) => row.normalizedMarket) ?? report.marketsFromEvents,
    marketsTested: report.marketsTested,
    booksDiscovered: report.summary.booksFound,
    hardRockAvailability: report.summary.hardRockFound,
    exactReasonIfNoPlayerPropsFound: report.summary.blockerReason,
    providerAvailabilityStatus: report.summary.providerAvailabilityStatus,
    selectedOperationalFallback: report.summary.providerAvailabilityStatus === "available" ? "sharpapi" : "balldontlie",
  }, null, 2));
  return outputPath;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback: string) => {
    const prefix = `--${name}=`;
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
  };
  const maxEventsRaw = get("max-events", "");
  const maxPagesRaw = get("max-pages", "");
  const maxMarketsRaw = get("max-markets", "");
  const maxEvents = maxEventsRaw ? Number(maxEventsRaw) : undefined;
  const maxPages = maxPagesRaw ? Number(maxPagesRaw) : undefined;
  const maxMarkets = maxMarketsRaw ? Number(maxMarketsRaw) : undefined;
  return {
    date: get("date", new Date().toISOString().slice(0, 10)),
    provider: get("provider", "sharpapi").toLowerCase(),
    discoverMarkets: argv.includes("--discover-markets") || get("discover-markets", "false") === "true",
    sweep: argv.includes("--sweep") || get("sweep", "false") === "true",
    deep: argv.includes("--deep") || get("deep", "false") === "true",
    maxEvents: Number.isFinite(maxEvents) && maxEvents ? maxEvents : undefined,
    maxPages: Number.isFinite(maxPages) && maxPages ? maxPages : undefined,
    maxMarkets: Number.isFinite(maxMarkets) && maxMarkets ? maxMarkets : undefined,
  };
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
