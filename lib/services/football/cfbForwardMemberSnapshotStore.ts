import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MEMBER_RELEASE,
} from "./cfbForwardEvidence";
import {
  CFB_MEMBER_FIXTURE_RELEASE,
  type CfbMemberFixture,
} from "./cfbMemberFixture";

export const CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE =
  "cfb_forward_member_snapshot_2026_09_04_r3_evidence_identity_continuity" as const;

const SNAPSHOT_TTL_MS = 90 * 60 * 1000;
const SNAPSHOT_STALE_MS = 8 * 60 * 60 * 1000;
const TABLE_MISSING_RE = /relation .*lab_response_snapshots.* does not exist|schema cache/i;

export type CfbForwardMemberSnapshot = {
  snapshotRelease: typeof CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE;
  evidenceRelease: typeof CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE;
  memberRelease: typeof CFB_FORWARD_MEMBER_RELEASE;
  fixtureRelease: typeof CFB_MEMBER_FIXTURE_RELEASE;
  season: number;
  sourceCapturedAt: string;
  publishedAt: string;
  sourceChecksum: string;
  fixture: CfbMemberFixture;
};

type SnapshotRow = {
  payload: unknown;
};

export function cfbForwardMemberSnapshotKey(input: { season: number }): string {
  return [
    "cfb",
    "daily-edge",
    input.season,
    CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE,
    CFB_MEMBER_FIXTURE_RELEASE,
    CFB_FORWARD_MEMBER_RELEASE,
  ].join("::");
}

export function buildCfbForwardMemberSnapshot(input: {
  fixture: CfbMemberFixture;
  season: number;
  publishedAt: string;
}): CfbForwardMemberSnapshot {
  if (input.fixture.fixtureRelease !== CFB_MEMBER_FIXTURE_RELEASE) {
    throw new Error("CFB compact member snapshot fixture release mismatch.");
  }
  if (input.fixture.snapshot.sport !== "cfb" || input.fixture.snapshot.games.length === 0) {
    throw new Error("CFB compact member snapshot must contain a CFB slate.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.fixture.provenance.sourceChecksum)) {
    throw new Error("CFB compact member snapshot source checksum is invalid.");
  }
  return {
    snapshotRelease: CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE,
    evidenceRelease: CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
    memberRelease: CFB_FORWARD_MEMBER_RELEASE,
    fixtureRelease: CFB_MEMBER_FIXTURE_RELEASE,
    season: input.season,
    sourceCapturedAt: input.fixture.capturedAt,
    publishedAt: new Date(input.publishedAt).toISOString(),
    sourceChecksum: input.fixture.provenance.sourceChecksum,
    fixture: input.fixture,
  };
}

export async function writeCfbForwardMemberSnapshot(input: {
  client: SupabaseClient;
  snapshot: CfbForwardMemberSnapshot;
}): Promise<{ ok: true; snapshotKey: string } | { ok: false; snapshotKey: string; error: string }> {
  const snapshotKey = cfbForwardMemberSnapshotKey(input.snapshot);
  const publishedAtMs = Date.parse(input.snapshot.publishedAt);
  const { error } = await input.client.from("lab_response_snapshots").upsert({
    snapshot_key: snapshotKey,
    kind: "daily_edge",
    sport: "cfb",
    slate_date: input.snapshot.fixture.snapshot.date,
    payload: input.snapshot,
    payload_version: CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE,
    source: "cfb_forward_evidence_writer",
    generated_at: input.snapshot.publishedAt,
    expires_at: new Date(publishedAtMs + SNAPSHOT_TTL_MS).toISOString(),
    stale_until: new Date(publishedAtMs + SNAPSHOT_STALE_MS).toISOString(),
    updated_at: input.snapshot.publishedAt,
  }, { onConflict: "snapshot_key" });
  if (error) return { ok: false, snapshotKey, error: error.message };
  return { ok: true, snapshotKey };
}

export async function readCfbForwardMemberSnapshot(input: {
  client: SupabaseClient;
  season: number;
  now?: string;
}): Promise<CfbForwardMemberSnapshot | null> {
  const now = input.now ? new Date(input.now).toISOString() : new Date().toISOString();
  const { data, error } = await input.client
    .from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", cfbForwardMemberSnapshotKey(input))
    .gt("stale_until", now)
    .maybeSingle();
  if (error) {
    if (TABLE_MISSING_RE.test(error.message)) return null;
    throw new Error(`CFB compact member snapshot read failed: ${error.message}`);
  }
  if (!data) return null;
  return validateCfbForwardMemberSnapshot((data as SnapshotRow).payload, input);
}

function validateCfbForwardMemberSnapshot(
  value: unknown,
  expected: { season: number },
): CfbForwardMemberSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<CfbForwardMemberSnapshot>;
  if (
    snapshot.snapshotRelease !== CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE ||
    snapshot.evidenceRelease !== CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE ||
    snapshot.memberRelease !== CFB_FORWARD_MEMBER_RELEASE ||
    snapshot.fixtureRelease !== CFB_MEMBER_FIXTURE_RELEASE ||
    snapshot.season !== expected.season ||
    snapshot.fixture?.fixtureRelease !== CFB_MEMBER_FIXTURE_RELEASE ||
    snapshot.fixture?.snapshot?.sport !== "cfb" ||
    snapshot.fixture?.snapshot?.games?.length === 0 ||
    snapshot.fixture?.capturedAt !== snapshot.sourceCapturedAt ||
    snapshot.fixture?.provenance?.sourceChecksum !== snapshot.sourceChecksum ||
    !Number.isFinite(Date.parse(snapshot.sourceCapturedAt ?? "")) ||
    !Number.isFinite(Date.parse(snapshot.publishedAt ?? "")) ||
    !/^[a-f0-9]{64}$/.test(snapshot.sourceChecksum ?? "")
  ) return null;
  return snapshot as CfbForwardMemberSnapshot;
}
