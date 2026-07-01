import type { SanitizedAiOutput } from "@/lib/services/aiAuditor/dailyEdgeAiOutputSanitizer";
import type { MarketIntelligenceInterpretation } from "@/lib/services/dailyEdge/marketIntelligenceInterpreter";
import { renderDailyEdgeMemberCopy } from "@/lib/services/dailyEdge/memberFacingCopyRenderer";
import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import type { PredictionEvidenceReview } from "@/lib/services/dailyEdge/predictionEvidenceReviewer";

export type SelfHealingRepairAction = {
  finding: string;
  repairAttempted: boolean;
  repairApplied: boolean;
  repairType: string;
  repairConfidence: "high" | "medium" | "low";
  repairSource: string;
  before: unknown;
  after: unknown;
  revalidated: boolean;
  remainingIssues: string[];
  requiresHumanReview: boolean;
};

export type DailyEdgeSelfHealingResult = {
  repairedEvidence: PredictionEvidenceObject;
  repairedReaderFields: {
    marketReadLabel: string;
    quickReadCopy: string;
    marketReadCopy: string;
    supportingEvidenceCopy: string;
    riskCopy: string;
  };
  repairActions: SelfHealingRepairAction[];
  unresolvedIssues: string[];
  revalidationStatus: "passed" | "needs_human_review" | "blocked";
  sanitizerResult: SanitizedAiOutput | null;
};

export function selfHealDailyEdgePrediction(args: {
  evidence: PredictionEvidenceObject;
  evidenceReview: PredictionEvidenceReview;
  marketIntelligence: MarketIntelligenceInterpretation;
  sanitizerResult?: SanitizedAiOutput | null;
}): DailyEdgeSelfHealingResult {
  const copy = renderDailyEdgeMemberCopy({
    evidence: args.evidence,
    evidenceReview: args.evidenceReview,
    marketIntelligence: args.marketIntelligence,
  });
  const repairActions: SelfHealingRepairAction[] = [];
  if (args.evidenceReview.expectedMissingFields.length > 0) {
    repairActions.push({
      finding: "expected_missing_fields",
      repairAttempted: true,
      repairApplied: true,
      repairType: "mark_expected_non_material",
      repairConfidence: "high",
      repairSource: "deterministic_evidence_reviewer",
      before: args.evidenceReview.expectedMissingFields,
      after: "expected_non_material",
      revalidated: true,
      remainingIssues: [],
      requiresHumanReview: false,
    });
  }
  if (args.evidenceReview.persistenceGaps.length > 0) {
    repairActions.push({
      finding: "persistence_gaps",
      repairAttempted: true,
      repairApplied: false,
      repairType: "trusted_source_recovery_needed",
      repairConfidence: "medium",
      repairSource: "locked_snapshot_audit",
      before: args.evidenceReview.persistenceGaps,
      after: "unavailable_until_recovered_from_trusted_source",
      revalidated: false,
      remainingIssues: args.evidenceReview.persistenceGaps,
      requiresHumanReview: true,
    });
  }
  const unresolvedIssues = [
    ...args.evidenceReview.missingRequiredFields,
    ...args.evidenceReview.highMaterialityDataWarnings,
    ...args.evidenceReview.persistenceGaps,
    ...(args.sanitizerResult?.blockedReasons ?? []),
  ];
  return {
    repairedEvidence: args.evidence,
    repairedReaderFields: {
      marketReadLabel: copy.marketReadLabel,
      quickReadCopy: copy.quickReadCopy,
      marketReadCopy: copy.marketReadCopy,
      supportingEvidenceCopy: copy.supportingEvidenceCopy,
      riskCopy: copy.riskCopy,
    },
    repairActions,
    unresolvedIssues,
    revalidationStatus: args.evidenceReview.evidenceQuality === "blocked"
      ? "blocked"
      : unresolvedIssues.length > 0 ? "needs_human_review" : "passed",
    sanitizerResult: args.sanitizerResult ?? null,
  };
}
