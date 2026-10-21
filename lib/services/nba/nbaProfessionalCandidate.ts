import { buildNbaMarketConsensus, type NbaBookLine } from "../../automodel/nba/nbaMarketConsensus";
import { computeNbaMarketProbabilities } from "../../automodel/nba/nbaDistribution";
import {
  scoreNbaPortableModel,
  type NbaPortableFeatureRow,
  type NbaPortableModelArtifact,
  type NbaPortableScore,
} from "../../automodel/nba/nbaPortableScoreModel";
import { buildNbaUnifiedFinalProjection } from "../../automodel/nba/nbaUnifiedFinalProjection";
import type { NbaModelV1Output } from "../../automodel/nba/nbaAutoModelV2";
import type { NbaLineRow } from "./nbaMarketIntelligence";
import {
  selectNbaConsensusOpeningSpread,
  type NbaMovementHistoryRow,
} from "./nbaSameBookMovement";
import type { NbaProfessionalMarketReader } from "./nbaProfessionalMarketReader";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Convert the categorical reader into the one bounded point-projection input.
 * Two persistent same-direction number trails, including a named book, must
 * each clear the historically selected two-point threshold. Price-only or
 * split-only evidence can never move the score.
 */
export function selectNbaQualifiedSpreadRead(
  reader: NbaProfessionalMarketReader | null | undefined,
): { side: "home" | "away"; magnitudePoints: number } | null {
  const read = reader?.reads.spread;
  if (
    reader?.evidenceStatus !== "complete" ||
    read?.status !== "qualified" ||
    (read.side !== "home" && read.side !== "away")
  ) return null;
  const supporting = read.trails.filter((trail) =>
    trail.direction === read.side &&
    trail.numberDirection === read.side &&
    trail.numberDelta !== null &&
    Math.abs(trail.numberDelta) >= 2 &&
    trail.persistenceTimeShare >= 2 / 3
  );
  if (supporting.length < 2 || !supporting.some((trail) => trail.sourceClass === "named")) return null;
  const magnitudePoints = median(supporting.map((trail) => Math.abs(trail.numberDelta!)));
  return magnitudePoints === null ? null : { side: read.side, magnitudePoints };
}

/**
 * Promote only the historical Total failure mode that repeated across both
 * seasons: two persistent named-book number trails, each five points or more.
 * A smaller move, a retail trail, price-only evidence, or incomplete reader
 * state remains observational and cannot alter the score.
 */
export function selectNbaQualifiedTotalRead(
  reader: NbaProfessionalMarketReader | null | undefined,
): { side: "over" | "under"; magnitudePoints: number } | null {
  const read = reader?.reads.total;
  if (
    reader?.evidenceStatus !== "complete" ||
    read?.status !== "qualified" ||
    (read.side !== "over" && read.side !== "under")
  ) return null;
  const supporting = read.trails.filter((trail) =>
    trail.sourceClass === "named" &&
    trail.direction === read.side &&
    trail.numberDirection === read.side &&
    trail.numberDelta !== null &&
    Math.abs(trail.numberDelta) >= 5 &&
    trail.persistenceTimeShare >= 2 / 3
  );
  if (supporting.length < 2) return null;
  const magnitudePoints = median(supporting.map((trail) => Math.abs(trail.numberDelta!)));
  return magnitudePoints === null ? null : { side: read.side, magnitudePoints };
}

/**
 * Pure assembly of the professional NBA candidate. One final margin/total pair
 * owns the representative score and all three market directions.
 */
export function buildNbaProfessionalCandidate(args: {
  artifact: NbaPortableModelArtifact;
  featureRow: NbaPortableFeatureRow;
  lines: readonly NbaLineRow[];
  history: readonly NbaMovementHistoryRow[];
  externalGameId: number;
  marketReader?: NbaProfessionalMarketReader | null;
  independentOverride?: NbaPortableScore;
}) {
  if (!args.artifact.distribution) {
    throw new Error("NBA professional candidate requires calibrated residual distribution state.");
  }
  const independent = args.independentOverride ?? scoreNbaPortableModel(args.artifact, args.featureRow);
  const consensus = buildNbaMarketConsensus(args.lines
    .filter((line) => line.side !== null && ["moneyline", "spread", "total"].includes(line.market_type))
    .map((line): NbaBookLine => ({
      sportsbook: line.sportsbook,
      market_type: line.market_type as NbaBookLine["market_type"],
      side: line.side!,
      line_value: line.line_value,
      odds_american: line.odds_american,
    })));
  const currentObservedAt = args.lines
    .map((line) => line.fetched_at)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;
  const openingSpread = selectNbaConsensusOpeningSpread({
    rows: args.history,
    externalGameId: args.externalGameId,
    acceptedSportsbooks: consensus.spreadAcceptedBooks,
    currentObservedAt,
  });
  const qualifiedSpreadRead = selectNbaQualifiedSpreadRead(args.marketReader);
  const qualifiedTotalRead = selectNbaQualifiedTotalRead(args.marketReader);
  const final = buildNbaUnifiedFinalProjection({
    independentHomeScore: independent.homeScore,
    independentAwayScore: independent.awayScore,
    currentSpreadHome: consensus.spreadHome,
    currentTotal: consensus.totalLine,
    openingSpreadHome: openingSpread?.spreadHome ?? null,
    qualifiedSpreadRead,
    qualifiedTotalRead,
  });
  const probabilities = computeNbaMarketProbabilities({
    projected_home_margin: final.marginHome,
    projected_total: final.total,
    market_spread_home: consensus.spreadHome,
    market_total: consensus.totalLine,
    margin_sd_base: args.artifact.distribution.marginSigma,
    total_sd_base: args.artifact.distribution.totalSigma,
    margin_residual_mixture: args.artifact.distribution.marginCalibration === undefined
      ? undefined
      : {
          core_sigma_multiplier: args.artifact.distribution.marginCalibration.coreSigmaMultiplier,
          tail_weight: args.artifact.distribution.marginCalibration.tailWeight,
          tail_sigma_multiplier: args.artifact.distribution.marginCalibration.tailSigmaMultiplier,
        },
  });
  const independentPicks = {
    moneyline: independent.marginHome >= 0 ? "home" as const : "away" as const,
    spread: consensus.spreadHome === null
      ? null
      : independent.marginHome + consensus.spreadHome >= 0 ? "home" as const : "away" as const,
    total: consensus.totalLine === null
      ? null
      : independent.total - consensus.totalLine >= 0 ? "over" as const : "under" as const,
  };
  const picks = {
    moneyline: final.marginHome >= 0 ? "home" as const : "away" as const,
    spread: probabilities.spread_home_cover_prob === null
      ? null
      : probabilities.spread_home_cover_prob >= 0.5 ? "home" as const : "away" as const,
    total: probabilities.total_over_prob === null
      ? null
      : probabilities.total_over_prob >= 0.5 ? "over" as const : "under" as const,
  };
  return {
    modelRelease: args.artifact.release,
    probabilityCalibration: args.artifact.distribution.marginCalibration ?? {
      release: "legacy_normal_residual",
      family: "normal_residual" as const,
    },
    independent,
    consensus,
    openingSpread,
    marketReader: args.marketReader ?? null,
    final,
    probabilities,
    picks,
    readerDecisionAudit: {
      independentPicks,
      finalPicks: picks,
      spreadReadQualified: final.movementQualified,
      spreadCorrectionApplied: final.movementApplied,
      totalReadQualified: final.totalMovementQualified,
      totalCorrectionApplied: final.totalMovementApplied,
      spreadMagnitudePoints: qualifiedSpreadRead?.magnitudePoints ?? null,
      totalMagnitudePoints: qualifiedTotalRead?.magnitudePoints ?? null,
      effects: {
        moneyline: independentPicks.moneyline !== picks.moneyline
          ? "flipped_by_validated_spread_score" as const
          : "unchanged_no_direct_moneyline_authority" as const,
        spread: independentPicks.spread !== picks.spread
          ? "flipped_by_validated_spread_read" as const
          : final.movementQualified
            ? "confirmed_by_validated_spread_read" as const
            : "unchanged_no_qualified_spread_read" as const,
        total: independentPicks.total !== picks.total
          ? "flipped_by_validated_total_read" as const
          : final.totalMovementQualified
            ? "confirmed_by_validated_total_read" as const
            : "unchanged_no_qualified_total_read" as const,
      },
    },
  };
}

function pickConfidence(probability: number): number {
  return Math.round(Math.max(probability, 1 - probability) * 1_000) / 10;
}

/**
 * Translate the coherent candidate into the existing DTO prediction contract.
 * Downstream price selection and grades therefore consume the exact same final
 * score and calibrated residual distribution instead of the legacy formula.
 */
export function applyNbaProfessionalCandidate(args: {
  baseline: NbaModelV1Output;
  candidate: ReturnType<typeof buildNbaProfessionalCandidate>;
  /** Same-input audit hook for the superseded count-only injury cap. */
  retainLegacyInjuryCap?: boolean;
}): NbaModelV1Output {
  const { baseline, candidate, retainLegacyInjuryCap = false } = args;
  // The professional model cannot treat every listed player as the same
  // basketball impact. Keep exact availability evidence, but retire the
  // legacy count-only cap. Missing-source risk still flows through the
  // model's data-quality tier; price/coverage caps remain untouched.
  const professionalCaps = retainLegacyInjuryCap
    ? baseline.v1_breakdown.applied_caps
    : baseline.v1_breakdown.applied_caps.filter((entry) => entry.source !== "injury");
  const professionalAvailabilityReasons = retainLegacyInjuryCap ? [] : [
    baseline.v1_breakdown.injury_review.major_out_count > 0
      ? `${baseline.v1_breakdown.injury_review.major_out_count} verified OUT player(s); no count-only professional confidence cap applied.`
      : null,
    baseline.v1_breakdown.injury_review.major_unknown_count > 0
      ? `${baseline.v1_breakdown.injury_review.major_unknown_count} unresolved player status(es); availability remains explicit data-quality context.`
      : null,
  ].filter((reason): reason is string => reason !== null);
  const nonLegacyCapNotes = retainLegacyInjuryCap
    ? baseline.audit.model_integrity_notes
    : baseline.audit.model_integrity_notes.filter((note) => !note.includes("confidence capped"));
  const mlHome = candidate.probabilities.ml_home_win_prob;
  const spreadHome = candidate.probabilities.spread_home_cover_prob;
  const totalOver = candidate.probabilities.total_over_prob;
  const mlPick = candidate.picks.moneyline;
  const spreadPick = candidate.picks.spread ?? baseline.predicted_spread_side;
  const totalPick = candidate.picks.total ?? baseline.predicted_total_side;
  return {
    ...baseline,
    predicted_home_score: candidate.final.homeScore,
    predicted_away_score: candidate.final.awayScore,
    predicted_total: candidate.final.total,
    predicted_spread_home: candidate.final.marginHome,
    predicted_ml_winner: mlPick,
    ml_confidence: pickConfidence(mlHome),
    predicted_spread_side: spreadPick,
    spread_confidence: spreadHome === null ? baseline.spread_confidence : pickConfidence(spreadHome),
    predicted_total_side: totalPick,
    total_confidence: totalOver === null ? baseline.total_confidence : pickConfidence(totalOver),
    audit: {
      ...baseline.audit,
      independent_home_score: candidate.independent.homeScore,
      independent_away_score: candidate.independent.awayScore,
      independent_home_sd: candidate.probabilities.margin_sd_used,
      independent_away_sd: candidate.probabilities.margin_sd_used,
      market_total: candidate.consensus.totalLine,
      market_spread_home: candidate.consensus.spreadHome,
      market_home_ml_no_vig: candidate.consensus.mlHomeNoVig,
      market_away_ml_no_vig: candidate.consensus.mlHomeNoVig === null
        ? null
        : 1 - candidate.consensus.mlHomeNoVig,
      market_baseline_valid: candidate.consensus.spreadHome !== null ||
        candidate.consensus.totalLine !== null || candidate.consensus.mlHomeNoVig !== null,
      posterior_home_score: candidate.final.homeScore,
      posterior_away_score: candidate.final.awayScore,
      posterior_total: candidate.final.total,
      posterior_spread_home: candidate.final.marginHome,
      trust_independent: 1,
      ml_pick: mlPick,
      ml_confidence: pickConfidence(mlHome),
      spread_pick: spreadPick,
      spread_confidence: spreadHome === null ? baseline.spread_confidence : pickConfidence(spreadHome),
      total_pick: totalPick,
      total_confidence: totalOver === null ? baseline.total_confidence : pickConfidence(totalOver),
      professional_grade_context: {
        spread: {
          readQualified: candidate.final.movementQualified,
          correctionApplied: candidate.final.movementApplied,
          magnitudePoints: candidate.readerDecisionAudit.spreadMagnitudePoints,
        },
        total: {
          readQualified: candidate.final.totalMovementQualified,
          correctionApplied: candidate.final.totalMovementApplied,
          magnitudePoints: candidate.readerDecisionAudit.totalMagnitudePoints,
        },
      },
      model_integrity_notes: [
        ...nonLegacyCapNotes,
        ...professionalAvailabilityReasons,
        `Professional independent release: ${candidate.modelRelease}.`,
        `Unified projection release: ${candidate.final.release}.`,
        candidate.final.movementApplied
          ? "Qualified target-excluded categorical Spread reader changed the final margin; no consensus weight was applied."
          : "Independent score remained authoritative; no categorical Spread correction was applied.",
        candidate.final.totalMovementApplied
          ? "Qualified target-excluded categorical Total disagreement changed the final total; no consensus weight was applied."
          : "Independent total remained authoritative; no categorical Total correction was applied.",
      ],
    },
    v1_probabilities: candidate.probabilities,
    v1_breakdown: {
      ...baseline.v1_breakdown,
      injury_review: {
        ...baseline.v1_breakdown.injury_review,
        confidence_cap: retainLegacyInjuryCap
          ? baseline.v1_breakdown.injury_review.confidence_cap
          : null,
        reasons: retainLegacyInjuryCap
          ? baseline.v1_breakdown.injury_review.reasons
          : [
              ...baseline.v1_breakdown.injury_review.reasons.filter(
                (reason) => !reason.includes("confidence capped"),
              ),
              ...professionalAvailabilityReasons,
            ],
      },
      applied_caps: professionalCaps,
      notes: [
        ...(retainLegacyInjuryCap
          ? baseline.v1_breakdown.notes
          : [
              ...baseline.v1_breakdown.notes.filter((note) => !note.includes("confidence capped")),
              ...professionalAvailabilityReasons,
            ]),
        "Professional point-in-time scorer and independent-first categorical market reader applied.",
      ],
    },
  };
}
