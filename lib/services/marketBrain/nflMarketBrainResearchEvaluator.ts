import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MARKET_BRAIN_CANONICAL_JSON_RELEASE,
  marketBrainCanonicalJson,
  marketBrainSha256,
} from "./marketBrainCanonical";

import type { MarketBrainDiscreteDistribution } from "./marketBrainContract";
import {
  NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE,
  type NflMarketBrainSequence,
} from "./nflMarketBrainSequenceMaterializer";

export const NFL_MARKET_BRAIN_RESEARCH_EVALUATOR_RELEASE =
  "nfl_market_brain_research_evaluator_2026_10_27_r12_nfl_source_bound_outcome" as const;
export const NFL_MARKET_BRAIN_RESEARCH_MANIFEST_RELEASE =
  "nfl_market_brain_research_manifest_2026_10_27_r5_planned_attempt_windows" as const;

export type NflMarketBrainResearchPrediction = {
  eventId: string;
  cutoffAt: string;
  startsAt: string;
  release: string;
  trainedThrough: string;
  inferredAt: string;
  resolverOutputChecksum: string;
  researchInputRecordId: string;
  researchInputChecksum: string;
  captureSetChecksum: string;
  artifactSha256: string;
  tournamentChecksum: string;
  family: "regularized_joint_residual";
  featureRelease: string;
  featureChecksum: string;
  trainingManifestChecksum: string;
  weightsSha256: string;
  fittedParameterCount: number;
  sequenceChecksum: string;
  awayWinProbability: number;
  homeWinProbability: number;
  tieProbability: number;
  marginMean: number;
  totalMean: number;
  marginDistribution: MarketBrainDiscreteDistribution;
  totalDistribution: MarketBrainDiscreteDistribution;
  jointScoreStates: Array<{ margin: number; total: number; probability: number }>;
  jointPosteriorSha256: string;
  zeroMarketPosterior: {
    awayWinProbability: number;
    homeWinProbability: number;
    tieProbability: number;
    marginMean: number;
    totalMean: number;
    marginDistribution: MarketBrainDiscreteDistribution;
    totalDistribution: MarketBrainDiscreteDistribution;
    jointScoreStates: Array<{ margin: number; total: number; probability: number }>;
    jointPosteriorSha256: string;
  };
};

const persistedPredictionBrand: unique symbol = Symbol("persistedNflMarketBrainResearchPrediction");
export type NflMarketBrainAttestedResearchPrediction = NflMarketBrainResearchPrediction & {
  readonly persistenceAttestation: {
    recordId: string;
    serverCreatedAt: string;
    predictionSha256: string;
  };
  readonly [persistedPredictionBrand]: true;
};

export type NflMarketBrainFinalOutcome = {
  eventId: string;
  finalAt: string;
  awayScore: number;
  homeScore: number;
  source: {
    table: "games";
    gameRecordId: string;
    providerIds: unknown;
    sourceUpdatedAt: string;
    sourceRowSha256: string;
  };
  checksum: string;
};

export type NflMarketBrainAttestedFinalOutcome = NflMarketBrainFinalOutcome & {
  readonly persistenceAttestation: {
    recordId: string;
    serverCreatedAt: string;
    outcomeChecksum: string;
  };
};

const attestedFinalOutcomes = new WeakSet<object>();

type Winner = "away" | "home" | "tie";
type Metrics = {
  multiclassBrier: number;
  logLoss: number;
  marginDistributionLogLoss: number;
  totalDistributionLogLoss: number;
  marginTotalDistributionLogScore: number | null;
  marginalCompositeLogScore: number;
  marginAbsoluteError: number;
  totalAbsoluteError: number;
  winnerCorrect: boolean;
  exactLines: Partial<Record<"moneyline" | "spread" | "total", {
    selection: "away" | "home" | "over" | "under";
    line: number | null;
    price: number;
    winProbability: number;
    pushProbability: number;
    result: "win" | "loss" | "push";
    units: number;
  }>>;
};

export type NflMarketBrainResearchEvaluation = {
  release: typeof NFL_MARKET_BRAIN_RESEARCH_EVALUATOR_RELEASE;
  eventId: string;
  sequenceRelease: typeof NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE;
  sequenceChecksum: string;
  candidateRelease: string;
  candidateArtifactSha256: string;
  candidateTrainingManifestChecksum: string;
  candidateWeightsSha256: string;
  candidateTournamentChecksum: string;
  candidateFeatureChecksum: string;
  candidateInferredAt: string;
  researchManifestChecksum: string;
  partitionRole: NflMarketBrainResearchPartition["role"];
  foldId: string;
  baselineRelease: string;
  incumbentReleases: {
    model: string | null;
    calibration: string | null;
    decision: string | null;
  };
  cutoffAt: string;
  startsAt: string;
  finalAt: string;
  actual: { winner: Winner; margin: number; total: number };
  baseline: Metrics;
  zeroMarket: Metrics;
  incumbent: Metrics;
  candidate: Metrics;
  deltas: {
    brierImprovement: number;
    logLossImprovement: number;
    marginMaeImprovement: number;
    totalMaeImprovement: number;
    marginTotalDistributionLogScoreImprovement: number | null;
  };
  incumbentDeltas: {
    brierImprovement: number;
    logLossImprovement: number;
    marginMaeImprovement: number;
    totalMaeImprovement: number;
  };
  zeroMarketDeltas: {
    brierImprovement: number;
    logLossImprovement: number;
    marginMaeImprovement: number;
    totalMaeImprovement: number;
  };
  disagreement: "correction" | "harm" | "changed_both_wrong" | "unchanged";
  invariants: {
    outcomeAppliedAfterCutoff: true;
    baselineReadFromImmutablePriorArtifact: true;
    releasePure: true;
    productionInfluenceAllowed: false;
  };
};

export function evaluateNflMarketBrainResearchCase(args: {
  sequence: NflMarketBrainSequence;
  candidate: NflMarketBrainAttestedResearchPrediction;
  outcome: NflMarketBrainAttestedFinalOutcome;
  researchManifest: NflMarketBrainAttestedResearchManifest;
  partitionRole: Exclude<NflMarketBrainResearchPartition["role"], "development">;
}): NflMarketBrainResearchEvaluation {
  const { sequence, candidate, outcome } = args;
  assertNflMarketBrainAttestedResearchManifest(args.researchManifest);
  assertNflMarketBrainAttestedResearchPrediction(candidate);
  assertNflMarketBrainAttestedFinalOutcome(outcome);
  if (candidate.trainingManifestChecksum !== args.researchManifest.checksum ||
    candidate.release !== args.researchManifest.candidateRelease) {
    throw new Error("NFL Market Brain prediction is not bound to the persisted research manifest.");
  }
  const partition = args.researchManifest.partitions.find((row) => row.role === args.partitionRole);
  const manifestEvent = partition?.events.find((event) => event.eventId === sequence.eventId);
  if (!partition || !manifestEvent) {
    throw new Error("NFL Market Brain evaluated event is absent from its declared manifest partition.");
  }
  if (manifestEvent.startsAt !== sequence.startsAt || manifestEvent.cutoffAt !== sequence.cutoffAt ||
    requiredTimestamp(sequence.captureWindow.firstCapturedAt, "sequence.firstCapturedAt") <
      requiredTimestamp(manifestEvent.captureWindowOpensAt, "manifest.captureWindowOpensAt") ||
    requiredTimestamp(sequence.captureWindow.lastCapturedAt, "sequence.lastCapturedAt") >
      requiredTimestamp(manifestEvent.captureWindowClosesAt, "manifest.captureWindowClosesAt")) {
    throw new Error("NFL Market Brain sequence falls outside its precommitted planned capture window.");
  }
  if (manifestEvent.outcomeOpenedAt !== null) {
    throw new Error("NFL Market Brain untouched evaluation partition contains opened outcome evidence.");
  }
  if (sequence.release !== NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE) {
    throw new Error("NFL Market Brain evaluator refuses a superseded sequence release.");
  }
  if (sequence.eventId !== outcome.eventId || candidate.eventId !== sequence.eventId ||
    candidate.cutoffAt !== sequence.cutoffAt || candidate.startsAt !== sequence.startsAt) {
    throw new Error("NFL Market Brain evaluation event identity mismatch.");
  }
  if (candidate.sequenceChecksum !== sequence.checksum) {
    throw new Error("NFL Market Brain candidate was not produced from this immutable sequence.");
  }
  if (!candidate.release.trim()) throw new Error("NFL Market Brain candidate release is required.");
  const cutoff = requiredTimestamp(sequence.cutoffAt, "cutoffAt");
  const starts = requiredTimestamp(sequence.startsAt, "startsAt");
  const trainedThrough = requiredTimestamp(candidate.trainedThrough, "trainedThrough");
  const inferredAt = requiredTimestamp(candidate.inferredAt, "inferredAt");
  const finalAt = requiredTimestamp(outcome.finalAt, "finalAt");
  if (cutoff >= starts) throw new Error("NFL Market Brain cutoff must precede kickoff.");
  if (trainedThrough >= cutoff || trainedThrough >= starts) {
    throw new Error("NFL Market Brain candidate training boundary reaches the evaluated case.");
  }
  if (finalAt <= cutoff || finalAt <= starts) {
    throw new Error("NFL Market Brain outcome was not available strictly after cutoff and game start.");
  }
  if (inferredAt < cutoff || inferredAt >= starts || inferredAt >= finalAt) {
    throw new Error("NFL Market Brain prediction was not precommitted after cutoff and before kickoff/outcome.");
  }
  assertPredictionIdentity(candidate);
  if (![outcome.awayScore, outcome.homeScore].every((value) => Number.isInteger(value) && value >= 0)) {
    throw new Error("NFL Market Brain final score is invalid.");
  }
  if (sequence.prior.kind !== "margin_total_distribution") {
    throw new Error("NFL Market Brain evaluator requires an exact margin/total prior artifact.");
  }
  if (!sequence.incumbentComparator) {
    throw new Error("NFL Market Brain evaluator requires the released semantic reader at the identical cutoff.");
  }
  const baselineProbabilities = winnerProbabilities(sequence.prior.artifact.marginDistribution);
  const candidateProbabilities = validateCandidateCoherence(candidate);
  const actualMargin = outcome.homeScore - outcome.awayScore;
  const actualTotal = outcome.homeScore + outcome.awayScore;
  const actualWinner = winner(actualMargin);
  const incumbentProbabilities = validateProbabilities(sequence.incumbentComparator);
  const baseline = metrics({
    probabilities: baselineProbabilities,
    marginMean: sequence.prior.marginMean,
    totalMean: sequence.prior.totalMean,
    marginDistribution: sequence.prior.artifact.marginDistribution,
    totalDistribution: sequence.prior.artifact.totalDistribution,
    jointScoreStates: null,
    evaluationEnvelope: sequence.evaluationEnvelope,
    actualMargin,
    actualTotal,
    actualWinner,
  });
  const evaluatedCandidate = metrics({
    probabilities: candidateProbabilities,
    marginMean: candidate.marginMean,
    totalMean: candidate.totalMean,
    marginDistribution: candidate.marginDistribution,
    totalDistribution: candidate.totalDistribution,
    jointScoreStates: candidate.jointScoreStates,
    evaluationEnvelope: sequence.evaluationEnvelope,
    actualMargin,
    actualTotal,
    actualWinner,
  });
  const zeroMarketProbabilities = validateProbabilities(candidate.zeroMarketPosterior);
  const zeroMarket = metrics({
    probabilities: zeroMarketProbabilities,
    marginMean: candidate.zeroMarketPosterior.marginMean,
    totalMean: candidate.zeroMarketPosterior.totalMean,
    marginDistribution: candidate.zeroMarketPosterior.marginDistribution,
    totalDistribution: candidate.zeroMarketPosterior.totalDistribution,
    jointScoreStates: candidate.zeroMarketPosterior.jointScoreStates,
    evaluationEnvelope: sequence.evaluationEnvelope,
    actualMargin,
    actualTotal,
    actualWinner,
  });
  const incumbent = metrics({
    probabilities: incumbentProbabilities,
    marginMean: sequence.incumbentComparator.marginMean,
    totalMean: sequence.incumbentComparator.totalMean,
    marginDistribution: sequence.incumbentComparator.marginDistribution,
    totalDistribution: sequence.incumbentComparator.totalDistribution,
    jointScoreStates: null,
    evaluationEnvelope: sequence.evaluationEnvelope,
    actualMargin,
    actualTotal,
    actualWinner,
  });
  const baselineWinner = predictedWinner(baselineProbabilities);
  const candidateWinner = predictedWinner(candidateProbabilities);
  const disagreement = baselineWinner === candidateWinner ? "unchanged"
    : candidateWinner === actualWinner && baselineWinner !== actualWinner ? "correction"
    : baselineWinner === actualWinner && candidateWinner !== actualWinner ? "harm"
    : "changed_both_wrong";
  return {
    release: NFL_MARKET_BRAIN_RESEARCH_EVALUATOR_RELEASE,
    eventId: sequence.eventId,
    sequenceRelease: sequence.release,
    sequenceChecksum: sequence.checksum,
    candidateRelease: candidate.release,
    candidateArtifactSha256: candidate.artifactSha256,
    candidateTrainingManifestChecksum: candidate.trainingManifestChecksum,
    candidateWeightsSha256: candidate.weightsSha256,
    candidateTournamentChecksum: candidate.tournamentChecksum,
    candidateFeatureChecksum: candidate.featureChecksum,
    candidateInferredAt: new Date(inferredAt).toISOString(),
    researchManifestChecksum: args.researchManifest.checksum,
    partitionRole: args.partitionRole,
    foldId: manifestEvent.foldId,
    baselineRelease: sequence.prior.release,
    incumbentReleases: structuredClone(sequence.incumbentComparator.releases),
    cutoffAt: sequence.cutoffAt,
    startsAt: sequence.startsAt,
    finalAt: new Date(finalAt).toISOString(),
    actual: { winner: actualWinner, margin: actualMargin, total: actualTotal },
    baseline,
    zeroMarket,
    incumbent,
    candidate: evaluatedCandidate,
    deltas: {
      brierImprovement: baseline.multiclassBrier - evaluatedCandidate.multiclassBrier,
      logLossImprovement: baseline.logLoss - evaluatedCandidate.logLoss,
      marginMaeImprovement: baseline.marginAbsoluteError - evaluatedCandidate.marginAbsoluteError,
      totalMaeImprovement: baseline.totalAbsoluteError - evaluatedCandidate.totalAbsoluteError,
      marginTotalDistributionLogScoreImprovement:
        baseline.marginTotalDistributionLogScore === null || evaluatedCandidate.marginTotalDistributionLogScore === null
          ? null
          : baseline.marginTotalDistributionLogScore - evaluatedCandidate.marginTotalDistributionLogScore,
    },
    incumbentDeltas: {
      brierImprovement: incumbent.multiclassBrier - evaluatedCandidate.multiclassBrier,
      logLossImprovement: incumbent.logLoss - evaluatedCandidate.logLoss,
      marginMaeImprovement: incumbent.marginAbsoluteError - evaluatedCandidate.marginAbsoluteError,
      totalMaeImprovement: incumbent.totalAbsoluteError - evaluatedCandidate.totalAbsoluteError,
    },
    zeroMarketDeltas: {
      brierImprovement: zeroMarket.multiclassBrier - evaluatedCandidate.multiclassBrier,
      logLossImprovement: zeroMarket.logLoss - evaluatedCandidate.logLoss,
      marginMaeImprovement: zeroMarket.marginAbsoluteError - evaluatedCandidate.marginAbsoluteError,
      totalMaeImprovement: zeroMarket.totalAbsoluteError - evaluatedCandidate.totalAbsoluteError,
    },
    disagreement,
    invariants: {
      outcomeAppliedAfterCutoff: true,
      baselineReadFromImmutablePriorArtifact: true,
      releasePure: true,
      productionInfluenceAllowed: false,
    },
  };
}

export function summarizeNflMarketBrainResearchRun(
  rows: NflMarketBrainResearchEvaluation[],
  researchManifest: NflMarketBrainAttestedResearchManifest,
) {
  if (rows.length === 0) throw new Error("NFL Market Brain research summary requires at least one case.");
  assertNflMarketBrainAttestedResearchManifest(researchManifest);
  const candidateReleases = new Set(rows.map((row) => row.candidateRelease));
  const baselineReleases = new Set(rows.map((row) => row.baselineRelease));
  const incumbentReleases = new Set(rows.map((row) => marketBrainCanonicalJson(row.incumbentReleases)));
  const manifestChecksums = new Set(rows.map((row) => row.researchManifestChecksum));
  const partitionRoles = new Set(rows.map((row) => row.partitionRole));
  const eventIds = new Set(rows.map((row) => row.eventId));
  if (candidateReleases.size !== 1 || baselineReleases.size !== 1 || incumbentReleases.size !== 1 ||
    manifestChecksums.size !== 1 || partitionRoles.size !== 1) {
    throw new Error("NFL Market Brain research summary refuses mixed releases.");
  }
  for (const foldId of new Set(rows.map((row) => row.foldId))) {
    const identities = new Set(rows.filter((row) => row.foldId === foldId).map((row) => JSON.stringify([
      row.candidateArtifactSha256,
      row.candidateTrainingManifestChecksum,
      row.candidateWeightsSha256,
      row.candidateTournamentChecksum,
    ])));
    if (identities.size !== 1) {
      throw new Error("NFL Market Brain research summary found mixed artifacts within a fold.");
    }
  }
  if (eventIds.size !== rows.length) throw new Error("NFL Market Brain research summary refuses duplicate events.");
  const partition = researchManifest.partitions.find((row) => row.role === rows[0]!.partitionRole);
  const declaredIds = new Set(partition?.events.map((event) => event.eventId) ?? []);
  if (researchManifest.checksum !== rows[0]!.researchManifestChecksum ||
    declaredIds.size !== eventIds.size || [...declaredIds].some((eventId) => !eventIds.has(eventId))) {
    throw new Error("NFL Market Brain research summary requires the complete precommitted partition.");
  }
  const average = (pick: (row: NflMarketBrainResearchEvaluation) => number) =>
    rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;
  const averageNullable = (pick: (row: NflMarketBrainResearchEvaluation) => number | null) => {
    const values = rows.flatMap((row) => {
      const value = pick(row);
      return value === null ? [] : [value];
    });
    return values.length === rows.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const summary = {
    release: NFL_MARKET_BRAIN_RESEARCH_EVALUATOR_RELEASE,
    candidateRelease: rows[0]!.candidateRelease,
    baselineRelease: rows[0]!.baselineRelease,
    incumbentReleases: rows[0]!.incumbentReleases,
    cases: rows.length,
    corrections: rows.filter((row) => row.disagreement === "correction").length,
    harms: rows.filter((row) => row.disagreement === "harm").length,
    changedBothWrong: rows.filter((row) => row.disagreement === "changed_both_wrong").length,
    candidateWinnerAccuracy: average((row) => Number(row.candidate.winnerCorrect)),
    zeroMarketWinnerAccuracy: average((row) => Number(row.zeroMarket.winnerCorrect)),
    baselineWinnerAccuracy: average((row) => Number(row.baseline.winnerCorrect)),
    incumbentWinnerAccuracy: average((row) => Number(row.incumbent.winnerCorrect)),
    candidateBrier: average((row) => row.candidate.multiclassBrier),
    zeroMarketBrier: average((row) => row.zeroMarket.multiclassBrier),
    baselineBrier: average((row) => row.baseline.multiclassBrier),
    incumbentBrier: average((row) => row.incumbent.multiclassBrier),
    candidateLogLoss: average((row) => row.candidate.logLoss),
    zeroMarketLogLoss: average((row) => row.zeroMarket.logLoss),
    baselineLogLoss: average((row) => row.baseline.logLoss),
    incumbentLogLoss: average((row) => row.incumbent.logLoss),
    incumbentMarginalCompositeLogScore: average((row) => row.incumbent.marginalCompositeLogScore),
    candidateMarginalCompositeLogScore: average((row) => row.candidate.marginalCompositeLogScore),
    baselineMarginalCompositeLogScore: average((row) => row.baseline.marginalCompositeLogScore),
    candidateMarginTotalDistributionLogScore: averageNullable((row) => row.candidate.marginTotalDistributionLogScore),
    baselineMarginTotalDistributionLogScore: averageNullable((row) => row.baseline.marginTotalDistributionLogScore),
    candidateMarginMae: average((row) => row.candidate.marginAbsoluteError),
    zeroMarketMarginMae: average((row) => row.zeroMarket.marginAbsoluteError),
    baselineMarginMae: average((row) => row.baseline.marginAbsoluteError),
    incumbentMarginMae: average((row) => row.incumbent.marginAbsoluteError),
    candidateTotalMae: average((row) => row.candidate.totalAbsoluteError),
    zeroMarketTotalMae: average((row) => row.zeroMarket.totalAbsoluteError),
    baselineTotalMae: average((row) => row.baseline.totalAbsoluteError),
    incumbentTotalMae: average((row) => row.incumbent.totalAbsoluteError),
    foldCount: new Set(rows.map((row) => row.foldId)).size,
    researchManifestChecksum: rows[0]!.researchManifestChecksum,
    partitionRole: rows[0]!.partitionRole,
    exactLineResults: summarizeExactLines(rows),
    incumbentExactLineResults: summarizeIncumbentExactLines(rows),
    productionInfluenceAllowed: false as const,
    qualification: {
      eligible: false as const,
      missingGates: [
        "candidate_non_regression_against_released_semantic_reader",
        "exact_line_spread_and_total_non_regression",
        "calibration_and_uncertainty_intervals",
        "promotion_demotion_and_board_balance",
        "release_pure_economic_results",
      ] as const,
    },
  };
  return { ...summary, checksum: sha256(summary) };
}

export type NflMarketBrainResearchPartition = {
  role: "development" | "selection" | "confirmation" | "prospective_shadow";
  evidenceStatus: "opened_development_only" | "untouched" | "prospective";
  events: Array<{
    eventId: string;
    foldId: string;
    startsAt: string;
    cutoffAt: string;
    captureWindowOpensAt: string;
    captureWindowClosesAt: string;
    expectedCaptureAttempts: Array<{
      runId: string;
      stage: "opening" | "unlocked" | "t60";
      plannedAt: string;
    }>;
    /** Null means the outcome had not been opened when the manifest was persisted. */
    outcomeOpenedAt: string | null;
  }>;
};

export type NflMarketBrainResearchManifest = ReturnType<typeof buildNflMarketBrainResearchManifest>;
const persistedManifestBrand: unique symbol = Symbol("persistedNflMarketBrainResearchManifest");
export type NflMarketBrainAttestedResearchManifest = NflMarketBrainResearchManifest & {
  readonly persistenceAttestation: {
    recordId: string;
    serverCreatedAt: string;
    manifestChecksum: string;
  };
  readonly [persistedManifestBrand]: true;
};

export function buildNflMarketBrainResearchManifest(args: {
  candidateRelease: string;
  createdAt: string;
  storageId: string;
  partitions: NflMarketBrainResearchPartition[];
  purgeGapHours: number;
}) {
  const createdAt = requiredTimestamp(args.createdAt, "createdAt");
  if (!args.storageId.trim()) throw new Error("NFL Market Brain manifest requires an immutable storage identity.");
  if (!Number.isFinite(args.purgeGapHours) || args.purgeGapHours <= 0) {
    throw new Error("NFL Market Brain manifest requires a positive chronological purge gap.");
  }
  if (!args.candidateRelease.trim()) throw new Error("NFL Market Brain manifest candidate release is required.");
  const expectedOrder: NflMarketBrainResearchPartition["role"][] =
    ["development", "selection", "confirmation", "prospective_shadow"];
  if (args.partitions.length !== expectedOrder.length ||
    args.partitions.some((partition, index) => partition.role !== expectedOrder[index])) {
    throw new Error("NFL Market Brain research manifest requires all chronological partitions in frozen order.");
  }
  let lastRole = -1;
  let priorCaptureMax = Number.NEGATIVE_INFINITY;
  const eventIds = new Set<string>();
  for (const partition of args.partitions) {
    const role = expectedOrder.indexOf(partition.role);
    if (role <= lastRole) throw new Error("NFL Market Brain research partitions are out of chronological role order.");
    lastRole = role;
    const times = partition.events.map((event) => {
      if (!event.eventId.trim() || eventIds.has(event.eventId)) {
        throw new Error("NFL Market Brain research manifest has a duplicate or empty event identity.");
      }
      if (!event.foldId.trim()) throw new Error("NFL Market Brain manifest event requires a fold identity.");
      eventIds.add(event.eventId);
      const startsAt = requiredTimestamp(event.startsAt, `${partition.role}.startsAt`);
      const cutoffAt = requiredTimestamp(event.cutoffAt, `${partition.role}.cutoffAt`);
      const captureWindowOpensAt = requiredTimestamp(
        event.captureWindowOpensAt, `${partition.role}.captureWindowOpensAt`);
      const captureWindowClosesAt = requiredTimestamp(
        event.captureWindowClosesAt, `${partition.role}.captureWindowClosesAt`);
      if (captureWindowOpensAt > captureWindowClosesAt || captureWindowClosesAt > cutoffAt || cutoffAt >= startsAt) {
        throw new Error("NFL Market Brain planned capture window must close by cutoff and precede kickoff.");
      }
      if (event.expectedCaptureAttempts.length === 0) {
        throw new Error("NFL Market Brain manifest must predeclare at least one capture attempt per event.");
      }
      const attemptIds = new Set<string>();
      for (const attempt of event.expectedCaptureAttempts) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt.runId) ||
          attemptIds.has(attempt.runId)) {
          throw new Error("NFL Market Brain manifest capture attempt identities must be unique UUIDs per event.");
        }
        attemptIds.add(attempt.runId);
        const plannedAt = requiredTimestamp(attempt.plannedAt, `${partition.role}.expectedCaptureAttempts.plannedAt`);
        if (plannedAt < captureWindowOpensAt || plannedAt > captureWindowClosesAt) {
          throw new Error("NFL Market Brain planned capture attempt falls outside its frozen event window.");
        }
      }
      const outcomeOpenedAt = event.outcomeOpenedAt === null ? null
        : requiredTimestamp(event.outcomeOpenedAt, `${partition.role}.outcomeOpenedAt`);
      if (partition.role === "development") {
        if (outcomeOpenedAt === null || outcomeOpenedAt > createdAt) {
          throw new Error("NFL Market Brain development evidence must declare an already-opened outcome.");
        }
      } else if (outcomeOpenedAt !== null) {
        throw new Error(`NFL Market Brain ${partition.role} evidence was already opened at manifest persistence.`);
      }
      return { startsAt, cutoffAt, captureWindowOpensAt, captureWindowClosesAt };
    });
    if (times.length === 0) throw new Error(`NFL Market Brain ${partition.role} partition cannot be empty.`);
    if (partition.role === "development") {
      const foldRanges = [...new Set(partition.events.map((event) => event.foldId))].map((foldId) => {
        const events = partition.events.filter((event) => event.foldId === foldId);
        return {
          foldId,
          firstCaptureAt: Math.min(...events.map((event) => requiredTimestamp(
            event.captureWindowOpensAt, `development.${foldId}.captureWindowOpensAt`))),
          lastCaptureAt: Math.max(...events.map((event) => requiredTimestamp(
            event.captureWindowClosesAt, `development.${foldId}.captureWindowClosesAt`))),
        };
      }).sort((a, b) => a.firstCaptureAt - b.firstCaptureAt || a.foldId.localeCompare(b.foldId));
      for (let index = 1; index < foldRanges.length; index += 1) {
        if (foldRanges[index]!.firstCaptureAt - foldRanges[index - 1]!.lastCaptureAt <
          args.purgeGapHours * 60 * 60 * 1_000) {
          throw new Error("NFL Market Brain development folds overlap or violate rolling chronology.");
        }
      }
    }
    if (Math.min(...times.map((time) => time.captureWindowOpensAt)) - priorCaptureMax < args.purgeGapHours * 60 * 60 * 1_000) {
      throw new Error("NFL Market Brain research partitions overlap or violate rolling chronology.");
    }
    priorCaptureMax = Math.max(...times.map((time) => time.captureWindowClosesAt));
    const validStatus = partition.role === "development"
      ? partition.evidenceStatus === "opened_development_only"
      : partition.role === "prospective_shadow"
      ? partition.evidenceStatus === "prospective"
      : partition.evidenceStatus === "untouched";
    if (!validStatus) throw new Error(`NFL Market Brain ${partition.role} evidence status is invalid.`);
  }
  const manifest = {
    release: NFL_MARKET_BRAIN_RESEARCH_MANIFEST_RELEASE,
    candidateRelease: args.candidateRelease,
    createdAt: new Date(createdAt).toISOString(),
    storageId: args.storageId,
    splitMethod: "rolling_origin_capture_window_purged_no_random_split" as const,
    purgeGapHours: args.purgeGapHours,
    partitions: args.partitions.map((partition) => ({
      ...partition,
      events: [...partition.events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    })),
    invariants: {
      outcomesForbiddenFromFeatures: true as const,
      openedEvidenceCannotQualifyAsConfirmation: true as const,
      mixedReleaseAggregationAllowed: false as const,
      productionInfluenceAllowed: false as const,
    },
  };
  return { ...manifest, checksum: sha256(manifest) };
}

export function assertNflMarketBrainResearchManifest(
  manifest: NflMarketBrainResearchManifest,
): void {
  const rebuilt = buildNflMarketBrainResearchManifest({
    candidateRelease: manifest.candidateRelease,
    createdAt: manifest.createdAt,
    storageId: manifest.storageId,
    purgeGapHours: manifest.purgeGapHours,
    partitions: structuredClone(manifest.partitions),
  });
  if (manifest.release !== NFL_MARKET_BRAIN_RESEARCH_MANIFEST_RELEASE || rebuilt.checksum !== manifest.checksum) {
    throw new Error("NFL Market Brain research manifest checksum or release is invalid.");
  }
}

export function assertNflMarketBrainAttestedResearchManifest(
  manifest: NflMarketBrainResearchManifest,
): asserts manifest is NflMarketBrainAttestedResearchManifest {
  assertNflMarketBrainResearchManifest(manifest);
  const attested = manifest as NflMarketBrainAttestedResearchManifest;
  const receipt = attested.persistenceAttestation;
  const earliestUntouchedCapture = Math.min(...manifest.partitions
    .filter((partition) => partition.role !== "development")
    .flatMap((partition) => partition.events.map((event) =>
      requiredTimestamp(event.captureWindowOpensAt, `${partition.role}.captureWindowOpensAt`))));
  if (!(persistedManifestBrand in attested) || !receipt ||
    receipt.recordId !== manifest.storageId ||
    receipt.manifestChecksum !== manifest.checksum ||
    requiredTimestamp(receipt.serverCreatedAt, "persistenceAttestation.serverCreatedAt") <
      requiredTimestamp(manifest.createdAt, "createdAt") ||
    requiredTimestamp(receipt.serverCreatedAt, "persistenceAttestation.serverCreatedAt") >= earliestUntouchedCapture) {
    throw new Error("NFL Market Brain evaluation requires an append-only persistence attestation.");
  }
}

function attestPersistedNflMarketBrainResearchManifest(args: {
  manifest: NflMarketBrainResearchManifest;
  stored: { id: string; serverCreatedAt: string; manifestChecksum: string };
}): NflMarketBrainAttestedResearchManifest {
  assertNflMarketBrainResearchManifest(args.manifest);
  const serverCreatedAt = requiredTimestamp(args.stored.serverCreatedAt, "stored.serverCreatedAt");
  const earliestUntouchedCapture = Math.min(...args.manifest.partitions
    .filter((partition) => partition.role !== "development")
    .flatMap((partition) => partition.events.map((event) =>
      requiredTimestamp(event.captureWindowOpensAt, `${partition.role}.captureWindowOpensAt`))));
  if (args.stored.id !== args.manifest.storageId ||
    args.stored.manifestChecksum !== args.manifest.checksum ||
    serverCreatedAt < requiredTimestamp(args.manifest.createdAt, "createdAt") ||
    serverCreatedAt >= earliestUntouchedCapture) {
    throw new Error("NFL Market Brain research manifest does not match its append-only persistence record.");
  }
  const attested = {
    ...structuredClone(args.manifest),
    persistenceAttestation: {
      recordId: args.stored.id,
      serverCreatedAt: new Date(serverCreatedAt).toISOString(),
      manifestChecksum: args.stored.manifestChecksum,
    },
  } as NflMarketBrainAttestedResearchManifest;
  Object.defineProperty(attested, persistedManifestBrand, { value: true, enumerable: false });
  const frozen = Object.freeze(attested);
  assertNflMarketBrainAttestedResearchManifest(frozen);
  return frozen;
}

type PersistedManifestRow = {
  id: string;
  manifest_checksum: string;
  manifest: unknown;
  manifest_payload: string;
  created_at: string;
};

export async function persistNflMarketBrainResearchManifest(args: {
  client: SupabaseClient;
  manifest: NflMarketBrainResearchManifest;
  signal?: AbortSignal;
}): Promise<NflMarketBrainAttestedResearchManifest> {
  assertNflMarketBrainResearchManifest(args.manifest);
  const { checksum: _checksum, ...manifestPayload } = args.manifest;
  let query = args.client.from("nfl_market_brain_research_manifests").insert({
    canonical_release: MARKET_BRAIN_CANONICAL_JSON_RELEASE,
    id: args.manifest.storageId,
    manifest_release: args.manifest.release,
    candidate_release: args.manifest.candidateRelease,
    manifest_checksum: args.manifest.checksum,
    manifest: args.manifest,
    manifest_payload: marketBrainCanonicalJson(manifestPayload),
  }).select("id,manifest_checksum,manifest,manifest_payload,created_at");
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query.single();
  if (error) throw new Error(`NFL Market Brain research manifest persistence failed: ${error.message}`);
  return attestedManifestFromStoredRow(data as PersistedManifestRow | null, args.manifest);
}

export async function readNflMarketBrainResearchManifest(args: {
  client: SupabaseClient;
  storageId: string;
  checksum: string;
  signal?: AbortSignal;
}): Promise<NflMarketBrainAttestedResearchManifest> {
  let query = args.client.from("nfl_market_brain_research_manifests")
    .select("id,manifest_checksum,manifest,manifest_payload,created_at")
    .eq("id", args.storageId)
    .eq("manifest_checksum", args.checksum);
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query.single();
  if (error) throw new Error(`NFL Market Brain research manifest read failed: ${error.message}`);
  return attestedManifestFromStoredRow(data as PersistedManifestRow | null);
}

function attestedManifestFromStoredRow(
  row: PersistedManifestRow | null,
  expected?: NflMarketBrainResearchManifest,
): NflMarketBrainAttestedResearchManifest {
  if (!row || typeof row.manifest !== "object" || row.manifest === null) {
    throw new Error("NFL Market Brain research manifest persistence returned no verifiable row.");
  }
  const manifest = row.manifest as NflMarketBrainResearchManifest;
  assertNflMarketBrainResearchManifest(manifest);
  const { checksum: _checksum, ...manifestPayload } = manifest;
  if (row.manifest_payload !== marketBrainCanonicalJson(manifestPayload) ||
    marketBrainSha256(JSON.parse(row.manifest_payload)) !== row.manifest_checksum) {
    throw new Error("NFL Market Brain stored research manifest canonical payload is invalid.");
  }
  if (expected && (expected.storageId !== manifest.storageId || expected.checksum !== manifest.checksum)) {
    throw new Error("NFL Market Brain stored research manifest differs from the submitted bytes.");
  }
  return attestPersistedNflMarketBrainResearchManifest({
    manifest,
    stored: { id: row.id, serverCreatedAt: row.created_at, manifestChecksum: row.manifest_checksum },
  });
}

type PersistedPredictionRow = {
  id: string;
  prediction_sha256: string;
  prediction: unknown;
  prediction_payload: string;
  created_at: string;
};

export async function persistNflMarketBrainResearchPrediction(args: {
  client: SupabaseClient;
  resolverOutput: import("./nflMarketBrainResolverContract").NflMarketBrainResolverShadowOutput;
  signal?: AbortSignal;
}): Promise<NflMarketBrainAttestedResearchPrediction> {
  const resolver = await import("./nflMarketBrainResolverContract");
  resolver.assertNflMarketBrainResolverShadowOutput(args.resolverOutput);
  const prediction = resolver.resolverOutputAsResearchPrediction(args.resolverOutput);
  assertResearchPredictionEnvelope(prediction);
  const predictionPayload = marketBrainCanonicalJson(prediction);
  const predictionSha256 = marketBrainSha256(prediction);
  let query = args.client.from("nfl_market_brain_research_predictions").insert({
    canonical_release: MARKET_BRAIN_CANONICAL_JSON_RELEASE,
    prediction_sha256: predictionSha256,
    event_id: prediction.eventId,
    cutoff_at: prediction.cutoffAt,
    starts_at: prediction.startsAt,
    candidate_release: prediction.release,
    artifact_sha256: prediction.artifactSha256,
    training_manifest_checksum: prediction.trainingManifestChecksum,
    research_input_id: prediction.researchInputRecordId,
    research_input_checksum: prediction.researchInputChecksum,
    capture_set_checksum: prediction.captureSetChecksum,
    resolver_output_checksum: prediction.resolverOutputChecksum,
    sequence_checksum: prediction.sequenceChecksum,
    feature_checksum: prediction.featureChecksum,
    prediction,
    prediction_payload: predictionPayload,
  }).select("id,prediction_sha256,prediction,prediction_payload,created_at");
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query.single();
  if (error) throw new Error(`NFL Market Brain research prediction persistence failed: ${error.message}`);
  return attestedPredictionFromStoredRow(data as PersistedPredictionRow | null, prediction);
}

export async function readNflMarketBrainResearchPrediction(args: {
  client: SupabaseClient;
  predictionSha256: string;
  signal?: AbortSignal;
}): Promise<NflMarketBrainAttestedResearchPrediction> {
  let query = args.client.from("nfl_market_brain_research_predictions")
    .select("id,prediction_sha256,prediction,prediction_payload,created_at")
    .eq("prediction_sha256", args.predictionSha256);
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query.single();
  if (error) throw new Error(`NFL Market Brain research prediction read failed: ${error.message}`);
  return attestedPredictionFromStoredRow(data as PersistedPredictionRow | null);
}

export function assertNflMarketBrainAttestedResearchPrediction(
  prediction: NflMarketBrainResearchPrediction,
): asserts prediction is NflMarketBrainAttestedResearchPrediction {
  assertResearchPredictionEnvelope(prediction);
  const attested = prediction as NflMarketBrainAttestedResearchPrediction;
  const receipt = attested.persistenceAttestation;
  if (!(persistedPredictionBrand in attested) || !receipt ||
    receipt.predictionSha256 !== marketBrainSha256(stripPredictionAttestation(attested)) ||
    requiredTimestamp(receipt.serverCreatedAt, "predictionReceipt") <
      requiredTimestamp(prediction.inferredAt, "prediction.inferredAt") ||
    requiredTimestamp(receipt.serverCreatedAt, "predictionReceipt") >=
      requiredTimestamp(prediction.startsAt, "prediction.startsAt")) {
    throw new Error("NFL Market Brain evaluation requires an append-only pregame prediction attestation.");
  }
}

function attestedPredictionFromStoredRow(
  row: PersistedPredictionRow | null,
  expected?: NflMarketBrainResearchPrediction,
): NflMarketBrainAttestedResearchPrediction {
  if (!row || typeof row.prediction !== "object" || row.prediction === null) {
    throw new Error("NFL Market Brain research prediction persistence returned no verifiable row.");
  }
  const prediction = row.prediction as NflMarketBrainResearchPrediction;
  assertResearchPredictionEnvelope(prediction);
  if (row.prediction_payload !== marketBrainCanonicalJson(prediction) ||
    row.prediction_sha256 !== marketBrainSha256(prediction) ||
    expected && marketBrainCanonicalJson(expected) !== row.prediction_payload) {
    throw new Error("NFL Market Brain stored prediction differs from its exact canonical bytes.");
  }
  const attested = {
    ...structuredClone(prediction),
    persistenceAttestation: {
      recordId: row.id,
      serverCreatedAt: new Date(requiredTimestamp(row.created_at, "predictionReceipt")).toISOString(),
      predictionSha256: row.prediction_sha256,
    },
  } as NflMarketBrainAttestedResearchPrediction;
  Object.defineProperty(attested, persistedPredictionBrand, { value: true, enumerable: false });
  Object.freeze(attested);
  assertNflMarketBrainAttestedResearchPrediction(attested);
  return attested;
}

type VerifiedGameRow = {
  id: string;
  external_id: string;
  sport: string;
  status: string;
  away_score: number | null;
  home_score: number | null;
  provider_ids: unknown;
  updated_at: string;
};

type StoredOutcomeRow = {
  id: string;
  outcome_checksum: string;
  outcome: unknown;
  outcome_payload: string;
  created_at: string;
};

/** Reads an exact finalized NFL game row and appends an immutable research-label receipt. */
export async function persistVerifiedNflMarketBrainFinalOutcome(args: {
  client: SupabaseClient;
  eventId: string;
  signal?: AbortSignal;
}): Promise<NflMarketBrainAttestedFinalOutcome> {
  let gameQuery = args.client.from("games")
    .select("id,external_id,status,away_score,home_score,provider_ids,updated_at")
    .eq("sport", "nfl")
    .eq("external_id", args.eventId)
    .eq("status", "final");
  if (args.signal) gameQuery = gameQuery.abortSignal(args.signal);
  const { data: gameData, error: gameError } = await gameQuery.single();
  if (gameError) throw new Error(`NFL Market Brain verified final read failed: ${gameError.message}`);
  const game = gameData as VerifiedGameRow | null;
  if (!game || !Number.isInteger(game.away_score) || !Number.isInteger(game.home_score) ||
    game.away_score! < 0 || game.home_score! < 0) {
    throw new Error("NFL Market Brain final outcome requires a complete regulation-final games row.");
  }
  const sourceRow = {
    id: game.id,
    externalId: game.external_id,
    sport: game.sport,
    status: game.status,
    awayScore: game.away_score,
    homeScore: game.home_score,
    providerIds: game.provider_ids,
    updatedAt: new Date(requiredTimestamp(game.updated_at, "games.updatedAt")).toISOString(),
  };
  const withoutChecksum = {
    eventId: game.external_id,
    finalAt: sourceRow.updatedAt,
    awayScore: game.away_score!,
    homeScore: game.home_score!,
    source: {
      table: "games" as const,
      gameRecordId: game.id,
      providerIds: structuredClone(game.provider_ids),
      sourceUpdatedAt: sourceRow.updatedAt,
      sourceRowSha256: marketBrainSha256(sourceRow),
    },
  };
  const outcome: NflMarketBrainFinalOutcome = {
    ...withoutChecksum,
    checksum: marketBrainSha256(withoutChecksum),
  };
  let outcomeQuery = args.client.from("nfl_market_brain_research_outcomes").insert({
    canonical_release: MARKET_BRAIN_CANONICAL_JSON_RELEASE,
    outcome_checksum: outcome.checksum,
    event_id: outcome.eventId,
    game_id: outcome.source.gameRecordId,
    source_row_sha256: outcome.source.sourceRowSha256,
    source_row_payload: marketBrainCanonicalJson(sourceRow),
    final_at: outcome.finalAt,
    outcome,
    outcome_payload: marketBrainCanonicalJson(withoutChecksum),
  }).select("id,outcome_checksum,outcome,outcome_payload,created_at");
  if (args.signal) outcomeQuery = outcomeQuery.abortSignal(args.signal);
  const { data, error } = await outcomeQuery.single();
  if (error) throw new Error(`NFL Market Brain final-outcome receipt failed: ${error.message}`);
  return attestFinalOutcome(data as StoredOutcomeRow | null, outcome);
}

export function assertNflMarketBrainAttestedFinalOutcome(
  outcome: NflMarketBrainFinalOutcome,
): asserts outcome is NflMarketBrainAttestedFinalOutcome {
  const attested = outcome as NflMarketBrainAttestedFinalOutcome;
  const { checksum, persistenceAttestation: _receipt, ...payload } = attested;
  if (!attestedFinalOutcomes.has(outcome) || !attested.persistenceAttestation ||
    checksum !== marketBrainSha256(payload) ||
    attested.persistenceAttestation.outcomeChecksum !== checksum ||
    requiredTimestamp(attested.persistenceAttestation.serverCreatedAt, "outcomeReceipt") <
      requiredTimestamp(outcome.finalAt, "outcome.finalAt")) {
    throw new Error("NFL Market Brain evaluation requires a verified immutable final-outcome receipt.");
  }
}

function attestFinalOutcome(
  row: StoredOutcomeRow | null,
  expected: NflMarketBrainFinalOutcome,
): NflMarketBrainAttestedFinalOutcome {
  if (!row || typeof row.outcome !== "object" || row.outcome === null) {
    throw new Error("NFL Market Brain final-outcome persistence returned no verifiable row.");
  }
  const stored = row.outcome as NflMarketBrainFinalOutcome;
  const { checksum, ...payload } = stored;
  if (checksum !== row.outcome_checksum || checksum !== marketBrainSha256(payload) ||
    row.outcome_payload !== marketBrainCanonicalJson(payload) ||
    marketBrainCanonicalJson(stored) !== marketBrainCanonicalJson(expected)) {
    throw new Error("NFL Market Brain stored final outcome differs from its verified game row.");
  }
  const attested = {
    ...structuredClone(stored),
    persistenceAttestation: {
      recordId: row.id,
      serverCreatedAt: new Date(requiredTimestamp(row.created_at, "outcomeReceipt")).toISOString(),
      outcomeChecksum: row.outcome_checksum,
    },
  } as NflMarketBrainAttestedFinalOutcome;
  attestedFinalOutcomes.add(attested);
  Object.freeze(attested);
  assertNflMarketBrainAttestedFinalOutcome(attested);
  return attested;
}

function assertResearchPredictionEnvelope(prediction: NflMarketBrainResearchPrediction): void {
  if (!prediction.eventId.trim() || !prediction.release.trim() ||
    !/^[a-f0-9]{64}$/.test(prediction.artifactSha256) ||
    !/^[a-f0-9]{64}$/.test(prediction.trainingManifestChecksum) ||
    !/^[a-f0-9]{64}$/.test(prediction.sequenceChecksum) ||
    !/^[a-f0-9]{64}$/.test(prediction.featureChecksum) ||
    !prediction.researchInputRecordId.trim() ||
    !/^[a-f0-9]{64}$/.test(prediction.researchInputChecksum) ||
    !/^[a-f0-9]{64}$/.test(prediction.captureSetChecksum) ||
    !/^[a-f0-9]{64}$/.test(prediction.resolverOutputChecksum) ||
    requiredTimestamp(prediction.cutoffAt, "prediction.cutoffAt") >=
      requiredTimestamp(prediction.startsAt, "prediction.startsAt") ||
    requiredTimestamp(prediction.inferredAt, "prediction.inferredAt") <
      requiredTimestamp(prediction.cutoffAt, "prediction.cutoffAt") ||
    requiredTimestamp(prediction.inferredAt, "prediction.inferredAt") >=
      requiredTimestamp(prediction.startsAt, "prediction.startsAt")) {
    throw new Error("NFL Market Brain research prediction envelope is invalid.");
  }
  assertPredictionIdentity(prediction);
  validateCandidateCoherence(prediction);
  validateCandidateCoherence({
    ...prediction,
    awayWinProbability: prediction.zeroMarketPosterior.awayWinProbability,
    homeWinProbability: prediction.zeroMarketPosterior.homeWinProbability,
    tieProbability: prediction.zeroMarketPosterior.tieProbability,
    marginMean: prediction.zeroMarketPosterior.marginMean,
    totalMean: prediction.zeroMarketPosterior.totalMean,
    marginDistribution: prediction.zeroMarketPosterior.marginDistribution,
    totalDistribution: prediction.zeroMarketPosterior.totalDistribution,
    jointScoreStates: prediction.zeroMarketPosterior.jointScoreStates,
    jointPosteriorSha256: prediction.zeroMarketPosterior.jointPosteriorSha256,
  });
}

function stripPredictionAttestation(
  prediction: NflMarketBrainAttestedResearchPrediction,
): NflMarketBrainResearchPrediction {
  const { persistenceAttestation: _receipt, ...draft } = prediction;
  return draft;
}

function winnerProbabilities(distribution: MarketBrainDiscreteDistribution) {
  const probabilities = { away: 0, home: 0, tie: 0 };
  distribution.values.forEach((value, index) => {
    probabilities[winner(value)] += distribution.probabilities[index]!;
  });
  return validateProbabilities({
    awayWinProbability: probabilities.away,
    homeWinProbability: probabilities.home,
    tieProbability: probabilities.tie,
  });
}

function validateCandidateCoherence(candidate: NflMarketBrainResearchPrediction) {
  assertResearchDistribution(candidate.marginDistribution, "candidate margin");
  assertResearchDistribution(candidate.totalDistribution, "candidate total");
  const derivedProbabilities = winnerProbabilities(candidate.marginDistribution);
  const declaredProbabilities = validateProbabilities(candidate);
  const marginMean = distributionMean(candidate.marginDistribution);
  const totalMean = distributionMean(candidate.totalDistribution);
  assertJointStates(candidate.jointScoreStates, "candidate");
  const jointMargin = marginal(candidate.jointScoreStates, "margin");
  const jointTotal = marginal(candidate.jointScoreStates, "total");
  const posteriorWithoutHash = {
    schema: "nfl_market_brain_joint_score_posterior_v1" as const,
    states: [...candidate.jointScoreStates].sort((a, b) => a.total - b.total || a.margin - b.margin),
    marginDistribution: jointMargin,
    totalDistribution: jointTotal,
    marginMean: distributionMean(jointMargin),
    totalMean: distributionMean(jointTotal),
    awayWinProbability: declaredProbabilities.away,
    homeWinProbability: declaredProbabilities.home,
    tieProbability: declaredProbabilities.tie,
    awayScoreMean: (totalMean - marginMean) / 2,
    homeScoreMean: (totalMean + marginMean) / 2,
  };
  if ((["away", "home", "tie"] as const).some((side) =>
    Math.abs(derivedProbabilities[side] - declaredProbabilities[side]) > 1e-9) ||
    Math.abs(marginMean - candidate.marginMean) > 1e-9 ||
    Math.abs(totalMean - candidate.totalMean) > 1e-9 ||
    !sameDistribution(jointMargin, candidate.marginDistribution) ||
    !sameDistribution(jointTotal, candidate.totalDistribution) ||
    candidate.jointPosteriorSha256 !== sha256(posteriorWithoutHash)) {
    throw new Error("NFL Market Brain candidate probabilities or moments are incoherent with its distributions.");
  }
  return derivedProbabilities;
}

function validateProbabilities(value: Pick<NflMarketBrainResearchPrediction,
  "awayWinProbability" | "homeWinProbability" | "tieProbability">) {
  const probabilities = {
    away: value.awayWinProbability,
    home: value.homeWinProbability,
    tie: value.tieProbability,
  };
  if (Object.values(probabilities).some((probability) => !Number.isFinite(probability) || probability < 0 || probability > 1) ||
    Math.abs(Object.values(probabilities).reduce((sum, probability) => sum + probability, 0) - 1) > 1e-6) {
    throw new Error("NFL Market Brain winner probabilities are invalid.");
  }
  return probabilities;
}

function metrics(args: {
  probabilities: Record<Winner, number>;
  marginMean: number;
  totalMean: number;
  marginDistribution: MarketBrainDiscreteDistribution;
  totalDistribution: MarketBrainDiscreteDistribution;
  jointScoreStates: Array<{ margin: number; total: number; probability: number }> | null;
  evaluationEnvelope: NflMarketBrainSequence["evaluationEnvelope"];
  actualMargin: number;
  actualTotal: number;
  actualWinner: Winner;
}): Metrics {
  if (!Number.isFinite(args.marginMean) || !Number.isFinite(args.totalMean)) {
    throw new Error("NFL Market Brain projection moments are invalid.");
  }
  const marginDistributionLogLoss = distributionLogLoss(args.marginDistribution, args.actualMargin);
  const totalDistributionLogLoss = distributionLogLoss(args.totalDistribution, args.actualTotal);
  const jointDistributionLogLoss = args.jointScoreStates === null
    ? null : jointLogLoss(args.jointScoreStates, args.actualMargin, args.actualTotal);
  return {
    multiclassBrier: (Object.keys(args.probabilities) as Winner[]).reduce((sum, key) =>
      sum + (args.probabilities[key] - Number(key === args.actualWinner)) ** 2, 0),
    logLoss: -Math.log(Math.max(args.probabilities[args.actualWinner], 1e-15)),
    marginDistributionLogLoss,
    totalDistributionLogLoss,
    marginTotalDistributionLogScore: jointDistributionLogLoss,
    marginalCompositeLogScore: marginDistributionLogLoss + totalDistributionLogLoss,
    marginAbsoluteError: Math.abs(args.marginMean - args.actualMargin),
    totalAbsoluteError: Math.abs(args.totalMean - args.actualTotal),
    winnerCorrect: predictedWinner(args.probabilities) === args.actualWinner,
    exactLines: exactLineMetrics(args),
  };
}

function exactLineMetrics(args: {
  probabilities: Record<Winner, number>;
  marginDistribution: MarketBrainDiscreteDistribution;
  totalDistribution: MarketBrainDiscreteDistribution;
  evaluationEnvelope: NflMarketBrainSequence["evaluationEnvelope"];
  actualMargin: number;
  actualTotal: number;
}): Metrics["exactLines"] {
  const result: Metrics["exactLines"] = {};
  for (const market of ["moneyline", "spread", "total"] as const) {
    const target = args.evaluationEnvelope[market];
    if (!target) continue;
    if ((market === "moneyline" || market === "spread") &&
      target.selection !== "away" && target.selection !== "home" ||
      market === "total" && target.selection !== "over" && target.selection !== "under") {
      throw new Error(`NFL Market Brain ${market} evaluated selection is invalid.`);
    }
    const selection = target.selection as "away" | "home" | "over" | "under";
    let winProbability = 0;
    let pushProbability = 0;
    let actualEdge = 0;
    if (market === "moneyline") {
      winProbability = target.selection === "home" ? args.probabilities.home : args.probabilities.away;
      pushProbability = args.probabilities.tie;
      actualEdge = target.selection === "home" ? args.actualMargin : -args.actualMargin;
    } else if (market === "spread") {
      if (target.line === null) continue;
      const sign = target.selection === "home" ? 1 : -1;
      args.marginDistribution.values.forEach((margin, index) => {
        const edge = sign * margin + target.line!;
        if (edge > 0) winProbability += args.marginDistribution.probabilities[index]!;
        else if (edge === 0) pushProbability += args.marginDistribution.probabilities[index]!;
      });
      actualEdge = sign * args.actualMargin + target.line;
    } else {
      if (target.line === null) continue;
      args.totalDistribution.values.forEach((total, index) => {
        const edge = target.selection === "over" ? total - target.line! : target.line! - total;
        if (edge > 0) winProbability += args.totalDistribution.probabilities[index]!;
        else if (edge === 0) pushProbability += args.totalDistribution.probabilities[index]!;
      });
      actualEdge = target.selection === "over" ? args.actualTotal - target.line : target.line - args.actualTotal;
    }
    const settled = actualEdge > 0 ? "win" : actualEdge < 0 ? "loss" : "push";
    result[market] = {
      selection,
      line: target.line,
      price: target.price,
      winProbability,
      pushProbability,
      result: settled,
      units: settled === "push" ? 0 : settled === "loss" ? -1 :
        target.price > 0 ? target.price / 100 : 100 / Math.abs(target.price),
    };
  }
  return result;
}

function summarizeExactLines(rows: NflMarketBrainResearchEvaluation[]) {
  return Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => {
    const pairs = rows.flatMap((row) => {
      const baseline = row.baseline.exactLines[market];
      const candidate = row.candidate.exactLines[market];
      return baseline && candidate ? [{ baseline, candidate }] : [];
    });
    return [market, {
      cases: pairs.length,
      candidateAverageWinProbability: pairs.length === 0 ? null :
        pairs.reduce((sum, pair) => sum + pair.candidate.winProbability, 0) / pairs.length,
      baselineAverageWinProbability: pairs.length === 0 ? null :
        pairs.reduce((sum, pair) => sum + pair.baseline.winProbability, 0) / pairs.length,
      observedTargetSettledUnits: pairs.reduce((sum, pair) => sum + pair.candidate.units, 0),
    }];
  }));
}

function summarizeIncumbentExactLines(rows: NflMarketBrainResearchEvaluation[]) {
  return Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => {
    const pairs = rows.flatMap((row) => {
      const incumbent = row.incumbent.exactLines[market];
      const candidate = row.candidate.exactLines[market];
      return incumbent && candidate ? [{ incumbent, candidate }] : [];
    });
    return [market, {
      cases: pairs.length,
      candidateAverageWinProbability: pairs.length === 0 ? null :
        pairs.reduce((sum, pair) => sum + pair.candidate.winProbability, 0) / pairs.length,
      incumbentAverageWinProbability: pairs.length === 0 ? null :
        pairs.reduce((sum, pair) => sum + pair.incumbent.winProbability, 0) / pairs.length,
      observedTargetSettledUnits: pairs.reduce((sum, pair) => sum + pair.candidate.units, 0),
    }];
  }));
}

function assertPredictionIdentity(candidate: NflMarketBrainResearchPrediction): void {
  if (![candidate.artifactSha256, candidate.tournamentChecksum, candidate.featureChecksum,
    candidate.trainingManifestChecksum, candidate.weightsSha256, candidate.jointPosteriorSha256]
    .every((value) => /^[a-f0-9]{64}$/.test(value)) ||
    !candidate.family || !candidate.featureRelease.trim() ||
    !Number.isInteger(candidate.fittedParameterCount) || candidate.fittedParameterCount < 0) {
    throw new Error("NFL Market Brain prediction artifact identity is incomplete.");
  }
}

function assertJointStates(
  states: Array<{ margin: number; total: number; probability: number }>,
  name: string,
): void {
  const keys = new Set<string>();
  if (states.length === 0 || states.some((state) => {
    const key = `${state.margin}|${state.total}`;
    const invalid = !feasibleState(state.margin, state.total) || !Number.isFinite(state.probability) ||
      state.probability < 0 || keys.has(key);
    keys.add(key);
    return invalid;
  }) || Math.abs(states.reduce((sum, state) => sum + state.probability, 0) - 1) > 1e-6) {
    throw new Error(`NFL Market Brain ${name} joint distribution is invalid.`);
  }
}

function jointLogLoss(
  states: Array<{ margin: number; total: number; probability: number }>,
  actualMargin: number,
  actualTotal: number,
): number {
  assertJointStates(states, "scored");
  const probability = states.reduce((sum, state) =>
    state.margin === actualMargin && state.total === actualTotal ? sum + state.probability : sum, 0);
  return -Math.log(Math.max(probability, 1e-15));
}

function marginal(
  states: Array<{ margin: number; total: number; probability: number }>,
  key: "margin" | "total",
): MarketBrainDiscreteDistribution {
  const mass = new Map<number, number>();
  for (const state of states) mass.set(state[key], (mass.get(state[key]) ?? 0) + state.probability);
  const entries = [...mass.entries()].sort((a, b) => a[0] - b[0]);
  return { values: entries.map(([value]) => value), probabilities: entries.map(([, probability]) => probability) };
}

function sameDistribution(first: MarketBrainDiscreteDistribution, second: MarketBrainDiscreteDistribution): boolean {
  return first.values.length === second.values.length && first.values.every((value, index) =>
    value === second.values[index] && Math.abs(first.probabilities[index]! - second.probabilities[index]!) <= 1e-9);
}

function feasibleState(margin: number, total: number): boolean {
  if (!Number.isInteger(margin) || !Number.isInteger(total) || total < 0 || Math.abs(margin) > total ||
    Math.abs(total - margin) % 2 !== 0) return false;
  const home = (total + margin) / 2;
  const away = (total - margin) / 2;
  return !((home === 1 && away < 6) || (away === 1 && home < 6));
}

function distributionLogLoss(distribution: MarketBrainDiscreteDistribution, actual: number): number {
  assertResearchDistribution(distribution, "scored");
  const probability = distribution.values.reduce((sum, value, index) =>
    Math.abs(value - actual) <= 1e-9 ? sum + distribution.probabilities[index]! : sum, 0);
  return -Math.log(Math.max(probability, 1e-15));
}

function assertResearchDistribution(distribution: MarketBrainDiscreteDistribution, name: string) {
  if (distribution.values.length === 0 || distribution.values.length !== distribution.probabilities.length ||
    distribution.values.some((value) => !Number.isFinite(value)) ||
    distribution.probabilities.some((value) => !Number.isFinite(value) || value < 0) ||
    Math.abs(distribution.probabilities.reduce((sum, value) => sum + value, 0) - 1) > 1e-6) {
    throw new Error(`NFL Market Brain ${name} distribution is invalid.`);
  }
}

function distributionMean(distribution: MarketBrainDiscreteDistribution) {
  return distribution.values.reduce((sum, value, index) => sum + value * distribution.probabilities[index]!, 0);
}

function winner(margin: number): Winner {
  return margin > 0 ? "home" : margin < 0 ? "away" : "tie";
}

function predictedWinner(probabilities: Record<Winner, number>): Winner {
  return (Object.entries(probabilities) as Array<[Winner, number]>).sort((a, b) => b[1] - a[1])[0]![0];
}

function requiredTimestamp(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid NFL Market Brain ${name}.`);
  return parsed;
}

function sha256(value: unknown): string {
  return marketBrainSha256(value);
}
