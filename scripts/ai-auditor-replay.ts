import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import crypto from "node:crypto";
import {
  buildAiAuditorCostPreview,
  buildDailyEdgeResponseForCostPreview,
  eachDateInclusive,
  estimateCostUsd,
  loadExistingAiAuditPayloadHashes,
  parseAiAuditorMarkets,
  resolveAiAuditorPricing,
  type AiAuditorCompactMarketPayload,
  type AiAuditorCostPreviewSummary,
  type AiAuditorPayloadEstimate,
} from "@/lib/services/aiAuditor/costPreview";
import {
  miniEscalationCostUsd,
  summarizeAiAuditorEscalations,
} from "@/lib/services/aiAuditor/escalationRouter";
import { AI_AUDITOR_CARD_AUDIT_SCHEMA } from "@/lib/services/aiAuditor/cardAuditSchema";
import {
  currentMonthKey,
  insertAiAuditLedger,
  resolveAiAuditorBudgetMode,
} from "@/lib/services/aiAuditCostControl";
import type { Sport } from "@/lib/types/domain/Sport";

type ReplayMode = "dry-run" | "paid-sample" | "shadow";
type ReplayVariant = "ai_v1_conservative" | "ai_v2_betting_value" | "ai_v3_market_specific" | "ai_v4_profit_calibrated" | "ai_v5_promotions_enabled";
type MarketReadLabel = "aligned" | "mixed" | "resistance" | "consensus_support" | "consensus_resistance" | "no_clear_signal" | "insufficient_data";
type PlayGradeLabel = typeof PLAY_GRADES[number];
type DataIntegrityStatus = "ok" | "critical_data_issue" | "non_critical_data_warning" | "historical_replay_limitation" | "optional_source_unavailable" | "missing" | "stale" | "partial" | "reversed" | "inconsistent" | "historical_source_not_persisted";
type ReplayMarket = "moneyline" | "total" | "first_inning";
type IssueDirection = "downgrade" | "promote" | "hold" | "copy_only" | "data_repair";

type AiAuditorMarketReview = {
  market: "moneyline" | "total" | "first_inning";
  current_market_read: string;
  recommended_market_read: MarketReadLabel;
  current_play_grade: PlayGradeLabel;
  recommended_play_grade: PlayGradeLabel;
  data_integrity_status: DataIntegrityStatus;
  source_conflict: boolean;
  summary: string;
};

type AiAuditorReplayResult = {
  data_integrity_review: { status: "pass" | "warn" | "block"; summary: string; flags: string[] };
  market_read_review: { status: "pass" | "warn" | "block"; summary: string; current_market_read: string; recommended_market_read: MarketReadLabel };
  play_grade_review: { status: "pass" | "warn" | "block"; summary: string; current_play_grade: PlayGradeLabel; recommended_play_grade: PlayGradeLabel };
  betting_value_review: {
    status: "pass" | "warn" | "block";
    summary: string;
    real_model_edge: boolean;
    price_playable: boolean;
    edge_large_enough_for_grade: boolean;
    market_resistance_meaningful: boolean;
    mixed_market_signal_is_noise: boolean;
    risk_reward_good_enough_for_action: boolean;
    recommended_grade_direction: IssueDirection;
    disciplined_bettor_action: "pass" | "watch" | "lean" | "play";
  };
  full_card_coherence_review: { status: "pass" | "warn" | "block"; summary: string; contradictions: string[] };
  recommended_market_read: MarketReadLabel;
  recommended_play_grade: PlayGradeLabel;
  market_reviews: AiAuditorMarketReview[];
  issues: Array<{
    code: string;
    severity: "info" | "low" | "medium" | "high" | "block";
    materiality_to_bet: "low" | "medium" | "high";
    should_affect_grade: boolean;
    direction: IssueDirection;
    message: string;
  }>;
  recommended_actions: Array<"none" | "apply_copy_fixes" | "downgrade_grade" | "block_card" | "repair_data" | "escalate_to_mini">;
  safe_copy_fixes: Array<{ field: string; replacement: string }>;
  repair_actions: Array<"none" | "rerun_fetch" | "mark_source_unavailable" | "block_card" | "repair_mapping" | "refresh_lineup_or_starter" | "refresh_splits" | "review_price">;
  safety_review: {
    postgame_data_present: boolean;
    provider_names_present: boolean;
    invented_data_detected: boolean;
    invalid_grade_label: boolean;
    attempted_pick_flip: boolean;
    attempted_probability_change: boolean;
    attempted_projected_score_change: boolean;
    attempted_best_angle_upgrade: boolean;
  };
  confidence: number;
  severity: "info" | "low" | "medium" | "high" | "block";
  provider_name_check: { provider_names_present: boolean; offending_terms: string[] };
};

type AiAuditorReplayCall = {
  payload: AiAuditorPayloadEstimate;
  result: AiAuditorReplayResult | null;
  schemaValid: boolean;
  validationErrors: string[];
  status: "pass" | "warn" | "block";
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  actualCostUsd: number | null;
  ledgerLogged: boolean;
  ledgerId: string | null;
  evaluationRowsLogged: number;
};

type ReplayPostgameMarketResult = {
  result: "win" | "loss" | "push" | "void" | "pending" | "unknown";
  gradeUnits: number;
  oddsAmerican: number | null;
  originalPlayGrade: string | null;
};

type ReplayPostgameResultMap = Map<string, ReplayPostgameMarketResult>;

type Args = {
  sport: Sport;
  from: string;
  to: string;
  markets: string;
  limit: number;
  offset: number;
  mode: ReplayMode;
  nanoOnly: boolean;
  json: boolean;
  maxCostUsd: number | null;
  variant: ReplayVariant;
  runId: string | null;
  compareRunIds: string[];
};

const VALID_SPORTS = new Set(["mlb", "nba", "nfl", "cbb", "cfb", "nhl", "ucl", "soccer", "wnba"]);
const VALID_MODES = new Set(["dry-run", "paid-sample", "shadow"]);
const VALID_VARIANTS = new Set(["ai_v1_conservative", "ai_v2_betting_value", "ai_v3_market_specific", "ai_v4_profit_calibrated", "ai_v5_promotions_enabled"]);
const PLAY_GRADES = ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"] as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sport: "mlb",
    from: todayIso(),
    to: todayIso(),
    markets: "ML,TOTAL,FI",
    limit: 500,
    offset: 0,
    mode: "dry-run",
    nanoOnly: false,
    json: false,
    maxCostUsd: null,
    variant: "ai_v2_betting_value",
    runId: null,
    compareRunIds: [],
  };
  for (const arg of argv) {
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    if (arg === "--nano-only") {
      out.nanoOnly = true;
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
    } else if (key === "limit") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Invalid --limit=${value}`);
      out.limit = Math.ceil(parsed);
    } else if (key === "offset") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid --offset=${value}`);
      out.offset = Math.floor(parsed);
    } else if (key === "mode") {
      if (!VALID_MODES.has(value)) throw new Error(`Unsupported replay mode: ${value}`);
      out.mode = value as ReplayMode;
    } else if (key === "max-cost-usd") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid --max-cost-usd=${value}`);
      out.maxCostUsd = parsed;
    } else if (key === "variant") {
      if (!VALID_VARIANTS.has(value)) throw new Error(`Unsupported --variant=${value}`);
      out.variant = value as ReplayVariant;
    } else if (key === "run-id") {
      out.runId = value.trim() || null;
    } else if (key === "compare-run-ids") {
      out.compareRunIds = value.split(",").map((part) => part.trim()).filter(Boolean);
    }
  }
  return out;
}

function defaultRunId(args: Args): string {
  const seed = `${args.sport}:${args.from}:${args.to}:${args.markets}:${args.variant}:${Date.now()}:${crypto.randomUUID()}`;
  return [
    "ai-auditor",
    args.variant,
    args.sport,
    args.from,
    args.to,
    crypto.createHash("sha1").update(seed).digest("hex").slice(0, 10),
  ].join("_");
}

function money(value: number): string {
  return `$${value.toFixed(4)}`;
}

function inc(map: Record<string, number>, key: string | null | undefined): void {
  map[key ?? "unknown"] = (map[key ?? "unknown"] ?? 0) + 1;
}

function cardGrade(payload: AiAuditorPayloadEstimate): string {
  const ranks = new Map<string, number>(PLAY_GRADES.map((grade, i) => [grade, i]));
  return payload.payload.markets
    .map((market) => market.playGrade ?? "unknown")
    .sort((a, b) => (ranks.get(b) ?? -1) - (ranks.get(a) ?? -1))[0] ?? "unknown";
}

function hasStaleOrMissing(payload: AiAuditorPayloadEstimate): boolean {
  const asOf = new Date(payload.payload.asOfTimestamp).getTime();
  const staleCutoffMs = asOf - 6 * 60 * 60 * 1000;
  return payload.payload.markets.some((market) => {
    const consensusRows = (market.consensusSplits as { rows?: Array<{ observedAt?: string | null; isStale?: boolean }> } | null)?.rows ?? [];
    const sharpRows = (market.sharpBookSplits as { rows?: Array<{ observedAt?: string | null; isStale?: boolean }> } | null)?.rows ?? [];
    const staleRelativeToSnapshot = [...consensusRows, ...sharpRows].some((row) => {
      if (!row.observedAt) return false;
      const observed = new Date(row.observedAt).getTime();
      return Number.isFinite(observed) && observed < staleCutoffMs;
    });
    return staleRelativeToSnapshot ||
      market.dataQuality.reviewFlags.some((flag) => /injury|lineup|starter/i.test(flag));
  });
}

function hasBothSplitSources(payload: AiAuditorPayloadEstimate): boolean {
  return payload.payload.markets.some((market) => {
    const sharp = market.sharpBookSplits as { label?: string; rows?: unknown[]; signal?: string | null } | null;
    return Boolean(market.consensusSplits && (sharp?.label || sharp?.signal || (Array.isArray(sharp?.rows) && sharp.rows.length > 0)));
  });
}

function hasSourceConflict(payload: AiAuditorPayloadEstimate): boolean {
  const sourceState = payload.payload.sourceState as { sourceConflict?: boolean } | null;
  return sourceState?.sourceConflict === true || payload.payload.markets.some((market) => market.sourceConflict === true || market.marketRead?.status === "mixed");
}

function hasMarketResistance(payload: AiAuditorPayloadEstimate): boolean {
  return payload.payload.markets.some((market) => market.marketRead?.status === "resistance" || market.marketRead?.status === "consensus_resistance");
}

function hasInsufficientData(payload: AiAuditorPayloadEstimate): boolean {
  return payload.payload.markets.some((market) => market.marketRead?.status === "insufficient_data");
}

function hasNoClearSignal(payload: AiAuditorPayloadEstimate): boolean {
  return payload.payload.markets.some((market) => market.marketRead?.status === "no_clear_signal");
}

function hasHistoricalSourceNotPersisted(payload: AiAuditorPayloadEstimate): boolean {
  return payload.payload.markets.some((market) => Boolean(market.consensusSplits) && !market.sharpBookSplits);
}

function paidReplayGate(args: Args): void {
  if (args.mode === "dry-run") return;
  if (args.mode === "shadow") throw new Error("Live shadow mode is intentionally not wired in this pass.");
  if (process.env.AI_AUDITOR_PAID_REPLAY_ENABLED !== "true") {
    throw new Error("paid-sample is prepared but disabled. Set AI_AUDITOR_PAID_REPLAY_ENABLED=true only after explicit approval.");
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("paid-sample requires OPENAI_API_KEY.");
  if (process.env.AI_AUDITOR_DISABLE_GPT55_LIVE === "false") throw new Error("GPT-5.5 live disable guard must remain enabled.");
  if (!args.nanoOnly) throw new Error("paid-sample currently requires --nano-only; mini escalation stays dry-run only.");
}

function replayHardCapUsd(override: number | null = null): number {
  if (override !== null) return override;
  const parsed = Number(process.env.AI_AUDITOR_PAID_REPLAY_HARD_CAP_USD ?? 5);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function assertPaidReplayCap(preview: AiAuditorCostPreviewSummary, limit: number, maxCostUsd: number | null): void {
  const ratio = preview.payloads.length > 0 ? Math.min(limit, preview.payloads.length) / preview.payloads.length : 0;
  const estimated = +(preview.costScenarios.onePassCostUsd * ratio).toFixed(6);
  const cap = replayHardCapUsd(maxCostUsd);
  if (estimated > cap) {
    throw new Error(`paid-sample estimated cost ${money(estimated)} exceeds AI_AUDITOR_PAID_REPLAY_HARD_CAP_USD=${money(cap)}.`);
  }
}

function originalCardMarketRead(payload: AiAuditorPayloadEstimate): string {
  const reads = payload.payload.markets.map((market) => market.marketRead?.status ?? "unknown");
  if (reads.includes("mixed")) return "mixed";
  if (reads.includes("resistance") || reads.includes("consensus_resistance")) return "resistance";
  if (reads.includes("consensus_support")) return "consensus_support";
  if (reads.includes("aligned")) return "aligned";
  if (reads.includes("no_clear_signal")) return "no_clear_signal";
  if (reads.includes("insufficient_data")) return "insufficient_data";
  return reads[0] ?? "unknown";
}

function forbiddenPayloadLeakage(payload: AiAuditorPayloadEstimate): string[] {
  const json = JSON.stringify(payload.payload).toLowerCase();
  return [
    "finalscore",
    "pickresult",
    "gradeunits",
    "winner",
    "roi",
    "units",
    "\"result\"",
  ].filter((term) => json.includes(term));
}

function cardAuditSystemPrompt(variant: ReplayVariant): string {
  const base = [
    "You are the OddSphere Card Auditor. Evaluate one historical Daily Edge card blindly.",
    "Never use postgame results, final score, winner, units, ROI, or graded result. If present, flag postgame leakage.",
    "You cannot flip picks, change model probabilities, change projected scores, invent missing data, or expose provider names.",
    "Historical replay may recommend Best Angle for evaluation only, but applied=false always. Live production may not auto-upgrade.",
    "Use only these Play Grade labels: No Play, Caution, Watchlist, Lean, Best Angle.",
    "No Play can mean no edge, unplayable price, bad risk/reward, severe contradiction, or not actionable.",
    "Caution means edge may exist but risk/source conflict/resistance/stale data makes it a pass unless there is a strong external read.",
    "Watchlist means possible edge but needs better price, fresher data, lineup confirmation, or another update.",
    "Lean means playable edge but not strong/clean enough for Best Angle.",
    "Best Angle means strongest actionable setup with strong edge, playable price, good data, and no unresolved contradiction unless an explicit model-edge override is visible.",
    "Distinguish historical_source_not_persisted from live data quality failures. Do not call it stale live data.",
    "Separate data findings as critical_data_issue, non_critical_data_warning, historical_replay_limitation, or optional_source_unavailable.",
    "Only critical_data_issue should strongly downgrade or block Play Grade. Historical replay limitations should not automatically force Caution.",
    "Mixed market does not automatically mean Caution. Market Resistance does not automatically mean No Play.",
    "A strong model edge can override market resistance, but copy must honestly call it a model-edge override, not Market Support.",
    "Act as an OddSphere betting analyst, not only a safety auditor: judge whether a disciplined bettor should pass, watch, lean, or play.",
    "Use member-safe labels only: Consensus Splits, Sharp Book Splits, Sharp Book Signal, Market Read.",
    "For every issue, decide materiality_to_bet and should_affect_grade. Low-materiality replay/storage limitations must not drive downgrades.",
    "A downgrade requires a material EV, price, data reliability, or risk/reward problem. Imperfection alone is not enough.",
    "A promotion is allowed in replay evaluation when edge, price, data reliability, and market context justify it. It will not be applied live.",
    "Return strict JSON only.",
  ];
  const variants: Record<ReplayVariant, string[]> = {
    ai_v1_conservative: [
      "Variant ai_v1_conservative: prioritize safety/coherence, but still avoid automatic downgrades for non-material issues.",
    ],
    ai_v2_betting_value: [
      "Variant ai_v2_betting_value: lead with betting value. Ask whether this is a good bet, not merely whether the card is imperfect.",
      "Mixed market does not automatically mean pass. Market resistance does not automatically mean No Play.",
      "If strong model edge and playable price overcome market resistance, classify it as model-edge override and consider holding or promoting.",
      "Do not downgrade Totals or First Inning just because historical dual-source sharp fields are not persisted.",
    ],
    ai_v3_market_specific: [
      "Variant ai_v3_market_specific: apply separate calibration by market.",
      "MLB ML: price sensitivity and market resistance are often material; require playable price and real edge for Lean/Best Angle.",
      "MLB Total: do not over-penalize mixed split signals; focus on number quality, model edge, total line, weather/park context if present, and price.",
      "MLB FI: higher variance is normal; do not collapse all FI Leans to Caution unless data/price materially damages the bet.",
      "Until replay proves otherwise, be especially careful about downgrading Totals/FI Leans.",
    ],
    ai_v4_profit_calibrated: [
      "Variant ai_v4_profit_calibrated: use deterministicPreScore and historical cohort priors to avoid downgrading profitable cohorts without high-materiality evidence.",
      "Do not downgrade MLB FI Lean or MLB Total Lean solely for missing sharp-book source, no clear signal, or mixed/consensus resistance.",
      "Best Angle was unprofitable in recent replay; inspect price, model edge, and market resistance before holding Best Angle.",
      "For FI, missing market signal is usually low materiality unless paired with starter/lineup mismatch, stale data, unplayable price, or very thin model edge.",
    ],
    ai_v5_promotions_enabled: [
      "Variant ai_v5_promotions_enabled: actively look for under-graded winners in evaluation only.",
      "Consider Watchlist->Lean, Lean->Best Angle, Caution->Lean, or No Play->Watchlist/Lean when edge, price, and context justify it.",
      "Promotion requires strong deterministicPreScore, playable price, no high-materiality data warning, and explicit value thesis.",
      "Promotions must include clear promotion reason codes and no invented support.",
    ],
  };
  return [...base, ...variants[variant]].join("\n");
}

function cardAuditUserPayload(payload: AiAuditorPayloadEstimate, variant: ReplayVariant): string {
  return JSON.stringify({
    run_context: {
      variant,
      applied: false,
      replay_only: true,
      live_guarded_qc_enabled: false,
      promotion_allowed_for_evaluation_only: true,
    },
    evaluation_jobs: {
      data_integrity: [
        "Identify missing, stale, reversed, partial, or inconsistent data.",
        "Distinguish historical_source_not_persisted from real live data problems.",
        "Recommend deterministic repairs only.",
      ],
      market_read: [
        "Read Consensus Splits, Sharp Book Splits/Signal, line movement, source freshness, and source conflict.",
        "Classify Market Read exactly.",
        "Write concise OddSphere-style copy without provider names.",
      ],
      play_grade: [
        "Map the setup to No Play, Caution, Watchlist, Lean, or Best Angle under OddSphere rules.",
        "For historical evaluation only, you may recommend Best Angle if justified; no app change will be applied.",
      ],
      betting_value_review: [
        "Is there a real model edge?",
        "Is the edge large enough relative to market price?",
        "Is the price playable?",
        "Is the edge large enough for the grade?",
        "Is the play +EV or just a model pick?",
        "Is market resistance meaningful enough to downgrade?",
        "Is mixed market signal noise or a real problem?",
        "Is the risk/reward good enough for action?",
        "Is this a good bet despite mixed market signals?",
        "Is this only a model pick but not worth betting?",
        "Would a disciplined bettor pass, watch, lean, or play?",
        "Should this be promoted, held, downgraded, or blocked?",
      ],
      deterministic_pre_score_review: [
        "Review deterministicPreScore for each market.",
        "Explain whether model_edge_score, price_quality_score, market_alignment_score, data_quality_score, line_movement_score, and historical_cohort_score support or contradict the grade.",
        "Do not ignore deterministicPreScore; use it as calibrated evidence, not as a final answer.",
      ],
      materiality_scoring: [
        "For each issue return severity, materiality_to_bet, should_affect_grade, and direction.",
        "historical_source_not_persisted should be low materiality and should_affect_grade=false unless it directly hides a market contradiction.",
        "optional sharp source unavailable is low materiality unless this sport/market normally expects it and sharp language is shown.",
        "line moved hard against pick, price beyond playable threshold, or starter mismatch can be medium/high materiality.",
        "source conflict with strong model edge may be medium materiality, not automatic downgrade.",
        "strong edge + playable price + market alignment can be a promotion candidate.",
      ],
      market_specific_scorecards: {
        mlb_moneyline: "Emphasize price quality, true model edge, favorite/dog risk, market resistance, and whether the number remains playable.",
        mlb_total: "Emphasize total number quality, model edge, line movement, park/weather context if present, and avoid over-downgrading from split noise alone. Mixed market alone is not enough.",
        mlb_first_inning: "Protect FI Leans from generic downgrades. Account for higher variance and starter sensitivity; downgrade only for material starter/lineup/price/data problems or clearly thin edge.",
      },
      whole_card_coherence: [
        "Check Quick Read, Market Read, Supporting Evidence, Play Grade, sort/classification coherence, WNBA sharp-language safety, and provider names.",
      ],
    },
    blind_card_payload: payload.payload,
  });
}

function parseOutputText(value: unknown): string {
  const record = value as { output_text?: unknown; output?: Array<{ content?: Array<{ text?: string; type?: string }> }> };
  if (typeof record.output_text === "string") return record.output_text;
  const chunks: string[] = [];
  for (const item of record.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

async function callOpenAiCardAuditor(payload: AiAuditorPayloadEstimate, variant: ReplayVariant): Promise<{
  result: AiAuditorReplayResult | null;
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number | null;
}> {
  const pricing = resolveAiAuditorPricing();
  if (pricing.nanoModel.toLowerCase().includes("gpt-5.5")) throw new Error("GPT-5.5 is blocked for replay audits.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: pricing.nanoModel,
      input: [
        { role: "system", content: cardAuditSystemPrompt(variant) },
        { role: "user", content: cardAuditUserPayload(payload, variant) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: AI_AUDITOR_CARD_AUDIT_SCHEMA.name,
          schema: AI_AUDITOR_CARD_AUDIT_SCHEMA.schema,
          strict: true,
        },
      },
    }),
  });
  const json = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`OpenAI replay call failed: HTTP ${response.status} ${JSON.stringify(json)}`);
  const rawText = parseOutputText(json);
  let parsed: AiAuditorReplayResult | null = null;
  try {
    parsed = JSON.parse(rawText) as AiAuditorReplayResult;
  } catch {
    parsed = null;
  }
  const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  const inputTokens = Number(usage?.input_tokens ?? payload.estimatedInputTokens);
  const outputTokens = Number(usage?.output_tokens ?? payload.estimatedOutputTokens);
  const actualCostUsd = estimateCostUsd(
    inputTokens,
    outputTokens,
    pricing.nanoInputUsdPerMillion,
    pricing.nanoOutputUsdPerMillion,
  );
  return { result: parsed, rawText, inputTokens, outputTokens, actualCostUsd };
}

function validateReplayResult(result: AiAuditorReplayResult | null, payload: AiAuditorPayloadEstimate): string[] {
  const errors: string[] = [];
  if (result === null) return ["invalid_json"];
  const marketReads = new Set(["aligned", "mixed", "resistance", "consensus_support", "consensus_resistance", "no_clear_signal", "insufficient_data"]);
  const playGrades = new Set<string>(PLAY_GRADES);
  if (!marketReads.has(result.recommended_market_read)) errors.push("invalid_recommended_market_read");
  if (!playGrades.has(result.recommended_play_grade)) errors.push("invalid_recommended_play_grade");
  if (!Array.isArray(result.market_reviews) || result.market_reviews.length === 0) errors.push("missing_market_reviews");
  for (const review of result.market_reviews ?? []) {
    if (!payload.markets.includes(review.market)) errors.push(`market_review_not_in_payload:${review.market}`);
    if (!marketReads.has(review.recommended_market_read)) errors.push(`invalid_market_read:${review.market}`);
    if (!playGrades.has(review.recommended_play_grade)) errors.push(`invalid_grade:${review.market}`);
  }
  if (result.provider_name_check.provider_names_present || result.safety_review.provider_names_present) errors.push("provider_name_leak");
  if (result.safety_review.postgame_data_present) errors.push("postgame_leakage_claimed");
  if (result.safety_review.invented_data_detected) errors.push("invented_data_claimed");
  if (result.safety_review.attempted_pick_flip) errors.push("attempted_pick_flip");
  if (result.safety_review.attempted_probability_change) errors.push("attempted_probability_change");
  if (result.safety_review.attempted_projected_score_change) errors.push("attempted_projected_score_change");
  return errors;
}

async function logReplayLedger(args: {
  payload: AiAuditorPayloadEstimate;
  call: AiAuditorReplayCall;
  mode: ReplayMode;
}): Promise<string | null> {
  return await insertAiAuditLedger({
    month_key: currentMonthKey(),
    sport: args.payload.sport,
    slate_date: args.payload.date,
    game_id: args.payload.gameId,
    audit_scope: args.mode === "paid-sample" ? "historical_replay_quality_paid_sample" : "historical_replay_quality_dry_run",
    payload_hash: args.payload.payloadHash,
    from_cache: args.payload.cacheSkipped,
    skipped_reason: args.payload.skipReason,
    model: args.mode === "paid-sample" ? resolveAiAuditorPricing().nanoModel : null,
    input_tokens: args.call.inputTokens,
    output_tokens: args.call.outputTokens,
    estimated_cost_usd: args.call.estimatedCostUsd,
    actual_cost_usd: args.call.actualCostUsd,
    status: args.call.status,
    severity: args.call.result?.severity ?? (args.call.schemaValid ? "info" : "block"),
    recommended_actions: [
      ...(args.call.result?.recommended_actions ?? []),
      ...args.call.validationErrors.map((error) => `validation:${error}`),
      `original_market_read:${originalCardMarketRead(args.payload)}`,
      `ai_market_read:${args.call.result?.recommended_market_read ?? "schema_failed"}`,
      `original_play_grade:${cardGrade(args.payload)}`,
      `ai_play_grade:${args.call.result?.recommended_play_grade ?? "schema_failed"}`,
    ],
    escalation: false,
    applied: false,
  });
}

function gradeRank(grade: string | null | undefined): number {
  return PLAY_GRADES.findIndex((value) => value === grade);
}

function recommendationDirection(originalGrade: string | null | undefined, aiGrade: string | null | undefined): "promotion" | "downgrade" | "hold" {
  const original = gradeRank(originalGrade);
  const ai = gradeRank(aiGrade);
  if (original < 0 || ai < 0 || original === ai) return "hold";
  return ai > original ? "promotion" : "downgrade";
}

function materialityScores(result: AiAuditorReplayResult | null): Array<{
  code: string;
  severity: string;
  materiality_to_bet: string;
  should_affect_grade: boolean;
  direction: string;
}> {
  return (result?.issues ?? []).map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    materiality_to_bet: issue.materiality_to_bet,
    should_affect_grade: issue.should_affect_grade,
    direction: issue.direction,
  }));
}

function reasonCodesFor(result: AiAuditorReplayResult | null, market: AiAuditorCompactMarketPayload): string[] {
  return Array.from(new Set([
    ...(market.reasonCodes ?? []),
    ...(result?.issues ?? []).map((issue) => issue.code),
    ...(result?.repair_actions ?? []).filter((action) => action !== "none").map((action) => `repair:${action}`),
  ]));
}

async function logEvaluationResults(args: {
  runId: string;
  variant: ReplayVariant;
  mode: ReplayMode;
  calls: AiAuditorReplayCall[];
  postgameResults: ReplayPostgameResultMap;
}): Promise<number> {
  if (args.mode !== "paid-sample") return 0;
  const { supabase } = await import("@/lib/db/supabase");
  const rows = args.calls.flatMap((call) => {
    if (!call.result) return [];
    return call.payload.payload.markets.map((market) => {
      const review = call.result?.market_reviews.find((row) => row.market === market.market) ?? null;
      const aiGrade = review?.recommended_play_grade ?? call.result?.recommended_play_grade ?? null;
      const aiRead = review?.recommended_market_read ?? call.result?.recommended_market_read ?? null;
      const postgame = args.postgameResults.get(resultKey(call.payload.externalId, market.market));
      const direction = recommendationDirection(market.playGrade, aiGrade);
      return {
        run_id: args.runId,
        variant: args.variant,
        audit_scope: "historical_replay_quality_paid_sample",
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
        original_price: market.priceAmerican,
        original_recommendation_confidence: null,
        ai_recommended_grade: aiGrade,
        ai_recommended_market_read: aiRead,
        ai_recommendation_direction: direction,
        downgrade_promotion_reason: review?.summary ?? call.result?.play_grade_review.summary ?? null,
        data_integrity_review: call.result?.data_integrity_review ?? {},
        market_read_review: call.result?.market_read_review ?? {},
        play_grade_review: call.result?.play_grade_review ?? {},
        betting_value_review: call.result?.betting_value_review ?? {},
        card_coherence_review: call.result?.full_card_coherence_review ?? {},
        safety_review: call.result?.safety_review ?? {},
        market_reviews: call.result?.market_reviews ?? [],
        issues: call.result?.issues ?? [],
        issue_materiality_scores: materialityScores(call.result),
        reason_codes: reasonCodesFor(call.result, market),
        recommended_actions: call.result?.recommended_actions ?? [],
        safe_copy_fixes: call.result?.safe_copy_fixes ?? [],
        repair_actions: call.result?.repair_actions ?? [],
        full_ai_output: call.result ?? {},
        validation_errors: call.validationErrors,
        postgame_result_joined: postgame !== undefined,
        postgame_result: postgame?.result ?? null,
        units: postgame?.gradeUnits ?? null,
        roi: postgame?.gradeUnits ?? null,
        odds_american: postgame?.oddsAmerican ?? null,
        input_tokens: call.inputTokens,
        output_tokens: call.outputTokens,
        estimated_cost_usd: call.estimatedCostUsd,
        actual_cost_usd: call.actualCostUsd,
        model: call.ledgerId ? resolveAiAuditorPricing().nanoModel : null,
        status: call.status,
        severity: call.result?.severity ?? null,
      };
    });
  });
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("ai_audit_evaluation_results").insert(rows);
  if (error) throw new Error(`ai_audit_evaluation_results insert failed: ${error.message}`);
  return rows.length;
}

function isPublicGrade(grade: string | null | undefined): boolean {
  return grade === "Best Angle" || grade === "Lean";
}

function summarizeEvaluationRows(rows: Array<Record<string, unknown>>) {
  const gradeDistribution: Record<string, number> = {};
  const aiGradeDistribution: Record<string, number> = {};
  const recordByOriginalGrade: Record<string, { wins: number; losses: number; pushes: number; voids: number; units: number }> = {};
  const recordByAiGrade: Record<string, { wins: number; losses: number; pushes: number; voids: number; units: number }> = {};
  const byMarket: Record<string, {
    rows: number;
    winnersRemoved: number;
    losersRemoved: number;
    winnersPromoted: number;
    losersPromoted: number;
    unitsImpact: number;
    aiCautionNoPlayPct: number;
  }> = {};
  let winnersRemoved = 0;
  let losersRemoved = 0;
  let winnersPromoted = 0;
  let losersPromoted = 0;
  let unitsImpact = 0;
  const helpedExamples: string[] = [];
  const hurtExamples: string[] = [];
  const ensureRecord = (map: typeof recordByOriginalGrade, grade: string) => {
    map[grade] ??= { wins: 0, losses: 0, pushes: 0, voids: 0, units: 0 };
    return map[grade];
  };
  for (const row of rows) {
    const market = String(row.market ?? "unknown");
    const originalGrade = String(row.original_grade ?? "unknown");
    const aiGrade = String(row.ai_recommended_grade ?? "unknown");
    const result = String(row.postgame_result ?? "unknown");
    const units = Number(row.units ?? 0);
    inc(gradeDistribution, originalGrade);
    inc(aiGradeDistribution, aiGrade);
    byMarket[market] ??= {
      rows: 0,
      winnersRemoved: 0,
      losersRemoved: 0,
      winnersPromoted: 0,
      losersPromoted: 0,
      unitsImpact: 0,
      aiCautionNoPlayPct: 0,
    };
    byMarket[market].rows += 1;
    const originalRecord = ensureRecord(recordByOriginalGrade, originalGrade);
    const aiRecord = ensureRecord(recordByAiGrade, aiGrade);
    if (result === "win") {
      originalRecord.wins += 1;
      aiRecord.wins += 1;
    } else if (result === "loss") {
      originalRecord.losses += 1;
      aiRecord.losses += 1;
    } else if (result === "push") {
      originalRecord.pushes += 1;
      aiRecord.pushes += 1;
    } else if (result === "void") {
      originalRecord.voids += 1;
      aiRecord.voids += 1;
    }
    originalRecord.units = +(originalRecord.units + units).toFixed(4);
    aiRecord.units = +(aiRecord.units + units).toFixed(4);
    if (isPublicGrade(originalGrade) && !isPublicGrade(aiGrade)) {
      if (result === "win") {
        winnersRemoved += 1;
        byMarket[market].winnersRemoved += 1;
        if (hurtExamples.length < 8) hurtExamples.push(`${row.slate_date} ${row.matchup} ${market}: removed winner ${originalGrade}->${aiGrade}`);
      } else if (result === "loss") {
        losersRemoved += 1;
        byMarket[market].losersRemoved += 1;
        unitsImpact = +(unitsImpact - units).toFixed(4);
        byMarket[market].unitsImpact = +(byMarket[market].unitsImpact - units).toFixed(4);
        if (helpedExamples.length < 8) helpedExamples.push(`${row.slate_date} ${row.matchup} ${market}: removed loser ${originalGrade}->${aiGrade}`);
      }
    }
    if (wouldUpgrade(originalGrade, aiGrade)) {
      if (result === "win") {
        winnersPromoted += 1;
        byMarket[market].winnersPromoted += 1;
        if (helpedExamples.length < 8) helpedExamples.push(`${row.slate_date} ${row.matchup} ${market}: promoted winner ${originalGrade}->${aiGrade}`);
      } else if (result === "loss") {
        losersPromoted += 1;
        byMarket[market].losersPromoted += 1;
        if (hurtExamples.length < 8) hurtExamples.push(`${row.slate_date} ${row.matchup} ${market}: promoted loser ${originalGrade}->${aiGrade}`);
      }
    }
  }
  for (const market of Object.keys(byMarket)) {
    const marketRows = rows.filter((row) => String(row.market ?? "unknown") === market);
    const cautionNoPlay = marketRows.filter((row) => row.ai_recommended_grade === "Caution" || row.ai_recommended_grade === "No Play").length;
    byMarket[market].aiCautionNoPlayPct = marketRows.length > 0 ? +(cautionNoPlay / marketRows.length).toFixed(4) : 0;
  }
  return {
    rows: rows.length,
    gradeDistribution,
    aiGradeDistribution,
    recordByOriginalGrade,
    recordByAiGrade,
    winnersRemoved,
    losersRemoved,
    winnersPromoted,
    losersPromoted,
    unitsImpact,
    byMarket,
    helpedExamples,
    hurtExamples,
  };
}

async function loadRunComparisons(runIds: string[]) {
  const unique = Array.from(new Set(runIds.filter(Boolean)));
  if (unique.length === 0) return null;
  const { supabase } = await import("@/lib/db/supabase");
  const { data, error } = await supabase
    .from("ai_audit_evaluation_results")
    .select("run_id,variant,slate_date,matchup,market,original_grade,ai_recommended_grade,original_market_read,ai_recommended_market_read,postgame_result,units,reason_codes")
    .in("run_id", unique)
    .order("created_at", { ascending: true });
  if (error) {
    return {
      unavailable: true,
      reason: error.message,
    };
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const byRun: Record<string, unknown> = {};
  for (const runId of unique) {
    const runRows = rows.filter((row) => row.run_id === runId);
    byRun[runId] = {
      variant: runRows[0]?.variant ?? "unknown",
      ...summarizeEvaluationRows(runRows),
    };
  }
  return { unavailable: false, byRun };
}

function resultKey(externalId: number, market: ReplayMarket): string {
  return `${externalId}:${market}`;
}

function americanUnits(odds: number | null, result: string | null | undefined): number {
  if (result === "loss") return -1;
  if (result !== "win") return 0;
  if (odds === null || odds === 0) return 0;
  return odds > 0 ? +(odds / 100).toFixed(4) : +(100 / Math.abs(odds)).toFixed(4);
}

async function loadReplayPostgameResults(args: {
  sport: Sport;
  from: string;
  to: string;
  payloads: AiAuditorPayloadEstimate[];
}): Promise<ReplayPostgameResultMap> {
  const { supabase } = await import("@/lib/db/supabase");
  const externalIds = Array.from(new Set(args.payloads.map((payload) => payload.externalId)));
  if (externalIds.length === 0) return new Map();
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, external_id")
    .eq("sport", args.sport)
    .in("external_id", externalIds);
  if (gamesError) throw new Error(`Replay result games lookup failed: ${gamesError.message}`);
  const internalToExternal = new Map<number, number>();
  for (const game of (games ?? []) as Array<{ id: number; external_id: number }>) {
    internalToExternal.set(game.id, game.external_id);
  }
  const internalIds = Array.from(internalToExternal.keys());
  if (internalIds.length === 0) return new Map();
  const { data: records, error: recordsError } = await supabase
    .from("prediction_records")
    .select("id,game_id,market,odds_american,play_grade,prediction_grades(result)")
    .eq("sport", args.sport)
    .gte("slate_date", args.from)
    .lte("slate_date", args.to)
    .in("game_id", internalIds)
    .in("market", ["moneyline", "total", "first_inning"]);
  if (recordsError) throw new Error(`Replay result records lookup failed: ${recordsError.message}`);
  const out: ReplayPostgameResultMap = new Map();
  for (const record of (records ?? []) as Array<{
    game_id: number;
    market: ReplayMarket;
    odds_american: number | null;
    play_grade: string | null;
    prediction_grades: { result: string | null } | Array<{ result: string | null }> | null;
  }>) {
    const externalId = internalToExternal.get(record.game_id);
    if (externalId === undefined) continue;
    const grade = Array.isArray(record.prediction_grades)
      ? record.prediction_grades[0] ?? null
      : record.prediction_grades;
    const result = (grade?.result ?? "unknown") as ReplayPostgameMarketResult["result"];
    out.set(resultKey(externalId, record.market), {
      result,
      gradeUnits: americanUnits(record.odds_american, result),
      oddsAmerican: record.odds_american,
      originalPlayGrade: record.play_grade,
    });
  }
  return out;
}

function collectResultJoin(payloads: AiAuditorPayloadEstimate[], postgameResults: ReplayPostgameResultMap) {
  const ids = new Set(payloads.map((payload) => payload.gameId));
  const byMarket: Record<ReplayMarket, { markets: number; joined: number; settled: number; joinRate: number }> = {
    moneyline: { markets: 0, joined: 0, settled: 0, joinRate: 0 },
    total: { markets: 0, joined: 0, settled: 0, joinRate: 0 },
    first_inning: { markets: 0, joined: 0, settled: 0, joinRate: 0 },
  };
  let joined = 0;
  let available = 0;
  for (const payload of payloads) {
    if (!ids.has(payload.gameId)) continue;
    joined += 1;
    let cardHasSettled = false;
    for (const market of payload.markets) {
      byMarket[market].markets += 1;
      const result = postgameResults.get(resultKey(payload.externalId, market));
      if (result !== undefined) {
        byMarket[market].joined += 1;
        if (result.result !== "pending" && result.result !== "unknown") {
          byMarket[market].settled += 1;
          cardHasSettled = true;
        }
      }
    }
    if (cardHasSettled) available += 1;
  }
  for (const market of Object.keys(byMarket) as ReplayMarket[]) {
    const row = byMarket[market];
    row.joinRate = row.markets > 0 ? +(row.settled / row.markets).toFixed(4) : 0;
  }
  return {
    resultJoinPerformedAfterPayloadBuild: true,
    joinedCards: joined,
    cardsWithPostgameResultAvailable: available,
    cardResultJoinRate: joined > 0 ? +(available / joined).toFixed(4) : 0,
    byMarket,
    resultFieldsIncludedInAiPayload: false,
  };
}

function reviewedMarket(call: AiAuditorReplayCall, market: "moneyline" | "total" | "first_inning"): AiAuditorMarketReview | null {
  return call.result?.market_reviews.find((review) => review.market === market) ?? null;
}

function gradeIsPublic(grade: string | null | undefined): boolean {
  return grade === "Best Angle" || grade === "Lean";
}

function wouldRemove(originalGrade: string | null | undefined, recommendedGrade: string | null | undefined): boolean {
  return gradeIsPublic(originalGrade) && !gradeIsPublic(recommendedGrade);
}

function wouldUpgrade(originalGrade: string | null | undefined, recommendedGrade: string | null | undefined): boolean {
  const rank = new Map<string, number>(PLAY_GRADES.map((grade, i) => [grade, i]));
  return (rank.get(recommendedGrade ?? "") ?? -1) > (rank.get(originalGrade ?? "") ?? -1);
}

function summarizeOutcomes(args: {
  calls: AiAuditorReplayCall[];
  postgameResults: ReplayPostgameResultMap;
}) {
  const byMarket: Record<string, {
    winnersRemoved: number;
    losersRemoved: number;
    winnersUpgraded: number;
    losersUpgraded: number;
    originalBestAngle: { wins: number; losses: number; units: number };
    aiBestAngle: { wins: number; losses: number; units: number };
    originalLean: { wins: number; losses: number; units: number };
    aiLean: { wins: number; losses: number; units: number };
  }> = {};
  const total = {
    winnersRemoved: 0,
    losersRemoved: 0,
    winnersUpgraded: 0,
    losersUpgraded: 0,
    unitsImpact: 0,
    examplesHelped: [] as string[],
    examplesHurt: [] as string[],
  };
  for (const market of ["moneyline", "total", "first_inning"] as const) {
    byMarket[market] = {
      winnersRemoved: 0,
      losersRemoved: 0,
      winnersUpgraded: 0,
      losersUpgraded: 0,
      originalBestAngle: { wins: 0, losses: 0, units: 0 },
      aiBestAngle: { wins: 0, losses: 0, units: 0 },
      originalLean: { wins: 0, losses: 0, units: 0 },
      aiLean: { wins: 0, losses: 0, units: 0 },
    };
  }
  for (const call of args.calls) {
    for (const market of ["moneyline", "total", "first_inning"] as const) {
      const current = call.payload.payload.markets.find((row) => row.market === market);
      if (!current) continue;
      const review = reviewedMarket(call, market);
      const originalGrade = current.playGrade ?? "No Play";
      const aiGrade = review?.recommended_play_grade ?? originalGrade;
      const postgame = args.postgameResults.get(resultKey(call.payload.externalId, market));
      const outcome = postgame?.result ?? "unknown";
      const units = postgame?.gradeUnits ?? 0;
      if (originalGrade === "Best Angle") {
        if (outcome === "win") byMarket[market].originalBestAngle.wins += 1;
        if (outcome === "loss") byMarket[market].originalBestAngle.losses += 1;
        byMarket[market].originalBestAngle.units += units;
      }
      if (aiGrade === "Best Angle") {
        if (outcome === "win") byMarket[market].aiBestAngle.wins += 1;
        if (outcome === "loss") byMarket[market].aiBestAngle.losses += 1;
        byMarket[market].aiBestAngle.units += units;
      }
      if (originalGrade === "Lean") {
        if (outcome === "win") byMarket[market].originalLean.wins += 1;
        if (outcome === "loss") byMarket[market].originalLean.losses += 1;
        byMarket[market].originalLean.units += units;
      }
      if (aiGrade === "Lean") {
        if (outcome === "win") byMarket[market].aiLean.wins += 1;
        if (outcome === "loss") byMarket[market].aiLean.losses += 1;
        byMarket[market].aiLean.units += units;
      }
      if (wouldRemove(originalGrade, aiGrade)) {
        if (outcome === "win") {
          byMarket[market].winnersRemoved += 1;
          total.winnersRemoved += 1;
          if (total.examplesHurt.length < 5) total.examplesHurt.push(`${call.payload.date} ${call.payload.matchup} ${market}: removed winner ${originalGrade}->${aiGrade}`);
        }
        if (outcome === "loss") {
          byMarket[market].losersRemoved += 1;
          total.losersRemoved += 1;
          total.unitsImpact += -units;
          if (total.examplesHelped.length < 5) total.examplesHelped.push(`${call.payload.date} ${call.payload.matchup} ${market}: removed loser ${originalGrade}->${aiGrade}`);
        }
      }
      if (wouldUpgrade(originalGrade, aiGrade)) {
        if (outcome === "win") {
          byMarket[market].winnersUpgraded += 1;
          total.winnersUpgraded += 1;
        }
        if (outcome === "loss") {
          byMarket[market].losersUpgraded += 1;
          total.losersUpgraded += 1;
          if (total.examplesHurt.length < 5) total.examplesHurt.push(`${call.payload.date} ${call.payload.matchup} ${market}: upgraded loser ${originalGrade}->${aiGrade}`);
        }
      }
    }
  }
  return { ...total, byMarket };
}

function originalResultDistributionByGrade(
  payloads: AiAuditorPayloadEstimate[],
  postgameResults: ReplayPostgameResultMap,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const payload of payloads) {
    for (const market of payload.payload.markets) {
      const grade = market.playGrade ?? "unknown";
      const result = postgameResults.get(resultKey(payload.externalId, market.market))?.result ?? "unknown";
      out[grade] ??= {};
      out[grade][result] = (out[grade][result] ?? 0) + 1;
    }
  }
  return out;
}

function buildQualityReport(args: {
  analysis: ReturnType<typeof analyzeReplay>;
  calls: AiAuditorReplayCall[];
  postgameResults: ReplayPostgameResultMap;
}) {
  const aiMarketReadDistribution: Record<string, number> = {};
  const aiGradeDistribution: Record<string, number> = {};
  const disagreements: Array<string> = [];
  const supportToMixedResistance: Array<string> = [];
  const sourceConflictCaught: Array<string> = [];
  const improvedCopy: Array<string> = [];
  const bestAngleDowngrades: Array<string> = [];
  const leanDowngrades: Array<string> = [];
  const noPlayAgreements: Array<string> = [];
  const repairActions: Record<string, number> = {};
  let dataIssuesFound = 0;
  let providerLeaks = 0;
  let postgameLeakage = 0;
  let inventedData = 0;
  let invalidGradeLabels = 0;
  const unauthorizedUpgradeCount = 0;
  let replayRecommendedUpgrades = 0;
  let attemptedPickOrProbabilityChanges = 0;
  for (const call of args.calls) {
    if (!call.result) continue;
    for (const action of call.result.repair_actions) inc(repairActions, action);
    if (call.result.data_integrity_review.status !== "pass" || call.result.issues.some((issue) => /missing|stale|reversed|partial|inconsistent|source/i.test(issue.code))) {
      dataIssuesFound += 1;
    }
    if (call.result.provider_name_check.provider_names_present || call.result.safety_review.provider_names_present) providerLeaks += 1;
    if (call.result.safety_review.postgame_data_present) postgameLeakage += 1;
    if (call.result.safety_review.invented_data_detected) inventedData += 1;
    if (call.result.safety_review.invalid_grade_label) invalidGradeLabels += 1;
    if (call.validationErrors.includes("attempted_pick_flip") || call.validationErrors.includes("attempted_probability_change")) attemptedPickOrProbabilityChanges += 1;
    inc(aiMarketReadDistribution, call.result.recommended_market_read);
    inc(aiGradeDistribution, call.result.recommended_play_grade);
    const originalRead = originalCardMarketRead(call.payload);
    const originalGrade = cardGrade(call.payload);
    if (originalRead !== call.result.recommended_market_read || originalGrade !== call.result.recommended_play_grade) {
      disagreements.push(`${call.payload.date} ${call.payload.matchup}: read ${originalRead}->${call.result.recommended_market_read}, grade ${originalGrade}->${call.result.recommended_play_grade}`);
    }
    if (wouldUpgrade(originalGrade, call.result.recommended_play_grade)) replayRecommendedUpgrades += 1;
    if ((originalRead === "aligned" || originalRead === "consensus_support") && (call.result.recommended_market_read === "mixed" || call.result.recommended_market_read === "resistance")) {
      supportToMixedResistance.push(`${call.payload.date} ${call.payload.matchup}: ${originalRead}->${call.result.recommended_market_read}`);
    }
    if (call.result.market_reviews.some((review) => review.source_conflict)) sourceConflictCaught.push(`${call.payload.date} ${call.payload.matchup}`);
    if (call.result.safe_copy_fixes.length > 0) improvedCopy.push(`${call.payload.date} ${call.payload.matchup}: ${call.result.safe_copy_fixes.map((fix) => fix.field).join(",")}`);
    if (originalGrade === "Best Angle" && call.result.recommended_play_grade !== "Best Angle") bestAngleDowngrades.push(`${call.payload.date} ${call.payload.matchup}: Best Angle->${call.result.recommended_play_grade}`);
    if (originalGrade === "Lean" && call.result.recommended_play_grade !== "Lean") leanDowngrades.push(`${call.payload.date} ${call.payload.matchup}: Lean->${call.result.recommended_play_grade}`);
    if (originalGrade === "No Play" && call.result.recommended_play_grade === "No Play") noPlayAgreements.push(`${call.payload.date} ${call.payload.matchup}`);
  }
  const outcome = summarizeOutcomes({ calls: args.calls, postgameResults: args.postgameResults });
  const schemaEvaluatedCalls = args.calls.filter((call) => !call.validationErrors.includes("dry_run_no_ai_output"));
  const schemaFailures = schemaEvaluatedCalls.filter((call) => !call.schemaValid).length;
  const rowsLogged = args.calls.filter((call) => call.ledgerLogged).length;
  const totalCost = +args.calls.reduce((sum, call) => sum + Number(call.actualCostUsd ?? call.estimatedCostUsd ?? 0), 0).toFixed(6);
  const totalAiGrades = Object.values(aiGradeDistribution).reduce((sum, count) => sum + count, 0);
  const cautionNoPlay = Number(aiGradeDistribution.Caution ?? 0) + Number(aiGradeDistribution["No Play"] ?? 0);
  const leanBest = Number(aiGradeDistribution.Lean ?? 0) + Number(aiGradeDistribution["Best Angle"] ?? 0);
  const cautionNoPlayPct = totalAiGrades > 0 ? +(cautionNoPlay / totalAiGrades).toFixed(4) : 0;
  const leanBestPct = totalAiGrades > 0 ? +(leanBest / totalAiGrades).toFixed(4) : 0;
  return {
    dataQualityReport: {
      cardsReviewed: args.calls.length,
      dataIssuesFound,
      missingStaleReversedSourceIssues: args.calls
        .flatMap((call) => call.result?.issues ?? [])
        .filter((issue) => /missing|stale|reversed|partial|inconsistent|source/i.test(`${issue.code} ${issue.message}`)).length,
      historicalSourceNotPersisted: args.analysis.cardsWithHistoricalSourceNotPersisted,
      falsePositivesIfDetectable: "requires manual review of sampled examples",
      recommendedRepairActions: repairActions,
    },
    marketReadReport: {
      originalMarketReadDistribution: args.analysis.marketReadDistribution,
      aiMarketReadDistribution,
      disagreements: disagreements.slice(0, 25),
      supportToMixedOrResistanceExamples: supportToMixedResistance.slice(0, 10),
      sourceConflictCaughtExamples: sourceConflictCaught.slice(0, 10),
      improvedCopyExamples: improvedCopy.slice(0, 10),
    },
    playGradeReport: {
      originalGradeDistribution: args.analysis.gradeDistribution,
      aiRecommendedGradeDistribution: aiGradeDistribution,
      cautionNoPlayPct,
      leanBestAnglePct: leanBestPct,
      overConservatismWarning: cautionNoPlayPct > 0.7,
      overAggressionWarning: leanBestPct > 0.6,
      disagreements: disagreements.slice(0, 25),
      bestAnglesAiWouldDowngradeOrCap: bestAngleDowngrades.slice(0, 15),
      leansAiWouldDowngradeOrCap: leanDowngrades.slice(0, 15),
      noPlaysAiAgreedWith: noPlayAgreements.length,
      casesAiDisagreedWithCurrentSystem: disagreements.length,
    },
    counterfactualResultReport: {
      resultJoin: args.analysis.resultJoin,
      winnersRemoved: outcome.winnersRemoved,
      losersRemoved: outcome.losersRemoved,
      winnersUpgraded: outcome.winnersUpgraded,
      losersUpgraded: outcome.losersUpgraded,
      unitsRoiImpactWhereLockedPricesExist: outcome.unitsImpact,
      byMarket: outcome.byMarket,
      helpedExamples: outcome.examplesHelped,
      hurtExamples: outcome.examplesHurt,
    },
    safetyReport: {
      schemaSuccessCount: schemaEvaluatedCalls.length - schemaFailures,
      schemaFailureCount: schemaFailures,
      providerNameLeakCount: providerLeaks,
      postgameLeakageCount: postgameLeakage,
      inventedDataIssueCount: inventedData,
      invalidGradeLabelCount: invalidGradeLabels,
      attemptedUpgradeCount: unauthorizedUpgradeCount,
      replayRecommendedUpgradeCount: replayRecommendedUpgrades,
      attemptedPickOrProbabilityChangeCount: attemptedPickOrProbabilityChanges,
      rowsLogged,
      totalCostUsd: totalCost,
      successCriteriaMet: schemaFailures === 0 &&
        providerLeaks === 0 &&
        postgameLeakage === 0 &&
        inventedData === 0 &&
        invalidGradeLabels === 0 &&
        attemptedPickOrProbabilityChanges === 0,
    },
  };
}

function replayPayloadSlice(preview: AiAuditorCostPreviewSummary, offset: number, limit: number): AiAuditorPayloadEstimate[] {
  return preview.payloads.slice(offset, offset + limit);
}

function analyzeReplay(preview: AiAuditorCostPreviewSummary, postgameResults: ReplayPostgameResultMap, offset: number, limit: number) {
  const payloads = replayPayloadSlice(preview, offset, limit);
  const gradeDistribution: Record<string, number> = {};
  const marketGradeDistribution: Record<string, number> = {};
  const marketReadDistribution: Record<string, number> = {};
  const marketsIncludedPerCard: Record<string, number> = {};
  let bothSources = 0;
  let sourceConflict = 0;
  let marketResistance = 0;
  let insufficientData = 0;
  let noClearSignal = 0;
  let staleMissing = 0;
  let historicalSourceNotPersisted = 0;
  let deterministicSkipped = 0;
  let eligible = 0;
  const budgetMode = resolveAiAuditorBudgetMode({ total_spend_usd: 0, projected_spend_usd: preview.projectedMonthlyCostUsd.realisticHourlyChangesOnMostCards });

  for (const payload of payloads) {
    inc(gradeDistribution, cardGrade(payload));
    inc(marketsIncludedPerCard, payload.markets.join(","));
    if (hasBothSplitSources(payload)) bothSources += 1;
    if (hasSourceConflict(payload)) sourceConflict += 1;
    if (hasMarketResistance(payload)) marketResistance += 1;
    if (hasInsufficientData(payload)) insufficientData += 1;
    if (hasNoClearSignal(payload)) noClearSignal += 1;
    if (hasStaleOrMissing(payload)) staleMissing += 1;
    if (hasHistoricalSourceNotPersisted(payload)) historicalSourceNotPersisted += 1;
    const hardSkip = payload.cacheSkipped;
    if (hardSkip) deterministicSkipped += 1;
    else eligible += 1;
    for (const market of payload.payload.markets) {
      inc(marketGradeDistribution, market.playGrade);
      inc(marketReadDistribution, market.marketRead?.status);
    }
  }

  const resultJoin = collectResultJoin(payloads, postgameResults);
  const limitedInputTokens = payloads.reduce((sum, payload) => sum + payload.estimatedInputTokens, 0);
  const avgLimitedInputTokens = payloads.length > 0 ? Math.ceil(limitedInputTokens / payloads.length) : 0;
  const routerSummary = summarizeAiAuditorEscalations({ payloads, budgetMode, historicalReplay: true });
  const limitedMiniCost = miniEscalationCostUsd({
    miniCalls: routerSummary.estimatedMiniCalls,
    averageInputTokens: avgLimitedInputTokens,
    outputTokensPerEscalation: preview.tokenAssumptions.miniOutputTokensPerEscalation,
    inputUsdPerMillion: preview.pricing.miniInputUsdPerMillion,
    outputUsdPerMillion: preview.pricing.miniOutputUsdPerMillion,
  });
  const limitedNanoRatio = preview.payloads.length > 0 ? payloads.length / preview.payloads.length : 0;
  const limitedNanoCost = +(preview.costScenarios.onePassCostUsd * limitedNanoRatio).toFixed(6);

  return {
    payloadsBuiltBeforeLimit: preview.gameCardPayloadsBuilt,
    payloadsInReplay: payloads.length,
    marketsIncludedPerCard,
    estimatedOnePassCostUsd: preview.costScenarios.onePassCostUsd,
    estimatedPaidSampleCostUsd: +(preview.costScenarios.onePassCostUsd * limitedNanoRatio).toFixed(6),
    estimatedCostBySport: preview.costBySport,
    estimatedCostByMarket: preview.costByMarketCardType,
    gradeDistribution,
    marketGradeDistribution,
    originalResultDistributionByGrade: originalResultDistributionByGrade(payloads, postgameResults),
    marketReadDistribution,
    cardsWithBothConsensusAndSharpSource: bothSources,
    cardsWithHistoricalSourceNotPersisted: historicalSourceNotPersisted,
    cardsWithSourceConflict: sourceConflict,
    cardsWithMarketResistance: marketResistance,
    cardsWithInsufficientData: insufficientData,
    cardsWithNoClearSignal: noClearSignal,
    cardsWithMissingOrStaleDataFlags: staleMissing,
    eligibleForAiAudit: eligible,
    skippedByDeterministicPreAudit: deterministicSkipped,
    noPostgameResultsInAiPayload: true,
    resultJoin,
    estimatedConservativeTwoXCostUsd: +(preview.costScenarios.onePassCostUsd * 2).toFixed(6),
    expectedLedgerRows: payloads.length,
    escalationRouter: {
      candidateMiniCallsBeforeCap: routerSummary.candidateMiniCallsBeforeCap,
      estimatedMiniCalls: routerSummary.estimatedMiniCalls,
      miniEscalationRate: routerSummary.miniEscalationRate,
      maxMiniEscalationRate: routerSummary.maxMiniEscalationRate,
      exceedsConfiguredMax: routerSummary.exceedsConfiguredMax,
      triggersByCategory: routerSummary.triggersByCategory,
      hardEscalationReasons: routerSummary.hardReasonsByCategory,
      softEscalationReasons: routerSummary.softReasonsByCategory,
      nonEscalatingWarnings: routerSummary.nonEscalatingWarningsByCategory,
      totalCostWithRouterUsd: +(limitedNanoCost + limitedMiniCost).toFixed(6),
      conservativeTotalCostWithRouterUsd: +((limitedNanoCost + limitedMiniCost) * preview.pricing.conservativeMultiplier).toFixed(6),
    },
    schemaPrepared: {
      name: AI_AUDITOR_CARD_AUDIT_SCHEMA.name,
      strict: AI_AUDITOR_CARD_AUDIT_SCHEMA.strict,
      sections: Object.keys(AI_AUDITOR_CARD_AUDIT_SCHEMA.schema.properties),
    },
    examples: payloads.slice(0, 5).map((row) => ({
      date: row.date,
      matchup: row.matchup,
      payloadHash: row.payloadHash,
      markets: row.markets,
      grade: cardGrade(row),
      marketReads: row.payload.markets.map((market) => market.marketRead?.status ?? "unknown"),
      inputTokens: row.estimatedInputTokens,
      resultIncludedInPayload: false,
    })),
  };
}

async function runReplayAudits(args: {
  mode: ReplayMode;
  payloads: AiAuditorPayloadEstimate[];
  maxCostUsd: number | null;
  variant: ReplayVariant;
}): Promise<AiAuditorReplayCall[]> {
  const pricing = resolveAiAuditorPricing();
  const calls: AiAuditorReplayCall[] = [];
  const hardCap = replayHardCapUsd(args.maxCostUsd);
  let paidSpend = 0;
  for (const payload of args.payloads) {
    const leakage = forbiddenPayloadLeakage(payload);
    const estimatedCostUsd = estimateCostUsd(
      payload.estimatedInputTokens,
      payload.estimatedOutputTokens,
      pricing.nanoInputUsdPerMillion,
      pricing.nanoOutputUsdPerMillion,
    );
    if (leakage.length > 0) {
      const call: AiAuditorReplayCall = {
        payload,
        result: null,
        schemaValid: false,
        validationErrors: leakage.map((term) => `postgame_payload_leak:${term}`),
        status: "block",
        inputTokens: payload.estimatedInputTokens,
        outputTokens: 0,
        estimatedCostUsd: 0,
        actualCostUsd: null,
        ledgerLogged: false,
        ledgerId: null,
        evaluationRowsLogged: 0,
      };
      if (args.mode === "paid-sample") {
        call.ledgerId = await logReplayLedger({ payload, call, mode: args.mode });
        call.ledgerLogged = true;
      }
      calls.push(call);
      continue;
    }
    if (args.mode === "dry-run") {
      calls.push({
        payload,
        result: null,
        schemaValid: false,
        validationErrors: ["dry_run_no_ai_output"],
        status: "warn",
        inputTokens: payload.estimatedInputTokens,
        outputTokens: payload.estimatedOutputTokens,
        estimatedCostUsd,
        actualCostUsd: null,
        ledgerLogged: false,
        ledgerId: null,
        evaluationRowsLogged: 0,
      });
      continue;
    }
    if (paidSpend + estimatedCostUsd > hardCap) {
      const call: AiAuditorReplayCall = {
        payload,
        result: null,
        schemaValid: false,
        validationErrors: ["paid_replay_hard_cap_reached"],
        status: "block",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
        ledgerLogged: false,
        ledgerId: null,
        evaluationRowsLogged: 0,
      };
      call.ledgerId = await logReplayLedger({ payload, call, mode: args.mode });
      call.ledgerLogged = true;
      calls.push(call);
      continue;
    }
    const openAi = await callOpenAiCardAuditor(payload, args.variant);
    const validationErrors = validateReplayResult(openAi.result, payload);
    const call: AiAuditorReplayCall = {
      payload,
      result: openAi.result,
      schemaValid: validationErrors.length === 0,
      validationErrors,
      status: validationErrors.length > 0 ? "block" : openAi.result?.severity === "block" ? "block" : openAi.result?.severity === "high" || openAi.result?.severity === "medium" ? "warn" : "pass",
      inputTokens: openAi.inputTokens,
      outputTokens: openAi.outputTokens,
      estimatedCostUsd,
      actualCostUsd: openAi.actualCostUsd,
      ledgerLogged: false,
      ledgerId: null,
      evaluationRowsLogged: 0,
    };
    call.ledgerId = await logReplayLedger({ payload, call, mode: args.mode });
    paidSpend = +(paidSpend + Number(call.actualCostUsd ?? call.estimatedCostUsd ?? 0)).toFixed(6);
    call.ledgerLogged = true;
    calls.push(call);
  }
  return calls;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = args.runId ?? defaultRunId(args);
  paidReplayGate(args);
  process.env.AI_AUDITOR_COST_PREVIEW_ONLY = "true";

  const dates = eachDateInclusive(args.from, args.to);
  const responses: Array<{ date: string; response: DailyEdgeResponse }> = [];
  for (const date of dates) {
    responses.push({ date, response: await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date }) });
  }
  const existingPayloadHashes = await loadExistingAiAuditPayloadHashes({ from: args.from, to: args.to, sport: args.sport });
  const preview = buildAiAuditorCostPreview({
    sport: args.sport,
    from: args.from,
    to: args.to,
    markets: parseAiAuditorMarkets(args.markets),
    refreshesPerDay: 1,
    miniEscalationRates: [0.05, 0.10, 0.20],
    skipUnchangedPayloads: args.mode === "dry-run" && process.env.AI_AUDITOR_SKIP_UNCHANGED_PAYLOADS !== "false",
    oneCallPerGameCard: true,
    includePeakSlateAssumptions: false,
    payloadsByDate: responses,
    existingPayloadHashes,
  });
  const replayPayloads = replayPayloadSlice(preview, args.offset, args.limit);
  if (args.mode === "paid-sample") assertPaidReplayCap(preview, args.limit, args.maxCostUsd);
  const calls = await runReplayAudits({ mode: args.mode, payloads: replayPayloads, maxCostUsd: args.maxCostUsd, variant: args.variant });
  const postgameResults = await loadReplayPostgameResults({
    sport: args.sport,
    from: args.from,
    to: args.to,
    payloads: replayPayloads,
  });
  const evaluationRowsLogged = await logEvaluationResults({
    runId,
    variant: args.variant,
    mode: args.mode,
    calls,
    postgameResults,
  });
  if (evaluationRowsLogged > 0) {
    for (const call of calls) call.evaluationRowsLogged = call.result ? call.payload.payload.markets.length : 0;
  }
  const analysis = analyzeReplay(preview, postgameResults, args.offset, args.limit);
  const qualityReport = buildQualityReport({ analysis, calls, postgameResults });
  const compareRunIds = Array.from(new Set([runId, ...args.compareRunIds]));
  const runComparison = await loadRunComparisons(args.mode === "paid-sample" || args.compareRunIds.length > 0 ? compareRunIds : args.compareRunIds);
  const output = {
    mode: args.mode,
    variant: args.variant,
    runId,
    noOpenAiCalls: args.mode === "dry-run",
    noMemberFacingChanges: true,
    paidSampleEnabled: args.mode === "paid-sample",
    paidSamplePreparedButNotExecuted: args.mode === "dry-run",
    nanoOnly: args.nanoOnly,
    miniEscalationExecuted: false,
    appliedFalseForEveryRow: true,
    sport: args.sport,
    from: args.from,
    to: args.to,
    requestedLimit: args.limit,
    requestedOffset: args.offset,
    ...analysis,
    evaluationRowsLogged,
    qualityReport,
    runComparison,
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`AI Auditor Historical Replay (${args.mode})`);
  console.log(`Run ID: ${output.runId}`);
  console.log(`Variant: ${output.variant}`);
  console.log(args.mode === "dry-run"
    ? "No OpenAI calls were made. No member-facing output was changed."
    : "Paid historical replay executed. No member-facing output was changed; ledger rows are applied=false.");
  console.log(`Historical game-card payloads built: ${output.payloadsBuiltBeforeLimit}`);
  console.log(`Payloads in replay limit: ${output.payloadsInReplay}`);
  console.log(`Markets included per card: ${JSON.stringify(output.marketsIncludedPerCard)}`);
  console.log(`Estimated one-pass cost: ${money(output.estimatedOnePassCostUsd)}`);
  console.log(`Estimated paid replay cost for replay limit: ${money(output.estimatedPaidSampleCostUsd)}`);
  console.log(`Estimated conservative 2x cost: ${money(output.estimatedConservativeTwoXCostUsd)}`);
  console.log(`Expected ledger rows: ${output.expectedLedgerRows}`);
  console.log(`Evaluation rows logged: ${output.evaluationRowsLogged}`);
  console.log(`Cost by sport: ${JSON.stringify(output.estimatedCostBySport)}`);
  console.log(`Cost by market: ${JSON.stringify(output.estimatedCostByMarket)}`);
  console.log(`Existing card grade distribution: ${JSON.stringify(output.gradeDistribution)}`);
  console.log(`Existing market grade distribution: ${JSON.stringify(output.marketGradeDistribution)}`);
  console.log(`Original result distribution by grade: ${JSON.stringify(output.originalResultDistributionByGrade)}`);
  console.log(`Market Read distribution: ${JSON.stringify(output.marketReadDistribution)}`);
  console.log(`Cards with both Consensus + Sharp source: ${output.cardsWithBothConsensusAndSharpSource}`);
  console.log(`Cards with historical source not persisted: ${output.cardsWithHistoricalSourceNotPersisted}`);
  console.log(`Cards with source conflict: ${output.cardsWithSourceConflict}`);
  console.log(`Cards with market resistance: ${output.cardsWithMarketResistance}`);
  console.log(`Cards with insufficient data: ${output.cardsWithInsufficientData}`);
  console.log(`Cards with no clear signal: ${output.cardsWithNoClearSignal}`);
  console.log(`Cards with missing/stale data flags: ${output.cardsWithMissingOrStaleDataFlags}`);
  console.log(`Eligible for AI audit: ${output.eligibleForAiAudit}`);
  console.log(`Skipped by deterministic pre-audit: ${output.skippedByDeterministicPreAudit}`);
  console.log(`Postgame result join after payload build: ${JSON.stringify(output.resultJoin)}`);
  console.log(`Result join rate: ${(output.resultJoin.cardResultJoinRate * 100).toFixed(1)}%`);
  console.log(`ML result join rate: ${(output.resultJoin.byMarket.moneyline.joinRate * 100).toFixed(1)}%`);
  console.log(`Total result join rate: ${(output.resultJoin.byMarket.total.joinRate * 100).toFixed(1)}%`);
  console.log(`FI result join rate: ${(output.resultJoin.byMarket.first_inning.joinRate * 100).toFixed(1)}%`);
  console.log(`Mini escalation candidates before cap: ${output.escalationRouter.candidateMiniCallsBeforeCap}`);
  console.log(`Mini escalation calls by router: ${output.escalationRouter.estimatedMiniCalls} (${(output.escalationRouter.miniEscalationRate * 100).toFixed(1)}%)`);
  console.log(`Mini escalation max: ${(output.escalationRouter.maxMiniEscalationRate * 100).toFixed(1)}% · exceeds max: ${output.escalationRouter.exceedsConfiguredMax ? "yes" : "no"}`);
  console.log(`Mini triggers: ${JSON.stringify(output.escalationRouter.triggersByCategory)}`);
  console.log(`Hard escalation reasons: ${JSON.stringify(output.escalationRouter.hardEscalationReasons)}`);
  console.log(`Soft escalation reasons: ${JSON.stringify(output.escalationRouter.softEscalationReasons)}`);
  console.log(`Non-escalating warnings: ${JSON.stringify(output.escalationRouter.nonEscalatingWarnings)}`);
  console.log(`Router total cost: ${money(output.escalationRouter.totalCostWithRouterUsd)} (${money(output.escalationRouter.conservativeTotalCostWithRouterUsd)} conservative)`);
  console.log(`Strict schema prepared: ${output.schemaPrepared.name}`);
  console.log("Quality Report:");
  console.log(`  A. Data Quality: reviewed=${qualityReport.dataQualityReport.cardsReviewed} issues=${qualityReport.dataQualityReport.dataIssuesFound} historical_source_not_persisted=${qualityReport.dataQualityReport.historicalSourceNotPersisted} repairs=${JSON.stringify(qualityReport.dataQualityReport.recommendedRepairActions)}`);
  console.log(`  B. Market Read: AI distribution=${JSON.stringify(qualityReport.marketReadReport.aiMarketReadDistribution)} disagreements=${qualityReport.marketReadReport.disagreements.length}`);
  console.log(`  C. Play Grade: AI distribution=${JSON.stringify(qualityReport.playGradeReport.aiRecommendedGradeDistribution)} disagreements=${qualityReport.playGradeReport.casesAiDisagreedWithCurrentSystem} BA downgrades=${qualityReport.playGradeReport.bestAnglesAiWouldDowngradeOrCap.length} Lean downgrades=${qualityReport.playGradeReport.leansAiWouldDowngradeOrCap.length} caution/no-play=${(qualityReport.playGradeReport.cautionNoPlayPct * 100).toFixed(1)}% lean/best=${(qualityReport.playGradeReport.leanBestAnglePct * 100).toFixed(1)}% overConservative=${qualityReport.playGradeReport.overConservatismWarning ? "yes" : "no"} overAggressive=${qualityReport.playGradeReport.overAggressionWarning ? "yes" : "no"}`);
  console.log(`  D. Counterfactual: winners_removed=${qualityReport.counterfactualResultReport.winnersRemoved} losers_removed=${qualityReport.counterfactualResultReport.losersRemoved} winners_upgraded=${qualityReport.counterfactualResultReport.winnersUpgraded} losers_upgraded=${qualityReport.counterfactualResultReport.losersUpgraded} unitsImpact=${qualityReport.counterfactualResultReport.unitsRoiImpactWhereLockedPricesExist}`);
  console.log(`  E. Safety: schema=${qualityReport.safetyReport.schemaSuccessCount}/${qualityReport.safetyReport.schemaFailureCount} providerLeaks=${qualityReport.safetyReport.providerNameLeakCount} postgameLeakage=${qualityReport.safetyReport.postgameLeakageCount} inventedData=${qualityReport.safetyReport.inventedDataIssueCount} unauthorizedUpgrades=${qualityReport.safetyReport.attemptedUpgradeCount} replayRecommendedUpgrades=${qualityReport.safetyReport.replayRecommendedUpgradeCount} rowsLogged=${qualityReport.safetyReport.rowsLogged} cost=${money(qualityReport.safetyReport.totalCostUsd)} successCriteria=${qualityReport.safetyReport.successCriteriaMet ? "met" : "not_met"}`);
  if (output.runComparison && "unavailable" in output.runComparison && output.runComparison.unavailable) {
    console.log(`Run comparison unavailable: ${output.runComparison.reason}`);
  } else if (output.runComparison && "byRun" in output.runComparison) {
    console.log(`Run comparison: ${JSON.stringify(output.runComparison.byRun)}`);
  }
  if (args.mode === "dry-run") {
    console.log("  Dry-run note: AI quality distributions remain empty until --mode=paid-sample is explicitly enabled.");
  }
  console.log("Sample blind payload hashes:");
  for (const example of output.examples) {
    console.log(`  ${example.date} ${example.matchup} ${example.markets.join(",")} ${example.payloadHash.slice(0, 12)} grade=${example.grade}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
