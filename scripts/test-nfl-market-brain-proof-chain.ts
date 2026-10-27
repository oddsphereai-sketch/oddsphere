import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NFL_MARKET_BRAIN_SHADOW_RELEASE } from "../lib/services/football/nflMarketBrainShadow";
import { MARKET_BRAIN_CONTRACT_RELEASE, bindMarketBrainMarginTotalPrior, buildMarketBrainCase } from
  "../lib/services/marketBrain/marketBrainContract";
import { marketBrainCanonicalJson, marketBrainSha256 } from
  "../lib/services/marketBrain/marketBrainCanonical";
import { finalizeNflMarketBrainCaptureSet } from
  "../lib/services/marketBrain/nflMarketBrainCaptureSet";
import { materializeAndPersistNflMarketBrainResearchInput } from
  "../lib/services/marketBrain/nflMarketBrainResearchInput";
import {
  buildNflMarketBrainResearchManifest,
  persistNflMarketBrainResearchManifest,
} from "../lib/services/marketBrain/nflMarketBrainResearchEvaluator";

const eventId = "proof-chain-event";
const cutoffAt = "2026-10-20T16:00:00.000Z";
const startsAt = "2026-10-20T20:00:00.000Z";
const successRunId = "00000000-0000-4000-8000-000000000201";
const failureRunId = "00000000-0000-4000-8000-000000000202";

async function main() {
  const manifestDraft = buildNflMarketBrainResearchManifest({
    candidateRelease: "proof-chain-candidate-r1",
    createdAt: "2026-08-21T01:00:00.000Z",
    storageId: "proof-chain-manifest",
    purgeGapHours: 24,
    partitions: [
      { role: "development", evidenceStatus: "opened_development_only", events: [manifestEvent(
        "development", "2026-08-19T16:00:00.000Z", "2026-08-20T20:00:00.000Z",
        "00000000-0000-4000-8000-000000000200", "2026-08-21T00:00:00.000Z") ] },
      { role: "selection", evidenceStatus: "untouched", events: [{
        eventId, foldId: "selection-week", startsAt, cutoffAt,
        captureWindowOpensAt: "2026-10-20T12:00:00.000Z", captureWindowClosesAt: cutoffAt,
        expectedCaptureAttempts: [
          { runId: successRunId, stage: "unlocked", plannedAt: "2026-10-20T15:00:00.000Z" },
          { runId: failureRunId, stage: "unlocked", plannedAt: "2026-10-20T15:30:00.000Z" },
        ],
        outcomeOpenedAt: null,
      }] },
      { role: "confirmation", evidenceStatus: "untouched", events: [manifestEvent(
        "confirmation", "2026-10-27T16:00:00.000Z", "2026-10-27T20:00:00.000Z",
        "00000000-0000-4000-8000-000000000203", null)] },
      { role: "prospective_shadow", evidenceStatus: "prospective", events: [manifestEvent(
        "prospective", "2026-11-03T16:00:00.000Z", "2026-11-03T20:00:00.000Z",
        "00000000-0000-4000-8000-000000000204", null)] },
    ],
  });
  const manifest = await persistNflMarketBrainResearchManifest({
    client: manifestClient(manifestDraft) as never,
    manifest: manifestDraft,
  });

  const prior = bindMarketBrainMarginTotalPrior({
    eventId,
    release: "proof-chain-independent-r1",
    availableAt: "2026-10-20T15:00:00.000Z",
    marginDistribution: { values: [-3, 3], probabilities: [0.5, 0.5] },
    totalDistribution: { values: [41, 45], probabilities: [0.5, 0.5] },
  });
  const marketCase = buildMarketBrainCase({
    sport: "nfl", eventId, evaluatedAt: "2026-10-20T15:00:00.000Z",
    captureBoundary: "raw_provider_response", captureLimitations: [],
    subject: { kind: "two_team_game", awayId: "AWY", homeId: "HME", startsAt },
    prior, evaluatedTargets: {}, observations: [], sourceManifests: [], expectedInputs: [], blindSpots: [],
  });
  const success = { release: NFL_MARKET_BRAIN_SHADOW_RELEASE,
    capturedAt: "2026-10-20T15:00:00.000Z", case: marketCase, bytes: 0 };
  for (let previous = -1; previous !== success.bytes;) {
    previous = success.bytes;
    success.bytes = Buffer.byteLength(JSON.stringify(success), "utf8");
  }
  const failure = { release: NFL_MARKET_BRAIN_SHADOW_RELEASE,
    contractRelease: MARKET_BRAIN_CONTRACT_RELEASE, status: "capture_failed" as const,
    productionApplied: false as const, eventId, capturedAt: "2026-10-20T15:30:00.000Z", reason: "provider_timeout" };
  const rows = [
    storedRow("00000000-0000-4000-8000-000000000301", successRunId, "2026-10-20T15:00:00.000Z", success),
    storedRow("00000000-0000-4000-8000-000000000302", failureRunId, "2026-10-20T15:30:00.000Z", failure),
  ];

  await assert.rejects(
    () => finalizeNflMarketBrainCaptureSet({
      client: proofClient(rows.slice(0, 1)) as never, researchManifest: manifest,
      partitionRole: "selection", eventId,
    }),
    /incomplete/,
    "a missing scheduled attempt must block finalization rather than masquerade as no movement",
  );
  const lateRows = rows.map((row, index) => index === 1
    ? { ...row, created_at: "2026-10-20T16:00:01.000Z" }
    : row);
  await assert.rejects(
    () => finalizeNflMarketBrainCaptureSet({
      client: proofClient(lateRows) as never, researchManifest: manifest,
      partitionRole: "selection", eventId,
    }),
    /server-receipt window mismatch/,
    "a backdated client capture timestamp must not hide a post-window server receipt",
  );
  const client = proofClient(rows);
  const captureSet = await finalizeNflMarketBrainCaptureSet({
    client: client as never, researchManifest: manifest, partitionRole: "selection", eventId,
  });
  assert.deepEqual({ successful: captureSet.successfulCaptures, failed: captureSet.failedCaptures },
    { successful: 1, failed: 1 });
  await assert.rejects(() => materializeAndPersistNflMarketBrainResearchInput({
    client: client as never, captureSet: structuredClone(captureSet) as typeof captureSet,
  }), /server-finalized complete capture-set receipt/,
  "a copied receipt must lose its private database-completeness attestation");
  const input = await materializeAndPersistNflMarketBrainResearchInput({ client: client as never, captureSet });
  assert.equal(input.captureSetChecksum, captureSet.checksum);
  assert.equal(input.sequenceChecksum, input.sequence.checksum);
  assert.equal(input.featureChecksum, input.features.checksum);
  assert.equal(input.sequence.accounting.inputCases, 1);

  const migration = readFileSync("lib/db/schema-migration-v46-nfl-market-brain-proof-boundary.sql", "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.nfl_market_brain_capture_sets/);
  assert.match(migration, /refuses to replace nonempty legacy v45 tables/);
  assert.match(migration, /UNIQUE \(\s*event_id, shadow_release, contract_release, manifest_checksum, partition_role,/);
  assert.match(migration, /jsonb_path_query_array\(capture_set -> 'membership'/);
  assert.match(migration, /reject_nfl_market_brain_late_capture/);
  assert.match(migration, /jsonb_array_length\(NEW\.capture_set -> 'expectedCaptureAttempts'\)/);
  assert.match(migration, /jsonb_typeof\(shadow #> '\{case,subject\}'\) = 'object'/,
    "the database boundary must reject checksum-consistent partial success cases");
  assert.match(migration, /\{case,invariants,productionInfluenceAllowed\}.*IS FALSE/,
    "success cases must retain their no-production-authority invariant at rest");
  assert.match(migration, /s\.created_at NOT BETWEEN NEW\.window_opens_at AND NEW\.window_closes_at/);
  assert.match(migration, /manifest\.created_at < NEW\.window_opens_at/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.nfl_market_brain_research_inputs/);
  assert.match(migration, /research_input\.created_at <= \(NEW\.prediction ->> 'inferredAt'\)::timestamptz/);
  assert.match(migration, /conrelid = 'public\.nfl_market_brain_research_predictions'::regclass/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.nfl_market_brain_research_outcomes/);

  console.log("NFL Market Brain proof chain: predeclared attempts, DB-complete success/failure receipt, durable sequence/features, and late-row freeze passed");
}

function manifestEvent(event: string, cutoff: string, starts: string, runId: string, outcomeOpenedAt: string | null) {
  return {
    eventId: event, foldId: `${event}-week`, startsAt: starts, cutoffAt: cutoff,
    captureWindowOpensAt: cutoff, captureWindowClosesAt: cutoff,
    expectedCaptureAttempts: [{ runId, stage: "t60" as const, plannedAt: cutoff }], outcomeOpenedAt,
  };
}

function manifestClient(manifest: ReturnType<typeof buildNflMarketBrainResearchManifest>) {
  const { checksum: _checksum, ...payload } = manifest;
  return { from() { return { insert() { return { select() { return { single: async () => ({ data: {
    id: manifest.storageId, manifest_checksum: manifest.checksum, manifest,
    manifest_payload: marketBrainCanonicalJson(payload), created_at: "2026-08-21T02:00:00.000Z",
  }, error: null }) }; } }; } }; } };
}

function storedRow(id: string, runId: string, capturedAt: string, shadow: Record<string, unknown>) {
  return {
    id, run_id: "00000000-0000-4000-8000-000000000999", capture_attempt_id: runId,
    season: 2026, week: 8, provider_game_id: eventId, stage: "unlocked",
    captured_at: capturedAt, created_at: capturedAt, shadow,
    shadow_sha256: marketBrainSha256(shadow), shadow_payload: marketBrainCanonicalJson(shadow),
    bytes: Buffer.byteLength(marketBrainCanonicalJson(shadow), "utf8"),
    prior_artifact_sha256: "case" in shadow &&
      (shadow.case as { prior: { kind: string; artifact?: { sha256: string } } }).prior.kind === "margin_total_distribution"
      ? (shadow.case as { prior: { artifact: { sha256: string } } }).prior.artifact.sha256 : null,
  };
}

function proofClient(rows: Array<Record<string, unknown>>) {
  return {
    from(table: string) {
      if (table === "nfl_market_brain_shadow_snapshots") {
        return { select() { return { eq() { return this; }, gte() { return this; }, lte() { return this; },
          order() { return this; }, abortSignal() { return this; },
          range: async () => ({ data: rows, error: null }) }; } };
      }
      if (table === "nfl_market_brain_prior_artifacts") {
        const artifacts = rows.flatMap((row) => {
          const shadow = row.shadow as { case?: { prior?: { kind: string; artifact?: { sha256: string } } } };
          const artifact = shadow.case?.prior?.artifact;
          return artifact ? [{ artifact_sha256: artifact.sha256, prior_artifact: artifact }] : [];
        });
        return { select() { return { in() { return this; }, gt: async () => ({ data: artifacts, error: null }) }; } };
      }
      if (table === "nfl_market_brain_capture_sets") {
        return { insert(row: Record<string, unknown>) { return { select() { return { single: async () => ({ data: {
          id: "00000000-0000-4000-8000-000000000401", capture_set_checksum: row.capture_set_checksum,
          capture_set: row.capture_set, capture_set_payload: row.capture_set_payload,
          created_at: "2026-10-20T16:05:00.000Z",
        }, error: null }) }; } }; } };
      }
      if (table === "nfl_market_brain_research_inputs") {
        return { insert(row: Record<string, unknown>) { return { select() { return { single: async () => ({ data: {
          id: "00000000-0000-4000-8000-000000000402", research_input_checksum: row.research_input_checksum,
          research_input: row.research_input, research_input_payload: row.research_input_payload,
          created_at: "2026-10-20T16:06:00.000Z",
        }, error: null }) }; } }; } };
      }
      throw new Error(`Unexpected proof-chain table ${table}`);
    },
  };
}

void main();
