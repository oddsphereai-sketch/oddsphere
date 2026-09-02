import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveNflPlayerPropsMemberDecisions,
  type NflPlayerPropsProductionSnapshot,
} from "./nflPlayerPropsProductionContract";

export const NFL_PLAYER_PROPS_SNAPSHOT_KEY_PREFIX = "nfl::player-props" as const;
export const NFL_PLAYER_PROPS_SNAPSHOT_ENVELOPE_RELEASE =
  "nfl_player_props_snapshot_envelope_2026_09_02_r1_gzip_deduplicated_member" as const;
export const NFL_PLAYER_PROPS_SNAPSHOT_MAX_JSON_BYTES = 12_000_000;
export const NFL_PLAYER_PROPS_SNAPSHOT_MAX_GZIP_BYTES = 1_000_000;
const NFL_PLAYER_PROPS_SNAPSHOT_MAX_BASE64_CHARACTERS =
  4 * Math.ceil(NFL_PLAYER_PROPS_SNAPSHOT_MAX_GZIP_BYTES / 3);
const TABLE_MISSING_RE = /relation .*lab_response_snapshots.* does not exist|schema cache/i;

type NflPlayerPropsStoredSnapshot = Omit<NflPlayerPropsProductionSnapshot, "memberDecisions"> & {
  memberDecisions?: NflPlayerPropsProductionSnapshot["memberDecisions"];
};

export type NflPlayerPropsSnapshotEnvelope = {
  kind: "nfl_player_props_snapshot_v1";
  envelopeRelease: typeof NFL_PLAYER_PROPS_SNAPSHOT_ENVELOPE_RELEASE;
  encoding: "gzip-base64";
  memberDecisionsStorage: "derived_from_board_non_held" | "embedded";
  checksum: string;
  snapshotRelease: NflPlayerPropsProductionSnapshot["release"];
  season: number;
  week: number;
  generatedAt: string;
  uncompressedBytes: number;
  compressedBytes: number;
  payload: string;
};

export type NflPlayerPropsSnapshotSize = {
  jsonBytes: number;
  gzipBytes: number;
  envelopeJsonBytes: number;
  omittedMemberDecisionBytes: number;
};

export type NflPlayerPropsSnapshotRecord = {
  snapshot: NflPlayerPropsProductionSnapshot;
  generatedAt: string;
};

export function nflPlayerPropsSnapshotKey(season: number, week: number): string {
  return `${NFL_PLAYER_PROPS_SNAPSHOT_KEY_PREFIX}::${season}::${week}`;
}

export async function readNflPlayerPropsSnapshot(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}): Promise<NflPlayerPropsProductionSnapshot | null> {
  return (await readNflPlayerPropsSnapshotRecord(args))?.snapshot ?? null;
}

export async function readNflPlayerPropsSnapshotRecord(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}): Promise<NflPlayerPropsSnapshotRecord | null> {
  const { data, error } = await args.client
    .from("lab_response_snapshots")
    .select("payload,generated_at")
    .eq("snapshot_key", nflPlayerPropsSnapshotKey(args.season, args.week))
    .maybeSingle();
  if (error) {
    if (TABLE_MISSING_RE.test(error.message)) return null;
    throw new Error(`NFL player props snapshot read failed: ${error.message}`);
  }
  if (data?.payload === null || data?.payload === undefined) return null;
  const snapshot = decodeNflPlayerPropsSnapshotPayload(data.payload);
  if (!snapshot) throw new Error("NFL player props snapshot payload is corrupt or unsupported.");
  return {
    snapshot,
    generatedAt: typeof data.generated_at === "string" ? data.generated_at : snapshot.generatedAt,
  };
}

export async function writeNflPlayerPropsSnapshot(args: {
  client: SupabaseClient;
  snapshot: NflPlayerPropsProductionSnapshot;
  source: string;
}): Promise<void> {
  const generatedAt = args.snapshot.generatedAt;
  const starts = args.snapshot.board.decisions.map((row) => Date.parse(row.lockAt) + 60 * 60_000);
  const staleUntilMs = starts.length ? Math.max(...starts) + 36 * 60 * 60_000 : Date.parse(generatedAt) + 48 * 60 * 60_000;
  const payload = encodeNflPlayerPropsSnapshotPayload(args.snapshot);
  const { error } = await args.client.from("lab_response_snapshots").upsert({
    snapshot_key: nflPlayerPropsSnapshotKey(args.snapshot.season, args.snapshot.week),
    kind: "daily_edge",
    sport: "nfl",
    slate_date: null,
    payload,
    payload_version: args.snapshot.release,
    source: args.source,
    generated_at: generatedAt,
    expires_at: new Date(Date.parse(generatedAt) + 90 * 60_000).toISOString(),
    stale_until: new Date(staleUntilMs).toISOString(),
    updated_at: generatedAt,
  }, { onConflict: "snapshot_key" });
  if (error) throw new Error(`NFL player props snapshot write failed: ${error.message}`);
}

export function encodeNflPlayerPropsSnapshotPayload(
  snapshot: NflPlayerPropsProductionSnapshot,
): NflPlayerPropsSnapshotEnvelope {
  const derivedMemberDecisions = deriveNflPlayerPropsMemberDecisions(snapshot.board);
  const canDeriveMemberDecisions = JSON.stringify(snapshot.memberDecisions) === JSON.stringify(derivedMemberDecisions);
  const { memberDecisions, ...withoutMemberDecisions } = snapshot;
  const stored: NflPlayerPropsStoredSnapshot = canDeriveMemberDecisions
    ? withoutMemberDecisions
    : { ...withoutMemberDecisions, memberDecisions };
  const json = JSON.stringify(stored);
  const jsonBytes = Buffer.byteLength(json);
  if (jsonBytes > NFL_PLAYER_PROPS_SNAPSHOT_MAX_JSON_BYTES) {
    throw new Error(`NFL player props snapshot exceeds the ${NFL_PLAYER_PROPS_SNAPSHOT_MAX_JSON_BYTES}-byte JSON limit.`);
  }
  const compressed = gzipSync(Buffer.from(json), { level: 9 });
  if (compressed.byteLength > NFL_PLAYER_PROPS_SNAPSHOT_MAX_GZIP_BYTES) {
    throw new Error(`NFL player props snapshot exceeds the ${NFL_PLAYER_PROPS_SNAPSHOT_MAX_GZIP_BYTES}-byte gzip limit.`);
  }
  return {
    kind: "nfl_player_props_snapshot_v1",
    envelopeRelease: NFL_PLAYER_PROPS_SNAPSHOT_ENVELOPE_RELEASE,
    encoding: "gzip-base64",
    memberDecisionsStorage: canDeriveMemberDecisions ? "derived_from_board_non_held" : "embedded",
    checksum: createHash("sha256").update(json).digest("hex"),
    snapshotRelease: snapshot.release,
    season: snapshot.season,
    week: snapshot.week,
    generatedAt: snapshot.generatedAt,
    uncompressedBytes: jsonBytes,
    compressedBytes: compressed.byteLength,
    payload: compressed.toString("base64"),
  };
}

export function decodeNflPlayerPropsSnapshotPayload(value: unknown): NflPlayerPropsProductionSnapshot | null {
  if (isLegacySnapshot(value)) return value;
  if (!isEnvelope(value)) return null;
  if (value.uncompressedBytes > NFL_PLAYER_PROPS_SNAPSHOT_MAX_JSON_BYTES
    || value.compressedBytes > NFL_PLAYER_PROPS_SNAPSHOT_MAX_GZIP_BYTES) return null;
  if (value.payload.length > NFL_PLAYER_PROPS_SNAPSHOT_MAX_BASE64_CHARACTERS
    || value.payload.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.payload)) return null;
  try {
    const compressed = Buffer.from(value.payload, "base64");
    if (compressed.byteLength !== value.compressedBytes) return null;
    const decoded = gunzipSync(compressed, { maxOutputLength: NFL_PLAYER_PROPS_SNAPSHOT_MAX_JSON_BYTES });
    if (decoded.byteLength !== value.uncompressedBytes) return null;
    const json = decoded.toString("utf8");
    if (createHash("sha256").update(json).digest("hex") !== value.checksum) return null;
    const stored = JSON.parse(json) as unknown;
    if (!isStoredSnapshot(stored)) return null;
    if (stored.release !== value.snapshotRelease || stored.season !== value.season
      || stored.week !== value.week || stored.generatedAt !== value.generatedAt) return null;
    if (value.memberDecisionsStorage === "embedded") {
      return Array.isArray(stored.memberDecisions) ? stored as NflPlayerPropsProductionSnapshot : null;
    }
    if (stored.memberDecisions !== undefined) return null;
    const { lifecycle, ...beforeLifecycle } = stored;
    return {
      ...beforeLifecycle,
      memberDecisions: deriveNflPlayerPropsMemberDecisions(stored.board),
      lifecycle,
    };
  } catch {
    return null;
  }
}

export function measureNflPlayerPropsSnapshotPayload(
  snapshot: NflPlayerPropsProductionSnapshot,
): NflPlayerPropsSnapshotSize {
  const legacyJsonBytes = Buffer.byteLength(JSON.stringify(snapshot));
  const envelope = encodeNflPlayerPropsSnapshotPayload(snapshot);
  return {
    jsonBytes: envelope.uncompressedBytes,
    gzipBytes: envelope.compressedBytes,
    envelopeJsonBytes: Buffer.byteLength(JSON.stringify(envelope)),
    omittedMemberDecisionBytes: legacyJsonBytes - envelope.uncompressedBytes,
  };
}

function isEnvelope(value: unknown): value is NflPlayerPropsSnapshotEnvelope {
  if (!isRecord(value)) return false;
  return value.kind === "nfl_player_props_snapshot_v1"
    && value.envelopeRelease === NFL_PLAYER_PROPS_SNAPSHOT_ENVELOPE_RELEASE
    && value.encoding === "gzip-base64"
    && (value.memberDecisionsStorage === "derived_from_board_non_held" || value.memberDecisionsStorage === "embedded")
    && typeof value.checksum === "string"
    && typeof value.snapshotRelease === "string"
    && typeof value.season === "number"
    && Number.isInteger(value.season)
    && typeof value.week === "number"
    && Number.isInteger(value.week)
    && typeof value.generatedAt === "string"
    && typeof value.uncompressedBytes === "number"
    && Number.isInteger(value.uncompressedBytes)
    && value.uncompressedBytes >= 0
    && typeof value.compressedBytes === "number"
    && Number.isInteger(value.compressedBytes)
    && value.compressedBytes >= 0
    && typeof value.payload === "string";
}

function isLegacySnapshot(value: unknown): value is NflPlayerPropsProductionSnapshot {
  return isStoredSnapshot(value) && Array.isArray(value.memberDecisions);
}

function isStoredSnapshot(value: unknown): value is NflPlayerPropsStoredSnapshot {
  return isRecord(value)
    && typeof value.release === "string"
    && typeof value.season === "number"
    && Number.isInteger(value.season)
    && typeof value.week === "number"
    && Number.isInteger(value.week)
    && typeof value.generatedAt === "string"
    && isRecord(value.board)
    && Array.isArray(value.board.decisions)
    && isRecord(value.lifecycle);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
