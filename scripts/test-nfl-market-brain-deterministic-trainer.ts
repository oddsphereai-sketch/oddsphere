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
import {
  NFL_MARKET_BRAIN_FIXTURE_EVENT_IDS,
  NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE,
  fixtureMarketBrainPriorDistributions,
  fixtureMarketBrainPriorInputLineage,
} from
  "./fixtures/marketBrainPriorInputLineage";

const cutoffAt = "2026-09-09T16:00:00.000Z";
const startsAt = "2026-09-10T20:00:00.000Z";
const labelAvailableAt = "2026-09-11T00:00:00.000Z";
const developmentEvents = Array.from({ length: 8 }, (_, index) => ({
  eventId: NFL_MARKET_BRAIN_FIXTURE_EVENT_IDS[index]!,
  foldId: index < 4 ? "development-week-a" : "development-week-b",
  startsAt: index < 4 ? "2026-09-03T20:00:00.000Z" : startsAt,
  cutoffAt: index < 4 ? "2026-09-02T16:00:00.000Z" : cutoffAt,
  captureWindowOpensAt: index < 4 ? "2026-09-02T16:00:00.000Z" : cutoffAt,
  captureWindowClosesAt: index < 4 ? "2026-09-02T16:00:00.000Z" : cutoffAt,
  expectedCaptureAttempts: [{ runId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    stage: "t60" as const, plannedAt: index < 4 ? "2026-09-02T16:00:00.000Z" : cutoffAt }],
  outcomeOpenedAt: index < 4 ? "2026-09-04T00:00:00.000Z" : labelAvailableAt,
}));

async function main() {
  const draft = buildNflMarketBrainResearchManifest({
    candidateRelease: "trainer-fixture-r1",
    createdAt: "2026-09-12T01:00:00.000Z",
    storageId: "trainer-fixture-manifest",
    purgeGapHours: 24,
    partitions: [
      { role: "development", evidenceStatus: "opened_development_only", events: developmentEvents },
      { role: "selection", evidenceStatus: "untouched", events: [{
        eventId: "selection", foldId: "selection-week", startsAt: "2026-10-08T20:00:00.000Z",
        cutoffAt: "2026-10-08T16:00:00.000Z", captureWindowOpensAt: "2026-10-08T16:00:00.000Z",
        captureWindowClosesAt: "2026-10-08T16:00:00.000Z",
        expectedCaptureAttempts: [{ runId: "00000000-0000-4000-8000-000000000101", stage: "t60", plannedAt: "2026-10-08T16:00:00.000Z" }], outcomeOpenedAt: null,
      }] },
      { role: "confirmation", evidenceStatus: "untouched", events: [{
        eventId: "confirmation", foldId: "confirmation-week", startsAt: "2026-10-15T20:00:00.000Z",
        cutoffAt: "2026-10-15T16:00:00.000Z", captureWindowOpensAt: "2026-10-15T16:00:00.000Z",
        captureWindowClosesAt: "2026-10-15T16:00:00.000Z",
        expectedCaptureAttempts: [{ runId: "00000000-0000-4000-8000-000000000102", stage: "t60", plannedAt: "2026-10-15T16:00:00.000Z" }], outcomeOpenedAt: null,
      }] },
      { role: "prospective_shadow", evidenceStatus: "prospective", events: [{
        eventId: "prospective", foldId: "prospective-week", startsAt: "2026-10-22T20:00:00.000Z",
        cutoffAt: "2026-10-22T16:00:00.000Z", captureWindowOpensAt: "2026-10-22T16:00:00.000Z",
        captureWindowClosesAt: "2026-10-22T16:00:00.000Z",
        expectedCaptureAttempts: [{ runId: "00000000-0000-4000-8000-000000000103", stage: "t60", plannedAt: "2026-10-22T16:00:00.000Z" }], outcomeOpenedAt: null,
      }] },
    ],
  });
  const manifest = await persistNflMarketBrainResearchManifest({
    manifest: draft,
    client: { from() { return { insert() { return { select() { return { single: async () => ({ data: {
      id: draft.storageId, manifest_checksum: draft.checksum, manifest: draft,
      manifest_payload: marketBrainCanonicalJson(Object.fromEntries(
        Object.entries(draft).filter(([key]) => key !== "checksum"))),
      created_at: "2026-09-12T02:00:00.000Z",
    }, error: null }) }; } }; } }; } } as never,
  });
  const examples = developmentEvents.map((event, index) => {
    const priorDistributions = fixtureMarketBrainPriorDistributions(event.eventId);
    const prior = bindMarketBrainMarginTotalPrior({
      eventId: event.eventId,
      release: NFL_MARKET_BRAIN_FIXTURE_PRIOR_RELEASE,
      availableAt: event.cutoffAt,
      inputLineage: fixtureMarketBrainPriorInputLineage({
        eventId: event.eventId, asOf: event.cutoffAt,
      }),
      ...priorDistributions,
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
