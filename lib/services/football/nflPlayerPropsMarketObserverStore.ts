import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NflPlayerPropMarket } from "./nflPlayerPropsContract";
import type {
  NflPlayerPropsMarketEvidenceBook,
  NflPlayerPropsMarketEvidenceCapture,
} from "./nflPlayerPropsMarketEvidenceCapture";
import { nflPlayerPropsMarketEvidenceId } from "./nflPlayerPropsMarketEvidenceCapture";
import type { NflPlayerPropsProductionSnapshot } from "./nflPlayerPropsProductionContract";

export const NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE =
  "nfl_player_props_market_observer_capture_2026_10_09_r1" as const;
export const NFL_PLAYER_PROPS_MARKET_OBSERVER_SCHEMA = "nfl_props_market_observer_history_v1" as const;
export const NFL_PLAYER_PROPS_MARKET_OBSERVER_KEY_PREFIX = "nfl::player-props-market-observer" as const;
export const NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_ROWS = 24_000;
export const NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_JSON_BYTES = 32_000_000;
export const NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_GZIP_BYTES = 2_000_000;
export const NFL_PLAYER_PROPS_MARKET_OBSERVER_RETENTION_DAYS = 550;
const MAX_BASE64_CHARACTERS = 4 * Math.ceil(NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_GZIP_BYTES / 3);
const HOUR_MS = 60 * 60_000;

export type NflPlayerPropsMarketObserverLandmark = "provider_opening" | "t24" | "t6" | "t60_lock";
export type NflPlayerPropsMarketObserverSourceClass = "sharp" | "retail" | "unknown";
export type NflPlayerPropsMarketObserverProvider = "balldontlie" | "sharpapi" | "unknown";

export type NflPlayerPropsMarketObserverRow = Readonly<{
  rowKey: string;
  landmark: NflPlayerPropsMarketObserverLandmark;
  gameId: string;
  providerPlayerId: string | null;
  playerName: string;
  position: string | null;
  market: NflPlayerPropMarket;
  canonicalLine: number;
  observedLine: number;
  sportsbook: string;
  provider: NflPlayerPropsMarketObserverProvider;
  sourceClass: NflPlayerPropsMarketObserverSourceClass;
  targetSides: readonly ("over" | "under" | "yes")[];
  overPrice: number | null;
  underPrice: number | null;
  yesPrice: number | null;
  observedAt: string;
  fetchedAt: string | null;
  capturedAt: string;
  scheduledStart: string;
  lockAt: string;
  minutesToStartAtCapture: number;
  modelRelease: string;
  calibrationRelease: string;
  decisionRelease: string;
  writerRelease: string;
  captureRelease: typeof NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE;
}>;

export type NflPlayerPropsMarketObserverLandmarkHealth = Readonly<{
  eligibleIdentities: number;
  identitiesWithRows: number;
  rowsBuilt: number;
}>;

export type NflPlayerPropsMarketObserverCycleHealth = Readonly<{
  provider_opening: NflPlayerPropsMarketObserverLandmarkHealth;
  t24: NflPlayerPropsMarketObserverLandmarkHealth;
  t6: NflPlayerPropsMarketObserverLandmarkHealth;
  t60_lock: NflPlayerPropsMarketObserverLandmarkHealth;
}>;

export type NflPlayerPropsMarketObserverHistory = Readonly<{
  kind: "nfl_player_props_market_observer_history_v1";
  schema: typeof NFL_PLAYER_PROPS_MARKET_OBSERVER_SCHEMA;
  captureRelease: typeof NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE;
  season: number;
  week: number;
  createdAt: string;
  updatedAt: string;
  boundaryPolicy: "t60_is_lock_no_post_t60_prelock_interval";
  rowLimit: typeof NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_ROWS;
  rows: readonly NflPlayerPropsMarketObserverRow[];
}>;

export type NflPlayerPropsMarketObserverEnvelope = Readonly<{
  kind: "nfl_player_props_market_observer_envelope_v1";
  schema: typeof NFL_PLAYER_PROPS_MARKET_OBSERVER_SCHEMA;
  captureRelease: typeof NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE;
  encoding: "gzip-base64";
  checksum: string;
  season: number;
  week: number;
  uncompressedBytes: number;
  compressedBytes: number;
  payload: string;
}>;

export type NflPlayerPropsMarketObserverCaptureResult = Readonly<{
  written: boolean;
  rowsAdded: number;
  rowsPreserved: number;
  totalRows: number;
  identityConflictsPreserved: number;
  jsonBytes: number;
  gzipBytes: number;
  health: NflPlayerPropsMarketObserverCycleHealth;
}>;

export type NflPlayerPropsMarketObserverSafeResult = NflPlayerPropsMarketObserverCaptureResult & Readonly<{
  error: string | null;
}>;

type Decision = NflPlayerPropsProductionSnapshot["memberDecisions"][number];
type MutableHealth = Record<NflPlayerPropsMarketObserverLandmark, {
  eligibleIdentities: number;
  identitiesWithRows: number;
  rowsBuilt: number;
}>;

export function nflPlayerPropsMarketObserverKey(season: number, week: number): string {
  return `${NFL_PLAYER_PROPS_MARKET_OBSERVER_KEY_PREFIX}::${season}::${week}`;
}

export function buildNflPlayerPropsMarketObserverRows(args: {
  snapshot: NflPlayerPropsProductionSnapshot;
  currentMarketEvidence?: NflPlayerPropsMarketEvidenceCapture | null;
  evaluatedAt: string;
  maximumLockQuoteAgeHours: number;
  writerRelease: string;
}): { rows: NflPlayerPropsMarketObserverRow[]; health: NflPlayerPropsMarketObserverCycleHealth } {
  const evaluatedAt = parseTimestamp(args.evaluatedAt, "evaluatedAt");
  if (!Number.isFinite(args.maximumLockQuoteAgeHours) || args.maximumLockQuoteAgeHours <= 0) {
    throw new Error("NFL props market observer maximum lock quote age is invalid.");
  }
  const health = emptyMutableHealth();
  const currentEvidence = evidenceById(args.currentMarketEvidence);
  const retainedEvidence = evidenceById(args.snapshot.board.marketEvidence);
  const decisionsById = groupByEvidenceId(args.snapshot.memberDecisions);
  const rows: NflPlayerPropsMarketObserverRow[] = [];

  for (const [evidenceId, decisions] of [...decisionsById.entries()].sort(([first], [second]) => first.localeCompare(second))) {
    const representative = decisions[0]!;
    const start = parseTimestamp(representative.scheduledStart, "scheduledStart");
    const lock = parseTimestamp(representative.lockAt, "lockAt");
    if (evaluatedAt >= start) continue;
    const minutesToStart = (start - evaluatedAt) / 60_000;
    const current = currentEvidence.get(evidenceId);

    if (evaluatedAt < lock) {
      recordLandmark({
        landmark: "provider_opening",
        evidenceId,
        evidence: current,
        decisions,
        evaluatedAt: args.evaluatedAt,
        writerRelease: args.writerRelease,
        health,
        rows,
      });
    }
    if (minutesToStart <= 24 * 60 && minutesToStart > 23 * 60) {
      recordLandmark({ landmark: "t24", evidenceId, evidence: current, decisions, evaluatedAt: args.evaluatedAt, writerRelease: args.writerRelease, health, rows });
    }
    if (minutesToStart <= 6 * 60 && minutesToStart > 5 * 60) {
      recordLandmark({ landmark: "t6", evidenceId, evidence: current, decisions, evaluatedAt: args.evaluatedAt, writerRelease: args.writerRelease, health, rows });
    }
    if (evaluatedAt >= lock) {
      recordLandmark({
        landmark: "t60_lock",
        evidenceId,
        evidence: current ?? retainedEvidence.get(evidenceId),
        decisions,
        evaluatedAt: args.evaluatedAt,
        writerRelease: args.writerRelease,
        maximumLockQuoteAgeHours: args.maximumLockQuoteAgeHours,
        health,
        rows,
      });
    }
  }

  return {
    rows: rows.sort((first, second) => first.rowKey.localeCompare(second.rowKey)),
    health: freezeHealth(health),
  };
}

export function mergeNflPlayerPropsMarketObserverRows(args: {
  previous: readonly NflPlayerPropsMarketObserverRow[];
  current: readonly NflPlayerPropsMarketObserverRow[];
}): { rows: NflPlayerPropsMarketObserverRow[]; added: number; preserved: number; conflicts: number } {
  const rows = new Map(args.previous.map((row) => [row.rowKey, row]));
  let added = 0;
  let preserved = 0;
  let conflicts = 0;
  for (const row of [...args.current].sort((first, second) => first.rowKey.localeCompare(second.rowKey))) {
    const prior = rows.get(row.rowKey);
    if (!prior) {
      rows.set(row.rowKey, row);
      added += 1;
    } else if (JSON.stringify(prior) === JSON.stringify(row)) {
      preserved += 1;
    } else {
      // The first complete observation at a landmark is the immutable record.
      // Later cycles can add books or landmarks, never revise an existing row.
      conflicts += 1;
    }
  }
  const merged = [...rows.values()].sort((first, second) => first.rowKey.localeCompare(second.rowKey));
  if (merged.length > NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_ROWS) {
    throw new Error(`NFL props market observer exceeds the ${NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_ROWS}-row limit.`);
  }
  return { rows: merged, added, preserved, conflicts };
}

export async function captureNflPlayerPropsMarketObserver(args: {
  client: SupabaseClient;
  snapshot: NflPlayerPropsProductionSnapshot;
  currentMarketEvidence?: NflPlayerPropsMarketEvidenceCapture | null;
  evaluatedAt: string;
  maximumLockQuoteAgeHours: number;
  writerRelease: string;
}): Promise<NflPlayerPropsMarketObserverCaptureResult> {
  const built = buildNflPlayerPropsMarketObserverRows(args);
  const previous = await readHistory({ client: args.client, season: args.snapshot.season, week: args.snapshot.week });
  const merged = mergeNflPlayerPropsMarketObserverRows({ previous: previous?.rows ?? [], current: built.rows });
  const history: NflPlayerPropsMarketObserverHistory = {
    kind: "nfl_player_props_market_observer_history_v1",
    schema: NFL_PLAYER_PROPS_MARKET_OBSERVER_SCHEMA,
    captureRelease: NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE,
    season: args.snapshot.season,
    week: args.snapshot.week,
    createdAt: previous?.createdAt ?? args.evaluatedAt,
    updatedAt: merged.added > 0 ? args.evaluatedAt : (previous?.updatedAt ?? args.evaluatedAt),
    boundaryPolicy: "t60_is_lock_no_post_t60_prelock_interval",
    rowLimit: NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_ROWS,
    rows: merged.rows,
  };
  const envelope = encodeNflPlayerPropsMarketObserverHistory(history);
  if (merged.added > 0) {
    const retentionAt = new Date(parseTimestamp(args.evaluatedAt, "evaluatedAt")
      + NFL_PLAYER_PROPS_MARKET_OBSERVER_RETENTION_DAYS * 24 * HOUR_MS).toISOString();
    const { error } = await args.client.from("lab_response_snapshots").upsert({
      snapshot_key: nflPlayerPropsMarketObserverKey(args.snapshot.season, args.snapshot.week),
      kind: "daily_edge",
      sport: "nfl",
      slate_date: null,
      payload: envelope,
      payload_version: NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE,
      source: args.writerRelease,
      generated_at: args.evaluatedAt,
      expires_at: retentionAt,
      stale_until: retentionAt,
      updated_at: args.evaluatedAt,
    }, { onConflict: "snapshot_key" });
    if (error) throw new Error(`NFL props market observer write failed: ${error.message}`);
  }
  return {
    written: merged.added > 0,
    rowsAdded: merged.added,
    rowsPreserved: merged.preserved,
    totalRows: merged.rows.length,
    identityConflictsPreserved: merged.conflicts,
    jsonBytes: envelope.uncompressedBytes,
    gzipBytes: envelope.compressedBytes,
    health: built.health,
  };
}

export async function captureNflPlayerPropsMarketObserverSafely(
  capture: () => Promise<NflPlayerPropsMarketObserverCaptureResult>,
): Promise<NflPlayerPropsMarketObserverSafeResult> {
  try {
    return { ...(await capture()), error: null };
  } catch (error) {
    return {
      written: false,
      rowsAdded: 0,
      rowsPreserved: 0,
      totalRows: 0,
      identityConflictsPreserved: 0,
      jsonBytes: 0,
      gzipBytes: 0,
      health: emptyHealth(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function encodeNflPlayerPropsMarketObserverHistory(
  history: NflPlayerPropsMarketObserverHistory,
): NflPlayerPropsMarketObserverEnvelope {
  if (history.rows.length > NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_ROWS) {
    throw new Error(`NFL props market observer exceeds the ${NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_ROWS}-row limit.`);
  }
  const json = JSON.stringify(history);
  const uncompressedBytes = Buffer.byteLength(json);
  if (uncompressedBytes > NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_JSON_BYTES) {
    throw new Error(`NFL props market observer exceeds the ${NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_JSON_BYTES}-byte JSON limit.`);
  }
  const compressed = gzipSync(Buffer.from(json), { level: 9 });
  if (compressed.byteLength > NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_GZIP_BYTES) {
    throw new Error(`NFL props market observer exceeds the ${NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_GZIP_BYTES}-byte gzip limit.`);
  }
  return {
    kind: "nfl_player_props_market_observer_envelope_v1",
    schema: NFL_PLAYER_PROPS_MARKET_OBSERVER_SCHEMA,
    captureRelease: NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE,
    encoding: "gzip-base64",
    checksum: createHash("sha256").update(json).digest("hex"),
    season: history.season,
    week: history.week,
    uncompressedBytes,
    compressedBytes: compressed.byteLength,
    payload: compressed.toString("base64"),
  };
}

export function decodeNflPlayerPropsMarketObserverHistory(
  value: unknown,
): NflPlayerPropsMarketObserverHistory | null {
  if (!isEnvelope(value)) return null;
  try {
    const compressed = Buffer.from(value.payload, "base64");
    if (compressed.byteLength !== value.compressedBytes) return null;
    const decoded = gunzipSync(compressed, { maxOutputLength: NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_JSON_BYTES });
    if (decoded.byteLength !== value.uncompressedBytes) return null;
    const json = decoded.toString("utf8");
    if (createHash("sha256").update(json).digest("hex") !== value.checksum) return null;
    const parsed = JSON.parse(json) as unknown;
    if (!isHistory(parsed) || parsed.season !== value.season || parsed.week !== value.week) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readHistory(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}): Promise<NflPlayerPropsMarketObserverHistory | null> {
  const { data, error } = await args.client.from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", nflPlayerPropsMarketObserverKey(args.season, args.week))
    .maybeSingle();
  if (error) throw new Error(`NFL props market observer read failed: ${error.message}`);
  if (data?.payload === null || data?.payload === undefined) return null;
  const history = decodeNflPlayerPropsMarketObserverHistory(data.payload);
  if (!history) throw new Error("NFL props market observer payload is corrupt or unsupported.");
  return history;
}

function recordLandmark(args: {
  landmark: NflPlayerPropsMarketObserverLandmark;
  evidenceId: string;
  evidence?: NflPlayerPropsMarketEvidenceCapture["i"][number];
  decisions: readonly Decision[];
  evaluatedAt: string;
  writerRelease: string;
  maximumLockQuoteAgeHours?: number;
  health: MutableHealth;
  rows: NflPlayerPropsMarketObserverRow[];
}): void {
  args.health[args.landmark].eligibleIdentities += 1;
  const evidence = args.evidence;
  const built = evidence ? rowsForLandmark({ ...args, evidence }) : [];
  if (built.length > 0) args.health[args.landmark].identitiesWithRows += 1;
  args.health[args.landmark].rowsBuilt += built.length;
  args.rows.push(...built);
}

function rowsForLandmark(args: {
  landmark: NflPlayerPropsMarketObserverLandmark;
  evidenceId: string;
  evidence: NflPlayerPropsMarketEvidenceCapture["i"][number];
  decisions: readonly Decision[];
  evaluatedAt: string;
  writerRelease: string;
  maximumLockQuoteAgeHours?: number;
}): NflPlayerPropsMarketObserverRow[] {
  const representative = args.decisions[0]!;
  const evaluatedAt = parseTimestamp(args.evaluatedAt, "evaluatedAt");
  const start = parseTimestamp(representative.scheduledStart, "scheduledStart");
  const lock = parseTimestamp(representative.lockAt, "lockAt");
  const releases = new Set(args.decisions.map((decision) => [
    decision.modelRelease, decision.calibrationRelease, decision.decisionRelease,
  ].join("|")));
  if (releases.size !== 1) return [];
  return args.evidence[2].flatMap((book) => {
    const opening = args.landmark === "provider_opening";
    const observedAt = opening ? book[6] : book[3];
    const observedLine = opening ? book[7] : representative.line;
    const overPrice = opening ? book[11] : book[8];
    const underPrice = opening ? book[12] : book[9];
    const yesPrice = opening ? book[13] : book[10];
    if (!observedAt || observedLine === null || !completePrices(representative.market, overPrice, underPrice, yesPrice)) return [];
    const observed = Date.parse(observedAt);
    if (!Number.isFinite(observed) || observed > evaluatedAt || observed >= start) return [];
    if (opening) {
      if (observed > Date.parse(book[3])) return [];
    } else {
      const fetched = Date.parse(book[4]);
      if (!Number.isFinite(fetched) || fetched < observed || fetched > evaluatedAt + 60_000) return [];
    }
    if (args.landmark === "t60_lock") {
      const maximumAgeMs = (args.maximumLockQuoteAgeHours ?? 0) * HOUR_MS;
      if (observed > lock || lock - observed > maximumAgeMs) return [];
    }
    return [{
      rowKey: `${args.evidenceId}|${args.landmark}|${book[0]}`,
      landmark: args.landmark,
      gameId: representative.gameId,
      providerPlayerId: representative.providerPlayerId,
      playerName: representative.playerName,
      position: representative.forecastContext.position,
      market: representative.market,
      canonicalLine: representative.line,
      observedLine,
      sportsbook: book[0],
      provider: providerName(book),
      sourceClass: sourceClassName(book),
      targetSides: targetSides(book[14]),
      overPrice,
      underPrice,
      yesPrice,
      observedAt,
      fetchedAt: opening ? null : book[4],
      capturedAt: args.evaluatedAt,
      scheduledStart: representative.scheduledStart,
      lockAt: representative.lockAt,
      minutesToStartAtCapture: (start - evaluatedAt) / 60_000,
      modelRelease: representative.modelRelease,
      calibrationRelease: representative.calibrationRelease,
      decisionRelease: representative.decisionRelease,
      writerRelease: args.writerRelease,
      captureRelease: NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE,
    } satisfies NflPlayerPropsMarketObserverRow];
  });
}

function evidenceById(
  evidence?: NflPlayerPropsMarketEvidenceCapture | null,
): Map<string, NflPlayerPropsMarketEvidenceCapture["i"][number]> {
  return new Map((evidence?.i ?? []).map((identity) => [identity[0], identity]));
}

function groupByEvidenceId(decisions: readonly Decision[]): Map<string, Decision[]> {
  const groups = new Map<string, Decision[]>();
  for (const decision of decisions) {
    const evidenceId = decision.marketEvidenceId ?? nflPlayerPropsMarketEvidenceId(decision);
    groups.set(evidenceId, [...(groups.get(evidenceId) ?? []), decision]);
  }
  return groups;
}

function completePrices(
  market: NflPlayerPropMarket,
  over: number | null,
  under: number | null,
  yes: number | null,
): boolean {
  return market === "anytime_td"
    ? validPrice(yes)
    : validPrice(over) && validPrice(under);
}

function validPrice(price: number | null): boolean {
  return price !== null && Number.isInteger(price) && price !== 0;
}

function targetSides(mask: number): readonly ("over" | "under" | "yes")[] {
  return [
    ...(mask & 1 ? ["over" as const] : []),
    ...(mask & 2 ? ["under" as const] : []),
    ...(mask & 4 ? ["yes" as const] : []),
  ];
}

function providerName(book: NflPlayerPropsMarketEvidenceBook): NflPlayerPropsMarketObserverProvider {
  if (book[1] === "b") return "balldontlie";
  if (book[1] === "s") return "sharpapi";
  return "unknown";
}

function sourceClassName(book: NflPlayerPropsMarketEvidenceBook): NflPlayerPropsMarketObserverSourceClass {
  if (book[2] === "s") return "sharp";
  if (book[2] === "r") return "retail";
  return "unknown";
}

function emptyMutableHealth(): MutableHealth {
  return {
    provider_opening: { eligibleIdentities: 0, identitiesWithRows: 0, rowsBuilt: 0 },
    t24: { eligibleIdentities: 0, identitiesWithRows: 0, rowsBuilt: 0 },
    t6: { eligibleIdentities: 0, identitiesWithRows: 0, rowsBuilt: 0 },
    t60_lock: { eligibleIdentities: 0, identitiesWithRows: 0, rowsBuilt: 0 },
  };
}

function emptyHealth(): NflPlayerPropsMarketObserverCycleHealth {
  return freezeHealth(emptyMutableHealth());
}

function freezeHealth(value: MutableHealth): NflPlayerPropsMarketObserverCycleHealth {
  return {
    provider_opening: { ...value.provider_opening },
    t24: { ...value.t24 },
    t6: { ...value.t6 },
    t60_lock: { ...value.t60_lock },
  };
}

function parseTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`NFL props market observer ${label} is invalid.`);
  return parsed;
}

function isEnvelope(value: unknown): value is NflPlayerPropsMarketObserverEnvelope {
  if (!isRecord(value)) return false;
  return value.kind === "nfl_player_props_market_observer_envelope_v1"
    && value.schema === NFL_PLAYER_PROPS_MARKET_OBSERVER_SCHEMA
    && value.captureRelease === NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE
    && value.encoding === "gzip-base64"
    && typeof value.checksum === "string"
    && Number.isInteger(value.season)
    && Number.isInteger(value.week)
    && Number.isInteger(value.uncompressedBytes)
    && Number(value.uncompressedBytes) >= 0
    && Number(value.uncompressedBytes) <= NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_JSON_BYTES
    && Number.isInteger(value.compressedBytes)
    && Number(value.compressedBytes) >= 0
    && Number(value.compressedBytes) <= NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_GZIP_BYTES
    && typeof value.payload === "string"
    && value.payload.length <= MAX_BASE64_CHARACTERS
    && value.payload.length % 4 === 0
    && /^[A-Za-z0-9+/]*={0,2}$/.test(value.payload);
}

function isHistory(value: unknown): value is NflPlayerPropsMarketObserverHistory {
  return isRecord(value)
    && value.kind === "nfl_player_props_market_observer_history_v1"
    && value.schema === NFL_PLAYER_PROPS_MARKET_OBSERVER_SCHEMA
    && value.captureRelease === NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE
    && Number.isInteger(value.season)
    && Number.isInteger(value.week)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && value.boundaryPolicy === "t60_is_lock_no_post_t60_prelock_interval"
    && value.rowLimit === NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_ROWS
    && Array.isArray(value.rows)
    && value.rows.length <= NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_ROWS
    && value.rows.every(isRow)
    && new Set(value.rows.map((row) => row.rowKey)).size === value.rows.length;
}

function isRow(value: unknown): value is NflPlayerPropsMarketObserverRow {
  if (!isRecord(value)) return false;
  const landmark = value.landmark;
  const keySuffix = typeof value.sportsbook === "string" ? `|${landmark}|${value.sportsbook}` : "";
  return typeof value.rowKey === "string"
    && (landmark === "provider_opening" || landmark === "t24" || landmark === "t6" || landmark === "t60_lock")
    && value.rowKey.endsWith(keySuffix)
    && typeof value.gameId === "string"
    && (value.providerPlayerId === null || typeof value.providerPlayerId === "string")
    && typeof value.playerName === "string"
    && (value.position === null || typeof value.position === "string")
    && typeof value.market === "string"
    && typeof value.canonicalLine === "number"
    && typeof value.observedLine === "number"
    && typeof value.sportsbook === "string"
    && (value.provider === "balldontlie" || value.provider === "sharpapi" || value.provider === "unknown")
    && (value.sourceClass === "sharp" || value.sourceClass === "retail" || value.sourceClass === "unknown")
    && Array.isArray(value.targetSides)
    && value.targetSides.every((side) => side === "over" || side === "under" || side === "yes")
    && (value.overPrice === null || Number.isInteger(value.overPrice))
    && (value.underPrice === null || Number.isInteger(value.underPrice))
    && (value.yesPrice === null || Number.isInteger(value.yesPrice))
    && typeof value.observedAt === "string"
    && (value.fetchedAt === null || typeof value.fetchedAt === "string")
    && typeof value.capturedAt === "string"
    && typeof value.scheduledStart === "string"
    && typeof value.lockAt === "string"
    && typeof value.minutesToStartAtCapture === "number"
    && typeof value.modelRelease === "string"
    && typeof value.calibrationRelease === "string"
    && typeof value.decisionRelease === "string"
    && typeof value.writerRelease === "string"
    && value.captureRelease === NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
