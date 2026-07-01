import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import {
  buildAiAuditorCostPreview,
  buildDailyEdgeResponseForCostPreview,
  eachDateInclusive,
  parseAiAuditorMarkets,
  type AiAuditorPayloadEstimate,
} from "@/lib/services/aiAuditor/costPreview";
import type { Sport } from "@/lib/types/domain/Sport";

type Market = "moneyline" | "total" | "first_inning";
type Grade = "No Play" | "Caution" | "Watchlist" | "Lean" | "Best Angle";

type Args = {
  sport: Sport;
  from: string;
  to: string;
  markets: string;
  v2RunId: string | null;
  json: boolean;
};

type ResultRow = {
  result: string;
  units: number;
  oddsAmerican: number | null;
  originalPlayGrade: string | null;
};

const GRADES: Grade[] = ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"];
const MARKETS: Market[] = ["moneyline", "total", "first_inning"];

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sport: "mlb",
    from: "2026-06-22",
    to: "2026-06-28",
    markets: "ML,TOTAL,FI",
    v2RunId: null,
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
    else if (key === "from") out.from = value;
    else if (key === "to") out.to = value;
    else if (key === "markets") out.markets = value;
    else if (key === "v2-run-id") out.v2RunId = value.trim() || null;
  }
  return out;
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => Number.isFinite(value));
  if (nums.length === 0) return null;
  return +(nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(4);
}

function inc(map: Record<string, number>, key: string | null | undefined): void {
  map[key ?? "unknown"] = (map[key ?? "unknown"] ?? 0) + 1;
}

function resultKey(externalId: number, market: Market): string {
  return `${externalId}:${market}`;
}

function americanUnits(odds: number | null, result: string | null | undefined): number {
  if (result === "loss") return -1;
  if (result !== "win") return 0;
  if (odds === null || odds === 0) return 0;
  return odds > 0 ? +(odds / 100).toFixed(4) : +(100 / Math.abs(odds)).toFixed(4);
}

function gradeRecord() {
  return { count: 0, wins: 0, losses: 0, pushes: 0, voids: 0, pending: 0, unknown: 0, units: 0, winRate: null as number | null };
}

function addOutcome(row: ReturnType<typeof gradeRecord>, result: string, units: number): void {
  row.count += 1;
  if (result === "win") row.wins += 1;
  else if (result === "loss") row.losses += 1;
  else if (result === "push") row.pushes += 1;
  else if (result === "void") row.voids += 1;
  else if (result === "pending") row.pending += 1;
  else row.unknown += 1;
  row.units = +(row.units + units).toFixed(4);
  const settled = row.wins + row.losses;
  row.winRate = settled > 0 ? +(row.wins / settled).toFixed(4) : null;
}

async function loadPostgameResults(args: { sport: Sport; from: string; to: string; payloads: AiAuditorPayloadEstimate[] }) {
  const { supabase } = await import("@/lib/db/supabase");
  const externalIds = Array.from(new Set(args.payloads.map((payload) => payload.externalId)));
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, external_id")
    .eq("sport", args.sport)
    .in("external_id", externalIds);
  if (gamesError) throw new Error(gamesError.message);
  const internalToExternal = new Map<number, number>();
  for (const game of (games ?? []) as Array<{ id: number; external_id: number }>) {
    internalToExternal.set(game.id, game.external_id);
  }
  const internalIds = Array.from(internalToExternal.keys());
  const { data: records, error } = await supabase
    .from("prediction_records")
    .select("game_id,market,odds_american,play_grade,prediction_grades(result)")
    .eq("sport", args.sport)
    .gte("slate_date", args.from)
    .lte("slate_date", args.to)
    .in("game_id", internalIds)
    .in("market", MARKETS);
  if (error) throw new Error(error.message);
  const out = new Map<string, ResultRow>();
  for (const record of (records ?? []) as Array<{
    game_id: number;
    market: Market;
    odds_american: number | null;
    play_grade: string | null;
    prediction_grades: { result: string | null } | Array<{ result: string | null }> | null;
  }>) {
    const externalId = internalToExternal.get(record.game_id);
    if (externalId === undefined) continue;
    const grade = Array.isArray(record.prediction_grades) ? record.prediction_grades[0] ?? null : record.prediction_grades;
    const result = grade?.result ?? "unknown";
    out.set(resultKey(externalId, record.market), {
      result,
      units: americanUnits(record.odds_american, result),
      oddsAmerican: record.odds_american,
      originalPlayGrade: record.play_grade,
    });
  }
  return out;
}

async function loadLatestV2RunId(): Promise<string | null> {
  const { supabase } = await import("@/lib/db/supabase");
  const { data, error } = await supabase
    .from("ai_audit_evaluation_results")
    .select("run_id, created_at")
    .eq("variant", "ai_v2_betting_value")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0]?.run_id ?? null;
}

async function loadV2Rows(runId: string | null) {
  if (!runId) return [];
  const { supabase } = await import("@/lib/db/supabase");
  const { data, error } = await supabase
    .from("ai_audit_evaluation_results")
    .select("*")
    .eq("run_id", runId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function splitKey(market: Market, pick: string | null, price: number | null): string {
  if (market === "moneyline") return price !== null && price < 0 ? "favorite" : "dog";
  if (market === "total") return /under/i.test(pick ?? "") ? "under" : /over/i.test(pick ?? "") ? "over" : "unknown";
  if (market === "first_inning") return /nrfi/i.test(pick ?? "") ? "nrfi" : /yrfi/i.test(pick ?? "") ? "yrfi" : "unknown";
  return "unknown";
}

function lineDirection(open: number | null, current: number | null): string {
  if (open === null || current === null) return "unknown";
  const delta = current - open;
  if (Math.abs(delta) < 8) return "flat";
  return delta > 0 ? "toward_plus_price" : "toward_more_juice";
}

function hasSharp(value: unknown): boolean {
  const sharp = value as { rows?: unknown[]; signal?: string | null; label?: string | null } | null;
  return Boolean(sharp && (sharp.signal || sharp.label || (Array.isArray(sharp.rows) && sharp.rows.length > 0)));
}

function summarizeOriginal(payloads: AiAuditorPayloadEstimate[], results: Map<string, ResultRow>) {
  const byMarket: Record<string, Record<string, unknown>> = {};
  for (const market of MARKETS) {
    byMarket[market] = {};
    for (const grade of GRADES) {
      const rows = payloads.flatMap((payload) => {
        const row = payload.payload.markets.find((item) => item.market === market && item.playGrade === grade);
        return row ? [{ payload, row }] : [];
      });
      const record = gradeRecord();
      const marketReadDistribution: Record<string, number> = {};
      const lineMovementDistribution: Record<string, number> = {};
      const splitDistribution: Record<string, number> = {};
      const sourceFlags: Record<string, number> = {};
      const splitByPick: Record<string, number> = {};
      for (const { payload, row } of rows) {
        const result = results.get(resultKey(payload.externalId, market));
        addOutcome(record, result?.result ?? "unknown", result?.units ?? 0);
        inc(marketReadDistribution, row.marketRead?.status);
        inc(lineMovementDistribution, lineDirection(row.lineMovement.openAmerican, row.lineMovement.currentAmerican));
        inc(splitDistribution, splitKey(market, row.pick, row.priceAmerican));
        inc(sourceFlags, row.consensusSplits ? "consensus" : "no_consensus");
        inc(sourceFlags, hasSharp(row.sharpBookSplits) ? "sharp" : "no_sharp");
        inc(sourceFlags, row.sourceConflict ? "source_conflict" : "no_source_conflict");
        inc(sourceFlags, /resistance/.test(row.marketRead?.status ?? "") ? "market_resistance" : "no_market_resistance");
        inc(sourceFlags, row.dataQuality.reviewFlags.length > 0 ? "data_flags" : "no_data_flags");
        inc(splitByPick, row.pick);
      }
      byMarket[market][grade] = {
        ...record,
        avgModelEdge: avg(rows.map(({ row }) => row.modelMarketGapPct)),
        avgModelProbability: avg(rows.map(({ row }) => row.modelProbabilityPct)),
        avgConfidence: null,
        avgPrice: avg(rows.map(({ row }) => row.priceAmerican)),
        pickSplit: splitDistribution,
        marketReadDistribution,
        lineMovementDistribution,
        sourceAvailability: sourceFlags,
        pickDistribution: splitByPick,
      };
    }
  }
  return byMarket;
}

function summarizeBestAngleLosses(payloads: AiAuditorPayloadEstimate[], results: Map<string, ResultRow>, v2Rows: Array<Record<string, unknown>>) {
  const out = [];
  for (const payload of payloads) {
    for (const row of payload.payload.markets) {
      if (row.playGrade !== "Best Angle") continue;
      const result = results.get(resultKey(payload.externalId, row.market));
      if (result?.result !== "loss") continue;
      const v2 = v2Rows.find((item) =>
        String(item.slate_date) === payload.date &&
        Number(item.external_id) === payload.externalId &&
        item.market === row.market
      );
      out.push({
        game: `${payload.date} ${payload.matchup}`,
        market: row.market,
        pick: row.pick,
        odds: row.priceAmerican,
        modelProbability: row.modelProbabilityPct,
        edge: row.modelMarketGapPct,
        marketImplied: row.marketProbabilityPct,
        marketRead: row.marketRead?.status ?? null,
        lineMovement: row.lineMovement,
        consensusSplitAvailable: Boolean(row.consensusSplits),
        sharpBookAvailable: hasSharp(row.sharpBookSplits),
        dataWarnings: row.dataQuality.reviewFlags,
        result: result.result,
        units: result.units,
        aiV2Grade: v2?.ai_recommended_grade ?? null,
        aiV2Downgraded: v2 ? GRADES.indexOf(String(v2.ai_recommended_grade) as Grade) < GRADES.indexOf(row.playGrade as Grade) : null,
        downgradeWouldHaveHelped: v2 ? GRADES.indexOf(String(v2.ai_recommended_grade) as Grade) < GRADES.indexOf(row.playGrade as Grade) : null,
        likelyFailureReason: likelyFailureReason(row),
      });
    }
  }
  return out;
}

function likelyFailureReason(row: AiAuditorPayloadEstimate["payload"]["markets"][number]): string {
  const reasons: string[] = [];
  if (row.priceAmerican !== null && row.priceAmerican < -145) reasons.push("heavy_juice");
  if ((row.modelMarketGapPct ?? 0) < 4) reasons.push("thin_edge");
  if (/resistance/.test(row.marketRead?.status ?? "")) reasons.push("market_resistance");
  if (!hasSharp(row.sharpBookSplits)) reasons.push("sharp_source_missing");
  if (row.dataQuality.reviewFlags.length > 0) reasons.push("data_warning");
  return reasons.join(",") || "unclear";
}

function summarizeV2Mistakes(v2Rows: Array<Record<string, unknown>>) {
  const downgraded = v2Rows.filter((row) => GRADES.indexOf(String(row.ai_recommended_grade) as Grade) < GRADES.indexOf(String(row.original_grade) as Grade));
  const helped = downgraded.filter((row) => row.postgame_result === "loss");
  const hurt = downgraded.filter((row) => row.postgame_result === "win");
  const summarize = (rows: Array<Record<string, unknown>>) => ({
    count: rows.length,
    byMarket: countBy(rows, "market"),
    byOriginalGrade: countBy(rows, "original_grade"),
    byAiGrade: countBy(rows, "ai_recommended_grade"),
    avgEdge: avg(rows.map((row) => Number(row.original_edge))),
    avgPrice: avg(rows.map((row) => Number(row.original_price))),
    marketRead: countBy(rows, "original_market_read"),
    reasonCodes: countReasonCodes(rows),
    materiality: countIssueMateriality(rows),
    examples: rows.slice(0, 10).map((row) => ({
      game: `${row.slate_date} ${row.matchup}`,
      market: row.market,
      result: row.postgame_result,
      change: `${row.original_grade}->${row.ai_recommended_grade}`,
      reason: row.downgrade_promotion_reason,
      bettingValue: (row.betting_value_review as { summary?: string } | null)?.summary ?? null,
    })),
  });
  return {
    downgradedTotal: downgraded.length,
    downgradeHelped: summarize(helped),
    downgradeHurt: summarize(hurt),
    fiDowngradedWinners: summarize(hurt.filter((row) => row.market === "first_inning")),
    overPenalizedSignals: [
      "FI missing/no sharp market signal was frequently treated as material even though original FI Leans were 19-8.",
      "Consensus resistance/missing sharp confirmation was over-weighted on some winning Total/FI Leans.",
      "Historical source-not-persisted should be low materiality unless paired with price/starter/lineup issue.",
    ],
  };
}

function summarizePromotions(v2Rows: Array<Record<string, unknown>>) {
  const promoted = v2Rows.filter((row) => GRADES.indexOf(String(row.ai_recommended_grade) as Grade) > GRADES.indexOf(String(row.original_grade) as Grade));
  const winners = promoted.filter((row) => row.postgame_result === "win");
  const losers = promoted.filter((row) => row.postgame_result === "loss");
  const missedWinners = v2Rows
    .filter((row) => !["Lean", "Best Angle"].includes(String(row.original_grade)) && row.postgame_result === "win" && GRADES.indexOf(String(row.ai_recommended_grade) as Grade) <= GRADES.indexOf(String(row.original_grade) as Grade))
    .slice(0, 15);
  return {
    promotedTotal: promoted.length,
    promotedWinners: winners.length,
    promotedLosers: losers.length,
    candidates: promoted.map((row) => ({
      game: `${row.slate_date} ${row.matchup}`,
      market: row.market,
      pick: row.original_pick,
      price: row.original_price,
      edge: row.original_edge,
      grade: `${row.original_grade}->${row.ai_recommended_grade}`,
      marketRead: row.original_market_read,
      result: row.postgame_result,
      units: row.units,
      reason: row.downgrade_promotion_reason,
    })),
    missedUndergradedWinners: missedWinners.map((row) => ({
      game: `${row.slate_date} ${row.matchup}`,
      market: row.market,
      pick: row.original_pick,
      grade: `${row.original_grade}->${row.ai_recommended_grade}`,
      edge: row.original_edge,
      price: row.original_price,
      marketRead: row.original_market_read,
      units: row.units,
    })),
    failureHypothesis: [
      "v2 promotions often moved Caution/No Play only to Watchlist, but promoted losers outnumbered winners.",
      "The prompt still over-trusted model edge without enough price/market/data separation on low-grade rows.",
      "Promotion should require strong deterministicPreScore plus no high-materiality issue.",
    ],
  };
}

function countBy(rows: Array<Record<string, unknown>>, key: string) {
  const out: Record<string, number> = {};
  for (const row of rows) inc(out, String(row[key] ?? "unknown"));
  return out;
}

function countReasonCodes(rows: Array<Record<string, unknown>>) {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const code of (row.reason_codes ?? []) as string[]) inc(out, code);
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 20));
}

function countIssueMateriality(rows: Array<Record<string, unknown>>) {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const issue of (row.issue_materiality_scores ?? []) as Array<{ materiality_to_bet?: string; direction?: string; should_affect_grade?: boolean }>) {
      inc(out, `${issue.materiality_to_bet ?? "unknown"}:${issue.direction ?? "unknown"}:${issue.should_affect_grade ? "affects" : "no_affect"}`);
    }
  }
  return out;
}

function calibrationCandidates() {
  return {
    mlbMoneyline: {
      bestAngleCriteria: ["model edge >= 7", "price generally <= -140 unless edge is exceptional", "no unresolved market resistance/source conflict", "line movement not clearly against pick"],
      leanCriteria: ["playable price", "edge >= 4", "resistance allowed only with model-edge override copy"],
      watchlistCriteria: ["edge present but price or market resistance prevents action"],
      cautionCriteria: ["thin edge, heavy juice, or meaningful source conflict"],
      noPlayCriteria: ["unplayable price, no edge, severe data issue"],
      downgradeTriggers: ["heavy juice with thin edge", "Best Angle + resistance", "line movement against pick + no sharp support"],
      promotionTriggers: ["plus price/dog with strong edge and support", "clean aligned read with strong model edge"],
      lowMaterialityWarnings: ["historical sharp source missing alone"],
    },
    mlbTotals: {
      bestAngleCriteria: ["large model gap", "playable price", "line number still attractive", "no high-materiality weather/park/starter issue"],
      leanCriteria: ["edge >= 5 and price playable even with mixed market"],
      watchlistCriteria: ["edge exists but number/price likely needs improvement"],
      cautionCriteria: ["edge small or consensus resistance without override"],
      noPlayCriteria: ["thin edge plus resistance or unplayable price"],
      downgradeTriggers: ["small edge + resistance", "line moved materially away from value"],
      promotionTriggers: ["strong edge + playable price + stable/toward line movement"],
      lowMaterialityWarnings: ["mixed market alone", "missing sharp source alone"],
    },
    mlbFirstInning: {
      bestAngleCriteria: ["rare; strong starter-supported edge, playable price, no lineup/starter warning"],
      leanCriteria: ["model edge/probability supports NRFI/YRFI and price is playable; missing FI split source is allowed"],
      watchlistCriteria: ["soft model edge or price uncertainty"],
      cautionCriteria: ["starter/lineup warning, stale data, or edge near threshold"],
      noPlayCriteria: ["no edge, unplayable price, starter mismatch, stale starter/lineup data"],
      downgradeTriggers: ["starter/lineup mismatch", "stale/partial starting pitcher data", "thin FI edge with bad price"],
      promotionTriggers: ["strong FI model score + playable price + clean starter data"],
      lowMaterialityWarnings: ["missing FI sharp source", "no FI market signal", "consensus-only absence"],
      protectionRecommendation: "Protect FI Leans from AI downgrades for now; allow copy/data flags only unless high-materiality starter/price/data issue exists.",
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.env.AI_AUDITOR_COST_PREVIEW_ONLY = "true";
  const responses: Array<{ date: string; response: DailyEdgeResponse }> = [];
  for (const date of eachDateInclusive(args.from, args.to)) {
    responses.push({ date, response: await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date }) });
  }
  const preview = buildAiAuditorCostPreview({
    sport: args.sport,
    from: args.from,
    to: args.to,
    markets: parseAiAuditorMarkets(args.markets),
    refreshesPerDay: 1,
    miniEscalationRates: [0.05, 0.1, 0.2],
    skipUnchangedPayloads: false,
    oneCallPerGameCard: true,
    includePeakSlateAssumptions: false,
    payloadsByDate: responses,
  });
  const results = await loadPostgameResults({ sport: args.sport, from: args.from, to: args.to, payloads: preview.payloads });
  const v2RunId = args.v2RunId ?? await loadLatestV2RunId();
  const v2Rows = await loadV2Rows(v2RunId);
  const report = {
    mode: "diagnostic_lab_no_openai",
    noOpenAiCalls: true,
    noLiveChanges: true,
    noMemberFacingChanges: true,
    sport: args.sport,
    from: args.from,
    to: args.to,
    payloads: preview.payloads.length,
    v2RunId,
    originalGradePerformanceByMarket: summarizeOriginal(preview.payloads, results),
    originalBestAngleLosses: summarizeBestAngleLosses(preview.payloads, results, v2Rows),
    aiV2MistakeDiagnosis: summarizeV2Mistakes(v2Rows),
    promotionDiagnosis: summarizePromotions(v2Rows),
    calibrationCandidates: calibrationCandidates(),
    preparedVariants: {
      ai_v3_market_specific: "Market-specific scorecards, FI downgrade constraints, Totals less conservative.",
      ai_v4_profit_calibrated: "Uses deterministicPreScore and recent cohort priors to avoid downgrading profitable cohorts without high-materiality issue.",
      ai_v5_promotions_enabled: "Looks for under-graded winners but requires strong score, playable price, and clean materiality.",
    },
    recommendedPermissionsBeforeNextReplay: {
      mlbMoneyline: "AI may recommend downgrades/promotions in replay only.",
      mlbTotals: "AI may recommend changes in replay only, but mixed market alone should not downgrade.",
      mlbFirstInning: "AI should be flag/copy/data-only for downgrades unless high-materiality starter/price/data issue exists.",
    },
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("AI Calibration Diagnostic Lab (no OpenAI calls)");
  console.log(`Range: ${args.sport} ${args.from}..${args.to}`);
  console.log(`Payloads: ${report.payloads}`);
  console.log(`AI v2 run: ${v2RunId ?? "not_found"}`);
  console.log("Original grade performance by market:");
  for (const market of MARKETS) {
    console.log(`  ${market}: ${JSON.stringify(report.originalGradePerformanceByMarket[market])}`);
  }
  console.log(`Original Best Angle losses: ${report.originalBestAngleLosses.length}`);
  console.log(JSON.stringify(report.originalBestAngleLosses.slice(0, 20), null, 2));
  console.log("AI v2 mistake diagnosis:");
  console.log(JSON.stringify(report.aiV2MistakeDiagnosis, null, 2));
  console.log("Promotion diagnosis:");
  console.log(JSON.stringify(report.promotionDiagnosis, null, 2));
  console.log("Calibration candidates:");
  console.log(JSON.stringify(report.calibrationCandidates, null, 2));
  console.log("Prepared variants:");
  console.log(JSON.stringify(report.preparedVariants, null, 2));
  console.log("Recommendation: keep live Guarded QC and grade changes disabled. Protect FI from AI downgrades for now.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
