import {
  buildAiAuditorCostPreview,
  buildDailyEdgeResponseForCostPreview,
  estimateCostUsd,
  parseAiAuditorMarkets,
  resolveAiAuditorPricing,
  type AiAuditorCompactMarketPayload,
  type AiAuditorMarketKey,
  type AiAuditorPayloadEstimate,
} from "@/lib/services/aiAuditor/costPreview";
import {
  AI_SHARP_ANALYST_V3_VARIANT,
  buildSharpAnalystMemoryModules,
  buildSharpAnalystV3SystemPrompt,
  buildSharpAnalystV3UserContext,
  loadSharpAnalystResearchPack,
  marketMemoryForPayload,
  sharpAnalystPrinciples,
  type SharpAnalystMarket,
} from "@/lib/services/aiAuditor/sharpAnalystMemory";
import type { Sport } from "@/lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string;
  markets: string;
  packPath: string;
  json: boolean;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sport: "mlb",
    date: todayIso(),
    markets: "ML,TOTAL,FI",
    packPath: "ops-local/ai-sharp-analyst/mlb-sharp-analyst-research-pack.json",
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
    if (key === "date") out.date = value;
    if (key === "markets") out.markets = value;
    if (key === "pack") out.packPath = value;
  }
  return out;
}

function tokenEstimate(value: unknown): number {
  return Math.ceil(Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8") / 4);
}

function forbiddenPayloadLeakage(payload: unknown): string[] {
  const forbiddenKeys = new Set([
    "final_score",
    "finalscore",
    "winner",
    "graded_result",
    "gradedresult",
    "postgame_result",
    "postgameresult",
    "units",
    "roi",
  ]);
  const hits = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (forbiddenKeys.has(normalized)) hits.add(key);
      visit(child);
    }
  };
  visit(payload);
  return Array.from(hits).sort();
}

function hasSharp(section: unknown): boolean {
  const row = section as { rows?: unknown[]; signal?: string | null; label?: string | null } | null;
  return Boolean(row && ((Array.isArray(row.rows) && row.rows.length > 0) || row.signal || row.label));
}

function compactMarketFields(market: AiAuditorCompactMarketPayload) {
  return {
    market: market.market,
    pick: market.pick,
    currentGrade: market.playGrade,
    modelProbabilityPct: market.modelProbabilityPct,
    edgePct: market.modelMarketGapPct,
    marketImpliedProbabilityPct: market.marketProbabilityPct,
    displayPriceAmerican: market.displayPriceAmerican,
    priceSource: market.priceSource,
    lineValue: market.lineValue,
    openLineValue: market.openLineValue,
    currentLineValue: market.currentLineValue,
    marketRead: market.marketRead,
    sourceConflict: market.sourceConflict,
    consensusSplitsPresent: market.consensusSplits !== null,
    sharpBookSplitsOrSignalPresent: hasSharp(market.sharpBookSplits),
    lineMovement: market.lineMovement,
    dataQuality: market.dataQuality,
    deterministicPreScore: market.deterministicPreScore,
    fiContext: market.fiContext,
  };
}

function firstMarketExample(payloads: AiAuditorPayloadEstimate[], market: AiAuditorMarketKey) {
  for (const payload of payloads) {
    const row = payload.payload.markets.find((item) => item.market === market);
    if (row) {
      return {
        game: payload.matchup,
        slateDate: payload.date,
        externalId: payload.externalId,
        fieldsIncluded: compactMarketFields(row),
      };
    }
  }
  return null;
}

function completeness(payloads: AiAuditorPayloadEstimate[]) {
  const out: Record<string, Record<string, string>> = {};
  for (const market of ["moneyline", "total", "first_inning"] as AiAuditorMarketKey[]) {
    const rows = payloads.flatMap((payload) => payload.payload.markets.filter((row) => row.market === market));
    const pct = (n: number) => rows.length === 0 ? "0/0 = n/a" : `${n}/${rows.length} = ${(n / rows.length * 100).toFixed(1)}%`;
    out[market] = {
      rows: String(rows.length),
      price: pct(rows.filter((row) => row.displayPriceAmerican !== null).length),
      modelProbability: pct(rows.filter((row) => row.modelProbabilityPct !== null).length),
      edge: pct(rows.filter((row) => row.modelMarketGapPct !== null).length),
      consensus: pct(rows.filter((row) => row.consensusSplits !== null).length),
      sharp: pct(rows.filter((row) => hasSharp(row.sharpBookSplits)).length),
      lineMovement: pct(rows.filter((row) => row.lineMovement.displayCurrentAmerican !== null || row.lineMovement.openAmerican !== null || row.lineMovement.directionRelativeToPick !== null).length),
      fiContext: market === "first_inning" ? pct(rows.filter((row) => row.fiContext.isFirstInning).length) : "n/a",
    };
  }
  return out;
}

function memoryForMarkets(payload: AiAuditorPayloadEstimate, modules: ReturnType<typeof buildSharpAnalystMemoryModules>) {
  const seen = new Set<SharpAnalystMarket>();
  return payload.payload.markets.flatMap((market) => {
    if (seen.has(market.market)) return [];
    seen.add(market.market);
    return [marketMemoryForPayload(market, modules)];
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const markets = parseAiAuditorMarkets(args.markets);
  const response = await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date: args.date });
  const preview = buildAiAuditorCostPreview({
    sport: args.sport,
    from: args.date,
    to: args.date,
    markets,
    refreshesPerDay: 1,
    miniEscalationRates: [],
    skipUnchangedPayloads: false,
    oneCallPerGameCard: true,
    includePeakSlateAssumptions: false,
    payloadsByDate: [{ date: args.date, response }],
  });
  const pack = loadSharpAnalystResearchPack(args.packPath);
  const modules = buildSharpAnalystMemoryModules(pack);
  const principles = sharpAnalystPrinciples(pack);
  const systemPrompt = buildSharpAnalystV3SystemPrompt();
  const contextPreviews = preview.payloads.slice(0, 3).map((payload) => {
    const userContext = buildSharpAnalystV3UserContext({
      cardPayload: payload.payload,
      marketMemories: memoryForMarkets(payload, modules),
      principles,
    });
    const inputTokens = tokenEstimate(systemPrompt) + tokenEstimate(userContext);
    return {
      game: payload.matchup,
      payloadHash: payload.payloadHash.slice(0, 12),
      markets: payload.markets,
      inputTokens,
      estimatedCostUsd: estimateCostUsd(
        inputTokens,
        1400,
        resolveAiAuditorPricing().nanoInputUsdPerMillion,
        resolveAiAuditorPricing().nanoOutputUsdPerMillion,
      ),
      blindPayloadLeakageTerms: forbiddenPayloadLeakage(payload.payload),
      systemPrompt,
      userContext,
    };
  });
  const allInputTokens = preview.payloads.reduce((sum, payload) => {
    const userContext = buildSharpAnalystV3UserContext({
      cardPayload: payload.payload,
      marketMemories: memoryForMarkets(payload, modules),
      principles,
    });
    return sum + tokenEstimate(systemPrompt) + tokenEstimate(userContext);
  }, 0);
  const pricing = resolveAiAuditorPricing();
  const totalEstimatedCostUsd = estimateCostUsd(
    allInputTokens,
    preview.payloads.length * 1400,
    pricing.nanoInputUsdPerMillion,
    pricing.nanoOutputUsdPerMillion,
  );
  const report = {
    variant: AI_SHARP_ANALYST_V3_VARIANT,
    noOpenAiCalls: true,
    noLiveChanges: true,
    noMemberFacingChanges: true,
    sport: args.sport,
    date: args.date,
    cards: preview.payloads.length,
    markets: preview.payloads.reduce((sum, payload) => sum + payload.marketCount, 0),
    pricing: {
      modelForEstimate: pricing.nanoModel,
      pricingMode: pricing.pricingMode,
      inputUsdPerMillion: pricing.nanoInputUsdPerMillion,
      outputUsdPerMillion: pricing.nanoOutputUsdPerMillion,
    },
    estimatedTokensAndCost: {
      inputTokens: allInputTokens,
      assumedOutputTokensPerCard: 1400,
      estimatedCostUsd: totalEstimatedCostUsd,
      conservative2xUsd: +(totalEstimatedCostUsd * 2).toFixed(6),
    },
    dataCompletenessSeenByPreview: completeness(preview.payloads),
    postgameLeakageCheck: {
      currentPayloadsIncludePostgameData: preview.payloads.some((payload) => forbiddenPayloadLeakage(payload.payload).length > 0),
      blindPayloadLeakageTerms: Array.from(new Set(contextPreviews.flatMap((item) => item.blindPayloadLeakageTerms))),
      note: "Historical memory modules intentionally include aggregate records/units/ROI; the leakage check applies to blind current card payloads only.",
    },
    memoryModules: modules,
    sharpAnalystPrinciples: principles,
    promptContextExamples: contextPreviews,
    exampleCardFieldsByMarket: {
      moneyline: firstMarketExample(preview.payloads, "moneyline"),
      total: firstMarketExample(preview.payloads, "total"),
      first_inning: firstMarketExample(preview.payloads, "first_inning"),
    },
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("AI Sharp Analyst v3 Prompt/Context Preview");
  console.log("No OpenAI calls. No live changes. No member-facing changes.");
  console.log(`variant: ${report.variant}`);
  console.log(`cards=${report.cards} markets=${report.markets}`);
  console.log(`estimated input tokens=${report.estimatedTokensAndCost.inputTokens}`);
  console.log(`estimated cost=${report.estimatedTokensAndCost.estimatedCostUsd.toFixed(4)} conservative2x=${report.estimatedTokensAndCost.conservative2xUsd.toFixed(4)}`);
  console.log("Data completeness:");
  console.log(JSON.stringify(report.dataCompletenessSeenByPreview, null, 2));
  console.log("Postgame leakage check:");
  console.log(JSON.stringify(report.postgameLeakageCheck, null, 2));
  console.log("Memory modules:");
  console.log(JSON.stringify(report.memoryModules, null, 2));
  console.log("Example card fields by market:");
  console.log(JSON.stringify(report.exampleCardFieldsByMarket, null, 2));
  console.log("First prompt context preview:");
  console.log(JSON.stringify(report.promptContextExamples[0] ?? null, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
