import { marketBrainSha256 } from "./marketBrainCanonical";

import type { NflMarketBrainResearchEvaluation } from "./nflMarketBrainResearchEvaluator";
import {
  nflMarketBrainTrainerInput,
  vectorizeNflMarketBrainTrainerInput,
  type NflMarketBrainResolverFeatures,
} from "./nflMarketBrainResolverFeatures";
import type { NflMarketBrainResolverShadowOutput } from "./nflMarketBrainResolverContract";
import {
  assertNflMarketBrainSequence,
  type NflMarketBrainSequence,
} from "./nflMarketBrainSequenceMaterializer";

export const NFL_MARKET_BRAIN_CASE_AUDIT_RELEASE =
  "nfl_market_brain_case_audit_2026_10_27_r5_source_row_participant_binding" as const;

/**
 * Complete normalized, read-only dossier for human and external review of a
 * real market tape. Raw provider bodies are not retained; source manifests
 * expose their digests and row accounting. The dossier never assigns a market
 * verdict, weight, threshold, pick, grade, or stake.
 */
export function buildNflMarketBrainCaseAudit(args: {
  sequence: NflMarketBrainSequence;
  features: NflMarketBrainResolverFeatures;
  candidate?: NflMarketBrainResolverShadowOutput;
  evaluation?: NflMarketBrainResearchEvaluation;
}) {
  assertNflMarketBrainSequence(args.sequence);
  if (args.features.inputSequenceChecksum !== args.sequence.checksum ||
    args.features.eventId !== args.sequence.eventId) {
    throw new Error("NFL Market Brain case audit requires features rebuilt from the exact sequence.");
  }
  if (args.candidate && (args.candidate.sequenceChecksum !== args.sequence.checksum ||
    args.candidate.featureChecksum !== args.features.checksum)) {
    throw new Error("NFL Market Brain case audit candidate does not belong to the exact tape.");
  }
  if (args.evaluation && (args.evaluation.sequenceChecksum !== args.sequence.checksum ||
    args.evaluation.eventId !== args.sequence.eventId)) {
    throw new Error("NFL Market Brain case audit evaluation does not belong to the exact tape.");
  }
  const consumedFeatureVector = vectorizeNflMarketBrainTrainerInput(nflMarketBrainTrainerInput(args.features));

  const timeline = args.sequence.quotePaths.flatMap((path) => path.points.map((point, index) => ({
    observedAt: point.observedAt,
    availableAt: point.availableAt,
    market: path.market,
    provider: path.provider,
    sportsbook: path.participant,
    sourcePrior: path.sourcePrior,
    learnedRole: path.observedRole,
    pathPoint: index + 1,
    pathPoints: path.points.length,
    line: point.line,
    firstPrice: point.firstPrice,
    secondPrice: point.secondPrice,
    firstFairProbability: point.firstFairProbability,
    hold: point.hold,
    phase: point.phase,
  }))).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
    Date.parse(a.availableAt) - Date.parse(b.availableAt) || a.market.localeCompare(b.market) ||
    a.sportsbook.localeCompare(b.sportsbook));

  const splitEvidence = args.sequence.observations.flatMap((row) => {
    const observation = row.observation;
    if (observation.modality !== "identified_book_split") return [];
    const imbalance = observation.values.first_money_minus_bets_pp;
    return [{
      market: observation.market,
      sportsbook: observation.source.participant,
      provider: observation.source.provider,
      availability: observation.availability,
      targetRelation: observation.targetRelation,
      eligible: row.eligible,
      exclusionReasons: [...row.exclusionReasons],
      availableAt: observation.timing.availableAt,
      moneyMinusBetsPercentagePoints:
        imbalance?.observed === 1 ? imbalance.value : null,
    }];
  }).sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt) ||
    (a.sportsbook ?? "").localeCompare(b.sportsbook ?? ""));

  const contextualEvents = args.sequence.observations.flatMap((row) => {
    const observation = row.observation;
    if (["price_quote", "identified_book_split", "public_split", "model_prior"].includes(
      observation.modality)) return [];
    return [{
      availableAt: observation.timing.availableAt,
      market: observation.market,
      modality: observation.modality,
      provider: observation.source.provider,
      feed: observation.source.feed,
      participant: observation.source.participant,
      availability: observation.availability,
      eligible: row.eligible,
      exclusionReasons: [...row.exclusionReasons],
      values: structuredClone(observation.values),
      categorical: structuredClone(observation.categorical),
    }];
  }).sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt));

  const withoutChecksum = {
    release: NFL_MARKET_BRAIN_CASE_AUDIT_RELEASE,
    eventId: args.sequence.eventId,
    startsAt: args.sequence.startsAt,
    cutoffAt: args.sequence.cutoffAt,
    captureMembership: structuredClone(args.sequence.captureMembership),
    sequenceChecksum: args.sequence.checksum,
    featureChecksum: args.features.checksum,
    independentPrior: structuredClone(args.features.independentPrior),
    releasedSemanticReader: structuredClone(args.sequence.incumbentComparator),
    evaluationEnvelope: structuredClone(args.sequence.evaluationEnvelope),
    crossMarket: structuredClone(args.sequence.crossMarket),
    sourceAvailability: structuredClone(args.sequence.sourceAvailability),
    accounting: structuredClone(args.sequence.accounting),
    timeline,
    splitEvidence,
    contextualEvents,
    observationLedger: args.sequence.observations.map((row) => ({
      eligible: row.eligible,
      exclusionReasons: [...row.exclusionReasons],
      observation: structuredClone(row.observation),
    })).sort((a, b) => Date.parse(a.observation.timing.availableAt) -
      Date.parse(b.observation.timing.availableAt) || a.observation.id.localeCompare(b.observation.id)),
    sourceManifests: structuredClone(args.sequence.sourceManifests),
    consumedFeatureVector: {
      release: args.features.release,
      names: [...consumedFeatureVector.names],
      values: [...consumedFeatureVector.values],
      quotePathTokens: structuredClone(args.features.quotePathTokens),
      contextTokens: structuredClone(args.features.contextTokens),
      expectedInputTokens: structuredClone(args.features.expectedInputTokens),
    },
    excludedEvidence: args.sequence.observations.filter((row) => !row.eligible).map((row) => ({
      observationId: row.observation.id,
      modality: row.observation.modality,
      market: row.observation.market,
      provider: row.observation.source.provider,
      participant: row.observation.source.participant,
      availableAt: row.observation.timing.availableAt,
      reasons: [...row.exclusionReasons],
    })),
    expectedInputs: args.sequence.expectedInputs.map((row) => ({
      ...structuredClone(row.input),
      capturedAt: row.capturedAt,
      eligible: row.eligible,
      exclusionReasons: [...row.exclusionReasons],
    })),
    candidateConsequence: args.candidate ? {
      release: args.candidate.release,
      artifactSha256: args.candidate.artifactSha256,
      inferredAt: args.candidate.inferredAt,
      priorMarginMean: args.candidate.posteriorRelationship.priorMarginMean,
      posteriorMarginMean: args.candidate.posteriorRelationship.posteriorMarginMean,
      marginShift: args.candidate.posteriorRelationship.marginShift,
      priorTotalMean: args.candidate.posteriorRelationship.priorTotalMean,
      posteriorTotalMean: args.candidate.posteriorRelationship.posteriorTotalMean,
      totalShift: args.candidate.posteriorRelationship.totalShift,
      winnerBoundaryCrossed: args.candidate.posteriorRelationship.winnerBoundaryCrossed,
      posteriorSha256: args.candidate.posterior.sha256,
    } : null,
    postgameEvaluation: args.evaluation ? {
      partitionRole: args.evaluation.partitionRole,
      foldId: args.evaluation.foldId,
      actual: args.evaluation.actual,
      deltas: args.evaluation.deltas,
      incumbentDeltas: args.evaluation.incumbentDeltas,
      disagreement: args.evaluation.disagreement,
    } : null,
    invariants: {
      chronologicalFactsOnly: true as const,
      normalizedObservationLedgerComplete: true as const,
      rawProviderBodiesRetained: false as const,
      manualVerdictAssigned: false as const,
      manualSportsbookWeightAssigned: false as const,
      predictionGradeOrStakeAuthority: false as const,
    },
  };
  return { ...withoutChecksum, checksum: marketBrainSha256(withoutChecksum) };
}
