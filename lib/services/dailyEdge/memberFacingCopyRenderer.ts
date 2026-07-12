import type { MarketIntelligenceInterpretation } from "@/lib/services/dailyEdge/marketIntelligenceInterpreter";
import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import type { PredictionEvidenceReview } from "@/lib/services/dailyEdge/predictionEvidenceReviewer";
import type {
  MarketDecision,
  MarketSplitDisplaySection,
  RecommendationDecision,
  ResolvedMarketRead,
  SplitSideDisplay,
} from "@/lib/types/domain/RecommendationDecision";
import { dailyEdgeMarketCapabilities } from "@/lib/services/dailyEdge/dailyEdgeSportCapabilities";

export type RenderedDailyEdgeMemberCopy = {
  marketReadLabel: string;
  quickReadCopy: string;
  marketReadCopy: string;
  supportingEvidenceCopy: string;
  riskCopy: string;
  copySource: "deterministic_member_renderer";
  rawAiCopyShown: false;
};

export type SharpContextStatus =
  | "sharp_full_splits_available"
  | "sharp_signal_available"
  | "sharp_context_recovered"
  | "sharp_context_unavailable_current_source"
  | "sharp_context_not_persisted_at_lock"
  | "sharp_context_true_source_absence"
  | "sharp_context_mapping_gap"
  | "sharp_context_not_required";

export type DailyEdgeCopyRenderIntent = {
  marketReadLabel?: string | null;
  gradeReasonType?: string | null;
  suggestedPlayGrade?: string | null;
  gradeChangeDirection?: string | null;
};

export type DailyEdgeRenderedCopyFlagOverrides = {
  quickRead?: boolean;
  marketRead?: boolean;
  supportingEvidence?: boolean;
  risk?: boolean;
};

const ML_TOTAL_LABELS = new Set([
  "clean_market_support",
  "consensus_support",
  "sharp_book_support",
  "split_support_with_price_drift",
  "mixed_but_playable",
  "market_resistance",
  "market_resistance_with_model_value_override",
  "price_capped",
  "likely_winner_bad_price",
  "projection_support",
  "thin_edge",
  "no_clear_market_signal",
  "insufficient_core_data",
]);

const FI_LABELS = new Set([
  "fi_model_support",
  "fi_price_support",
  "fi_line_movement_support",
  "fi_mixed",
  "fi_no_clear_signal",
  "fi_data_caution",
  "fi_price_capped",
  "fi_context_support",
  "fi_thin_edge",
  "fi_toss_up_no_play",
  "fi_insufficient_core_data",
]);

function pct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function price(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unpriced";
  return value > 0 ? `+${value}` : String(value);
}

const MEMBER_COPY_META_LANGUAGE_RE =
  /\b(the reader should|needs to|should mention|needs thesis|internal|grade caveat|flagged for review|human review|copy should|renderer)\b/i;

function decisionKeyForEvidence(row: PredictionEvidenceObject): keyof RecommendationDecision["markets"] {
  if (row.identity.normalizedMarket === "total") return "total";
  if (row.identity.normalizedMarket === "moneyline") return "moneyline";
  return "firstInning";
}

function capabilitiesForEvidence(row: PredictionEvidenceObject) {
  return dailyEdgeMarketCapabilities(row.identity.sport, decisionKeyForEvidence(row));
}

function sanitizeMemberCopy(copy: string, fallback: string): string {
  return MEMBER_COPY_META_LANGUAGE_RE.test(copy) ? fallback : copy;
}

function sourceContextIsAligned(row: PredictionEvidenceObject): boolean {
  return row.marketEvidence.sourceAgreement === "both_align" ||
    row.marketEvidence.sourceAgreement === "consensus_only" ||
    row.marketEvidence.sourceAgreement === "sharp_only";
}

function sourceContextIsConflicted(row: PredictionEvidenceObject): boolean {
  return row.marketEvidence.sourceConflict ||
    row.marketEvidence.sourceAgreement === "consensus_supports_sharp_opposes" ||
    row.marketEvidence.sourceAgreement === "sharp_supports_consensus_opposes";
}

function alignedSourcesWithPriceDrift(row: PredictionEvidenceObject, market: MarketIntelligenceInterpretation): boolean {
  return sourceContextIsAligned(row) &&
    !sourceContextIsConflicted(row) &&
    market.priceMovementDirection === "against_pick";
}

function plusMoneyValueText(row: PredictionEvidenceObject): string {
  return typeof row.priceValueEvidence.priceAmerican === "number" && row.priceValueEvidence.priceAmerican > 0
    ? "plus-money model edge"
    : "model/value edge";
}

function evidenceSplitConflictKind(row: PredictionEvidenceObject): "consensus_against_sharp_support" | "consensus_support_sharp_against" | null {
  if (row.marketEvidence.sourceAgreement === "sharp_supports_consensus_opposes") return "consensus_against_sharp_support";
  if (row.marketEvidence.sourceAgreement === "consensus_supports_sharp_opposes") return "consensus_support_sharp_against";
  return null;
}

function soccerLikePickLabel(row: PredictionEvidenceObject): string {
  const raw = String(row.identity.pick ?? "").toLowerCase();
  if (row.identity.marketType === "TOTAL") {
    if (raw === "over" || raw.startsWith("over")) return "the Over";
    if (raw === "under" || raw.startsWith("under")) return "the Under";
    return row.identity.pick ?? "the total pick";
  }
  if (row.identity.normalizedMarket === "first_inning") {
    if (raw === "yes") return "BTTS Yes";
    if (raw === "no") return "BTTS No";
    return row.identity.pick ?? "the BTTS pick";
  }
  if (raw === "draw") return "the draw";
  return "the match-result side";
}

function soccerLikeMovementPhrase(row: PredictionEvidenceObject): string {
  const pick = soccerLikePickLabel(row);
  const movement = row.marketEvidence.lineMovement.movementTowardAgainstPick ??
    row.marketEvidence.lineMovement.directionRelativeToPick ??
    null;
  if (movement === "toward_pick" || movement === "support") return `Odds movement supports ${pick}.`;
  if (movement === "against_pick" || movement === "resistance") return `Odds movement is against ${pick}.`;
  return "Odds movement has not created a clear market signal.";
}

function soccerLikeMovementPhraseForLabel(row: PredictionEvidenceObject, label: string): string {
  const pick = soccerLikePickLabel(row);
  if (label === "clean_market_support") return `Odds movement supports ${pick}.`;
  if (label === "market_resistance" || label === "market_resistance_with_model_value_override") {
    return `Odds movement is against ${pick}.`;
  }
  return soccerLikeMovementPhrase(row);
}

export function sharpContextStatusForEvidence(row: PredictionEvidenceObject): SharpContextStatus {
  const caps = capabilitiesForEvidence(row);
  if (!caps.expectsSharpBookContext) return "sharp_context_not_required";
  if (row.marketEvidence.sharpBookSplitsAvailable) return "sharp_full_splits_available";
  if (row.marketEvidence.sharpBookSignalAvailable) return "sharp_signal_available";
  if (row.priceValueEvidence.priceRecovered || row.modelStatsEvidence.edgeRecovered) return "sharp_context_mapping_gap";
  if (row.evidenceSource.kind === "locked_snapshot") {
    if (row.marketEvidence.sourceMissingReason?.includes("not persisted")) return "sharp_context_not_persisted_at_lock";
    return "sharp_context_not_persisted_at_lock";
  }
  if (row.marketEvidence.sourceMissingReason?.includes("mapping")) return "sharp_context_mapping_gap";
  return "sharp_context_unavailable_current_source";
}

export function hasUsableSharpContext(row: PredictionEvidenceObject): boolean {
  const status = sharpContextStatusForEvidence(row);
  return status === "sharp_full_splits_available" ||
    status === "sharp_signal_available" ||
    status === "sharp_context_recovered";
}

export function hasSharpWordingWithoutContext(row: PredictionEvidenceObject, copy: string): boolean {
  if (!/\bsharp(?: book|-book)?\b/i.test(copy)) return false;
  return !hasUsableSharpContext(row);
}

function labelWithoutMarketPrefix(label: string): string {
  return label.replace(/^(ml|total)_/, "");
}

export function allowedDailyEdgeMemberCopyLabel(row: PredictionEvidenceObject, label: string | null | undefined): boolean {
  if (!label) return false;
  const normalized = normalizeDailyEdgeMemberCopyLabel(row, label);
  return capabilitiesForEvidence(row).isFirstInning ? FI_LABELS.has(normalized) : ML_TOTAL_LABELS.has(normalized);
}

export function normalizeDailyEdgeMemberCopyLabel(row: PredictionEvidenceObject, label: string | null | undefined): string {
  const raw = String(label ?? "").trim();
  if (!raw) return "";
  if (capabilitiesForEvidence(row).isFirstInning) return raw;
  return labelWithoutMarketPrefix(raw);
}

export function deriveDailyEdgeMemberCopyLabel(args: {
  evidence: PredictionEvidenceObject;
  evidenceReview?: PredictionEvidenceReview | null;
  marketIntelligence: MarketIntelligenceInterpretation;
}): string {
  const row = args.evidence;
  const review = args.evidenceReview;
  const market = args.marketIntelligence;
  const edge = row.modelStatsEvidence.edge ?? 0;
  const read = row.marketEvidence.deterministicMarketRead;
  const dimensions = row.internalGradeDimensions;
  const caps = capabilitiesForEvidence(row);

  if (review?.evidenceQuality === "blocked") {
    return caps.isFirstInning ? "fi_insufficient_core_data" : "insufficient_core_data";
  }

  if (caps.isFirstInning) {
    if (/toss/i.test(row.identity.pick ?? "")) return "fi_toss_up_no_play";
    if (row.priceValueEvidence.heavyJuiceWarning) return "fi_price_capped";
    if (market.priceMovementDirection === "toward_pick") return "fi_line_movement_support";
    if (edge > 2.5) return "fi_model_support";
    return "fi_thin_edge";
  }

  if (row.priceValueEvidence.heavyJuiceWarning && edge < 4) {
    return row.identity.marketType === "ML" ? "likely_winner_bad_price" : "price_capped";
  }
  if (row.identity.originalPlayGrade === "Lean" && dimensions.bettingValueStrengthScore < 45 && dimensions.winCaseStrengthScore < 55) {
    return row.identity.marketType === "TOTAL" ? "thin_edge" : "price_capped";
  }
  if (caps.isSoccerLike) {
    if (market.priceMovementDirection === "toward_pick") return "clean_market_support";
    if (market.priceMovementDirection === "against_pick") {
      return edge >= 5 ? "market_resistance_with_model_value_override" : "market_resistance";
    }
  }
  if (alignedSourcesWithPriceDrift(row, market)) return "split_support_with_price_drift";
  if (read === "resistance" || read === "consensus_resistance") {
    if (sourceContextIsAligned(row) && !sourceContextIsConflicted(row)) {
      if (row.identity.marketType === "TOTAL" && row.modelStatsEvidence.projectedTotal !== null && row.identity.lineValue !== null) {
        return edge < 2.5 ? "thin_edge" : "projection_support";
      }
      return hasUsableSharpContext(row) ? "sharp_book_support" : "consensus_support";
    }
    return edge >= 5 ? "market_resistance_with_model_value_override" : "market_resistance";
  }
  if (read === "mixed" || sourceContextIsConflicted(row)) return "mixed_but_playable";
  if (read === "no_clear_signal") return "no_clear_market_signal";
  if (read === "insufficient_data") return "insufficient_core_data";
  if (read === "consensus_support") return "consensus_support";
  if (read === "aligned" && sourceContextIsAligned(row)) {
    if (row.identity.marketType === "TOTAL" && row.modelStatsEvidence.projectedTotal !== null && row.identity.lineValue !== null) {
      return edge < 2.5 ? "thin_edge" : "projection_support";
    }
    if (hasUsableSharpContext(row) && (market.consensusVsSharpRelationship === "sharp_only" || market.consensusVsSharpRelationship === "both_support" || row.marketEvidence.sharpBookSplitsAvailable)) {
      return "sharp_book_support";
    }
    return "clean_market_support";
  }
  if (market.marketFrictionLevel === "high") {
    if (sourceContextIsAligned(row) && !sourceContextIsConflicted(row)) return "split_support_with_price_drift";
    return edge >= 5 ? "market_resistance_with_model_value_override" : "market_resistance";
  }
  if (market.marketFrictionLevel === "medium") {
    if (sourceContextIsAligned(row) && !sourceContextIsConflicted(row)) return "split_support_with_price_drift";
    return "mixed_but_playable";
  }
  if (row.identity.marketType === "TOTAL" && row.modelStatsEvidence.projectedTotal !== null && row.identity.lineValue !== null) {
    return edge < 2.5 ? "thin_edge" : "projection_support";
  }
  if (hasUsableSharpContext(row) && (market.consensusVsSharpRelationship === "sharp_only" || market.consensusVsSharpRelationship === "both_support")) return "sharp_book_support";
  if (market.consensusVsSharpRelationship === "consensus_only") return "consensus_support";
  if (market.priceMovementDirection === "against_pick") return sourceContextIsAligned(row) ? "split_support_with_price_drift" : edge >= 5 ? "mixed_but_playable" : "market_resistance";
  if (market.marketFrictionLevel === "none" || market.marketFrictionLevel === "low") return "clean_market_support";
  return "no_clear_market_signal";
}

function marketReadCopy(row: PredictionEvidenceObject, label: string): string {
  const pick = row.identity.pick ?? "the pick";
  const grade = row.identity.originalPlayGrade;
  const caps = capabilitiesForEvidence(row);
  if (caps.isFirstInning) {
    if (label === "fi_toss_up_no_play") return "FI is Toss-Up, so there is no actionable YRFI/NRFI side yet.";
    if (label === "fi_price_capped") return `The FI model leans ${pick}, but the current ${price(row.priceValueEvidence.priceAmerican)} price does not leave enough value.`;
    if (label === "fi_line_movement_support") return `${pick} has FI model support and price movement is not fighting the prediction.`;
    if (label === "fi_data_caution") return "The FI read has a material price/context concern, so this stays in Caution.";
    if (label === "fi_model_support") return `${pick} is mostly model/stat driven, with price and FI context carrying the read.`;
    if (label === "fi_thin_edge" && (row.identity.pick === null || row.priceValueEvidence.priceAmerican === null || row.modelStatsEvidence.edge === null)) {
      return "FI remains No Play because the current price/model context does not create an actionable YRFI/NRFI side.";
    }
    if (label === "fi_thin_edge") return `The FI model leans ${pick}, but the edge is thin at this number.`;
    return `${pick} is mostly model/stat driven, with price and FI context carrying the read.`;
  }

  if (caps.isSoccerLike) {
    const movement = soccerLikeMovementPhraseForLabel(row, label);
    if (label === "clean_market_support") return grade === "No Play"
      ? `${movement} The current price or model edge still is not enough to make it actionable.`
      : `${movement} Price and model edge determine how actionable the read is.`;
    if (label === "market_resistance") return grade === "No Play"
      ? `${movement} The model/value case is not strong enough to make this actionable at the current number.`
      : `${movement} That market friction remains part of the read.`;
    if (label === "market_resistance_with_model_value_override") {
      if (grade === "No Play") return `${movement} The model/value case is still not strong enough to make this actionable.`;
      return `${movement} The model/value edge has to carry the thesis through that friction.`;
    }
    if (label === "likely_winner_bad_price") return "The win case may be reasonable, but the current price leaves too little actionable betting value.";
    if (label === "price_capped") return "The model case is present, but the current price caps how strong the read can be.";
    if (label === "thin_edge") return `${movement} The edge is still thin enough to keep this below a stronger play.`;
    if (label === "insufficient_core_data") return "Core price/model context is incomplete, so this is not actionable yet.";
    return "The read leans on model value, price, odds movement, and soccer-specific match context.";
  }

  if (label === "clean_market_support") return grade === "No Play"
    ? "Market context is supportive, but the model/value case is not strong enough to make this actionable."
    : "Market signals and the model case both support the thesis, giving this more confirmation than a model-only play.";
  if (label === "consensus_support") return grade === "No Play"
    ? "Consensus Splits support the pick, but there is not enough actionable edge at the current number."
    : "Consensus Splits support the pick, while market confirmation remains measured.";
  if (label === "sharp_book_support") {
    if (!hasUsableSharpContext(row)) return grade === "No Play"
      ? "Market confirmation is limited, and the model/value case is not strong enough to make this actionable."
      : "Market context is supportive, but the read leans more on model/value and price.";
    return "The Sharp-book split profile supports the pick, giving the model case added market confirmation.";
  }
  if (label === "split_support_with_price_drift") {
    if (grade === "No Play") return "Visible split context supports the pick, but price movement has drifted away and the model/value case is not strong enough to make this actionable.";
    if (grade === "Caution") return "Visible split context supports the pick, but price movement has drifted away enough to keep this in caution territory.";
    if (grade === "Watchlist") return "Visible split context supports the pick, but price movement has drifted away enough to keep this worth monitoring.";
    return "Visible split context supports the pick, while price movement has drifted away enough to keep the read from being fully clean.";
  }
  if (label === "mixed_but_playable") {
    const splitConflict = evidenceSplitConflictKind(row);
    if (splitConflict === "consensus_against_sharp_support") {
      return grade === "No Play"
        ? "Consensus Splits lean against the pick, and the model/value case is not strong enough to make the Sharp Book support actionable."
        : "Consensus Splits lean against the pick, but Sharp Book context and model/value keep this in the mix.";
    }
    if (splitConflict === "consensus_support_sharp_against") {
      return grade === "No Play"
        ? "Consensus Splits support the pick, but Sharp Book resistance and the current model/value case keep this below action."
        : "Consensus Splits support the pick, but Sharp Book resistance keeps market friction in the read.";
    }
    return grade === "No Play"
      ? "Market signals are mixed, and the current model/value case is not strong enough to make this actionable."
      : grade === "Watchlist"
        ? "Market signals are mixed, but the price and model edge keep this worth monitoring."
        : "Market signals are mixed, but the price and model edge keep this playable.";
  }
  if (label === "market_resistance") return grade === "No Play"
    ? "Market resistance is present, and the model/value case is not strong enough to make this actionable at the current number."
    : grade === "Caution"
      ? "Market resistance is present, and that friction keeps this in caution territory."
      : "Market resistance is present, so the model case needs to be strong enough to justify action.";
  if (label === "market_resistance_with_model_value_override") {
    if (grade === "Lean") return "Market resistance is present, but the model/value edge is strong enough to keep this playable.";
    if (grade === "Watchlist") return "Market resistance is present, but the model/value case is strong enough to keep this worth monitoring.";
    if (grade === "Caution") return "Market resistance is present, and while there is a model/value case, the friction keeps this in caution territory.";
    if (grade === "No Play") return "Market resistance is present, and the model/value case is not strong enough to make this actionable at the current number.";
    return "Market resistance is present, but the model/value edge is strong enough to support the thesis.";
  }
  if (label === "price_capped") return "The projection supports the pick, but the current price caps how strong the grade can be.";
  if (label === "likely_winner_bad_price") return "The win case may be reasonable, but the current price leaves too little actionable betting value.";
  if (label === "projection_support") return "The projection supports the total at this number, giving the pick a clear model/stat case.";
  if (label === "thin_edge") return "The model leans this way, but the edge is thin enough to keep the read below a stronger play.";
  if (label === "insufficient_core_data") return "Core price/model context is incomplete, so this is not actionable yet.";
  return "Market confirmation is not clear enough by itself, so the read leans on model edge, price, and line context.";
}

function quickReadCopy(row: PredictionEvidenceObject, label: string): string {
  const pick = row.identity.pick ?? "This prediction";
  const grade = row.identity.originalPlayGrade;
  const edge = row.modelStatsEvidence.edge ?? null;
  const priceText = price(row.priceValueEvidence.priceAmerican);
  const valueText = plusMoneyValueText(row);
  const caps = capabilitiesForEvidence(row);

  if (caps.isFirstInning) {
    if (label === "fi_toss_up_no_play") return "FI is Toss-Up, so there is no actionable YRFI/NRFI side yet.";
    if (grade === "No Play" && (!row.identity.pick || row.priceValueEvidence.priceAmerican === null || row.modelStatsEvidence.modelProbability === null || row.modelStatsEvidence.edge === null)) {
      return "FI remains No Play because current price/model context does not create an actionable YRFI/NRFI side.";
    }
    if (grade === "No Play") return `At ${priceText}, the FI edge is too thin to make ${pick} actionable.`;
    if (grade === "Watchlist") return `${pick} has FI model interest, but price and context keep it on Watchlist.`;
    if (grade === "Lean") return `${pick} has a playable FI model case, with price keeping it below a stronger grade.`;
    return `${pick} has FI model support, with price and FI context carrying the read.`;
  }

  if (grade === "Best Angle") {
    if (label === "market_resistance_with_model_value_override") return `Strong ${valueText}, but market resistance keeps some friction in the thesis.`;
    if (label === "split_support_with_price_drift") return `Strong ${valueText} with split support, though price movement keeps the thesis from being fully clean.`;
    if (label === "sharp_book_support") return "Strong model/value case with Sharp Book support and a playable price.";
    return "Strong model/value case with enough price and market context to support the top grade.";
  }
  if (grade === "Lean") {
    if (label === "thin_edge" || (edge !== null && edge < 3)) {
      if (row.identity.marketType === "TOTAL" && sourceContextIsConflicted(row)) return `${pick} has a small model edge, but mixed split context and ${priceText} pricing keep this as a thin Lean.`;
      if (row.identity.marketType === "TOTAL" && (row.marketEvidence.deterministicMarketRead === "resistance" || label === "market_resistance")) return `${pick} has a modest edge at ${priceText}, but resistance and thin value keep this capped as a Lean.`;
      return `${pick} has a playable lean, but the edge is thin enough to keep this below a stronger grade.`;
    }
    if (label === "market_resistance" || label === "market_resistance_with_model_value_override") return "Playable model/value case, though market resistance keeps friction in the read.";
    if (label === "split_support_with_price_drift") return "Playable model/value case with split support, though price movement has drifted away.";
    if (label === "mixed_but_playable" && evidenceSplitConflictKind(row) === "consensus_against_sharp_support") return "Playable model/value case with Sharp Book support, though consensus leans the other way.";
    if (label === "mixed_but_playable" && evidenceSplitConflictKind(row) === "consensus_support_sharp_against") return "Playable model/value case, though Sharp Book resistance keeps friction in the read.";
    if (label === "price_capped" || label === "likely_winner_bad_price") return "Playable win case, but the current price keeps this below a stronger grade.";
    return "Playable model/value case with enough price support to stay actionable.";
  }
  if (grade === "Watchlist") {
    if (row.identity.marketType === "ML" && typeof edge === "number" && edge >= 5 && typeof row.priceValueEvidence.priceAmerican === "number" && row.priceValueEvidence.priceAmerican > 0) {
      return `The plus-money model edge is real, but market resistance keeps this on Watchlist.`;
    }
    if (label === "mixed_but_playable" || label === "market_resistance" || label === "market_resistance_with_model_value_override") return "Model/value case is present, but the market read keeps this on Watchlist.";
    if (label === "split_support_with_price_drift") return "Split context is supportive, but price movement keeps this on Watchlist.";
    return "Model/value interest is present, but not strong enough for action yet.";
  }
  if (grade === "Caution") {
    if (label === "market_resistance_with_model_value_override" || label === "market_resistance") return `${pick} shows ${valueText}, but market resistance keeps this in Caution rather than action territory.`;
    if (label === "split_support_with_price_drift") return `${pick} has supportive split context, but price movement keeps this in Caution rather than action territory.`;
    if (label === "price_capped" || label === "likely_winner_bad_price") return "Win case is present, but price limits the betting value.";
    return "Caution grade: the setup needs cleaner value, price, or market context.";
  }
  if (label === "likely_winner_bad_price" || label === "price_capped") return "Likely winner profile, but the current price limits betting value.";
  if (label === "insufficient_core_data") return "No Play until core price, model, and market evidence are complete.";
  return "No Play: the current setup does not show enough actionable betting edge.";
}

function supportingEvidenceCopy(row: PredictionEvidenceObject, label: string): string {
  const pick = row.identity.pick ?? "the pick";
  const model = pct(row.modelStatsEvidence.modelProbability);
  const implied = pct(row.modelStatsEvidence.marketImpliedProbability);
  const edge = pct(row.modelStatsEvidence.edge);
  const odds = price(row.priceValueEvidence.priceAmerican);

  const grade = row.identity.originalPlayGrade;
  const caps = capabilitiesForEvidence(row);
  const lowGradeContext =
    grade === "Caution"
      ? " Market friction is why this remains Caution."
      : grade === "No Play"
        ? " The projection/model case is not strong enough to overcome the current number or market resistance."
        : grade === "Watchlist"
          ? " This keeps the prediction worth monitoring, not automatically actionable."
          : "";

  if (caps.isFirstInning) {
    if (/toss/i.test(row.identity.pick ?? "")) return "FI is Toss-Up, so there is no actionable YRFI/NRFI side yet. The model is not creating enough separation for a first-inning play.";
    if (grade === "No Play" && (!row.identity.pick || row.priceValueEvidence.priceAmerican === null || row.modelStatsEvidence.modelProbability === null || row.modelStatsEvidence.edge === null)) {
      return "FI remains No Play because current price/model context does not create an actionable YRFI/NRFI side.";
    }
    if (grade === "No Play") return `FI model probability is ${model} with about ${edge} edge at ${odds}. At this price, the FI edge is too thin to make ${pick} actionable.`;
    if (grade === "Lean") return `${pick} has ${model} FI model probability with about ${edge} edge at ${odds}; price keeps it below a stronger grade.`;
    if (grade === "Watchlist") return `${pick} is worth monitoring, but the FI edge is not strong enough for action yet.`;
    if (grade === "Caution") return `The FI read has a material price/context concern at ${odds}, so this stays in Caution.`;
    return `${pick} has ${model} FI model probability with about ${edge} edge at ${odds}.`;
  }

  const movementContext = caps.isSoccerLike ? ` ${soccerLikeMovementPhraseForLabel(row, label)}` : "";

  if (row.identity.marketType === "TOTAL") {
    const projected = row.modelStatsEvidence.projectedTotal;
    const line = row.identity.lineValue;
    const projectionText = projected !== null && line !== null ? `Projection is ${projected} against line ${line}` : "Projection/line context is limited";
    return `${projectionText}; ${pick} has ${model} model probability versus ${implied} implied at ${odds}, for about ${edge} edge.${movementContext}${lowGradeContext}`;
  }

  if (label === "mixed_but_playable") {
    const splitConflict = evidenceSplitConflictKind(row);
    if (splitConflict === "consensus_against_sharp_support") return `${pick} has ${model} model probability versus ${implied} implied at ${odds}, for about ${edge} edge. Consensus Splits lean the other way, but Sharp Book context supports the pick.${lowGradeContext}`;
    if (splitConflict === "consensus_support_sharp_against") return `${pick} has ${model} model probability versus ${implied} implied at ${odds}, for about ${edge} edge. Consensus Splits support the pick, but Sharp Book resistance keeps the read mixed.${lowGradeContext}`;
  }

  if (label === "split_support_with_price_drift") {
    const driftContext = grade === "Caution"
      ? " Price movement is the caution point despite supportive split context."
      : grade === "No Play"
        ? " Supportive splits are not enough to make this actionable with price movement drifting away."
        : " Price movement has drifted away, so the read is supportive but not fully clean.";
    return `${pick} has ${model} model probability versus ${implied} implied at ${odds}, for about ${edge} edge.${driftContext}`;
  }

  return `${pick} has ${model} model probability versus ${implied} implied at ${odds}, for about ${edge} edge.${movementContext}${lowGradeContext}`;
}

function riskCopy(row: PredictionEvidenceObject, label: string): string {
  const caps = capabilitiesForEvidence(row);
  if (caps.isFirstInning) {
    if (label === "fi_toss_up_no_play") return "FI is Toss-Up, so there is no actionable YRFI/NRFI side yet; wait for a clearer setup.";
    if (label === "fi_price_capped") return `The ${price(row.priceValueEvidence.priceAmerican)} price is the main cap, so the FI edge needs to hold up cleanly.`;
    return "A thin FI model edge can disappear quickly if starter/top-order context is weaker than expected.";
  }

  if (label === "market_resistance") return "Market resistance keeps this from being cleaner; avoid treating the model edge as confirmation by itself.";
  if (label === "market_resistance_with_model_value_override") return "The thesis depends on the model/value edge overriding market resistance, so the risk note should say that plainly.";
  if (label === "split_support_with_price_drift") return "Split context is supportive, but price movement has drifted away; avoid treating the read as perfectly clean.";
  if (label === "price_capped" || label === "likely_winner_bad_price") return "Price is the main cap here; a likely outcome is not automatically a good bet.";
  if (label === "thin_edge") return "The edge is thin, so small price or lineup movement can erase the value.";
  if (label === "insufficient_core_data") return "Core price, model, or line evidence is incomplete; keep this below action until the missing fields are repaired.";
  return "The main risk is that market conditions or price movement weaken the model edge before lock.";
}

export function renderDailyEdgeMemberCopy(args: {
  evidence: PredictionEvidenceObject;
  evidenceReview?: PredictionEvidenceReview | null;
  marketIntelligence: MarketIntelligenceInterpretation;
  intent?: DailyEdgeCopyRenderIntent | null;
}): RenderedDailyEdgeMemberCopy {
  const fallback = deriveDailyEdgeMemberCopyLabel({
    evidence: args.evidence,
    evidenceReview: args.evidenceReview ?? null,
    marketIntelligence: args.marketIntelligence,
  });
  const requested = normalizeDailyEdgeMemberCopyLabel(args.evidence, args.intent?.marketReadLabel);
  const label = allowedDailyEdgeMemberCopyLabel(args.evidence, requested) ? requested : fallback;
  const quick = quickReadCopy(args.evidence, label);
  const read = marketReadCopy(args.evidence, label);
  const support = supportingEvidenceCopy(args.evidence, label);
  const risk = riskCopy(args.evidence, label);
  return {
    marketReadLabel: label,
    quickReadCopy: sanitizeMemberCopy(quick, "Model, price, and market context set the current grade."),
    marketReadCopy: sanitizeMemberCopy(read, "Market context and model/value evidence set the current read."),
    supportingEvidenceCopy: sanitizeMemberCopy(support, "Model probability, implied price, and market context explain the current grade."),
    riskCopy: sanitizeMemberCopy(risk, "Price, market movement, or data quality can weaken the edge before lock."),
    copySource: "deterministic_member_renderer",
    rawAiCopyShown: false,
  };
}

function envFlag(name: string): boolean {
  return process.env[name] === "true";
}

function pctFromDecision(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
}

function pctNumberFromDecision(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value <= 1 ? value * 100 : value;
}

function edgePctFromDecision(decision: MarketDecision): number | null {
  const model = pctNumberFromDecision(decision.modelProbability);
  const implied = pctNumberFromDecision(decision.marketImplied);
  if (model !== null && implied !== null) return model - implied;
  if (typeof decision.edgePp === "number" && Number.isFinite(decision.edgePp)) return decision.edgePp;
  return null;
}

function pctPointFromDecision(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
}

function priceFromDecision(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unpriced";
  return value > 0 ? `+${value}` : String(value);
}

function hasDecisionSharpContext(decision: MarketDecision, sport = "mlb", key: keyof RecommendationDecision["markets"] = "moneyline"): boolean {
  return dailyEdgeMarketCapabilities(sport, key).expectsSharpBookContext && decision.sharpBookSplits !== null;
}

function decisionHasSourceConflict(decision: MarketDecision): boolean {
  return decision.sourceConflict === true ||
    decision.resolvedMarketRead.status === "mixed";
}

function decisionPickSplitRow(section: MarketSplitDisplaySection | null, pick: string | null): SplitSideDisplay | null {
  if (!section || !pick) return null;
  const normalizedPick = pick.toLowerCase();
  return section.rows.find((row) => {
    const label = row.label.toLowerCase();
    return normalizedPick === label || normalizedPick.startsWith(`${label} `) || normalizedPick.includes(` ${label} `);
  }) ?? null;
}

function splitRowLean(row: SplitSideDisplay | null): "support" | "against" | "money_support" | "mixed" | "none" {
  if (!row) return "none";
  const money = row.moneyPct;
  const bets = row.betsPct;
  if (money !== null && bets !== null) {
    if (money >= 50 && bets >= 50) return "support";
    if (money < 50 && bets < 50) return "against";
    if (money >= 55 && bets < 50) return "money_support";
    return "mixed";
  }
  const value = money ?? bets;
  if (value === null) return "none";
  return value >= 50 ? "support" : "against";
}

function hasConsensusAgainstSharpMoneySupport(decision: MarketDecision): boolean {
  const consensusLean = splitRowLean(decisionPickSplitRow(decision.consensusSplits, decision.pick));
  const sharpLean = splitRowLean(decisionPickSplitRow(decision.sharpBookSplits, decision.pick));
  return consensusLean === "against" && (sharpLean === "support" || sharpLean === "money_support");
}

function decisionSplitConflictKind(decision: MarketDecision): "consensus_against_sharp_support" | "consensus_support_sharp_against" | null {
  const consensusLean = splitRowLean(decisionPickSplitRow(decision.consensusSplits, decision.pick));
  const sharpLean = splitRowLean(decisionPickSplitRow(decision.sharpBookSplits, decision.pick));
  if (consensusLean === "against" && (sharpLean === "support" || sharpLean === "money_support")) {
    return "consensus_against_sharp_support";
  }
  if ((consensusLean === "support" || consensusLean === "money_support") && sharpLean === "against") {
    return "consensus_support_sharp_against";
  }
  return null;
}

function decisionHasSharpMoneyDivergence(decision: MarketDecision): boolean {
  const row = decisionPickSplitRow(decision.sharpBookSplits, decision.pick);
  return !!row && row.moneyPct !== null && row.betsPct !== null && row.moneyPct >= 60 && row.betsPct < 50;
}

function consensusSupportPhrase(decision: MarketDecision): string {
  const row = decisionPickSplitRow(decision.consensusSplits, decision.pick);
  if (row && row.moneyPct !== null && row.betsPct !== null) {
    return `Consensus Splits support ${decision.pick ?? "the pick"} (${row.moneyPct}% money / ${row.betsPct}% bets)`;
  }
  return `Consensus Splits support ${decision.pick ?? "the pick"}`;
}

function sharpMoneySupportPhrase(decision: MarketDecision): string {
  const row = decisionPickSplitRow(decision.sharpBookSplits, decision.pick);
  if (row && row.moneyPct !== null && row.betsPct !== null) {
    return `Sharp Book money is ${row.moneyPct}% on ${decision.pick ?? "the pick"} versus ${row.betsPct}% of bets`;
  }
  return `Sharp Book context supports ${decision.pick ?? "the pick"}`;
}

function consensusAgainstPhrase(decision: MarketDecision): string {
  const row = decisionPickSplitRow(decision.consensusSplits, decision.pick);
  if (row && row.moneyPct !== null && row.betsPct !== null) {
    return `Consensus Splits lean against the pick (${row.moneyPct}% money / ${row.betsPct}% bets on ${decision.pick ?? "the pick"})`;
  }
  return "Consensus Splits lean against the pick";
}

function sharpAgainstPhrase(decision: MarketDecision): string {
  const row = decisionPickSplitRow(decision.sharpBookSplits, decision.pick);
  if (row && row.moneyPct !== null && row.betsPct !== null) {
    return `Sharp Book Splits show resistance (${row.moneyPct}% money / ${row.betsPct}% bets on ${decision.pick ?? "the pick"})`;
  }
  return "Sharp Book Splits show resistance";
}

function lineMovementSupportPhrase(decision: MarketDecision): string {
  if (decision.lineMovement === "support") return " Odds movement is also toward the pick.";
  if (decision.lineMovement === "resistance") return " Odds movement is not fully with the pick.";
  return "";
}

function soccerDecisionPickLabel(decision: MarketDecision, key: keyof RecommendationDecision["markets"]): string {
  const raw = String(decision.pick ?? "").toLowerCase();
  if (key === "moneyline") {
    if (raw === "home" || raw === "away") return "The match-result side";
    if (raw === "draw") return "The draw";
    return decision.pick ?? "The match-result side";
  }
  if (key === "total") {
    if (raw === "over" || raw.startsWith("over")) return "The Over";
    if (raw === "under" || raw.startsWith("under")) return "The Under";
    return decision.pick ?? "The total pick";
  }
  if (raw === "yes") return "BTTS Yes";
  if (raw === "no") return "BTTS No";
  return decision.pick ?? "The BTTS pick";
}

function soccerMovementCopy(decision: MarketDecision): string {
  if (decision.lineMovement === "support") return "odds movement toward the pick";
  if (decision.lineMovement === "resistance") return "odds movement against the pick";
  return "no clear odds-move signal";
}

function decisionQuickReadCopy(decision: MarketDecision, key: keyof RecommendationDecision["markets"], sport = "mlb"): string {
  const caps = dailyEdgeMarketCapabilities(sport, key);
  const grade = decision.playGrade;
  const status = decision.resolvedMarketRead.status;
  const edge = edgePctFromDecision(decision);
  const price = priceFromDecision(decision.price);
  const pick = decision.pick ?? "This prediction";
  const plusMoneyValue = typeof decision.price === "number" && decision.price > 0 ? "plus-money model edge" : "model/value case";

  if (caps.isFirstInning) {
    if (/toss/i.test(pick)) return "FI is Toss-Up, so there is no actionable YRFI/NRFI side yet.";
    if (grade === "No Play" && (decision.pick === null || decision.price === null || decision.modelProbability === null || edge === null)) {
      return "FI remains No Play because current price/model context does not create an actionable YRFI/NRFI side.";
    }
    if (grade === "No Play") return `At ${price}, the FI edge is too thin to make ${pick} actionable.`;
    if (grade === "Watchlist") return `${pick} has FI model interest, but price and context keep it on Watchlist.`;
    if (grade === "Lean") return `${pick} has a playable FI model case, with price keeping it below a stronger grade.`;
    return `${pick} has FI model support, with price and FI context carrying the read.`;
  }

  if (caps.isSoccerLike) {
    const soccerPick = soccerDecisionPickLabel(decision, key);
    const movement = soccerMovementCopy(decision);
    if (grade === "Best Angle") return `${soccerPick} has a strong model/value case, with ${movement}.`;
    if (grade === "Lean") return `${soccerPick} is playable, with ${movement}; price or draw risk keeps it below the strongest tier.`;
    if (grade === "Watchlist") return `${soccerPick} is worth monitoring, with ${movement}, but it is not strong enough for action yet.`;
    if (grade === "Caution") return `${soccerPick} has some model interest, but ${movement} and price/risk keep this in Caution.`;
    if (decision.lineMovement === "support") return `${soccerPick} has odds movement support, but the current price or model edge is not enough to make it actionable.`;
    if (decision.lineMovement === "resistance") return `${soccerPick} has odds movement against it and is not actionable at the current price or model edge.`;
    return `${soccerPick} is not actionable at the current price or model edge.`;
  }

  const splitConflict = decisionSplitConflictKind(decision);
  const sharpMoneyDivergence = decisionHasSharpMoneyDivergence(decision);
  if (grade === "Best Angle") {
    if (splitConflict === "consensus_against_sharp_support" && decision.lineMovement === "support") {
      return "Strong model/value case with Sharp Book money and odds movement behind it, despite consensus leaning the other way.";
    }
    if (splitConflict === "consensus_support_sharp_against") {
      return "Strong model/value case, but Sharp Book resistance keeps market friction in the read.";
    }
    if (sharpMoneyDivergence) return "Strong model/value case with Sharp Book money heavier than bet count and a playable price.";
    if (status === "mixed" || status === "resistance" || status === "consensus_resistance") return `Strong ${plusMoneyValue}, but market resistance keeps some friction in the thesis.`;
    if (decision.lineMovement === "resistance") return `Strong ${plusMoneyValue}, but odds movement against the pick keeps the market read from being fully clean.`;
    if (hasDecisionSharpContext(decision, sport, key)) return "Strong model/value case with Sharp Book support and a playable price.";
    return "Strong model/value case with enough price and market context to support the top grade.";
  }
  if (grade === "Lean") {
    if (edge !== null && edge < 3) {
      if (decisionHasSourceConflict(decision)) return `${pick} has a small model edge, but mixed split context and ${price} pricing keep this as a thin Lean.`;
      if (status === "resistance" || status === "consensus_resistance") return `${pick} has a modest edge at ${price}, but resistance and thin value keep this from being a cleaner Lean.`;
      return `${pick} has a playable lean, but the edge is thin enough to keep this below a stronger grade.`;
    }
    if (sharpMoneyDivergence) return "Playable model/value case with Sharp Book money heavier than bet count.";
    if (decision.lineMovement === "resistance") return "Playable model/value case, though odds movement against the pick keeps friction in the read.";
    if (status === "mixed" || status === "resistance" || status === "consensus_resistance") return "Playable model/value case, though market resistance keeps friction in the read.";
    if (splitConflict === "consensus_against_sharp_support") return "Playable model/value case with Sharp Book support, though consensus is leaning the other way.";
    if (splitConflict === "consensus_support_sharp_against") return "Playable model/value case, though Sharp Book resistance keeps friction in the read.";
    return "Playable model/value case with enough price support to stay actionable.";
  }
  if (grade === "Watchlist") {
    if (edge !== null && edge >= 5 && typeof decision.price === "number" && decision.price > 0) return "The plus-money model edge is real, but market resistance keeps this on Watchlist.";
    if (decision.lineMovement === "resistance") return "Model/value case is present, but odds movement against the pick keeps this on Watchlist.";
    if (status === "mixed" || status === "resistance" || status === "consensus_resistance") return "Model/value case is present, but the market read keeps this on Watchlist.";
    if (splitConflict !== null) return "Model/value case is present, but split-source conflict keeps this on Watchlist.";
    return "Model/value interest is present, but not strong enough for action yet.";
  }
  if (grade === "Caution") {
    if (decision.lineMovement === "resistance") return `${pick} shows ${plusMoneyValue}, but odds movement against the pick keeps this in Caution rather than action territory.`;
    if (status === "mixed" || status === "resistance" || status === "consensus_resistance") return `${pick} shows ${plusMoneyValue}, but market resistance keeps this in Caution rather than action territory.`;
    return "Caution grade: the setup needs cleaner value, price, or market context.";
  }
  if (decision.price !== null && decision.modelProbability !== null && decision.marketImplied !== null) {
    return "No Play: the current setup does not show enough actionable betting edge.";
  }
  return "No Play until core price, model, and market evidence are complete.";
}

function decisionMarketRead(decision: MarketDecision, key: keyof RecommendationDecision["markets"], sport = "mlb"): ResolvedMarketRead {
  const caps = dailyEdgeMarketCapabilities(sport, key);
  const grade = decision.playGrade;
  const status = decision.resolvedMarketRead.status;
  const edge = decision.edgePp ?? 0;
  const sharp = hasDecisionSharpContext(decision, sport, key);
  const pick = decision.pick ?? "This FI prediction";
  if (caps.isFirstInning) {
    if (/toss/i.test(pick)) return { ...decision.resolvedMarketRead, copy: "FI is Toss-Up, so there is no actionable YRFI/NRFI side yet." };
    if (grade === "No Play" && (decision.pick === null || decision.price === null || decision.modelProbability === null || decision.edgePp === null)) {
      return {
        ...decision.resolvedMarketRead,
        status: "insufficient_data",
        label: "No Clear Signal",
        copy: "FI remains No Play because current price/model context does not create an actionable YRFI/NRFI side.",
      };
    }
    if (grade === "No Play") return { ...decision.resolvedMarketRead, copy: `The FI model leans ${pick}, but the current ${priceFromDecision(decision.price)} price does not leave enough value.` };
    if (grade === "Lean") return { ...decision.resolvedMarketRead, copy: `${pick} is mostly model/stat driven, with price and FI context carrying the read.` };
    if (grade === "Watchlist") return { ...decision.resolvedMarketRead, copy: `${pick} is worth monitoring, but the FI edge is not strong enough for action yet.` };
    if (grade === "Caution") return { ...decision.resolvedMarketRead, copy: "The FI read has a material price/context concern, so this stays in Caution." };
    return { ...decision.resolvedMarketRead, copy: `${pick} is mostly model/stat driven, with price and FI context carrying the read.` };
  }

  if (caps.isSoccerLike) {
    const soccerPick = soccerDecisionPickLabel(decision, key);
    if (decision.lineMovement === "support") {
      return {
        ...decision.resolvedMarketRead,
        status: "aligned",
        label: "Market Support",
        tone: "emerald",
        copy: grade === "No Play"
          ? `Odds movement supports ${soccerPick}, but the current price or model edge is not enough to make it actionable.`
          : `Odds movement supports ${soccerPick}, while price and model edge determine how actionable it is.`,
      };
    }
    if (decision.lineMovement === "resistance") {
      return {
        ...decision.resolvedMarketRead,
        status: "resistance",
        label: "Market Resistance",
        tone: "amber",
        copy: grade === "No Play"
          ? `Odds movement is against ${soccerPick}, and the current model/value case is not enough to make it actionable.`
          : `Odds movement is against ${soccerPick}, so market friction remains part of the read.`,
      };
    }
    if (grade === "No Play") {
      return {
        ...decision.resolvedMarketRead,
        status: decision.resolvedMarketRead.status === "insufficient_data" ? "insufficient_data" : "no_clear_signal",
        copy: `${soccerPick} is not actionable at the current price or model edge.`,
      };
    }
    return {
      ...decision.resolvedMarketRead,
      status: decision.resolvedMarketRead.status === "insufficient_data" ? "no_clear_signal" : decision.resolvedMarketRead.status,
      copy: `${soccerPick} is driven by model value, price, movement, and soccer-specific match context.`,
    };
  }
  const splitConflict = decisionSplitConflictKind(decision);
  const sharpMoneyDivergence = decisionHasSharpMoneyDivergence(decision);
  if (splitConflict === "consensus_against_sharp_support") {
    const movement = decision.lineMovement === "support" ? " and odds movement" : "";
    const modelContext = edge >= 5 ? " The model/value edge is strong enough to keep the thesis live." : "";
    return {
      status: "mixed",
      label: "Mixed",
      tone: "gray",
      copy: `${consensusAgainstPhrase(decision)}, but ${sharpMoneySupportPhrase(decision)}${movement}.${modelContext}`,
    };
  }
  if (splitConflict === "consensus_support_sharp_against") {
    const modelContext = edge >= 5 ? " The model/value edge has to carry the thesis through that friction." : "";
    return {
      status: "mixed",
      label: "Mixed",
      tone: "gray",
      copy: `Consensus Splits support the pick, but ${sharpAgainstPhrase(decision)}.${modelContext}`,
    };
  }
  if (sharpMoneyDivergence) {
    const modelContext = edge >= 5 ? " The model/value edge is also strong." : " The model/value case is present.";
    return {
      ...decision.resolvedMarketRead,
      status: decision.resolvedMarketRead.status === "insufficient_data" ? "mixed" : decision.resolvedMarketRead.status,
      copy: `${consensusSupportPhrase(decision)}, while ${sharpMoneySupportPhrase(decision)}.${lineMovementSupportPhrase(decision)}${modelContext}`,
    };
  }
  if (
    decision.lineMovement === "resistance" &&
    (status === "aligned" || status === "consensus_support")
  ) {
    return {
      ...decision.resolvedMarketRead,
      status: "mixed",
      label: "Mixed",
      tone: "gray",
      copy: grade === "No Play"
        ? "Split context is supportive, but odds movement is against the pick and the model/value case is not strong enough to make this actionable."
        : "Split context is supportive, but odds movement is against the pick, so the market read is not fully clean.",
    };
  }
  if ((status === "resistance" || status === "consensus_resistance") && edge >= 5) {
    if (grade === "Lean") return { ...decision.resolvedMarketRead, copy: "Market resistance is present, but the model/value edge is strong enough to keep this playable." };
    if (grade === "Watchlist") return { ...decision.resolvedMarketRead, copy: "Market resistance is present, but the model/value case is strong enough to keep this worth monitoring." };
    if (grade === "Caution") return { ...decision.resolvedMarketRead, copy: "Market resistance is present, and while there is a model/value case, the friction keeps this in caution territory." };
    if (grade === "No Play") return { ...decision.resolvedMarketRead, copy: "Market resistance is present, and the model/value case is not strong enough to make this actionable at the current number." };
    return { ...decision.resolvedMarketRead, copy: "Market resistance is present, but the model/value edge is strong enough to support the thesis." };
  }
  if (status === "resistance" || status === "consensus_resistance") {
    if (grade === "Lean" && edge < 3) return { ...decision.resolvedMarketRead, copy: "The model leans this way, but market resistance and a thin edge keep this value-capped." };
    return {
      ...decision.resolvedMarketRead,
      copy: grade === "No Play"
        ? "Market resistance is present, and the model/value case is not strong enough to make this actionable at the current number."
        : "Market resistance is present, so market friction remains in the read.",
    };
  }
  if (status === "mixed") {
    if (grade === "No Play") return { ...decision.resolvedMarketRead, copy: "Market signals are mixed, and the current model/value case is not strong enough to make this actionable." };
    if (grade === "Watchlist") return { ...decision.resolvedMarketRead, copy: "Market signals are mixed, but the price and model edge keep this worth monitoring." };
    if (grade === "Caution") return { ...decision.resolvedMarketRead, copy: "Market signals are mixed, and that friction keeps this in caution territory." };
    return { ...decision.resolvedMarketRead, copy: "Market signals are mixed, but the price and model edge keep this playable." };
  }
  if (status === "consensus_support") return grade === "No Play"
    ? { ...decision.resolvedMarketRead, copy: "Consensus Splits support the pick, but there is not enough actionable edge at the current number." }
    : { ...decision.resolvedMarketRead, copy: "Consensus Splits support the pick, while market confirmation remains measured." };
  if (status === "aligned" && sharp) return { ...decision.resolvedMarketRead, copy: "Model/value edge is strong, and visible market context supports the pick at a playable price." };
  if (status === "aligned") return { ...decision.resolvedMarketRead, copy: "Model/value evidence and visible market context are supportive at the current number." };
  if (status === "insufficient_data") return { ...decision.resolvedMarketRead, copy: "Core betting evidence is incomplete, so this should not look actionable." };
  return { ...decision.resolvedMarketRead, copy: "Market confirmation is not clear enough by itself, so the read leans on model edge, price, and line context." };
}

function decisionSupportingEvidenceCopy(decision: MarketDecision, key: keyof RecommendationDecision["markets"], sport = "mlb"): string {
  const caps = dailyEdgeMarketCapabilities(sport, key);
  const grade = decision.playGrade;
  const edge = decision.edgePp ?? 0;
  const displayedEdge = edgePctFromDecision(decision);
  if (caps.isFirstInning) {
    const pick = decision.pick ?? "FI";
    if (/toss/i.test(pick)) return "FI is Toss-Up, so there is no actionable YRFI/NRFI side yet. The model is not creating enough separation for a first-inning play.";
    if (grade === "No Play" && (decision.pick === null || decision.price === null || decision.modelProbability === null || decision.edgePp === null)) {
      return "FI remains No Play because current price/model context does not create an actionable YRFI/NRFI side.";
    }
    if (grade === "No Play") return `FI model probability is ${pctFromDecision(decision.modelProbability)} with about ${pctPointFromDecision(displayedEdge)} edge at ${priceFromDecision(decision.price)}. At this price, the FI edge is too thin to make ${pick} actionable.`;
    if (grade === "Lean") return `${pick} has ${pctFromDecision(decision.modelProbability)} FI model probability with about ${pctPointFromDecision(displayedEdge)} edge at ${priceFromDecision(decision.price)}; price keeps it below a stronger grade.`;
    if (grade === "Watchlist") return `${pick} is worth monitoring, but the FI edge is not strong enough for action yet.`;
    if (grade === "Caution") return `The FI read has a material price/context concern at ${priceFromDecision(decision.price)}, so this stays in Caution.`;
  }
  if (caps.isSoccerLike) {
    const soccerPick = soccerDecisionPickLabel(decision, key);
    const base = `${soccerPick} has ${pctFromDecision(decision.modelProbability)} model probability versus ${pctFromDecision(decision.marketImplied)} implied at ${priceFromDecision(decision.price)}, for about ${pctPointFromDecision(displayedEdge)} edge.`;
    const movement =
      decision.lineMovement === "support"
        ? " Odds movement is toward the pick."
        : decision.lineMovement === "resistance"
          ? " Odds movement is against the pick."
          : "";
    if (key === "total" && decision.projectedScore) {
      const projected = +(decision.projectedScore.away + decision.projectedScore.home).toFixed(1);
      return `${base} Projected goals are ${projected}.${movement} Price and edge decide whether this is actionable.`;
    }
    if (key === "moneyline") return `${base}${movement} Draw risk and price quality are the main soccer-specific checks.`;
    if (key === "firstInning") return `${base}${movement} BTTS reads depend on scoring context and price quality.`;
    return `${base}${movement} Price and edge decide whether this is actionable.`;
  }
  const base = `${decision.pick ?? "The pick"} has ${pctFromDecision(decision.modelProbability)} model probability versus ${pctFromDecision(decision.marketImplied)} implied at ${priceFromDecision(decision.price)}, for about ${pctPointFromDecision(displayedEdge)} edge.`;
  const splitConflict = decisionSplitConflictKind(decision);
  const sharpMoneyDivergence = decisionHasSharpMoneyDivergence(decision);
  if (splitConflict === "consensus_against_sharp_support") {
    const movement = decision.lineMovement === "support" ? " Odds movement also moved toward the pick." : "";
    return `${base} ${consensusAgainstPhrase(decision)}; ${sharpMoneySupportPhrase(decision).toLowerCase()}.${movement}`;
  }
  if (splitConflict === "consensus_support_sharp_against") {
    return `${base} Consensus Splits support the pick, but ${sharpAgainstPhrase(decision).toLowerCase()}.`;
  }
  if (sharpMoneyDivergence) {
    return `${base} ${consensusSupportPhrase(decision)}; ${sharpMoneySupportPhrase(decision).toLowerCase()}.${lineMovementSupportPhrase(decision)}`;
  }
  if (grade === "Caution") return `${base} Market friction is why this remains Caution.`;
  if (grade === "No Play") return `${base} The projection/model case is not strong enough to overcome the current number or market resistance.`;
  if (decision.lineMovement === "resistance") return `${base} Odds movement is against the pick, so the support is not fully clean.`;
  if (grade === "Watchlist") return `${base} This keeps the prediction worth monitoring, not automatically actionable.`;
  if (grade === "Lean" && edge < 3) return `${base} The edge is thin, so this should stay value-capped rather than treated as a stronger play.`;
  return base;
}

export function applyDailyEdgeRenderedCopyFlags(
  decision: RecommendationDecision,
  overrides: DailyEdgeRenderedCopyFlagOverrides | null = null,
): RecommendationDecision {
  const quickReadEnabled = overrides?.quickRead ?? envFlag("DAILY_EDGE_RENDERED_QUICK_READ_ENABLED");
  const marketReadEnabled = overrides?.marketRead ?? envFlag("DAILY_EDGE_RENDERED_MARKET_READ_ENABLED");
  const supportingEnabled = overrides?.supportingEvidence ?? envFlag("DAILY_EDGE_RENDERED_SUPPORTING_EVIDENCE_ENABLED");
  const riskEnabled = overrides?.risk ?? envFlag("DAILY_EDGE_RENDERED_RISK_COPY_ENABLED");
  if (!quickReadEnabled && !marketReadEnabled && !supportingEnabled && !riskEnabled) return decision;

  const next: RecommendationDecision = {
    ...decision,
    markets: { ...decision.markets },
  };
  for (const key of Object.keys(next.markets) as Array<keyof RecommendationDecision["markets"]>) {
    const market = next.markets[key];
    if (!market) continue;
    next.markets[key] = {
      ...market,
      quickRead: quickReadEnabled ? decisionQuickReadCopy(market, key, decision.sport) : market.quickRead,
      resolvedMarketRead: marketReadEnabled
        ? (() => {
            const read = decisionMarketRead(market, key, decision.sport);
            return {
              ...read,
              copy: sanitizeMemberCopy(read.copy, "Market context and model/value evidence set the current read."),
            };
          })()
        : market.resolvedMarketRead,
      supportingEvidence: supportingEnabled
        ? market.supportingEvidence.map((item) => item === market.resolvedMarketRead.copy ? decisionSupportingEvidenceCopy(market, key, decision.sport) : item)
        : market.supportingEvidence,
      renderedQuickReadCopy: quickReadEnabled ? sanitizeMemberCopy(decisionQuickReadCopy(market, key, decision.sport), "Model, price, and market context set the current grade.") : market.renderedQuickReadCopy ?? null,
      renderedSupportingEvidenceCopy: supportingEnabled ? sanitizeMemberCopy(decisionSupportingEvidenceCopy(market, key, decision.sport), "Model probability, implied price, and market context explain the current grade.") : market.renderedSupportingEvidenceCopy ?? null,
      renderedRiskCopy: riskEnabled ? market.riskNote : market.renderedRiskCopy ?? null,
      riskNote: riskEnabled ? market.riskNote : market.riskNote,
    };
  }
  return next;
}
