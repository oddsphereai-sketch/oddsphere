import { createHash } from "node:crypto";

import type { MarketBrainDiscreteDistribution } from "./marketBrainContract";
import {
  NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE,
  type NflMarketBrainSequence,
} from "./nflMarketBrainSequenceMaterializer";

export const NFL_MARKET_BRAIN_RESEARCH_EVALUATOR_RELEASE =
  "nfl_market_brain_research_evaluator_2026_10_27_r1_release_pure" as const;
export const NFL_MARKET_BRAIN_RESEARCH_MANIFEST_RELEASE =
  "nfl_market_brain_research_manifest_2026_10_27_r1_chronological" as const;

export type NflMarketBrainResearchPrediction = {
  release: string;
  trainedThrough: string;
  sequenceChecksum: string;
  awayWinProbability: number;
  homeWinProbability: number;
  tieProbability: number;
  marginMean: number;
  totalMean: number;
  marginDistribution: MarketBrainDiscreteDistribution;
  totalDistribution: MarketBrainDiscreteDistribution;
};

export type NflMarketBrainFinalOutcome = {
  eventId: string;
  finalAt: string;
  awayScore: number;
  homeScore: number;
};

type Winner = "away" | "home" | "tie";
type Metrics = {
  multiclassBrier: number;
  logLoss: number;
  marginAbsoluteError: number;
  totalAbsoluteError: number;
  winnerCorrect: boolean;
};

export type NflMarketBrainResearchEvaluation = {
  release: typeof NFL_MARKET_BRAIN_RESEARCH_EVALUATOR_RELEASE;
  eventId: string;
  sequenceRelease: typeof NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE;
  sequenceChecksum: string;
  candidateRelease: string;
  baselineRelease: string;
  cutoffAt: string;
  startsAt: string;
  finalAt: string;
  actual: { winner: Winner; margin: number; total: number };
  baseline: Metrics;
  candidate: Metrics;
  deltas: {
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
  candidate: NflMarketBrainResearchPrediction;
  outcome: NflMarketBrainFinalOutcome;
}): NflMarketBrainResearchEvaluation {
  const { sequence, candidate, outcome } = args;
  if (sequence.release !== NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE) {
    throw new Error("NFL Market Brain evaluator refuses a superseded sequence release.");
  }
  if (sequence.eventId !== outcome.eventId) throw new Error("NFL Market Brain evaluation event identity mismatch.");
  if (candidate.sequenceChecksum !== sequence.checksum) {
    throw new Error("NFL Market Brain candidate was not produced from this immutable sequence.");
  }
  if (!candidate.release.trim()) throw new Error("NFL Market Brain candidate release is required.");
  const cutoff = requiredTimestamp(sequence.cutoffAt, "cutoffAt");
  const starts = requiredTimestamp(sequence.startsAt, "startsAt");
  const trainedThrough = requiredTimestamp(candidate.trainedThrough, "trainedThrough");
  const finalAt = requiredTimestamp(outcome.finalAt, "finalAt");
  if (trainedThrough >= cutoff || trainedThrough >= starts) {
    throw new Error("NFL Market Brain candidate training boundary reaches the evaluated case.");
  }
  if (finalAt <= cutoff || finalAt <= starts) {
    throw new Error("NFL Market Brain outcome was not available strictly after cutoff and game start.");
  }
  if (![outcome.awayScore, outcome.homeScore].every((value) => Number.isInteger(value) && value >= 0)) {
    throw new Error("NFL Market Brain final score is invalid.");
  }
  if (sequence.prior.kind !== "margin_total_distribution") {
    throw new Error("NFL Market Brain evaluator requires an exact margin/total prior artifact.");
  }
  const baselineProbabilities = winnerProbabilities(sequence.prior.artifact.marginDistribution);
  const candidateProbabilities = validateCandidateCoherence(candidate);
  const actualMargin = outcome.homeScore - outcome.awayScore;
  const actualTotal = outcome.homeScore + outcome.awayScore;
  const actualWinner = winner(actualMargin);
  const baseline = metrics({
    probabilities: baselineProbabilities,
    marginMean: sequence.prior.marginMean,
    totalMean: sequence.prior.totalMean,
    actualMargin,
    actualTotal,
    actualWinner,
  });
  const evaluatedCandidate = metrics({
    probabilities: candidateProbabilities,
    marginMean: candidate.marginMean,
    totalMean: candidate.totalMean,
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
    baselineRelease: sequence.prior.release,
    cutoffAt: sequence.cutoffAt,
    startsAt: sequence.startsAt,
    finalAt: new Date(finalAt).toISOString(),
    actual: { winner: actualWinner, margin: actualMargin, total: actualTotal },
    baseline,
    candidate: evaluatedCandidate,
    deltas: {
      brierImprovement: baseline.multiclassBrier - evaluatedCandidate.multiclassBrier,
      logLossImprovement: baseline.logLoss - evaluatedCandidate.logLoss,
      marginMaeImprovement: baseline.marginAbsoluteError - evaluatedCandidate.marginAbsoluteError,
      totalMaeImprovement: baseline.totalAbsoluteError - evaluatedCandidate.totalAbsoluteError,
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

export function summarizeNflMarketBrainResearchRun(rows: NflMarketBrainResearchEvaluation[]) {
  if (rows.length === 0) throw new Error("NFL Market Brain research summary requires at least one case.");
  const candidateReleases = new Set(rows.map((row) => row.candidateRelease));
  const baselineReleases = new Set(rows.map((row) => row.baselineRelease));
  const eventIds = new Set(rows.map((row) => row.eventId));
  if (candidateReleases.size !== 1 || baselineReleases.size !== 1) {
    throw new Error("NFL Market Brain research summary refuses mixed releases.");
  }
  if (eventIds.size !== rows.length) throw new Error("NFL Market Brain research summary refuses duplicate events.");
  const average = (pick: (row: NflMarketBrainResearchEvaluation) => number) =>
    rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;
  const summary = {
    release: NFL_MARKET_BRAIN_RESEARCH_EVALUATOR_RELEASE,
    candidateRelease: rows[0]!.candidateRelease,
    baselineRelease: rows[0]!.baselineRelease,
    cases: rows.length,
    corrections: rows.filter((row) => row.disagreement === "correction").length,
    harms: rows.filter((row) => row.disagreement === "harm").length,
    changedBothWrong: rows.filter((row) => row.disagreement === "changed_both_wrong").length,
    candidateWinnerAccuracy: average((row) => Number(row.candidate.winnerCorrect)),
    baselineWinnerAccuracy: average((row) => Number(row.baseline.winnerCorrect)),
    candidateBrier: average((row) => row.candidate.multiclassBrier),
    baselineBrier: average((row) => row.baseline.multiclassBrier),
    candidateLogLoss: average((row) => row.candidate.logLoss),
    baselineLogLoss: average((row) => row.baseline.logLoss),
    candidateMarginMae: average((row) => row.candidate.marginAbsoluteError),
    baselineMarginMae: average((row) => row.baseline.marginAbsoluteError),
    candidateTotalMae: average((row) => row.candidate.totalAbsoluteError),
    baselineTotalMae: average((row) => row.baseline.totalAbsoluteError),
    productionInfluenceAllowed: false as const,
  };
  return { ...summary, checksum: sha256(summary) };
}

export type NflMarketBrainResearchPartition = {
  role: "development" | "selection" | "confirmation" | "prospective_shadow";
  evidenceStatus: "opened_development_only" | "untouched" | "prospective";
  events: Array<{ eventId: string; startsAt: string }>;
};

export function buildNflMarketBrainResearchManifest(args: {
  candidateRelease: string;
  createdAt: string;
  partitions: NflMarketBrainResearchPartition[];
}) {
  requiredTimestamp(args.createdAt, "createdAt");
  if (!args.candidateRelease.trim()) throw new Error("NFL Market Brain manifest candidate release is required.");
  const expectedOrder: NflMarketBrainResearchPartition["role"][] =
    ["development", "selection", "confirmation", "prospective_shadow"];
  if (args.partitions.length !== expectedOrder.length ||
    args.partitions.some((partition, index) => partition.role !== expectedOrder[index])) {
    throw new Error("NFL Market Brain research manifest requires all chronological partitions in frozen order.");
  }
  let lastRole = -1;
  let priorMax = Number.NEGATIVE_INFINITY;
  const eventIds = new Set<string>();
  for (const partition of args.partitions) {
    const role = expectedOrder.indexOf(partition.role);
    if (role <= lastRole) throw new Error("NFL Market Brain research partitions are out of chronological role order.");
    lastRole = role;
    const times = partition.events.map((event) => {
      if (!event.eventId.trim() || eventIds.has(event.eventId)) {
        throw new Error("NFL Market Brain research manifest has a duplicate or empty event identity.");
      }
      eventIds.add(event.eventId);
      return requiredTimestamp(event.startsAt, `${partition.role}.startsAt`);
    });
    if (times.length > 0 && Math.min(...times) <= priorMax) {
      throw new Error("NFL Market Brain research partitions overlap or violate rolling chronology.");
    }
    if (times.length > 0) priorMax = Math.max(...times);
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
    createdAt: new Date(Date.parse(args.createdAt)).toISOString(),
    splitMethod: "rolling_origin_no_random_split" as const,
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
  if ((["away", "home", "tie"] as const).some((side) =>
    Math.abs(derivedProbabilities[side] - declaredProbabilities[side]) > 1e-9) ||
    Math.abs(marginMean - candidate.marginMean) > 1e-9 ||
    Math.abs(totalMean - candidate.totalMean) > 1e-9) {
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
  actualMargin: number;
  actualTotal: number;
  actualWinner: Winner;
}): Metrics {
  if (!Number.isFinite(args.marginMean) || !Number.isFinite(args.totalMean)) {
    throw new Error("NFL Market Brain projection moments are invalid.");
  }
  return {
    multiclassBrier: (Object.keys(args.probabilities) as Winner[]).reduce((sum, key) =>
      sum + (args.probabilities[key] - Number(key === args.actualWinner)) ** 2, 0),
    logLoss: -Math.log(Math.max(args.probabilities[args.actualWinner], 1e-15)),
    marginAbsoluteError: Math.abs(args.marginMean - args.actualMargin),
    totalAbsoluteError: Math.abs(args.totalMean - args.actualTotal),
    winnerCorrect: predictedWinner(args.probabilities) === args.actualWinner,
  };
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
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
