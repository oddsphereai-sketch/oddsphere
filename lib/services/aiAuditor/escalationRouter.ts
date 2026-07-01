import type {
  AiAuditUsageSummary,
  AiAuditorBudgetMode,
} from "@/lib/services/aiAuditCostControl";
import type {
  AiAuditorCompactMarketPayload,
  AiAuditorPayloadEstimate,
} from "@/lib/services/aiAuditor/costPreview";

export type AiAuditorEscalationTrigger =
  | "best_angle_or_lean"
  | "source_conflict"
  | "market_resistance"
  | "lock_audit"
  | "data_freshness_warning"
  | "borderline_edge"
  | "nano_warn_block_uncertain";

export type AiAuditorNonEscalatingWarning =
  | "historical_source_not_persisted"
  | "insufficient_data_low_impact"
  | "no_clear_signal_low_impact"
  | "consensus_only_without_sharp_language"
  | "old_replay_timestamp";

export type AiAuditorEscalationDecision = {
  escalate: boolean;
  model: "none" | "mini";
  triggers: AiAuditorEscalationTrigger[];
  hardEscalationReasons: AiAuditorEscalationTrigger[];
  softEscalationReasons: AiAuditorEscalationTrigger[];
  nonEscalatingWarnings: AiAuditorNonEscalatingWarning[];
  blockedReason: string | null;
};

export type AiAuditorEscalationSummary = {
  enabled: boolean;
  candidateMiniCallsBeforeCap: number;
  estimatedMiniCalls: number;
  miniEscalationRate: number;
  maxMiniEscalationRate: number;
  exceedsConfiguredMax: boolean;
  triggersByCategory: Record<AiAuditorEscalationTrigger, number>;
  hardReasonsByCategory: Record<AiAuditorEscalationTrigger, number>;
  softReasonsByCategory: Record<AiAuditorEscalationTrigger, number>;
  nonEscalatingWarningsByCategory: Record<AiAuditorNonEscalatingWarning, number>;
  decisions: Array<{
    payloadHash: string;
    gameId: string;
    matchup: string;
    triggers: AiAuditorEscalationTrigger[];
    hardEscalationReasons: AiAuditorEscalationTrigger[];
    softEscalationReasons: AiAuditorEscalationTrigger[];
    nonEscalatingWarnings: AiAuditorNonEscalatingWarning[];
    blockedReason: string | null;
  }>;
};

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.toLowerCase() === "true";
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function aiAuditorEscalationEnabled(): boolean {
  return envBool("AI_AUDITOR_ESCALATION_ENABLED", true);
}

export function aiAuditorMaxMiniEscalationRate(): number {
  return envNumber("AI_AUDITOR_MAX_MINI_ESCALATION_RATE", 0.15);
}

function includesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

function gradeRank(grade: string | null): number {
  switch (grade) {
    case "Best Angle": return 4;
    case "Lean": return 3;
    case "Watchlist": return 2;
    case "Caution": return 1;
    case "No Play": return 0;
    default: return -1;
  }
}

function hasFullSharpOrSignal(market: AiAuditorCompactMarketPayload): boolean {
  const sharp = market.sharpBookSplits as { label?: string; rows?: unknown[]; signal?: string | null } | null;
  return Boolean(sharp?.label || sharp?.signal || (Array.isArray(sharp?.rows) && sharp.rows.length > 0));
}

function marketHasStaleSplit(section: unknown): boolean {
  const rows = (section as { rows?: Array<{ isStale?: boolean }> } | null)?.rows;
  return Array.isArray(rows) && rows.some((row) => row.isStale === true);
}

function consensusSharpDisagree(market: AiAuditorCompactMarketPayload): boolean {
  if (!market.consensusSplits || !hasFullSharpOrSignal(market)) return false;
  const status = market.marketRead?.status;
  if (status === "mixed") return true;
  const text = `${market.marketRead?.copy ?? ""} ${market.quickRead ?? ""}`;
  return includesAny(text, ["conflict"]);
}

function lineMovementOpposesPick(market: AiAuditorCompactMarketPayload): boolean {
  const open = market.lineMovement.openAmerican;
  const current = market.lineMovement.currentAmerican;
  if (open === null || current === null || market.pick === null) return false;
  if (market.market === "total") return false;
  // For American prices, moving toward a more positive number is broadly worse
  // for the selected side; this is only a preview-router heuristic.
  return current > open;
}

function nearThreshold(value: number | null, thresholds: number[], tolerance: number): boolean {
  if (value === null) return false;
  return thresholds.some((threshold) => Math.abs(value - threshold) <= tolerance);
}

function hasBorderlineEdge(market: AiAuditorCompactMarketPayload): boolean {
  return (
    nearThreshold(market.modelMarketGapPct, [2, 4, 6, 8], 0.75) ||
    nearThreshold(market.modelProbabilityPct, [52, 55, 58, 60, 65], 1) ||
    (market.priceAmerican !== null && Math.abs(market.priceAmerican) >= 190 && Math.abs(market.priceAmerican) <= 220)
  );
}

function hasDataRisk(payload: AiAuditorPayloadEstimate, historicalReplay?: boolean): boolean {
  if (historicalReplay) return false;
  const state = payload.payload.sourceState as {
    staleSources?: string[];
    missingExpectedSources?: string[];
  } | null;
  if ((state?.staleSources?.length ?? 0) > 0) return true;
  if ((state?.missingExpectedSources?.length ?? 0) > 0) return true;
  return payload.payload.markets.some((market) => {
    if (marketHasStaleSplit(market.consensusSplits) || marketHasStaleSplit(market.sharpBookSplits)) return true;
    if (market.dataQuality.reviewFlags.some((flag) => includesAny(flag, ["stale", "partial", "missing", "injury", "lineup", "starter"]))) return true;
    return market.dataQuality.marketDataQuality === "unavailable";
  });
}

function hasSourceConflict(payload: AiAuditorPayloadEstimate): boolean {
  const state = payload.payload.sourceState as { sourceConflict?: boolean } | null;
  if (state?.sourceConflict === true) return true;
  return payload.payload.markets.some((market) => (
    market.sourceConflict === true ||
    market.marketRead?.status === "mixed" ||
    consensusSharpDisagree(market)
  ));
}

function hasMarketResistance(payload: AiAuditorPayloadEstimate): boolean {
  return payload.payload.markets.some((market) => (
    market.marketRead?.status === "resistance" ||
    market.marketRead?.status === "consensus_resistance" ||
    lineMovementOpposesPick(market)
  ));
}

function highImpactGrade(payload: AiAuditorPayloadEstimate): boolean {
  return payload.payload.markets.some((market) => {
    const rank = gradeRank(market.playGrade);
    if (rank >= 3) return true;
    return (market.modelMarketGapPct ?? 0) >= 6 && (market.modelProbabilityPct ?? 0) >= 58;
  });
}

function obviousNoPlay(payload: AiAuditorPayloadEstimate): boolean {
  return payload.payload.markets.every((market) => (
    market.playGrade === "No Play" &&
    market.sourceConflict !== true &&
    market.marketRead?.status !== "mixed" &&
    market.marketRead?.status !== "resistance" &&
    !hasBorderlineEdge(market)
  ));
}

function hasLowImpactInsufficientData(payload: AiAuditorPayloadEstimate): boolean {
  return !highImpactGrade(payload) && payload.payload.markets.some((market) => market.marketRead?.status === "insufficient_data");
}

function hasLowImpactNoClearSignal(payload: AiAuditorPayloadEstimate): boolean {
  return !highImpactGrade(payload) && payload.payload.markets.some((market) => market.marketRead?.status === "no_clear_signal");
}

function hasHistoricalSourceGap(payload: AiAuditorPayloadEstimate): boolean {
  return payload.payload.markets.some((market) => Boolean(market.consensusSplits) && !hasFullSharpOrSignal(market));
}

function budgetAllows(triggers: AiAuditorEscalationTrigger[], budgetMode: AiAuditorBudgetMode): boolean {
  if (budgetMode === "HARD_STOP") return false;
  if (budgetMode === "NORMAL") return true;
  if (budgetMode === "CONSERVE") {
    return triggers.some((trigger) => trigger === "best_angle_or_lean" || trigger === "lock_audit" || trigger === "source_conflict" || trigger === "market_resistance");
  }
  if (budgetMode === "PROTECT") {
    return (
      triggers.includes("lock_audit") && triggers.includes("best_angle_or_lean")
    ) || (
      (triggers.includes("source_conflict") || triggers.includes("market_resistance")) && triggers.includes("best_angle_or_lean")
    );
  }
  return false;
}

export function routeAiAuditorEscalation(args: {
  payload: AiAuditorPayloadEstimate;
  budgetMode: AiAuditorBudgetMode;
  lockAudit?: boolean;
  deterministicHardBlock?: boolean;
  nanoOutcome?: "pass" | "warn" | "block" | "uncertain" | "schema_error";
  historicalReplay?: boolean;
}): AiAuditorEscalationDecision {
  const empty = (blockedReason: string, warnings: AiAuditorNonEscalatingWarning[] = []): AiAuditorEscalationDecision => ({
    escalate: false,
    model: "none",
    triggers: [],
    hardEscalationReasons: [],
    softEscalationReasons: [],
    nonEscalatingWarnings: warnings,
    blockedReason,
  });
  if (!aiAuditorEscalationEnabled()) return empty("escalation_disabled");
  if (args.payload.cacheSkipped) return empty("unchanged_payload");
  if (args.deterministicHardBlock) return empty("deterministic_hard_block");

  const nonEscalatingWarnings = new Set<AiAuditorNonEscalatingWarning>();
  if (args.historicalReplay && hasHistoricalSourceGap(args.payload)) nonEscalatingWarnings.add("historical_source_not_persisted");
  if (hasLowImpactInsufficientData(args.payload)) nonEscalatingWarnings.add("insufficient_data_low_impact");
  if (hasLowImpactNoClearSignal(args.payload)) nonEscalatingWarnings.add("no_clear_signal_low_impact");
  if (args.historicalReplay) nonEscalatingWarnings.add("old_replay_timestamp");

  if (obviousNoPlay(args.payload)) return empty("obvious_no_play", Array.from(nonEscalatingWarnings));

  const hardReasons = new Set<AiAuditorEscalationTrigger>();
  const softReasons = new Set<AiAuditorEscalationTrigger>();
  const publicPlay = highImpactGrade(args.payload);
  const sourceConflict = hasSourceConflict(args.payload);
  const marketResistance = hasMarketResistance(args.payload);

  if (publicPlay && (envBool("AI_AUDITOR_ESCALATE_BEST_ANGLE", true) || envBool("AI_AUDITOR_ESCALATE_LEAN", true))) {
    if (sourceConflict) {
      hardReasons.add("best_angle_or_lean");
      hardReasons.add("source_conflict");
    }
    if (marketResistance) {
      hardReasons.add("best_angle_or_lean");
      hardReasons.add("market_resistance");
    }
  }
  if (envBool("AI_AUDITOR_ESCALATE_MARKET_CONFLICT", true) && sourceConflict && publicPlay) {
    hardReasons.add("source_conflict");
  }
  if (envBool("AI_AUDITOR_ESCALATE_LOCK_PUBLIC_PLAYS", true) && args.lockAudit) {
    if (publicPlay && (sourceConflict || marketResistance)) hardReasons.add("lock_audit");
    else if (publicPlay) softReasons.add("lock_audit");
  }
  if (publicPlay && args.payload.payload.markets.some(hasBorderlineEdge)) softReasons.add("borderline_edge");
  if (publicPlay && hasDataRisk(args.payload, args.historicalReplay)) softReasons.add("data_freshness_warning");
  if (
    envBool("AI_AUDITOR_ESCALATE_NANO_WARN_BLOCK", true) &&
    (args.nanoOutcome === "warn" || args.nanoOutcome === "block" || args.nanoOutcome === "uncertain" || args.nanoOutcome === "schema_error")
  ) {
    hardReasons.add("nano_warn_block_uncertain");
  }

  const triggers = new Set<AiAuditorEscalationTrigger>([...hardReasons, ...softReasons]);
  const triggerList = Array.from(triggers);
  if (triggerList.length === 0) return {
    escalate: false,
    model: "none",
    triggers: [],
    hardEscalationReasons: [],
    softEscalationReasons: [],
    nonEscalatingWarnings: Array.from(nonEscalatingWarnings),
    blockedReason: "no_escalation_trigger",
  };
  if (!budgetAllows(triggerList, args.budgetMode)) {
    return {
      escalate: false,
      model: "none",
      triggers: triggerList,
      hardEscalationReasons: Array.from(hardReasons),
      softEscalationReasons: Array.from(softReasons),
      nonEscalatingWarnings: Array.from(nonEscalatingWarnings),
      blockedReason: `budget_${args.budgetMode.toLowerCase()}_blocked`,
    };
  }
  return {
    escalate: true,
    model: "mini",
    triggers: triggerList,
    hardEscalationReasons: Array.from(hardReasons),
    softEscalationReasons: Array.from(softReasons),
    nonEscalatingWarnings: Array.from(nonEscalatingWarnings),
    blockedReason: null,
  };
}

export function summarizeAiAuditorEscalations(args: {
  payloads: AiAuditorPayloadEstimate[];
  budgetMode: AiAuditorBudgetMode;
  lockAudit?: boolean;
  historicalReplay?: boolean;
}): AiAuditorEscalationSummary {
  const triggersByCategory: Record<AiAuditorEscalationTrigger, number> = {
    best_angle_or_lean: 0,
    source_conflict: 0,
    market_resistance: 0,
    lock_audit: 0,
    data_freshness_warning: 0,
    borderline_edge: 0,
    nano_warn_block_uncertain: 0,
  };
  const hardReasonsByCategory = { ...triggersByCategory };
  const softReasonsByCategory = { ...triggersByCategory };
  const nonEscalatingWarningsByCategory: Record<AiAuditorNonEscalatingWarning, number> = {
    historical_source_not_persisted: 0,
    insufficient_data_low_impact: 0,
    no_clear_signal_low_impact: 0,
    consensus_only_without_sharp_language: 0,
    old_replay_timestamp: 0,
  };
  const decisions = args.payloads.map((payload) => {
    const decision = routeAiAuditorEscalation({
      payload,
      budgetMode: args.budgetMode,
      lockAudit: args.lockAudit ?? payload.payload.lockState === "locked",
      historicalReplay: args.historicalReplay,
    });
    for (const warning of decision.nonEscalatingWarnings) nonEscalatingWarningsByCategory[warning] += 1;
    return {
      payloadHash: payload.payloadHash,
      gameId: payload.gameId,
      matchup: payload.matchup,
      triggers: decision.triggers,
      hardEscalationReasons: decision.hardEscalationReasons,
      softEscalationReasons: decision.softEscalationReasons,
      nonEscalatingWarnings: decision.nonEscalatingWarnings,
      blockedReason: decision.blockedReason,
    };
  });
  const candidateIndexes = decisions
    .map((decision, index) => ({ decision, index }))
    .filter(({ decision }) => decision.blockedReason === null && decision.triggers.length > 0)
    .sort((a, b) => {
      const hardDelta = b.decision.hardEscalationReasons.length - a.decision.hardEscalationReasons.length;
      if (hardDelta !== 0) return hardDelta;
      return b.decision.triggers.length - a.decision.triggers.length;
    });
  const maxMiniEscalationRate = aiAuditorMaxMiniEscalationRate();
  const maxAllowed = args.payloads.length > 0 ? Math.ceil(args.payloads.length * maxMiniEscalationRate) : 0;
  const allowedIndexes = new Set(candidateIndexes.slice(0, maxAllowed).map(({ index }) => index));
  for (const index of allowedIndexes) {
    const decision = decisions[index];
    if (!decision) continue;
    for (const trigger of decision.triggers) triggersByCategory[trigger] += 1;
    for (const trigger of decision.hardEscalationReasons) hardReasonsByCategory[trigger] += 1;
    for (const trigger of decision.softEscalationReasons) softReasonsByCategory[trigger] += 1;
  }
  const candidateMiniCallsBeforeCap = candidateIndexes.length;
  const estimatedMiniCalls = allowedIndexes.size;
  const miniEscalationRate = args.payloads.length > 0 ? +(estimatedMiniCalls / args.payloads.length).toFixed(4) : 0;
  return {
    enabled: aiAuditorEscalationEnabled(),
    candidateMiniCallsBeforeCap,
    estimatedMiniCalls,
    miniEscalationRate,
    maxMiniEscalationRate,
    exceedsConfiguredMax: miniEscalationRate > maxMiniEscalationRate,
    triggersByCategory,
    hardReasonsByCategory,
    softReasonsByCategory,
    nonEscalatingWarningsByCategory,
    decisions,
  };
}

export function miniEscalationCostUsd(args: {
  miniCalls: number;
  averageInputTokens: number;
  outputTokensPerEscalation: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}): number {
  return +((((args.miniCalls * args.averageInputTokens) / 1_000_000) * args.inputUsdPerMillion) +
    (((args.miniCalls * args.outputTokensPerEscalation) / 1_000_000) * args.outputUsdPerMillion)).toFixed(6);
}
