import {
  buildDailyEdgeResponseForCostPreview,
  parseAiAuditorMarkets,
} from "@/lib/services/aiAuditor/costPreview";
import { sanitizeDailyEdgeAiOutput } from "@/lib/services/aiAuditor/dailyEdgeAiOutputSanitizer";
import { selfHealDailyEdgePrediction } from "@/lib/services/dailyEdge/dailyEdgeSelfHealingEngine";
import { buildPredictionEvidenceForDailyEdgeEvaluation } from "@/lib/services/dailyEdge/lockedPredictionEvidenceSource";
import { interpretMarketIntelligence } from "@/lib/services/dailyEdge/marketIntelligenceInterpreter";
import { sharpContextStatusForEvidence } from "@/lib/services/dailyEdge/memberFacingCopyRenderer";
import { dailyEdgeMarketCapabilities } from "@/lib/services/dailyEdge/dailyEdgeSportCapabilities";
import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import { reviewPredictionEvidence } from "@/lib/services/dailyEdge/predictionEvidenceReviewer";
import type { Sport } from "@/lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string;
  markets: string;
  json: boolean;
};

type GradeCaveat = {
  severity: "info" | "medium" | "high" | "block";
  code: string;
  message: string;
  treatment: "copy_only" | "risk_note" | "human_review" | "no_member_copy_block";
};

function parseArgs(argv: string[]): Args {
  const out: Args = { sport: "mlb", date: "2026-06-30", markets: "ML,TOTAL,FI", json: false };
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
  }
  return out;
}

function countBy<T>(rows: T[], keyFn: (row: T) => unknown): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = String(keyFn(row) ?? "null");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function gameLabel(row: PredictionEvidenceObject): string {
  return `${row.identity.awayTeam} @ ${row.identity.homeTeam}`;
}

function currentReaderCopy(row: PredictionEvidenceObject) {
  return {
    marketReadLabel: row.currentReaderState.displayedMarketRead?.label ?? null,
    marketReadCopy: row.currentReaderState.displayedMarketRead?.copy ?? null,
    quickRead: row.currentReaderState.supportingEvidence.quickRead,
    riskCopy: row.currentReaderState.riskNote,
  };
}

const QUICK_READ_HYPE_RE = /\b(not a hammer|hammer|lock|free money|smash|love this|sharp money loves|guaranteed)\b/i;
const QUICK_READ_PRIMARY_REASON_RE = /\b(model|edge|price|value|market|resistance|mixed|projection|projected|line|consensus|sharp-book|split|probability|implied|starter|context|yrfi|nrfi|toss-up|spread|draw|goals?|match result|btts)\b/i;
const RAW_AI_RE = /\b(ai says|ai recommended|ai recommendation|raw ai|language model)\b/i;
const MEMBER_COPY_META_LANGUAGE_RE = /\b(the reader should|needs to|should mention|needs thesis|internal|grade caveat|flagged for review|human review|copy should|renderer)\b/i;
const FI_FULL_GAME_MARKET_LANGUAGE_RE = /\bmarket resistance or price|starter\/context quality and price decide|overcome market resistance\b/i;

function quickReadValidationCodes(args: {
  quickRead: string | null;
  grade: string | null;
  marketReadLabel: string | null;
}): string[] {
  const text = args.quickRead ?? "";
  const out: string[] = [];
  if (QUICK_READ_HYPE_RE.test(text)) out.push("legacy_quick_read_hype_language");
  if (RAW_AI_RE.test(text)) out.push("quick_read_raw_ai_copy_detected");
  if (text.trim().length > 0 && !QUICK_READ_PRIMARY_REASON_RE.test(text)) out.push("quick_read_missing_primary_reason");
  if (/^(No clean play on this slate\.|On the watchlist:|Lean toward|Best angle tonight:)/i.test(text.trim())) out.push("quick_read_generic_copy");
  if ((args.grade === "Caution" || args.grade === "No Play") &&
    /\b(playable|best angle|strong angle|top grade)\b/i.test(text) ||
    ((args.grade === "Caution" || args.grade === "No Play") && /\bactionable\b/i.test(text) && !/\b(not|no|does not|doesn't|is not|isn't|below|until|too thin to make|not enough to make|does not leave enough)\b.{0,60}\bactionable\b/i.test(text))
  ) {
    out.push("quick_read_contradicts_grade");
  }
  if (/market support|clean read/i.test(text) && /resistance|mixed|friction|not clean/i.test(args.marketReadLabel ?? "")) {
    out.push("quick_read_contradicts_market_read");
  }
  return out;
}

function gradeCaveats(row: PredictionEvidenceObject): GradeCaveat[] {
  const caveats: GradeCaveat[] = [];
  const dimensions = row.internalGradeDimensions;
  if (row.identity.originalPlayGrade === "Caution" && dimensions.riskPenaltyScore < 20 && dimensions.dataQualityScore >= 60) {
    caveats.push({
      severity: "medium",
      code: "caution_without_material_risk",
      message: "Caution lacks a clear material blocker; renderer should avoid scary risk copy and keep this as grade-review only.",
      treatment: "human_review",
    });
  }
  if (row.identity.originalPlayGrade === "Lean" && dimensions.bettingValueStrengthScore < 45 && dimensions.winCaseStrengthScore < 55) {
    caveats.push({
      severity: "medium",
      code: "lean_without_actionable_value",
      message: "Lean has weak value/win-case dimensions; renderer should use price/value-capped language and flag grade alignment internally.",
      treatment: "human_review",
    });
  }
  if (row.identity.originalPlayGrade === "Best Angle" && (row.marketEvidence.deterministicMarketRead === "mixed" || row.marketEvidence.deterministicMarketRead === "resistance" || row.marketEvidence.sourceConflict)) {
    caveats.push({
      severity: "medium",
      code: "best_angle_market_friction_needs_thesis_copy",
      message: "Best Angle has market friction; copy must explain model/value override rather than pretending the read is clean.",
      treatment: "risk_note",
    });
  }
  return caveats;
}

function renderedCopyText(copy: { quickReadCopy?: string; marketReadCopy: string; supportingEvidenceCopy: string; riskCopy: string }): string {
  return `${copy.quickReadCopy ?? ""}\n${copy.marketReadCopy}\n${copy.supportingEvidenceCopy}\n${copy.riskCopy}`;
}

function decisionKeyForEvidence(row: PredictionEvidenceObject) {
  if (row.identity.normalizedMarket === "total") return "total";
  if (row.identity.normalizedMarket === "moneyline") return "moneyline";
  return "firstInning";
}

function capabilitiesForEvidence(row: PredictionEvidenceObject) {
  return dailyEdgeMarketCapabilities(row.identity.sport, decisionKeyForEvidence(row));
}

function gradeToneViolations(grade: string | null, copy: { quickReadCopy?: string; marketReadCopy: string; supportingEvidenceCopy: string; riskCopy: string }): string[] {
  const text = renderedCopyText(copy);
  const out: string[] = [];
  if ((grade === "Caution" || grade === "No Play") && /\b(keeps? this playable|strong enough to keep this playable|positive value|actionable edge is present)\b/i.test(text)) {
    out.push("low_grade_copy_sounds_actionable");
  }
  if (grade === "Watchlist" && /\bplayable|actionable|bet\b/i.test(text) && !/\bworth monitoring|not automatically actionable|not strong enough for action/i.test(text)) {
    out.push("watchlist_copy_sounds_actionable");
  }
  if (grade === "Lean" && /\btop-tier|top play|hammer|lock of the day|best bet\b/i.test(text)) {
    out.push("lean_copy_overstates_conviction");
  }
  return out;
}

function renderedCopyValidationCodes(row: PredictionEvidenceObject, copy: { quickReadCopy?: string; marketReadCopy: string; supportingEvidenceCopy: string; riskCopy: string }): string[] {
  const text = renderedCopyText(copy);
  const readText = `${copy.quickReadCopy ?? ""}\n${copy.marketReadCopy}`;
  const out: string[] = [];
  const caps = capabilitiesForEvidence(row);
  if (MEMBER_COPY_META_LANGUAGE_RE.test(text)) out.push("member_copy_meta_language");
  if (caps.isFirstInning) {
    if (FI_FULL_GAME_MARKET_LANGUAGE_RE.test(text)) out.push("fi_full_game_market_language_used");
    if (/toss/i.test(row.identity.pick ?? "") && !/Toss-Up.+no actionable YRFI\/NRFI side/i.test(text)) out.push("fi_toss_up_copy_not_clear");
    if (!/\b(FI|YRFI|NRFI|Toss-Up|model probability|edge|price|juice|\+\d+|-\d+|first-inning)\b/i.test(text)) {
      out.push("fi_copy_lacks_prediction_specific_context");
    }
  }
  const alignedEvidence = row.marketEvidence.deterministicMarketRead === "aligned" &&
    (row.marketEvidence.sourceAgreement === "both_align" ||
      row.marketEvidence.sourceAgreement === "consensus_only" ||
      row.marketEvidence.sourceAgreement === "sharp_only");
  const conflictEvidence = row.marketEvidence.sourceConflict ||
    row.marketEvidence.sourceAgreement === "consensus_supports_sharp_opposes" ||
    row.marketEvidence.sourceAgreement === "sharp_supports_consensus_opposes";
  if ((caps.expectsConsensusSplits || caps.expectsSharpBookContext) && alignedEvidence && /\b(mixed|resistance)\b/i.test(readText)) out.push("market_read_alignment_mismatch");
  if ((caps.expectsConsensusSplits || caps.expectsSharpBookContext) && conflictEvidence && /\b(clean|aligned)\b/i.test(readText)) out.push("market_read_alignment_mismatch");
  return out;
}

function splitDisplay(row: PredictionEvidenceObject) {
  const caps = capabilitiesForEvidence(row);
  return {
    consensusSplits: row.marketEvidence.consensusSplitsAvailable
      ? "display"
      : caps.expectsConsensusSplits ? "unavailable" : "not_required",
    sharpContextStatus: sharpContextStatusForEvidence(row),
    sharpBookSplits: row.marketEvidence.sharpBookSplitsAvailable ? "display" : "not_displayed",
    sharpBookSignal: row.marketEvidence.sharpBookSignalAvailable ? "display" : "not_displayed",
    sourceAgreement: row.marketEvidence.sourceAgreement,
    sourceConflict: row.marketEvidence.sourceConflict,
    fiMissingSplitsExpected: caps.isFirstInning,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const markets = parseAiAuditorMarkets(args.markets);
  const response = await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date: args.date });
  const selection = await buildPredictionEvidenceForDailyEdgeEvaluation({
    sport: args.sport,
    date: args.date,
    markets,
    response,
  });

  const rows = selection.evidence.map((evidence) => {
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
      healed,
      sanitizer,
      caveats: gradeCaveats(evidence),
      gradeToneViolations: gradeToneViolations(evidence.identity.originalPlayGrade, healed.repairedReaderFields),
      renderedCopyValidationCodes: renderedCopyValidationCodes(evidence, healed.repairedReaderFields),
      currentQuickReadValidationCodes: quickReadValidationCodes({
        quickRead: evidence.currentReaderState.supportingEvidence.quickRead,
        grade: evidence.identity.originalPlayGrade,
        marketReadLabel: evidence.marketEvidence.deterministicMarketRead,
      }),
      renderedQuickReadValidationCodes: quickReadValidationCodes({
        quickRead: healed.repairedReaderFields.quickReadCopy,
        grade: evidence.identity.originalPlayGrade,
        marketReadLabel: healed.repairedReaderFields.marketReadLabel,
      }),
    };
  });

  const copyBlockers = rows.flatMap((row) => row.sanitizer.blockedReasons);
  const caveats = rows.flatMap((row) =>
    row.caveats.map((caveat) => ({
      ...caveat,
      game: gameLabel(row.evidence),
      market: row.evidence.identity.normalizedMarket,
      pick: row.evidence.identity.pick,
      grade: row.evidence.identity.originalPlayGrade,
    })),
  );

  const report = {
    mode: "daily_edge_copy_only_preview",
    noOpenAiCalls: true,
    noLiveChanges: true,
    noMemberFacingChanges: true,
    noGradeChanges: true,
    noPickChanges: true,
    noProbabilityChanges: true,
    noProjectionChanges: true,
    rawAiCopyShownDirectlyCount: 0,
    sport: args.sport,
    date: args.date,
    markets,
    evidenceSource: selection.selectionSummary,
    counts: {
      games: new Set(rows.map((row) => row.evidence.identity.gameId)).size,
      predictions: rows.length,
      moneyline: rows.filter((row) => row.evidence.identity.normalizedMarket === "moneyline").length,
      total: rows.filter((row) => row.evidence.identity.normalizedMarket === "total").length,
      firstInning: rows.filter((row) => row.evidence.identity.normalizedMarket === "first_inning").length,
    },
    readiness: {
      deterministicRendererReady: rows.filter((row) =>
        Boolean(row.healed.repairedReaderFields.quickReadCopy) &&
        Boolean(row.healed.repairedReaderFields.marketReadCopy) &&
        Boolean(row.healed.repairedReaderFields.supportingEvidenceCopy) &&
        Boolean(row.healed.repairedReaderFields.riskCopy)
      ).length,
      quickReadRendererReady: rows.filter((row) => Boolean(row.healed.repairedReaderFields.quickReadCopy)).length,
      currentQuickReadFindings: rows.filter((row) => row.currentQuickReadValidationCodes.length > 0).length,
      renderedQuickReadFindings: rows.filter((row) => row.renderedQuickReadValidationCodes.length > 0).length,
      legacyQuickReadHypeLanguage: rows.filter((row) => row.currentQuickReadValidationCodes.includes("legacy_quick_read_hype_language")).length,
      renderedQuickReadHypeLanguage: rows.filter((row) => row.renderedQuickReadValidationCodes.includes("legacy_quick_read_hype_language")).length,
      labelValidationFailures: rows.filter((row) => row.sanitizer.blockedReasons.includes("market_read_label_wrong_market_type")).length,
      providerLeaks: rows.filter((row) => row.sanitizer.blockedReasons.includes("provider_or_source_leak")).length,
      hypeLanguage: rows.filter((row) => row.sanitizer.blockedReasons.includes("betting_hype_language")).length,
      sharpOverclaims: rows.filter((row) => row.sanitizer.blockedReasons.includes("copy_overclaims_sharp_signal")).length,
      sharpWordingWithoutSharpContext: rows.filter((row) => row.sanitizer.blockedReasons.includes("sharp_wording_without_sharp_context")).length,
      fiMissingSplitNegativeCopy: rows.filter((row) => row.sanitizer.blockedReasons.includes("fi_missing_split_used_as_negative")).length,
      rawAiCopyMemberReady: rows.filter((row) => row.sanitizer.safeForMemberCopy).length,
      gradeToneViolations: rows.filter((row) => row.gradeToneViolations.length > 0).length,
      memberCopyMetaLanguage: rows.filter((row) => row.renderedCopyValidationCodes.includes("member_copy_meta_language")).length,
      marketReadAlignmentMismatch: rows.filter((row) => row.renderedCopyValidationCodes.includes("market_read_alignment_mismatch")).length,
      fiFullGameMarketLanguageUsed: rows.filter((row) => row.renderedCopyValidationCodes.includes("fi_full_game_market_language_used")).length,
      fiCopyLacksPredictionSpecificContext: rows.filter((row) => row.renderedCopyValidationCodes.includes("fi_copy_lacks_prediction_specific_context")).length,
      fiTossUpCopyNotClear: rows.filter((row) => row.renderedCopyValidationCodes.includes("fi_toss_up_copy_not_clear")).length,
      cautionNoPlayCopySoundsActionable: rows.filter((row) =>
        (row.evidence.identity.originalPlayGrade === "Caution" || row.evidence.identity.originalPlayGrade === "No Play") &&
        row.gradeToneViolations.includes("low_grade_copy_sounds_actionable")
      ).length,
      watchlistCopySoundsActionable: rows.filter((row) => row.gradeToneViolations.includes("watchlist_copy_sounds_actionable")).length,
    },
    sharpContextCoverage: {
      moneyline: countBy(
        rows.filter((row) => row.evidence.identity.normalizedMarket === "moneyline"),
        (row) => sharpContextStatusForEvidence(row.evidence),
      ),
      total: countBy(
        rows.filter((row) => row.evidence.identity.normalizedMarket === "total"),
        (row) => sharpContextStatusForEvidence(row.evidence),
      ),
      firstInning: countBy(
        rows.filter((row) => row.evidence.identity.normalizedMarket === "first_inning"),
        (row) => sharpContextStatusForEvidence(row.evidence),
      ),
    },
    copyBlockersByCode: countBy(copyBlockers, (code) => code),
    currentQuickReadFindingsByCode: countBy(rows.flatMap((row) => row.currentQuickReadValidationCodes), (code) => code),
    renderedQuickReadFindingsByCode: countBy(rows.flatMap((row) => row.renderedQuickReadValidationCodes), (code) => code),
    renderedCopyFindingsByCode: countBy(rows.flatMap((row) => row.renderedCopyValidationCodes), (code) => code),
    gradeCaveatsByCode: countBy(caveats, (caveat) => caveat.code),
    gradeCaveats: caveats,
    predictions: rows.map((row) => ({
      game: gameLabel(row.evidence),
      market: row.evidence.identity.normalizedMarket,
      pick: row.evidence.identity.pick,
      currentGrade: row.evidence.identity.originalPlayGrade,
      priceAmerican: row.evidence.priceValueEvidence.priceAmerican,
      modelProbability: row.evidence.modelStatsEvidence.modelProbability,
      edge: row.evidence.modelStatsEvidence.edge,
      marketImpliedProbability: row.evidence.modelStatsEvidence.marketImpliedProbability,
      currentReaderCopy: currentReaderCopy(row.evidence),
      rendererCopy: row.healed.repairedReaderFields,
      renderedCopyValidationCodes: row.renderedCopyValidationCodes,
      splitDisplay: splitDisplay(row.evidence),
      marketRead: {
        current: row.evidence.marketEvidence.deterministicMarketRead,
        renderedLabel: row.healed.repairedReaderFields.marketReadLabel,
        marketFrictionLevel: row.marketIntelligence.marketFrictionLevel,
        modelMarketRelationship: row.marketIntelligence.modelMarketRelationship,
      },
      safety: {
        rawAiCopyShown: false,
        sanitizerBlockedReasons: row.sanitizer.blockedReasons,
        currentQuickReadValidationCodes: row.currentQuickReadValidationCodes,
        renderedQuickReadValidationCodes: row.renderedQuickReadValidationCodes,
        rendererCopySource: "deterministic_member_renderer",
        gradeToneViolations: row.gradeToneViolations,
      },
      gradeCaveats: row.caveats,
      previewDisposition: row.caveats.length > 0 ? "copy_preview_with_internal_grade_review_flag" : "copy_preview_clean",
    })),
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Daily Edge Copy-Only Preview — ${args.sport} ${args.date}`);
  console.log(`No OpenAI calls. Predictions: ${rows.length}. Renderer-ready: ${report.readiness.deterministicRendererReady}/${rows.length}.`);
  console.log(`Copy blockers: ${JSON.stringify(report.copyBlockersByCode)}`);
  console.log(`Grade caveats: ${JSON.stringify(report.gradeCaveatsByCode)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
