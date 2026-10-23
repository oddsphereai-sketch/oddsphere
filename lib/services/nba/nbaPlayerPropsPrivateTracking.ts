import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type {
  PrivatePlayerPropSettledRow,
  PrivatePlayerPropSide,
} from "../playerPropsPrivateDiagnostics";
import type { NbaPlayerPropMarket } from "./nbaPlayerPropsContract";

export const NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE =
  "nba_player_props_private_tracking_2026_10_23_r3_compact_market_evidence" as const;
export const NBA_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA =
  "nba_player_props_private_tracking_history_v2" as const;
const LEGACY_TRACKING_RELEASE = "nba_player_props_private_tracking_2026_10_21_r2_private_forward" as const;
const LEGACY_TRACKING_SCHEMA = "nba_player_props_private_tracking_history_v1" as const;
export const NBA_PLAYER_PROPS_PRIVATE_TRACKING_MAX_ROWS = 24_000;
export const NBA_PLAYER_PROPS_PRIVATE_TRACKING_MAX_JSON_BYTES = 40_000_000;
export const NBA_PLAYER_PROPS_PRIVATE_TRACKING_MAX_GZIP_BYTES = 3_000_000;

export type NbaPlayerPropsPrivateTrackingRow = Readonly<{
  rowKey: string;
  gameId: string;
  playerId: string;
  playerName: string;
  team: string;
  opponent: string;
  scheduledStart: string;
  market: NbaPlayerPropMarket;
  line: number;
  side: PrivatePlayerPropSide;
  sportsbook: string;
  americanPrice: number;
  canonicalMainLine: boolean;
  independentProjection: number;
  finalProjection: number;
  independentProbability: number;
  marketProbability: number | null;
  finalProbability: number;
  grade: string;
  marketMovement: string | null;
  marketEvidence?: Readonly<{
    mode: "target_excluded_arbitration" | "candidate_projection" | "independent_projection";
    targetExcludedBooks: number;
    targetExcludedReferenceBooks: number;
    movement: Readonly<{
      sportsbook: string;
      openingLine: number;
      priorLine: number | null;
      currentLine: number;
      openingPrice: number;
      priorPrice: number | null;
      currentPrice: number;
    }> | null;
  }>;
  observedAt: string;
  lockedAt: string;
  modelRelease: string;
  calibrationRelease: string;
  decisionRelease: string;
  captureRelease: typeof NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE | typeof LEGACY_TRACKING_RELEASE;
}>;

export type NbaPlayerPropsPrivateTrackingHistory = Readonly<{
  kind: "nba_player_props_private_tracking_history_v2";
  schema: typeof NBA_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA;
  captureRelease: typeof NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE;
  season: number;
  slateDate: string;
  createdAt: string;
  updatedAt: string;
  rows: readonly NbaPlayerPropsPrivateTrackingRow[];
}>;

export type NbaPlayerPropsPrivateTrackingEnvelope = Readonly<{
  kind: "nba_player_props_private_tracking_envelope_v2";
  schema: typeof NBA_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA;
  captureRelease: typeof NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE;
  encoding: "gzip-base64";
  checksum: string;
  season: number;
  slateDate: string;
  uncompressedBytes: number;
  compressedBytes: number;
  payload: string;
}>;

type EncodedTrackingPayload = Readonly<{
  payload: string;
  checksum: string;
  season: number;
  slateDate: string;
  uncompressedBytes: number;
  compressedBytes: number;
}>;

export function buildNbaPlayerPropsPrivateTrackingRow(
  input: Omit<NbaPlayerPropsPrivateTrackingRow, "rowKey" | "captureRelease">,
): NbaPlayerPropsPrivateTrackingRow {
  validateFinite(input.line, "line");
  validateFinite(input.independentProjection, "independentProjection");
  validateFinite(input.finalProjection, "finalProjection");
  validateProbability(input.independentProbability, "independentProbability");
  if (input.marketProbability !== null) validateProbability(input.marketProbability, "marketProbability");
  validateProbability(input.finalProbability, "finalProbability");
  timestamp(input.scheduledStart, "scheduledStart");
  timestamp(input.observedAt, "observedAt");
  timestamp(input.lockedAt, "lockedAt");
  if (!Number.isInteger(input.americanPrice) || input.americanPrice === 0) {
    throw new Error("NBA props private tracking americanPrice is invalid.");
  }
  if (input.marketEvidence) validateMarketEvidence(input.marketEvidence);
  const rowKey = [
    input.decisionRelease,
    input.gameId,
    input.playerId,
    input.market,
    input.line,
    input.side,
    normalize(input.sportsbook),
  ].join("|");
  return { ...input, rowKey, captureRelease: NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE };
}

export function mergeNbaPlayerPropsPrivateTrackingRows(args: {
  previous: readonly NbaPlayerPropsPrivateTrackingRow[];
  current: readonly NbaPlayerPropsPrivateTrackingRow[];
}): { rows: NbaPlayerPropsPrivateTrackingRow[]; added: number; preserved: number; conflicts: number } {
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
      conflicts += 1;
    }
  }
  const merged = [...rows.values()].sort((left, right) => left.rowKey.localeCompare(right.rowKey));
  if (merged.length > NBA_PLAYER_PROPS_PRIVATE_TRACKING_MAX_ROWS) {
    throw new Error(`NBA props private tracking exceeds the ${NBA_PLAYER_PROPS_PRIVATE_TRACKING_MAX_ROWS}-row limit.`);
  }
  return { rows: merged, added, preserved, conflicts };
}

export function settleNbaPlayerPropsPrivateTrackingRow(args: {
  row: NbaPlayerPropsPrivateTrackingRow;
  actual: number;
}): PrivatePlayerPropSettledRow {
  validateFinite(args.actual, "actual");
  return {
    sport: "nba",
    gameId: args.row.gameId,
    playerName: args.row.playerName,
    market: args.row.market,
    line: args.row.line,
    side: args.row.side,
    sportsbook: args.row.sportsbook,
    americanPrice: args.row.americanPrice,
    canonicalMainLine: args.row.canonicalMainLine,
    projection: args.row.finalProjection,
    independentProjection: args.row.independentProjection,
    rawModelProbability: args.row.independentProbability,
    marketProbability: args.row.marketProbability,
    finalProbability: args.row.finalProbability,
    publishedPrediction: args.row.side,
    grade: args.row.grade,
    marketMovement: args.row.marketMovement,
    decisionRelease: args.row.decisionRelease,
    lockedAt: args.row.lockedAt,
    actual: args.actual,
  };
}

export function encodeNbaPlayerPropsPrivateTrackingHistory(
  history: NbaPlayerPropsPrivateTrackingHistory,
): NbaPlayerPropsPrivateTrackingEnvelope {
  if (history.rows.length > NBA_PLAYER_PROPS_PRIVATE_TRACKING_MAX_ROWS) {
    throw new Error(`NBA props private tracking exceeds the ${NBA_PLAYER_PROPS_PRIVATE_TRACKING_MAX_ROWS}-row limit.`);
  }
  const json = JSON.stringify(history);
  const uncompressedBytes = Buffer.byteLength(json);
  if (uncompressedBytes > NBA_PLAYER_PROPS_PRIVATE_TRACKING_MAX_JSON_BYTES) {
    throw new Error("NBA props private tracking JSON limit exceeded.");
  }
  const compressed = gzipSync(Buffer.from(json), { level: 9 });
  if (compressed.byteLength > NBA_PLAYER_PROPS_PRIVATE_TRACKING_MAX_GZIP_BYTES) {
    throw new Error("NBA props private tracking gzip limit exceeded.");
  }
  return {
    kind: "nba_player_props_private_tracking_envelope_v2",
    schema: NBA_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA,
    captureRelease: NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,
    encoding: "gzip-base64",
    checksum: createHash("sha256").update(json).digest("hex"),
    season: history.season,
    slateDate: history.slateDate,
    uncompressedBytes,
    compressedBytes: compressed.byteLength,
    payload: compressed.toString("base64"),
  };
}

export function decodeNbaPlayerPropsPrivateTrackingHistory(
  value: unknown,
): NbaPlayerPropsPrivateTrackingHistory | null {
  if (!isEnvelope(value) && !isLegacyEnvelope(value)) return null;
  try {
    const compressed = Buffer.from(value.payload, "base64");
    if (compressed.byteLength !== value.compressedBytes) return null;
    const decoded = gunzipSync(compressed, { maxOutputLength: NBA_PLAYER_PROPS_PRIVATE_TRACKING_MAX_JSON_BYTES });
    if (decoded.byteLength !== value.uncompressedBytes) return null;
    const json = decoded.toString("utf8");
    if (createHash("sha256").update(json).digest("hex") !== value.checksum) return null;
    const parsed = JSON.parse(json) as unknown;
    if (isHistory(parsed) && parsed.season === value.season && parsed.slateDate === value.slateDate) return parsed;
    if (isLegacyHistory(parsed) && parsed.season === value.season && parsed.slateDate === value.slateDate) {
      return {
        ...parsed,
        kind: "nba_player_props_private_tracking_history_v2",
        schema: NBA_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA,
        captureRelease: NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function isEnvelope(value: unknown): value is NbaPlayerPropsPrivateTrackingEnvelope {
  return isRecord(value)
    && value.kind === "nba_player_props_private_tracking_envelope_v2"
    && value.schema === NBA_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA
    && value.captureRelease === NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE
    && value.encoding === "gzip-base64"
    && typeof value.checksum === "string"
    && Number.isInteger(value.season)
    && typeof value.slateDate === "string"
    && Number.isInteger(value.uncompressedBytes)
    && Number.isInteger(value.compressedBytes)
    && typeof value.payload === "string";
}

function isLegacyEnvelope(value: unknown): value is EncodedTrackingPayload {
  return isRecord(value)
    && value.kind === "nba_player_props_private_tracking_envelope_v1"
    && value.schema === LEGACY_TRACKING_SCHEMA
    && value.captureRelease === LEGACY_TRACKING_RELEASE
    && value.encoding === "gzip-base64"
    && typeof value.checksum === "string"
    && Number.isInteger(value.season)
    && typeof value.slateDate === "string"
    && Number.isInteger(value.uncompressedBytes)
    && Number.isInteger(value.compressedBytes)
    && typeof value.payload === "string";
}

function isHistory(value: unknown): value is NbaPlayerPropsPrivateTrackingHistory {
  return isRecord(value)
    && value.kind === "nba_player_props_private_tracking_history_v2"
    && value.schema === NBA_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA
    && value.captureRelease === NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE
    && Number.isInteger(value.season)
    && typeof value.slateDate === "string"
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && Array.isArray(value.rows);
}

function isLegacyHistory(value: unknown): value is Omit<NbaPlayerPropsPrivateTrackingHistory, "kind" | "schema" | "captureRelease"> & {
  kind: "nba_player_props_private_tracking_history_v1";
  schema: typeof LEGACY_TRACKING_SCHEMA;
  captureRelease: typeof LEGACY_TRACKING_RELEASE;
} {
  return isRecord(value)
    && value.kind === "nba_player_props_private_tracking_history_v1"
    && value.schema === LEGACY_TRACKING_SCHEMA
    && value.captureRelease === LEGACY_TRACKING_RELEASE
    && Number.isInteger(value.season)
    && typeof value.slateDate === "string"
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && Array.isArray(value.rows);
}

function validateMarketEvidence(value: NonNullable<NbaPlayerPropsPrivateTrackingRow["marketEvidence"]>): void {
  if (!Number.isInteger(value.targetExcludedBooks) || value.targetExcludedBooks < 0
    || !Number.isInteger(value.targetExcludedReferenceBooks) || value.targetExcludedReferenceBooks < 0) {
    throw new Error("NBA props private tracking market book counts are invalid.");
  }
  if (!value.movement) return;
  validateFinite(value.movement.openingLine, "marketEvidence.movement.openingLine");
  validateFinite(value.movement.currentLine, "marketEvidence.movement.currentLine");
  validateFinite(value.movement.openingPrice, "marketEvidence.movement.openingPrice");
  validateFinite(value.movement.currentPrice, "marketEvidence.movement.currentPrice");
  if (value.movement.priorLine !== null) validateFinite(value.movement.priorLine, "marketEvidence.movement.priorLine");
  if (value.movement.priorPrice !== null) validateFinite(value.movement.priorPrice, "marketEvidence.movement.priorPrice");
}

function validateFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) throw new Error(`NBA props private tracking ${field} is invalid.`);
}

function validateProbability(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`NBA props private tracking ${field} is invalid.`);
  }
}

function timestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`NBA props private tracking ${field} is invalid.`);
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
