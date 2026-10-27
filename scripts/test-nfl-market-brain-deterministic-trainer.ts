import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  bindMarketBrainMarginTotalPrior,
  buildMarketBrainCase,
} from "../lib/services/marketBrain/marketBrainContract";
import { trainNflMarketBrainRegularizedJointResidual } from
  "../lib/services/marketBrain/nflMarketBrainDeterministicTrainer";
import {
  buildNflMarketBrainResearchManifest,
  persistNflMarketBrainResearchManifest,
} from "../lib/services/marketBrain/nflMarketBrainResearchEvaluator";
import { buildNflMarketBrainResolverFeatures } from
  "../lib/services/marketBrain/nflMarketBrainResolverFeatures";
import { materializeNflMarketBrainSequence } from
  "../lib/services/marketBrain/nflMarketBrainSequenceMaterializer";

const cutoffAt = "2026-08-19T16:00:00.000Z";
const startsAt = "2026-08-20T20:00:00.000Z";
const labelAvailableAt = "2026-08-21T00:00:00.000Z";
const developmentEvents = Array.from({ length: 744 }, (_, index) => ({
  eventId: `development-${String(index).padStart(3, "0")}`,
  foldId: index < 372 ? "development-week-a" : "development-week-b",
  startsAt,
  cutoffAt,
  firstCaptureAt: cutoffAt,
  lastCaptureAt: cutoffAt,
  outcomeOpenedAt: labelAvailableAt,
}));

async function main() {
  const draft = buildNflMarketBrainResearchManifest({
    candidateRelease: "trainer-fixture-r1",
    createdAt: "2026-08-21T01:00:00.000Z",
    storageId: "trainer-fixture-manifest",
    purgeGapHours: 24,
    partitions: [
      { role: "development", evidenceStatus: "opened_development_only", events: developmentEvents },
      { role: "selection", evidenceStatus: "untouched", events: [{
        eventId: "selection", foldId: "selection-week", startsAt: "2026-09-10T20:00:00.000Z",
        cutoffAt: "2026-09-10T16:00:00.000Z", firstCaptureAt: "2026-09-10T16:00:00.000Z",
        lastCaptureAt: "2026-09-10T16:00:00.000Z", outcomeOpenedAt: null,
      }] },
      { role: "confirmation", evidenceStatus: "untouched", events: [{
        eventId: "confirmation", foldId: "confirmation-week", startsAt: "2026-09-17T20:00:00.000Z",
        cutoffAt: "2026-09-17T16:00:00.000Z", firstCaptureAt: "2026-09-17T16:00:00.000Z",
        lastCaptureAt: "2026-09-17T16:00:00.000Z", outcomeOpenedAt: null,
      }] },
      { role: "prospective_shadow", evidenceStatus: "prospective", events: [{
        eventId: "prospective", foldId: "prospective-week", startsAt: "2026-09-24T20:00:00.000Z",
        cutoffAt: "2026-09-24T16:00:00.000Z", firstCaptureAt: "2026-09-24T16:00:00.000Z",
        lastCaptureAt: "2026-09-24T16:00:00.000Z", outcomeOpenedAt: null,
      }] },
    ],
  });
  const manifest = await persistNflMarketBrainResearchManifest({
    manifest: draft,
    client: { from() { return { insert() { return { select() { return { single: async () => ({ data: {
      id: draft.storageId, manifest_checksum: draft.checksum, manifest: draft,
      created_at: "2026-08-21T02:00:00.000Z",
    }, error: null }) }; } }; } }; } } as never,
  });
  const examples = developmentEvents.map((event, index) => {
    const prior = bindMarketBrainMarginTotalPrior({
      eventId: event.eventId,
      release: "trainer-independent-prior-r1",
      availableAt: cutoffAt,
      marginDistribution: { values: [-3, 3], probabilities: [0.5, 0.5] },
      totalDistribution: { values: [41, 45], probabilities: [0.5, 0.5] },
    });
    const marketCase = buildMarketBrainCase({
      sport: "nfl", eventId: event.eventId, evaluatedAt: cutoffAt,
      captureBoundary: "raw_provider_response", captureLimitations: [],
      subject: { kind: "two_team_game", awayId: "AWY", homeId: "HME", startsAt },
      prior, evaluatedTargets: {}, observations: [], sourceManifests: [], expectedInputs: [], blindSpots: [],
    });
    const sequence = materializeNflMarketBrainSequence({ cases: [marketCase], cutoffAt });
    return {
      sequence,
      features: buildNflMarketBrainResolverFeatures(sequence),
      outcome: index % 2 === 0
        ? { eventId: event.eventId, awayScore: 22, homeScore: 19, labelAvailableAt }
        : { eventId: event.eventId, awayScore: 21, homeScore: 24, labelAvailableAt },
    };
  });
  const first = trainNflMarketBrainRegularizedJointResidual({ manifest, examples, l2: 1 });
  const second = trainNflMarketBrainRegularizedJointResidual({ manifest, examples, l2: 1 });
  assert.equal(createHash("sha256").update(JSON.stringify(first)).digest("hex"),
    createHash("sha256").update(JSON.stringify(second)).digest("hex"),
    "fixed rows must produce byte-identical coefficients and provenance");
  assert.equal(first.weights.trainingRowsSha256.length, 64);
  assert.equal(first.weights.calibrationParameters.length, 0,
    "selection outcomes must not be repurposed as calibration parameters");
  assert.throws(() => trainNflMarketBrainRegularizedJointResidual({
    manifest, examples: examples.slice(1), l2: 1,
  }), /complete declared development partition/,
  "the fitter may not silently drop declared training rows");
  const contaminated = structuredClone(examples);
  contaminated[0]!.features.independentPrior.marginMean += 1;
  assert.throws(() => trainNflMarketBrainRegularizedJointResidual({ manifest, examples: contaminated, l2: 1 }),
    /exactly match the attested development manifest/,
    "a feature object not reproducible from its immutable sequence must fail closed");

  console.log("NFL Market Brain deterministic trainer: complete development-only membership, exact vectorization, and reproducible coefficients passed");
}

void main();
