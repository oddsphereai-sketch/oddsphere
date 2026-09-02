import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildNflPlayerPropsMemberSnapshot,
  deriveNflPlayerPropsMemberDecisions,
  type NflPlayerPropsMemberSnapshot,
  type NflPlayerPropsProductionSnapshot,
} from "./nflPlayerPropsProductionContract";

export const NFL_PLAYER_PROPS_SNAPSHOT_KEY_PREFIX = "nfl::player-props" as const;
export const NFL_PLAYER_PROPS_SNAPSHOT_ENVELOPE_RELEASE =
  "nfl_player_props_snapshot_envelope_2026_09_02_r1_gzip_deduplicated_member" as const;
export const NFL_PLAYER_PROPS_SNAPSHOT_MAX_JSON_BYTES = 12_000_000;
export const NFL_PLAYER_PROPS_SNAPSHOT_MAX_GZIP_BYTES = 1_000_000;
export const NFL_PLAYER_PROPS_MEMBER_CACHE_TTL_MS = 60_000;
export const NFL_PLAYER_PROPS_MEMBER_READ_TIMEOUT_MS = 6_000;
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

type NflPlayerPropsMemberCacheEntry =
  | { value: NflPlayerPropsMemberSnapshot; expiresAt: number; inFlight?: never }
  | { value?: never; expiresAt?: never; inFlight: Promise<NflPlayerPropsMemberSnapshot | null> };

export type NflPlayerPropsMemberSnapshotReader = {
  read(args: {
    client: SupabaseClient;
    season: number;
    week: number;
  }): Promise<NflPlayerPropsMemberSnapshot | null>;
  invalidate(args: { season: number; week: number }): void;
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

/**
 * Constructs a member-only reader. Its DTO return type deliberately cannot be
 * substituted for the canonical production snapshot consumed by the writer.
 * Cache keys contain only the public season/week identity; no auth or user
 * state is retained.
 */
export function createNflPlayerPropsMemberSnapshotReader(options: {
  cacheTtlMs?: number;
  readTimeoutMs?: number;
  now?: () => number;
} = {}): NflPlayerPropsMemberSnapshotReader {
  const cacheTtlMs = options.cacheTtlMs ?? NFL_PLAYER_PROPS_MEMBER_CACHE_TTL_MS;
  const readTimeoutMs = options.readTimeoutMs ?? NFL_PLAYER_PROPS_MEMBER_READ_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  if (!Number.isFinite(cacheTtlMs) || cacheTtlMs <= 0) throw new Error("NFL props member cache TTL must be positive.");
  if (!Number.isFinite(readTimeoutMs) || readTimeoutMs <= 0) throw new Error("NFL props member read timeout must be positive.");
  const cache = new Map<string, NflPlayerPropsMemberCacheEntry>();

  const read: NflPlayerPropsMemberSnapshotReader["read"] = (args) => {
    const key = nflPlayerPropsSnapshotKey(args.season, args.week);
    const existing = cache.get(key);
    if (existing?.value && now() < existing.expiresAt) return Promise.resolve(existing.value);
    if (existing?.inFlight) return existing.inFlight;
    if (existing) cache.delete(key);

    const inFlight = readNflPlayerPropsMemberSnapshotUncached({ ...args, timeoutMs: readTimeoutMs })
      .then((snapshot) => {
        if (snapshot === null) {
          if (cache.get(key)?.inFlight === inFlight) cache.delete(key);
          return null;
        }
        const memberSnapshot = buildNflPlayerPropsMemberSnapshot(snapshot);
        if (cache.get(key)?.inFlight === inFlight) {
          cache.set(key, { value: memberSnapshot, expiresAt: now() + cacheTtlMs });
        }
        return memberSnapshot;
      })
      .catch((error: unknown) => {
        if (cache.get(key)?.inFlight === inFlight) cache.delete(key);
        throw error;
      });
    cache.set(key, { inFlight });
    return inFlight;
  };

  return {
    read,
    invalidate: ({ season, week }) => cache.delete(nflPlayerPropsSnapshotKey(season, week)),
  };
}

const memberSnapshotReader = createNflPlayerPropsMemberSnapshotReader();

/** Member-route API only. Writer and readiness paths must use uncached readers. */
export function readNflPlayerPropsMemberSnapshot(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}): Promise<NflPlayerPropsMemberSnapshot | null> {
  return memberSnapshotReader.read(args);
}

function invalidateNflPlayerPropsMemberSnapshot(args: { season: number; week: number }): void {
  memberSnapshotReader.invalidate(args);
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
  invalidateNflPlayerPropsMemberSnapshot({ season: args.snapshot.season, week: args.snapshot.week });
}

async function readNflPlayerPropsMemberSnapshotUncached(args: {
  client: SupabaseClient;
  season: number;
  week: number;
  timeoutMs: number;
}): Promise<NflPlayerPropsProductionSnapshot | null> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`NFL player props member snapshot read timed out after ${args.timeoutMs}ms.`));
    }, args.timeoutMs);
  });
  const query = args.client
    .from("lab_response_snapshots")
    .select("payload,generated_at")
    .eq("snapshot_key", nflPlayerPropsSnapshotKey(args.season, args.week))
    .abortSignal(controller.signal)
    .maybeSingle();
  try {
    const { data, error } = await Promise.race([query, timedOut]);
    if (error) {
      if (TABLE_MISSING_RE.test(error.message)) return null;
      throw new Error(`NFL player props member snapshot read failed: ${error.message}`);
    }
    if (data?.payload === null || data?.payload === undefined) return null;
    const snapshot = decodeNflPlayerPropsSnapshotPayload(data.payload);
    if (!snapshot) throw new Error("NFL player props member snapshot payload is corrupt or unsupported.");
    return snapshot;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
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
