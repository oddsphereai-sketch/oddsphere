import assert from "node:assert/strict";

import {
  bindMarketBrainMarginTotalPrior,
  buildMarketBrainCase,
  referenceMarketBrainMarginTotalPrior,
} from "../lib/services/marketBrain/marketBrainContract";
import {
  buildNflMarketBrainResearchManifest,
  evaluateNflMarketBrainResearchCase,
  summarizeNflMarketBrainResearchRun,
} from "../lib/services/marketBrain/nflMarketBrainResearchEvaluator";
import { materializeNflMarketBrainSequence } from "../lib/services/marketBrain/nflMarketBrainSequenceMaterializer";

const cutoffAt = "2026-09-10T16:00:00.000Z";
const startsAt = "2026-09-10T20:00:00.000Z";
const trainedThrough = "2026-09-09T23:59:59.000Z";

function sequence(eventId: string, homeProbability: number) {
  const prior = bindMarketBrainMarginTotalPrior({
    eventId,
    release: "nfl-prior-fixture-r1",
    availableAt: cutoffAt,
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
    evaluatedTargets: {},
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
  sequence: correctionSequence.materialized,
  candidate: {
    release: "candidate-r1",
    trainedThrough,
    sequenceChecksum: correctionSequence.materialized.checksum,
    awayWinProbability: 0.3,
    homeWinProbability: 0.7,
    tieProbability: 0,
    marginMean: 2.2,
    totalMean: 43,
    marginDistribution: { values: [-2, 4], probabilities: [0.3, 0.7] },
    totalDistribution: { values: [42, 44], probabilities: [0.5, 0.5] },
  },
  outcome: { eventId: "correction", finalAt: "2026-09-11T00:00:00.000Z", awayScore: 20, homeScore: 24 },
});
assert.equal(correction.disagreement, "correction");
assert.equal(correction.baseline.winnerCorrect, false);
assert.equal(correction.candidate.winnerCorrect, true);
assert.ok(correction.deltas.brierImprovement > 0);
assert.ok(Math.abs(correction.deltas.marginMaeImprovement - 3.4) < 1e-9);
assert.equal(correction.invariants.productionInfluenceAllowed, false);

const harmSequence = sequence("harm", 0.7);
const harm = evaluateNflMarketBrainResearchCase({
  sequence: harmSequence.materialized,
  candidate: {
    release: "candidate-r1",
    trainedThrough,
    sequenceChecksum: harmSequence.materialized.checksum,
    awayWinProbability: 0.7,
    homeWinProbability: 0.3,
    tieProbability: 0,
    marginMean: -0.5,
    totalMean: 41,
    marginDistribution: { values: [-2, 3], probabilities: [0.7, 0.3] },
    totalDistribution: { values: [40, 42], probabilities: [0.5, 0.5] },
  },
  outcome: { eventId: "harm", finalAt: "2026-09-11T00:00:00.000Z", awayScore: 20, homeScore: 24 },
});
assert.equal(harm.disagreement, "harm");

const summary = summarizeNflMarketBrainResearchRun([correction, harm]);
assert.deepEqual({ cases: summary.cases, corrections: summary.corrections, harms: summary.harms },
  { cases: 2, corrections: 1, harms: 1 });
assert.equal(summary.checksum.length, 64);
assert.throws(
  () => summarizeNflMarketBrainResearchRun([correction, { ...harm, candidateRelease: "candidate-r2" }]),
  /mixed releases/,
);
assert.throws(
  () => evaluateNflMarketBrainResearchCase({
    sequence: correctionSequence.materialized,
    candidate: {
      release: "candidate-r1", trainedThrough, sequenceChecksum: correctionSequence.materialized.checksum,
      awayWinProbability: 0.3, homeWinProbability: 0.7, tieProbability: 0, marginMean: 2.2, totalMean: 43,
      marginDistribution: { values: [-2, 4], probabilities: [0.3, 0.7] },
      totalDistribution: { values: [42, 44], probabilities: [0.5, 0.5] },
    },
    outcome: { eventId: "correction", finalAt: cutoffAt, awayScore: 20, homeScore: 24 },
  }),
  /strictly after cutoff/,
  "outcomes available at or before the feature cutoff must be rejected",
);
assert.throws(
  () => evaluateNflMarketBrainResearchCase({
    sequence: correctionSequence.materialized,
    candidate: {
      release: "candidate-r1", trainedThrough, sequenceChecksum: correctionSequence.materialized.checksum,
      awayWinProbability: 0.3, homeWinProbability: 0.7, tieProbability: 0, marginMean: 4, totalMean: 43,
      marginDistribution: { values: [-2, 4], probabilities: [0.3, 0.7] },
      totalDistribution: { values: [42, 44], probabilities: [0.5, 0.5] },
    },
    outcome: { eventId: "correction", finalAt: "2026-09-11T00:00:00.000Z", awayScore: 20, homeScore: 24 },
  }),
  /incoherent with its distributions/,
  "a candidate cannot publish point estimates that disagree with its joint-state marginals",
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

const manifest = buildNflMarketBrainResearchManifest({
  candidateRelease: "candidate-r1",
  createdAt: "2026-10-27T12:00:00.000Z",
  partitions: [
    { role: "development", evidenceStatus: "opened_development_only", events: [{ eventId: "dev", startsAt: "2026-09-01T20:00:00.000Z" }] },
    { role: "selection", evidenceStatus: "untouched", events: [{ eventId: "select", startsAt: "2026-09-08T20:00:00.000Z" }] },
    { role: "confirmation", evidenceStatus: "untouched", events: [{ eventId: "confirm", startsAt: "2026-09-15T20:00:00.000Z" }] },
    { role: "prospective_shadow", evidenceStatus: "prospective", events: [{ eventId: "future", startsAt: "2026-09-22T20:00:00.000Z" }] },
  ],
});
assert.equal(manifest.splitMethod, "rolling_origin_no_random_split");
assert.equal(manifest.invariants.openedEvidenceCannotQualifyAsConfirmation, true);
assert.throws(
  () => buildNflMarketBrainResearchManifest({
    candidateRelease: "candidate-r1",
    createdAt: "2026-10-27T12:00:00.000Z",
    partitions: [
      { role: "development", evidenceStatus: "opened_development_only", events: [{ eventId: "later", startsAt: "2026-09-20T20:00:00.000Z" }] },
      { role: "confirmation", evidenceStatus: "untouched", events: [{ eventId: "earlier", startsAt: "2026-09-10T20:00:00.000Z" }] },
    ],
  }),
  /partitions|overlap|chronology/,
);

console.log("NFL Market Brain research evaluator: exact-prior baseline, post-cutoff labels, corrections/harms, release purity, and rolling chronology passed");
