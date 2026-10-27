import assert from "node:assert/strict";

import {
  bindMarketBrainMarginTotalPrior,
  buildMarketBrainCase,
  referenceMarketBrainMarginTotalPrior,
} from "../lib/services/marketBrain/marketBrainContract";
import {
  buildNflMarketBrainResearchManifest,
  evaluateNflMarketBrainResearchCase,
  persistNflMarketBrainResearchManifest,
  persistVerifiedNflMarketBrainFinalOutcome,
  readNflMarketBrainResearchPrediction,
  summarizeNflMarketBrainResearchRun,
} from "../lib/services/marketBrain/nflMarketBrainResearchEvaluator";
import { materializeNflMarketBrainSequence, type NflMarketBrainSequence } from
  "../lib/services/marketBrain/nflMarketBrainSequenceMaterializer";
import { marketBrainCanonicalJson, marketBrainSha256 } from "../lib/services/marketBrain/marketBrainCanonical";
import { fixtureMarketBrainPriorInputLineage } from "./fixtures/marketBrainPriorInputLineage";

const cutoffAt = "2026-09-10T16:00:00.000Z";
const startsAt = "2026-09-10T20:00:00.000Z";
const trainedThrough = "2026-09-09T23:59:59.000Z";

async function main() {

const researchManifestDraft = buildNflMarketBrainResearchManifest({
  candidateRelease: "candidate-r1",
  createdAt: "2026-08-21T01:00:00.000Z",
  storageId: "manifest-fixture-1",
  purgeGapHours: 24,
  partitions: [
    { role: "development", evidenceStatus: "opened_development_only", events: [{
      eventId: "dev", foldId: "week-1", startsAt: "2026-08-20T20:00:00.000Z",
      cutoffAt: "2026-08-19T16:00:00.000Z",
      captureWindowOpensAt: "2026-08-19T12:00:00.000Z", captureWindowClosesAt: "2026-08-19T16:00:00.000Z",
      expectedCaptureAttempts: [{ runId: "00000000-0000-4000-8000-000000000001", stage: "t60", plannedAt: "2026-08-19T16:00:00.000Z" }],
      outcomeOpenedAt: "2026-08-21T00:00:00.000Z",
    }] },
    { role: "selection", evidenceStatus: "untouched", events: ["correction", "harm"].map((eventId) => ({
      eventId, foldId: "week-2", startsAt, cutoffAt, captureWindowOpensAt: cutoffAt,
      captureWindowClosesAt: cutoffAt,
      expectedCaptureAttempts: [{ runId: "00000000-0000-4000-8000-000000000002", stage: "t60" as const, plannedAt: cutoffAt }],
      outcomeOpenedAt: null,
    })) },
    { role: "confirmation", evidenceStatus: "untouched", events: [{
      eventId: "confirm", foldId: "week-3", startsAt: "2026-09-17T20:00:00.000Z",
      cutoffAt: "2026-09-17T16:00:00.000Z",
      captureWindowOpensAt: "2026-09-17T12:00:00.000Z", captureWindowClosesAt: "2026-09-17T16:00:00.000Z",
      expectedCaptureAttempts: [{ runId: "00000000-0000-4000-8000-000000000003", stage: "t60", plannedAt: "2026-09-17T16:00:00.000Z" }],
      outcomeOpenedAt: null,
    }] },
    { role: "prospective_shadow", evidenceStatus: "prospective", events: [{
      eventId: "future", foldId: "week-4", startsAt: "2026-09-24T20:00:00.000Z",
      cutoffAt: "2026-09-24T16:00:00.000Z",
      captureWindowOpensAt: "2026-09-24T12:00:00.000Z", captureWindowClosesAt: "2026-09-24T16:00:00.000Z",
      expectedCaptureAttempts: [{ runId: "00000000-0000-4000-8000-000000000004", stage: "t60", plannedAt: "2026-09-24T16:00:00.000Z" }],
      outcomeOpenedAt: null,
    }] },
  ],
});
const researchManifest = await persistNflMarketBrainResearchManifest({
  manifest: researchManifestDraft,
  client: manifestPersistenceClient(researchManifestDraft, "2026-08-21T02:00:00.000Z") as never,
});

async function candidate(args: {
  sequence: NflMarketBrainSequence;
  states: Array<{ margin: number; total: number; probability: number }>;
  marginMeanOverride?: number;
}) {
  const states = [...args.states].sort((a, b) => a.total - b.total || a.margin - b.margin);
  const marginal = (key: "margin" | "total") => {
    const mass = new Map<number, number>();
    for (const state of states) mass.set(state[key], (mass.get(state[key]) ?? 0) + state.probability);
    const entries = [...mass.entries()].sort((a, b) => a[0] - b[0]);
    return { values: entries.map(([value]) => value), probabilities: entries.map(([, probability]) => probability) };
  };
  const marginDistribution = marginal("margin");
  const totalDistribution = marginal("total");
  const mean = (distribution: typeof marginDistribution) => distribution.values.reduce((sum, value, index) =>
    sum + value * distribution.probabilities[index]!, 0);
  const marginMean = mean(marginDistribution);
  const totalMean = mean(totalDistribution);
  const awayWinProbability = states.filter((state) => state.margin < 0).reduce((sum, state) => sum + state.probability, 0);
  const homeWinProbability = states.filter((state) => state.margin > 0).reduce((sum, state) => sum + state.probability, 0);
  const tieProbability = states.filter((state) => state.margin === 0).reduce((sum, state) => sum + state.probability, 0);
  const posterior = {
    schema: "nfl_market_brain_joint_score_posterior_v1",
    states, marginDistribution, totalDistribution, marginMean, totalMean,
    awayWinProbability, homeWinProbability, tieProbability,
    awayScoreMean: (totalMean - marginMean) / 2,
    homeScoreMean: (totalMean + marginMean) / 2,
  };
  const prediction = {
    eventId: args.sequence.eventId, cutoffAt: args.sequence.cutoffAt, startsAt: args.sequence.startsAt,
    release: "candidate-r1", trainedThrough, inferredAt: "2026-09-10T16:01:00.000Z",
    resolverOutputChecksum: "7".repeat(64),
    researchInputRecordId: `input-${args.sequence.eventId}`,
    researchInputChecksum: "f".repeat(64), captureSetChecksum: "1".repeat(64),
    artifactSha256: "a".repeat(64), tournamentChecksum: "b".repeat(64),
    family: "regularized_joint_residual" as const,
    featureRelease: "feature-r1", featureChecksum: "c".repeat(64),
    trainingManifestChecksum: researchManifest.checksum, weightsSha256: "e".repeat(64), fittedParameterCount: 10,
    sequenceChecksum: args.sequence.checksum,
    awayWinProbability, homeWinProbability, tieProbability,
    marginMean: args.marginMeanOverride ?? marginMean, totalMean,
    marginDistribution, totalDistribution, jointScoreStates: states,
    jointPosteriorSha256: marketBrainSha256(posterior),
    zeroMarketPosterior: {
      awayWinProbability, homeWinProbability, tieProbability, marginMean, totalMean,
      marginDistribution, totalDistribution, jointScoreStates: states,
      jointPosteriorSha256: marketBrainSha256(posterior),
    },
  };
  return readNflMarketBrainResearchPrediction({
    predictionSha256: marketBrainSha256(prediction),
    client: predictionReadClient(prediction) as never,
  });
}

function sequence(eventId: string, homeProbability: number) {
  const prior = bindMarketBrainMarginTotalPrior({
    eventId,
    release: "nfl-prior-fixture-r1",
    availableAt: cutoffAt,
    inputLineage: fixtureMarketBrainPriorInputLineage({
      eventId, asOf: cutoffAt, modelRelease: "nfl-prior-fixture-r1",
    }),
    marginDistribution: { values: [-3, 3], probabilities: [1 - homeProbability, homeProbability] },
    totalDistribution: { values: [40, 44], probabilities: [0.5, 0.5] },
  });
  const marketCase = buildMarketBrainCase({
    sport: "nfl",
    eventId,
    evaluatedAt: cutoffAt,
    captureBoundary: "raw_provider_response",
    captureLimitations: [],
    subject: { kind: "two_team_game", awayId: "AWY", homeId: "HME", startsAt },
    prior,
    incumbentComparator: {
      kind: "released_semantic_reader",
      availableAt: cutoffAt,
      releases: { model: "released-model-r1", calibration: "released-calibration-r1", decision: "released-decision-r1" },
      awayWinProbability: 1 - homeProbability,
      homeWinProbability: homeProbability,
      tieProbability: 0,
      marginMean: prior.kind === "margin_total_distribution" ? prior.marginMean : 0,
      totalMean: prior.kind === "margin_total_distribution" ? prior.totalMean : 0,
      marginDistribution: prior.kind === "margin_total_distribution"
        ? structuredClone(prior.artifact.marginDistribution) : { values: [0], probabilities: [1] },
      totalDistribution: prior.kind === "margin_total_distribution"
        ? structuredClone(prior.artifact.totalDistribution) : { values: [0], probabilities: [1] },
      marginDistributionSha256: prior.kind === "margin_total_distribution"
        ? prior.marginDistributionSha256 : "a".repeat(64),
      totalDistributionSha256: prior.kind === "margin_total_distribution"
        ? prior.totalDistributionSha256 : "b".repeat(64),
    },
    evaluatedTargets: {
      spread: { identity: "fixture-spread", family: "targetbook", selection: "home", line: -2.5,
        price: -110, observedAt: cutoffAt },
      total: { identity: "fixture-total", family: "targetbook", selection: "over", line: 42.5,
        price: -110, observedAt: cutoffAt },
    },
    observations: [],
    sourceManifests: [],
    expectedInputs: [],
    blindSpots: [],
  });
  return { marketCase, materialized: materializeNflMarketBrainSequence({ cases: [marketCase], cutoffAt }) };
}

const correctionSequence = sequence("correction", 0.3);
const referenceCase = structuredClone(correctionSequence.marketCase);
referenceCase.evaluatedAt = "2026-09-10T16:30:00.000Z";
referenceCase.prior = correctionSequence.marketCase.prior.kind === "margin_total_distribution"
  ? referenceMarketBrainMarginTotalPrior(correctionSequence.marketCase.prior)
  : correctionSequence.marketCase.prior;
const referenceResolved = materializeNflMarketBrainSequence({
  cases: [correctionSequence.marketCase, referenceCase],
  cutoffAt: "2026-09-10T16:30:00.000Z",
});
assert.equal(referenceResolved.prior.kind, "margin_total_distribution",
  "content-addressed references must resolve to the exact earlier immutable PMF");
assert.throws(
  () => materializeNflMarketBrainSequence({ cases: [referenceCase], cutoffAt: "2026-09-10T16:30:00.000Z" }),
  /could not resolve/,
  "a prior reference without its immutable artifact must fail closed",
);
const correction = evaluateNflMarketBrainResearchCase({
  researchManifest, partitionRole: "selection",
  sequence: correctionSequence.materialized,
  candidate: await candidate({ sequence: correctionSequence.materialized, states: [
    { margin: -2, total: 42, probability: 0.15 }, { margin: -2, total: 44, probability: 0.15 },
    { margin: 4, total: 42, probability: 0.35 }, { margin: 4, total: 44, probability: 0.35 },
  ] }),
  outcome: await verifiedOutcome("correction", "2026-09-11T00:00:00.000Z", 20, 24),
});
assert.equal(correction.disagreement, "correction");
assert.equal(correction.baseline.winnerCorrect, false);
assert.equal(correction.candidate.winnerCorrect, true);
assert.equal(correction.incumbent.winnerCorrect, false);
assert.ok(correction.deltas.brierImprovement > 0);
assert.ok(correction.incumbentDeltas.brierImprovement > 0);
assert.ok(Number.isFinite(correction.candidate.marginTotalDistributionLogScore));
assert.equal(correction.baseline.marginTotalDistributionLogScore, null,
  "a marginal-only independent prior must not be assigned a fabricated joint score");
assert.equal(correction.deltas.marginTotalDistributionLogScoreImprovement, null,
  "joint-score improvement remains unavailable until the incumbent publishes a coherent joint posterior");
assert.ok(Math.abs(correction.deltas.marginMaeImprovement - 3.4) < 1e-9);
assert.equal(correction.candidate.exactLines.spread?.result, "win");
assert.equal(correction.candidate.exactLines.total?.result, "win");
assert.ok(correction.incumbent.exactLines.spread,
  "the released reader must be scored at the identical evaluated spread");
assert.ok(correction.incumbent.exactLines.total,
  "the released reader must be scored at the identical evaluated total");
assert.equal(correction.invariants.productionInfluenceAllowed, false);

const harmSequence = sequence("harm", 0.7);
const harm = evaluateNflMarketBrainResearchCase({
  researchManifest, partitionRole: "selection",
  sequence: harmSequence.materialized,
  candidate: await candidate({ sequence: harmSequence.materialized, states: [
    { margin: -2, total: 40, probability: 0.35 }, { margin: -2, total: 42, probability: 0.35 },
    { margin: 3, total: 41, probability: 0.15 }, { margin: 3, total: 43, probability: 0.15 },
  ] }),
  outcome: await verifiedOutcome("harm", "2026-09-11T00:00:00.000Z", 20, 24),
});
assert.equal(harm.disagreement, "harm");

const dependencyGood = evaluateNflMarketBrainResearchCase({
  researchManifest, partitionRole: "selection",
  sequence: correctionSequence.materialized,
  candidate: await candidate({ sequence: correctionSequence.materialized, states: [
    { margin: -2, total: 42, probability: 0.5 },
    { margin: 4, total: 44, probability: 0.5 },
  ] }),
  outcome: await verifiedOutcome("correction", "2026-09-11T00:00:00.000Z", 20, 24),
});
const dependencyWrong = evaluateNflMarketBrainResearchCase({
  researchManifest, partitionRole: "selection",
  sequence: correctionSequence.materialized,
  candidate: await candidate({ sequence: correctionSequence.materialized, states: [
    { margin: 4, total: 42, probability: 0.5 },
    { margin: -2, total: 44, probability: 0.5 },
  ] }),
  outcome: await verifiedOutcome("correction", "2026-09-11T00:00:00.000Z", 20, 24),
});
assert.equal(dependencyGood.candidate.marginalCompositeLogScore,
  dependencyWrong.candidate.marginalCompositeLogScore,
  "the dependency fixture must have identical Margin and Total marginals");
assert.ok(dependencyWrong.candidate.marginTotalDistributionLogScore! >
  dependencyGood.candidate.marginTotalDistributionLogScore!,
"joint scoring must penalize a wrong Margin/Total pairing that marginal scores cannot see");

const summary = summarizeNflMarketBrainResearchRun([correction, harm], researchManifest);
assert.deepEqual({ cases: summary.cases, corrections: summary.corrections, harms: summary.harms },
  { cases: 2, corrections: 1, harms: 1 });
assert.equal(summary.incumbentReleases.model, "released-model-r1");
assert.equal(summary.checksum.length, 64);
assert.throws(
  () => summarizeNflMarketBrainResearchRun(
    [correction, { ...harm, candidateRelease: "candidate-r2" }], researchManifest),
  /mixed releases/,
);
const postCutoffCandidate = await candidate({ sequence: correctionSequence.materialized, states: [
  { margin: -2, total: 42, probability: 0.3 }, { margin: 4, total: 44, probability: 0.7 },
] });
const cutoffOutcome = await verifiedOutcome("correction", cutoffAt, 20, 24);
assert.throws(
  () => evaluateNflMarketBrainResearchCase({
    researchManifest, partitionRole: "selection",
    sequence: correctionSequence.materialized,
    candidate: postCutoffCandidate,
    outcome: cutoffOutcome,
  }),
  /strictly after cutoff/,
  "outcomes available at or before the feature cutoff must be rejected",
);
const productionShapeOutcome = await verifiedOutcome("101", "2026-09-11T00:00:00.000Z", 20, 24);
assert.equal(productionShapeOutcome.eventId, "101");
assert.equal(productionShapeOutcome.source.gameRecordId, "1101");
await assert.rejects(
  () => candidate({ sequence: correctionSequence.materialized, states: [
      { margin: -2, total: 42, probability: 0.3 }, { margin: 4, total: 44, probability: 0.7 },
    ], marginMeanOverride: 4 }),
  /incoherent with its distributions/,
  "an incoherent candidate cannot enter the append-only prediction ledger",
);

const corruptedCase = structuredClone(correctionSequence.marketCase);
if (corruptedCase.prior.kind === "margin_total_distribution") {
  corruptedCase.prior.artifact.marginDistribution.probabilities[0] = 0.6;
}
assert.throws(
  () => materializeNflMarketBrainSequence({ cases: [corruptedCase], cutoffAt }),
  /checksum mismatch|mean mismatch|mass is invalid/,
  "materialization must re-verify persisted prior bytes rather than trusting a stored mean",
);

assert.equal(researchManifest.splitMethod, "rolling_origin_capture_window_purged_no_random_split");
assert.equal(researchManifest.invariants.openedEvidenceCannotQualifyAsConfirmation, true);
const openedPartitions = structuredClone(researchManifest.partitions);
openedPartitions[2]!.events[0]!.outcomeOpenedAt = "2026-09-18T00:00:00.000Z";
assert.throws(
  () => buildNflMarketBrainResearchManifest({
    candidateRelease: "candidate-r1",
    createdAt: researchManifest.createdAt,
    storageId: "tampered-opened-confirmation",
    purgeGapHours: 24,
    partitions: openedPartitions,
  }),
  /already opened/,
);

console.log("NFL Market Brain research evaluator: exact-prior baseline, post-cutoff labels, corrections/harms, release purity, and rolling chronology passed");

}

function manifestPersistenceClient(
  manifest: ReturnType<typeof buildNflMarketBrainResearchManifest>,
  serverCreatedAt: string,
) {
  const { checksum: _checksum, ...payload } = manifest;
  return {
    from() {
      return {
        insert() {
          return {
            select() {
              return { single: async () => ({ data: {
                id: manifest.storageId,
                manifest_checksum: manifest.checksum,
                manifest,
                manifest_payload: marketBrainCanonicalJson(payload),
                created_at: serverCreatedAt,
              }, error: null }) };
            },
          };
        },
      };
    },
  };
}

function predictionReadClient(prediction: Record<string, unknown>) {
  const predictionPayload = marketBrainCanonicalJson(prediction);
  return {
    from() {
      return {
        select() {
          return { eq() { return this; }, single: async () => ({ data: {
                id: `prediction-${String(prediction.eventId)}`,
                prediction_sha256: marketBrainSha256(prediction),
                prediction,
                prediction_payload: predictionPayload,
                created_at: "2026-09-10T16:02:00.000Z",
              }, error: null }) };
        },
      };
    },
  };
}

async function verifiedOutcome(eventId: string, finalAt: string, awayScore: number, homeScore: number) {
  let storedOutcome: Record<string, unknown> | null = null;
  const numericEventId = /^\d+$/.test(eventId) ? Number(eventId) : null;
  const client = {
    from(table: string) {
      if (table === "games") {
        return { select(fields: string) {
          assert.equal(fields, "id,external_id,sport,status,away_score,home_score,provider_ids,updated_at",
            "verified outcome reads must project the NFL sport identity included in canonical source bytes");
          return { eq() { return this; }, single: async () => ({ data: {
          id: numericEventId === null ? (eventId === "harm" ? "2" : "1") : numericEventId + 1000,
          external_id: numericEventId ?? eventId, status: "final",
          sport: "nfl",
          away_score: awayScore, home_score: homeScore, provider_ids: { balldontlie: eventId }, updated_at: finalAt,
        }, error: null }) }; } };
      }
      assert.equal(table, "nfl_market_brain_research_outcomes");
      return { insert(row: Record<string, unknown>) {
        if (numericEventId !== null) {
          const sourceRow = JSON.parse(String(row.source_row_payload)) as Record<string, unknown>;
          assert.equal(typeof sourceRow.id, "number");
          assert.equal(typeof sourceRow.externalId, "number");
          assert.equal(row.game_id, numericEventId + 1000);
          assert.equal(row.event_id, eventId);
        }
        storedOutcome = row.outcome as Record<string, unknown>; return {
        select() { return { single: async () => ({ data: {
          id: `outcome-${eventId}`, outcome_checksum: row.outcome_checksum,
          outcome: storedOutcome, outcome_payload: row.outcome_payload,
          created_at: "2026-09-12T00:00:00.000Z",
        }, error: null }) }; },
      }; } };
    },
  };
  return persistVerifiedNflMarketBrainFinalOutcome({ client: client as never, eventId });
}

void main();
