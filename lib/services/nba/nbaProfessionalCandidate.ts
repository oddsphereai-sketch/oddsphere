import { buildNbaMarketConsensus, type NbaBookLine } from "../../automodel/nba/nbaMarketConsensus";
import { computeNbaMarketProbabilities } from "../../automodel/nba/nbaDistribution";
import {
  scoreNbaPortableModel,
  type NbaPortableFeatureRow,
  type NbaPortableModelArtifact,
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
}) {
  if (!args.artifact.distribution) {
    throw new Error("NBA professional candidate requires calibrated residual distribution state.");
  }
  const independent = scoreNbaPortableModel(args.artifact, args.featureRow);
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
  const final = buildNbaUnifiedFinalProjection({
    independentHomeScore: independent.homeScore,
    independentAwayScore: independent.awayScore,
    currentSpreadHome: consensus.spreadHome,
    currentTotal: consensus.totalLine,
    openingSpreadHome: openingSpread?.spreadHome ?? null,
    qualifiedSpreadRead: selectNbaQualifiedSpreadRead(args.marketReader),
  });
  const probabilities = computeNbaMarketProbabilities({
    projected_home_margin: final.marginHome,
    projected_total: final.total,
    market_spread_home: consensus.spreadHome,
    market_total: consensus.totalLine,
    margin_sd_base: args.artifact.distribution.marginSigma,
    total_sd_base: args.artifact.distribution.totalSigma,
  });
  return {
    modelRelease: args.artifact.release,
    independent,
    consensus,
    openingSpread,
    marketReader: args.marketReader ?? null,
    final,
    probabilities,
    picks: {
      moneyline: final.marginHome >= 0 ? "home" as const : "away" as const,
      spread: probabilities.spread_home_cover_prob === null
        ? null
        : probabilities.spread_home_cover_prob >= 0.5 ? "home" as const : "away" as const,
      total: probabilities.total_over_prob === null
        ? null
        : probabilities.total_over_prob >= 0.5 ? "over" as const : "under" as const,
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
}): NbaModelV1Output {
  const { baseline, candidate } = args;
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
      model_integrity_notes: [
        ...baseline.audit.model_integrity_notes,
        `Professional independent release: ${candidate.modelRelease}.`,
        `Unified projection release: ${candidate.final.release}.`,
        candidate.final.movementApplied
          ? "Qualified target-excluded categorical Spread reader changed the final margin; no consensus weight was applied."
          : "Independent score remained authoritative; no categorical Spread correction was applied.",
      ],
    },
    v1_probabilities: candidate.probabilities,
    v1_breakdown: {
      ...baseline.v1_breakdown,
      notes: [
        ...baseline.v1_breakdown.notes,
        "Professional point-in-time scorer and independent-first categorical market reader applied.",
      ],
    },
  };
}
