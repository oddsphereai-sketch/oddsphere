import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NbaPlayerPropPriceObservation } from "./nbaPlayerPropsContract";
import type { NbaPlayerPropsMemberSnapshot } from "./nbaPlayerPropsProductContract";

export const NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE =
  "nba_player_props_private_store_2026_10_21_r2_bounded_by_payload_kind" as const;
export const NBA_PLAYER_PROPS_PRIVATE_SNAPSHOT_MAX_JSON_BYTES = 32_000_000;
export const NBA_PLAYER_PROPS_PRIVATE_SNAPSHOT_MAX_GZIP_BYTES = 2_000_000;
const NBA_PLAYER_PROPS_PRIVATE_STATE_MAX_JSON_BYTES = 64_000_000;
const NBA_PLAYER_PROPS_PRIVATE_STATE_MAX_GZIP_BYTES = 8_000_000;
const MAX_MARKET_OBSERVATIONS = 150_000;
const HOUR_MS = 60 * 60_000;

type Envelope = Readonly<{
  kind: "nba_player_props_private_envelope_v1";
  release: typeof NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE;
  encoding: "gzip-base64";
  payloadKind: "candidate_snapshot" | "market_history" | "current_state" | "tracking_history";
  checksum: string;
  uncompressedBytes: number;
  compressedBytes: number;
  payload: string;
}>;

export type NbaPlayerPropsMarketHistory = Readonly<{
  release: typeof NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE;
  publicEnabled: false;
  slateDate: string;
  createdAt: string;
  updatedAt: string;
  observations: readonly NbaPlayerPropPriceObservation[];
}>;

export function nbaPlayerPropsCandidateSnapshotKey(slateDate: string): string {
  return `nba::player-props-private-candidate::${slateDate}`;
}

export function nbaPlayerPropsMarketHistoryKey(slateDate: string): string {
  return `nba::player-props-private-market::${slateDate}`;
}

export async function readNbaPlayerPropsPrivateSnapshot(args: {
  client: SupabaseClient;
  slateDate: string;
}): Promise<NbaPlayerPropsMemberSnapshot | null> {
  const payload = await readPayload(args.client, nbaPlayerPropsCandidateSnapshotKey(args.slateDate));
  return payload === null ? null : decode<NbaPlayerPropsMemberSnapshot>(payload, "candidate_snapshot");
}

/**
 * Last-known-good writer: an incomplete/empty candidate can never replace a
 * previously valid private slate. The public gate is checked again here even
 * though the product contract already fixes it to false.
 */
export async function writeNbaPlayerPropsPrivateSnapshot(args: {
  client: SupabaseClient;
  snapshot: NbaPlayerPropsMemberSnapshot;
  source: string;
}): Promise<{ written: true; jsonBytes: number; gzipBytes: number }> {
  if (args.snapshot.publicEnabled !== false) throw new Error("NBA props private store refuses public snapshots.");
  if (args.snapshot.games.length > 0 && args.snapshot.decisions.length === 0) {
    throw new Error("NBA props last-known-good snapshot refuses an empty decision set for a populated slate.");
  }
  const envelope = encode(args.snapshot, "candidate_snapshot");
  const starts = args.snapshot.games.map((game) => Date.parse(game.scheduledStart)).filter(Number.isFinite);
  const staleUntil = new Date((starts.length ? Math.max(...starts) : Date.parse(args.snapshot.generatedAt)) + 48 * HOUR_MS).toISOString();
  const { error } = await args.client.from("lab_response_snapshots").upsert({
    snapshot_key: nbaPlayerPropsCandidateSnapshotKey(args.snapshot.slateDate),
    kind: "daily_edge",
    sport: "nba",
    slate_date: args.snapshot.slateDate,
    payload: envelope,
    payload_version: NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE,
    source: args.source,
    generated_at: args.snapshot.generatedAt,
    expires_at: new Date(Date.parse(args.snapshot.generatedAt) + 90 * 60_000).toISOString(),
    stale_until: staleUntil,
    updated_at: args.snapshot.generatedAt,
  }, { onConflict: "snapshot_key" });
  if (error) throw new Error(`NBA props private snapshot write failed: ${error.message}`);
  return { written: true, jsonBytes: envelope.uncompressedBytes, gzipBytes: envelope.compressedBytes };
}

export async function readNbaPlayerPropsMarketHistory(args: {
  client: SupabaseClient;
  slateDate: string;
}): Promise<NbaPlayerPropsMarketHistory | null> {
  const payload = await readPayload(args.client, nbaPlayerPropsMarketHistoryKey(args.slateDate));
  return payload === null ? null : decode<NbaPlayerPropsMarketHistory>(payload, "market_history");
}

export function mergeNbaPlayerPropsMarketHistory(args: {
  previous: NbaPlayerPropsMarketHistory | null;
  current: readonly NbaPlayerPropPriceObservation[];
  slateDate: string;
  capturedAt: string;
}): { history: NbaPlayerPropsMarketHistory; added: number; preserved: number; conflicts: number } {
  const rows = new Map<string, NbaPlayerPropPriceObservation>();
  for (const row of args.previous?.observations ?? []) rows.set(observationKey(row), row);
  let added = 0;
  let preserved = 0;
  let conflicts = 0;
  for (const row of args.current) {
    const key = observationKey(row);
    const prior = rows.get(key);
    if (!prior) {
      rows.set(key, row);
      added += 1;
    } else if (JSON.stringify(prior) === JSON.stringify(row)) preserved += 1;
    else conflicts += 1;
  }
  const observations = [...rows.values()].sort((left, right) =>
    Date.parse(left.observedAt) - Date.parse(right.observedAt)
    || observationKey(left).localeCompare(observationKey(right)));
  if (observations.length > MAX_MARKET_OBSERVATIONS) throw new Error("NBA props market history row limit exceeded.");
  return {
    history: {
      release: NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE,
      publicEnabled: false,
      slateDate: args.slateDate,
      createdAt: args.previous?.createdAt ?? args.capturedAt,
      updatedAt: added > 0 ? args.capturedAt : (args.previous?.updatedAt ?? args.capturedAt),
      observations,
    },
    added,
    preserved,
    conflicts,
  };
}

export async function writeNbaPlayerPropsMarketHistory(args: {
  client: SupabaseClient;
  history: NbaPlayerPropsMarketHistory;
}): Promise<{ jsonBytes: number; gzipBytes: number }> {
  if (args.history.publicEnabled !== false) throw new Error("NBA props market history must remain private.");
  const envelope = encode(args.history, "market_history");
  const retention = new Date(Date.parse(args.history.updatedAt) + 30 * 24 * HOUR_MS).toISOString();
  const { error } = await args.client.from("lab_response_snapshots").upsert({
    snapshot_key: nbaPlayerPropsMarketHistoryKey(args.history.slateDate),
    kind: "daily_edge",
    sport: "nba",
    slate_date: args.history.slateDate,
    payload: envelope,
    payload_version: NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE,
    source: NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE,
    generated_at: args.history.updatedAt,
    expires_at: retention,
    stale_until: retention,
    updated_at: args.history.updatedAt,
  }, { onConflict: "snapshot_key" });
  if (error) throw new Error(`NBA props market history write failed: ${error.message}`);
  return { jsonBytes: envelope.uncompressedBytes, gzipBytes: envelope.compressedBytes };
}

export function encodeNbaPlayerPropsPrivatePayload(
  payload: unknown,
  payloadKind: Envelope["payloadKind"],
): Envelope {
  return encode(payload, payloadKind);
}

export function decodeNbaPlayerPropsPrivatePayload<T>(
  value: unknown,
  payloadKind: Envelope["payloadKind"],
): T | null {
  return decode<T>(value, payloadKind);
}

function encode(payload: unknown, payloadKind: Envelope["payloadKind"]): Envelope {
  const json = JSON.stringify(payload);
  const uncompressedBytes = Buffer.byteLength(json);
  const limits = payloadLimits(payloadKind);
  if (uncompressedBytes > limits.json) {
    throw new Error("NBA props private payload JSON limit exceeded.");
  }
  const compressed = gzipSync(Buffer.from(json), { level: 9 });
  if (compressed.byteLength > limits.gzip) {
    throw new Error("NBA props private payload gzip limit exceeded.");
  }
  return {
    kind: "nba_player_props_private_envelope_v1",
    release: NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE,
    encoding: "gzip-base64",
    payloadKind,
    checksum: createHash("sha256").update(json).digest("hex"),
    uncompressedBytes,
    compressedBytes: compressed.byteLength,
    payload: compressed.toString("base64"),
  };
}

function decode<T>(value: unknown, payloadKind: Envelope["payloadKind"]): T | null {
  if (!isEnvelope(value) || value.payloadKind !== payloadKind) return null;
  try {
    const compressed = Buffer.from(value.payload, "base64");
    if (compressed.byteLength !== value.compressedBytes) return null;
    const decoded = gunzipSync(compressed, { maxOutputLength: payloadLimits(payloadKind).json });
    if (decoded.byteLength !== value.uncompressedBytes) return null;
    const json = decoded.toString("utf8");
    if (createHash("sha256").update(json).digest("hex") !== value.checksum) return null;
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function payloadLimits(payloadKind: Envelope["payloadKind"]): { json: number; gzip: number } {
  return payloadKind === "current_state"
    ? { json: NBA_PLAYER_PROPS_PRIVATE_STATE_MAX_JSON_BYTES, gzip: NBA_PLAYER_PROPS_PRIVATE_STATE_MAX_GZIP_BYTES }
    : { json: NBA_PLAYER_PROPS_PRIVATE_SNAPSHOT_MAX_JSON_BYTES, gzip: NBA_PLAYER_PROPS_PRIVATE_SNAPSHOT_MAX_GZIP_BYTES };
}

async function readPayload(client: SupabaseClient, key: string): Promise<unknown | null> {
  const { data, error } = await client.from("lab_response_snapshots")
    .select("payload").eq("snapshot_key", key).maybeSingle();
  if (error) throw new Error(`NBA props private payload read failed: ${error.message}`);
  return data?.payload ?? null;
}

function observationKey(row: NbaPlayerPropPriceObservation): string {
  return [row.provider, row.providerObservationId, row.side].join("|");
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === "nba_player_props_private_envelope_v1"
    && (value as Record<string, unknown>).release === NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE
    && (value as Record<string, unknown>).encoding === "gzip-base64"
    && typeof (value as Record<string, unknown>).checksum === "string"
    && typeof (value as Record<string, unknown>).payload === "string"
    && Number.isInteger((value as Record<string, unknown>).uncompressedBytes)
    && Number.isInteger((value as Record<string, unknown>).compressedBytes);
}
