import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectNflPlayerPropsCanonicalLines } from "./nflPlayerPropsCanonicalLine";
import type { NflPlayerPropsProductionSnapshot } from "./nflPlayerPropsProductionContract";

export const NFL_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE =
  "nfl_player_props_private_tracking_2026_10_12_r1_full_locked_board" as const;
export const NFL_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA =
  "nfl_player_props_private_tracking_history_v1" as const;
export const NFL_PLAYER_PROPS_PRIVATE_TRACKING_KEY_PREFIX =
  "nfl::player-props-private-tracking" as const;
export const NFL_PLAYER_PROPS_PRIVATE_TRACKING_MAX_ROWS = 16_000;
export const NFL_PLAYER_PROPS_PRIVATE_TRACKING_MAX_JSON_BYTES = 32_000_000;
export const NFL_PLAYER_PROPS_PRIVATE_TRACKING_MAX_GZIP_BYTES = 2_000_000;
export const NFL_PLAYER_PROPS_PRIVATE_TRACKING_RETENTION_DAYS = 550;
const HOUR_MS = 60 * 60_000;

type Decision = NflPlayerPropsProductionSnapshot["board"]["decisions"][number];

export type NflPlayerPropsPrivateTrackingRow = Readonly<{
  rowKey: string;
  gameId: string;
  providerPlayerId: string | null;
  playerName: string;
  team: string;
  opponent: string;
  scheduledStart: string;
  market: Decision["market"];
  line: number;
  side: Decision["side"];
  sportsbook: string;
  provider: string;
  americanPrice: number;
  observedAt: string;
  lockedAt: string;
  canonicalMainLine: boolean;
  projection: number | null;
  independentProjection: number | null;
  rawModelProbability: number;
  marketProbability: number;
  finalProbability: number;
  probabilityEdge: number;
  expectedValue: number;
  participationProbability: number;
  grade: Decision["grade"];
  marketMovement: Decision["marketMovement"];
  healthHolds: readonly string[];
  modelRelease: string;
  calibrationRelease: string;
  decisionRelease: string;
  writerRelease: string;
  captureRelease: typeof NFL_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE;
}>;

export type NflPlayerPropsPrivateTrackingHistory = Readonly<{
  kind: "nfl_player_props_private_tracking_history_v1";
  schema: typeof NFL_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA;
  captureRelease: typeof NFL_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE;
  season: number;
  week: number;
  createdAt: string;
  updatedAt: string;
  rows: readonly NflPlayerPropsPrivateTrackingRow[];
}>;

export type NflPlayerPropsPrivateTrackingEnvelope = Readonly<{
  kind: "nfl_player_props_private_tracking_envelope_v1";
  schema: typeof NFL_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA;
  captureRelease: typeof NFL_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE;
  encoding: "gzip-base64";
  checksum: string;
  season: number;
  week: number;
  uncompressedBytes: number;
  compressedBytes: number;
  payload: string;
}>;

export type NflPlayerPropsPrivateTrackingCaptureResult = Readonly<{
  written: boolean;
  rowsAdded: number;
  rowsPreserved: number;
  identityConflictsPreserved: number;
  totalRows: number;
  canonicalRows: number;
  alternateRows: number;
  jsonBytes: number;
  gzipBytes: number;
}>;

export type NflPlayerPropsPrivateTrackingSafeResult =
  NflPlayerPropsPrivateTrackingCaptureResult & Readonly<{ error: string | null }>;

export function nflPlayerPropsPrivateTrackingKey(season: number, week: number): string {
  return `${NFL_PLAYER_PROPS_PRIVATE_TRACKING_KEY_PREFIX}::${season}::${week}`;
}

export function buildNflPlayerPropsPrivateTrackingRows(args: {
  snapshot: NflPlayerPropsProductionSnapshot;
  writerRelease: string;
}): NflPlayerPropsPrivateTrackingRow[] {
  const locked = args.snapshot.board.decisions.filter((row) => row.state === "locked");
  const canonical = new Set(selectNflPlayerPropsCanonicalLines(locked));
  return locked.map((row) => ({
    rowKey: privateTrackingRowKey(row),
    gameId: row.gameId,
    providerPlayerId: row.providerPlayerId,
    playerName: row.playerName,
    team: row.team,
    opponent: row.opponent,
    scheduledStart: row.scheduledStart,
    market: row.market,
    line: row.line,
    side: row.side,
    sportsbook: row.sportsbook,
    provider: row.provider,
    americanPrice: row.americanPrice,
    observedAt: row.observedAt,
    lockedAt: row.lockAt,
    canonicalMainLine: canonical.has(row),
    projection: row.projection,
    independentProjection: independentProjection(row),
    rawModelProbability: row.rawModelProbability,
    marketProbability: row.marketProbability,
    finalProbability: row.finalProbability,
    probabilityEdge: row.probabilityEdge,
    expectedValue: row.expectedValue,
    participationProbability: row.participationProbability,
    grade: row.grade,
    marketMovement: row.marketMovement,
    healthHolds: [...row.healthHolds],
    modelRelease: row.modelRelease,
    calibrationRelease: row.calibrationRelease,
    decisionRelease: row.decisionRelease,
    writerRelease: args.writerRelease,
    captureRelease: NFL_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,
  })).sort((first, second) => first.rowKey.localeCompare(second.rowKey));
}

export function mergeNflPlayerPropsPrivateTrackingRows(args: {
  previous: readonly NflPlayerPropsPrivateTrackingRow[];
  current: readonly NflPlayerPropsPrivateTrackingRow[];
}): { rows: NflPlayerPropsPrivateTrackingRow[]; added: number; preserved: number; conflicts: number } {
  const rows = new Map(args.previous.map((row) => [row.rowKey, row]));
  let added = 0;
  let preserved = 0;
  let conflicts = 0;
  for (const row of args.current) {
    const prior = rows.get(row.rowKey);
    if (!prior) {
      rows.set(row.rowKey, row);
      added += 1;
    } else if (JSON.stringify(prior) === JSON.stringify(row)) {
      preserved += 1;
    } else {
      // A locked payload is immutable. Later cycles may discover more locked
      // rows, but can never reinterpret or replace a previously captured row.
      conflicts += 1;
    }
  }
  const merged = [...rows.values()].sort((first, second) => first.rowKey.localeCompare(second.rowKey));
  if (merged.length > NFL_PLAYER_PROPS_PRIVATE_TRACKING_MAX_ROWS) {
    throw new Error(`NFL props private tracking exceeds the ${NFL_PLAYER_PROPS_PRIVATE_TRACKING_MAX_ROWS}-row limit.`);
  }
  return { rows: merged, added, preserved, conflicts };
}

export async function captureNflPlayerPropsPrivateTracking(args: {
  client: SupabaseClient;
  snapshot: NflPlayerPropsProductionSnapshot;
  evaluatedAt: string;
  writerRelease: string;
}): Promise<NflPlayerPropsPrivateTrackingCaptureResult> {
  const current = buildNflPlayerPropsPrivateTrackingRows(args);
  const previous = await readNflPlayerPropsPrivateTrackingHistory({
    client: args.client,
    season: args.snapshot.season,
    week: args.snapshot.week,
  });
  const merged = mergeNflPlayerPropsPrivateTrackingRows({ previous: previous?.rows ?? [], current });
  const history: NflPlayerPropsPrivateTrackingHistory = {
    kind: "nfl_player_props_private_tracking_history_v1",
    schema: NFL_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA,
    captureRelease: NFL_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,
    season: args.snapshot.season,
    week: args.snapshot.week,
    createdAt: previous?.createdAt ?? args.evaluatedAt,
    updatedAt: merged.added > 0 ? args.evaluatedAt : (previous?.updatedAt ?? args.evaluatedAt),
    rows: merged.rows,
  };
  const envelope = encodeNflPlayerPropsPrivateTrackingHistory(history);
  if (merged.added > 0) {
    const retentionAt = new Date(Date.parse(args.evaluatedAt)
      + NFL_PLAYER_PROPS_PRIVATE_TRACKING_RETENTION_DAYS * 24 * HOUR_MS).toISOString();
    const { error } = await args.client.from("lab_response_snapshots").upsert({
      snapshot_key: nflPlayerPropsPrivateTrackingKey(args.snapshot.season, args.snapshot.week),
      kind: "daily_edge",
      sport: "nfl",
      slate_date: null,
      payload: envelope,
      payload_version: NFL_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,
      source: args.writerRelease,
      generated_at: args.evaluatedAt,
      expires_at: retentionAt,
      stale_until: retentionAt,
      updated_at: args.evaluatedAt,
    }, { onConflict: "snapshot_key" });
    if (error) throw new Error(`NFL props private tracking write failed: ${error.message}`);
  }
  const canonicalRows = merged.rows.filter((row) => row.canonicalMainLine).length;
  return {
    written: merged.added > 0,
    rowsAdded: merged.added,
    rowsPreserved: merged.preserved,
    identityConflictsPreserved: merged.conflicts,
    totalRows: merged.rows.length,
    canonicalRows,
    alternateRows: merged.rows.length - canonicalRows,
    jsonBytes: envelope.uncompressedBytes,
    gzipBytes: envelope.compressedBytes,
  };
}

export async function captureNflPlayerPropsPrivateTrackingSafely(
  capture: () => Promise<NflPlayerPropsPrivateTrackingCaptureResult>,
): Promise<NflPlayerPropsPrivateTrackingSafeResult> {
  try {
    return { ...(await capture()), error: null };
  } catch (error) {
    return {
      written: false,
      rowsAdded: 0,
      rowsPreserved: 0,
      identityConflictsPreserved: 0,
      totalRows: 0,
      canonicalRows: 0,
      alternateRows: 0,
      jsonBytes: 0,
      gzipBytes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function encodeNflPlayerPropsPrivateTrackingHistory(
  history: NflPlayerPropsPrivateTrackingHistory,
): NflPlayerPropsPrivateTrackingEnvelope {
  if (history.rows.length > NFL_PLAYER_PROPS_PRIVATE_TRACKING_MAX_ROWS) {
    throw new Error(`NFL props private tracking exceeds the ${NFL_PLAYER_PROPS_PRIVATE_TRACKING_MAX_ROWS}-row limit.`);
  }
  const json = JSON.stringify(history);
  const uncompressedBytes = Buffer.byteLength(json);
  if (uncompressedBytes > NFL_PLAYER_PROPS_PRIVATE_TRACKING_MAX_JSON_BYTES) {
    throw new Error(`NFL props private tracking exceeds the ${NFL_PLAYER_PROPS_PRIVATE_TRACKING_MAX_JSON_BYTES}-byte JSON limit.`);
  }
  const compressed = gzipSync(Buffer.from(json), { level: 9 });
  if (compressed.byteLength > NFL_PLAYER_PROPS_PRIVATE_TRACKING_MAX_GZIP_BYTES) {
    throw new Error(`NFL props private tracking exceeds the ${NFL_PLAYER_PROPS_PRIVATE_TRACKING_MAX_GZIP_BYTES}-byte gzip limit.`);
  }
  return {
    kind: "nfl_player_props_private_tracking_envelope_v1",
    schema: NFL_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA,
    captureRelease: NFL_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,
    encoding: "gzip-base64",
    checksum: createHash("sha256").update(json).digest("hex"),
    season: history.season,
    week: history.week,
    uncompressedBytes,
    compressedBytes: compressed.byteLength,
    payload: compressed.toString("base64"),
  };
}

export function decodeNflPlayerPropsPrivateTrackingHistory(
  value: unknown,
): NflPlayerPropsPrivateTrackingHistory | null {
  if (!isEnvelope(value)) return null;
  try {
    const compressed = Buffer.from(value.payload, "base64");
    if (compressed.byteLength !== value.compressedBytes) return null;
    const decoded = gunzipSync(compressed, { maxOutputLength: NFL_PLAYER_PROPS_PRIVATE_TRACKING_MAX_JSON_BYTES });
    if (decoded.byteLength !== value.uncompressedBytes) return null;
    const json = decoded.toString("utf8");
    if (createHash("sha256").update(json).digest("hex") !== value.checksum) return null;
    const parsed = JSON.parse(json) as unknown;
    return isHistory(parsed) && parsed.season === value.season && parsed.week === value.week ? parsed : null;
  } catch {
    return null;
  }
}

export async function readNflPlayerPropsPrivateTrackingHistory(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}): Promise<NflPlayerPropsPrivateTrackingHistory | null> {
  const { data, error } = await args.client.from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", nflPlayerPropsPrivateTrackingKey(args.season, args.week))
    .maybeSingle();
  if (error) throw new Error(`NFL props private tracking read failed: ${error.message}`);
  if (data?.payload === null || data?.payload === undefined) return null;
  const history = decodeNflPlayerPropsPrivateTrackingHistory(data.payload);
  if (!history) throw new Error("NFL props private tracking payload is corrupt or unsupported.");
  return history;
}

function independentProjection(row: Decision): number | null {
  const evidence = row.projectionEvidence;
  if (evidence && "independentProjection" in evidence) return evidence.independentProjection;
  if (evidence && "roleProjection" in evidence) return evidence.roleProjection;
  return row.projection;
}

function privateTrackingRowKey(row: Decision): string {
  return [
    row.decisionRelease,
    row.gameId,
    normalize(row.playerName),
    row.market,
    row.line,
    row.side,
    normalize(row.sportsbook),
  ].join("|");
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]/g, "");
}

function isEnvelope(value: unknown): value is NflPlayerPropsPrivateTrackingEnvelope {
  return isRecord(value)
    && value.kind === "nfl_player_props_private_tracking_envelope_v1"
    && value.schema === NFL_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA
    && value.captureRelease === NFL_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE
    && value.encoding === "gzip-base64"
    && typeof value.checksum === "string"
    && Number.isInteger(value.season)
    && Number.isInteger(value.week)
    && Number.isInteger(value.uncompressedBytes)
    && Number.isInteger(value.compressedBytes)
    && typeof value.payload === "string";
}

function isHistory(value: unknown): value is NflPlayerPropsPrivateTrackingHistory {
  return isRecord(value)
    && value.kind === "nfl_player_props_private_tracking_history_v1"
    && value.schema === NFL_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA
    && value.captureRelease === NFL_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE
    && Number.isInteger(value.season)
    && Number.isInteger(value.week)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && Array.isArray(value.rows);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
