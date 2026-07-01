import crypto from "node:crypto";
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
import { AI_MARKET_ANALYST_CURRENT_SCHEMA } from "@/lib/services/aiAuditor/marketAnalystSchema";
import {
  AI_SHARP_ANALYST_V3_VARIANT,
  buildSharpAnalystMemoryModules,
  buildSharpAnalystV3SystemPrompt,
  buildSharpAnalystV3UserContext,
  loadSharpAnalystResearchPack,
  marketMemoryForPayload,
  sharpAnalystPrinciples,
  type SharpAnalystMarket,
  type SharpAnalystMemoryModule,
} from "@/lib/services/aiAuditor/sharpAnalystMemory";
import { scanPromotionCandidate } from "@/lib/services/aiAuditor/promotionCandidateScanner";
import { currentMonthKey, insertAiAuditLedger } from "@/lib/services/aiAuditCostControl";
import type { Sport } from "@/lib/types/domain/Sport";

const PLAY_GRADES = ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"] as const;
const MARKET_READS = ["aligned", "mixed", "resistance", "consensus_support", "consensus_resistance", "no_clear_signal", "insufficient_data"] as const;
type PlayGrade = typeof PLAY_GRADES[number];
type MarketRead = typeof MARKET_READS[number];
type Mode = "dry-run" | "paid-sample";
type Variant = "ai_market_analyst_current_v1" | typeof AI_SHARP_ANALYST_V3_VARIANT;

type Args = {
  sport: Sport;
  date: string;
  markets: string;
  mode: Mode;
  limit: number;
  nanoOnly: boolean;
  maxCostUsd: number | null;
  runId: string | null;
  variant: Variant;
  json: boolean;
};

type MarketAnalystMarketReview = {
  market: AiAuditorMarketKey;
  data_integrity_review: {
    status: "pass" | "warn" | "block";
    summary: string;
    criticalDataIssue: boolean;
    nonCriticalDataWarning: boolean;
    issues: string[];
    repair_actions: string[];
    should_affect_grade: boolean;
  };
  market_read_review: {
    status: "pass" | "warn" | "block";
    summary: string;
    currentMarketRead: string;
    recommendedMarketRead: MarketRead;
    memberCopy: string;
    reasonCodes: string[];
    consensusSharpAgreement: string;
    lineMovementSignal: string;
    marketConflictMateriality: "none" | "low" | "medium" | "high";
    sourceConflict: boolean;
  };
  betting_value_review: {
    status: "pass" | "warn" | "block";
    summary: string;
    realModelEdge: boolean;
    pricePlayable: boolean;
    edgeLargeEnoughForGrade: boolean;
    marketResistanceMeaningful: boolean;
    goodBetDespiteMixedSignals: boolean;
    modelPickButNotWorthBetting: boolean;
    disciplinedBettorAction: "pass" | "watch" | "lean" | "play";
    promotionCandidate: boolean;
    downgradeCandidate: boolean;
  };
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
    status: "pass" | "warn" | "block";
    summary: string;
    currentPlayGrade: PlayGrade;
    recommendedPlayGrade: PlayGrade;
    gradeDirection: "promote" | "downgrade" | "hold";
    bestAngleUpgradeForEvaluationOnly: boolean;
  };
  issue_materiality: Array<{
    issue_type: string;
    severity: "info" | "low" | "medium" | "high" | "block";
    materiality_to_bet: "low" | "medium" | "high";
    should_affect_grade: boolean;
    direction: "downgrade" | "promote" | "hold" | "copy_only" | "data_repair";
    message: string;
  }>;
  recommended_actions: string[];
  safe_copy_fixes: Array<{ field: string; replacement: string; reason: string }>;
  repair_actions: string[];
  confidence: number;
  severity: "info" | "low" | "medium" | "high" | "block";
};

type MarketAnalystResult = {
  market_reviews: MarketAnalystMarketReview[];
  card_coherence_review: {
    status: "pass" | "warn" | "block";
    summary: string;
    quickReadMatchesMarketRead: boolean;
    playGradeMatchesMarketRead: boolean;
    supportingEvidenceMatchesSplits: boolean;
    providerNameLeak: boolean;
    contradictions: string[];
  };
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
  safe_copy_fixes: Array<{ market: AiAuditorMarketKey | "card"; field: string; replacement: string; reason: string }>;
  provider_name_check: { provider_names_present: boolean; offending_terms: string[] };
  confidence: number;
  severity: "info" | "low" | "medium" | "high" | "block";
};

type AnalystCall = {
  payload: AiAuditorPayloadEstimate;
  result: MarketAnalystResult | null;
  validationErrors: string[];
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  actualCostUsd: number | null;
  ledgerId: string | null;
  evaluationRowsLogged: number;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sport: "mlb",
    date: todayIso(),
    markets: "ML,TOTAL,FI",
    mode: "dry-run",
    limit: 500,
    nanoOnly: false,
    maxCostUsd: null,
    runId: null,
    variant: "ai_market_analyst_current_v1",
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
    if (key === "limit") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Invalid --limit=${value}`);
      out.limit = Math.ceil(parsed);
    }
    if (key === "max-cost-usd") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid --max-cost-usd=${value}`);
      out.maxCostUsd = parsed;
    }
    if (key === "run-id") out.runId = value.trim() || null;
    if (key === "variant") {
      if (value !== "ai_market_analyst_current_v1" && value !== AI_SHARP_ANALYST_V3_VARIANT) {
        throw new Error(`Unsupported --variant=${value}`);
      }
      out.variant = value as Variant;
    }
  }
  return out;
}

function money(value: number): string {
  return `$${value.toFixed(4)}`;
}

function inc(map: Record<string, number>, key: string | null | undefined): void {
  map[key ?? "unknown"] = (map[key ?? "unknown"] ?? 0) + 1;
}

function gradeRank(grade: string | null | undefined): number {
  return PLAY_GRADES.findIndex((value) => value === grade);
}

function gradeDirection(original: string | null | undefined, recommended: string | null | undefined): "promotion" | "downgrade" | "hold" {
  const a = gradeRank(original);
  const b = gradeRank(recommended);
  if (a < 0 || b < 0 || a === b) return "hold";
  return b > a ? "promotion" : "downgrade";
}

function defaultRunId(args: Args): string {
  const seed = `${args.sport}:${args.date}:${args.markets}:${args.variant}:${Date.now()}:${crypto.randomUUID()}`;
  return ["ai-market-analyst-current", args.sport, args.date, args.variant, crypto.createHash("sha1").update(seed).digest("hex").slice(0, 10)].join("_");
}

function envFalse(name: string): boolean {
  return process.env[name] === "false" || process.env[name] === undefined || process.env[name] === "";
}

function assertPaidGate(args: Args, estimatedCost: number): void {
  if (args.mode === "dry-run") return;
  if (process.env.AI_MARKET_ANALYST_CURRENT_ENABLED !== "true") {
    throw new Error("Current paid evaluation is disabled. Set AI_MARKET_ANALYST_CURRENT_ENABLED=true only after explicit approval.");
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("paid-sample requires OPENAI_API_KEY.");
  if (!args.nanoOnly) throw new Error("paid-sample requires --nano-only; mini escalation is not enabled.");
  if (process.env.AI_AUDITOR_DISABLE_GPT55_LIVE === "false") throw new Error("GPT-5.5 live disable guard must remain enabled.");
  if (!envFalse("AI_AUDITOR_GUARDED_LIVE_QC")) throw new Error("AI_AUDITOR_GUARDED_LIVE_QC must be false.");
  if (!envFalse("AI_AUDITOR_APPLY_SAFE_COPY_FIXES")) throw new Error("AI_AUDITOR_APPLY_SAFE_COPY_FIXES must be false.");
  if (!envFalse("AI_AUDITOR_APPLY_GUARDED_DOWNGRADES")) throw new Error("AI_AUDITOR_APPLY_GUARDED_DOWNGRADES must be false.");
  if (!envFalse("AI_AUDITOR_ALLOW_PICK_FLIPS")) throw new Error("AI_AUDITOR_ALLOW_PICK_FLIPS must be false.");
  if (!envFalse("AI_AUDITOR_ALLOW_PROBABILITY_CHANGES")) throw new Error("AI_AUDITOR_ALLOW_PROBABILITY_CHANGES must be false.");
  const envCap = Number(process.env.AI_MARKET_ANALYST_CURRENT_HARD_CAP_USD ?? process.env.AI_AUDITOR_PAID_REPLAY_HARD_CAP_USD ?? 5);
  const cap = args.maxCostUsd ?? (Number.isFinite(envCap) && envCap > 0 ? envCap : 5);
  if (estimatedCost > cap) throw new Error(`Estimated current evaluation cost ${money(estimatedCost)} exceeds hard cap ${money(cap)}.`);
}

function forbiddenPayloadLeakage(payload: AiAuditorPayloadEstimate): string[] {
  const json = JSON.stringify(payload.payload).toLowerCase();
  return ["finalscore", "pickresult", "gradeunits", "winner", "roi", "\"result\""].filter((term) => json.includes(term));
}

function systemPrompt(variant: Variant): string {
  if (variant === AI_SHARP_ANALYST_V3_VARIANT) return buildSharpAnalystV3SystemPrompt();
  return [
    "You are the OddSphere Market Analyst AI in evaluation mode.",
    "You review current or pre-lock Daily Edge game cards. You are not a deterministic downgrade governor.",
    "Make no member-facing changes. applied=false. You only log recommendations.",
    "Use only the provided canonical recommendationDecision/card payload. Never invent missing data.",
    "Never use postgame results, final score, winner, graded result, units, or ROI. If present, flag leakage.",
    "Never flip picks, change model probabilities, change projected scores, or expose provider names.",
    "Provider-safe public labels are Consensus Splits, Sharp Book Splits, Sharp Book Signal, and Market Read.",
    "Evaluate each market separately: Data Integrity, Market Read, Betting Value, Play Grade, and card coherence.",
    "Act as an OddSphere betting analyst with a sharp bettor lens, not only a safety auditor.",
    "Mixed market does not automatically mean Caution. Market Resistance does not automatically mean No Play.",
    "A strong model edge can override resistance, but copy must honestly say model-edge override rather than Market Support.",
    "Missing FI market signal does not downgrade FI Lean by itself.",
    "Downgrade only for material EV, price, data, reliability, or risk/reward issues.",
    "Promote when edge, price, data quality, and market context justify it; this is evaluation only and will not be applied live.",
    "Play Grade definitions: No Play means no edge, bad price, bad risk/reward, critical issue, or non-actionable. Caution means elevated risk. Watchlist means maybe later. Lean means real playable edge. Best Angle means strongest actionable setup.",
    "ML: emphasize price/juice, favorite-dog risk, true edge, and market resistance.",
    "Totals: emphasize model crossing the number, edge, line movement, Over/Under direction, and avoid over-penalizing split noise.",
    "FI: protect Lean unless starter/lineup/stale/price/thin edge or real opposing signal is material.",
    "Return strict JSON only.",
  ].join("\n");
}

function marketMemoryForMarkets(payload: AiAuditorPayloadEstimate, modules: Record<SharpAnalystMarket, SharpAnalystMemoryModule>) {
  const seen = new Set<SharpAnalystMarket>();
  return payload.payload.markets.flatMap((market) => {
    if (seen.has(market.market)) return [];
    seen.add(market.market);
    return [marketMemoryForPayload(market, modules)];
  });
}

function userPayload(payload: AiAuditorPayloadEstimate, variant: Variant, memoryModules: Record<SharpAnalystMarket, SharpAnalystMemoryModule> | null): string {
  if (variant === AI_SHARP_ANALYST_V3_VARIANT) {
    if (!memoryModules) throw new Error("v3 sharp analyst memory modules were not loaded.");
    return JSON.stringify(buildSharpAnalystV3UserContext({
      cardPayload: payload.payload,
      marketMemories: marketMemoryForMarkets(payload, memoryModules),
      principles: sharpAnalystPrinciples(),
    }));
  }
  return JSON.stringify({
    run_context: {
      variant,
      current_card_evaluation: true,
      applied: false,
      live_guarded_qc_enabled: false,
      nano_only: true,
      no_member_facing_changes: true,
      no_pick_flips: true,
      no_probability_changes: true,
      no_projected_score_changes: true,
      no_live_best_angle_upgrades: true,
      no_postgame_results_in_payload: true,
    },
    evaluation_jobs: [
      "Data Gap / Data Integrity Review",
      "Market Read Review",
      "Betting Value / sharp bettor lens",
      "Play Grade Review",
      "Whole-Card Coherence Review",
    ],
    blind_current_card_payload: payload.payload,
  });
}

function tokenEstimate(value: unknown): number {
  return Math.ceil(Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8") / 4);
}

function estimatedPayloadCost(
  payload: AiAuditorPayloadEstimate,
  variant: Variant,
  memoryModules: Record<SharpAnalystMarket, SharpAnalystMemoryModule> | null,
  pricing: { nanoInputUsdPerMillion: number; nanoOutputUsdPerMillion: number },
) {
  const inputTokens = variant === AI_SHARP_ANALYST_V3_VARIANT
    ? tokenEstimate(systemPrompt(variant)) + tokenEstimate(userPayload(payload, variant, memoryModules))
    : payload.estimatedInputTokens;
  const outputTokens = payload.estimatedOutputTokens;
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens, pricing.nanoInputUsdPerMillion, pricing.nanoOutputUsdPerMillion),
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

async function callOpenAiMarketAnalyst(
  payload: AiAuditorPayloadEstimate,
  variant: Variant,
  memoryModules: Record<SharpAnalystMarket, SharpAnalystMemoryModule> | null,
): Promise<{
  result: MarketAnalystResult | null;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number;
}> {
  const pricing = resolveAiAuditorPricing();
  if (pricing.nanoModel.toLowerCase().includes("gpt-5.5")) throw new Error("GPT-5.5 is blocked for current market analyst evaluations.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: pricing.nanoModel,
      input: [
        { role: "system", content: systemPrompt(variant) },
        { role: "user", content: userPayload(payload, variant, memoryModules) },
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
  if (!response.ok) throw new Error(`OpenAI current market analyst call failed: HTTP ${response.status} ${JSON.stringify(json)}`);
  const text = parseOutputText(json);
  const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  const inputTokens = Number(usage?.input_tokens ?? payload.estimatedInputTokens);
  const outputTokens = Number(usage?.output_tokens ?? payload.estimatedOutputTokens);
  return {
    result: JSON.parse(text) as MarketAnalystResult,
    inputTokens,
    outputTokens,
    actualCostUsd: estimateCostUsd(inputTokens, outputTokens, pricing.nanoInputUsdPerMillion, pricing.nanoOutputUsdPerMillion),
  };
}

function validateResult(result: MarketAnalystResult | null, payload: AiAuditorPayloadEstimate): string[] {
  const errors: string[] = [];
  if (!result) return ["invalid_json"];
  const payloadMarkets = new Set(payload.markets);
  const reads = new Set<string>(MARKET_READS);
  const grades = new Set<string>(PLAY_GRADES);
  if (!Array.isArray(result.market_reviews) || result.market_reviews.length === 0) errors.push("missing_market_reviews");
  for (const review of result.market_reviews ?? []) {
    if (!payloadMarkets.has(review.market)) errors.push(`market_review_not_in_payload:${review.market}`);
    if (!reads.has(review.market_read_review.recommendedMarketRead)) errors.push(`invalid_market_read:${review.market}`);
    if (!grades.has(review.play_grade_review.recommendedPlayGrade)) errors.push(`invalid_grade:${review.market}`);
    const market = payload.payload.markets.find((row) => row.market === review.market);
    if (!market) continue;
    if (review.play_grade_review.currentPlayGrade !== market.playGrade) errors.push(`grade_echo_mismatch:${review.market}`);
    errors.push(...validateMarketReadLabel(market, review));
    errors.push(...validateFiMateriality(market, review));
    errors.push(...validatePromotionUnderreach(market, review));
  }
  if (result.provider_name_check.provider_names_present || result.safety_review.provider_names_present || result.card_coherence_review.providerNameLeak) errors.push("provider_name_leak");
  if (result.safety_review.postgame_data_present) errors.push("postgame_leakage_claimed");
  if (result.safety_review.invented_data_detected) errors.push("invented_data_claimed");
  if (result.safety_review.attempted_pick_flip) errors.push("attempted_pick_flip");
  if (result.safety_review.attempted_probability_change) errors.push("attempted_probability_change");
  if (result.safety_review.attempted_projected_score_change) errors.push("attempted_projected_score_change");
  if (result.safety_review.attempted_live_apply_change) errors.push("attempted_live_apply_change");
  return errors;
}

function hasFullPriceModelContext(market: AiAuditorCompactMarketPayload): boolean {
  return market.displayPriceAmerican !== null &&
    market.modelProbabilityPct !== null &&
    market.marketProbabilityPct !== null &&
    market.modelMarketGapPct !== null;
}

function hasSourceData(market: AiAuditorCompactMarketPayload): boolean {
  return market.consensusSplits !== null || market.sharpBookSplits !== null;
}

function validateMarketReadLabel(market: AiAuditorCompactMarketPayload, review: MarketAnalystMarketReview): string[] {
  const read = review.market_read_review.recommendedMarketRead;
  const errors: string[] = [];
  if (market.market !== "first_inning") {
    if (hasFullPriceModelContext(market) && market.consensusSplits !== null && market.sharpBookSplits !== null && read === "insufficient_data") {
      errors.push(`market_read_label_invalid:${market.market}:sources_and_core_fields_present`);
    }
    if (hasSourceData(market) && market.sourceConflict && read !== "mixed") {
      errors.push(`market_read_label_invalid:${market.market}:source_conflict_not_mixed`);
    }
    if (hasSourceData(market) && market.marketRead?.status?.includes("resistance") && read === "insufficient_data") {
      errors.push(`market_read_label_invalid:${market.market}:resistance_as_insufficient_data`);
    }
  } else if (
    market.displayPriceAmerican !== null &&
    market.modelProbabilityPct !== null &&
    market.marketProbabilityPct !== null &&
    market.modelMarketGapPct !== null &&
    market.fiContext.expectedRunsAvailable &&
    read === "insufficient_data"
  ) {
    errors.push("market_read_label_invalid:first_inning:core_fields_present_missing_splits_expected");
  }
  return errors;
}

function validateFiMateriality(market: AiAuditorCompactMarketPayload, review: MarketAnalystMarketReview): string[] {
  if (market.market !== "first_inning") return [];
  const splitIssues = review.issue_materiality.filter((issue) => {
    const text = `${issue.issue_type} ${issue.message}`.toLowerCase();
    return text.includes("split") || text.includes("sharp") || text.includes("source");
  });
  if (splitIssues.length === 0) return [];
  const highMaterialOtherIssue = review.issue_materiality.some((issue) => {
    const text = `${issue.issue_type} ${issue.message}`.toLowerCase();
    const isSplit = text.includes("split") || text.includes("sharp") || text.includes("source");
    const recognized = /starter|lineup|stale|price|juice|thin edge|edge below|opposing signal|unplayable|missing price/.test(text);
    return !isSplit && recognized && (issue.materiality_to_bet === "high" || issue.severity === "high" || issue.severity === "block" || issue.should_affect_grade);
  });
  const overweighted = splitIssues.some((issue) => issue.should_affect_grade || issue.materiality_to_bet !== "low") && !highMaterialOtherIssue;
  return overweighted ? ["fi_missing_source_overweighted:first_inning"] : [];
}

function validatePromotionUnderreach(market: AiAuditorCompactMarketPayload, review: MarketAnalystMarketReview): string[] {
  const scan = scanPromotionCandidate(market);
  if (!scan.promotionCandidate) return [];
  const direction = gradeDirection(market.playGrade, review.play_grade_review.recommendedPlayGrade);
  const blockerMateriality = review.promotion_candidate_review?.blockerMateriality;
  const missingPromotionReview = !review.promotion_candidate_review?.promotionCandidateReviewed;
  if (direction !== "promotion" && (missingPromotionReview || blockerMateriality === "low")) {
    return [`promotion_underreach:${market.market}`];
  }
  if (
    scan.maxCandidateGrade === "Lean" &&
    gradeRank(review.play_grade_review.recommendedPlayGrade) <= gradeRank(market.playGrade) &&
    blockerMateriality !== "medium" &&
    blockerMateriality !== "high"
  ) {
    return [`promotion_underreach:${market.market}:lean_candidate_without_material_blocker`];
  }
  return [];
}

function reviewFor(call: AnalystCall, market: AiAuditorCompactMarketPayload): MarketAnalystMarketReview | null {
  return call.result?.market_reviews.find((review) => review.market === market.market) ?? null;
}

async function logLedger(payload: AiAuditorPayloadEstimate, call: AnalystCall): Promise<string | null> {
  return await insertAiAuditLedger({
    month_key: currentMonthKey(),
    sport: payload.sport,
    slate_date: payload.date,
    game_id: payload.gameId,
    audit_scope: "current_market_analyst_evaluation",
    payload_hash: payload.payloadHash,
    from_cache: false,
    skipped_reason: null,
    model: resolveAiAuditorPricing().nanoModel,
    input_tokens: call.inputTokens,
    output_tokens: call.outputTokens,
    estimated_cost_usd: call.estimatedCostUsd,
    actual_cost_usd: call.actualCostUsd,
    status: call.validationErrors.length > 0 ? "block" : (call.result?.severity === "block" ? "block" : call.result?.severity === "high" ? "warn" : "pass"),
    severity: call.result?.severity ?? (call.validationErrors.length > 0 ? "block" : "info"),
    recommended_actions: [
      ...(call.result?.recommended_actions ?? []),
      ...call.validationErrors.map((error) => `validation:${error}`),
    ],
    escalation: false,
    applied: false,
  });
}

function materiality(review: MarketAnalystMarketReview | null) {
  return (review?.issue_materiality ?? []).map((issue) => ({
    code: issue.issue_type,
    severity: issue.severity,
    materiality_to_bet: issue.materiality_to_bet,
    should_affect_grade: issue.should_affect_grade,
    direction: issue.direction,
  }));
}

async function logEvaluationRows(args: {
  runId: string;
  variant: Variant;
  calls: AnalystCall[];
}): Promise<number> {
  const { supabase } = await import("@/lib/db/supabase");
  const rows = args.calls.flatMap((call) => {
    if (!call.result) return [];
    return call.payload.payload.markets.map((market) => {
      const review = reviewFor(call, market);
      const aiGrade = review?.play_grade_review.recommendedPlayGrade ?? null;
      const aiRead = review?.market_read_review.recommendedMarketRead ?? null;
      return {
        run_id: args.runId,
        variant: args.variant,
        audit_scope: "current_market_analyst_evaluation",
        ledger_id: call.ledgerId,
        applied: false,
        sport: call.payload.sport,
        slate_date: call.payload.date,
        game_id: call.payload.gameId,
        external_id: call.payload.externalId,
        matchup: call.payload.matchup,
        market: market.market,
        payload_hash: call.payload.payloadHash,
        original_pick: market.pick,
        original_grade: market.playGrade,
        original_market_read: market.marketRead?.status ?? null,
        original_model_probability: market.modelProbabilityPct,
        original_edge: market.modelMarketGapPct,
        original_price: market.displayPriceAmerican,
        original_recommendation_confidence: null,
        ai_recommended_grade: aiGrade,
        ai_recommended_market_read: aiRead,
        ai_recommendation_direction: gradeDirection(market.playGrade, aiGrade),
        downgrade_promotion_reason: review?.play_grade_review.summary ?? null,
        data_integrity_review: review?.data_integrity_review ?? {},
        market_read_review: review?.market_read_review ?? {},
        play_grade_review: review?.play_grade_review ?? {},
        betting_value_review: review?.betting_value_review ?? {},
        card_coherence_review: call.result?.card_coherence_review ?? {},
        safety_review: call.result?.safety_review ?? {},
        market_reviews: call.result?.market_reviews ?? [],
        issues: review?.issue_materiality ?? [],
        issue_materiality_scores: materiality(review),
        reason_codes: Array.from(new Set([...(market.reasonCodes ?? []), ...(review?.market_read_review.reasonCodes ?? [])])),
        recommended_actions: review?.recommended_actions ?? [],
        safe_copy_fixes: [...(review?.safe_copy_fixes ?? []), ...(call.result?.safe_copy_fixes ?? [])],
        repair_actions: review?.repair_actions ?? [],
        full_ai_output: call.result ?? {},
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
        status: call.validationErrors.length > 0 ? "block" : (call.result?.severity === "block" ? "block" : call.result?.severity === "high" ? "warn" : "pass"),
        severity: review?.severity ?? call.result?.severity ?? null,
      };
    });
  });
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("ai_audit_evaluation_results").insert(rows);
  if (error) throw new Error(`ai_audit_evaluation_results insert failed: ${error.message}`);
  return rows.length;
}

function summarizeOriginal(payloads: AiAuditorPayloadEstimate[]) {
  const grade: Record<string, number> = {};
  const read: Record<string, number> = {};
  const sourceConflict: Record<string, number> = {};
  for (const payload of payloads) {
    for (const market of payload.payload.markets) {
      inc(grade, market.playGrade);
      inc(read, market.marketRead?.status);
      if (market.sourceConflict) inc(sourceConflict, market.market);
    }
  }
  return { grade, read, sourceConflict };
}

function dataCompleteness(payloads: AiAuditorPayloadEstimate[]) {
  const out: Record<string, Record<string, string>> = {};
  for (const key of ["moneyline", "total", "first_inning"] as AiAuditorMarketKey[]) {
    const rows = payloads.flatMap((payload) => payload.payload.markets.filter((market) => market.market === key));
    const pct = (n: number) => rows.length === 0 ? "0/0 = n/a" : `${n}/${rows.length} = ${(n / rows.length * 100).toFixed(1)}%`;
    out[key] = {
      rows: String(rows.length),
      price: pct(rows.filter((row) => row.displayPriceAmerican !== null).length),
      modelProbability: pct(rows.filter((row) => row.modelProbabilityPct !== null).length),
      edge: pct(rows.filter((row) => row.modelMarketGapPct !== null).length),
      marketImplied: pct(rows.filter((row) => row.marketProbabilityPct !== null).length),
      consensus: pct(rows.filter((row) => row.consensusSplits !== null).length),
      sharp: pct(rows.filter((row) => row.sharpBookSplits !== null).length),
      movement: pct(rows.filter((row) => row.lineMovement.displayCurrentAmerican !== null || row.lineMovement.openAmerican !== null || row.lineMovement.directionRelativeToPick !== null).length),
      fiContext: key === "first_inning" ? pct(rows.filter((row) => row.fiContext.isFirstInning).length) : "n/a",
    };
  }
  return out;
}

function consensusSharpRead(market: AiAuditorCompactMarketPayload) {
  return {
    consensusPresent: market.consensusSplits !== null,
    sharpPresent: market.sharpBookSplits !== null,
    sourceConflict: market.sourceConflict,
    reasonCodes: market.reasonCodes ?? [],
  };
}

function candidateDetails(calls: AnalystCall[], direction: "promotion" | "downgrade") {
  const out: Array<Record<string, unknown>> = [];
  for (const call of calls) {
    for (const market of call.payload.payload.markets) {
      const review = reviewFor(call, market);
      if (!review) continue;
      if (gradeDirection(market.playGrade, review.play_grade_review.recommendedPlayGrade) !== direction) continue;
      out.push({
        game: call.payload.matchup,
        market: market.market,
        pick: market.pick,
        currentGrade: market.playGrade,
        aiGrade: review.play_grade_review.recommendedPlayGrade,
        price: market.displayPriceAmerican,
        modelProbability: market.modelProbabilityPct,
        edge: market.modelMarketGapPct,
        marketImplied: market.marketProbabilityPct,
        marketRead: market.marketRead?.status ?? null,
        aiMarketRead: review.market_read_review.recommendedMarketRead,
        consensusSharp: consensusSharpRead(market),
        movement: market.lineMovement,
        marketMemoryReason: market.deterministicPreScore?.notes ?? [],
        bettingValueReason: review.betting_value_review.summary,
        issueMateriality: review.issue_materiality,
        blockers: review.issue_materiality
          .filter((issue) => issue.direction === "hold" || issue.direction === "downgrade" || issue.severity === "block")
          .map((issue) => issue.message),
        reason: review.play_grade_review.summary,
      });
    }
  }
  return out;
}

function fiBehavior(calls: AnalystCall[]) {
  const rows = calls.flatMap((call) => call.payload.payload.markets
    .filter((market) => market.market === "first_inning")
    .map((market) => ({ call, market, review: reviewFor(call, market) }))
    .filter((row) => row.review));
  return {
    rows: rows.length,
    missingFiSplitsMaterialByItself: rows.filter(({ review }) => (review?.issue_materiality ?? []).some((issue) => {
      const text = `${issue.issue_type} ${issue.message}`.toLowerCase();
      return text.includes("missing") && text.includes("split") && issue.should_affect_grade;
    })).length,
    fiLeanDowngrades: rows.filter(({ market, review }) => market.playGrade === "Lean" && gradeDirection(market.playGrade, review?.play_grade_review.recommendedPlayGrade) === "downgrade").map(({ call, market, review }) => ({
      game: call.payload.matchup,
      pick: market.pick,
      price: market.displayPriceAmerican,
      edge: market.modelMarketGapPct,
      aiGrade: review?.play_grade_review.recommendedPlayGrade,
      reason: review?.play_grade_review.summary,
      materiality: review?.issue_materiality ?? [],
    })),
    fiPromotions: rows.filter(({ market, review }) => gradeDirection(market.playGrade, review?.play_grade_review.recommendedPlayGrade) === "promotion").map(({ call, market, review }) => ({
      game: call.payload.matchup,
      pick: market.pick,
      currentGrade: market.playGrade,
      aiGrade: review?.play_grade_review.recommendedPlayGrade,
      price: market.displayPriceAmerican,
      edge: market.modelMarketGapPct,
      reason: review?.play_grade_review.summary,
    })),
  };
}

function summarizeCalls(calls: AnalystCall[]) {
  const aiGrade: Record<string, number> = {};
  const aiRead: Record<string, number> = {};
  const directions: Record<string, number> = {};
  const marketReadDisagreements: string[] = [];
  const examples: Record<string, string[]> = {
    promotions: [],
    downgrades: [],
    holds: [],
    marketReadDisagreements: [],
    copyFixes: [],
    contradictions: [],
  };
  let providerLeaks = 0;
  let postgameLeaks = 0;
  let inventedData = 0;
  let attemptedChanges = 0;
  let schemaFailures = 0;
  const validationErrorsByCode: Record<string, number> = {};
  for (const call of calls) {
    if (call.validationErrors.length > 0) schemaFailures += 1;
    for (const error of call.validationErrors) {
      const code = error.split(":")[0] ?? error;
      inc(validationErrorsByCode, code);
    }
    if (call.result?.provider_name_check.provider_names_present || call.result?.safety_review.provider_names_present) providerLeaks += 1;
    if (call.result?.safety_review.postgame_data_present) postgameLeaks += 1;
    if (call.result?.safety_review.invented_data_detected) inventedData += 1;
    if (
      call.result?.safety_review.attempted_pick_flip ||
      call.result?.safety_review.attempted_probability_change ||
      call.result?.safety_review.attempted_projected_score_change ||
      call.result?.safety_review.attempted_live_apply_change
    ) attemptedChanges += 1;
    for (const market of call.payload.payload.markets) {
      const review = reviewFor(call, market);
      if (!review) continue;
      inc(aiGrade, review.play_grade_review.recommendedPlayGrade);
      inc(aiRead, review.market_read_review.recommendedMarketRead);
      const direction = gradeDirection(market.playGrade, review.play_grade_review.recommendedPlayGrade);
      inc(directions, direction);
      const label = `${call.payload.date} ${call.payload.matchup} ${market.market}: ${market.playGrade}->${review.play_grade_review.recommendedPlayGrade}; ${market.marketRead?.status ?? "unknown"}->${review.market_read_review.recommendedMarketRead}`;
      if (direction === "promotion" && examples.promotions.length < 5) examples.promotions.push(label);
      if (direction === "downgrade" && examples.downgrades.length < 5) examples.downgrades.push(label);
      if (direction === "hold" && examples.holds.length < 5) examples.holds.push(label);
      if ((market.marketRead?.status ?? "unknown") !== review.market_read_review.recommendedMarketRead) {
        marketReadDisagreements.push(label);
        if (examples.marketReadDisagreements.length < 5) examples.marketReadDisagreements.push(label);
      }
      if (review.safe_copy_fixes.length > 0 && examples.copyFixes.length < 5) examples.copyFixes.push(`${label}; copy=${review.safe_copy_fixes.map((fix) => fix.field).join(",")}`);
    }
    for (const contradiction of call.result?.card_coherence_review.contradictions ?? []) {
      if (examples.contradictions.length < 5) examples.contradictions.push(`${call.payload.date} ${call.payload.matchup}: ${contradiction}`);
    }
  }
  return {
    aiGrade,
    aiRead,
    directions,
    marketReadDisagreements: marketReadDisagreements.length,
    safety: { schemaFailures, providerLeaks, postgameLeaks, inventedData, attemptedChanges, validationErrorsByCode },
    examples,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const markets = parseAiAuditorMarkets(args.markets);
  const researchPack = args.variant === AI_SHARP_ANALYST_V3_VARIANT ? loadSharpAnalystResearchPack() : null;
  const memoryModules = researchPack ? buildSharpAnalystMemoryModules(researchPack) : null;
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
  const payloads = preview.payloads.slice(0, args.limit);
  const estimatedCost = +payloads.reduce((sum, payload) => {
    return sum + estimatedPayloadCost(payload, args.variant, memoryModules, preview.pricing).estimatedCostUsd;
  }, 0).toFixed(6);
  const leakage = payloads.flatMap((payload) => forbiddenPayloadLeakage(payload).map((term) => `${payload.matchup}:${term}`));
  if (leakage.length > 0) throw new Error(`Postgame/result-like fields found in AI payload: ${leakage.join(", ")}`);
  assertPaidGate(args, estimatedCost);
  const runId = args.runId ?? defaultRunId(args);
  const original = summarizeOriginal(payloads);
  const calls: AnalystCall[] = [];
  let repeatedFailures = 0;

  for (const payload of payloads) {
    const estimate = estimatedPayloadCost(payload, args.variant, memoryModules, preview.pricing);
    let result: MarketAnalystResult | null = null;
    let inputTokens = estimate.inputTokens;
    let outputTokens = estimate.outputTokens;
    let actualCostUsd: number | null = null;
    if (args.mode === "paid-sample") {
      const response = await callOpenAiMarketAnalyst(payload, args.variant, memoryModules);
      result = response.result;
      inputTokens = response.inputTokens;
      outputTokens = response.outputTokens;
      actualCostUsd = response.actualCostUsd;
    }
    const call: AnalystCall = {
      payload,
      result,
      validationErrors: args.mode === "dry-run" ? ["dry_run_no_ai_output"] : validateResult(result, payload),
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimate.estimatedCostUsd,
      actualCostUsd,
      ledgerId: null,
      evaluationRowsLogged: 0,
    };
    if (args.mode === "paid-sample") {
      if (call.validationErrors.length > 0) repeatedFailures += 1;
      call.ledgerId = await logLedger(payload, call);
    }
    calls.push(call);
    if (args.mode === "paid-sample" && repeatedFailures >= 3) {
      throw new Error(`Stopping after repeated schema/safety failures: ${call.validationErrors.join(", ")}`);
    }
  }

  let rowsLogged = 0;
  if (args.mode === "paid-sample") {
    rowsLogged = await logEvaluationRows({ runId, variant: args.variant, calls });
    for (const call of calls) call.evaluationRowsLogged = call.result ? call.payload.marketCount : 0;
  }

  const paidSummary = args.mode === "paid-sample" ? summarizeCalls(calls) : null;
  const actualCost = +calls.reduce((sum, call) => sum + Number(call.actualCostUsd ?? 0), 0).toFixed(6);
  const report = {
    mode: args.mode,
    runId,
    variant: args.variant,
    noLiveChanges: true,
    noMemberFacingChanges: true,
    appliedRows: 0,
    sport: args.sport,
    date: args.date,
    model: preview.pricing.nanoModel,
    pricingMode: preview.pricing.pricingMode,
    cardsReviewed: payloads.length,
    marketsReviewed: payloads.reduce((sum, payload) => sum + payload.marketCount, 0),
    estimatedCostUsd: estimatedCost,
    actualCostUsd: actualCost,
    ledgerRowsWritten: calls.filter((call) => call.ledgerId).length,
    evaluationRowsWritten: rowsLogged,
    dataCompletenessSeenByAi: dataCompleteness(payloads),
    originalGradeDistribution: original.grade,
    originalMarketReadDistribution: original.read,
    originalSourceConflictByMarket: original.sourceConflict,
    aiGradeDistribution: paidSummary?.aiGrade ?? {},
    aiMarketReadDistribution: paidSummary?.aiRead ?? {},
    aiRecommendationDirections: paidSummary?.directions ?? {},
    marketReadDisagreements: paidSummary?.marketReadDisagreements ?? 0,
    promotionCandidates: args.mode === "paid-sample" ? candidateDetails(calls, "promotion") : [],
    downgradeCandidates: args.mode === "paid-sample" ? candidateDetails(calls, "downgrade") : [],
    fiBehavior: args.mode === "paid-sample" ? fiBehavior(calls) : null,
    safety: paidSummary?.safety ?? {
      schemaFailures: 0,
      providerLeaks: 0,
      postgameLeaks: 0,
      inventedData: 0,
      attemptedChanges: 0,
      validationErrorsByCode: {},
    },
    examples: paidSummary?.examples ?? {},
    payloadHashes: payloads.slice(0, 8).map((payload) => ({
      matchup: payload.matchup,
      hash: payload.payloadHash.slice(0, 12),
      markets: payload.markets,
    })),
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`OddSphere Market Analyst Current Evaluation (${args.mode})`);
  console.log(`No live changes. No member-facing changes. applied=false${args.mode === "dry-run" ? ". No OpenAI calls were made." : "."}`);
  console.log(`run_id: ${runId}`);
  console.log(`variant: ${args.variant}`);
  console.log(`model: ${preview.pricing.nanoModel} (${preview.pricing.pricingMode} pricing)`);
  console.log(`cards reviewed: ${report.cardsReviewed}`);
  console.log(`markets reviewed: ${report.marketsReviewed}`);
  console.log(`estimated cost: ${money(report.estimatedCostUsd)}`);
  if (args.mode === "paid-sample") {
    console.log(`actual cost: ${money(report.actualCostUsd)}`);
    console.log(`ledger rows written: ${report.ledgerRowsWritten}`);
    console.log(`evaluation rows written: ${report.evaluationRowsWritten}`);
  }
  console.log(`original grade distribution: ${JSON.stringify(report.originalGradeDistribution)}`);
  console.log(`original Market Read distribution: ${JSON.stringify(report.originalMarketReadDistribution)}`);
  console.log(`data completeness: ${JSON.stringify(report.dataCompletenessSeenByAi)}`);
  if (args.mode === "paid-sample") {
    console.log(`AI grade distribution: ${JSON.stringify(report.aiGradeDistribution)}`);
    console.log(`AI Market Read distribution: ${JSON.stringify(report.aiMarketReadDistribution)}`);
    console.log(`AI directions: ${JSON.stringify(report.aiRecommendationDirections)}`);
    console.log(`Market Read disagreements: ${report.marketReadDisagreements}`);
    console.log(`Promotion candidates: ${JSON.stringify(report.promotionCandidates, null, 2)}`);
    console.log(`Downgrade candidates: ${JSON.stringify(report.downgradeCandidates, null, 2)}`);
    console.log(`FI behavior: ${JSON.stringify(report.fiBehavior, null, 2)}`);
    console.log(`Safety: ${JSON.stringify(report.safety)}`);
    console.log(`Examples: ${JSON.stringify(report.examples, null, 2)}`);
  }
  console.log(`sample payload hashes: ${JSON.stringify(report.payloadHashes)}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
