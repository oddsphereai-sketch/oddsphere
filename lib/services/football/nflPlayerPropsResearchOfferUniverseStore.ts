import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NflPlayerPropMarket } from "./nflPlayerPropsContract";
import type { NflPlayerPropsExactOffer } from "./nflPlayerPropsMarketBoard";

export const NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE =
  "nfl_player_props_research_offer_universe_2026_10_16_r1" as const;
export const NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_SCHEMA =
  "nfl_props_research_offer_universe_v1" as const;
export const NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_KEY_PREFIX =
  "nfl::player-props-research-offer-universe" as const;
export const NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS = 40_000;
export const NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_JSON_BYTES = 48_000_000;
export const NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_GZIP_BYTES = 4_000_000;
export const NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RETENTION_DAYS = 550;
const MAX_BASE64_CHARACTERS = 4 * Math.ceil(NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_GZIP_BYTES / 3);
const HOUR_MS = 60 * 60_000;

export const NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS = [
  "passing_tds",
  "longest_pass",
  "longest_reception",
  "longest_rush",
  "fg_made",
  "kicking_points",
] as const satisfies readonly NflPlayerPropMarket[];

const RESEARCH_MARKETS = new Set<NflPlayerPropMarket>(NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS);

export type NflPlayerPropsResearchOfferLandmark = "provider_opening" | "t24" | "t6" | "t60_lock";

export type NflPlayerPropsResearchOfferUniverseRow = Readonly<{
  rowKey: string;
  landmark: NflPlayerPropsResearchOfferLandmark;
  gameId: string;
  providerEventId: string;
  providerPlayerId: string | null;
  playerName: string;
  playerTeam: string | null;
  market: (typeof NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS)[number];
  offerType: "over_under" | "milestone";
  sportsbook: string;
  provider: "balldontlie" | "sharpapi";
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  yesPrice: number | null;
  exactPriceComplete: boolean;
  healthHolds: readonly string[];
  observedAt: string;
  fetchedAt: string | null;
  capturedAt: string;
  scheduledStart: string;
  lockAt: string;
  minutesToStartAtCapture: number;
  writerRelease: string;
  captureRelease: typeof NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE;
}>;

export type NflPlayerPropsResearchOfferMarketHealth = Readonly<{
  inputOffers: number;
  completeOffers: number;
  rowsBuilt: number;
  books: readonly string[];
}>;

export type NflPlayerPropsResearchOfferUniverseHealth = Readonly<{
  byMarket: Readonly<Record<(typeof NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS)[number], NflPlayerPropsResearchOfferMarketHealth>>;
  inputOffers: number;
  eligibleOffers: number;
  completeOffers: number;
  rowsBuilt: number;
}>;

export type NflPlayerPropsResearchOfferUniverseHistory = Readonly<{
  kind: "nfl_player_props_research_offer_universe_v1";
  schema: typeof NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_SCHEMA;
  captureRelease: typeof NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE;
  season: number;
  week: number;
  createdAt: string;
  updatedAt: string;
  boundaryPolicy: "opening_t24_t6_t60_first_observation_immutable";
  rowLimit: typeof NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS;
  rows: readonly NflPlayerPropsResearchOfferUniverseRow[];
}>;

export type NflPlayerPropsResearchOfferUniverseEnvelope = Readonly<{
  kind: "nfl_player_props_research_offer_universe_envelope_v1";
  schema: typeof NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_SCHEMA;
  captureRelease: typeof NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE;
  encoding: "gzip-base64";
  checksum: string;
  season: number;
  week: number;
  uncompressedBytes: number;
  compressedBytes: number;
  payload: string;
}>;

export type NflPlayerPropsResearchOfferUniverseCaptureResult = Readonly<{
  written: boolean;
  rowsAdded: number;
  rowsPreserved: number;
  totalRows: number;
  identityConflictsPreserved: number;
  jsonBytes: number;
  gzipBytes: number;
  health: NflPlayerPropsResearchOfferUniverseHealth;
}>;

export type NflPlayerPropsResearchOfferUniverseSafeResult =
  NflPlayerPropsResearchOfferUniverseCaptureResult & Readonly<{ error: string | null }>;

type MutableMarketHealth = {
  inputOffers: number;
  completeOffers: number;
  rowsBuilt: number;
  books: Set<string>;
};

export function nflPlayerPropsResearchOfferUniverseKey(season: number, week: number): string {
  return `${NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_KEY_PREFIX}::${season}::${week}`;
}

export function buildNflPlayerPropsResearchOfferUniverseRows(args: {
  offers: readonly NflPlayerPropsExactOffer[];
  evaluatedAt: string;
  maximumLockQuoteAgeHours: number;
  writerRelease: string;
}): { rows: NflPlayerPropsResearchOfferUniverseRow[]; health: NflPlayerPropsResearchOfferUniverseHealth } {
  const evaluatedAt = timestamp(args.evaluatedAt, "evaluatedAt");
  if (!Number.isFinite(args.maximumLockQuoteAgeHours) || args.maximumLockQuoteAgeHours <= 0) {
    throw new Error("NFL props research offer-universe maximum lock quote age is invalid.");
  }
  const health = emptyMutableHealth();
  const rows: NflPlayerPropsResearchOfferUniverseRow[] = [];

  for (const offer of [...args.offers].sort((first, second) => first.offerKey.localeCompare(second.offerKey))) {
    const marketHealth = RESEARCH_MARKETS.has(offer.market) ? health[offer.market as ResearchMarket] : null;
    if (!marketHealth) continue;
    marketHealth.inputOffers += 1;
    marketHealth.books.add(normalizeBook(offer.sportsbook));
    if (offer.exactPriceComplete) marketHealth.completeOffers += 1;
    const start = timestamp(offer.scheduledStart, "scheduledStart");
    const lock = timestamp(offer.lockAt, "lockAt");
    if (evaluatedAt >= start) continue;
    const minutesToStart = (start - evaluatedAt) / 60_000;

    if (evaluatedAt < lock && offer.openingObservedAt !== null && offer.openingLine !== null) {
      const opening = researchRow({
        offer,
        landmark: "provider_opening",
        line: offer.openingLine,
        overPrice: offer.openingOverPrice,
        underPrice: offer.openingUnderPrice,
        yesPrice: offer.openingYesPrice,
        observedAt: offer.openingObservedAt,
        fetchedAt: null,
        evaluatedAt: args.evaluatedAt,
        minutesToStart,
        writerRelease: args.writerRelease,
      });
      if (opening) rows.push(opening);
    }
    const landmark = currentLandmark({ evaluatedAt, start, lock, minutesToStart });
    if (landmark) {
      const current = researchRow({
        offer,
        landmark,
        line: offer.line,
        overPrice: offer.overPrice,
        underPrice: offer.underPrice,
        yesPrice: offer.yesPrice,
        observedAt: offer.observedAt,
        fetchedAt: offer.fetchedAt,
        evaluatedAt: args.evaluatedAt,
        minutesToStart,
        writerRelease: args.writerRelease,
        maximumLockQuoteAgeHours: args.maximumLockQuoteAgeHours,
      });
      if (current) rows.push(current);
    }
  }

  const uniqueRows = uniqueByRowKey(rows);
  for (const row of uniqueRows) health[row.market].rowsBuilt += 1;
  return { rows: uniqueRows, health: freezeHealth(health, args.offers.length) };
}

export function mergeNflPlayerPropsResearchOfferUniverseRows(args: {
  previous: readonly NflPlayerPropsResearchOfferUniverseRow[];
  current: readonly NflPlayerPropsResearchOfferUniverseRow[];
}): { rows: NflPlayerPropsResearchOfferUniverseRow[]; added: number; preserved: number; conflicts: number } {
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
      conflicts += 1;
    }
  }
  const merged = [...rows.values()].sort((first, second) => first.rowKey.localeCompare(second.rowKey));
  if (merged.length > NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS) {
    throw new Error(`NFL props research offer universe exceeds the ${NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS}-row limit.`);
  }
  return { rows: merged, added, preserved, conflicts };
}

export async function captureNflPlayerPropsResearchOfferUniverse(args: {
  client: SupabaseClient;
  season: number;
  week: number;
  offers: readonly NflPlayerPropsExactOffer[];
  evaluatedAt: string;
  maximumLockQuoteAgeHours: number;
  writerRelease: string;
}): Promise<NflPlayerPropsResearchOfferUniverseCaptureResult> {
  const built = buildNflPlayerPropsResearchOfferUniverseRows(args);
  const previous = await readHistory({ client: args.client, season: args.season, week: args.week });
  const merged = mergeNflPlayerPropsResearchOfferUniverseRows({ previous: previous?.rows ?? [], current: built.rows });
  const history: NflPlayerPropsResearchOfferUniverseHistory = {
    kind: "nfl_player_props_research_offer_universe_v1",
    schema: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_SCHEMA,
    captureRelease: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE,
    season: args.season,
    week: args.week,
    createdAt: previous?.createdAt ?? args.evaluatedAt,
    updatedAt: merged.added > 0 ? args.evaluatedAt : (previous?.updatedAt ?? args.evaluatedAt),
    boundaryPolicy: "opening_t24_t6_t60_first_observation_immutable",
    rowLimit: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS,
    rows: merged.rows,
  };
  const envelope = encodeNflPlayerPropsResearchOfferUniverseHistory(history);
  if (merged.added > 0) {
    const retentionAt = new Date(timestamp(args.evaluatedAt, "evaluatedAt")
      + NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RETENTION_DAYS * 24 * HOUR_MS).toISOString();
    const { error } = await args.client.from("lab_response_snapshots").upsert({
      snapshot_key: nflPlayerPropsResearchOfferUniverseKey(args.season, args.week),
      kind: "daily_edge",
      sport: "nfl",
      slate_date: null,
      payload: envelope,
      payload_version: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE,
      source: args.writerRelease,
      generated_at: args.evaluatedAt,
      expires_at: retentionAt,
      stale_until: retentionAt,
      updated_at: args.evaluatedAt,
    }, { onConflict: "snapshot_key" });
    if (error) throw new Error(`NFL props research offer-universe write failed: ${error.message}`);
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

export async function captureNflPlayerPropsResearchOfferUniverseSafely(
  capture: () => Promise<NflPlayerPropsResearchOfferUniverseCaptureResult>,
): Promise<NflPlayerPropsResearchOfferUniverseSafeResult> {
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

export function encodeNflPlayerPropsResearchOfferUniverseHistory(
  history: NflPlayerPropsResearchOfferUniverseHistory,
): NflPlayerPropsResearchOfferUniverseEnvelope {
  if (history.rows.length > NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS) {
    throw new Error(`NFL props research offer universe exceeds the ${NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS}-row limit.`);
  }
  const json = JSON.stringify(history);
  const uncompressedBytes = Buffer.byteLength(json);
  if (uncompressedBytes > NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_JSON_BYTES) {
    throw new Error(`NFL props research offer universe exceeds the ${NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_JSON_BYTES}-byte JSON limit.`);
  }
  const compressed = gzipSync(Buffer.from(json), { level: 9 });
  if (compressed.byteLength > NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_GZIP_BYTES) {
    throw new Error(`NFL props research offer universe exceeds the ${NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_GZIP_BYTES}-byte gzip limit.`);
  }
  return {
    kind: "nfl_player_props_research_offer_universe_envelope_v1",
    schema: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_SCHEMA,
    captureRelease: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE,
    encoding: "gzip-base64",
    checksum: createHash("sha256").update(json).digest("hex"),
    season: history.season,
    week: history.week,
    uncompressedBytes,
    compressedBytes: compressed.byteLength,
    payload: compressed.toString("base64"),
  };
}

export function decodeNflPlayerPropsResearchOfferUniverseHistory(
  value: unknown,
): NflPlayerPropsResearchOfferUniverseHistory | null {
  if (!isEnvelope(value)) return null;
  try {
    const compressed = Buffer.from(value.payload, "base64");
    if (compressed.byteLength !== value.compressedBytes) return null;
    const decoded = gunzipSync(compressed, { maxOutputLength: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_JSON_BYTES });
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
}): Promise<NflPlayerPropsResearchOfferUniverseHistory | null> {
  const { data, error } = await args.client.from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", nflPlayerPropsResearchOfferUniverseKey(args.season, args.week))
    .maybeSingle();
  if (error) throw new Error(`NFL props research offer-universe read failed: ${error.message}`);
  if (data?.payload === null || data?.payload === undefined) return null;
  const history = decodeNflPlayerPropsResearchOfferUniverseHistory(data.payload);
  if (!history) throw new Error("NFL props research offer-universe payload is corrupt or unsupported.");
  return history;
}

type ResearchMarket = (typeof NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS)[number];

function researchRow(args: {
  offer: NflPlayerPropsExactOffer;
  landmark: NflPlayerPropsResearchOfferLandmark;
  line: number;
  overPrice: number | null;
  underPrice: number | null;
  yesPrice: number | null;
  observedAt: string;
  fetchedAt: string | null;
  evaluatedAt: string;
  minutesToStart: number;
  writerRelease: string;
  maximumLockQuoteAgeHours?: number;
}): NflPlayerPropsResearchOfferUniverseRow | null {
  const observedAt = Date.parse(args.observedAt);
  const evaluatedAt = Date.parse(args.evaluatedAt);
  const start = Date.parse(args.offer.scheduledStart);
  const lock = Date.parse(args.offer.lockAt);
  if (!Number.isFinite(observedAt) || observedAt > evaluatedAt || observedAt >= start) return null;
  if (args.fetchedAt !== null) {
    const fetchedAt = Date.parse(args.fetchedAt);
    if (!Number.isFinite(fetchedAt) || fetchedAt + 60_000 < observedAt || fetchedAt > evaluatedAt + 60_000) return null;
  }
  if (args.landmark === "provider_opening" && observedAt > Date.parse(args.offer.observedAt)) return null;
  if (args.landmark === "t60_lock") {
    const maximumAgeMs = (args.maximumLockQuoteAgeHours ?? 0) * HOUR_MS;
    if (observedAt > lock || lock - observedAt > maximumAgeMs) return null;
  }
  const complete = completePrices(args.offer.offerType, args.overPrice, args.underPrice, args.yesPrice);
  const identity = [
    args.offer.canonicalGameId,
    args.offer.providerPlayerId ?? normalizeName(args.offer.playerName),
    args.offer.market,
    args.offer.sportsbook.toLowerCase(),
    args.offer.provider,
    args.offer.offerType,
    args.line,
    args.landmark,
  ].join("|");
  return {
    rowKey: createHash("sha256").update(identity).digest("hex").slice(0, 24),
    landmark: args.landmark,
    gameId: args.offer.canonicalGameId,
    providerEventId: args.offer.providerEventId,
    providerPlayerId: args.offer.providerPlayerId,
    playerName: args.offer.playerName,
    playerTeam: args.offer.playerTeam,
    market: args.offer.market as ResearchMarket,
    offerType: args.offer.offerType,
    sportsbook: args.offer.sportsbook,
    provider: args.offer.provider,
    line: args.line,
    overPrice: args.overPrice,
    underPrice: args.underPrice,
    yesPrice: args.yesPrice,
    exactPriceComplete: complete,
    healthHolds: complete ? [] : ["incomplete_exact_side_prices"],
    observedAt: args.observedAt,
    fetchedAt: args.fetchedAt,
    capturedAt: args.evaluatedAt,
    scheduledStart: args.offer.scheduledStart,
    lockAt: args.offer.lockAt,
    minutesToStartAtCapture: args.minutesToStart,
    writerRelease: args.writerRelease,
    captureRelease: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE,
  };
}

function currentLandmark(args: {
  evaluatedAt: number;
  start: number;
  lock: number;
  minutesToStart: number;
}): Exclude<NflPlayerPropsResearchOfferLandmark, "provider_opening"> | null {
  if (args.evaluatedAt >= args.lock) return args.evaluatedAt < args.start ? "t60_lock" : null;
  if (args.minutesToStart <= 24 * 60 && args.minutesToStart > 23 * 60) return "t24";
  if (args.minutesToStart <= 6 * 60 && args.minutesToStart > 5 * 60) return "t6";
  return null;
}

function completePrices(
  offerType: NflPlayerPropsExactOffer["offerType"],
  over: number | null,
  under: number | null,
  yes: number | null,
): boolean {
  return offerType === "milestone" ? validPrice(yes) : validPrice(over) && validPrice(under);
}

function validPrice(value: number | null): boolean {
  return value !== null && Number.isInteger(value) && value !== 0;
}

function uniqueByRowKey(
  rows: readonly NflPlayerPropsResearchOfferUniverseRow[],
): NflPlayerPropsResearchOfferUniverseRow[] {
  const unique = new Map<string, NflPlayerPropsResearchOfferUniverseRow>();
  for (const row of [...rows].sort((first, second) => first.rowKey.localeCompare(second.rowKey)
    || first.observedAt.localeCompare(second.observedAt))) {
    if (!unique.has(row.rowKey)) unique.set(row.rowKey, row);
  }
  return [...unique.values()].sort((first, second) => first.rowKey.localeCompare(second.rowKey));
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function normalizeName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`NFL props research offer-universe ${label} is invalid.`);
  return parsed;
}

function emptyMutableHealth(): Record<ResearchMarket, MutableMarketHealth> {
  return Object.fromEntries(NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS.map((market) => [market, {
    inputOffers: 0,
    completeOffers: 0,
    rowsBuilt: 0,
    books: new Set<string>(),
  }])) as Record<ResearchMarket, MutableMarketHealth>;
}

function freezeHealth(
  health: Record<ResearchMarket, MutableMarketHealth>,
  inputOffers: number,
): NflPlayerPropsResearchOfferUniverseHealth {
  const byMarket = Object.fromEntries(NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS.map((market) => [market, {
    inputOffers: health[market].inputOffers,
    completeOffers: health[market].completeOffers,
    rowsBuilt: health[market].rowsBuilt,
    books: [...health[market].books].sort(),
  }])) as NflPlayerPropsResearchOfferUniverseHealth["byMarket"];
  return {
    byMarket,
    inputOffers,
    eligibleOffers: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS.reduce(
      (sum, market) => sum + health[market].inputOffers, 0,
    ),
    completeOffers: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS.reduce(
      (sum, market) => sum + health[market].completeOffers, 0,
    ),
    rowsBuilt: NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS.reduce(
      (sum, market) => sum + health[market].rowsBuilt, 0,
    ),
  };
}

function emptyHealth(): NflPlayerPropsResearchOfferUniverseHealth {
  return freezeHealth(emptyMutableHealth(), 0);
}

function isEnvelope(value: unknown): value is NflPlayerPropsResearchOfferUniverseEnvelope {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<NflPlayerPropsResearchOfferUniverseEnvelope>;
  return row.kind === "nfl_player_props_research_offer_universe_envelope_v1"
    && row.schema === NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_SCHEMA
    && row.captureRelease === NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE
    && row.encoding === "gzip-base64"
    && typeof row.checksum === "string"
    && Number.isInteger(row.season)
    && Number.isInteger(row.week)
    && Number.isInteger(row.uncompressedBytes)
    && row.uncompressedBytes! >= 0
    && row.uncompressedBytes! <= NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_JSON_BYTES
    && Number.isInteger(row.compressedBytes)
    && row.compressedBytes! >= 0
    && row.compressedBytes! <= NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_GZIP_BYTES
    && typeof row.payload === "string"
    && row.payload.length <= MAX_BASE64_CHARACTERS
    && row.payload.length % 4 === 0
    && /^[A-Za-z0-9+/]*={0,2}$/.test(row.payload);
}

function isHistory(value: unknown): value is NflPlayerPropsResearchOfferUniverseHistory {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<NflPlayerPropsResearchOfferUniverseHistory>;
  return row.kind === "nfl_player_props_research_offer_universe_v1"
    && row.schema === NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_SCHEMA
    && row.captureRelease === NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE
    && Number.isInteger(row.season)
    && Number.isInteger(row.week)
    && typeof row.createdAt === "string"
    && typeof row.updatedAt === "string"
    && row.boundaryPolicy === "opening_t24_t6_t60_first_observation_immutable"
    && row.rowLimit === NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS
    && Array.isArray(row.rows)
    && row.rows.length <= NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MAX_ROWS
    && row.rows.every(isRow);
}

function isRow(value: unknown): value is NflPlayerPropsResearchOfferUniverseRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<NflPlayerPropsResearchOfferUniverseRow>;
  return typeof row.rowKey === "string"
    && ["provider_opening", "t24", "t6", "t60_lock"].includes(row.landmark ?? "")
    && typeof row.gameId === "string"
    && typeof row.providerEventId === "string"
    && (row.providerPlayerId === null || typeof row.providerPlayerId === "string")
    && typeof row.playerName === "string"
    && (row.playerTeam === null || typeof row.playerTeam === "string")
    && NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_MARKETS.some((market) => market === row.market)
    && (row.offerType === "over_under" || row.offerType === "milestone")
    && typeof row.sportsbook === "string"
    && (row.provider === "balldontlie" || row.provider === "sharpapi")
    && typeof row.line === "number" && Number.isFinite(row.line)
    && nullableInteger(row.overPrice)
    && nullableInteger(row.underPrice)
    && nullableInteger(row.yesPrice)
    && typeof row.exactPriceComplete === "boolean"
    && Array.isArray(row.healthHolds) && row.healthHolds.every((hold) => typeof hold === "string")
    && typeof row.observedAt === "string"
    && (row.fetchedAt === null || typeof row.fetchedAt === "string")
    && typeof row.capturedAt === "string"
    && typeof row.scheduledStart === "string"
    && typeof row.lockAt === "string"
    && typeof row.minutesToStartAtCapture === "number" && Number.isFinite(row.minutesToStartAtCapture)
    && typeof row.writerRelease === "string"
    && row.captureRelease === NFL_PLAYER_PROPS_RESEARCH_OFFER_UNIVERSE_RELEASE;
}

function nullableInteger(value: unknown): boolean {
  return value === null || (Number.isInteger(value) && value !== 0);
}
