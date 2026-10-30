import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { gunzipSync, gzipSync, createGzip } from "node:zlib";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NbaPlayerPropPriceObservation } from "./nbaPlayerPropsContract";
import type { NbaPlayerPropsMemberSnapshot } from "./nbaPlayerPropsProductContract";

export const NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE =
  "nba_player_props_private_store_2026_10_28_r6_expanded_bounded_market_history_capacity" as const;
const NBA_PLAYER_PROPS_PRIVATE_STORE_LEGACY_RELEASES = new Set([
  "nba_player_props_private_store_2026_10_23_r5_bounded_market_history_capacity",
  "nba_player_props_private_store_2026_10_21_r4_bounded_quote_chronology",
  "nba_player_props_private_store_2026_10_21_r3_chronological_observation_identity",
]);
export const NBA_PLAYER_PROPS_PRIVATE_SNAPSHOT_MAX_JSON_BYTES = 32_000_000;
export const NBA_PLAYER_PROPS_PRIVATE_SNAPSHOT_MAX_GZIP_BYTES = 2_000_000;
const NBA_PLAYER_PROPS_PRIVATE_STATE_MAX_JSON_BYTES = 64_000_000;
const NBA_PLAYER_PROPS_PRIVATE_STATE_MAX_GZIP_BYTES = 8_000_000;
// A full NBA slate retains first/prior/current quote chronology per logical
// quote. Keep that evidence lossless and enforce independent row, uncompressed,
// and compressed ceilings instead of silently dropping movement states.
export const NBA_PLAYER_PROPS_PRIVATE_MARKET_MAX_JSON_BYTES = 192_000_000;
const NBA_PLAYER_PROPS_PRIVATE_MARKET_MAX_GZIP_BYTES = 8_000_000;
export const NBA_PLAYER_PROPS_PRIVATE_MARKET_MAX_OBSERVATIONS = 250_000;
const MAX_CURRENT_STATES_PER_QUOTE = 3;
const HOUR_MS = 60 * 60_000;

type Envelope = Readonly<{
  kind: "nba_player_props_private_envelope_v1";
  release: string;
  encoding: "gzip-base64";
  payloadKind: "candidate_snapshot" | "market_history" | "current_state" | "tracking_history";
  checksum: string;
  uncompressedBytes: number;
  compressedBytes: number;
  payload: string;
}>;

export type NbaPlayerPropsMarketHistory = Readonly<{
  release: string;
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
}): { history: NbaPlayerPropsMarketHistory; added: number; refreshed: number; preserved: number; conflicts: number } {
  const rows = new Map<string, NbaPlayerPropPriceObservation[]>();
  for (const row of [...(args.previous?.observations ?? [])].sort(compareObservations)) {
    const key = logicalQuoteKey(row);
    rows.set(key, compactQuoteTrail([...(rows.get(key) ?? []), row]));
  }
  let added = 0;
  let refreshed = 0;
  let preserved = 0;
  let conflicts = 0;
  for (const row of [...args.current].sort(compareObservations)) {
    const key = logicalQuoteKey(row);
    const trail = rows.get(key) ?? [];
    const sameTimestamp = trail.find((prior) => prior.observedAt === row.observedAt);
    if (sameTimestamp) {
      if (sameEconomicQuote(sameTimestamp, row)) preserved += 1;
      else conflicts += 1;
      continue;
    }
    const latest = trail.at(-1);
    if (!latest) {
      rows.set(key, [row]);
      added += 1;
      continue;
    }
    if (Date.parse(row.observedAt) < Date.parse(latest.observedAt)) {
      rows.set(key, compactQuoteTrail([...trail, row].sort(compareObservations)));
      added += 1;
      continue;
    }
    if (sameEconomicQuote(latest, row)) {
      if (row.isOpening) {
        preserved += 1;
      } else {
        const next = [...trail];
        if (next.length === 1) next.push(row);
        else next[next.length - 1] = row;
        rows.set(key, compactQuoteTrail(next));
        refreshed += 1;
      }
      continue;
    }
    rows.set(key, compactQuoteTrail([...trail, row]));
    added += 1;
  }
  const observations = [...rows.values()].flat().sort(compareObservations);
  if (observations.length > NBA_PLAYER_PROPS_PRIVATE_MARKET_MAX_OBSERVATIONS) {
    throw new Error("NBA props market history row limit exceeded.");
  }
  return {
    history: {
      release: NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE,
      publicEnabled: false,
      slateDate: args.slateDate,
      createdAt: args.previous?.createdAt ?? args.capturedAt,
      updatedAt: added > 0 || refreshed > 0 || args.previous?.release !== NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE
        ? args.capturedAt
        : (args.previous?.updatedAt ?? args.capturedAt),
      observations,
    },
    added,
    refreshed,
    preserved,
    conflicts,
  };
}

export async function writeNbaPlayerPropsMarketHistory(args: {
  client: SupabaseClient;
  history: NbaPlayerPropsMarketHistory;
}): Promise<{ jsonBytes: number; gzipBytes: number }> {
  if (args.history.publicEnabled !== false) throw new Error("NBA props market history must remain private.");
  const envelope = await encodeNbaPlayerPropsMarketHistoryPayload(args.history);
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

/** Serialize the exact existing JSON contract in bounded chunks. A full slate
 * must not materialize a second history-sized JSON string and UTF-8 buffer
 * alongside the already decoded quote objects. Compression is backpressured;
 * the only retained output is the existing <=8 MB compressed envelope. */
export async function encodeNbaPlayerPropsMarketHistoryPayload(history: NbaPlayerPropsMarketHistory): Promise<Envelope> {
  const limits = payloadLimits("market_history");
  const checksum = createHash("sha256");
  let uncompressedBytes = 0;
  function* parts(): Generator<string> {
    yield "{";
    let first = true;
    for (const [key, value] of Object.entries(history)) {
      const scalar = key === "observations" ? null : JSON.stringify(value);
      if (key !== "observations" && scalar === undefined) continue;
      yield `${first ? "" : ","}${JSON.stringify(key)}:`;
      first = false;
      if (key !== "observations") { yield scalar!; continue; }
      yield "[";
      for (let index = 0; index < history.observations.length; index += 1) {
        if (index) yield ",";
        yield JSON.stringify(history.observations[index]) ?? "null";
      }
      yield "]";
    }
    yield "}";
  }
  function* chunks(): Generator<Buffer> {
    let batch = "", batchBytes = 0;
    for (const part of parts()) {
      batch += part;
      batchBytes += Buffer.byteLength(part);
      if (batchBytes < 64 * 1024) continue;
      const bytes = Buffer.from(batch);
      uncompressedBytes += bytes.length;
      if (uncompressedBytes > limits.json) throw new Error("NBA props private payload JSON limit exceeded.");
      checksum.update(bytes);
      yield bytes;
      batch = ""; batchBytes = 0;
    }
    if (batch) {
      const bytes = Buffer.from(batch);
      uncompressedBytes += bytes.length;
      if (uncompressedBytes > limits.json) throw new Error("NBA props private payload JSON limit exceeded.");
      checksum.update(bytes);
      yield bytes;
    }
  }
  const output: Buffer[] = [];
  let compressedBytes = 0;
  await pipeline(
    Readable.from(chunks(), { objectMode: false, highWaterMark: 64 * 1024 }),
    createGzip({ level: 9 }),
    new Writable({ write(chunk: Buffer, _encoding, done) {
      compressedBytes += chunk.length;
      if (compressedBytes > limits.gzip) { done(new Error("NBA props private payload gzip limit exceeded.")); return; }
      output.push(chunk); done();
    } }),
  );
  return { kind: "nba_player_props_private_envelope_v1", release: NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE,
    encoding: "gzip-base64", payloadKind: "market_history", checksum: checksum.digest("hex"),
    uncompressedBytes, compressedBytes, payload: Buffer.concat(output, compressedBytes).toString("base64") };
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
  // Hash the same UTF-8 buffer gzip consumes instead of encoding a second
  // history-sized byte buffer while the first one is still resident.
  const bytes = Buffer.from(json);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const compressed = gzipSync(bytes, { level: 9 });
  if (compressed.byteLength > limits.gzip) {
    throw new Error("NBA props private payload gzip limit exceeded.");
  }
  return {
    kind: "nba_player_props_private_envelope_v1",
    release: NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE,
    encoding: "gzip-base64",
    payloadKind,
    checksum,
    uncompressedBytes,
    compressedBytes: compressed.byteLength,
    payload: compressed.toString("base64"),
  };
}

function decode<T>(value: unknown, payloadKind: Envelope["payloadKind"]): T | null {
  if (!isEnvelope(value) || value.payloadKind !== payloadKind) return null;
  try {
    const limit = payloadLimits(payloadKind).json;
    if (value.uncompressedBytes < 0 || value.uncompressedBytes > limit) return null;
    const compressed = Buffer.from(value.payload, "base64");
    if (compressed.byteLength !== value.compressedBytes) return null;
    // The independently checked envelope length lets zlib fill one bounded
    // output buffer. Default tiny chunks require another full-size concat
    // buffer for a 100+ MB history. One spare byte avoids a second allocation
    // when the exact declared length fills the first chunk.
    const footerBytes = compressed.length >= 4 ? compressed.readUInt32LE(compressed.length - 4) : -1;
    const decoded = gunzipSync(compressed, {
      maxOutputLength: limit,
      // Concatenated legacy gzip members and a false declared length retain
      // ordinary bounded inflate behavior rather than trusting that length.
      chunkSize: footerBytes === value.uncompressedBytes ? Math.max(64, value.uncompressedBytes + 1) : undefined,
    });
    if (decoded.byteLength !== value.uncompressedBytes) return null;
    // Valid UTF-8 hashes byte-for-byte identically to the legacy string hash.
    // Preserve legacy replacement-character semantics for malformed UTF-8.
    const hashInput = isUtf8(decoded) ? decoded : decoded.toString("utf8");
    if (createHash("sha256").update(hashInput).digest("hex") !== value.checksum) return null;
    return JSON.parse(decoded.toString("utf8")) as T;
  } catch {
    return null;
  }
}

function payloadLimits(payloadKind: Envelope["payloadKind"]): { json: number; gzip: number } {
  if (payloadKind === "current_state") {
    return { json: NBA_PLAYER_PROPS_PRIVATE_STATE_MAX_JSON_BYTES, gzip: NBA_PLAYER_PROPS_PRIVATE_STATE_MAX_GZIP_BYTES };
  }
  if (payloadKind === "market_history") {
    return { json: NBA_PLAYER_PROPS_PRIVATE_MARKET_MAX_JSON_BYTES, gzip: NBA_PLAYER_PROPS_PRIVATE_MARKET_MAX_GZIP_BYTES };
  }
  return { json: NBA_PLAYER_PROPS_PRIVATE_SNAPSHOT_MAX_JSON_BYTES, gzip: NBA_PLAYER_PROPS_PRIVATE_SNAPSHOT_MAX_GZIP_BYTES };
}

async function readPayload(client: SupabaseClient, key: string): Promise<unknown | null> {
  const { data, error } = await client.from("lab_response_snapshots")
    .select("payload").eq("snapshot_key", key).maybeSingle();
  if (error) throw new Error(`NBA props private payload read failed: ${error.message}`);
  return data?.payload ?? null;
}

function observationKey(row: NbaPlayerPropPriceObservation): string {
  return [row.provider, row.providerObservationId, row.side, row.observedAt, row.isOpening ? "opening" : "current"].join("|");
}

function logicalQuoteKey(row: NbaPlayerPropPriceObservation): string {
  const player = row.canonicalPlayerId
    ?? (row.providerPlayerId ? `${row.provider}:${row.providerPlayerId}` : normalizeIdentity(row.playerName ?? ""));
  return [
    row.provider,
    row.providerEventId,
    row.canonicalGameId ?? "unresolved-game",
    player,
    normalizeIdentity(row.sportsbook),
    row.market,
    row.providerMarket,
    row.offerType,
    row.side,
    row.line,
    row.isOpening ? "opening" : "current",
    row.isLive ? "live" : "pregame",
  ].join("|");
}

function compactQuoteTrail(
  trail: readonly NbaPlayerPropPriceObservation[],
): NbaPlayerPropPriceObservation[] {
  if (trail.length <= 1) return [...trail];
  const ordered = [...trail].sort(compareObservations);
  if (ordered[0]!.isOpening) return [ordered[0]!];

  const first = ordered[0]!;
  const states: NbaPlayerPropPriceObservation[] = [first];
  for (const row of ordered.slice(1)) {
    const latest = states.at(-1)!;
    if (sameEconomicQuote(latest, row)) {
      if (states.length === 1) states.push(row);
      else states[states.length - 1] = row;
    } else {
      states.push(row);
    }
  }
  if (states.length <= MAX_CURRENT_STATES_PER_QUOTE) return states;
  return [states[0]!, ...states.slice(-(MAX_CURRENT_STATES_PER_QUOTE - 1))];
}

function sameEconomicQuote(
  left: NbaPlayerPropPriceObservation,
  right: NbaPlayerPropPriceObservation,
): boolean {
  return left.line === right.line
    && left.americanPrice === right.americanPrice
    && left.isOpening === right.isOpening
    && left.isLive === right.isLive;
}

function compareObservations(left: NbaPlayerPropPriceObservation, right: NbaPlayerPropPriceObservation): number {
  return Date.parse(left.observedAt) - Date.parse(right.observedAt)
    || observationKey(left).localeCompare(observationKey(right));
}

function normalizeIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === "nba_player_props_private_envelope_v1"
    && ((value as Record<string, unknown>).release === NBA_PLAYER_PROPS_PRIVATE_STORE_RELEASE
      || NBA_PLAYER_PROPS_PRIVATE_STORE_LEGACY_RELEASES.has(String((value as Record<string, unknown>).release)))
    && (value as Record<string, unknown>).encoding === "gzip-base64"
    && typeof (value as Record<string, unknown>).checksum === "string"
    && typeof (value as Record<string, unknown>).payload === "string"
    && Number.isInteger((value as Record<string, unknown>).uncompressedBytes)
    && Number.isInteger((value as Record<string, unknown>).compressedBytes);
}
