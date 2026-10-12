import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PlayerPropPreviewRow } from "@/app/mlb/props/components/PlayerPropsDashboard";
import type { PropOddsSnapshot } from "./providers";

export const MLB_PROPS_PRIVATE_TRACKING_RELEASE =
  "mlb_props_private_tracking_2026_10_12_r1_pregame_full_offer_ladder" as const;
export const MLB_PROPS_PRIVATE_TRACKING_SCHEMA =
  "mlb_props_private_tracking_history_v1" as const;
export const MLB_PROPS_PRIVATE_TRACKING_KEY_PREFIX =
  "mlb::player-props-private-tracking" as const;
export const MLB_PROPS_PRIVATE_TRACKING_RETENTION_DAYS = 550;
export const MLB_PROPS_PRIVATE_TRACKING_MAX_ROWS = 30_000;
export const MLB_PROPS_PRIVATE_TRACKING_MAX_JSON_BYTES = 32_000_000;
export const MLB_PROPS_PRIVATE_TRACKING_MAX_GZIP_BYTES = 3_000_000;
const LOCK_MINUTES = 60;
const HOUR_MS = 60 * 60_000;

export type MlbPropsPrivateTrackingRow = Readonly<{
  rowKey: string;
  gameId: string;
  providerPlayerId: string | null;
  playerName: string;
  team: string;
  opponent: string;
  scheduledStart: string;
  market: string;
  line: number;
  side: "over" | "under";
  sportsbook: string;
  americanPrice: number;
  observedAt: string;
  lockCutoff: string;
  canonicalMainLine: boolean;
  offeredAlternate: boolean;
  projection: number | null;
  independentProjection: null;
  rawModelProbability: number | null;
  marketProbability: number | null;
  finalProbability: number | null;
  publishedPrediction: "over" | "under" | null;
  grade: string;
  modelRelease: string;
  sourceSnapshotId: string;
  captureRelease: typeof MLB_PROPS_PRIVATE_TRACKING_RELEASE;
}>;

export type MlbPropsPrivateTrackingGame = Readonly<{
  gameId: string;
  scheduledStart: string;
  lockCutoff: string;
  candidateObservedAt: string;
  sourceSnapshotId: string;
  modelRelease: string;
  rows: readonly MlbPropsPrivateTrackingRow[];
}>;

export type MlbPropsPrivateTrackingHistory = Readonly<{
  kind: "mlb_props_private_tracking_history_v1";
  schema: typeof MLB_PROPS_PRIVATE_TRACKING_SCHEMA;
  captureRelease: typeof MLB_PROPS_PRIVATE_TRACKING_RELEASE;
  slateDate: string;
  createdAt: string;
  updatedAt: string;
  games: readonly MlbPropsPrivateTrackingGame[];
}>;

type Envelope = Readonly<{
  kind: "mlb_props_private_tracking_envelope_v1";
  schema: typeof MLB_PROPS_PRIVATE_TRACKING_SCHEMA;
  captureRelease: typeof MLB_PROPS_PRIVATE_TRACKING_RELEASE;
  encoding: "gzip-base64";
  checksum: string;
  slateDate: string;
  uncompressedBytes: number;
  compressedBytes: number;
  payload: string;
}>;

export type MlbPropsPrivateTrackingCaptureResult = Readonly<{
  written: boolean;
  eligibleGames: number;
  gamesAdded: number;
  gamesAdvanced: number;
  gamesPreserved: number;
  totalGames: number;
  totalRows: number;
  canonicalRows: number;
  alternateRows: number;
  error: string | null;
}>;

export function mlbPropsPrivateTrackingKey(slateDate: string): string {
  return `${MLB_PROPS_PRIVATE_TRACKING_KEY_PREFIX}::${slateDate}`;
}

export function buildMlbPropsPrivateTrackingGames(args: {
  sourceOdds: readonly PropOddsSnapshot[];
  publishedRows: readonly PlayerPropPreviewRow[];
  evaluatedAt: string;
  sourceSnapshotId: string;
  modelRelease: string;
}): MlbPropsPrivateTrackingGame[] {
  const evaluatedMs = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedMs)) throw new Error("MLB props private tracking evaluatedAt is invalid.");
  const baseRows = indexPublishedRows(args.publishedRows);
  const offersByGame = new Map<string, MlbPropsPrivateTrackingRow[]>();
  const gameMeta = new Map<string, { scheduledStart: string; lockCutoff: string }>();
  const lineStats = summarizeOfferLines(args.sourceOdds, baseRows);

  for (const offer of args.sourceOdds) {
    const raw = record(offer.rawPayload);
    const bdlGameId = stringValue(raw.bdl_game_id);
    const bdlPlayerId = integerValue(raw.bdl_player_id ?? offer.playerId.replace(/^balldontlie-player-/, ""));
    if (!bdlGameId || bdlPlayerId === null || (offer.side !== "over" && offer.side !== "under")) continue;
    const base = baseRows.byProviderScope.get(providerScopeKey(bdlGameId, bdlPlayerId, offer.marketKey));
    if (!base) continue;
    const startMs = Date.parse(base.scheduledStart);
    if (!Number.isFinite(startMs)) continue;
    const cutoffMs = startMs - LOCK_MINUTES * 60_000;
    // A candidate may advance only while it is genuinely pre-lock. After the
    // cutoff, the last successfully persisted pre-lock ladder is immutable.
    if (evaluatedMs > cutoffMs) continue;
    const lockCutoff = new Date(cutoffMs).toISOString();
    const rawAlternate = booleanValue(raw.is_alternate_line ?? raw.alternate ?? raw.isAlternateLine);
    const canonicalLine = lineStats.get(providerMarketKey(bdlGameId, bdlPlayerId, offer.marketKey));
    const canonicalMainLine = !rawAlternate && canonicalLine === offer.line;
    const exactBase = baseRows.byExactOffer.get(exactOfferKey(bdlGameId, bdlPlayerId, offer.marketKey, offer.line, offer.side, offer.sportsbook));
    const row: MlbPropsPrivateTrackingRow = {
      rowKey: [args.modelRelease, base.gameId, bdlPlayerId, offer.marketKey, offer.line, offer.side, normalize(offer.sportsbook)].join("|"),
      gameId: base.gameId,
      providerPlayerId: base.providerPlayerId,
      playerName: base.playerName,
      team: base.team,
      opponent: base.opponent,
      scheduledStart: base.scheduledStart,
      market: offer.marketKey,
      line: offer.line,
      side: offer.side,
      sportsbook: offer.sportsbook,
      americanPrice: offer.americanOdds,
      observedAt: offer.asOfTimestamp,
      lockCutoff,
      canonicalMainLine,
      offeredAlternate: !canonicalMainLine,
      projection: exactBase?.projection ?? base.projection,
      independentProjection: null,
      rawModelProbability: exactBase?.independentProbability ?? null,
      marketProbability: exactBase?.marketProbability ?? null,
      finalProbability: exactBase?.finalProbability ?? null,
      publishedPrediction: canonicalMainLine ? forecastSide(exactBase) ?? base.publishedPrediction : null,
      grade: exactBase?.playGrade ?? (canonicalMainLine ? "PRIVATE_MAIN_LINE" : "PRIVATE_ALT_LINE"),
      modelRelease: args.modelRelease,
      sourceSnapshotId: args.sourceSnapshotId,
      captureRelease: MLB_PROPS_PRIVATE_TRACKING_RELEASE,
    };
    offersByGame.set(base.gameId, [...(offersByGame.get(base.gameId) ?? []), row]);
    gameMeta.set(base.gameId, { scheduledStart: base.scheduledStart, lockCutoff });
  }

  return [...offersByGame.entries()].map(([gameId, rows]) => {
    const meta = gameMeta.get(gameId)!;
    const deduped = [...new Map(rows.map((row) => [row.rowKey, row])).values()]
      .sort((left, right) => left.rowKey.localeCompare(right.rowKey));
    return {
      gameId,
      scheduledStart: meta.scheduledStart,
      lockCutoff: meta.lockCutoff,
      candidateObservedAt: args.evaluatedAt,
      sourceSnapshotId: args.sourceSnapshotId,
      modelRelease: args.modelRelease,
      rows: deduped,
    };
  }).sort((left, right) => left.gameId.localeCompare(right.gameId));
}

export function mergeMlbPropsPrivateTrackingGames(args: {
  previous: readonly MlbPropsPrivateTrackingGame[];
  current: readonly MlbPropsPrivateTrackingGame[];
}): { games: MlbPropsPrivateTrackingGame[]; added: number; advanced: number; preserved: number } {
  const games = new Map(args.previous.map((game) => [game.gameId, game]));
  let added = 0;
  let advanced = 0;
  let preserved = 0;
  for (const candidate of args.current) {
    const prior = games.get(candidate.gameId);
    if (!prior) {
      games.set(candidate.gameId, candidate);
      added += 1;
      continue;
    }
    const priorAt = Date.parse(prior.candidateObservedAt);
    const nextAt = Date.parse(candidate.candidateObservedAt);
    const cutoff = Date.parse(candidate.lockCutoff);
    if (Number.isFinite(nextAt) && Number.isFinite(cutoff) && nextAt <= cutoff && nextAt > priorAt) {
      games.set(candidate.gameId, candidate);
      advanced += 1;
    } else {
      preserved += 1;
    }
  }
  const merged = [...games.values()].sort((left, right) => left.gameId.localeCompare(right.gameId));
  const rows = merged.reduce((sum, game) => sum + game.rows.length, 0);
  if (rows > MLB_PROPS_PRIVATE_TRACKING_MAX_ROWS) {
    throw new Error(`MLB props private tracking exceeds the ${MLB_PROPS_PRIVATE_TRACKING_MAX_ROWS}-row limit.`);
  }
  return { games: merged, added, advanced, preserved };
}

export async function captureMlbPropsPrivateTracking(args: {
  sourceOdds: readonly PropOddsSnapshot[];
  publishedRows: readonly PlayerPropPreviewRow[];
  slateDate: string;
  evaluatedAt: string;
  sourceSnapshotId: string;
  modelRelease: string;
}): Promise<MlbPropsPrivateTrackingCaptureResult> {
  try {
    const client = getSupabase();
    const current = buildMlbPropsPrivateTrackingGames(args);
    const previous = await readMlbPropsPrivateTrackingHistory({ client, slateDate: args.slateDate });
    const merged = mergeMlbPropsPrivateTrackingGames({ previous: previous?.games ?? [], current });
    const history: MlbPropsPrivateTrackingHistory = {
      kind: "mlb_props_private_tracking_history_v1",
      schema: MLB_PROPS_PRIVATE_TRACKING_SCHEMA,
      captureRelease: MLB_PROPS_PRIVATE_TRACKING_RELEASE,
      slateDate: args.slateDate,
      createdAt: previous?.createdAt ?? args.evaluatedAt,
      updatedAt: merged.added > 0 || merged.advanced > 0 ? args.evaluatedAt : (previous?.updatedAt ?? args.evaluatedAt),
      games: merged.games,
    };
    const envelope = encodeMlbPropsPrivateTrackingHistory(history);
    const written = merged.added > 0 || merged.advanced > 0;
    if (written) {
      const retentionAt = new Date(Date.parse(args.evaluatedAt)
        + MLB_PROPS_PRIVATE_TRACKING_RETENTION_DAYS * 24 * HOUR_MS).toISOString();
      const { error } = await client.from("lab_response_snapshots").upsert({
        snapshot_key: mlbPropsPrivateTrackingKey(args.slateDate),
        kind: "daily_edge",
        sport: "mlb",
        slate_date: args.slateDate,
        payload: envelope,
        payload_version: MLB_PROPS_PRIVATE_TRACKING_RELEASE,
        source: args.modelRelease,
        generated_at: args.evaluatedAt,
        expires_at: retentionAt,
        stale_until: retentionAt,
        updated_at: args.evaluatedAt,
      }, { onConflict: "snapshot_key" });
      if (error) throw new Error(`MLB props private tracking write failed: ${error.message}`);
    }
    const rows = merged.games.flatMap((game) => game.rows);
    const canonicalRows = rows.filter((row) => row.canonicalMainLine).length;
    return {
      written,
      eligibleGames: current.length,
      gamesAdded: merged.added,
      gamesAdvanced: merged.advanced,
      gamesPreserved: merged.preserved,
      totalGames: merged.games.length,
      totalRows: rows.length,
      canonicalRows,
      alternateRows: rows.length - canonicalRows,
      error: null,
    };
  } catch (error) {
    return emptyCapture(error instanceof Error ? error.message : String(error));
  }
}

export function encodeMlbPropsPrivateTrackingHistory(history: MlbPropsPrivateTrackingHistory): Envelope {
  const rows = history.games.reduce((sum, game) => sum + game.rows.length, 0);
  if (rows > MLB_PROPS_PRIVATE_TRACKING_MAX_ROWS) throw new Error("MLB props private tracking row limit exceeded.");
  const json = JSON.stringify(history);
  const uncompressedBytes = Buffer.byteLength(json);
  if (uncompressedBytes > MLB_PROPS_PRIVATE_TRACKING_MAX_JSON_BYTES) throw new Error("MLB props private tracking JSON limit exceeded.");
  const compressed = gzipSync(Buffer.from(json), { level: 9 });
  if (compressed.byteLength > MLB_PROPS_PRIVATE_TRACKING_MAX_GZIP_BYTES) throw new Error("MLB props private tracking gzip limit exceeded.");
  return {
    kind: "mlb_props_private_tracking_envelope_v1",
    schema: MLB_PROPS_PRIVATE_TRACKING_SCHEMA,
    captureRelease: MLB_PROPS_PRIVATE_TRACKING_RELEASE,
    encoding: "gzip-base64",
    checksum: createHash("sha256").update(json).digest("hex"),
    slateDate: history.slateDate,
    uncompressedBytes,
    compressedBytes: compressed.byteLength,
    payload: compressed.toString("base64"),
  };
}

export function decodeMlbPropsPrivateTrackingHistory(value: unknown): MlbPropsPrivateTrackingHistory | null {
  if (!isRecord(value)
    || value.kind !== "mlb_props_private_tracking_envelope_v1"
    || value.schema !== MLB_PROPS_PRIVATE_TRACKING_SCHEMA
    || value.captureRelease !== MLB_PROPS_PRIVATE_TRACKING_RELEASE
    || value.encoding !== "gzip-base64"
    || typeof value.payload !== "string"
    || typeof value.checksum !== "string"
    || typeof value.slateDate !== "string"
    || !Number.isInteger(value.uncompressedBytes)
    || !Number.isInteger(value.compressedBytes)) return null;
  try {
    const compressed = Buffer.from(value.payload, "base64");
    if (compressed.byteLength !== value.compressedBytes) return null;
    const decoded = gunzipSync(compressed, { maxOutputLength: MLB_PROPS_PRIVATE_TRACKING_MAX_JSON_BYTES });
    if (decoded.byteLength !== value.uncompressedBytes) return null;
    const json = decoded.toString("utf8");
    if (createHash("sha256").update(json).digest("hex") !== value.checksum) return null;
    const history = JSON.parse(json) as MlbPropsPrivateTrackingHistory;
    return history.kind === "mlb_props_private_tracking_history_v1"
      && history.schema === MLB_PROPS_PRIVATE_TRACKING_SCHEMA
      && history.captureRelease === MLB_PROPS_PRIVATE_TRACKING_RELEASE
      && history.slateDate === value.slateDate
      && Array.isArray(history.games) ? history : null;
  } catch {
    return null;
  }
}

export async function readMlbPropsPrivateTrackingHistory(args: {
  client: SupabaseClient;
  slateDate: string;
}): Promise<MlbPropsPrivateTrackingHistory | null> {
  const { data, error } = await args.client.from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", mlbPropsPrivateTrackingKey(args.slateDate))
    .maybeSingle();
  if (error) throw new Error(`MLB props private tracking read failed: ${error.message}`);
  if (data?.payload === null || data?.payload === undefined) return null;
  const history = decodeMlbPropsPrivateTrackingHistory(data.payload);
  if (!history) throw new Error("MLB props private tracking payload is corrupt or unsupported.");
  return history;
}

export async function readMlbPropsPrivateTrackingHistories(args: {
  client: SupabaseClient;
  start: string;
  end: string;
}): Promise<MlbPropsPrivateTrackingHistory[]> {
  const { data, error } = await args.client.from("lab_response_snapshots")
    .select("payload,slate_date")
    .eq("payload_version", MLB_PROPS_PRIVATE_TRACKING_RELEASE)
    .eq("sport", "mlb")
    .gte("slate_date", args.start)
    .lte("slate_date", args.end)
    .order("slate_date", { ascending: true })
    .limit(600);
  if (error) throw new Error(`MLB props private tracking range read failed: ${error.message}`);
  return (data ?? []).flatMap((row) => {
    const history = decodeMlbPropsPrivateTrackingHistory(row.payload);
    return history ? [history] : [];
  });
}

function indexPublishedRows(rows: readonly PlayerPropPreviewRow[]) {
  type Base = {
    gameId: string;
    providerPlayerId: string | null;
    playerName: string;
    team: string;
    opponent: string;
    scheduledStart: string;
    projection: number | null;
    publishedPrediction: "over" | "under" | null;
  };
  const byProviderScope = new Map<string, Base>();
  const byExactOffer = new Map<string, PlayerPropPreviewRow>();
  for (const row of rows) {
    const bdlGameId = row.providerIds?.bdlGameId;
    const bdlPlayerId = row.providerIds?.bdlPlayerId;
    const gameId = row.providerIds?.gameId;
    if (!bdlGameId || bdlPlayerId === null || bdlPlayerId === undefined || !gameId) continue;
    byProviderScope.set(providerScopeKey(bdlGameId, bdlPlayerId, row.market), {
      gameId,
      providerPlayerId: row.providerIds?.mlbStatsPlayerId ?? null,
      playerName: row.player,
      team: row.team,
      opponent: row.opponent,
      scheduledStart: row.gameStartTime,
      projection: row.projection,
      publishedPrediction: forecastSide(row),
    });
    byExactOffer.set(exactOfferKey(bdlGameId, bdlPlayerId, row.market, row.line, row.side, row.book), row);
  }
  return { byProviderScope, byExactOffer };
}

function forecastSide(row: PlayerPropPreviewRow | undefined): "over" | "under" | null {
  if (!row) return null;
  const over = row.overProbability;
  const under = row.underProbability;
  if (typeof over === "number" && typeof under === "number" && over !== under) return over > under ? "over" : "under";
  if (row.projection !== null && row.projection !== row.line) return row.projection > row.line ? "over" : "under";
  return null;
}

function summarizeOfferLines(
  offers: readonly PropOddsSnapshot[],
  bases: ReturnType<typeof indexPublishedRows>,
): Map<string, number> {
  const groups = new Map<string, Map<number, PropOddsSnapshot[]>>();
  for (const offer of offers) {
    const raw = record(offer.rawPayload);
    const game = stringValue(raw.bdl_game_id);
    const player = integerValue(raw.bdl_player_id ?? offer.playerId.replace(/^balldontlie-player-/, ""));
    if (!game || player === null || booleanValue(raw.is_alternate_line ?? raw.alternate ?? raw.isAlternateLine)) continue;
    if (!bases.byProviderScope.has(providerScopeKey(game, player, offer.marketKey))) continue;
    const key = providerMarketKey(game, player, offer.marketKey);
    const lines = groups.get(key) ?? new Map<number, PropOddsSnapshot[]>();
    lines.set(offer.line, [...(lines.get(offer.line) ?? []), offer]);
    groups.set(key, lines);
  }
  const result = new Map<string, number>();
  for (const [key, lines] of groups) {
    const selected = [...lines.entries()].map(([line, rows]) => ({
      line,
      sides: new Set(rows.map((row) => row.side)).size,
      books: new Set(rows.map((row) => normalize(row.sportsbook))).size,
      balance: rows.reduce((sum, row) => sum + Math.abs(implied(row.americanOdds) - 0.5), 0) / rows.length,
    })).sort((left, right) => right.sides - left.sides || right.books - left.books
      || left.balance - right.balance || left.line - right.line)[0];
    if (selected) result.set(key, selected.line);
  }
  return result;
}

function providerScopeKey(game: string, player: number, market: string): string {
  return `${game}|${player}|${market}`;
}

function providerMarketKey(game: string, player: number, market: string): string {
  return providerScopeKey(game, player, market);
}

function exactOfferKey(game: string, player: number, market: string, line: number, side: string, book: string): string {
  return `${providerScopeKey(game, player, market)}|${line}|${side}|${normalize(book)}`;
}

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function emptyCapture(error: string | null): MlbPropsPrivateTrackingCaptureResult {
  return {
    written: false,
    eligibleGames: 0,
    gamesAdded: 0,
    gamesAdvanced: 0,
    gamesPreserved: 0,
    totalGames: 0,
    totalRows: 0,
    canonicalRows: 0,
    alternateRows: 0,
    error,
  };
}

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MLB props private tracking requires Supabase service-role credentials.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
