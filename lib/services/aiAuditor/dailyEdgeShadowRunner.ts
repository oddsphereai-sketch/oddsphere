import crypto from "node:crypto";
import {
  buildDailyEdgeResponseForCostPreview,
  estimateCostUsd,
  parseAiAuditorMarkets,
  resolveAiAuditorPricing,
} from "@/lib/services/aiAuditor/costPreview";
import {
  AI_DAILY_EDGE_INTELLIGENCE_REVIEW_SCHEMA,
} from "@/lib/services/aiAuditor/dailyEdgeIntelligenceReview";
import { currentMonthKey, insertAiAuditLedger } from "@/lib/services/aiAuditCostControl";
import { sanitizeDailyEdgeAiOutput } from "@/lib/services/aiAuditor/dailyEdgeAiOutputSanitizer";
import { interpretMarketIntelligence } from "@/lib/services/dailyEdge/marketIntelligenceInterpreter";
import {
  allowedDailyEdgeMemberCopyLabel,
  renderDailyEdgeMemberCopy,
} from "@/lib/services/dailyEdge/memberFacingCopyRenderer";
import { reviewPredictionEvidence } from "@/lib/services/dailyEdge/predictionEvidenceReviewer";
import { buildPredictionEvidenceForDailyEdgeEvaluation } from "@/lib/services/dailyEdge/lockedPredictionEvidenceSource";
import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import { supabase } from "@/lib/db/supabase";
import type { Sport } from "@/lib/types/domain/Sport";

type ShadowMarket = "moneyline" | "total";

type ShadowArgs = {
  sport: Sport;
  date: string;
  markets?: string;
  maxCostUsd?: number | null;
  maxCalls?: number | null;
  runId?: string | null;
  dryRun?: boolean;
  force?: boolean;
};

type ShadowCallResult = {
  row: PredictionEvidenceObject;
  payloadHash: string;
  skipped: boolean;
  skippedReason: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  ledgerId: string | null;
  evaluationRowsWritten: number;
  validationErrors: string[];
  aiRecommendedGrade: string | null;
  aiRecommendedMarketRead: string | null;
  status: "pass" | "warn" | "block" | "skipped";
};

export type DailyEdgeShadowRunnerResult = {
  runId: string;
  mode: "dry-run" | "paid-shadow";
  sport: Sport;
  date: string;
  markets: ShadowMarket[];
  evidenceRows: number;
  eligibleRows: number;
  skippedUnchangedRows: number;
  deferredRows: number;
  callsAttempted: number;
  ledgerRowsWritten: number;
  evaluationRowsWritten: number;
  appliedRows: 0;
  estimatedCostUsd: number;
  actualCostUsd: number;
  validationErrorsByCode: Record<string, number>;
  statuses: Record<string, number>;
  details: ShadowCallResult[];
};

function envBool(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value === "true";
}

function tokenEstimate(value: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}

function payloadHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function defaultRunId(args: Pick<ShadowArgs, "sport" | "date">): string {
  const seed = `${args.sport}:${args.date}:${Date.now()}:${crypto.randomUUID()}`;
  return ["ai-daily-edge-shadow", args.sport, args.date, crypto.createHash("sha1").update(seed).digest("hex").slice(0, 10)].join("_");
}

function marketSpecificPrompt(market: ShadowMarket): string {
  if (market === "moneyline") {
    return [
      "You are the OddSphere Moneyline Intelligence Reviewer.",
      "Review one ML prediction only: win case, model probability vs implied, price/value, favorite/dog profile, consensus/sharp relationship, movement, and betting thesis.",
      "Use only ML labels and do not use FI or Total labels.",
      "Separate grade changes from copy/risk/market-read improvements.",
      "No live changes, no member-facing changes, applied=false.",
    ].join("\n");
  }
  return [
    "You are the OddSphere Totals Intelligence Reviewer.",
    "Review one Total prediction only: projection vs line, Over/Under direction, edge at current number, price/value, movement, run environment, and betting thesis.",
    "Use only Total labels and do not use ML or FI labels.",
    "Separate grade changes from copy/risk/market-read improvements.",
    "No live changes, no member-facing changes, applied=false.",
  ].join("\n");
}

function payloadForCall(evidence: PredictionEvidenceObject) {
  return {
    variant: evidence.identity.normalizedMarket === "moneyline"
      ? "ai_v5_moneyline_intelligence_review"
      : "ai_v5_totals_intelligence_review",
    task: "Hourly Daily Edge AI shadow review. Admin-only. Do not apply changes.",
    evidence,
    evidenceReview: reviewPredictionEvidence(evidence),
    marketIntelligence: interpretMarketIntelligence(evidence),
    guardrails: {
      noLiveChanges: true,
      noMemberFacingChanges: true,
      noAppliedGradeChanges: true,
      noPickFlips: true,
      noProbabilityChanges: true,
      noProjectionChanges: true,
      factualRepairFromTrustedSourcesOnly: true,
      rawAiCopyNeverMemberFacing: true,
      applied: false,
    },
  };
}

function parseOutputText(value: unknown): string {
  const record = value as { output_text?: unknown; output?: Array<{ content?: Array<{ text?: string }> }> };
  if (typeof record.output_text === "string") return record.output_text;
  const chunks: string[] = [];
  for (const item of record.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function gradeRank(grade: string | null | undefined): number {
  return ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"].indexOf(grade ?? "");
}

function gradeDirection(original: string | null | undefined, suggested: string | null | undefined): "promotion" | "downgrade" | "hold" {
  const a = gradeRank(original);
  const b = gradeRank(suggested);
  if (a < 0 || b < 0 || a === b) return "hold";
  return b > a ? "promotion" : "downgrade";
}

const PROVIDER_OR_SOURCE_LEAK_RE = /\b(playbook|sharpapi|circa|draftkings|fanduel|betmgm|pinnacle)\b/i;
const BETTING_HYPE_RE = /\b(sharp money loves|overwhelmingly on|guaranteed|free money|lock of the day|lock play|stone cold lock|can't lose)\b/i;

function memberFacingText(result: Record<string, any>): string {
  return [
    result.market_read_review?.memberFacingMarketReadCopy,
    result.reader_coherence_review?.suggestedMarketReadCopy,
    result.reader_coherence_review?.suggestedSupportingEvidenceCopy,
    result.reader_coherence_review?.suggestedRiskCopy,
  ].filter(Boolean).join("\n");
}

function validateResult(evidence: PredictionEvidenceObject, result: Record<string, any> | null): string[] {
  if (!result) return ["invalid_json"];
  const errors: string[] = [];
  const grade = result.grade_alignment_review ?? {};
  const safety = result.safety_review ?? {};
  const label = String(result.market_read_review?.marketReadLabel ?? "");
  const copyText = memberFacingText(result);

  for (const key of [
    "winCaseStrengthScore",
    "bettingValueStrengthScore",
    "marketContextScore",
    "priceQualityScore",
    "modelStatSupportScore",
    "dataQualityScore",
    "riskPenaltyScore",
    "readQualityScore",
  ]) {
    const value = grade[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) errors.push(`grade_dimension_missing:${key}`);
  }
  if (!grade.gradeReasonType) errors.push("grade_reason_type_missing");
  if (grade.originalPlayGrade !== evidence.identity.originalPlayGrade) errors.push("grade_echo_mismatch");
  if (!allowedDailyEdgeMemberCopyLabel(evidence, label)) errors.push("market_read_label_wrong_market_type");

  const direction = gradeDirection(evidence.identity.originalPlayGrade, grade.suggestedPlayGrade);
  if (grade.actionVsOriginal && grade.actionVsOriginal !== (direction === "promotion" ? "promote" : direction)) errors.push("grade_action_mismatch");
  if (typeof grade.gradeChangeRecommended === "boolean" && grade.gradeChangeRecommended !== (direction !== "hold")) errors.push("grade_action_mismatch");
  if (direction !== "hold") {
    const materiality = String(grade.gradeChangeMateriality ?? "");
    const evidenceItems = Array.isArray(grade.gradeChangeEvidence) ? grade.gradeChangeEvidence.filter(Boolean) : [];
    if (materiality !== "medium" && materiality !== "high") errors.push("unsupported_grade_change");
    if (evidenceItems.length === 0) errors.push("unsupported_grade_change");
  }
  if (PROVIDER_OR_SOURCE_LEAK_RE.test(copyText) || safety.provider_names_present || result.reader_coherence_review?.providerLeakDetected) errors.push("provider_or_source_leak");
  if (BETTING_HYPE_RE.test(copyText)) errors.push("betting_hype_language");
  if (/\b(sharp money)\b/i.test(copyText)) errors.push("copy_overclaims_sharp_signal");
  if (safety.postgame_data_present) errors.push("postgame_leakage_claimed");
  if (safety.invented_data_detected) errors.push("invented_data_claimed");
  if (safety.invalid_grade_label) errors.push("invalid_grade_label");
  if (safety.attempted_pick_flip) errors.push("attempted_pick_flip");
  if (safety.attempted_probability_change) errors.push("attempted_probability_change");
  if (safety.attempted_projected_score_change) errors.push("attempted_projected_score_change");
  if (safety.attempted_live_apply_change) errors.push("attempted_live_apply_change");
  return errors;
}

function isFatalValidationError(error: string): boolean {
  return [
    "invalid_json",
    "provider_or_source_leak",
    "postgame_leakage_claimed",
    "invented_data_claimed",
    "invalid_grade_label",
    "attempted_pick_flip",
    "attempted_probability_change",
    "attempted_projected_score_change",
    "attempted_live_apply_change",
  ].includes(error);
}

async function existingLedgerForHash(payloadHashValue: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("ai_audit_usage_ledger")
    .select("id")
    .eq("payload_hash", payloadHashValue)
    .eq("audit_scope", "daily_edge_intelligence_shadow")
    .limit(1);
  if (error) throw new Error(`shadow ledger hash lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}

async function callOpenAi(evidence: PredictionEvidenceObject, payload: unknown) {
  const pricing = resolveAiAuditorPricing();
  if (pricing.nanoModel.toLowerCase().includes("gpt-5.5")) throw new Error("GPT-5.5 is blocked for Daily Edge shadow.");
  const systemPrompt = marketSpecificPrompt(evidence.identity.normalizedMarket as ShadowMarket);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: pricing.nanoModel,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: AI_DAILY_EDGE_INTELLIGENCE_REVIEW_SCHEMA.name,
          schema: AI_DAILY_EDGE_INTELLIGENCE_REVIEW_SCHEMA.schema,
          strict: true,
        },
      },
    }),
  });
  const json = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`OpenAI Daily Edge shadow call failed: HTTP ${response.status} ${JSON.stringify(json)}`);
  const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  const inputTokens = Number(usage?.input_tokens ?? tokenEstimate(payload));
  const outputTokens = Number(usage?.output_tokens ?? 1000);
  return {
    result: JSON.parse(parseOutputText(json)) as Record<string, any>,
    inputTokens,
    outputTokens,
    actualCostUsd: estimateCostUsd(inputTokens, outputTokens, pricing.nanoInputUsdPerMillion, pricing.nanoOutputUsdPerMillion),
  };
}

async function logEvaluationRow(args: {
  runId: string;
  row: PredictionEvidenceObject;
  result: Record<string, any>;
  payloadHashValue: string;
  ledgerId: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  validationErrors: string[];
}): Promise<number> {
  const e = args.row;
  const renderedCopy = renderDailyEdgeMemberCopy({
    evidence: e,
    evidenceReview: reviewPredictionEvidence(e),
    marketIntelligence: interpretMarketIntelligence(e),
    intent: {
      marketReadLabel: args.result.market_read_review?.marketReadLabel,
      gradeReasonType: args.result.grade_alignment_review?.gradeReasonType,
      suggestedPlayGrade: args.result.grade_alignment_review?.suggestedPlayGrade,
      gradeChangeDirection: args.result.grade_alignment_review?.gradeChangeDirection,
    },
  });
  const status = args.validationErrors.some(isFatalValidationError)
    ? "block"
    : (args.result.severity === "block" ? "block" : args.result.severity === "high" ? "warn" : "pass");
  const { error } = await supabase.from("ai_audit_evaluation_results").insert([{
    run_id: args.runId,
    variant: e.identity.normalizedMarket === "moneyline" ? "ai_v5_moneyline_intelligence_review" : "ai_v5_totals_intelligence_review",
    audit_scope: "daily_edge_intelligence_shadow",
    ledger_id: args.ledgerId,
    applied: false,
    sport: e.identity.sport,
    slate_date: e.identity.slateDate,
    game_id: e.identity.gameId,
    external_id: e.identity.externalId,
    matchup: `${e.identity.awayTeam} @ ${e.identity.homeTeam}`,
    market: e.identity.normalizedMarket,
    payload_hash: args.payloadHashValue,
    original_pick: e.identity.pick,
    original_grade: e.identity.originalPlayGrade,
    original_market_read: e.marketEvidence.deterministicMarketRead,
    original_model_probability: e.modelStatsEvidence.modelProbability,
    original_edge: e.modelStatsEvidence.edge,
    original_price: e.priceValueEvidence.priceAmerican,
    original_recommendation_confidence: e.identity.originalRecommendationConfidence,
    ai_recommended_grade: args.result.grade_alignment_review?.suggestedPlayGrade ?? null,
    ai_recommended_market_read: args.result.market_read_review?.marketReadLabel ?? null,
    ai_recommendation_direction: gradeDirection(e.identity.originalPlayGrade, args.result.grade_alignment_review?.suggestedPlayGrade),
    downgrade_promotion_reason: args.result.grade_alignment_review?.gradeReason ?? null,
    data_integrity_review: args.result.model_stats_review,
    market_read_review: args.result.market_read_review,
    play_grade_review: args.result.grade_alignment_review,
    betting_value_review: args.result.price_value_review,
    card_coherence_review: args.result.reader_coherence_review,
    safety_review: args.result.safety_review,
    market_reviews: [],
    issues: [],
    issue_materiality_scores: [],
    reason_codes: [],
    recommended_actions: [],
    safe_copy_fixes: [
      { field: "market_read", replacement: renderedCopy.marketReadCopy, reason: "deterministic_member_renderer" },
      { field: "supporting_evidence", replacement: renderedCopy.supportingEvidenceCopy, reason: "deterministic_member_renderer" },
    ].filter((row) => row.replacement),
    repair_actions: [],
    full_ai_output: { ...args.result, member_copy_renderer: renderedCopy },
    validation_errors: args.validationErrors,
    postgame_result_joined: false,
    postgame_result: null,
    units: null,
    roi: null,
    odds_american: null,
    input_tokens: args.inputTokens,
    output_tokens: args.outputTokens,
    estimated_cost_usd: args.estimatedCostUsd,
    actual_cost_usd: args.actualCostUsd,
    model: resolveAiAuditorPricing().nanoModel,
    status,
    severity: args.result.severity ?? "info",
  }]);
  if (error) throw new Error(`ai_audit_evaluation_results shadow insert failed: ${error.message}`);
  return 1;
}

function assertShadowGate(args: ShadowArgs, estimatedCostUsd: number): void {
  if (args.dryRun) return;
  if (!envBool("AI_DAILY_EDGE_SHADOW_ENABLED")) throw new Error("AI_DAILY_EDGE_SHADOW_ENABLED must be true for hourly shadow.");
  if (!envBool("AI_DAILY_EDGE_INTELLIGENCE_ENABLED")) throw new Error("AI_DAILY_EDGE_INTELLIGENCE_ENABLED must be true for paid shadow.");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for paid shadow.");
  if (envBool("AI_AUDITOR_GUARDED_LIVE_QC")) throw new Error("AI_AUDITOR_GUARDED_LIVE_QC must remain false.");
  if (envBool("AI_AUDITOR_APPLY_SAFE_COPY_FIXES")) throw new Error("AI_AUDITOR_APPLY_SAFE_COPY_FIXES must remain false.");
  if (envBool("AI_AUDITOR_APPLY_GUARDED_DOWNGRADES")) throw new Error("AI_AUDITOR_APPLY_GUARDED_DOWNGRADES must remain false.");
  if (envBool("AI_AUDITOR_ALLOW_PICK_FLIPS")) throw new Error("AI_AUDITOR_ALLOW_PICK_FLIPS must remain false.");
  if (envBool("AI_AUDITOR_ALLOW_PROBABILITY_CHANGES")) throw new Error("AI_AUDITOR_ALLOW_PROBABILITY_CHANGES must remain false.");
  if (process.env.AI_AUDITOR_DISABLE_GPT55_LIVE === "false") throw new Error("AI_AUDITOR_DISABLE_GPT55_LIVE must not be false.");
  const cap = args.maxCostUsd ?? Number(process.env.AI_DAILY_EDGE_SHADOW_HARD_CAP_USD ?? 1);
  if (estimatedCostUsd > cap) throw new Error(`Estimated shadow cost ${estimatedCostUsd.toFixed(6)} exceeds hard cap ${cap.toFixed(2)}.`);
}

function countBy(rows: ShadowCallResult[], fn: (row: ShadowCallResult) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = fn(row);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

export async function runDailyEdgeAiShadow(args: ShadowArgs): Promise<DailyEdgeShadowRunnerResult> {
  const requestedMarkets = parseAiAuditorMarkets(args.markets ?? "ML,TOTAL")
    .filter((market): market is ShadowMarket => market === "moneyline" || market === "total");
  const runId = args.runId ?? defaultRunId(args);
  const response = await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date: args.date });
  const evidenceSelection = await buildPredictionEvidenceForDailyEdgeEvaluation({
    sport: args.sport,
    date: args.date,
    markets: requestedMarkets,
    response,
  });
  const rows = evidenceSelection.evidence
    .filter((row) => row.identity.normalizedMarket === "moneyline" || row.identity.normalizedMarket === "total");
  const pricing = resolveAiAuditorPricing();
  const prepared = rows.map((row) => {
    const payload = payloadForCall(row);
    const inputTokens = tokenEstimate(marketSpecificPrompt(row.identity.normalizedMarket as ShadowMarket)) + tokenEstimate(payload);
    const outputTokens = 1000;
    return {
      row,
      payload,
      hash: payloadHash(payload),
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens, pricing.nanoInputUsdPerMillion, pricing.nanoOutputUsdPerMillion),
    };
  });
  const totalEstimated = prepared.reduce((sum, row) => sum + row.estimatedCostUsd, 0);
  assertShadowGate(args, totalEstimated);

  const details: ShadowCallResult[] = [];
  let repeatedFatalFailures = 0;
  const maxCalls = Math.max(1, Math.floor(args.maxCalls ?? Number(process.env.AI_DAILY_EDGE_SHADOW_MAX_CALLS_PER_RUN ?? 8)));
  let callsAttempted = 0;
  let deferredRows = 0;
  for (const item of prepared) {
    if (!args.force && await existingLedgerForHash(item.hash)) {
      details.push({
        row: item.row,
        payloadHash: item.hash,
        skipped: true,
        skippedReason: "unchanged_payload_hash",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
        ledgerId: null,
        evaluationRowsWritten: 0,
        validationErrors: [],
        aiRecommendedGrade: null,
        aiRecommendedMarketRead: null,
        status: "skipped",
      });
      continue;
    }
    if (!args.dryRun && callsAttempted >= maxCalls) {
      deferredRows += 1;
      details.push({
        row: item.row,
        payloadHash: item.hash,
        skipped: true,
        skippedReason: "deferred_max_calls_per_run",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
        ledgerId: null,
        evaluationRowsWritten: 0,
        validationErrors: [],
        aiRecommendedGrade: null,
        aiRecommendedMarketRead: null,
        status: "skipped",
      });
      continue;
    }
    if (args.dryRun) {
      details.push({
        row: item.row,
        payloadHash: item.hash,
        skipped: false,
        skippedReason: null,
        inputTokens: item.inputTokens,
        outputTokens: item.outputTokens,
        estimatedCostUsd: item.estimatedCostUsd,
        actualCostUsd: 0,
        ledgerId: null,
        evaluationRowsWritten: 0,
        validationErrors: [],
        aiRecommendedGrade: null,
        aiRecommendedMarketRead: null,
        status: "pass",
      });
      continue;
    }
    callsAttempted += 1;
    const ai = await callOpenAi(item.row, item.payload);
    const validationErrors = validateResult(item.row, ai.result);
    if (validationErrors.some(isFatalValidationError)) repeatedFatalFailures += 1;
    const status = validationErrors.some(isFatalValidationError)
      ? "block"
      : (ai.result.severity === "high" || ai.result.severity === "block" ? "warn" : "pass");
    const ledgerId = await insertAiAuditLedger({
      month_key: currentMonthKey(),
      sport: item.row.identity.sport,
      slate_date: item.row.identity.slateDate,
      game_id: item.row.identity.gameId,
      audit_scope: "daily_edge_intelligence_shadow",
      payload_hash: item.hash,
      from_cache: false,
      skipped_reason: null,
      model: pricing.nanoModel,
      input_tokens: ai.inputTokens,
      output_tokens: ai.outputTokens,
      estimated_cost_usd: item.estimatedCostUsd,
      actual_cost_usd: ai.actualCostUsd,
      status,
      severity: ai.result.severity ?? "info",
      recommended_actions: validationErrors.map((error) => `validation:${error}`),
      escalation: false,
      applied: false,
    });
    const evaluationRowsWritten = await logEvaluationRow({
      runId,
      row: item.row,
      result: ai.result,
      payloadHashValue: item.hash,
      ledgerId,
      inputTokens: ai.inputTokens,
      outputTokens: ai.outputTokens,
      estimatedCostUsd: item.estimatedCostUsd,
      actualCostUsd: ai.actualCostUsd,
      validationErrors,
    });
    details.push({
      row: item.row,
      payloadHash: item.hash,
      skipped: false,
      skippedReason: null,
      inputTokens: ai.inputTokens,
      outputTokens: ai.outputTokens,
      estimatedCostUsd: item.estimatedCostUsd,
      actualCostUsd: ai.actualCostUsd,
      ledgerId,
      evaluationRowsWritten,
      validationErrors,
      aiRecommendedGrade: ai.result.grade_alignment_review?.suggestedPlayGrade ?? null,
      aiRecommendedMarketRead: ai.result.market_read_review?.marketReadLabel ?? null,
      status,
    });
    if (repeatedFatalFailures >= 3) throw new Error("Stopping hourly shadow after repeated fatal safety failures.");
  }

  const validationErrorsByCode: Record<string, number> = {};
  for (const detail of details) {
    for (const error of detail.validationErrors) {
      const code = error.split(":")[0];
      validationErrorsByCode[code] = (validationErrorsByCode[code] ?? 0) + 1;
    }
  }
  return {
    runId,
    mode: args.dryRun ? "dry-run" : "paid-shadow",
    sport: args.sport,
    date: args.date,
    markets: requestedMarkets,
    evidenceRows: rows.length,
    eligibleRows: details.filter((row) => !row.skipped).length,
    skippedUnchangedRows: details.filter((row) => row.skipped).length,
    deferredRows,
    callsAttempted: details.filter((row) => !row.skipped && !args.dryRun).length,
    ledgerRowsWritten: details.filter((row) => row.ledgerId).length,
    evaluationRowsWritten: details.reduce((sum, row) => sum + row.evaluationRowsWritten, 0),
    appliedRows: 0,
    estimatedCostUsd: +details.reduce((sum, row) => sum + row.estimatedCostUsd, 0).toFixed(6),
    actualCostUsd: +details.reduce((sum, row) => sum + row.actualCostUsd, 0).toFixed(6),
    validationErrorsByCode,
    statuses: countBy(details, (row) => row.status),
    details,
  };
}
