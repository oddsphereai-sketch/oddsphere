import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { NflForwardEvidencePayload } from "../lib/services/football/nflForwardEvidence";
import {
  appendNflMarketBrainShadows,
  hashNflMarketBrainShadow,
} from "../lib/services/football/nflMarketBrainShadowStore";
import { NFL_MARKET_BRAIN_SHADOW_RELEASE } from "../lib/services/football/nflMarketBrainShadow";

const shadow = {
  release: NFL_MARKET_BRAIN_SHADOW_RELEASE,
  status: "capture_failed" as const,
  productionApplied: false as const,
  eventId: "event-1",
  capturedAt: "2026-10-27T12:00:00.000Z",
  reason: "fixture",
};
const payload = {
  runId: "00000000-0000-0000-0000-000000000001",
  season: 2026,
  week: 8,
  stage: "unlocked",
  capturedAt: shadow.capturedAt,
  game: { providerGameId: shadow.eventId },
  marketBrainShadow: shadow,
} as unknown as NflForwardEvidencePayload;

const inserted: Array<Record<string, unknown>> = [];
const client = {
  from(table: string) {
    assert.equal(table, "nfl_market_brain_shadow_snapshots");
    return {
      insert(rows: Array<Record<string, unknown>>) {
        inserted.push(...rows);
        return {
          abortSignal() { return this; },
          select: async () => ({ data: rows.map((_, index) => ({ id: `row-${index}` })), error: null }),
        };
      },
    };
  },
};

async function main() {
  const dry = await appendNflMarketBrainShadows({
    client: client as never,
    runId: payload.runId,
    payloads: [payload],
    apply: false,
  });
  assert.deepEqual({ proposed: dry.proposed, inserted: dry.inserted }, { proposed: 1, inserted: 0 });
  assert.equal(inserted.length, 0);

  const write = await appendNflMarketBrainShadows({
    client: client as never,
    runId: payload.runId,
    payloads: [payload],
    apply: true,
  });
  assert.deepEqual({ proposed: write.proposed, inserted: write.inserted }, { proposed: 1, inserted: 1 });
  assert.equal(inserted[0]?.shadow_sha256, hashNflMarketBrainShadow(shadow));
  assert.equal(inserted[0]?.shadow, shadow);
  assert.equal(inserted[0]?.prior_artifact_sha256, null);
  assert.equal(inserted[0]?.contract_release, shadow.release.startsWith("nfl_market_brain_shadow")
    ? "market_brain_contract_2026_10_27_r7_availability_bound_evidence" : null);

  const writer = readFileSync(path.resolve("lib/services/football/nflForwardEvidenceWriter.ts"), "utf8");
  const authoritativeAppend = writer.indexOf("appendNflForwardEvidence({");
  const shadowAppend = writer.indexOf("appendNflMarketBrainShadows({");
  assert.ok(authoritativeAppend >= 0 && shadowAppend > writer.lastIndexOf("writeOfficialTrackingFromPayloads({"),
    "authoritative, member, and tracking writes must complete before research persistence is attempted");
  assert.match(writer, /const authoritativePayloads = payloads\.map\(withoutMarketBrainShadow\)/);
  assert.match(writer, /marketBrainWriteError/);
  assert.match(writer, /readNflMarketBrainPriorArtifactIndex/);
  assert.match(writer, /AbortController[\s\S]*2_000/,
    "the optional research index read must have a hard latency bound");
  assert.match(writer, /appendNflMarketBrainShadows\([\s\S]*signal: writeAbort\.signal/,
    "the optional research append must have a hard abort boundary");
  assert.match(writer, /marketBrainCaptureEnabled/,
    "research capture must be explicitly enabled rather than silently activating on merge");
  const authoritativeStore = readFileSync(path.resolve("lib/services/football/nflForwardEvidenceStore.ts"), "utf8");
  assert.match(authoritativeStore, /Market Brain sidecars are forbidden from authoritative NFL evidence writes/,
    "the authoritative store must fail closed if a future caller forgets to strip the research sidecar");

  const store = readFileSync(path.resolve("lib/services/football/nflMarketBrainShadowStore.ts"), "utf8");
  assert.match(store, /select\("provider_game_id,prior_artifact_sha256"\)/,
    "the writer-side continuity read must load only the lightweight prior hash index");
  assert.doesNotMatch(store, /select\("[^"]*shadow[^"]*"\)/,
    "routine writer continuity must never reread full research JSON tapes");
  assert.match(store, /\.eq\("shadow_release", NFL_MARKET_BRAIN_SHADOW_RELEASE\)/);
  assert.match(store, /\.eq\("contract_release", MARKET_BRAIN_CONTRACT_RELEASE\)/);

  const route = readFileSync(path.resolve("app/api/cron/nfl-forward-evidence/route.ts"), "utf8");
  assert.match(route, /NFL_MARKET_BRAIN_SHADOW_CAPTURE_ENABLED/);
  assert.match(route, /market_brain_persistence_error: result\.marketBrainPersistenceError/);

  const migration = readFileSync(path.resolve("lib/db/schema-migration-v45-nfl-market-brain-shadow.sql"), "utf8");
  assert.match(migration, /bytes integer NOT NULL CHECK \(bytes > 0 AND bytes <= 98304\)/);
  assert.match(migration, /contract_release text NOT NULL/);
  assert.match(migration, /268435456/);
  assert.match(migration, /expires_at timestamptz NOT NULL/);
  assert.match(migration, /nfl_market_brain_shadow_prior_artifact/);
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.nfl_market_brain_shadow_snapshots TO service_role/);
  assert.doesNotMatch(migration.replace(/--[^\n]*/g, ""),
    /GRANT[^;]*(UPDATE|DELETE)[^;]*nfl_market_brain_shadow_snapshots/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.nfl_market_brain_research_manifests/);
  assert.match(migration, /octet_length\(manifest::text\) <= 2097152/);
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.nfl_market_brain_research_manifests TO service_role/);
  assert.doesNotMatch(migration.replace(/--[^\n]*/g, ""),
    /GRANT[^;]*(UPDATE|DELETE)[^;]*nfl_market_brain_research_manifests/i);

  console.log("NFL Market Brain isolated append-only shadow store and authoritative-write failure boundary passed");
}

void main();
