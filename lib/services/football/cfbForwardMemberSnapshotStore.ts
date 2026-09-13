import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
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
  "cfb_forward_member_snapshot_2026_09_13_r11_gzip_transport" as const;

export const CFB_FORWARD_MEMBER_SNAPSHOT_MAX_JSON_BYTES = 8_000_000;
export const CFB_FORWARD_MEMBER_SNAPSHOT_MAX_GZIP_BYTES = 1_000_000;
const CFB_FORWARD_MEMBER_SNAPSHOT_MAX_BASE64_CHARACTERS =
  4 * Math.ceil(CFB_FORWARD_MEMBER_SNAPSHOT_MAX_GZIP_BYTES / 3);

const SNAPSHOT_TTL_MS = 90 * 60 * 1000;
const SNAPSHOT_STALE_MS = 8 * 24 * 60 * 60 * 1000;
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

export type CfbForwardMemberSnapshotEnvelope = {
  kind: "cfb_forward_member_snapshot_v1";
  envelopeRelease: typeof CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE;
  encoding: "gzip-base64";
  checksum: string;
  snapshotRelease: typeof CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE;
  season: number;
  publishedAt: string;
  uncompressedBytes: number;
  compressedBytes: number;
  payload: string;
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
  const payload = encodeCfbForwardMemberSnapshotPayload(input.snapshot);
  const { error } = await input.client.from("lab_response_snapshots").upsert({
    snapshot_key: snapshotKey,
    kind: "daily_edge",
    sport: "cfb",
    slate_date: input.snapshot.fixture.snapshot.date,
    payload,
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
    .maybeSingle();
  if (error) {
    if (TABLE_MISSING_RE.test(error.message)) return null;
    throw new Error(`CFB compact member snapshot read failed: ${error.message}`);
  }
  if (!data) return null;
  const snapshot = decodeCfbForwardMemberSnapshotPayload((data as SnapshotRow).payload);
  return validateCfbForwardMemberSnapshot(snapshot, { ...input, now });
}

export function encodeCfbForwardMemberSnapshotPayload(
  snapshot: CfbForwardMemberSnapshot,
): CfbForwardMemberSnapshotEnvelope {
  const json = JSON.stringify(snapshot);
  const uncompressedBytes = Buffer.byteLength(json);
  if (uncompressedBytes > CFB_FORWARD_MEMBER_SNAPSHOT_MAX_JSON_BYTES) {
    throw new Error(
      `CFB compact member snapshot exceeds the ${CFB_FORWARD_MEMBER_SNAPSHOT_MAX_JSON_BYTES}-byte JSON limit.`,
    );
  }
  const compressed = gzipSync(Buffer.from(json), { level: 9 });
  if (compressed.byteLength > CFB_FORWARD_MEMBER_SNAPSHOT_MAX_GZIP_BYTES) {
    throw new Error(
      `CFB compact member snapshot exceeds the ${CFB_FORWARD_MEMBER_SNAPSHOT_MAX_GZIP_BYTES}-byte gzip limit.`,
    );
  }
  return {
    kind: "cfb_forward_member_snapshot_v1",
    envelopeRelease: CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE,
    encoding: "gzip-base64",
    checksum: createHash("sha256").update(json).digest("hex"),
    snapshotRelease: snapshot.snapshotRelease,
    season: snapshot.season,
    publishedAt: snapshot.publishedAt,
    uncompressedBytes,
    compressedBytes: compressed.byteLength,
    payload: compressed.toString("base64"),
  };
}

export function decodeCfbForwardMemberSnapshotPayload(
  value: unknown,
): CfbForwardMemberSnapshot | null {
  if (!isCfbForwardMemberSnapshotEnvelope(value)) return null;
  if (
    value.uncompressedBytes > CFB_FORWARD_MEMBER_SNAPSHOT_MAX_JSON_BYTES ||
    value.compressedBytes > CFB_FORWARD_MEMBER_SNAPSHOT_MAX_GZIP_BYTES ||
    value.payload.length > CFB_FORWARD_MEMBER_SNAPSHOT_MAX_BASE64_CHARACTERS ||
    value.payload.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.payload)
  ) return null;
  try {
    const compressed = Buffer.from(value.payload, "base64");
    if (compressed.byteLength !== value.compressedBytes) return null;
    const decoded = gunzipSync(compressed, {
      maxOutputLength: CFB_FORWARD_MEMBER_SNAPSHOT_MAX_JSON_BYTES,
    });
    if (decoded.byteLength !== value.uncompressedBytes) return null;
    const json = decoded.toString("utf8");
    if (createHash("sha256").update(json).digest("hex") !== value.checksum) return null;
    const snapshot = JSON.parse(json) as Partial<CfbForwardMemberSnapshot>;
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.snapshotRelease !== value.snapshotRelease ||
      snapshot.season !== value.season ||
      snapshot.publishedAt !== value.publishedAt
    ) return null;
    return snapshot as CfbForwardMemberSnapshot;
  } catch {
    return null;
  }
}

function isCfbForwardMemberSnapshotEnvelope(
  value: unknown,
): value is CfbForwardMemberSnapshotEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Partial<CfbForwardMemberSnapshotEnvelope>;
  return envelope.kind === "cfb_forward_member_snapshot_v1" &&
    envelope.envelopeRelease === CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE &&
    envelope.encoding === "gzip-base64" &&
    envelope.snapshotRelease === CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE &&
    typeof envelope.checksum === "string" &&
    /^[a-f0-9]{64}$/.test(envelope.checksum) &&
    typeof envelope.season === "number" &&
    Number.isInteger(envelope.season) &&
    typeof envelope.publishedAt === "string" &&
    typeof envelope.uncompressedBytes === "number" &&
    Number.isInteger(envelope.uncompressedBytes) &&
    envelope.uncompressedBytes >= 0 &&
    typeof envelope.compressedBytes === "number" &&
    Number.isInteger(envelope.compressedBytes) &&
    envelope.compressedBytes >= 0 &&
    typeof envelope.payload === "string";
}

function validateCfbForwardMemberSnapshot(
  value: unknown,
  expected: { season: number; now: string },
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
    Date.parse(expected.now) - Date.parse(snapshot.publishedAt ?? "") > SNAPSHOT_STALE_MS ||
    !/^[a-f0-9]{64}$/.test(snapshot.sourceChecksum ?? "")
  ) return null;
  return snapshot as CfbForwardMemberSnapshot;
}
