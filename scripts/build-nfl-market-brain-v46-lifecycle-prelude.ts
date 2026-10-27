import { marketBrainCanonicalJson, marketBrainSha256 } from "../lib/services/marketBrain/marketBrainCanonical";

const base = new Date(Math.floor(Date.now() / 1_000) * 1_000);
const at = (offsetMs: number) => new Date(base.getTime() + offsetMs).toISOString();
const attemptId = "00000000-0000-4000-8000-000000000102";
const captureId = "00000000-0000-4000-8000-000000000103";
const inputId = "00000000-0000-4000-8000-000000000104";
const shadowId = "00000000-0000-4000-8000-000000000101";
const eventId = "proof-event";
const sequenceSha = "1".repeat(64);
const featureSha = "2".repeat(64);
const resolverSha = "3".repeat(64);

const manifestPayload = {
  storageId: "proof-manifest",
  candidateRelease: "proof-candidate",
  release: "proof-manifest-release",
  createdAt: at(-10 * 60_000),
  partitions: [{
    role: "prospective_shadow",
    events: [{
      eventId,
      captureWindowOpensAt: at(-9 * 60_000),
      captureWindowClosesAt: at(-8 * 60_000),
      cutoffAt: at(-7 * 60_000),
      startsAt: at(10 * 60_000),
      expectedCaptureAttempts: [{ runId: attemptId, stage: "unlocked" }],
    }],
  }],
};
const manifestSha = marketBrainSha256(manifestPayload);
const shadow = {
  release: "proof-shadow-release",
  contractRelease: "proof-contract-release",
  status: "capture_failed",
  productionApplied: false,
  eventId,
  capturedAt: at(-8.5 * 60_000),
  reason: "proof-fixture",
};
const shadowSha = marketBrainSha256(shadow);
const successShadow = {
  release: "proof-shadow-release",
  capturedAt: at(-5 * 60_000),
  case: {
    release: "proof-contract-release",
    sport: "nfl",
    eventId: "proof-success-event",
    evaluatedAt: at(-4 * 60_000),
  },
  bytes: 1,
};
const successShadowSha = marketBrainSha256(successShadow);
const capturePayload = {
  release: "proof-capture-set-release",
  eventId,
  shadowRelease: "proof-shadow-release",
  contractRelease: "proof-contract-release",
  manifestChecksum: manifestSha,
  partitionRole: "prospective_shadow",
  foldId: "proof-fold",
  captureWindowOpensAt: at(-9 * 60_000),
  captureWindowClosesAt: at(-8 * 60_000),
  cutoffAt: at(-7 * 60_000),
  startsAt: at(10 * 60_000),
  expectedCaptureAttempts: [{ runId: attemptId, stage: "unlocked" }],
  membership: [{
    recordId: shadowId,
    runId: attemptId,
    stage: "unlocked",
    shadowSha256: shadowSha,
    capturedAt: at(-8.5 * 60_000),
    serverCreatedAt: at(-8.5 * 60_000),
    status: "capture_failed",
  }],
  successfulCaptures: 0,
  failedCaptures: 1,
};
const captureSha = marketBrainSha256(capturePayload);
const inputPayload = {
  release: "proof-input-release",
  eventId,
  cutoffAt: at(-7 * 60_000),
  startsAt: at(10 * 60_000),
  manifestChecksum: manifestSha,
  captureSetRecordId: captureId,
  captureSetChecksum: captureSha,
  sequenceChecksum: sequenceSha,
  featureChecksum: featureSha,
  sequence: {
    release: "proof-sequence-release",
    checksum: sequenceSha,
    eventId,
    cutoffAt: at(-7 * 60_000),
    startsAt: at(10 * 60_000),
  },
  features: {
    release: "proof-feature-release",
    checksum: featureSha,
    eventId,
    cutoffAt: at(-7 * 60_000),
    inputSequenceChecksum: sequenceSha,
    inputSequenceRelease: "proof-sequence-release",
  },
};
const inputSha = marketBrainSha256(inputPayload);
const weights = { intercept: 0 };
const weightsSha = marketBrainSha256(weights);
const artifactPayload = {
  release: "proof-artifact-release",
  weightsSha256: weightsSha,
  trainingManifestChecksum: manifestSha,
};
const artifactSha = marketBrainSha256(artifactPayload);
const prediction = {
  eventId,
  cutoffAt: at(-7 * 60_000),
  startsAt: at(10 * 60_000),
  inferredAt: at(-6 * 60_000),
  release: "proof-candidate",
  artifactSha256: artifactSha,
  trainingManifestChecksum: manifestSha,
  researchInputRecordId: inputId,
  researchInputChecksum: inputSha,
  captureSetChecksum: captureSha,
  resolverOutputChecksum: resolverSha,
  sequenceChecksum: sequenceSha,
  featureChecksum: featureSha,
};
const outcomeSource = {
  id: 9001,
  externalId: 900100,
  sport: "nfl",
  status: "final",
  awayScore: 17,
  homeScore: 20,
  providerIds: { balldontlie: "900100" },
  updatedAt: at(-60_000),
};
const outcomeSourceSha = marketBrainSha256(outcomeSource);
const outcomePayload = {
  eventId: String(outcomeSource.externalId),
  finalAt: outcomeSource.updatedAt,
  awayScore: outcomeSource.awayScore,
  homeScore: outcomeSource.homeScore,
  source: {
    table: "games",
    gameRecordId: String(outcomeSource.id),
    providerIds: outcomeSource.providerIds,
    sourceUpdatedAt: outcomeSource.updatedAt,
    sourceRowSha256: outcomeSourceSha,
  },
};

const fixtures: Array<[string, string, string]> = [
  ["base_time", base.toISOString(), ""],
  ["manifest", marketBrainCanonicalJson(manifestPayload), manifestSha],
  ["shadow", marketBrainCanonicalJson(shadow), shadowSha],
  ["success_shadow", marketBrainCanonicalJson(successShadow), successShadowSha],
  ["capture", marketBrainCanonicalJson(capturePayload), captureSha],
  ["input", marketBrainCanonicalJson(inputPayload), inputSha],
  ["weights", marketBrainCanonicalJson(weights), weightsSha],
  ["artifact", marketBrainCanonicalJson(artifactPayload), artifactSha],
  ["prediction", marketBrainCanonicalJson(prediction), marketBrainSha256(prediction)],
  ["outcome_source", marketBrainCanonicalJson(outcomeSource), outcomeSourceSha],
  ["outcome", marketBrainCanonicalJson(outcomePayload), marketBrainSha256(outcomePayload)],
];

function literal(value: string): string {
  if (value.includes("$market_brain_fixture$")) throw new Error("fixture contains SQL quote delimiter");
  return `$market_brain_fixture$${value}$market_brain_fixture$`;
}

process.stdout.write([
  "CREATE TEMP TABLE market_brain_lifecycle_fixture (name text PRIMARY KEY, payload text NOT NULL, sha256 text NOT NULL);",
  ...fixtures.map(([name, payload, sha]) =>
    `INSERT INTO market_brain_lifecycle_fixture VALUES (${literal(name)}, ${literal(payload)}, ${literal(sha)});`),
  "",
].join("\n"));
