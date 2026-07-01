import crypto from "node:crypto";
import {
  buildAiAuditorCostPreview,
  buildDailyEdgeResponseForCostPreview,
  estimateCostUsd,
  parseAiAuditorMarkets,
  resolveAiAuditorPricing,
} from "@/lib/services/aiAuditor/costPreview";
import { AI_MARKET_ANALYST_CURRENT_SCHEMA } from "@/lib/services/aiAuditor/marketAnalystSchema";
import {
  buildPredictionLevelAnalystPayloads,
  predictionAnalystSystemPrompt,
  type PredictionAnalystKind,
  type PredictionAnalystVariant,
  type PredictionLevelAnalystPayload,
} from "@/lib/services/aiAuditor/predictionMarketAnalyst";
import { currentMonthKey, insertAiAuditLedger } from "@/lib/services/aiAuditCostControl";
import {
  buildSharpAnalystMemoryModules,
  loadSharpAnalystResearchPack,
} from "@/lib/services/aiAuditor/sharpAnalystMemory";
import type { Sport } from "@/lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string;
  markets: string;
  mode: "dry-run" | "paid-sample";
  nanoOnly: boolean;
  maxCostUsd: number | null;
  variant: PredictionAnalystVariant;
  runId: string | null;
  json: boolean;
};

type PlayGrade = "No Play" | "Caution" | "Watchlist" | "Lean" | "Best Angle";
type MarketRead = "aligned" | "mixed" | "resistance" | "consensus_support" | "consensus_resistance" | "no_clear_signal" | "insufficient_data";

type PredictionAnalystResult = {
  market_reviews: Array<{
    market: "moneyline" | "total" | "first_inning";
    data_integrity_review: Record<string, unknown>;
    market_read_review: {
      recommendedMarketRead: MarketRead;
      memberCopy: string;
      [key: string]: unknown;
    };
    betting_value_review: Record<string, unknown>;
    promotion_candidate_review: {
      promotionCandidateReviewed: boolean;
      promotionDecision: "promote" | "hold" | "reject";
      recommendedGrade: PlayGrade;
      maxReasonableGrade: PlayGrade;
      primaryBlocker: string;
      blockerMateriality: "low" | "medium" | "high";
      evidenceThatSupportsPromotion: string[];
      evidenceAgainstPromotion: string[];
      whatWouldNeedToChangeToPromote: string[];
    };
    play_grade_review: {
      currentPlayGrade: PlayGrade;
      recommendedPlayGrade: PlayGrade;
      gradeDirection: "promote" | "downgrade" | "hold";
      summary: string;
      [key: string]: unknown;
    };
    sharp_grade_rebuild?: {
      originalPlayGrade: PlayGrade;
      rebuiltPlayGrade: PlayGrade;
      actionVsOriginal: "promote" | "downgrade" | "hold";
      independentSharpScore: number;
      bettingValueScore: number;
      marketSignalScore: number;
      priceQualityScore: number;
      modelEdgeScore: number;
      dataQualityScore: number;
      riskPenalty: number;
      slateRankCandidateScore: number;
      publicActionability: boolean;
      maxReasonableGrade: PlayGrade;
      evidenceForUpgrade: string[];
      evidenceForDowngrade: string[];
      materialBlockers: string[];
      priceVerdict: string;
      marketVerdict: string;
      modelEdgeVerdict: string;
      finalSharpBettorSummary: string;
    };
    issue_materiality: Array<{
      issue_type: string;
      severity: "info" | "low" | "medium" | "high" | "block";
      materiality_to_bet: "low" | "medium" | "high";
      should_affect_grade: boolean;
      direction: string;
      message: string;
    }>;
    recommended_actions: string[];
    safe_copy_fixes: Array<{ field: string; replacement: string; reason: string }>;
    repair_actions: string[];
    confidence: number;
    severity: "info" | "low" | "medium" | "high" | "block";
  }>;
  card_coherence_review: Record<string, unknown>;
  safety_review: {
    postgame_data_present: boolean;
    provider_names_present: boolean;
    invented_data_detected: boolean;
    invalid_grade_label: boolean;
    attempted_pick_flip: boolean;
    attempted_probability_change: boolean;
    attempted_projected_score_change: boolean;
    attempted_live_apply_change: boolean;
  };
  recommended_actions: string[];
  safe_copy_fixes: Array<Record<string, unknown>>;
  provider_name_check: { provider_names_present: boolean; offending_terms: string[] };
  confidence: number;
  severity: "info" | "low" | "medium" | "high" | "block";
};

type PaidCall = {
  payload: PredictionLevelAnalystPayload;
  payloadHash: string;
  result: PredictionAnalystResult | null;
  validationErrors: string[];
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  actualCostUsd: number | null;
  ledgerId: string | null;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sport: "mlb",
    date: "2026-06-29",
    markets: "ML,TOTAL,FI",
    mode: "dry-run",
    nanoOnly: false,
    maxCostUsd: null,
    variant: "ai_v3_prediction_level_market_analyst",
    runId: null,
    json: false,
  };
  for (const arg of argv) {
    if (arg === "--nano-only") {
      out.nanoOnly = true;
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
    if (key === "date") out.date = value;
    if (key === "markets") out.markets = value;
    if (key === "mode") {
      if (value !== "dry-run" && value !== "paid-sample") throw new Error(`Unsupported --mode=${value}`);
      out.mode = value;
    }
    if (key === "max-cost-usd") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid --max-cost-usd=${value}`);
      out.maxCostUsd = parsed;
    }
    if (key === "variant") {
      if (value !== "ai_v3_prediction_level_market_analyst" && value !== "ai_v4_sharp_grade_rebuilder") {
        throw new Error(`Unsupported --variant=${value}`);
      }
      out.variant = value;
    }
    if (key === "run-id") out.runId = value.trim() || null;
  }
  return out;
}

function tokenEstimate(value: unknown): number {
  return Math.ceil(Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8") / 4);
}

function groupByKind(payloads: PredictionLevelAnalystPayload[]) {
  return payloads.reduce<Record<string, PredictionLevelAnalystPayload[]>>((acc, payload) => {
    (acc[payload.analystKind] ??= []).push(payload);
    return acc;
  }, {});
}

function pct(n: number, d: number): string {
  return d === 0 ? "0/0 = n/a" : `${n}/${d} = ${((n / d) * 100).toFixed(1)}%`;
}

function completeness(payloads: PredictionLevelAnalystPayload[]) {
  const grouped = groupByKind(payloads);
  return Object.fromEntries(Object.entries(grouped).map(([kind, rows]) => [kind, {
    rows: String(rows.length),
    price: pct(rows.filter((row) => row.pricing.priceAmerican !== null).length, rows.length),
    modelProbability: pct(rows.filter((row) => row.model.modelProbability !== null).length, rows.length),
    marketImplied: pct(rows.filter((row) => row.pricing.marketImpliedProbability !== null).length, rows.length),
    edge: pct(rows.filter((row) => row.model.edge !== null).length, rows.length),
    lineValue: pct(rows.filter((row) => row.marketLine.lineValue !== null).length, rows.length),
    consensusSharpRequired: kind === "first_inning_prediction_analyst" ? "0/13 required = expected" : "required",
    consensus: pct(rows.filter((row) => row.sourceContext.consensusSplits !== null).length, rows.length),
    sharp: pct(rows.filter((row) => row.sourceContext.sharpBookSplitsOrSignal !== null).length, rows.length),
    fiContext: kind === "first_inning_prediction_analyst"
      ? pct(rows.filter((row) => row.fiContext.expectedRunsAvailable !== null).length, rows.length)
      : "n/a",
  }]));
}

function exampleFor(payloads: PredictionLevelAnalystPayload[], kind: PredictionAnalystKind) {
  const row = payloads.find((payload) => payload.analystKind === kind);
  if (!row) return null;
  return {
    analystKind: row.analystKind,
    game: row.game,
    market: row.market,
    pick: row.pick,
    currentGrade: row.currentGrade,
    pricing: row.pricing,
    model: row.model,
    marketLine: row.marketLine,
    lineMovement: row.lineMovement,
    marketRead: row.marketRead,
    sourceContext: row.sourceContext,
    fiContext: row.fiContext,
    promotionScanner: row.promotionScanner,
    validationRules: row.validationRules,
    memoryTitle: row.marketMemoryModule.title,
  };
}

function costEstimate(payloads: PredictionLevelAnalystPayload[], variant: PredictionAnalystVariant) {
  const pricing = resolveAiAuditorPricing();
  const assumedOutputTokensPerPrediction = variant === "ai_v4_sharp_grade_rebuilder" ? 1200 : 900;
  const inputTokens = payloads.reduce((sum, payload) => {
    return sum + tokenEstimate(predictionAnalystSystemPrompt(payload.analystKind, variant)) + tokenEstimate(payload);
  }, 0);
  const outputTokens = payloads.length * assumedOutputTokensPerPrediction;
  return {
    model: pricing.nanoModel,
    pricingMode: pricing.pricingMode,
    inputTokens,
    outputTokens,
    assumedOutputTokensPerPrediction,
    estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens, pricing.nanoInputUsdPerMillion, pricing.nanoOutputUsdPerMillion),
    conservative2xUsd: +(estimateCostUsd(inputTokens, outputTokens, pricing.nanoInputUsdPerMillion, pricing.nanoOutputUsdPerMillion) * 2).toFixed(6),
  };
}

function money(value: number): string {
  return `$${value.toFixed(4)}`;
}

function payloadHash(payload: PredictionLevelAnalystPayload): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function gradeRank(grade: string | null | undefined): number {
  return ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"].indexOf(grade ?? "");
}

function gradeDirection(original: string | null | undefined, recommended: string | null | undefined): "promotion" | "downgrade" | "hold" {
  const a = gradeRank(original);
  const b = gradeRank(recommended);
  if (a < 0 || b < 0 || a === b) return "hold";
  return b > a ? "promotion" : "downgrade";
}

function schemaGradeAction(direction: ReturnType<typeof gradeDirection>): "promote" | "downgrade" | "hold" {
  return direction === "promotion" ? "promote" : direction;
}

function envFalse(name: string): boolean {
  return process.env[name] === "false" || process.env[name] === undefined || process.env[name] === "";
}

function assertPaidGate(args: Args, estimatedCostUsd: number): void {
  if (args.mode !== "paid-sample") return;
  if (process.env.AI_MARKET_ANALYST_CURRENT_ENABLED !== "true") {
    throw new Error("Prediction-level paid evaluation is disabled. Set AI_MARKET_ANALYST_CURRENT_ENABLED=true only after explicit approval.");
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("paid-sample requires OPENAI_API_KEY.");
  if (!args.nanoOnly) throw new Error("paid-sample requires --nano-only.");
  if (process.env.AI_AUDITOR_DISABLE_GPT55_LIVE === "false") throw new Error("GPT-5.5 live disable guard must remain enabled.");
  if (!envFalse("AI_AUDITOR_GUARDED_LIVE_QC")) throw new Error("AI_AUDITOR_GUARDED_LIVE_QC must be false.");
  if (!envFalse("AI_AUDITOR_APPLY_SAFE_COPY_FIXES")) throw new Error("AI_AUDITOR_APPLY_SAFE_COPY_FIXES must be false.");
  if (!envFalse("AI_AUDITOR_APPLY_GUARDED_DOWNGRADES")) throw new Error("AI_AUDITOR_APPLY_GUARDED_DOWNGRADES must be false.");
  if (!envFalse("AI_AUDITOR_ALLOW_PICK_FLIPS")) throw new Error("AI_AUDITOR_ALLOW_PICK_FLIPS must be false.");
  if (!envFalse("AI_AUDITOR_ALLOW_PROBABILITY_CHANGES")) throw new Error("AI_AUDITOR_ALLOW_PROBABILITY_CHANGES must be false.");
  const cap = args.maxCostUsd ?? Number(process.env.AI_MARKET_ANALYST_CURRENT_HARD_CAP_USD ?? 5);
  if (estimatedCostUsd > cap) throw new Error(`Estimated prediction-level evaluation cost ${money(estimatedCostUsd)} exceeds hard cap ${money(cap)}.`);
}

function predictionUserPayload(payload: PredictionLevelAnalystPayload, variant: PredictionAnalystVariant) {
  return JSON.stringify({
    run_context: {
      variant,
      prediction_level_market_analyst: true,
      sharp_grade_rebuilder: variant === "ai_v4_sharp_grade_rebuilder",
      analystKind: payload.analystKind,
      applied: false,
      no_live_changes: true,
      no_member_facing_changes: true,
      no_pick_flips: true,
      no_probability_changes: true,
      no_projected_score_changes: true,
      no_postgame_results_in_payload: true,
    },
    strict_instruction: variant === "ai_v4_sharp_grade_rebuilder"
      ? "Return the strict schema. Include exactly one market_reviews item for this prediction/market. Populate sharp_grade_rebuild as the independent grade-from-scratch answer. Set play_grade_review.recommendedPlayGrade equal to sharp_grade_rebuild.rebuiltPlayGrade."
      : "Return the existing strict schema. Include exactly one market_reviews item for this prediction/market. Populate sharp_grade_rebuild consistently with play_grade_review.",
    grade_rebuilder_instruction: variant === "ai_v4_sharp_grade_rebuilder" ? {
      goal: "Rebuild and reorganize Play Grades from evidence, not imitate the original grade.",
      originalGradeIsTarget: false,
      questions: [
        "If grading this market from scratch as a disciplined sharp bettor, what should the Play Grade be?",
        "Is this one of the strongest actionable betting positions on the slate, merely actionable, watch-only, caution, or no play?",
        "Would this public action improve the quality of OddSphere Best Angles and Leans?",
      ],
      requiredScoreFields: [
        "independentSharpScore",
        "bettingValueScore",
        "marketSignalScore",
        "priceQualityScore",
        "modelEdgeScore",
        "dataQualityScore",
        "riskPenalty",
        "slateRankCandidateScore",
      ],
      gradeDefinitions: {
        "Best Angle": "One of the strongest actionable betting positions on the slate; strong edge, playable price, clean enough data, and market support or a strong model/price override.",
        Lean: "Positive actionable bet, but not quite top-tier.",
        Watchlist: "Interesting edge but not actionable enough yet.",
        Caution: "Contradictory, fragile, stale, overpriced, or materially risky.",
        "No Play": "No actionable betting edge at current price/number, or insufficient core confidence.",
      },
    } : null,
    prediction_payload: payload,
    promotion_accountability: payload.promotionScanner.promotionCandidate ? {
      required: true,
      questions: [
        "Should this promote to Lean?",
        "If not, what is the material blocker?",
        "Is the blocker strong enough to override the scanner?",
        "Is the blocker actually supported by price/market/edge/data?",
      ],
      scanner: payload.promotionScanner,
    } : { required: false },
  });
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

async function callOpenAiPredictionAnalyst(payload: PredictionLevelAnalystPayload, variant: PredictionAnalystVariant) {
  const pricing = resolveAiAuditorPricing();
  if (pricing.nanoModel.toLowerCase().includes("gpt-5.5")) throw new Error("GPT-5.5 is blocked for prediction-level analyst evaluations.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: pricing.nanoModel,
      input: [
        { role: "system", content: predictionAnalystSystemPrompt(payload.analystKind, variant) },
        { role: "user", content: predictionUserPayload(payload, variant) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: AI_MARKET_ANALYST_CURRENT_SCHEMA.name,
          schema: AI_MARKET_ANALYST_CURRENT_SCHEMA.schema,
          strict: true,
        },
      },
    }),
  });
  const json = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`OpenAI prediction analyst call failed: HTTP ${response.status} ${JSON.stringify(json)}`);
  const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  const inputTokens = Number(usage?.input_tokens ?? tokenEstimate(predictionUserPayload(payload, variant)));
  const outputTokens = Number(usage?.output_tokens ?? 900);
  return {
    result: JSON.parse(parseOutputText(json)) as PredictionAnalystResult,
    inputTokens,
    outputTokens,
    actualCostUsd: estimateCostUsd(inputTokens, outputTokens, pricing.nanoInputUsdPerMillion, pricing.nanoOutputUsdPerMillion),
  };
}

function validateResult(
  payload: PredictionLevelAnalystPayload,
  result: PredictionAnalystResult | null,
  variant: PredictionAnalystVariant,
): string[] {
  if (!result) return ["invalid_json"];
  const errors: string[] = [];
  if (!Array.isArray(result.market_reviews) || result.market_reviews.length !== 1) errors.push("market_review_count_invalid");
  const review = result.market_reviews?.[0];
  if (!review) return errors;
  if (review.market !== payload.market) errors.push(`market_mismatch:${review.market}`);
  if (review.play_grade_review.currentPlayGrade !== payload.currentGrade) errors.push(`grade_echo_mismatch:${payload.market}`);
  const recommended = review.play_grade_review.recommendedPlayGrade;
  if (variant === "ai_v4_sharp_grade_rebuilder") {
    const rebuild = review.sharp_grade_rebuild;
    if (!rebuild) {
      errors.push("sharp_grade_rebuild_missing");
    } else {
      if (rebuild.originalPlayGrade !== payload.currentGrade) errors.push(`rebuilder_original_grade_mismatch:${payload.market}`);
      if (rebuild.rebuiltPlayGrade !== recommended) errors.push(`rebuilt_grade_mismatch:${payload.market}`);
      const rebuiltDirection = gradeDirection(payload.currentGrade, rebuild.rebuiltPlayGrade);
      if (rebuild.actionVsOriginal !== schemaGradeAction(rebuiltDirection)) {
        errors.push(`rebuilt_action_mismatch:${payload.market}`);
      }
      for (const [key, value] of Object.entries({
        independentSharpScore: rebuild.independentSharpScore,
        bettingValueScore: rebuild.bettingValueScore,
        marketSignalScore: rebuild.marketSignalScore,
        priceQualityScore: rebuild.priceQualityScore,
        modelEdgeScore: rebuild.modelEdgeScore,
        dataQualityScore: rebuild.dataQualityScore,
        riskPenalty: rebuild.riskPenalty,
        slateRankCandidateScore: rebuild.slateRankCandidateScore,
      })) {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
          errors.push(`rebuilder_score_invalid:${key}`);
        }
      }
    }
  }
  const direction = gradeDirection(payload.currentGrade, recommended);
  if (
    payload.promotionScanner.promotionCandidate &&
    direction !== "promotion" &&
    (!review.promotion_candidate_review?.promotionCandidateReviewed ||
      review.promotion_candidate_review.blockerMateriality === "low" ||
      !review.promotion_candidate_review.blockerMateriality)
  ) {
    errors.push(`promotion_underreach:${payload.market}`);
  }
  if (
    payload.market === "total" &&
    payload.pricing.priceAmerican !== null &&
    payload.model.modelProbability !== null &&
    payload.model.edge !== null &&
    payload.pricing.marketImpliedProbability !== null &&
    payload.marketLine.lineValue !== null &&
    payload.sourceContext.consensusSplits !== null &&
    payload.sourceContext.sharpBookSplitsOrSignal !== null &&
    review.market_read_review.recommendedMarketRead === "insufficient_data"
  ) {
    errors.push("market_read_label_invalid:total:sources_and_core_fields_present");
  }
  if (result.provider_name_check.provider_names_present || result.safety_review.provider_names_present) errors.push("provider_name_leak");
  if (result.safety_review.postgame_data_present) errors.push("postgame_leakage_claimed");
  if (result.safety_review.invented_data_detected) errors.push("invented_data_claimed");
  if (result.safety_review.attempted_pick_flip) errors.push("attempted_pick_flip");
  if (result.safety_review.attempted_probability_change) errors.push("attempted_probability_change");
  if (result.safety_review.attempted_projected_score_change) errors.push("attempted_projected_score_change");
  if (result.safety_review.attempted_live_apply_change) errors.push("attempted_live_apply_change");
  return errors;
}

function normalizePredictionLevelResult(
  payload: PredictionLevelAnalystPayload,
  result: PredictionAnalystResult,
): PredictionAnalystResult {
  if (result.market_reviews.length === 1) return result;
  const matchingReview = result.market_reviews.find((review) => review.market === payload.market);
  if (!matchingReview) return result;
  return {
    ...result,
    market_reviews: [matchingReview],
    recommended_actions: Array.from(new Set([
      ...result.recommended_actions,
      "hold_grade",
    ])),
  };
}

function isFatalValidationError(error: string): boolean {
  return [
    "invalid_json",
    "sharp_grade_rebuild_missing",
    "provider_name_leak",
    "postgame_leakage_claimed",
    "invented_data_claimed",
    "attempted_pick_flip",
    "attempted_probability_change",
    "attempted_projected_score_change",
    "attempted_live_apply_change",
  ].includes(error);
}

async function logLedger(payload: PredictionLevelAnalystPayload, call: PaidCall): Promise<string | null> {
  return await insertAiAuditLedger({
    month_key: currentMonthKey(),
    sport: payload.sport,
    slate_date: payload.slateDate,
    game_id: payload.gameId,
    audit_scope: "prediction_level_market_analyst_evaluation",
    payload_hash: call.payloadHash,
    from_cache: false,
    skipped_reason: null,
    model: resolveAiAuditorPricing().nanoModel,
    input_tokens: call.inputTokens,
    output_tokens: call.outputTokens,
    estimated_cost_usd: call.estimatedCostUsd,
    actual_cost_usd: call.actualCostUsd,
    status: call.validationErrors.length > 0 ? "block" : (call.result?.severity === "high" || call.result?.severity === "block" ? "warn" : "pass"),
    severity: call.result?.severity ?? (call.validationErrors.length > 0 ? "block" : "info"),
    recommended_actions: [
      ...(call.result?.recommended_actions ?? []),
      ...call.validationErrors.map((error) => `validation:${error}`),
    ],
    escalation: false,
    applied: false,
  });
}

async function logEvaluationRows(args: { runId: string; calls: PaidCall[]; variant: PredictionAnalystVariant }) {
  const { supabase } = await import("@/lib/db/supabase");
  const rows = args.calls.flatMap((call) => {
    if (!call.result) return [];
    const review = call.result.market_reviews[0];
    if (!review) return [];
    return [{
      run_id: args.runId,
      variant: args.variant,
      audit_scope: "prediction_level_market_analyst_evaluation",
      ledger_id: call.ledgerId,
      applied: false,
      sport: call.payload.sport,
      slate_date: call.payload.slateDate,
      game_id: call.payload.gameId,
      external_id: call.payload.externalId,
      matchup: call.payload.game,
      market: call.payload.market,
      payload_hash: call.payloadHash,
      original_pick: call.payload.pick,
      original_grade: call.payload.currentGrade,
      original_market_read: call.payload.marketRead?.status ?? null,
      original_model_probability: call.payload.model.modelProbability,
      original_edge: call.payload.model.edge,
      original_price: call.payload.pricing.priceAmerican,
      original_recommendation_confidence: null,
      ai_recommended_grade: review.sharp_grade_rebuild?.rebuiltPlayGrade ?? review.play_grade_review.recommendedPlayGrade,
      ai_recommended_market_read: review.market_read_review.recommendedMarketRead,
      ai_recommendation_direction: gradeDirection(call.payload.currentGrade, review.sharp_grade_rebuild?.rebuiltPlayGrade ?? review.play_grade_review.recommendedPlayGrade),
      downgrade_promotion_reason: review.play_grade_review.summary ?? review.promotion_candidate_review.primaryBlocker,
      data_integrity_review: review.data_integrity_review,
      market_read_review: review.market_read_review,
      play_grade_review: review.play_grade_review,
      betting_value_review: {
        ...review.betting_value_review,
        sharpGradeRebuild: review.sharp_grade_rebuild ?? null,
      },
      card_coherence_review: call.result.card_coherence_review,
      safety_review: call.result.safety_review,
      market_reviews: call.result.market_reviews,
      issues: review.issue_materiality,
      issue_materiality_scores: review.issue_materiality,
      reason_codes: review.market_read_review.reasonCodes ?? [],
      recommended_actions: review.recommended_actions,
      safe_copy_fixes: [...(review.safe_copy_fixes ?? []), ...(call.result.safe_copy_fixes ?? [])],
      repair_actions: review.repair_actions,
      full_ai_output: call.result,
      validation_errors: call.validationErrors,
      postgame_result_joined: false,
      postgame_result: null,
      units: null,
      roi: null,
      odds_american: null,
      input_tokens: call.inputTokens,
      output_tokens: call.outputTokens,
      estimated_cost_usd: call.estimatedCostUsd,
      actual_cost_usd: call.actualCostUsd,
      model: resolveAiAuditorPricing().nanoModel,
      status: call.validationErrors.length > 0 ? "block" : (call.result.severity === "block" ? "block" : call.result.severity === "high" ? "warn" : "pass"),
      severity: review.severity ?? call.result.severity,
    }];
  });
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("ai_audit_evaluation_results").insert(rows);
  if (error) throw new Error(`ai_audit_evaluation_results insert failed: ${error.message}`);
  return rows.length;
}

function defaultRunId(args: Args) {
  const seed = `${args.sport}:${args.date}:${args.markets}:${Date.now()}:${crypto.randomUUID()}`;
  return ["ai-prediction-market-analyst", args.sport, args.date, crypto.createHash("sha1").update(seed).digest("hex").slice(0, 10)].join("_");
}

function buildSlateRerankReport(calls: PaidCall[]) {
  const ranked = calls.flatMap((call) => {
    const review = call.result?.market_reviews[0];
    const rebuild = review?.sharp_grade_rebuild;
    if (!review || !rebuild) return [];
    return [{
      game: call.payload.game,
      market: call.payload.market,
      pick: call.payload.pick,
      originalGrade: call.payload.currentGrade,
      rebuiltGrade: rebuild.rebuiltPlayGrade,
      actionVsOriginal: rebuild.actionVsOriginal,
      publicActionability: rebuild.publicActionability,
      independentSharpScore: rebuild.independentSharpScore,
      slateRankCandidateScore: rebuild.slateRankCandidateScore,
      bettingValueScore: rebuild.bettingValueScore,
      marketSignalScore: rebuild.marketSignalScore,
      priceQualityScore: rebuild.priceQualityScore,
      modelEdgeScore: rebuild.modelEdgeScore,
      dataQualityScore: rebuild.dataQualityScore,
      riskPenalty: rebuild.riskPenalty,
      maxReasonableGrade: rebuild.maxReasonableGrade,
      summary: rebuild.finalSharpBettorSummary,
      blockers: rebuild.materialBlockers,
    }];
  }).sort((a, b) =>
    b.slateRankCandidateScore - a.slateRankCandidateScore ||
    b.independentSharpScore - a.independentSharpScore ||
    b.bettingValueScore - a.bettingValueScore
  );
  return {
    strongestBettingOpportunities: ranked.slice(0, 10),
    bestAngleCandidates: ranked.filter((row) => row.rebuiltGrade === "Best Angle"),
    leanCandidates: ranked.filter((row) => row.rebuiltGrade === "Lean"),
    watchlistCandidates: ranked.filter((row) => row.rebuiltGrade === "Watchlist"),
    cautionNoPlayCandidates: ranked.filter((row) => row.rebuiltGrade === "Caution" || row.rebuiltGrade === "No Play"),
    originalBestAnglesNotTopTier: ranked.filter((row) => row.originalGrade === "Best Angle" && row.rebuiltGrade !== "Best Angle"),
    undergradedPromotions: ranked.filter((row) => row.actionVsOriginal === "promote"),
    downgradedOldPublicPlays: ranked.filter((row) => row.actionVsOriginal === "downgrade"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const response = await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date: args.date });
  const preview = buildAiAuditorCostPreview({
    sport: args.sport,
    from: args.date,
    to: args.date,
    markets: parseAiAuditorMarkets(args.markets),
    refreshesPerDay: 1,
    miniEscalationRates: [],
    skipUnchangedPayloads: false,
    oneCallPerGameCard: true,
    includePeakSlateAssumptions: false,
    payloadsByDate: [{ date: args.date, response }],
  });
  const memoryModules = buildSharpAnalystMemoryModules(loadSharpAnalystResearchPack());
  const predictionPayloads = buildPredictionLevelAnalystPayloads({ cards: preview.payloads, memoryModules });
  const grouped = groupByKind(predictionPayloads);
  const cost = costEstimate(predictionPayloads, args.variant);
  assertPaidGate(args, cost.estimatedCostUsd);
  const promotionCandidates = predictionPayloads
    .filter((payload) => payload.promotionScanner.promotionCandidate)
    .map((payload) => ({
      analystKind: payload.analystKind,
      game: payload.game,
      market: payload.market,
      pick: payload.pick,
      currentGrade: payload.currentGrade,
      maxCandidateGrade: payload.promotionScanner.maxCandidateGrade,
      promotionScore: payload.promotionScanner.promotionScore,
      reasons: payload.promotionScanner.promotionReasonCodes,
      blockers: payload.promotionScanner.promotionBlockers,
      blockerMateriality: payload.promotionScanner.blockerMateriality,
    }));
  const runId = args.runId ?? defaultRunId(args);
  const paidCalls: PaidCall[] = [];
  if (args.mode === "paid-sample") {
    let repeatedFailures = 0;
    for (const payload of predictionPayloads) {
      const hash = payloadHash(payload);
      const estimatedInput = tokenEstimate(predictionAnalystSystemPrompt(payload.analystKind, args.variant)) + tokenEstimate(payload);
      const estimatedOutput = args.variant === "ai_v4_sharp_grade_rebuilder" ? 1200 : 900;
      const pricing = resolveAiAuditorPricing();
      const estimatedCostUsd = estimateCostUsd(estimatedInput, estimatedOutput, pricing.nanoInputUsdPerMillion, pricing.nanoOutputUsdPerMillion);
      const response = await callOpenAiPredictionAnalyst(payload, args.variant);
      const normalizedResult = normalizePredictionLevelResult(payload, response.result);
      const call: PaidCall = {
        payload,
        payloadHash: hash,
        result: normalizedResult,
        validationErrors: validateResult(payload, normalizedResult, args.variant),
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        estimatedCostUsd,
        actualCostUsd: response.actualCostUsd,
        ledgerId: null,
      };
      if (call.validationErrors.some(isFatalValidationError)) repeatedFailures += 1;
      call.ledgerId = await logLedger(payload, call);
      paidCalls.push(call);
      if (repeatedFailures >= 3) {
        throw new Error(`Stopping after repeated schema/safety failures: ${call.validationErrors.join(", ")}`);
      }
    }
  }
  const evaluationRowsWritten = args.mode === "paid-sample" ? await logEvaluationRows({ runId, calls: paidCalls, variant: args.variant }) : 0;
  const actualCostUsd = +paidCalls.reduce((sum, call) => sum + Number(call.actualCostUsd ?? 0), 0).toFixed(6);
  const promotionDecisions = paidCalls
    .filter((call) => call.payload.promotionScanner.promotionCandidate)
    .map((call) => {
      const review = call.result?.market_reviews[0] ?? null;
      return {
        game: call.payload.game,
        market: call.payload.market,
        pick: call.payload.pick,
        currentGrade: call.payload.currentGrade,
        scannerMaxGrade: call.payload.promotionScanner.maxCandidateGrade,
        scannerScore: call.payload.promotionScanner.promotionScore,
        scannerReasons: call.payload.promotionScanner.promotionReasonCodes,
        scannerBlockers: call.payload.promotionScanner.promotionBlockers,
        aiGrade: review?.play_grade_review.recommendedPlayGrade ?? null,
        aiDirection: review ? gradeDirection(call.payload.currentGrade, review.play_grade_review.recommendedPlayGrade) : null,
        promotionDecision: review?.promotion_candidate_review.promotionDecision ?? null,
        blockerMateriality: review?.promotion_candidate_review.blockerMateriality ?? null,
        primaryBlocker: review?.promotion_candidate_review.primaryBlocker ?? null,
        evidenceFor: review?.promotion_candidate_review.evidenceThatSupportsPromotion ?? [],
        evidenceAgainst: review?.promotion_candidate_review.evidenceAgainstPromotion ?? [],
        whatWouldNeedToChange: review?.promotion_candidate_review.whatWouldNeedToChangeToPromote ?? [],
        validationErrors: call.validationErrors,
      };
    });
  const validationErrorsByCode = paidCalls.reduce<Record<string, number>>((acc, call) => {
    for (const error of call.validationErrors) {
      const code = error.split(":")[0] ?? error;
      acc[code] = (acc[code] ?? 0) + 1;
    }
    return acc;
  }, {});
  const report = {
    mode: args.mode,
    runId,
    variant: args.variant,
    noOpenAiCalls: args.mode === "dry-run",
    noLiveChanges: true,
    noMemberFacingChanges: true,
    appliedRows: 0,
    sport: args.sport,
    date: args.date,
    counts: {
      gameCards: preview.payloads.length,
      predictionPayloads: predictionPayloads.length,
      moneylinePredictionPayloads: grouped.moneyline_prediction_analyst?.length ?? 0,
      totalPredictionPayloads: grouped.total_prediction_analyst?.length ?? 0,
      firstInningPredictionPayloads: grouped.first_inning_prediction_analyst?.length ?? 0,
    },
    estimatedCostIfPaid: cost,
    actualCostUsd,
    ledgerRowsWritten: paidCalls.filter((call) => call.ledgerId).length,
    evaluationRowsWritten,
    completenessByMarket: completeness(predictionPayloads),
    examples: {
      moneyline: exampleFor(predictionPayloads, "moneyline_prediction_analyst"),
      total: exampleFor(predictionPayloads, "total_prediction_analyst"),
      firstInning: exampleFor(predictionPayloads, "first_inning_prediction_analyst"),
    },
    promotionCandidatesByMarket: promotionCandidates.reduce<Record<string, number>>((acc, candidate) => {
      acc[candidate.market] = (acc[candidate.market] ?? 0) + 1;
      return acc;
    }, {}),
    promotionCandidates,
    promotionDecisions,
    slateRerankReport: buildSlateRerankReport(paidCalls),
    validationSummary: {
      schemaOrValidationFailureCalls: paidCalls.filter((call) => call.validationErrors.length > 0).length,
      validationErrorsByCode,
      promotionUnderreachCount: Number(validationErrorsByCode.promotion_underreach ?? 0),
      marketReadLabelInvalidCount: Number(validationErrorsByCode.market_read_label_invalid ?? 0),
      gradeEchoMismatchCount: Number(validationErrorsByCode.grade_echo_mismatch ?? 0),
      providerLeaks: paidCalls.filter((call) => call.result?.provider_name_check.provider_names_present || call.result?.safety_review.provider_names_present).length,
      postgameLeaks: paidCalls.filter((call) => call.result?.safety_review.postgame_data_present).length,
      inventedDataFlags: paidCalls.filter((call) => call.result?.safety_review.invented_data_detected).length,
      attemptedChangeFlags: paidCalls.filter((call) =>
        call.result?.safety_review.attempted_pick_flip ||
        call.result?.safety_review.attempted_probability_change ||
        call.result?.safety_review.attempted_projected_score_change ||
        call.result?.safety_review.attempted_live_apply_change,
      ).length,
    },
    paidResults: paidCalls.map((call) => {
      const review = call.result?.market_reviews[0] ?? null;
      const rebuild = review?.sharp_grade_rebuild ?? null;
      const rebuiltGrade = rebuild?.rebuiltPlayGrade ?? review?.play_grade_review.recommendedPlayGrade ?? null;
      return {
        game: call.payload.game,
        market: call.payload.market,
        pick: call.payload.pick,
        currentGrade: call.payload.currentGrade,
        originalPlayGrade: call.payload.currentGrade,
        rebuiltGrade,
        actionVsOriginal: review && rebuiltGrade ? gradeDirection(call.payload.currentGrade, rebuiltGrade) : null,
        aiGrade: rebuiltGrade,
        aiDirection: review && rebuiltGrade ? gradeDirection(call.payload.currentGrade, rebuiltGrade) : null,
        sharpGradeRebuild: rebuild,
        originalMarketRead: call.payload.marketRead?.status ?? null,
        aiMarketRead: review?.market_read_review.recommendedMarketRead ?? null,
        memberCopy: review?.market_read_review.memberCopy ?? null,
        promotionCandidate: call.payload.promotionScanner.promotionCandidate,
        promotionDecision: review?.promotion_candidate_review ?? null,
        bettingValueSummary: review?.betting_value_review?.summary ?? null,
        playGradeSummary: review?.play_grade_review.summary ?? null,
        issueMateriality: review?.issue_materiality ?? [],
        validationErrors: call.validationErrors,
      };
    }),
    expectedValidationRulesByMarket: {
      moneyline: exampleFor(predictionPayloads, "moneyline_prediction_analyst")?.validationRules ?? [],
      total: exampleFor(predictionPayloads, "total_prediction_analyst")?.validationRules ?? [],
      firstInning: exampleFor(predictionPayloads, "first_inning_prediction_analyst")?.validationRules ?? [],
    },
    gameCardCoherenceCheck: {
      deterministicOnly: true,
      decidesGrades: false,
      checks: [
        "ML copy matches ML review.",
        "Total copy matches Total review.",
        "FI copy matches FI review.",
        "No contradictions between prediction copy blocks.",
        "Provider names hidden.",
        "Each market uses its own correct source model.",
      ],
    },
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("Prediction-Level Market Analyst Preview");
  console.log("No OpenAI calls. No live changes. No member-facing changes.");
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
