import type {
  AiAuditorCompactMarketPayload,
  AiAuditorPayloadEstimate,
} from "@/lib/services/aiAuditor/costPreview";

export type AiAuditorReviewStatus = "pass" | "warn" | "block";
export type AiAuditorReviewSeverity = "info" | "low" | "medium" | "high" | "block";
export type AiAuditorPlayGrade = "No Play" | "Caution" | "Watchlist" | "Lean" | "Best Angle";

export type AiAuditorCardAuditResult = {
  data_integrity_review: { status: AiAuditorReviewStatus; summary: string; flags: string[] };
  market_read_review: {
    status: AiAuditorReviewStatus;
    summary: string;
    current_market_read: string;
    recommended_market_read: string;
  };
  play_grade_review: {
    status: AiAuditorReviewStatus;
    summary: string;
    current_play_grade: AiAuditorPlayGrade;
    recommended_play_grade: AiAuditorPlayGrade;
  };
  full_card_coherence_review: {
    status: AiAuditorReviewStatus;
    summary: string;
    contradictions: string[];
  };
  recommended_market_read: string;
  recommended_play_grade: AiAuditorPlayGrade;
  issues: Array<{ code: string; severity: AiAuditorReviewSeverity; message: string }>;
  recommended_actions: Array<"none" | "apply_copy_fixes" | "downgrade_grade" | "block_card" | "repair_data" | "escalate_to_mini">;
  safe_copy_fixes: Array<{ field: string; replacement: string }>;
  confidence: number;
  severity: AiAuditorReviewSeverity;
  provider_name_check: { provider_names_present: boolean; offending_terms: string[] };
};

export type GuardedLiveQcAppliedChange = {
  action: "safe_copy_fix" | "guarded_downgrade" | "block_card";
  field: string;
  from: string | null;
  to: string;
  reason: string;
};

export type GuardedLiveQcDecision = {
  enabled: boolean;
  applied: boolean;
  blocked: boolean;
  deterministicRuleAgreement: boolean;
  status: AiAuditorReviewStatus;
  severity: AiAuditorReviewSeverity;
  appliedChanges: GuardedLiveQcAppliedChange[];
  blockedActions: string[];
  warnings: string[];
  ledgerMetadata: {
    originalMarketRead: string | null;
    aiRecommendedMarketRead: string | null;
    originalPlayGrade: AiAuditorPlayGrade | null;
    aiRecommendedPlayGrade: AiAuditorPlayGrade | null;
    deterministicRuleAgreement: boolean;
    appliedChangeCount: number;
    blockedActionCount: number;
    payloadHash: string;
  };
};

const PLAY_GRADES: AiAuditorPlayGrade[] = ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"];
const PROVIDER_TERMS = ["Playbook", "SharpAPI", "Circa", "Pinnacle", "DraftKings", "FanDuel"];
const COPY_FIELDS = new Set([
  "market_read",
  "quick_read",
  "risk",
  "why",
  "supporting_evidence",
  "sharp_label",
]);

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.toLowerCase() === "true";
}

export function guardedLiveQcEnabled(): boolean {
  return envBool("AI_AUDITOR_ENABLED", false) && envBool("AI_AUDITOR_GUARDED_LIVE_QC", false);
}

export function guardedLiveQcStatus() {
  return {
    enabled: envBool("AI_AUDITOR_ENABLED", false),
    guardedLiveQc: envBool("AI_AUDITOR_GUARDED_LIVE_QC", false),
    shadowMode: envBool("AI_AUDITOR_SHADOW_MODE", false),
    applySafeCopyFixes: envBool("AI_AUDITOR_APPLY_SAFE_COPY_FIXES", false),
    applyGuardedDowngrades: envBool("AI_AUDITOR_APPLY_GUARDED_DOWNGRADES", false),
    allowUpgrades: envBool("AI_AUDITOR_ALLOW_UPGRADES", false),
    allowPickFlips: envBool("AI_AUDITOR_ALLOW_PICK_FLIPS", false),
    allowProbabilityChanges: envBool("AI_AUDITOR_ALLOW_PROBABILITY_CHANGES", false),
    disableGpt55Live: envBool("AI_AUDITOR_DISABLE_GPT55_LIVE", true),
  };
}

function gradeRank(grade: AiAuditorPlayGrade | string | null): number {
  return PLAY_GRADES.indexOf(grade as AiAuditorPlayGrade);
}

function canonicalMarketRead(payload: AiAuditorPayloadEstimate): string | null {
  const statuses = payload.payload.markets
    .map((market) => market.marketRead?.status ?? null)
    .filter((status): status is string => Boolean(status));
  if (statuses.includes("mixed")) return "mixed";
  if (statuses.includes("resistance") || statuses.includes("consensus_resistance")) return "resistance";
  if (statuses.includes("aligned")) return "aligned";
  if (statuses.includes("consensus_support")) return "consensus_support";
  if (statuses.includes("no_clear_signal")) return "no_clear_signal";
  if (statuses.includes("insufficient_data")) return "insufficient_data";
  return statuses[0] ?? null;
}

function currentPlayGrade(payload: AiAuditorPayloadEstimate): AiAuditorPlayGrade | null {
  const grades = payload.payload.markets
    .map((market) => market.playGrade)
    .filter((grade): grade is AiAuditorPlayGrade => PLAY_GRADES.includes(grade as AiAuditorPlayGrade));
  return grades.sort((a, b) => gradeRank(b) - gradeRank(a))[0] ?? null;
}

function hasProviderName(text: string): boolean {
  return PROVIDER_TERMS.some((term) => text.toLowerCase().includes(term.toLowerCase()));
}

function hasMissingSharpSource(market: AiAuditorCompactMarketPayload): boolean {
  const sharp = market.sharpBookSplits as { rows?: unknown[]; signal?: string | null; summary?: string | null } | null;
  return !sharp || (!sharp.signal && !sharp.summary && (!Array.isArray(sharp.rows) || sharp.rows.length === 0));
}

function copyFixMatchesCanonical(fix: { field: string; replacement: string }, payload: AiAuditorPayloadEstimate, canonicalRead: string | null): boolean {
  const field = fix.field.toLowerCase();
  const replacement = fix.replacement.toLowerCase();
  if (!COPY_FIELDS.has(field)) return false;
  if (hasProviderName(fix.replacement)) return false;
  if (field === "market_read") return canonicalRead !== null && replacement.includes(canonicalRead.replace(/_/g, " "));
  if (field === "sharp_label") {
    return payload.payload.markets.some((market) => {
      if (hasMissingSharpSource(market)) return replacement.includes("consensus") && !replacement.includes("sharp");
      const sharp = market.sharpBookSplits as { rows?: unknown[] } | null;
      const hasRows = Array.isArray(sharp?.rows) && sharp.rows.length > 0;
      return hasRows ? replacement.includes("sharp book splits") : replacement.includes("sharp book signal");
    });
  }
  return true;
}

function deterministicAllowsDowngrade(payload: AiAuditorPayloadEstimate, current: AiAuditorPlayGrade, next: AiAuditorPlayGrade): boolean {
  if (gradeRank(next) >= gradeRank(current)) return false;
  const canonicalRead = canonicalMarketRead(payload);
  const sourceConflict = payload.payload.markets.some((market) => market.sourceConflict === true || market.marketRead?.status === "mixed");
  const staleOrPartial = payload.payload.markets.some((market) => (
    market.dataQuality.marketDataQuality === "unavailable" ||
    market.dataQuality.reviewFlags.some((flag) => /stale|partial|missing|injury|lineup|starter/i.test(flag))
  ));
  if (current === "Best Angle") return canonicalRead === "mixed" || canonicalRead === "resistance" || sourceConflict;
  if (current === "Lean") return staleOrPartial || sourceConflict || canonicalRead === "mixed" || canonicalRead === "resistance";
  if ((current === "Watchlist" || current === "Caution") && next === "No Play") {
    return staleOrPartial || payload.payload.markets.every((market) => market.marketRead?.status === "insufficient_data");
  }
  return false;
}

export function applyGuardedLiveQcPolicy(args: {
  payload: AiAuditorPayloadEstimate;
  aiResult: AiAuditorCardAuditResult | null;
  schemaValid: boolean;
}): GuardedLiveQcDecision {
  const originalMarketRead = canonicalMarketRead(args.payload);
  const originalPlayGrade = currentPlayGrade(args.payload);
  const empty = (reason: string): GuardedLiveQcDecision => ({
    enabled: guardedLiveQcEnabled(),
    applied: false,
    blocked: false,
    deterministicRuleAgreement: false,
    status: "warn",
    severity: "medium",
    appliedChanges: [],
    blockedActions: [reason],
    warnings: [],
    ledgerMetadata: {
      originalMarketRead,
      aiRecommendedMarketRead: args.aiResult?.recommended_market_read ?? null,
      originalPlayGrade,
      aiRecommendedPlayGrade: args.aiResult?.recommended_play_grade ?? null,
      deterministicRuleAgreement: false,
      appliedChangeCount: 0,
      blockedActionCount: 1,
      payloadHash: args.payload.payloadHash,
    },
  });

  if (!guardedLiveQcEnabled()) return empty("guarded_live_qc_disabled");
  if (!args.schemaValid || !args.aiResult) return empty("schema_validation_failed");
  if (args.aiResult.provider_name_check.provider_names_present) return empty("provider_name_leak_blocked");

  const appliedChanges: GuardedLiveQcAppliedChange[] = [];
  const blockedActions: string[] = [];
  const warnings: string[] = [];
  const aiMarketRead = args.aiResult.recommended_market_read;
  const aiPlayGrade = args.aiResult.recommended_play_grade;
  const marketReadAgrees = originalMarketRead === null || aiMarketRead === originalMarketRead;

  if (args.aiResult.recommended_actions.includes("apply_copy_fixes")) {
    for (const fix of args.aiResult.safe_copy_fixes) {
      if (!envBool("AI_AUDITOR_APPLY_SAFE_COPY_FIXES", false)) {
        blockedActions.push(`copy_fix_disabled:${fix.field}`);
        continue;
      }
      if (!copyFixMatchesCanonical(fix, args.payload, originalMarketRead)) {
        blockedActions.push(`copy_fix_not_canonical:${fix.field}`);
        continue;
      }
      appliedChanges.push({
        action: "safe_copy_fix",
        field: fix.field,
        from: null,
        to: fix.replacement,
        reason: "ai_copy_fix_matches_canonical_decision",
      });
    }
  }

  if (args.aiResult.recommended_actions.includes("downgrade_grade")) {
    if (!envBool("AI_AUDITOR_APPLY_GUARDED_DOWNGRADES", false)) {
      blockedActions.push("guarded_downgrade_disabled");
    } else if (!originalPlayGrade || !deterministicAllowsDowngrade(args.payload, originalPlayGrade, aiPlayGrade)) {
      blockedActions.push("guarded_downgrade_lacks_deterministic_agreement");
    } else {
      appliedChanges.push({
        action: "guarded_downgrade",
        field: "play_grade",
        from: originalPlayGrade,
        to: aiPlayGrade,
        reason: "ai_downgrade_matches_deterministic_guardrail",
      });
    }
  }

  if (gradeRank(aiPlayGrade) > gradeRank(originalPlayGrade)) blockedActions.push("upgrade_blocked");
  if (args.aiResult.recommended_actions.includes("block_card")) {
    appliedChanges.push({
      action: "block_card",
      field: "card_visibility",
      from: "publishable",
      to: "blocked",
      reason: "ai_block_recommendation_for_coherence_or_data_integrity",
    });
  }
  if (!marketReadAgrees && appliedChanges.length === 0) warnings.push("ai_market_read_disagrees_with_canonical");

  const blocked = appliedChanges.some((change) => change.action === "block_card");
  const deterministicRuleAgreement = marketReadAgrees && !blockedActions.some((reason) => reason.includes("lacks_deterministic"));
  return {
    enabled: true,
    applied: appliedChanges.length > 0,
    blocked,
    deterministicRuleAgreement,
    status: blocked ? "block" : blockedActions.length > 0 || warnings.length > 0 ? "warn" : "pass",
    severity: blocked ? "block" : args.aiResult.severity,
    appliedChanges,
    blockedActions,
    warnings,
    ledgerMetadata: {
      originalMarketRead,
      aiRecommendedMarketRead: aiMarketRead,
      originalPlayGrade,
      aiRecommendedPlayGrade: aiPlayGrade,
      deterministicRuleAgreement,
      appliedChangeCount: appliedChanges.length,
      blockedActionCount: blockedActions.length,
      payloadHash: args.payload.payloadHash,
    },
  };
}
