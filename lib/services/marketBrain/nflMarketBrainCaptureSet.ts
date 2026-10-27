import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readNflMarketBrainStoredShadowCaptures,
  type NflMarketBrainStoredShadowCapture,
} from "@/lib/services/football/nflMarketBrainShadowStore";
import { NFL_MARKET_BRAIN_SHADOW_RELEASE } from "@/lib/services/football/nflMarketBrainShadow";
import { MARKET_BRAIN_CONTRACT_RELEASE } from "./marketBrainContract";
import {
  MARKET_BRAIN_CANONICAL_JSON_RELEASE,
  marketBrainCanonicalJson,
  marketBrainSha256,
} from "./marketBrainCanonical";
import {
  assertNflMarketBrainAttestedResearchManifest,
  type NflMarketBrainAttestedResearchManifest,
  type NflMarketBrainResearchPartition,
} from "./nflMarketBrainResearchEvaluator";

export const NFL_MARKET_BRAIN_CAPTURE_SET_RELEASE =
  "nfl_market_brain_capture_set_2026_10_27_r6_independent_prior_input_lineage" as const;

export type NflMarketBrainCaptureSet = {
  release: typeof NFL_MARKET_BRAIN_CAPTURE_SET_RELEASE;
  eventId: string;
  shadowRelease: typeof NFL_MARKET_BRAIN_SHADOW_RELEASE;
  contractRelease: typeof MARKET_BRAIN_CONTRACT_RELEASE;
  partitionRole: NflMarketBrainResearchPartition["role"];
  foldId: string;
  manifestChecksum: string;
  captureWindowOpensAt: string;
  captureWindowClosesAt: string;
  cutoffAt: string;
  startsAt: string;
  expectedCaptureAttempts: NflMarketBrainResearchPartition["events"][number]["expectedCaptureAttempts"];
  membership: Array<{
    recordId: string;
    runId: string;
    stage: "opening" | "unlocked" | "t60";
    capturedAt: string;
    serverCreatedAt: string;
    shadowSha256: string;
    status: "captured" | "capture_failed";
  }>;
  successfulCaptures: number;
  failedCaptures: number;
  checksum: string;
};

export type NflMarketBrainAttestedCaptureSet = NflMarketBrainCaptureSet & {
  readonly persistenceAttestation: {
    recordId: string;
    serverCreatedAt: string;
    captureSetChecksum: string;
  };
};

const attestedCaptureSets = new WeakSet<object>();
const sourceCaptures = new WeakMap<object, NflMarketBrainStoredShadowCapture[]>();

type StoredCaptureSetRow = {
  id: string;
  capture_set_checksum: string;
  capture_set: unknown;
  capture_set_payload: string;
  created_at: string;
};

export async function finalizeNflMarketBrainCaptureSet(args: {
  client: SupabaseClient;
  researchManifest: NflMarketBrainAttestedResearchManifest;
  partitionRole: NflMarketBrainResearchPartition["role"];
  eventId: string;
  signal?: AbortSignal;
}): Promise<NflMarketBrainAttestedCaptureSet> {
  assertNflMarketBrainAttestedResearchManifest(args.researchManifest);
  const partition = args.researchManifest.partitions.find((row) => row.role === args.partitionRole);
  const event = partition?.events.find((row) => row.eventId === args.eventId);
  if (!partition || !event) throw new Error("NFL Market Brain capture set event is absent from its manifest partition.");
  const captures = await readNflMarketBrainStoredShadowCaptures({
    client: args.client,
    eventId: event.eventId,
    windowOpensAt: event.captureWindowOpensAt,
    windowClosesAt: event.captureWindowClosesAt,
    signal: args.signal,
  });
  // Preserve the persisted manifest bytes exactly. Membership is compared as
  // a set below, but the receipt must not silently reorder the precommit.
  const expected = [...event.expectedCaptureAttempts];
  const actualAttemptKeys = captures.map((row) => `${row.runId}|${row.stage}`);
  const expectedAttemptKeys = expected.map((row) => `${row.runId}|${row.stage}`);
  if (captures.length !== expected.length || new Set(actualAttemptKeys).size !== actualAttemptKeys.length ||
    marketBrainCanonicalJson([...actualAttemptKeys].sort()) !==
      marketBrainCanonicalJson([...expectedAttemptKeys].sort())) {
    throw new Error("NFL Market Brain capture set is incomplete or contains an undeclared capture attempt.");
  }
  for (const row of captures) {
    const resultEventId = "case" in row.captureResult ? row.captureResult.case.eventId : row.captureResult.eventId;
    const serverCreatedAt = Date.parse(row.serverCreatedAt);
    if (row.providerGameId !== event.eventId || resultEventId !== event.eventId ||
      serverCreatedAt < Date.parse(event.captureWindowOpensAt) ||
      serverCreatedAt > Date.parse(event.captureWindowClosesAt)) {
      throw new Error("NFL Market Brain capture set contains an event identity or server-receipt window mismatch.");
    }
  }
  const membership = captures.map((row) => ({
    recordId: row.recordId,
    runId: row.runId,
    stage: row.stage,
    capturedAt: row.capturedAt,
    serverCreatedAt: row.serverCreatedAt,
    shadowSha256: row.shadowSha256,
    status: "case" in row.captureResult ? "captured" as const : "capture_failed" as const,
  })).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.recordId.localeCompare(b.recordId));
  const withoutChecksum = {
    release: NFL_MARKET_BRAIN_CAPTURE_SET_RELEASE,
    eventId: event.eventId,
    shadowRelease: NFL_MARKET_BRAIN_SHADOW_RELEASE,
    contractRelease: MARKET_BRAIN_CONTRACT_RELEASE,
    partitionRole: partition.role,
    foldId: event.foldId,
    manifestChecksum: args.researchManifest.checksum,
    captureWindowOpensAt: event.captureWindowOpensAt,
    captureWindowClosesAt: event.captureWindowClosesAt,
    cutoffAt: event.cutoffAt,
    startsAt: event.startsAt,
    expectedCaptureAttempts: expected,
    membership,
    successfulCaptures: membership.filter((row) => row.status === "captured").length,
    failedCaptures: membership.filter((row) => row.status === "capture_failed").length,
  };
  const captureSet: NflMarketBrainCaptureSet = {
    ...withoutChecksum,
    checksum: marketBrainSha256(withoutChecksum),
  };
  let query = args.client.from("nfl_market_brain_capture_sets").insert({
    canonical_release: MARKET_BRAIN_CANONICAL_JSON_RELEASE,
    capture_set_checksum: captureSet.checksum,
    capture_set_release: captureSet.release,
    event_id: captureSet.eventId,
    shadow_release: captureSet.shadowRelease,
    contract_release: captureSet.contractRelease,
    manifest_checksum: captureSet.manifestChecksum,
    partition_role: captureSet.partitionRole,
    fold_id: captureSet.foldId,
    window_opens_at: captureSet.captureWindowOpensAt,
    window_closes_at: captureSet.captureWindowClosesAt,
    cutoff_at: captureSet.cutoffAt,
    starts_at: captureSet.startsAt,
    expected_capture_attempts: captureSet.expectedCaptureAttempts.length,
    successful_captures: captureSet.successfulCaptures,
    failed_captures: captureSet.failedCaptures,
    capture_set: captureSet,
    capture_set_payload: marketBrainCanonicalJson(withoutChecksum),
  }).select("id,capture_set_checksum,capture_set,capture_set_payload,created_at");
  if (args.signal) query = query.abortSignal(args.signal);
  const { data, error } = await query.single();
  if (error) throw new Error(`NFL Market Brain capture-set finalization failed: ${error.message}`);
  return attestCaptureSet(data as StoredCaptureSetRow | null, captureSet, captures);
}

export function assertNflMarketBrainAttestedCaptureSet(
  captureSet: NflMarketBrainCaptureSet,
): asserts captureSet is NflMarketBrainAttestedCaptureSet {
  const { checksum, persistenceAttestation: _receipt, ...payload } = captureSet as
    NflMarketBrainAttestedCaptureSet;
  const attested = captureSet as NflMarketBrainAttestedCaptureSet;
  if (!attestedCaptureSets.has(captureSet) || !attested.persistenceAttestation ||
    checksum !== marketBrainSha256(payload) ||
    attested.persistenceAttestation.captureSetChecksum !== checksum ||
    Date.parse(attested.persistenceAttestation.serverCreatedAt) < Date.parse(captureSet.captureWindowClosesAt) ||
    Date.parse(attested.persistenceAttestation.serverCreatedAt) >= Date.parse(captureSet.startsAt)) {
    throw new Error("NFL Market Brain research requires a server-finalized complete capture-set receipt.");
  }
}

export function nflMarketBrainCaptureSetSourceCaptures(
  captureSet: NflMarketBrainAttestedCaptureSet,
): NflMarketBrainStoredShadowCapture[] {
  assertNflMarketBrainAttestedCaptureSet(captureSet);
  const captures = sourceCaptures.get(captureSet);
  if (!captures) throw new Error("NFL Market Brain capture-set source rows are no longer available for materialization.");
  return structuredClone(captures);
}

function attestCaptureSet(
  row: StoredCaptureSetRow | null,
  expected: NflMarketBrainCaptureSet,
  captures: NflMarketBrainStoredShadowCapture[],
): NflMarketBrainAttestedCaptureSet {
  if (!row || typeof row.capture_set !== "object" || row.capture_set === null) {
    throw new Error("NFL Market Brain capture-set persistence returned no verifiable row.");
  }
  const stored = row.capture_set as NflMarketBrainCaptureSet;
  const { checksum, ...payload } = stored;
  if (checksum !== row.capture_set_checksum || checksum !== expected.checksum ||
    row.capture_set_payload !== marketBrainCanonicalJson(payload) ||
    checksum !== marketBrainSha256(payload) ||
    marketBrainCanonicalJson(stored) !== marketBrainCanonicalJson(expected)) {
    throw new Error("NFL Market Brain stored capture set differs from its exact finalized database membership.");
  }
  const attested = {
    ...structuredClone(stored),
    persistenceAttestation: {
      recordId: row.id,
      serverCreatedAt: new Date(row.created_at).toISOString(),
      captureSetChecksum: row.capture_set_checksum,
    },
  } as NflMarketBrainAttestedCaptureSet;
  attestedCaptureSets.add(attested);
  sourceCaptures.set(attested, structuredClone(captures));
  Object.freeze(attested);
  assertNflMarketBrainAttestedCaptureSet(attested);
  return attested;
}
