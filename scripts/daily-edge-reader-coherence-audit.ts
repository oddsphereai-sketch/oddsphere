import {
  buildDailyEdgeResponseForCostPreview,
  parseAiAuditorMarkets,
} from "@/lib/services/aiAuditor/costPreview";
import { type PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import { buildPredictionEvidenceForDailyEdgeEvaluation } from "@/lib/services/dailyEdge/lockedPredictionEvidenceSource";
import { interpretMarketIntelligence } from "@/lib/services/dailyEdge/marketIntelligenceInterpreter";
import {
  hasSharpWordingWithoutContext,
  sharpContextStatusForEvidence,
} from "@/lib/services/dailyEdge/memberFacingCopyRenderer";
import { dailyEdgeMarketCapabilities } from "@/lib/services/dailyEdge/dailyEdgeSportCapabilities";
import { reviewPredictionEvidence } from "@/lib/services/dailyEdge/predictionEvidenceReviewer";
import { selfHealDailyEdgePrediction } from "@/lib/services/dailyEdge/dailyEdgeSelfHealingEngine";
import type { Sport } from "@/lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string;
  markets: string;
  json: boolean;
};

type Finding = {
  severity: "info" | "low" | "medium" | "high" | "block";
  code: string;
  game: string;
  market: string;
  pick: string | null;
  grade: string | null;
  message: string;
  details?: Record<string, unknown>;
};

const PROVIDER_TERMS = [
  /playbook/i,
  /sharpapi/i,
  /circa/i,
  /draftkings/i,
  /fanduel/i,
  /betmgm/i,
  /pinnacle/i,
];
const HYPE_TERMS = /\b(sharp money loves|overwhelmingly on|guaranteed|free money|lock of the day|lock play|stone cold lock|can't lose)\b/i;
const QUICK_READ_HYPE_TERMS = /\b(not a hammer|hammer|lock|free money|smash|love this|sharp money loves|guaranteed)\b/i;
const SHARP_OVERCLAIM = /\bsharp money\b/i;
const FI_MISSING_SPLIT_COPY_RE = /\b(split bars?|splits?|sharp signal|sharp-book signal)\b.{0,50}\b(unavailable|missing|not available|absent)\b|\b(unavailable|missing|not available|absent)\b.{0,50}\b(split bars?|splits?|sharp signal|sharp-book signal)\b/i;
const FI_MISSING_SPLIT_NEGATIVE_RE = /\b(missing|unavailable|not available|absent)\b.{0,80}\b(split bars?|splits?|sharp signal|sharp-book signal)\b.{0,80}\b(confidence|lower|hurts?|downgrade|block|uncertain|risk|negative|problem)\b/i;
const PREDICTION_SPECIFIC_RE = /\b(model|edge|price|juice|line|movement|starter|context|projection|projected|consensus|sharp-book|market resistance|mixed|value|grade|risk|support|split|probability|implied|confidence|yrfi|nrfi|toss-up|first-inning|spread|draw|goals?|match result|btts)\b/i;
const RAW_AI_RE = /\b(ai says|ai recommended|ai recommendation|raw ai|language model)\b/i;
const MEMBER_COPY_META_LANGUAGE_RE = /\b(the reader should|needs to|should mention|needs thesis|internal|grade caveat|flagged for review|human review|copy should|renderer)\b/i;
const FI_FULL_GAME_MARKET_LANGUAGE_RE = /\bmarket resistance or price|starter\/context quality and price decide|overcome market resistance\b/i;
const PREVIEW_COPY_FLAGS = {
  quickRead: process.env.DAILY_EDGE_RENDERED_QUICK_READ_ENABLED === "true",
  marketRead: process.env.DAILY_EDGE_RENDERED_MARKET_READ_ENABLED === "true",
  supportingEvidence: process.env.DAILY_EDGE_RENDERED_SUPPORTING_EVIDENCE_ENABLED === "true",
  risk: process.env.DAILY_EDGE_RENDERED_RISK_COPY_ENABLED === "true",
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sport: "mlb",
    date: "2026-06-29",
    markets: "ML,TOTAL,FI",
    json: false,
  };
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

function gameLabel(row: PredictionEvidenceObject): string {
  return `${row.identity.awayTeam} @ ${row.identity.homeTeam}`;
}

function diagnosticDetails(row: PredictionEvidenceObject): Record<string, unknown> {
  return {
    price: row.priceValueEvidence.priceAmerican,
    priceSource: row.priceValueEvidence.priceSource,
    priceNullReason: row.priceValueEvidence.priceNullReason,
    modelProbability: row.modelStatsEvidence.modelProbability,
    edge: row.modelStatsEvidence.edge,
    marketImplied: row.modelStatsEvidence.marketImpliedProbability,
    marketRead: row.marketEvidence.deterministicMarketRead,
    sourceAgreement: row.marketEvidence.sourceAgreement,
    consensusAvailable: row.marketEvidence.consensusSplitsAvailable,
    sharpFullSplitsAvailable: row.marketEvidence.sharpBookSplitsAvailable,
    sharpSignalAvailable: row.marketEvidence.sharpBookSignalAvailable,
    sourceMissingReason: row.marketEvidence.sourceMissingReason,
    evidenceSource: row.evidenceSource.kind,
  };
}

function decisionKeyForEvidence(row: PredictionEvidenceObject) {
  if (row.identity.normalizedMarket === "total") return "total";
  if (row.identity.normalizedMarket === "moneyline") return "moneyline";
  return "firstInning";
}

function capabilitiesForEvidence(row: PredictionEvidenceObject) {
  return dailyEdgeMarketCapabilities(row.identity.sport, decisionKeyForEvidence(row));
}

function push(findings: Finding[], row: PredictionEvidenceObject, code: string, severity: Finding["severity"], message: string, details?: Record<string, unknown>) {
  findings.push({
    severity,
    code,
    game: gameLabel(row),
    market: row.identity.normalizedMarket,
    pick: row.identity.pick,
    grade: row.identity.originalPlayGrade,
    message,
    details,
  });
}

function isPublicGrade(grade: string | null): boolean {
  return grade === "Best Angle" || grade === "Lean";
}

function gradeRank(grade: string | null): number {
  return ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"].indexOf(grade ?? "");
}

function hasCoreEvidence(row: PredictionEvidenceObject): boolean {
  return row.priceValueEvidence.priceAmerican !== null &&
    row.modelStatsEvidence.modelProbability !== null &&
    row.modelStatsEvidence.marketImpliedProbability !== null &&
    row.modelStatsEvidence.edge !== null;
}

function renderedReaderFields(row: PredictionEvidenceObject) {
  const evidenceReview = reviewPredictionEvidence(row);
  const marketIntelligence = interpretMarketIntelligence(row);
  return selfHealDailyEdgePrediction({ evidence: row, evidenceReview, marketIntelligence, sanitizerResult: null }).repairedReaderFields;
}

function memberVisibleReaderState(row: PredictionEvidenceObject) {
  const rendered = renderedReaderFields(row);
  return {
    marketRead: PREVIEW_COPY_FLAGS.marketRead ? rendered.marketReadCopy : row.currentReaderState.displayedMarketRead,
    quickRead: PREVIEW_COPY_FLAGS.quickRead ? rendered.quickReadCopy : row.currentReaderState.supportingEvidence.quickRead,
    supportingEvidence: PREVIEW_COPY_FLAGS.supportingEvidence
      ? rendered.supportingEvidenceCopy
      : row.currentReaderState.supportingEvidence,
    risk: PREVIEW_COPY_FLAGS.risk ? rendered.riskCopy : row.currentReaderState.riskNote,
    reasons: row.marketEvidence.reasonCodes,
  };
}

function containsProviderName(row: PredictionEvidenceObject): boolean {
  const text = JSON.stringify(memberVisibleReaderState(row));
  return PROVIDER_TERMS.some((term) => term.test(text));
}

function readerText(row: PredictionEvidenceObject): string {
  return JSON.stringify(memberVisibleReaderState(row));
}

function fullMemberVisibleText(row: PredictionEvidenceObject): string {
  const visible = memberVisibleReaderState(row);
  return JSON.stringify({
    cardHeadline: visible.quickRead,
    ...visible,
  });
}

function quickReadText(row: PredictionEvidenceObject): string {
  return String(memberVisibleReaderState(row).quickRead ?? "");
}

function selfHealedReaderText(row: PredictionEvidenceObject): string {
  return JSON.stringify(renderedReaderFields(row));
}

function hasBestAngleOverrideEvidence(row: PredictionEvidenceObject): boolean {
  if (row.priceValueEvidence.priceBecameUnplayable) return false;
  const edge = row.modelStatsEvidence.edge ?? 0;
  const modelEdgeScore = row.modelStatsEvidence.deterministicScores.modelEdgeScore;
  const priceQualityScore = row.priceValueEvidence.priceQualityScore;
  const dataQualityScore = row.modelStatsEvidence.deterministicScores.dataQualityScore;
  return (
    (edge >= 8 || modelEdgeScore >= 70) &&
    priceQualityScore >= 40 &&
    dataQualityScore >= 50
  );
}

function bestAngleCopyExplainsFriction(row: PredictionEvidenceObject): boolean {
  const text = readerText(row);
  return /override|edge|value|model|price|despite|mixed|resistance|friction/.test(text);
}

function hasMaterialMarketFriction(row: PredictionEvidenceObject): boolean {
  const market = interpretMarketIntelligence(row);
  if (row.marketEvidence.sourceConflict) return true;
  if (
    row.marketEvidence.sourceAgreement === "consensus_supports_sharp_opposes" ||
    row.marketEvidence.sourceAgreement === "sharp_supports_consensus_opposes" ||
    row.marketEvidence.sourceAgreement === "both_oppose"
  ) {
    return true;
  }
  if (market.priceMovementDirection === "against_pick" && market.marketFrictionLevel !== "low") return true;
  return market.marketFrictionLevel === "high";
}

function auditRow(row: PredictionEvidenceObject): Finding[] {
  const findings: Finding[] = [];
  const read = row.marketEvidence.deterministicMarketRead;
  const source = row.marketEvidence.sourceAgreement;
  const caps = capabilitiesForEvidence(row);
  const isFi = caps.isFirstInning;
  const dimensions = row.internalGradeDimensions;
  const hasBothSources = row.marketEvidence.consensusSplitsAvailable &&
    (row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable);

  if (containsProviderName(row)) {
    push(findings, row, "provider_or_source_leak", "block", "Provider/source name appears in current reader-facing copy.");
  }
  const copyText = readerText(row);
  const fullCopyText = fullMemberVisibleText(row);
  const quickRead = quickReadText(row);
  if (HYPE_TERMS.test(copyText)) {
    push(findings, row, "betting_hype_language", "block", "Reader copy uses betting hype language.");
  }
  if (QUICK_READ_HYPE_TERMS.test(quickRead)) {
    push(findings, row, "legacy_quick_read_hype_language", "block", "Quick Read uses legacy betting slang or hype language.");
  }
  if (RAW_AI_RE.test(fullCopyText)) {
    push(findings, row, "quick_read_raw_ai_copy_detected", "block", "Member-visible copy appears to expose raw AI phrasing.");
  }
  if (MEMBER_COPY_META_LANGUAGE_RE.test(fullCopyText)) {
    push(findings, row, "member_copy_meta_language", "block", "Member-visible copy contains internal/meta review language.");
  }
  if (quickRead.trim().length > 0 && !PREDICTION_SPECIFIC_RE.test(quickRead)) {
    push(findings, row, "quick_read_missing_primary_reason", "medium", "Quick Read does not include a prediction-specific reason.");
  }
  if (/^(No clean play on this slate\.|On the watchlist:|Lean toward|Best angle tonight:)/i.test(quickRead.trim())) {
    push(findings, row, "quick_read_generic_copy", "medium", "Quick Read uses legacy generic template language.");
  }
  if ((row.identity.originalPlayGrade === "Caution" || row.identity.originalPlayGrade === "No Play") &&
    (/\b(playable|best angle|strong angle|top grade)\b/i.test(quickRead) ||
      (/\bactionable\b/i.test(quickRead) && !/\b(not|no|does not|doesn't|is not|isn't|below|until|too thin to make|not enough to make|does not leave enough)\b.{0,60}\bactionable\b/i.test(quickRead)))
  ) {
    push(findings, row, "quick_read_contradicts_grade", "high", "Quick Read sounds more actionable than the public Play Grade.");
  }
  if (/market support|clean read/i.test(quickRead) && (read === "mixed" || read === "resistance" || read === "consensus_resistance")) {
    push(findings, row, "quick_read_contradicts_market_read", "high", "Quick Read claims market support while canonical Market Read shows mixed/resistance.");
  }
  if (SHARP_OVERCLAIM.test(copyText)) {
    push(findings, row, "copy_overclaims_sharp_signal", "medium", "Reader copy uses imprecise sharp-money language; prefer Sharp-book split profile/signal.");
  }
  if (hasSharpWordingWithoutContext(row, copyText)) {
    push(findings, row, "sharp_wording_without_sharp_context", "block", "Reader copy mentions Sharp Book context without selected evidence sharp context.");
  }
  const visibleState = memberVisibleReaderState(row);
  const readCopyText = `${visibleState.quickRead ?? ""}\n${typeof visibleState.marketRead === "string" ? visibleState.marketRead : JSON.stringify(visibleState.marketRead)}`;
  const alignedEvidence = read === "aligned" && (source === "both_align" || source === "consensus_only" || source === "sharp_only");
  const conflictEvidence = row.marketEvidence.sourceConflict || source === "consensus_supports_sharp_opposes" || source === "sharp_supports_consensus_opposes";
  if (alignedEvidence && /\b(mixed|resistance)\b/i.test(readCopyText)) {
    push(findings, row, "market_read_alignment_mismatch", "block", "Rendered Market Read says mixed/resistance while evidence is aligned.");
  }
  if (conflictEvidence && /\b(clean|aligned)\b/i.test(readCopyText)) {
    push(findings, row, "market_read_alignment_mismatch", "block", "Rendered Market Read says clean/aligned while source evidence conflicts.");
  }

  if (!isFi && (caps.expectsConsensusSplits || caps.expectsSharpBookContext) && hasBothSources && read === "insufficient_data") {
    push(findings, row, "market_read_insufficient_despite_sources", "high", "ML/Total has price and source context but Market Read is insufficient_data.");
  }

  if (!isFi && (caps.expectsConsensusSplits || caps.expectsSharpBookContext) && hasBothSources && (source === "consensus_supports_sharp_opposes" || source === "sharp_supports_consensus_opposes") && read !== "mixed" && read !== "resistance" && read !== "consensus_resistance") {
    push(findings, row, "market_read_hides_source_conflict", "high", "Consensus and Sharp source context disagree, but Market Read does not reflect mixed/resistance.");
  }

  if (!isFi && caps.expectsConsensusSplits && row.evidenceSource.kind === "current_live" && !row.marketEvidence.consensusSplitsAvailable) {
    push(findings, row, "consensus_context_unavailable_current_source", "info", "Current source has no Consensus Splits context for this ML/Total row; this is not a reader display failure unless source recovery finds it.", diagnosticDetails(row));
  }

  if (!isFi && caps.expectsSharpBookContext && row.evidenceSource.kind === "current_live" && !row.marketEvidence.sharpBookSplitsAvailable && !row.marketEvidence.sharpBookSignalAvailable) {
    const severity: Finding["severity"] = isPublicGrade(row.identity.originalPlayGrade) ? "high" : "medium";
    push(findings, row, "sharp_context_unavailable_current_source", severity, "Current/pre-lock ML/Total row has no Sharp Book Splits/Signal after selected evidence recovery; treat as degraded market context, not clean.", {
      ...diagnosticDetails(row),
      sharpContextStatus: sharpContextStatusForEvidence(row),
    });
  } else if (!isFi && caps.expectsSharpBookContext && row.evidenceSource.kind === "current_live" && !row.currentReaderState.supportingEvidence.sharpBookSplitsDisplayed && !row.currentReaderState.supportingEvidence.sharpBookSignalDisplayed && (row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable)) {
    push(findings, row, "sharp_context_available_not_displayed", "medium", "Sharp Book context exists in evidence but is not display-ready in the reader state.", diagnosticDetails(row));
  } else if (!isFi && caps.expectsSharpBookContext && row.evidenceSource.kind === "current_live" && row.marketEvidence.sharpBookSignalAvailable && !row.marketEvidence.sharpBookSplitsAvailable) {
    push(findings, row, "sharp_full_splits_missing_but_signal_available", "info", "Sharp full split bars are unavailable, but a Sharp Book Signal exists; use signal labeling, not full split bars.", diagnosticDetails(row));
  }

  if (isFi && read === "insufficient_data" && hasCoreEvidence(row)) {
    push(findings, row, "fi_insufficient_data_with_core_evidence", "high", "FI has core price/model/edge evidence, so missing split bars should not create insufficient_data.");
  }

  if (isFi && row.marketEvidence.sourceMissingMateriality !== "low") {
    push(findings, row, "fi_missing_splits_materiality_not_low", "high", "FI missing Consensus/Sharp split source must be low materiality by itself.");
  }

  if (isFi && FI_MISSING_SPLIT_COPY_RE.test(copyText)) {
    push(findings, row, "fi_copy_mentions_missing_splits", "medium", "FI member-facing copy should not center unavailable split/sharp signal coverage.");
  }

  if (isFi && FI_MISSING_SPLIT_NEGATIVE_RE.test(copyText)) {
    push(findings, row, "fi_missing_split_used_as_negative", "high", "FI copy treats missing split/signal coverage as a downside.");
  }
  if (isFi && FI_FULL_GAME_MARKET_LANGUAGE_RE.test(fullCopyText)) {
    push(findings, row, "fi_full_game_market_language_used", "block", "FI copy uses full-game market language instead of FI-specific model/price/context language.");
  }
  if (isFi && /toss/i.test(row.identity.pick ?? "") && !/Toss-Up.+no actionable YRFI\/NRFI side/i.test(fullCopyText)) {
    push(findings, row, "fi_toss_up_copy_not_clear", "block", "FI Toss-Up copy must clearly say there is no actionable YRFI/NRFI side.");
  }

  if (isFi && /\bno clear (fi |first-inning |market )?signal\b/i.test(copyText) && !PREDICTION_SPECIFIC_RE.test(copyText.replace(/no clear (fi |first-inning |market )?signal/ig, ""))) {
    push(findings, row, "fi_generic_no_signal_copy", "medium", "FI copy repeats generic no-clear-signal language without prediction-specific model/price/context.");
  }

  if (isFi && !/\b(model|edge|price|juice|starter|context|movement|early|offense|probability|implied)\b/i.test(copyText)) {
    const healedText = selfHealedReaderText(row);
    if (/\b(model|edge|price|juice|starter|context|movement|early|offense|probability|implied|toss-up|yrfi|nrfi)\b/i.test(healedText)) {
      push(findings, row, "fi_copy_repaired_by_self_healing", "info", "Current FI copy lacks prediction-specific context, but deterministic self-healing provides model/price/context-specific copy.", {
        ...diagnosticDetails(row),
        repairedCopy: healedText,
      });
    } else {
      push(findings, row, "fi_copy_lacks_prediction_specific_context", "medium", "FI copy should mention model edge, price/juice, starter/context, FI movement, or early-offense context.", diagnosticDetails(row));
    }
  }

  if (copyText.trim().length > 0 && !PREDICTION_SPECIFIC_RE.test(copyText)) {
    push(findings, row, "generic_copy_detected", "medium", "Reader copy appears generic and should include the prediction-specific reason.");
  }

  if (row.identity.originalPlayGrade === "Best Angle" && hasMaterialMarketFriction(row)) {
    if (!hasBestAngleOverrideEvidence(row)) {
      push(findings, row, "best_angle_market_friction_without_override", "high", "Best Angle has mixed/resistant market context without enough model/value override evidence.");
    } else if (!bestAngleCopyExplainsFriction(row)) {
      push(findings, row, "best_angle_market_friction_needs_thesis_copy", "medium", "Best Angle has market friction and plausible override evidence, but reader copy should explain the thesis.");
    }
  }

  if (isPublicGrade(row.identity.originalPlayGrade) && row.priceValueEvidence.heavyJuiceWarning && (row.modelStatsEvidence.edge ?? 0) < 5) {
    push(findings, row, "public_play_heavy_juice_thin_edge", "medium", "Lean/Best Angle has heavy favorite price with thin model edge.");
  }

  if (gradeRank(row.identity.originalPlayGrade) >= gradeRank("Lean") && row.priceValueEvidence.priceBecameUnplayable) {
    push(findings, row, "public_play_bad_or_missing_price", "high", "Lean/Best Angle lacks a playable price.");
  }

  if (row.currentReaderState.riskNote && row.identity.originalPlayGrade === "Best Angle" && /conflict|resistance|unreliable|not reliable|stale/i.test(row.currentReaderState.riskNote)) {
    push(findings, row, "risk_note_contradicts_best_angle", "high", "Risk note is materially cautious while grade is Best Angle.");
  }

  if (row.identity.originalPlayGrade === "Lean" && dimensions.bettingValueStrengthScore < 45 && dimensions.winCaseStrengthScore < 55) {
    push(findings, row, "lean_without_actionable_value", "medium", "Lean should be reasonably actionable, but win case/value dimensions are weak.", {
      ...diagnosticDetails(row),
      primaryConcern: "weak win-case/value dimensions for current Lean",
      reviewBucket: "human-review issue",
    });
  }

  if (row.identity.originalPlayGrade === "Watchlist" && dimensions.bettingValueStrengthScore >= 65 && dimensions.winCaseStrengthScore >= 60 && dimensions.riskPenaltyScore < 30) {
    push(findings, row, "watchlist_with_strong_actionable_value", "medium", "Watchlist has strong actionable value dimensions and may deserve Lean review.");
  }

  if (row.identity.originalPlayGrade === "Best Angle" && !bestAngleCopyExplainsFriction(row)) {
    push(findings, row, "best_angle_without_clear_thesis", "medium", "Best Angle needs a clear reader thesis explaining why it is top-tier.");
  }

  if (row.identity.originalPlayGrade === "Caution" && dimensions.riskPenaltyScore < 20 && dimensions.dataQualityScore >= 60) {
    push(findings, row, "caution_without_material_risk", "medium", "Caution needs a material risk, data, price, market, or projection blocker.", {
      ...diagnosticDetails(row),
      primaryConcern: "Caution grade lacks material risk in dimensions/copy",
      reviewBucket: "risk-note issue",
    });
  }

  if (row.identity.originalPlayGrade === "No Play" && dimensions.bettingValueStrengthScore >= 65 && dimensions.winCaseStrengthScore >= 60 && !/toss-up/i.test(row.identity.pick ?? "")) {
    push(findings, row, "no_play_with_strong_value_unexplained", "medium", "No Play has strong value/win-case dimensions and needs an explanation.");
  }

  return findings;
}

function sourceCoverage(evidence: PredictionEvidenceObject[]) {
  const coverage = (market: string) => {
    const rows = evidence.filter((row) => row.identity.normalizedMarket === market);
    return {
      rows: rows.length,
      consensus: rows.filter((row) => row.marketEvidence.consensusSplitsAvailable).length,
      sharpFullSplit: rows.filter((row) => row.marketEvidence.sharpBookSplitsAvailable).length,
      sharpSignal: rows.filter((row) => row.marketEvidence.sharpBookSignalAvailable).length,
      sharpAny: rows.filter((row) => row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable).length,
    };
  };
  return {
    moneyline: coverage("moneyline"),
    total: coverage("total"),
    first_inning: coverage("first_inning"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const response = await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date: args.date });
  const evidenceSelection = await buildPredictionEvidenceForDailyEdgeEvaluation({
    sport: args.sport,
    date: args.date,
    markets: parseAiAuditorMarkets(args.markets),
    response,
  });
  const evidence = evidenceSelection.evidence;
  const findings = evidence.flatMap(auditRow);
  const byCode = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.code] = (acc[finding.code] ?? 0) + 1;
    return acc;
  }, {});
  const bySeverity = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, {});
  const report = {
    mode: "deterministic_reader_coherence_audit",
    noOpenAiCalls: true,
    noLiveChanges: true,
    noMemberFacingChanges: true,
    sport: args.sport,
    date: args.date,
    evidenceSource: evidenceSelection.selectionSummary,
    lockedPreLockEvidenceCoverage: sourceCoverage(evidenceSelection.lockedSnapshotEvidence),
    currentLiveSourceCoverageDiagnosticOnly: sourceCoverage(evidenceSelection.currentLiveEvidence),
    predictionEvidenceObjects: evidence.length,
    findings: findings.length,
    bySeverity,
    byCode,
    blockingFindings: findings.filter((finding) => finding.severity === "block"),
    highFindings: findings.filter((finding) => finding.severity === "high"),
    allFindings: findings,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Daily Edge Reader Coherence Audit — ${args.sport} ${args.date}`);
  console.log(`No OpenAI calls were made. Evidence objects: ${evidence.length}. Findings: ${findings.length}`);
  console.log(JSON.stringify({ bySeverity, byCode }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
