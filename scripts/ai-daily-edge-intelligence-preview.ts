import crypto from "node:crypto";
import {
  buildDailyEdgeResponseForCostPreview,
  estimateCostUsd,
  parseAiAuditorMarkets,
  resolveAiAuditorPricing,
} from "@/lib/services/aiAuditor/costPreview";
import {
  AI_DAILY_EDGE_INTELLIGENCE_REVIEW_SCHEMA,
  AI_DAILY_EDGE_INTELLIGENCE_REVIEW_VARIANT,
  dailyEdgeIntelligenceSystemPrompt,
  dailyEdgeIntelligenceUserPayload,
} from "@/lib/services/aiAuditor/dailyEdgeIntelligenceReview";
import { currentMonthKey, insertAiAuditLedger } from "@/lib/services/aiAuditCostControl";
import { sanitizeDailyEdgeAiOutput } from "@/lib/services/aiAuditor/dailyEdgeAiOutputSanitizer";
import { selfHealDailyEdgePrediction } from "@/lib/services/dailyEdge/dailyEdgeSelfHealingEngine";
import { interpretMarketIntelligence } from "@/lib/services/dailyEdge/marketIntelligenceInterpreter";
import {
  allowedDailyEdgeMemberCopyLabel,
  renderDailyEdgeMemberCopy,
} from "@/lib/services/dailyEdge/memberFacingCopyRenderer";
import { reviewPredictionEvidence } from "@/lib/services/dailyEdge/predictionEvidenceReviewer";
import { type PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import { buildPredictionEvidenceForDailyEdgeEvaluation } from "@/lib/services/dailyEdge/lockedPredictionEvidenceSource";
import type { Sport } from "@/lib/types/domain/Sport";

const MARKET_SPECIFIC_VARIANTS = new Set([
  AI_DAILY_EDGE_INTELLIGENCE_REVIEW_VARIANT,
  "ai_v5_moneyline_intelligence_review",
  "ai_v5_totals_intelligence_review",
  "ai_v5_first_inning_intelligence_review",
  "ai_v5_market_specific_intelligence_review",
]);

type Args = {
  sport: Sport;
  date: string;
  markets: string;
  mode: "dry-run" | "paid-sample";
  json: boolean;
  nanoOnly: boolean;
  maxCostUsd: number | null;
  variant: string;
  runId: string | null;
};

type IntelligenceReviewResult = {
  model_stats_review: Record<string, unknown>;
  market_read_review: {
    marketReadLabel?: string;
    memberFacingMarketReadCopy?: string;
    [key: string]: unknown;
  };
  price_value_review: Record<string, unknown>;
  grade_alignment_review: {
    originalPlayGrade?: string;
    gradeAlignmentVerdict?: string;
    suggestedPlayGrade?: string;
    actionVsOriginal?: string;
    gradeReasonType?: string;
    winCaseStrengthScore?: number;
    bettingValueStrengthScore?: number;
    marketContextScore?: number;
    priceQualityScore?: number;
    modelStatSupportScore?: number;
    dataQualityScore?: number;
    riskPenaltyScore?: number;
    readQualityScore?: number;
    bestAngleProfile?: string;
    bestAngleThesis?: string;
    whyMarketFrictionDoesOrDoesNotBlock?: string;
    whyPriceDoesOrDoesNotBlock?: string;
    whyThisCanOrCannotBeTopTier?: string;
    gradeChangeRecommended?: boolean;
    gradeChangeDirection?: string;
    gradeChangeMateriality?: string;
    gradeChangeEvidence?: string[];
    primaryGradeChangeReason?: string;
    whyCopyOnlyIsNotEnough?: string;
    isRiskCopyEnough?: boolean;
    marketReadImprovementRecommended?: boolean;
    supportingEvidenceImprovementRecommended?: boolean;
    riskNoteImprovementRecommended?: boolean;
    copyOnlyImprovementRecommended?: boolean;
    humanReviewRecommended?: boolean;
    overgradedCandidate?: boolean;
    undergradedCandidate?: boolean;
    overgradeReason?: string;
    undergradeReason?: string;
    upgradeEvidence?: string[];
    downgradeEvidence?: string[];
    [key: string]: unknown;
  };
  reader_coherence_review: {
    marketReadCopyAligned?: boolean;
    supportingEvidenceAligned?: boolean;
    riskNoteAligned?: boolean;
    gradeCopyContradiction?: boolean;
    providerLeakDetected?: boolean;
    suggestedMarketReadCopy?: string;
    suggestedSupportingEvidenceCopy?: string;
    suggestedRiskCopy?: string;
    contradictionReasons?: string[];
    [key: string]: unknown;
  };
  slate_balance_flags: Record<string, boolean | unknown>;
  safety_review: {
    postgame_data_present?: boolean;
    provider_names_present?: boolean;
    invented_data_detected?: boolean;
    invalid_grade_label?: boolean;
    attempted_pick_flip?: boolean;
    attempted_probability_change?: boolean;
    attempted_projected_score_change?: boolean;
    attempted_live_apply_change?: boolean;
  };
  confidence: number;
  severity: "info" | "low" | "medium" | "high" | "block";
};

type PaidCall = {
  evidence: PredictionEvidenceObject;
  payloadHash: string;
  result: IntelligenceReviewResult | null;
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
    json: false,
    nanoOnly: false,
    maxCostUsd: null,
    variant: AI_DAILY_EDGE_INTELLIGENCE_REVIEW_VARIANT,
    runId: null,
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
    if (key === "max-cost-usd") out.maxCostUsd = Number(value);
    if (key === "variant") out.variant = value;
    if (key === "run-id") out.runId = value.trim() || null;
  }
  return out;
}

function tokenEstimate(value: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function groupByMarket(evidence: PredictionEvidenceObject[]) {
  return evidence.reduce<Record<string, PredictionEvidenceObject[]>>((acc, item) => {
    const market = item.identity.normalizedMarket;
    acc[market] = acc[market] ?? [];
    acc[market].push(item);
    return acc;
  }, {});
}

function completeness(evidence: PredictionEvidenceObject[]) {
  const grouped = groupByMarket(evidence);
  return Object.fromEntries(Object.entries(grouped).map(([market, rows]) => {
    const count = rows.length;
    const requiredSourceRows = rows.filter((row) => row.identity.marketType !== "FI");
    return [market, {
      rows: count,
      price: { count: rows.filter((row) => row.priceValueEvidence.priceAmerican !== null).length, pct: pct(rows.filter((row) => row.priceValueEvidence.priceAmerican !== null).length, count) },
      modelProbability: { count: rows.filter((row) => row.modelStatsEvidence.modelProbability !== null).length, pct: pct(rows.filter((row) => row.modelStatsEvidence.modelProbability !== null).length, count) },
      edge: { count: rows.filter((row) => row.modelStatsEvidence.edge !== null).length, pct: pct(rows.filter((row) => row.modelStatsEvidence.edge !== null).length, count) },
      marketImplied: { count: rows.filter((row) => row.modelStatsEvidence.marketImpliedProbability !== null).length, pct: pct(rows.filter((row) => row.modelStatsEvidence.marketImpliedProbability !== null).length, count) },
      lineValue: { count: rows.filter((row) => row.identity.lineValue !== null).length, pct: pct(rows.filter((row) => row.identity.lineValue !== null).length, count) },
      consensusSplits: { count: rows.filter((row) => row.marketEvidence.consensusSplitsAvailable).length, pct: pct(rows.filter((row) => row.marketEvidence.consensusSplitsAvailable).length, count) },
      sharpBookSplitsOrSignal: {
        count: rows.filter((row) => row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable).length,
        pct: pct(rows.filter((row) => row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable).length, count),
      },
      sourceRequirement: market === "first_inning"
        ? "not_required"
        : `${requiredSourceRows.length} rows require Consensus + Sharp context when available`,
      marketRead: { count: rows.filter((row) => row.marketEvidence.marketReadRaw !== null).length, pct: pct(rows.filter((row) => row.marketEvidence.marketReadRaw !== null).length, count) },
      fiCoreUsable: market === "first_inning"
        ? { count: rows.filter((row) => row.priceValueEvidence.priceAmerican !== null && row.modelStatsEvidence.modelProbability !== null && row.modelStatsEvidence.edge !== null).length, pct: pct(rows.filter((row) => row.priceValueEvidence.priceAmerican !== null && row.modelStatsEvidence.modelProbability !== null && row.modelStatsEvidence.edge !== null).length, count) }
        : null,
    }];
  }));
}

function displayReadiness(evidence: PredictionEvidenceObject[]) {
  return evidence.map((row) => ({
    evidenceSource: row.evidenceSource.kind,
    asOfTimestamp: row.evidenceSource.asOfTimestamp,
    game: `${row.identity.awayTeam} @ ${row.identity.homeTeam}`,
    market: row.identity.normalizedMarket,
    pick: row.identity.pick,
    originalGrade: row.identity.originalPlayGrade,
    marketRead: row.marketEvidence.deterministicMarketRead,
    consensusSplitsDisplayReady: row.marketEvidence.consensusSplitsAvailable,
    sharpBookSplitsDisplayReady: row.marketEvidence.sharpBookSplitsAvailable,
    sharpBookSignalDisplayReady: row.marketEvidence.sharpBookSignalAvailable,
    sourceAgreement: row.marketEvidence.sourceAgreement,
    sourceMissingReason: row.marketEvidence.sourceMissingReason,
    sourceMissingMateriality: row.marketEvidence.sourceMissingMateriality,
    fiMissingSplitsExpected: row.identity.marketType === "FI",
  }));
}

function splitCoverage(evidence: PredictionEvidenceObject[]) {
  const rowsFor = (market: string) => evidence.filter((row) => row.identity.normalizedMarket === market);
  const coverage = (rows: PredictionEvidenceObject[]) => ({
    rows: rows.length,
    consensusCoverage: { count: rows.filter((row) => row.marketEvidence.consensusSplitsAvailable).length, pct: pct(rows.filter((row) => row.marketEvidence.consensusSplitsAvailable).length, rows.length) },
    sharpFullSplitCoverage: { count: rows.filter((row) => row.marketEvidence.sharpBookSplitsAvailable).length, pct: pct(rows.filter((row) => row.marketEvidence.sharpBookSplitsAvailable).length, rows.length) },
    sharpSignalCoverage: { count: rows.filter((row) => row.marketEvidence.sharpBookSignalAvailable).length, pct: pct(rows.filter((row) => row.marketEvidence.sharpBookSignalAvailable).length, rows.length) },
    sharpAnyCoverage: { count: rows.filter((row) => row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable).length, pct: pct(rows.filter((row) => row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable).length, rows.length) },
  });
  return {
    moneyline: coverage(rowsFor("moneyline")),
    total: coverage(rowsFor("total")),
  };
}

function countBy<T>(rows: T[], fn: (row: T) => unknown): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = String(fn(row) ?? "null");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function marketSpecificPrompt(variant: string, market: string): string {
  if (variant === "ai_v5_moneyline_intelligence_review" || market === "moneyline") {
    return [
      "You are the OddSphere Moneyline Intelligence Reviewer.",
      "Review one ML prediction only: win case, model probability vs implied, price/value, favorite/dog profile, consensus/sharp relationship, movement, and betting thesis.",
      "Use only ML labels and do not use FI or Total labels.",
      "Separate grade changes from copy/risk/market-read improvements.",
    ].join("\n");
  }
  if (variant === "ai_v5_totals_intelligence_review" || market === "total") {
    return [
      "You are the OddSphere Totals Intelligence Reviewer.",
      "Review one Total prediction only: projection vs line, Over/Under direction, edge at current number, price/value, movement, run environment, and betting thesis.",
      "Use only Total labels and do not use ML or FI labels.",
      "Separate grade changes from copy/risk/market-read improvements.",
    ].join("\n");
  }
  return [
    "You are the OddSphere First Inning Intelligence Reviewer.",
    "Default FI to deterministic review: FI pick, model probability/edge, price/juice, starter/top-order context, and FI movement.",
    "FI does not require consensus/sharp split bars. Never use missing split bars as a negative.",
  ].join("\n");
}

function marketSpecificUserPayload(args: {
  variant: string;
  evidence: PredictionEvidenceObject;
  evidenceReview: ReturnType<typeof reviewPredictionEvidence>;
  marketIntelligence: ReturnType<typeof interpretMarketIntelligence>;
}) {
  return {
    variant: args.variant,
    task: "Market-specific Daily Edge Intelligence review. Deterministic evidence review and market interpretation are provided. No live changes.",
    evidence: args.evidence,
    evidenceReview: args.evidenceReview,
    marketIntelligence: args.marketIntelligence,
    guardrails: {
      noLiveChanges: true,
      noMemberFacingChanges: true,
      noAppliedGradeChanges: true,
      noPickFlips: true,
      noProbabilityChanges: true,
      noProjectionChanges: true,
      factualRepairFromTrustedSourcesOnly: true,
    },
  };
}

function marketSpecificDryRunReport(args: {
  variant: string;
  evidence: PredictionEvidenceObject[];
  pricing: ReturnType<typeof resolveAiAuditorPricing>;
}) {
  const rows = args.evidence.map((evidence) => {
    const evidenceReview = reviewPredictionEvidence(evidence);
    const marketIntelligence = interpretMarketIntelligence(evidence);
    const healed = selfHealDailyEdgePrediction({
      evidence,
      evidenceReview,
      marketIntelligence,
      sanitizerResult: null,
    });
    const sanitizer = sanitizeDailyEdgeAiOutput(evidence, {
      marketReadLabel: healed.repairedReaderFields.marketReadLabel,
      marketReadCopy: healed.repairedReaderFields.marketReadCopy,
      supportingEvidenceCopy: healed.repairedReaderFields.supportingEvidenceCopy,
      riskCopy: healed.repairedReaderFields.riskCopy,
      originalPlayGrade: evidence.identity.originalPlayGrade,
      suggestedPlayGrade: evidence.identity.originalPlayGrade,
      gradeChangeRecommended: false,
      gradeChangeDirection: "hold",
      validationErrors: [],
    });
    return {
      evidence,
      evidenceReview,
      marketIntelligence,
      healed: {
        ...healed,
        sanitizerResult: sanitizer,
      },
      sanitizer,
    };
  });
  const paidEligibleRows = rows.filter((row) => row.evidence.identity.marketType !== "FI");
  const mlRows = rows.filter((row) => row.evidence.identity.normalizedMarket === "moneyline");
  const totalRows = rows.filter((row) => row.evidence.identity.normalizedMarket === "total");
  const fiRows = rows.filter((row) => row.evidence.identity.normalizedMarket === "first_inning");
  const estimateFor = (subset: typeof rows) => {
    const inputTokens = subset.reduce((sum, row) => {
      const prompt = marketSpecificPrompt(args.variant, row.evidence.identity.normalizedMarket);
      return sum + tokenEstimate(prompt) + tokenEstimate(marketSpecificUserPayload({
        variant: args.variant,
        evidence: row.evidence,
        evidenceReview: row.evidenceReview,
        marketIntelligence: row.marketIntelligence,
      }));
    }, 0);
    const outputTokens = subset.length * 700;
    return {
      rows: subset.length,
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedCostUsd: estimateCostUsd(
        inputTokens,
        outputTokens,
        args.pricing.nanoInputUsdPerMillion,
        args.pricing.nanoOutputUsdPerMillion,
      ),
    };
  };
  const copySafetyFindings = rows.reduce<Record<string, number>>((acc, row) => {
    for (const reason of row.sanitizer.blockedReasons) acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});
  const marketReport = (subset: typeof rows) => ({
    evidenceCount: subset.length,
    evidenceQualityDistribution: countBy(subset, (row) => row.evidenceReview.evidenceQuality),
    reviewModeAllowedDistribution: countBy(subset, (row) => row.evidenceReview.reviewModeAllowed),
    gradeChangeAllowedCount: subset.filter((row) => row.evidenceReview.gradeChangeAllowed).length,
    copyReviewAllowedCount: subset.filter((row) => row.evidenceReview.copyReviewAllowed).length,
    missingRequiredFields: countBy(
      subset.flatMap((row) => row.evidenceReview.missingRequiredFields),
      (field) => field,
    ),
    expectedMissingFields: countBy(
      subset.flatMap((row) => row.evidenceReview.expectedMissingFields),
      (field) => field,
    ),
    persistenceGaps: countBy(
      subset.flatMap((row) => row.evidenceReview.persistenceGaps),
      (field) => field,
    ),
    highMaterialityWarnings: countBy(
      subset.flatMap((row) => row.evidenceReview.highMaterialityDataWarnings),
      (field) => field,
    ),
    labelValidationFailures: subset.filter((row) => row.sanitizer.blockedReasons.includes("market_read_label_wrong_market_type")).length,
    copyValidationFindings: countBy(
      subset.flatMap((row) => row.sanitizer.blockedReasons),
      (field) => field,
    ),
    rawAiCopyReadyForMemberCopy: subset.filter((row) => row.sanitizer.safeForMemberCopy).length,
    deterministicRendererReadyForMemberCopy: subset.filter((row) =>
      Boolean(row.healed.repairedReaderFields.marketReadCopy) &&
      Boolean(row.healed.repairedReaderFields.supportingEvidenceCopy) &&
      Boolean(row.healed.repairedReaderFields.riskCopy)
    ).length,
    sanitizerReadyForAdminReview: subset.filter((row) => row.sanitizer.safeForAdminReview).length,
    gradeChangeCopyFieldsPresent: subset.length,
  });
  return {
    architecture: "market_specific_daily_edge_self_healing_v5",
    variant: args.variant,
    paidAiCalls: 0,
    deterministicFirst: true,
    dataEvidenceReviewer: {
      allMarkets: marketReport(rows),
      moneyline: marketReport(mlRows),
      total: marketReport(totalRows),
      firstInning: marketReport(fiRows),
    },
    marketIntelligenceReport: {
      moneyline: {
        rows: mlRows.length,
        movementTowardPickCoverage: mlRows.filter((row) => row.marketIntelligence.movementTowardPick !== null).length,
        consensusVsSharpRelationshipDistribution: countBy(mlRows, (row) => row.marketIntelligence.consensusVsSharpRelationship),
        currentNumberPlayableCoverage: mlRows.filter((row) => row.marketIntelligence.currentNumberPlayable !== null).length,
        marketReadThesisCoverage: mlRows.filter((row) => row.marketIntelligence.marketReadThesis.length > 0).length,
        marketFrictionLevelDistribution: countBy(mlRows, (row) => row.marketIntelligence.marketFrictionLevel),
        modelMarketRelationshipDistribution: countBy(mlRows, (row) => row.marketIntelligence.modelMarketRelationship),
      },
      total: {
        rows: totalRows.length,
        movementTowardPickCoverage: totalRows.filter((row) => row.marketIntelligence.movementTowardPick !== null).length,
        consensusVsSharpRelationshipDistribution: countBy(totalRows, (row) => row.marketIntelligence.consensusVsSharpRelationship),
        currentNumberPlayableCoverage: totalRows.filter((row) => row.marketIntelligence.currentNumberPlayable !== null).length,
        marketReadThesisCoverage: totalRows.filter((row) => row.marketIntelligence.marketReadThesis.length > 0).length,
        marketFrictionLevelDistribution: countBy(totalRows, (row) => row.marketIntelligence.marketFrictionLevel),
        modelMarketRelationshipDistribution: countBy(totalRows, (row) => row.marketIntelligence.modelMarketRelationship),
      },
    },
    fiReport: {
      deterministicFiCopyCount: fiRows.filter((row) => row.healed.repairedReaderFields.marketReadCopy.length > 0).length,
      fiCoreUsableCount: fiRows.filter((row) => row.evidenceReview.priceValueAvailable && row.evidenceReview.modelStatContextAvailable).length,
      fiPriceCoverage: fiRows.filter((row) => row.evidence.priceValueEvidence.priceAmerican !== null).length,
      noMissingSplitNegativeCopy: fiRows.filter((row) => !row.sanitizer.blockedReasons.includes("fi_missing_split_used_as_negative")).length,
      noGenericNoSignalCopy: fiRows.filter((row) => !/no clear signal/i.test(row.healed.repairedReaderFields.marketReadCopy)).length,
      estimatedPaidCostUsd: 0,
    },
    selfHealingReport: {
      repairActions: countBy(rows.flatMap((row) => row.healed.repairActions), (action) => action.repairType),
      revalidationStatusDistribution: countBy(rows, (row) => row.healed.revalidationStatus),
      unresolvedIssueDistribution: countBy(rows.flatMap((row) => row.healed.unresolvedIssues), (issue) => issue),
      rawAiCopyShownDirectlyCount: 0,
      deterministicRendererReadyForMemberCopyCount: rows.filter((row) =>
        Boolean(row.healed.repairedReaderFields.marketReadCopy) &&
        Boolean(row.healed.repairedReaderFields.supportingEvidenceCopy) &&
        Boolean(row.healed.repairedReaderFields.riskCopy)
      ).length,
      safeForAdminReviewCount: rows.filter((row) => row.sanitizer.safeForAdminReview).length,
    },
    copySafetyFindings,
    unsupportedGradeChangeLogic: {
      gradeChangesAutoApplied: 0,
      gradeChangesEvaluationOnly: true,
      unsupportedGradeChangesBlockedBySanitizer: true,
      copyOnlyRepairsPreservedWhenGradeChangeBlocked: true,
    },
    costPreviewByMarket: {
      moneylineOnly: estimateFor(mlRows),
      totalsOnly: estimateFor(totalRows),
      firstInningDeterministic: { rows: fiRows.length, estimatedCostUsd: 0 },
      mlPlusTotals: estimateFor(paidEligibleRows),
      allMarketsIfFiPaidLater: estimateFor(rows),
    },
    examples: rows.slice(0, 6).map((row) => ({
      game: `${row.evidence.identity.awayTeam} @ ${row.evidence.identity.homeTeam}`,
      market: row.evidence.identity.normalizedMarket,
      pick: row.evidence.identity.pick,
      originalGrade: row.evidence.identity.originalPlayGrade,
      evidenceQuality: row.evidenceReview.evidenceQuality,
      reviewModeAllowed: row.evidenceReview.reviewModeAllowed,
      marketReadLabel: row.healed.repairedReaderFields.marketReadLabel,
      marketReadCopy: row.healed.repairedReaderFields.marketReadCopy,
      supportingEvidenceCopy: row.healed.repairedReaderFields.supportingEvidenceCopy,
      riskCopy: row.healed.repairedReaderFields.riskCopy,
      sanitizerBlockedReasons: row.sanitizer.blockedReasons,
      unresolvedIssues: row.healed.unresolvedIssues,
    })),
  };
}

function money(value: number): string {
  return `$${value.toFixed(4)}`;
}

function payloadHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function envFalse(name: string): boolean {
  return process.env[name] === "false" || process.env[name] === undefined || process.env[name] === "";
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

const PROVIDER_OR_SOURCE_LEAK_RE = /\b(playbook|sharpapi|circa|draftkings|fanduel|betmgm|pinnacle)\b/i;
const BETTING_HYPE_RE = /\b(sharp money loves|overwhelmingly on|guaranteed|free money|lock of the day|lock play|stone cold lock|can't lose)\b/i;
const FI_MISSING_SPLIT_COPY_RE = /\b(split bars?|splits?|sharp signal|sharp-book signal)\b.{0,50}\b(unavailable|missing|not available|absent)\b|\b(unavailable|missing|not available|absent)\b.{0,50}\b(split bars?|splits?|sharp signal|sharp-book signal)\b/i;
const FI_MISSING_SPLIT_NEGATIVE_RE = /\b(missing|unavailable|not available|absent)\b.{0,80}\b(split bars?|splits?|sharp signal|sharp-book signal)\b.{0,80}\b(confidence|lower|hurts?|downgrade|block|uncertain|risk|negative|problem)\b/i;
const PREDICTION_SPECIFIC_RE = /\b(model|edge|price|juice|line|movement|starter|context|projection|projected|consensus|sharp-book|market resistance|mixed|value|grade|risk|support|split|probability|implied)\b/i;
const PRIMARY_REASON_RE = /\b(model|edge|price|juice|value|market|consensus|sharp-book|line|movement|resistance|projection|starter|context|risk|data|toss-up)\b/i;
const GENERIC_DOWNGRADE_RE = /\b(not elite|not top[- ]?tier|risk exists|some risk|be careful|caution|uncertain|not clean)\b/i;
const GENERIC_PROMOTION_RE = /\b(looks good|strong play|good spot|like this|interesting|promising)\b/i;

function memberFacingText(result: IntelligenceReviewResult): string {
  return [
    result.market_read_review?.memberFacingMarketReadCopy,
    result.reader_coherence_review?.suggestedMarketReadCopy,
    result.reader_coherence_review?.suggestedSupportingEvidenceCopy,
    result.reader_coherence_review?.suggestedRiskCopy,
  ].filter(Boolean).join("\n");
}

function assertPaidGate(args: Args, estimatedCostUsd: number): void {
  if (args.mode !== "paid-sample") return;
  const enabled = process.env.AI_DAILY_EDGE_INTELLIGENCE_ENABLED === "true" ||
    process.env.AI_MARKET_ANALYST_CURRENT_ENABLED === "true";
  if (!enabled) throw new Error("Paid v5 Daily Edge Intelligence is disabled. Set AI_DAILY_EDGE_INTELLIGENCE_ENABLED=true or AI_MARKET_ANALYST_CURRENT_ENABLED=true after explicit approval.");
  if (!process.env.OPENAI_API_KEY) throw new Error("paid-sample requires OPENAI_API_KEY.");
  if (!args.nanoOnly) throw new Error("paid-sample requires --nano-only.");
  if (process.env.AI_AUDITOR_DISABLE_GPT55_LIVE === "false") throw new Error("GPT-5.5 live disable guard must remain enabled.");
  if (!envFalse("AI_AUDITOR_GUARDED_LIVE_QC")) throw new Error("AI_AUDITOR_GUARDED_LIVE_QC must be false.");
  if (!envFalse("AI_AUDITOR_APPLY_SAFE_COPY_FIXES")) throw new Error("AI_AUDITOR_APPLY_SAFE_COPY_FIXES must be false.");
  if (!envFalse("AI_AUDITOR_APPLY_GUARDED_DOWNGRADES")) throw new Error("AI_AUDITOR_APPLY_GUARDED_DOWNGRADES must be false.");
  if (!envFalse("AI_AUDITOR_ALLOW_PICK_FLIPS")) throw new Error("AI_AUDITOR_ALLOW_PICK_FLIPS must be false.");
  if (!envFalse("AI_AUDITOR_ALLOW_PROBABILITY_CHANGES")) throw new Error("AI_AUDITOR_ALLOW_PROBABILITY_CHANGES must be false.");
  const cap = args.maxCostUsd ?? Number(process.env.AI_DAILY_EDGE_INTELLIGENCE_HARD_CAP_USD ?? process.env.AI_MARKET_ANALYST_CURRENT_HARD_CAP_USD ?? 5);
  if (estimatedCostUsd > cap) throw new Error(`Estimated v5 evaluation cost ${money(estimatedCostUsd)} exceeds hard cap ${money(cap)}.`);
}

function paidVariantAllowedForMarkets(variant: string, markets: ReturnType<typeof parseAiAuditorMarkets>): boolean {
  if (variant === AI_DAILY_EDGE_INTELLIGENCE_REVIEW_VARIANT) return true;
  if (variant === "ai_v5_moneyline_intelligence_review") return markets.length === 1 && markets[0] === "moneyline";
  if (variant === "ai_v5_totals_intelligence_review") return markets.length === 1 && markets[0] === "total";
  if (variant === "ai_v5_first_inning_intelligence_review") return markets.length === 1 && markets[0] === "first_inning";
  return false;
}

function promptForCall(variant: string, evidence: PredictionEvidenceObject): string {
  if (variant === AI_DAILY_EDGE_INTELLIGENCE_REVIEW_VARIANT) return dailyEdgeIntelligenceSystemPrompt();
  return marketSpecificPrompt(variant, evidence.identity.normalizedMarket);
}

function payloadForCall(variant: string, evidence: PredictionEvidenceObject) {
  if (variant === AI_DAILY_EDGE_INTELLIGENCE_REVIEW_VARIANT) return dailyEdgeIntelligenceUserPayload(evidence);
  return marketSpecificUserPayload({
    variant,
    evidence,
    evidenceReview: reviewPredictionEvidence(evidence),
    marketIntelligence: interpretMarketIntelligence(evidence),
  });
}

async function callOpenAi(variant: string, evidence: PredictionEvidenceObject): Promise<{
  result: IntelligenceReviewResult;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number;
}> {
  const pricing = resolveAiAuditorPricing();
  if (pricing.nanoModel.toLowerCase().includes("gpt-5.5")) throw new Error("GPT-5.5 is blocked for v5 Daily Edge Intelligence evaluations.");
  const systemPrompt = promptForCall(variant, evidence);
  const userPayload = payloadForCall(variant, evidence);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: pricing.nanoModel,
          input: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(userPayload) },
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
      if (!response.ok) throw new Error(`OpenAI v5 Daily Edge Intelligence call failed: HTTP ${response.status} ${JSON.stringify(json)}`);
      const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      const inputTokens = Number(usage?.input_tokens ?? tokenEstimate(userPayload));
      const outputTokens = Number(usage?.output_tokens ?? 1000);
      return {
        result: JSON.parse(parseOutputText(json)) as IntelligenceReviewResult,
        inputTokens,
        outputTokens,
        actualCostUsd: estimateCostUsd(inputTokens, outputTokens, pricing.nanoInputUsdPerMillion, pricing.nanoOutputUsdPerMillion),
      };
    } catch (error) {
      lastError = error;
      if (attempt >= 2) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function validateResult(evidence: PredictionEvidenceObject, result: IntelligenceReviewResult | null): string[] {
  if (!result) return ["invalid_json"];
  const errors: string[] = [];
  const grade = result.grade_alignment_review ?? {};
  const safety = result.safety_review ?? {};
  const marketReadLabel = String(result.market_read_review?.marketReadLabel ?? "");
  const copyText = memberFacingText(result);
  const gradeReasonText = [
    grade.gradeReason,
    grade.bestAngleThesis,
    grade.whyMarketFrictionDoesOrDoesNotBlock,
    grade.whyPriceDoesOrDoesNotBlock,
    grade.whyThisCanOrCannotBeTopTier,
    ...(Array.isArray(grade.materialBlockers) ? grade.materialBlockers : []),
  ].filter(Boolean).join("\n");
  const requiredScores = [
    "winCaseStrengthScore",
    "bettingValueStrengthScore",
    "marketContextScore",
    "priceQualityScore",
    "modelStatSupportScore",
    "dataQualityScore",
    "riskPenaltyScore",
    "readQualityScore",
  ] as const;
  for (const key of requiredScores) {
    const value = grade[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) errors.push(`grade_dimension_missing:${key}`);
  }
  if (!grade.gradeReasonType) errors.push("grade_reason_type_missing");
  if (grade.originalPlayGrade !== evidence.identity.originalPlayGrade) errors.push("grade_echo_mismatch");
  if (!allowedDailyEdgeMemberCopyLabel(evidence, marketReadLabel)) errors.push("market_read_label_wrong_market_type");
  if (grade.suggestedPlayGrade && grade.actionVsOriginal) {
    const direction = gradeDirection(evidence.identity.originalPlayGrade, grade.suggestedPlayGrade);
    if ((direction === "promotion" && grade.actionVsOriginal !== "promote") ||
      (direction === "downgrade" && grade.actionVsOriginal !== "downgrade") ||
      (direction === "hold" && grade.actionVsOriginal !== "hold")) {
      errors.push("grade_reason_mismatch");
    }
    const expectedGradeChangeDirection = direction === "promotion" ? "promote" : direction;
    if (grade.gradeChangeDirection && grade.gradeChangeDirection !== expectedGradeChangeDirection) {
      errors.push("grade_action_mismatch");
    }
    if (typeof grade.gradeChangeRecommended === "boolean" && grade.gradeChangeRecommended !== (direction !== "hold")) {
      errors.push("grade_action_mismatch");
    }
    if (direction !== "hold") {
      const materiality = String(grade.gradeChangeMateriality ?? "");
      const evidenceItems = Array.isArray(grade.gradeChangeEvidence) ? grade.gradeChangeEvidence.filter(Boolean) : [];
      const primaryReason = String(grade.primaryGradeChangeReason ?? grade.gradeReason ?? "");
      const copyOnlyEnough = grade.isRiskCopyEnough === true || grade.copyOnlyImprovementRecommended === true && !String(grade.whyCopyOnlyIsNotEnough ?? "").trim();
      if (materiality !== "medium" && materiality !== "high") errors.push("unsupported_grade_change");
      if (evidenceItems.length === 0) errors.push("unsupported_grade_change");
      if (copyOnlyEnough) errors.push("unsupported_grade_change");
      if (direction === "downgrade") {
        const downgradeEvidence = Array.isArray(grade.downgradeEvidence) ? grade.downgradeEvidence.filter(Boolean) : [];
        if (GENERIC_DOWNGRADE_RE.test(primaryReason) && downgradeEvidence.length === 0) errors.push("unsupported_demotion");
        if (Number(grade.riskPenaltyScore ?? 0) < 25 && materiality !== "high" && downgradeEvidence.length === 0) errors.push("unsupported_demotion");
      }
      if (direction === "promotion") {
        const upgradeEvidence = Array.isArray(grade.upgradeEvidence) ? grade.upgradeEvidence.filter(Boolean) : [];
        const modelValueSupport = Number(grade.bettingValueStrengthScore ?? 0) >= 55 ||
          Number(grade.winCaseStrengthScore ?? 0) >= 60 ||
          Number(grade.marketContextScore ?? 0) >= 65;
        if (GENERIC_PROMOTION_RE.test(primaryReason) && upgradeEvidence.length === 0) errors.push("unsupported_promotion");
        if (!modelValueSupport && upgradeEvidence.length === 0) errors.push("unsupported_promotion");
      }
    } else if (grade.gradeChangeRecommended === true) {
      errors.push("grade_action_mismatch");
    }
  }
  if (grade.overgradedCandidate === true && !String(grade.overgradeReason ?? "").trim()) errors.push("copy_missing_primary_reason");
  if (grade.undergradedCandidate === true && !String(grade.undergradeReason ?? "").trim()) errors.push("copy_missing_primary_reason");
  if (grade.suggestedPlayGrade === "Lean" && Number(grade.bettingValueStrengthScore ?? 0) < 45 && Number(grade.winCaseStrengthScore ?? 0) < 55) {
    errors.push("lean_without_actionable_value");
  }
  if (grade.suggestedPlayGrade === "Watchlist" && Number(grade.bettingValueStrengthScore ?? 0) >= 65 && Number(grade.winCaseStrengthScore ?? 0) >= 60 && Number(grade.riskPenaltyScore ?? 100) < 30) {
    errors.push("watchlist_with_strong_actionable_value");
  }
  if (grade.suggestedPlayGrade === "Best Angle" && !String(grade.bestAngleThesis ?? "").trim()) errors.push("best_angle_without_clear_thesis");
  if (grade.suggestedPlayGrade === "Caution" && Number(grade.riskPenaltyScore ?? 0) < 20 && Number(grade.dataQualityScore ?? 0) >= 60) {
    errors.push("caution_without_material_risk");
  }
  if (grade.suggestedPlayGrade === "No Play" && Number(grade.bettingValueStrengthScore ?? 0) >= 65 && Number(grade.winCaseStrengthScore ?? 0) >= 60) {
    errors.push("no_play_with_strong_value_unexplained");
  }
  if (evidence.identity.marketType === "FI" && evidence.marketEvidence.sourceMissingMateriality === "low") {
    if (FI_MISSING_SPLIT_COPY_RE.test(copyText)) errors.push("fi_copy_mentions_missing_splits");
    if (FI_MISSING_SPLIT_NEGATIVE_RE.test(`${copyText}\n${gradeReasonText}`)) errors.push("fi_missing_split_used_as_negative");
    const genericNoSignal = /\bno clear (fi |first-inning |market )?signal\b/i.test(copyText);
    if (genericNoSignal && !PREDICTION_SPECIFIC_RE.test(copyText.replace(/no clear (fi |first-inning |market )?signal/ig, ""))) {
      errors.push("fi_generic_no_signal_copy");
    }
    if (!/\b(model|edge|price|juice|starter|context|movement|early|offense|probability|implied)\b/i.test(copyText)) {
      errors.push("fi_copy_lacks_prediction_specific_context");
    }
  }
  if (PROVIDER_OR_SOURCE_LEAK_RE.test(copyText) || safety.provider_names_present || result.reader_coherence_review?.providerLeakDetected) {
    errors.push("provider_or_source_leak");
  }
  if (BETTING_HYPE_RE.test(copyText)) errors.push("betting_hype_language");
  if (/\b(sharp money)\b/i.test(copyText)) errors.push("copy_overclaims_sharp_signal");
  if (copyText.trim().length > 0 && !PREDICTION_SPECIFIC_RE.test(copyText)) errors.push("generic_copy_detected");
  if (copyText.trim().length > 0 && !PRIMARY_REASON_RE.test(copyText)) errors.push("copy_missing_primary_reason");
  if (copyText.trim().length > 0 && copyText.split(/\s+/).length <= 7) errors.push("copy_not_prediction_specific");
  if (safety.provider_names_present || result.reader_coherence_review?.providerLeakDetected) errors.push("provider_name_leak");
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
    "provider_name_leak",
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

async function logLedger(evidence: PredictionEvidenceObject, call: PaidCall): Promise<string | null> {
  return await insertAiAuditLedger({
    month_key: currentMonthKey(),
    sport: evidence.identity.sport,
    slate_date: evidence.identity.slateDate,
    game_id: evidence.identity.gameId,
    audit_scope: "daily_edge_intelligence_review_evaluation",
    payload_hash: call.payloadHash,
    from_cache: false,
    skipped_reason: null,
    model: resolveAiAuditorPricing().nanoModel,
    input_tokens: call.inputTokens,
    output_tokens: call.outputTokens,
    estimated_cost_usd: call.estimatedCostUsd,
    actual_cost_usd: call.actualCostUsd,
    status: call.validationErrors.some(isFatalValidationError) ? "block" : (call.result?.severity === "high" || call.result?.severity === "block" ? "warn" : "pass"),
    severity: call.result?.severity ?? (call.validationErrors.length > 0 ? "medium" : "info"),
    recommended_actions: call.validationErrors.map((error) => `validation:${error}`),
    escalation: false,
    applied: false,
  });
}

async function logEvaluationRows(args: { runId: string; calls: PaidCall[]; variant: string }): Promise<number> {
  const { supabase } = await import("@/lib/db/supabase");
  const rows = args.calls.flatMap((call) => {
    const result = call.result;
    if (!result) return [];
    const e = call.evidence;
    const renderedCopy = renderDailyEdgeMemberCopy({
      evidence: e,
      evidenceReview: reviewPredictionEvidence(e),
      marketIntelligence: interpretMarketIntelligence(e),
      intent: {
        marketReadLabel: result.market_read_review.marketReadLabel,
        gradeReasonType: result.grade_alignment_review.gradeReasonType,
        suggestedPlayGrade: result.grade_alignment_review.suggestedPlayGrade,
        gradeChangeDirection: result.grade_alignment_review.gradeChangeDirection,
      },
    });
    return [{
      run_id: args.runId,
      variant: args.variant,
      audit_scope: "daily_edge_intelligence_review_evaluation",
      ledger_id: call.ledgerId,
      applied: false,
      sport: e.identity.sport,
      slate_date: e.identity.slateDate,
      game_id: e.identity.gameId,
      external_id: e.identity.externalId,
      matchup: `${e.identity.awayTeam} @ ${e.identity.homeTeam}`,
      market: e.identity.normalizedMarket,
      payload_hash: call.payloadHash,
      original_pick: e.identity.pick,
      original_grade: e.identity.originalPlayGrade,
      original_market_read: e.marketEvidence.deterministicMarketRead,
      original_model_probability: e.modelStatsEvidence.modelProbability,
      original_edge: e.modelStatsEvidence.edge,
      original_price: e.priceValueEvidence.priceAmerican,
      original_recommendation_confidence: e.identity.originalRecommendationConfidence,
      ai_recommended_grade: result.grade_alignment_review.suggestedPlayGrade ?? null,
      ai_recommended_market_read: result.market_read_review.marketReadLabel ?? null,
      ai_recommendation_direction: gradeDirection(e.identity.originalPlayGrade, result.grade_alignment_review.suggestedPlayGrade),
      downgrade_promotion_reason: result.grade_alignment_review.gradeReason ?? null,
      data_integrity_review: result.model_stats_review,
      market_read_review: result.market_read_review,
      play_grade_review: result.grade_alignment_review,
      betting_value_review: result.price_value_review,
      card_coherence_review: result.reader_coherence_review,
      safety_review: result.safety_review,
      market_reviews: [],
      issues: [],
      issue_materiality_scores: [],
      reason_codes: [],
      recommended_actions: [],
      safe_copy_fixes: [
        { field: "market_read", replacement: renderedCopy.marketReadCopy, reason: "deterministic_member_renderer" },
        { field: "supporting_evidence", replacement: renderedCopy.supportingEvidenceCopy, reason: "deterministic_member_renderer" },
        { field: "risk", replacement: renderedCopy.riskCopy, reason: "deterministic_member_renderer" },
      ].filter((row) => row.replacement),
      repair_actions: [],
      full_ai_output: {
        ...result,
        member_copy_renderer: renderedCopy,
      },
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
      status: call.validationErrors.some(isFatalValidationError) ? "block" : (result.severity === "block" ? "block" : result.severity === "high" ? "warn" : "pass"),
      severity: result.severity,
    }];
  });
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("ai_audit_evaluation_results").insert(rows);
  if (error) throw new Error(`ai_audit_evaluation_results insert failed: ${error.message}`);
  return rows.length;
}

function defaultRunId(args: Args): string {
  const seed = `${args.sport}:${args.date}:${args.markets}:${Date.now()}:${crypto.randomUUID()}`;
  return ["ai-daily-edge-intelligence", args.sport, args.date, crypto.createHash("sha1").update(seed).digest("hex").slice(0, 10)].join("_");
}

function summarizePaidCalls(calls: PaidCall[]) {
  const byMarket = (market: string) => calls.filter((call) => call.evidence.identity.normalizedMarket === market);
  const inc = (acc: Record<string, number>, key: unknown) => {
    const value = String(key ?? "null");
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  };
  const flags = calls.reduce<Record<string, number>>((acc, call) => {
    for (const [key, value] of Object.entries(call.result?.slate_balance_flags ?? {})) {
      if (value === true) inc(acc, key);
    }
    return acc;
  }, {});
  const validation = calls.reduce<Record<string, number>>((acc, call) => {
    for (const error of call.validationErrors) inc(acc, error.split(":")[0]);
    return acc;
  }, {});
  const sectionQuality = (rows: PaidCall[]) => ({
    modelStatsPass: rows.filter((call) => call.result?.model_stats_review && !call.validationErrors.includes("grade_dimension_missing")).length,
    marketReadCopyProvided: rows.filter((call) => Boolean(call.result?.market_read_review?.memberFacingMarketReadCopy)).length,
    priceValueProvided: rows.filter((call) => Boolean(call.result?.price_value_review?.bettingValueVerdict)).length,
    gradeAlignmentProvided: rows.filter((call) => Boolean(call.result?.grade_alignment_review?.gradeAlignmentVerdict)).length,
    readerCoherenceProvided: rows.filter((call) => Boolean(call.result?.reader_coherence_review)).length,
  });
  const gradeDist = calls.reduce<Record<string, number>>((acc, call) => inc(acc, call.result?.grade_alignment_review?.gradeAlignmentVerdict), {});
  const suggestedGradeDist = calls.reduce<Record<string, number>>((acc, call) => inc(acc, call.result?.grade_alignment_review?.suggestedPlayGrade), {});
  const marketReadDist = calls.reduce<Record<string, number>>((acc, call) => inc(acc, call.result?.market_read_review?.marketReadLabel), {});
  const originalActionableCount = calls.filter((call) => ["Best Angle", "Lean"].includes(call.evidence.identity.originalPlayGrade ?? "")).length;
  const suggestedActionableCount = calls.filter((call) => ["Best Angle", "Lean"].includes(call.result?.grade_alignment_review?.suggestedPlayGrade ?? "")).length;
  const directions = calls.map((call) => gradeDirection(call.evidence.identity.originalPlayGrade, call.result?.grade_alignment_review?.suggestedPlayGrade));
  const copyOnlyImprovements = calls.filter((call) => call.result?.grade_alignment_review?.copyOnlyImprovementRecommended === true).length;
  const riskOnlyImprovements = calls.filter((call) =>
    call.result?.grade_alignment_review?.riskNoteImprovementRecommended === true &&
    call.result?.grade_alignment_review?.gradeChangeRecommended !== true
  ).length;
  const marketReadOnlyImprovements = calls.filter((call) =>
    call.result?.grade_alignment_review?.marketReadImprovementRecommended === true &&
    call.result?.grade_alignment_review?.gradeChangeRecommended !== true
  ).length;
  return {
    byMarketQuality: {
      moneyline: sectionQuality(byMarket("moneyline")),
      total: sectionQuality(byMarket("total")),
      first_inning: sectionQuality(byMarket("first_inning")),
    },
    gradeChangeDiagnostics: {
      originalActionableCount,
      suggestedActionableCount,
      promotions: directions.filter((direction) => direction === "promotion").length,
      downgrades: directions.filter((direction) => direction === "downgrade").length,
      holds: directions.filter((direction) => direction === "hold").length,
      copyOnlyImprovements,
      riskOnlyImprovements,
      marketReadOnlyImprovements,
      overgradedCandidates: calls.filter((call) => call.result?.grade_alignment_review?.overgradedCandidate === true).length,
      undergradedCandidates: calls.filter((call) => call.result?.grade_alignment_review?.undergradedCandidate === true).length,
      unsupportedGradeChanges: calls.filter((call) => call.validationErrors.includes("unsupported_grade_change")).length,
      unsupportedDemotions: calls.filter((call) => call.validationErrors.includes("unsupported_demotion")).length,
      unsupportedPromotions: calls.filter((call) => call.validationErrors.includes("unsupported_promotion")).length,
    },
    gradeAlignmentVerdicts: gradeDist,
    suggestedGradeDistribution: suggestedGradeDist,
    aiMarketReadDistribution: marketReadDist,
    slateBalanceFlags: flags,
    validationErrorsByCode: validation,
    scoreCoverage: {
      winCaseStrengthScore: calls.filter((call) => typeof call.result?.grade_alignment_review?.winCaseStrengthScore === "number").length,
      bettingValueStrengthScore: calls.filter((call) => typeof call.result?.grade_alignment_review?.bettingValueStrengthScore === "number").length,
      marketContextScore: calls.filter((call) => typeof call.result?.grade_alignment_review?.marketContextScore === "number").length,
      readQualityScore: calls.filter((call) => typeof call.result?.grade_alignment_review?.readQualityScore === "number").length,
      riskPenaltyScore: calls.filter((call) => typeof call.result?.grade_alignment_review?.riskPenaltyScore === "number").length,
      bestAngleProfile: calls.filter((call) => Boolean(call.result?.grade_alignment_review?.bestAngleProfile)).length,
      bestAngleThesis: calls.filter((call) => Boolean(call.result?.grade_alignment_review?.bestAngleThesis)).length,
      gradeReasonType: calls.filter((call) => Boolean(call.result?.grade_alignment_review?.gradeReasonType)).length,
    },
    examples: calls.map((call) => ({
      game: `${call.evidence.identity.awayTeam} @ ${call.evidence.identity.homeTeam}`,
      market: call.evidence.identity.normalizedMarket,
      pick: call.evidence.identity.pick,
      originalGrade: call.evidence.identity.originalPlayGrade,
      suggestedGrade: call.result?.grade_alignment_review?.suggestedPlayGrade,
      gradeAlignment: call.result?.grade_alignment_review?.gradeAlignmentVerdict,
      gradeReasonType: call.result?.grade_alignment_review?.gradeReasonType,
      marketRead: call.result?.market_read_review?.marketReadLabel,
      renderedMemberCopy: call.result
        ? renderDailyEdgeMemberCopy({
          evidence: call.evidence,
          evidenceReview: reviewPredictionEvidence(call.evidence),
          marketIntelligence: interpretMarketIntelligence(call.evidence),
          intent: {
            marketReadLabel: call.result.market_read_review.marketReadLabel,
            gradeReasonType: call.result.grade_alignment_review.gradeReasonType,
            suggestedPlayGrade: call.result.grade_alignment_review.suggestedPlayGrade,
            gradeChangeDirection: call.result.grade_alignment_review.gradeChangeDirection,
          },
        })
        : null,
      rawAiMarketReadCopyForAdminOnly: call.result?.market_read_review?.memberFacingMarketReadCopy,
      rawAiSuggestedMarketReadCopyForAdminOnly: call.result?.reader_coherence_review?.suggestedMarketReadCopy,
      gradeReason: call.result?.grade_alignment_review?.gradeReason,
      bestAngleThesis: call.result?.grade_alignment_review?.bestAngleThesis,
      validationErrors: call.validationErrors,
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!MARKET_SPECIFIC_VARIANTS.has(args.variant)) {
    throw new Error(`Unsupported --variant=${args.variant}; expected one of ${[...MARKET_SPECIFIC_VARIANTS].join(", ")}`);
  }
  const requestedMarkets = parseAiAuditorMarkets(args.markets);
  if (args.mode === "paid-sample" && !paidVariantAllowedForMarkets(args.variant, requestedMarkets)) {
    throw new Error(`Paid variant ${args.variant} is only allowed when its matching single market is requested. Requested markets=${requestedMarkets.join(",")}.`);
  }

  const response = await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date: args.date });
  const evidenceSelection = await buildPredictionEvidenceForDailyEdgeEvaluation({
    sport: args.sport,
    date: args.date,
    markets: requestedMarkets,
    response,
  });
  const evidence = evidenceSelection.evidence;
  const pricing = resolveAiAuditorPricing();
  const marketSpecificDryRun = marketSpecificDryRunReport({
    variant: args.variant,
    evidence,
    pricing,
  });
  const estimatedInputTokens = evidence.reduce((sum, row) => sum + tokenEstimate(promptForCall(args.variant, row)) + tokenEstimate(payloadForCall(args.variant, row)), 0);
  const estimatedOutputTokens = evidence.length * 1000;
  const estimatedCostIfPaid = estimateCostUsd(
    estimatedInputTokens,
    estimatedOutputTokens,
    pricing.nanoInputUsdPerMillion,
    pricing.nanoOutputUsdPerMillion,
  );
  assertPaidGate(args, estimatedCostIfPaid);
  const runId = args.runId ?? defaultRunId(args);
  const paidCalls: PaidCall[] = [];
  if (args.mode === "paid-sample") {
    let repeatedFatalFailures = 0;
    for (const row of evidence) {
      const callPayload = payloadForCall(args.variant, row);
      const hash = payloadHash(callPayload);
      const estimatedInput = tokenEstimate(promptForCall(args.variant, row)) + tokenEstimate(callPayload);
      const estimatedOutput = 1000;
      const estimatedCostUsd = estimateCostUsd(estimatedInput, estimatedOutput, pricing.nanoInputUsdPerMillion, pricing.nanoOutputUsdPerMillion);
      const response = await callOpenAi(args.variant, row);
      const call: PaidCall = {
        evidence: row,
        payloadHash: hash,
        result: response.result,
        validationErrors: validateResult(row, response.result),
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        estimatedCostUsd,
        actualCostUsd: response.actualCostUsd,
        ledgerId: null,
      };
      if (call.validationErrors.some(isFatalValidationError)) repeatedFatalFailures += 1;
      call.ledgerId = await logLedger(row, call);
      paidCalls.push(call);
      if (repeatedFatalFailures >= 3) {
        throw new Error(`Stopping after repeated safety/schema failures: ${call.validationErrors.join(", ")}`);
      }
    }
  }
  const evaluationRowsWritten = args.mode === "paid-sample"
    ? await logEvaluationRows({ runId, calls: paidCalls, variant: args.variant })
    : 0;
  const actualCostUsd = +paidCalls.reduce((sum, call) => sum + Number(call.actualCostUsd ?? 0), 0).toFixed(6);
  const grouped = groupByMarket(evidence);
  const examples = {
    moneyline: grouped.moneyline?.[0] ?? null,
    total: grouped.total?.[0] ?? null,
    first_inning: grouped.first_inning?.[0] ?? null,
  };
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
      gameCards: new Set(evidence.map((row) => row.identity.gameId)).size,
      predictionEvidenceObjects: evidence.length,
      moneyline: grouped.moneyline?.length ?? 0,
      total: grouped.total?.length ?? 0,
      firstInning: grouped.first_inning?.length ?? 0,
    },
    evidenceSource: evidenceSelection.selectionSummary,
    lockedPreLockEvidenceCoverage: splitCoverage(evidenceSelection.lockedSnapshotEvidence),
    currentLiveSourceCoverageDiagnosticOnly: splitCoverage(evidenceSelection.currentLiveEvidence),
    completenessByMarket: completeness(evidence),
    currentReaderSplitDisplayReadiness: displayReadiness(evidence),
    marketSpecificArchitecture: marketSpecificDryRun,
    aiPromptPreview: {
      systemPrompt: args.variant === AI_DAILY_EDGE_INTELLIGENCE_REVIEW_VARIANT
        ? dailyEdgeIntelligenceSystemPrompt()
        : "Market-specific prompts are generated per prediction market; see oneExampleUserPayloadPerMarket.",
      schemaName: AI_DAILY_EDGE_INTELLIGENCE_REVIEW_SCHEMA.name,
      schemaRequiredTopLevel: AI_DAILY_EDGE_INTELLIGENCE_REVIEW_SCHEMA.schema.required,
      gradeAlignmentRequiredFields:
        AI_DAILY_EDGE_INTELLIGENCE_REVIEW_SCHEMA.schema.properties.grade_alignment_review.required,
      slateBalanceFlagFields:
        AI_DAILY_EDGE_INTELLIGENCE_REVIEW_SCHEMA.schema.properties.slate_balance_flags.required,
      oneExampleUserPayloadPerMarket: Object.fromEntries(
        Object.entries(examples).map(([market, row]) => [market, row ? payloadForCall(args.variant, row) : null]),
      ),
    },
    estimatedCostIfPaid: {
      model: process.env.AI_AUDITOR_PRIMARY_MODEL ?? process.env.AI_AUDITOR_NANO_MODEL ?? "configured nano",
      standardPricing: {
        inputUsdPerMillion: pricing.nanoInputUsdPerMillion,
        outputUsdPerMillion: pricing.nanoOutputUsdPerMillion,
      },
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsd: estimatedCostIfPaid,
      conservative2xUsd: +(estimatedCostIfPaid * 2).toFixed(6),
    },
    paidRun: args.mode === "paid-sample" ? {
      actualCostUsd,
      ledgerRowsWritten: paidCalls.filter((call) => call.ledgerId).length,
      evaluationRowsWritten,
      schemaFailures: paidCalls.filter((call) => call.validationErrors.length > 0).length,
      providerLeaks: paidCalls.filter((call) => call.validationErrors.includes("provider_name_leak") || call.validationErrors.includes("provider_or_source_leak")).length,
      postgameLeaks: paidCalls.filter((call) => call.validationErrors.includes("postgame_leakage_claimed")).length,
      inventedDataFlags: paidCalls.filter((call) => call.validationErrors.includes("invented_data_claimed")).length,
      pickMutationAttempts: paidCalls.filter((call) => call.validationErrors.includes("attempted_pick_flip")).length,
      probabilityMutationAttempts: paidCalls.filter((call) => call.validationErrors.includes("attempted_probability_change")).length,
      projectionMutationAttempts: paidCalls.filter((call) => call.validationErrors.includes("attempted_projected_score_change")).length,
      summary: summarizePaidCalls(paidCalls),
    } : null,
    validationRules: [
      "ML/Totals with price/model/edge/market implied and both source contexts cannot be labeled insufficient_data.",
      "FI missing consensus/sharp split source is expected/non-material and must not downgrade by itself.",
      "Provider names must not appear in member-facing copy.",
      "AI output may recommend grade alignment flags only; no live grade/pick/probability/projection changes.",
      "Postgame fields are not present in current-day evidence payloads.",
      "Public Play Grade labels stay simple; internal grade dimensions and gradeReasonType explain the label.",
      "Flag grade-dimension and grade-reason mismatches before trusting a paid review.",
      "ML/Totals and FI use separate Market Read label families; wrong-market labels are flagged.",
      "FI copy must be prediction-specific and cannot treat missing split bars/signals as a downside.",
      "Copy safety flags catch provider/source leaks, hype language, overclaimed sharp language, and generic copy.",
      "Market-specific variants use deterministic Data Reviewer, Market Intelligence Interpreter, Self-Healing Engine, and Sanitizer in dry-run mode.",
      "FI defaults to deterministic review and costs $0 unless explicitly enabled for paid review later.",
    ],
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`AI Daily Edge Intelligence Preview (${args.mode})`);
  console.log(`No OpenAI calls were made. Evidence objects: ${evidence.length}`);
  console.log(JSON.stringify(report.counts));
  console.log(JSON.stringify(report.completenessByMarket, null, 2));
  console.log(`Estimated paid cost: $${estimatedCostIfPaid.toFixed(6)} (2x $${(estimatedCostIfPaid * 2).toFixed(6)})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
