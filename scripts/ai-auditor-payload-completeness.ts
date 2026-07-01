import {
  buildAiAuditorCostPreview,
  buildDailyEdgeResponseForCostPreview,
  parseAiAuditorMarkets,
  type AiAuditorCompactMarketPayload,
  type AiAuditorMarketKey,
} from "@/lib/services/aiAuditor/costPreview";
import type { DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";
import {
  buildRehydratedLockedMarketPayload,
  type RehydratedLockedMarketPayload,
  type RehydratedPredictionRecord,
} from "@/lib/services/aiAuditor/rehydratedLockedPayload";

type Args = {
  sport: Sport;
  date: string;
  from: string;
  to: string;
  markets: string;
  json: boolean;
};

type MarketCompleteness = {
  market: AiAuditorMarketKey;
  game: string;
  pick: string | null;
  originalGrade: string | null;
  modelProbabilityPct: number | null;
  edgePct: number | null;
  marketImpliedProbabilityPct: number | null;
  priceAmerican: number | null;
  displayPriceAmerican: number | null;
  priceSource: string;
  priceNullReason: string | null;
  lineValue: number | null;
  openLineValue: number | null;
  currentLineValue: number | null;
  openPriceAmerican: number | null;
  currentPriceAmerican: number | null;
  lockedPriceAmerican: number | null;
  lineMovementDirection: string | null;
  consensusSplitsPresent: boolean;
  sharpBookSplitsOrSignalPresent: boolean;
  sourceConflictPresent: boolean;
  marketReadStatus: string | null;
  dataWarnings: string[];
  fiSpecificFieldsPresent: boolean | null;
  requiredNullReasons: string[];
};

const MARKET_LABEL: Record<AiAuditorMarketKey, string> = {
  moneyline: "ML",
  total: "Total",
  first_inning: "FI",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): Args {
  const today = todayIso();
  const out: Args = {
    sport: "mlb",
    date: today,
    from: "2026-06-06",
    to: today,
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
    if (key === "date") out.date = value;
    if (key === "from") out.from = value;
    if (key === "to") out.to = value;
    if (key === "markets") out.markets = value;
  }
  return out;
}

function pct(n: number, d: number): string {
  return d === 0 ? "0/0 = n/a" : `${n}/${d} = ${(n / d * 100).toFixed(1)}%`;
}

function hasSharp(section: unknown): boolean {
  const row = section as { rows?: unknown[]; signal?: string | null; label?: string | null } | null;
  return Boolean(row && ((Array.isArray(row.rows) && row.rows.length > 0) || row.signal || row.label));
}

function requiredNullReasons(market: AiAuditorMarketKey, ai: AiAuditorCompactMarketPayload): string[] {
  const reasons: string[] = [];
  if (ai.displayPriceAmerican === null) reasons.push(`price:${ai.priceNullReason ?? "unknown"}`);
  if (market !== "moneyline" && ai.lineValue === null) reasons.push(`line:${ai.lineValueNullReason ?? "unknown"}`);
  if (ai.marketProbabilityPct === null) reasons.push("market_implied_probability:null");
  if (ai.modelMarketGapPct === null) reasons.push("edge:null");
  if (market === "first_inning" && ai.fiContext.expectedRunsAvailable === false) reasons.push("fi_expected_runs:not_found_in_key_stats");
  return reasons;
}

function currentRows(response: DailyEdgeResponse, markets: AiAuditorMarketKey[]): MarketCompleteness[] {
  const preview = buildAiAuditorCostPreview({
    sport: response.sport,
    from: response.date,
    to: response.date,
    markets,
    refreshesPerDay: 1,
    miniEscalationRates: [],
    skipUnchangedPayloads: false,
    oneCallPerGameCard: true,
    includePeakSlateAssumptions: false,
    payloadsByDate: [{ date: response.date, response }],
  });
  const byGame = new Map(response.games.map((game) => [game.id, game]));
  const rows: MarketCompleteness[] = [];
  for (const payload of preview.payloads) {
    const game = byGame.get(payload.gameId);
    for (const ai of payload.payload.markets) {
      const dto: MarketEdgeDto | undefined = game?.markets[ai.market];
      rows.push({
        market: ai.market,
        game: payload.matchup,
        pick: ai.pick,
        originalGrade: ai.playGrade,
        modelProbabilityPct: ai.modelProbabilityPct,
        edgePct: ai.modelMarketGapPct,
        marketImpliedProbabilityPct: ai.marketProbabilityPct,
        priceAmerican: ai.priceAmerican,
        displayPriceAmerican: ai.displayPriceAmerican,
        priceSource: ai.priceSource,
        priceNullReason: ai.priceNullReason,
        lineValue: ai.lineValue,
        openLineValue: ai.openLineValue,
        currentLineValue: ai.currentLineValue,
        openPriceAmerican: ai.lineMovement.openAmerican ?? dto?.marketReadV2?.movement?.firstTrackedPrice ?? null,
        currentPriceAmerican: ai.lineMovement.displayCurrentAmerican,
        lockedPriceAmerican: ai.lineMovement.lockedAmerican,
        lineMovementDirection: ai.lineMovement.directionRelativeToPick,
        consensusSplitsPresent: ai.consensusSplits !== null,
        sharpBookSplitsOrSignalPresent: hasSharp(ai.sharpBookSplits),
        sourceConflictPresent: ai.sourceConflict === true,
        marketReadStatus: ai.marketRead?.status ?? null,
        dataWarnings: ai.dataQuality.reviewFlags,
        fiSpecificFieldsPresent: ai.market === "first_inning" ? ai.fiContext.expectedRunsAvailable === true || ai.modelProbabilityPct !== null : null,
        requiredNullReasons: requiredNullReasons(ai.market, ai),
      });
    }
  }
  return rows;
}

function summarizeCompleteness(rows: MarketCompleteness[]) {
  const out: Record<string, Record<string, string>> = {};
  for (const market of ["moneyline", "total", "first_inning"] as AiAuditorMarketKey[]) {
    const r = rows.filter((row) => row.market === market);
    out[MARKET_LABEL[market]] = {
      rows: String(r.length),
      displayPrice: pct(r.filter((row) => row.displayPriceAmerican !== null).length, r.length),
      rawPrice: pct(r.filter((row) => row.priceAmerican !== null).length, r.length),
      marketImplied: pct(r.filter((row) => row.marketImpliedProbabilityPct !== null).length, r.length),
      edge: pct(r.filter((row) => row.edgePct !== null).length, r.length),
      lineValue: pct(r.filter((row) => row.lineValue !== null).length, r.length),
      lineMovement: pct(r.filter((row) => row.lineMovementDirection !== null || row.openPriceAmerican !== null || row.currentPriceAmerican !== null).length, r.length),
      consensusSplits: pct(r.filter((row) => row.consensusSplitsPresent).length, r.length),
      sharpBookSplitsOrSignal: pct(r.filter((row) => row.sharpBookSplitsOrSignalPresent).length, r.length),
      marketRead: pct(r.filter((row) => row.marketReadStatus !== null).length, r.length),
      fiUsableFields: market === "first_inning" ? pct(r.filter((row) => row.fiSpecificFieldsPresent).length, r.length) : "n/a",
    };
  }
  return out;
}

async function lockedAudit(args: Args) {
  const { supabase } = await import("@/lib/db/supabase");
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id,game_prediction_id,game_id,external_id,sport,slate_date,game_date,matchup,market,pick,side,line_value,odds_american,model_probability,market_probability,edge,play_grade,confidence,locked_at,snapshot_json,prediction_grades(result),game_predictions(locked_at)")
    .eq("sport", args.sport)
    .gte("slate_date", args.from)
    .lte("slate_date", args.to)
    .in("market", ["moneyline", "total", "first_inning"])
    .limit(10000);
  if (error) throw new Error(`prediction_records locked audit failed: ${error.message}`);
  const rows = ((data ?? []) as Array<RehydratedPredictionRecord & {
    game_predictions?: { locked_at: string | null } | Array<{ locked_at: string | null }> | null;
  }>).map((row) => {
    const gp = Array.isArray(row.game_predictions) ? row.game_predictions[0] : row.game_predictions;
    return {
      ...row,
      locked_at: row.locked_at ?? gp?.locked_at ?? null,
    };
  }).filter((row) => row.locked_at !== null) as RehydratedPredictionRecord[];
  const payloads = rows.map(buildRehydratedLockedMarketPayload);
  const byMarket: Record<string, Record<string, string>> = {};
  for (const market of ["moneyline", "total", "first_inning"] as AiAuditorMarketKey[]) {
    const p = payloads.filter((row) => row.market === market);
    const marketRows = rows.filter((row) => row.market === market);
    const withResult = marketRows.filter((row) => {
      const grade = Array.isArray(row.prediction_grades) ? row.prediction_grades[0] : row.prediction_grades;
      return Boolean(grade?.result && grade.result !== "pending");
    });
    byMarket[MARKET_LABEL[market]] = {
      lockedRows: String(p.length),
      priceOdds: pct(p.filter((row) => row.displayPriceAmerican !== null).length, p.length),
      marketImpliedProbability: pct(p.filter((row) => row.marketImpliedProbabilityPct !== null).length, p.length),
      edge: pct(p.filter((row) => row.edgePct !== null).length, p.length),
      lineMovement: pct(p.filter((row) => row.lineMovementDirection !== null || row.openPriceAmerican !== null || row.currentPriceAmerican !== null).length, p.length),
      consensusSplits: pct(p.filter((row) => row.consensusSplits.available).length, p.length),
      sharpBookSplitsOrSignal: pct(p.filter((row) => row.sharpBookSplitsOrSignal.available).length, p.length),
      persistedMarketRead: pct(p.filter((row) => row.sourceAvailability.historicalMarketReadPersisted).length, p.length),
      reconstructedMarketRead: pct(p.filter((row) => row.sourceAvailability.historicalMarketReadReconstructed).length, p.length),
      marketReadUsableOrLabeled: pct(p.filter((row) => row.marketRead.status !== "historical_market_read_not_persisted" || row.sourceAvailability.historicalMarketReadMissingReason === "historical_market_read_not_persisted").length, p.length),
      fiUsableFields: market === "first_inning"
        ? pct(p.filter((row) => row.fiContext.oddsAvailable && row.fiContext.marketProbabilityAvailable && row.edgePct !== null).length, p.length)
        : "n/a",
      postgameResults: pct(withResult.length, p.length),
      unitsRoi: "0 direct columns; reconstruct from result + odds_american where result joined",
    };
  }
  const samplePayloads = payloads.slice(0, 5);
  return {
    totalLockedGameCards: new Set(rows.map((row) => row.game_id)).size,
    totalMarketRows: rows.length,
    resultJoinRate: pct(rows.filter((row) => {
      const grade = Array.isArray(row.prediction_grades) ? row.prediction_grades[0] : row.prediction_grades;
      return Boolean(grade?.result && grade.result !== "pending");
    }).length, rows.length),
    byMarket,
    samplePayloads,
    rehydrationSources: {
      prediction_records: "primary locked pick, market, odds_american, line_value, model_probability, market_probability, edge, play_grade, locked_at, snapshot_json",
      prediction_grades: "postgame result only; must join after blind payload is logged",
      snapshot_json: "candidate source for lock-time signal rows, line movement, FI audit fields, and writer metadata when columns are sparse",
      line_history: "candidate source for open/current/lock odds trail at or before locked_at",
      sharp_signals_history: "candidate source for stale-safe consensus/source split rehydration at or before locked_at",
      market_intelligence_snapshots: "candidate source for canonical Market Read if generated for historical lock time",
      dailyEdgeApiSnapshots: "not currently identified as a durable table in this pass; route can reconstruct some DTOs date-by-date from current DB state",
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const markets = parseAiAuditorMarkets(args.markets);
  const response = await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date: args.date });
  const rows = currentRows(response, markets);
  const currentSummary = summarizeCompleteness(rows);
  const locked = await lockedAudit(args);
  const report = {
    noOpenAiCalls: true,
    noLiveChanges: true,
    current: {
      sport: args.sport,
      date: args.date,
      rows,
      completenessByMarket: currentSummary,
      labelFix: "Grade distribution and Market Read distribution are reported separately in market analyst output after this pass.",
    },
    lockedRange: {
      sport: args.sport,
      from: args.from,
      to: args.to,
      ...locked,
    },
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("AI Auditor Payload Completeness Audit");
  console.log("No OpenAI calls. No live changes. No member-facing changes.");
  console.log(`Current ${args.sport.toUpperCase()} ${args.date}`);
  console.log(JSON.stringify(currentSummary, null, 2));
  console.log("Current market rows with null reasons:");
  for (const row of rows) {
    console.log(`${row.game} ${MARKET_LABEL[row.market]} pick=${row.pick ?? "—"} grade=${row.originalGrade ?? "—"} model=${row.modelProbabilityPct ?? "—"} market=${row.marketImpliedProbabilityPct ?? "—"} edge=${row.edgePct ?? "—"} price=${row.displayPriceAmerican ?? "—"} priceSource=${row.priceSource} line=${row.lineValue ?? "—"} read=${row.marketReadStatus ?? "—"} consensus=${row.consensusSplitsPresent} sharp=${row.sharpBookSplitsOrSignalPresent} conflict=${row.sourceConflictPresent} nulls=${row.requiredNullReasons.join("|") || "none"}`);
  }
  console.log(`Locked ${args.sport.toUpperCase()} ${args.from}..${args.to}`);
  console.log(JSON.stringify({
    totalLockedGameCards: locked.totalLockedGameCards,
    totalMarketRows: locked.totalMarketRows,
    resultJoinRate: locked.resultJoinRate,
    byMarket: locked.byMarket,
    rehydrationSources: locked.rehydrationSources,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
