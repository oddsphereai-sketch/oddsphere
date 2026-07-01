import {
  allowedDailyEdgeMemberCopyLabel,
  hasSharpWordingWithoutContext,
} from "@/lib/services/dailyEdge/memberFacingCopyRenderer";
import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";

export type SanitizerInput = {
  marketReadLabel?: string | null;
  marketReadCopy?: string | null;
  supportingEvidenceCopy?: string | null;
  riskCopy?: string | null;
  suggestedPlayGrade?: string | null;
  originalPlayGrade?: string | null;
  gradeChangeRecommended?: boolean | null;
  gradeChangeDirection?: string | null;
  validationErrors?: string[];
};

export type SanitizedAiOutput = {
  safeForAdminReview: boolean;
  safeForMemberCopy: boolean;
  safeMarketReadCopy: string | null;
  safeSupportingEvidenceCopy: string | null;
  safeRiskCopy: string | null;
  blockedReasons: string[];
  gradeChangeAcceptedForEvaluation: boolean;
  gradeChangeBlockedReason: string | null;
  copySanitized: boolean;
};

const PROVIDER_OR_SOURCE_LEAK_RE = /\b(playbook|sharpapi|circa|draftkings|fanduel|betmgm|pinnacle)\b/i;
const HYPE_RE = /\b(sharp money loves|overwhelmingly on|guaranteed|free money|lock of the day|lock play|stone cold lock|can't lose)\b/i;
const FI_MISSING_SPLIT_NEGATIVE_RE = /\b(missing|unavailable|not available|absent)\b.{0,80}\b(split bars?|splits?|sharp signal|sharp-book signal)\b.{0,80}\b(confidence|lower|hurts?|downgrade|block|uncertain|risk|negative|problem)\b/i;
const PREDICTION_SPECIFIC_RE = /\b(model|edge|price|juice|line|movement|starter|context|projection|projected|consensus|sharp-book|market resistance|mixed|value|grade|risk|support|probability|implied|yrfi|nrfi|over|under|moneyline)\b/i;

function cleanCopy(value: string | null | undefined): { value: string | null; sanitized: boolean; reasons: string[] } {
  if (!value || !value.trim()) return { value: null, sanitized: false, reasons: ["missing_copy"] };
  let out = value.trim();
  const reasons: string[] = [];
  if (PROVIDER_OR_SOURCE_LEAK_RE.test(out)) {
    out = out.replace(PROVIDER_OR_SOURCE_LEAK_RE, "market source");
    reasons.push("provider_or_source_leak");
  }
  if (HYPE_RE.test(out)) {
    out = out.replace(HYPE_RE, "market interest");
    reasons.push("betting_hype_language");
  }
  if (/\bsharp money\b/i.test(out)) {
    out = out.replace(/\bsharp money\b/ig, "Sharp-book signal");
    reasons.push("copy_overclaims_sharp_signal");
  }
  if (!PREDICTION_SPECIFIC_RE.test(out)) reasons.push("copy_not_prediction_specific");
  return { value: out, sanitized: reasons.length > 0, reasons };
}

export function sanitizeDailyEdgeAiOutput(row: PredictionEvidenceObject, input: SanitizerInput): SanitizedAiOutput {
  const blockedReasons = [...(input.validationErrors ?? [])];
  if (!allowedDailyEdgeMemberCopyLabel(row, input.marketReadLabel)) blockedReasons.push("market_read_label_wrong_market_type");

  const marketRead = cleanCopy(input.marketReadCopy);
  const supporting = cleanCopy(input.supportingEvidenceCopy);
  const risk = cleanCopy(input.riskCopy);
  blockedReasons.push(...marketRead.reasons, ...supporting.reasons, ...risk.reasons);

  if (row.identity.marketType === "FI") {
    const allCopy = [marketRead.value, supporting.value, risk.value].filter(Boolean).join("\n");
    if (FI_MISSING_SPLIT_NEGATIVE_RE.test(allCopy)) blockedReasons.push("fi_missing_split_used_as_negative");
  }
  if (hasSharpWordingWithoutContext(row, [marketRead.value, supporting.value, risk.value].filter(Boolean).join("\n"))) {
    blockedReasons.push("sharp_wording_without_sharp_context");
  }

  const uniqueReasons = [...new Set(blockedReasons)];
  const gradeChangeBlockedReason = uniqueReasons.find((reason) =>
    [
      "unsupported_grade_change",
      "unsupported_demotion",
      "unsupported_promotion",
      "grade_action_mismatch",
      "grade_reason_mismatch",
      "market_read_label_wrong_market_type",
    ].includes(reason),
  ) ?? null;

  const copyBlockers = uniqueReasons.filter((reason) =>
    [
      "provider_or_source_leak",
      "betting_hype_language",
      "copy_overclaims_sharp_signal",
      "sharp_wording_without_sharp_context",
      "fi_missing_split_used_as_negative",
      "copy_not_prediction_specific",
      "market_read_label_wrong_market_type",
    ].includes(reason),
  );

  return {
    safeForAdminReview: uniqueReasons.length === 0 || copyBlockers.length === 0,
    safeForMemberCopy: false,
    safeMarketReadCopy: marketRead.value,
    safeSupportingEvidenceCopy: supporting.value,
    safeRiskCopy: risk.value,
    blockedReasons: uniqueReasons,
    gradeChangeAcceptedForEvaluation: input.gradeChangeRecommended === true && gradeChangeBlockedReason === null,
    gradeChangeBlockedReason,
    copySanitized: marketRead.sanitized || supporting.sanitized || risk.sanitized,
  };
}
