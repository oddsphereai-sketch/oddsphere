import assert from "node:assert/strict";

import {
  buildNflMarketBrainResearchManifest,
  evaluateNflMarketBrainResearchCase,
  readNflMarketBrainResearchManifest,
} from "../lib/services/marketBrain/nflMarketBrainResearchEvaluator";
import { persistNflMarketBrainResearchManifest } from
  "../lib/services/marketBrain/nflMarketBrainResearchManifestStore";

const manifest = buildNflMarketBrainResearchManifest({
  candidateRelease: "candidate-store-fixture-r1",
  createdAt: "2026-08-21T01:00:00.000Z",
  storageId: "manifest-store-fixture-1",
  purgeGapHours: 24,
  partitions: [
    { role: "development", evidenceStatus: "opened_development_only", events: [{
      eventId: "dev", foldId: "week-1", startsAt: "2026-08-20T20:00:00.000Z",
      cutoffAt: "2026-08-19T16:00:00.000Z",
      firstCaptureAt: "2026-08-19T12:00:00.000Z", lastCaptureAt: "2026-08-19T16:00:00.000Z",
      outcomeOpenedAt: "2026-08-21T00:00:00.000Z",
    }] },
    { role: "selection", evidenceStatus: "untouched", events: [{
      eventId: "selection", foldId: "week-2", startsAt: "2026-09-10T20:00:00.000Z",
      cutoffAt: "2026-09-10T16:00:00.000Z",
      firstCaptureAt: "2026-09-10T12:00:00.000Z", lastCaptureAt: "2026-09-10T16:00:00.000Z",
      outcomeOpenedAt: null,
    }] },
    { role: "confirmation", evidenceStatus: "untouched", events: [{
      eventId: "confirmation", foldId: "week-3", startsAt: "2026-09-17T20:00:00.000Z",
      cutoffAt: "2026-09-17T16:00:00.000Z",
      firstCaptureAt: "2026-09-17T12:00:00.000Z", lastCaptureAt: "2026-09-17T16:00:00.000Z",
      outcomeOpenedAt: null,
    }] },
    { role: "prospective_shadow", evidenceStatus: "prospective", events: [{
      eventId: "prospective", foldId: "week-4", startsAt: "2026-09-24T20:00:00.000Z",
      cutoffAt: "2026-09-24T16:00:00.000Z",
      firstCaptureAt: "2026-09-24T12:00:00.000Z", lastCaptureAt: "2026-09-24T16:00:00.000Z",
      outcomeOpenedAt: null,
    }] },
  ],
});

let inserted: Record<string, unknown> | null = null;
const client = {
  from(table: string) {
    assert.equal(table, "nfl_market_brain_research_manifests");
    return {
      insert(row: Record<string, unknown>) {
        inserted = row;
        return {
          select(columns: string) {
            assert.equal(columns, "id,manifest_checksum,manifest,created_at");
            return {
              abortSignal() { return this; },
              single: async () => ({ data: {
                id: row.id,
                manifest_checksum: row.manifest_checksum,
                manifest: row.manifest,
                created_at: "2026-08-21T02:00:00.000Z",
              }, error: null }),
            };
          },
        };
      },
    };
  },
};

async function main() {
  const persisted = await persistNflMarketBrainResearchManifest({ client: client as never, manifest });
  assert.equal(inserted?.["manifest_checksum"], manifest.checksum);
  assert.equal(persisted.persistenceAttestation.recordId, manifest.storageId);
  assert.equal(persisted.persistenceAttestation.manifestChecksum, manifest.checksum);
  assert.equal(Object.isFrozen(persisted), true);

  const reloaded = await readNflMarketBrainResearchManifest({
    client: {
      from() {
        return { select() { return {
          eq() { return this; },
          single: async () => ({ data: {
            id: manifest.storageId,
            manifest_checksum: manifest.checksum,
            manifest,
            created_at: "2026-08-21T02:00:00.000Z",
          }, error: null }),
        }; } };
      },
    } as never,
    storageId: manifest.storageId,
    checksum: manifest.checksum,
  });
  assert.equal(reloaded.checksum, persisted.checksum,
    "the private attestation must be recreated only from an exact database row after process restart");

  const forged = structuredClone(persisted) as typeof persisted;
  assert.throws(
    () => evaluateNflMarketBrainResearchCase({
      researchManifest: forged,
      partitionRole: "selection",
      sequence: {} as never,
      candidate: {} as never,
      outcome: {} as never,
    }),
    /append-only persistence attestation/,
    "a structurally copied manifest must lose the private runtime persistence brand",
  );

  await assert.rejects(
    () => persistNflMarketBrainResearchManifest({
      client: {
        from() {
          return { insert() { return { select() { return { single: async () => ({ data: {
            id: manifest.storageId,
            manifest_checksum: manifest.checksum,
            manifest,
            created_at: "2026-09-10T12:00:00.000Z",
          }, error: null }) }; } }; } };
        },
      } as never,
      manifest,
    }),
    /does not match its append-only persistence record/,
    "a server receipt at or after prospective capture must fail closed",
  );

  console.log("NFL Market Brain append-only research manifest persistence and runtime attestation passed");
}

void main();
