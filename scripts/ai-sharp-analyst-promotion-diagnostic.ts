import {
  buildAiAuditorCostPreview,
  buildDailyEdgeResponseForCostPreview,
  parseAiAuditorMarkets,
  type AiAuditorCompactMarketPayload,
  type AiAuditorMarketKey,
} from "@/lib/services/aiAuditor/costPreview";
import { scanPromotionCandidate } from "@/lib/services/aiAuditor/promotionCandidateScanner";
import { AI_SHARP_ANALYST_V3_VARIANT } from "@/lib/services/aiAuditor/sharpAnalystMemory";
import type { Sport } from "@/lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string;
  markets: string;
  runId: string | null;
  json: boolean;
};

type EvalRow = {
  run_id: string;
  matchup: string;
  market: AiAuditorMarketKey;
  original_grade: string | null;
  ai_recommended_grade: string | null;
  original_market_read: string | null;
  ai_recommended_market_read: string | null;
  market_read_review: Record<string, unknown>;
  betting_value_review: Record<string, unknown>;
  play_grade_review: Record<string, unknown>;
  promotion_candidate_review?: Record<string, unknown>;
  full_ai_output?: { market_reviews?: Array<Record<string, unknown>> };
  issues: Array<Record<string, unknown>>;
  reason_codes: string[];
  validation_errors: string[];
};

const GRADE_RANK = ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"];

function parseArgs(argv: string[]): Args {
  const out: Args = { sport: "mlb", date: "2026-06-29", markets: "ML,TOTAL,FI", runId: null, json: false };
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
    if (key === "run-id") out.runId = value || null;
  }
  return out;
}

function splitRows(section: unknown): Array<Record<string, unknown>> {
  const rows = (section as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object")) : [];
}

function sideLabel(market: AiAuditorCompactMarketPayload, row: Record<string, unknown>): string {
  return String(row.label ?? row.side ?? "").toLowerCase();
}

function pickLabel(market: AiAuditorCompactMarketPayload): string {
  return String(market.pick ?? "").toLowerCase();
}

function rowForPick(market: AiAuditorCompactMarketPayload, section: unknown): Record<string, unknown> | null {
  const rows = splitRows(section);
  const pick = pickLabel(market);
  if (!pick) return null;
  return rows.find((row) => sideLabel(market, row) === pick) ?? rows.find((row) => pick.includes(sideLabel(market, row)) || sideLabel(market, row).includes(pick)) ?? null;
}

function leadingSide(section: unknown): Record<string, unknown> | null {
  const rows = splitRows(section);
  if (rows.length === 0) return null;
  return rows.slice().sort((a, b) => Number(b.moneyPct ?? 0) - Number(a.moneyPct ?? 0))[0] ?? null;
}

function sourceRead(market: AiAuditorCompactMarketPayload, section: unknown) {
  const pickRow = rowForPick(market, section);
  const leader = leadingSide(section);
  return {
    side: pickRow?.label ?? pickRow?.side ?? null,
    moneyPct: pickRow?.moneyPct ?? null,
    betsPct: pickRow?.betsPct ?? null,
    leadingSide: leader?.label ?? leader?.side ?? null,
    leadingMoneyPct: leader?.moneyPct ?? null,
  };
}

function actionDirection(original: string | null, ai: string | null): "promote" | "hold" | "downgrade" {
  const a = GRADE_RANK.indexOf(original ?? "");
  const b = GRADE_RANK.indexOf(ai ?? "");
  if (a < 0 || b < 0 || a === b) return "hold";
  return b > a ? "promote" : "downgrade";
}

function materialBlockers(row: EvalRow | null): string[] {
  return (row?.issues ?? [])
    .filter((issue) => issue.should_affect_grade === true || issue.materiality_to_bet === "high")
    .map((issue) => String(issue.message ?? issue.issue_type ?? "material_issue"));
}

function aiTreatedFiMissingSplitsAsMaterial(row: EvalRow | null): boolean {
  return (row?.issues ?? []).some((issue) => {
    const text = `${issue.issue_type ?? ""} ${issue.message ?? ""}`.toLowerCase();
    return text.includes("split") && text.includes("missing") && issue.should_affect_grade === true;
  });
}

function validateMarketRead(market: AiAuditorCompactMarketPayload, row: EvalRow | null): string[] {
  const aiRead = row?.ai_recommended_market_read;
  const hasConsensus = market.consensusSplits !== null;
  const hasSharp = market.sharpBookSplits !== null;
  const violations: string[] = [];
  if (market.market !== "first_inning") {
    if (hasConsensus && hasSharp && aiRead === "insufficient_data") violations.push("sources_present_but_ai_insufficient_data");
    if (hasConsensus && hasSharp && market.sourceConflict && aiRead !== "mixed") violations.push("source_conflict_not_labeled_mixed");
    if ((market.marketRead?.status === "resistance" || market.marketRead?.status === "consensus_resistance") && aiRead === "insufficient_data") violations.push("resistance_mislabeled_insufficient_data");
  } else if (aiRead === "insufficient_data" && market.displayPriceAmerican !== null && market.modelMarketGapPct !== null && market.fiContext.expectedRunsAvailable) {
    violations.push("fi_core_fields_present_but_ai_insufficient_data");
  }
  return violations;
}

async function latestRunId(date: string, sport: Sport): Promise<string | null> {
  const { supabase } = await import("@/lib/db/supabase");
  const { data, error } = await supabase
    .from("ai_audit_evaluation_results")
    .select("run_id,created_at")
    .eq("variant", AI_SHARP_ANALYST_V3_VARIANT)
    .eq("sport", sport)
    .eq("slate_date", date)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.run_id ?? null;
}

async function loadRows(runId: string): Promise<EvalRow[]> {
  const { supabase } = await import("@/lib/db/supabase");
  const { data, error } = await supabase
    .from("ai_audit_evaluation_results")
    .select("run_id,matchup,market,original_grade,ai_recommended_grade,original_market_read,ai_recommended_market_read,market_read_review,betting_value_review,play_grade_review,full_ai_output,issues,reason_codes,validation_errors")
    .eq("run_id", runId);
  if (error) throw error;
  return (data ?? []) as EvalRow[];
}

function key(matchup: string, market: string): string {
  return `${matchup}::${market}`;
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
  const runId = args.runId ?? await latestRunId(args.date, args.sport);
  if (!runId) throw new Error(`No ${AI_SHARP_ANALYST_V3_VARIANT} run found for ${args.sport} ${args.date}`);
  const rows = await loadRows(runId);
  const rowMap = new Map(rows.map((row) => [key(row.matchup, row.market), row]));

  const traces = preview.payloads.flatMap((payload) => payload.payload.markets.map((market) => {
    const row = rowMap.get(key(payload.matchup, market.market)) ?? null;
    const fullOutputMarketReview = row?.full_ai_output?.market_reviews?.find((review) => review.market === market.market);
    const scan = scanPromotionCandidate(market);
    const consensus = sourceRead(market, market.consensusSplits);
    const sharp = sourceRead(market, market.sharpBookSplits);
    const direction = actionDirection(market.playGrade, row?.ai_recommended_grade ?? null);
    const readViolations = validateMarketRead(market, row);
    const fiMissingMaterial = market.market === "first_inning" && aiTreatedFiMissingSplitsAsMaterial(row);
    return {
      game: payload.matchup,
      market: market.market,
      pick: market.pick,
      originalGrade: market.playGrade,
      aiRecommendedGrade: row?.ai_recommended_grade ?? null,
      actionDirection: direction,
      priceAmerican: market.displayPriceAmerican,
      lineValue: market.lineValue,
      modelProbability: market.modelProbabilityPct,
      marketImpliedProbability: market.marketProbabilityPct,
      edge: market.modelMarketGapPct,
      projectedScore: payload.payload.projectedScore,
      originalMarketRead: market.marketRead?.status ?? null,
      aiMarketRead: row?.ai_recommended_market_read ?? null,
      consensusSide: consensus.side,
      consensusMoneyPct: consensus.moneyPct,
      consensusBetsPct: consensus.betsPct,
      consensusLeadingSide: consensus.leadingSide,
      sharpBookSideOrSignal: sharp.side ?? (market.sharpBookSplits as { signal?: string } | null)?.signal ?? null,
      sharpBookMoneyPct: sharp.moneyPct,
      sharpBookBetsPct: sharp.betsPct,
      sharpBookLeadingSide: sharp.leadingSide,
      sourceAgreement: market.sourceConflict ? "disagreement" : market.consensusSplits && market.sharpBookSplits ? "agreement_or_no_conflict" : "not_available",
      openLine: market.openLineValue ?? market.lineMovement.openAmerican,
      currentLine: market.currentLineValue ?? market.lineMovement.displayCurrentAmerican,
      lockLine: market.lineMovement.lockedAmerican,
      movementDirection: market.lineMovement.directionRelativeToPick,
      movementTowardAgainstPick: market.lineMovement.directionRelativeToPick,
      dataWarnings: market.dataQuality.reviewFlags,
      keyStatProjectionContextIncluded: {
        projectedScore: payload.payload.projectedScore !== null,
        fiExpectedRunsAvailable: market.fiContext.expectedRunsAvailable,
        deterministicPreScore: market.deterministicPreScore,
      },
      aiReasonCodes: row?.reason_codes ?? [],
      aiMaterialityScores: row?.issues ?? [],
      aiBlockers: materialBlockers(row),
      aiPromotionReviewResult: (fullOutputMarketReview?.promotion_candidate_review as Record<string, unknown> | undefined) ?? row?.promotion_candidate_review ?? null,
      aiDowngradeReviewResult: {
        downgradeCandidate: row?.betting_value_review?.downgradeCandidate ?? null,
        summary: row?.play_grade_review?.summary ?? null,
      },
      deterministicPromotionScan: scan,
      promotionPressure: scan.promotionCandidate ? {
        aiPromoted: direction === "promote",
        aiHeld: direction === "hold",
        aiDowngraded: direction === "downgrade",
        blockerMaterial: materialBlockers(row).length > 0,
        lowMaterialityBlockerOnly: materialBlockers(row).length === 0 && scan.blockerMateriality === "low",
        aiOverPenalizedFiMissingSplits: fiMissingMaterial,
      } : null,
      marketReadValidationViolations: readViolations,
      gradeEchoMismatch: row?.validation_errors?.some((error) => error.includes("grade_echo_mismatch") || error.includes("current_grade_mismatch")) ?? false,
      fiMissingSplitsMaterialViolation: fiMissingMaterial,
    };
  }));

  const promotionCandidates = traces.filter((trace) => trace.deterministicPromotionScan.promotionCandidate);
  const missedPromotions = promotionCandidates.filter((trace) => trace.actionDirection !== "promote");
  const summary = {
    runId,
    variant: AI_SHARP_ANALYST_V3_VARIANT,
    noOpenAiCalls: true,
    noLiveChanges: true,
    noMemberFacingChanges: true,
    marketsReviewed: traces.length,
    marketsWhereAiSawBothSplitSources: traces.filter((trace) => trace.consensusSide !== null && trace.sharpBookSideOrSignal !== null).length,
    sourceAgreementMisreads: traces.filter((trace) => trace.marketReadValidationViolations.includes("source_conflict_not_labeled_mixed")).length,
    insufficientDataMislabels: traces.filter((trace) => trace.marketReadValidationViolations.some((item) => item.includes("insufficient_data"))).length,
    fiMissingSplitsWronglyMaterial: traces.filter((trace) => trace.fiMissingSplitsMaterialViolation).length,
    deterministicPromotionCandidatesFound: promotionCandidates.length,
    promotionCandidatesAiPromoted: promotionCandidates.filter((trace) => trace.actionDirection === "promote").length,
    promotionCandidatesAiHeld: promotionCandidates.filter((trace) => trace.actionDirection === "hold").length,
    promotionCandidatesAiDowngraded: promotionCandidates.filter((trace) => trace.actionDirection === "downgrade").length,
    missedPromotionsWithOnlyLowMaterialityBlockers: missedPromotions.filter((trace) => trace.promotionPressure?.lowMaterialityBlockerOnly).length,
    downgradesSupportedByMaterialEvidence: traces.filter((trace) => trace.actionDirection === "downgrade" && trace.aiBlockers.length > 0).length,
    downgradesTooConservative: traces.filter((trace) => trace.actionDirection === "downgrade" && trace.aiBlockers.length === 0).length,
    gradeEchoMismatches: traces.filter((trace) => trace.gradeEchoMismatch).length,
    candidatesByMarket: promotionCandidates.reduce<Record<string, number>>((acc, trace) => {
      acc[trace.market] = (acc[trace.market] ?? 0) + 1;
      return acc;
    }, {}),
    exactCandidatesToTestNextPaidRun: promotionCandidates.map((trace) => ({
      game: trace.game,
      market: trace.market,
      pick: trace.pick,
      originalGrade: trace.originalGrade,
      aiRecommendedGrade: trace.aiRecommendedGrade,
      maxCandidateGrade: trace.deterministicPromotionScan.maxCandidateGrade,
      promotionScore: trace.deterministicPromotionScan.promotionScore,
      reasonCodes: trace.deterministicPromotionScan.promotionReasonCodes,
      blockers: trace.deterministicPromotionScan.promotionBlockers,
      aiBlockers: trace.aiBlockers,
    })),
  };

  const report = { summary, evidenceTracePerMarket: traces };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("AI Sharp Analyst Promotion Candidate + Evidence Trace Diagnostic");
  console.log("No OpenAI calls. No live changes. No member-facing changes.");
  console.log(JSON.stringify(summary, null, 2));
  console.log("Evidence trace per market:");
  console.log(JSON.stringify(traces, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
