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
import { marketBrainCanonicalJson } from "../lib/services/marketBrain/marketBrainCanonical";

const cutoffAt = "2026-08-19T16:00:00.000Z";
const startsAt = "2026-08-20T20:00:00.000Z";
const labelAvailableAt = "2026-08-21T00:00:00.000Z";
const developmentEvents = Array.from({ length: 8 }, (_, index) => ({
  eventId: `development-${String(index).padStart(3, "0")}`,
  foldId: index < 4 ? "development-week-a" : "development-week-b",
  startsAt: index < 4 ? "2026-08-13T20:00:00.000Z" : startsAt,
  cutoffAt: index < 4 ? "2026-08-12T16:00:00.000Z" : cutoffAt,
  firstCaptureAt: index < 4 ? "2026-08-12T16:00:00.000Z" : cutoffAt,
  lastCaptureAt: index < 4 ? "2026-08-12T16:00:00.000Z" : cutoffAt,
  outcomeOpenedAt: index < 4 ? "2026-08-14T00:00:00.000Z" : labelAvailableAt,
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
      manifest_payload: marketBrainCanonicalJson(Object.fromEntries(
        Object.entries(draft).filter(([key]) => key !== "checksum"))),
      created_at: "2026-08-21T02:00:00.000Z",
    }, error: null }) }; } }; } }; } } as never,
  });
  const examples = developmentEvents.map((event, index) => {
    const prior = bindMarketBrainMarginTotalPrior({
      eventId: event.eventId,
      release: "trainer-independent-prior-r1",
      availableAt: event.cutoffAt,
      marginDistribution: { values: [-3, 3], probabilities: [0.5, 0.5] },
      totalDistribution: { values: [41, 45], probabilities: [0.5, 0.5] },
    });
    const marketCase = buildMarketBrainCase({
      sport: "nfl", eventId: event.eventId, evaluatedAt: event.cutoffAt,
      captureBoundary: "raw_provider_response", captureLimitations: [],
      subject: { kind: "two_team_game", awayId: "AWY", homeId: "HME", startsAt: event.startsAt },
      prior, evaluatedTargets: {}, observations: [], sourceManifests: [], expectedInputs: [], blindSpots: [],
    });
    const sequence = materializeNflMarketBrainSequence({ cases: [marketCase], cutoffAt: event.cutoffAt });
    return {
      sequence,
      features: buildNflMarketBrainResolverFeatures(sequence),
      outcome: index % 2 === 0
        ? { eventId: event.eventId, awayScore: 22, homeScore: 19, labelAvailableAt: event.outcomeOpenedAt }
        : { eventId: event.eventId, awayScore: 21, homeScore: 24, labelAvailableAt: event.outcomeOpenedAt },
    };
  });
  const first = trainNflMarketBrainRegularizedJointResidual({ manifest, examples });
  const second = trainNflMarketBrainRegularizedJointResidual({ manifest, examples });
  assert.equal(createHash("sha256").update(JSON.stringify(first)).digest("hex"),
    createHash("sha256").update(JSON.stringify(second)).digest("hex"),
    "fixed rows must produce byte-identical coefficients and provenance");
  assert.equal(first.weights.trainingRowsSha256.length, 64);
  assert.equal(first.weights.calibrationParameters.length, 0,
    "selection outcomes must not be repurposed as calibration parameters");
  assert.equal(first.weights.tournamentTranscript.mode, "rolling_origin_development_only");
  assert.equal(first.weights.tournamentTranscript.selectedL2, first.weights.selectedL2);
  assert.equal(first.weights.tournamentTranscript.folds.length, 1);
  assert.throws(() => trainNflMarketBrainRegularizedJointResidual({
    manifest, examples: examples.slice(1),
  }), /complete declared development partition/,
  "the fitter may not silently drop declared training rows");
  const contaminated = structuredClone(examples);
  contaminated[0]!.features.independentPrior.marginMean += 1;
  assert.throws(() => trainNflMarketBrainRegularizedJointResidual({ manifest, examples: contaminated }),
    /exactly match the attested development manifest/,
    "a feature object not reproducible from its immutable sequence must fail closed");

  console.log("NFL Market Brain deterministic trainer: complete development-only membership, exact vectorization, and reproducible coefficients passed");
}

void main();
