import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { revalidateTag, unstable_cache } from "next/cache";
import type { PlayerPropPreviewRow, PlayerPropsDashboardData } from "@/app/mlb/props/components/PlayerPropsDashboard";
import type { RealPitcherSeasonStat } from "./realScoring";
import type { PropOddsSnapshot } from "./providers";

export const MLB_PROPS_BOARD_SNAPSHOT_KIND = "member_board_snapshot_v1";
export const DEFAULT_MLB_PROPS_MAX_SNAPSHOT_JSON_BYTES = 40_000_000;
export const DEFAULT_MLB_PROPS_MAX_SNAPSHOT_GZIP_BYTES = 2_000_000;
const DEFAULT_MLB_PROPS_SNAPSHOT_RETENTION_PER_SLATE = 36;

export type MlbPropsBoardValidation = {
  publishable: boolean;
  actionableRows: number;
  researchRows: number;
  mappedRows: number;
  sourceRows: number;
  staleOddsRows: number;
  providerCoverage?: {
    rawOffers: number;
    normalizedOffers: number;
    droppedOffers: number;
    normalizedPriceRows: number;
    marketTypes: string[];
    unmappedMarketTypes: string[];
    vendors: string[];
  };
  errors: string[];
  warnings: string[];
};

export type MlbPropsBoardMovement = {
  comparedWith: string | null;
  changedPrices: number;
  changedLines: number;
  addedRows: number;
  removedRows: number;
};

export type MlbPropsBoardSnapshot = {
  schemaVersion: 1;
  snapshotId: string;
  slateDate: string;
  asOfTimestamp: string;
  refreshMode: "fast" | "full";
  data: PlayerPropsDashboardData;
  validation: MlbPropsBoardValidation;
  movement: MlbPropsBoardMovement;
  modelContext?: {
    probablePitcherSeasonStats: Array<[string, RealPitcherSeasonStat]>;
    openingPropOdds?: PropOddsSnapshot[];
  };
};

type SnapshotEnvelope = {
  kind: typeof MLB_PROPS_BOARD_SNAPSHOT_KIND;
  encoding: "gzip-base64";
  checksum: string;
  snapshot_id: string;
  slate_date: string;
  as_of_timestamp: string;
  payload: string;
  validation: MlbPropsBoardValidation;
  movement: MlbPropsBoardMovement;
};

export type MlbPropsBoardSnapshotSize = {
  jsonBytes: number;
  gzipBytes: number;
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MLB props snapshots require Supabase service-role credentials.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function encodeMlbPropsBoardSnapshot(snapshot: MlbPropsBoardSnapshot): SnapshotEnvelope {
  const json = JSON.stringify(snapshot);
  const compressed = gzipSync(Buffer.from(json));
  assertSnapshotSizeWithinLimits({ jsonBytes: Buffer.byteLength(json), gzipBytes: compressed.byteLength });
  const checksum = createHash("sha256").update(json).digest("hex");
  return {
    kind: MLB_PROPS_BOARD_SNAPSHOT_KIND,
    encoding: "gzip-base64",
    checksum,
    snapshot_id: snapshot.snapshotId,
    slate_date: snapshot.slateDate,
    as_of_timestamp: snapshot.asOfTimestamp,
    payload: compressed.toString("base64"),
    validation: snapshot.validation,
    movement: snapshot.movement,
  };
}

export function decodeMlbPropsBoardSnapshot(value: unknown): MlbPropsBoardSnapshot | null {
  if (!isRecord(value) || value.kind !== MLB_PROPS_BOARD_SNAPSHOT_KIND || value.encoding !== "gzip-base64") return null;
  if (typeof value.payload !== "string" || typeof value.checksum !== "string") return null;
  try {
    const json = gunzipSync(Buffer.from(value.payload, "base64")).toString("utf8");
    if (createHash("sha256").update(json).digest("hex") !== value.checksum) return null;
    const snapshot = JSON.parse(json) as MlbPropsBoardSnapshot;
    if (snapshot.schemaVersion !== 1 || !snapshot.snapshotId || !snapshot.slateDate || !snapshot.validation?.publishable) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export async function loadLatestMlbPropsBoardSnapshot(slateDate: string): Promise<MlbPropsBoardSnapshot | null> {
  return (await loadRecentMlbPropsBoardSnapshots(slateDate, 1))[0] ?? null;
}

export async function loadLatestMlbPropsDisplaySnapshot(slateDate: string): Promise<MlbPropsBoardSnapshot | null> {
  const latest = await loadLatestMlbPropsBoardSnapshot(slateDate);
  if (!latest) return null;
  return applyMlbPropsDisplayLocks(latest).catch(() => latest);
}

export async function loadRecentMlbPropsBoardSnapshots(slateDate: string, limit = 3): Promise<MlbPropsBoardSnapshot[]> {
  const { data, error } = await getSupabase()
    .from("prop_scoring_runs")
    .select("metadata_json")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate)
    .eq("status", "completed")
    .eq("provider_mode", "real")
    .eq("odds_provider", "balldontlie")
    .eq("context_provider", "nws+baseball_savant+balldontlie")
    .eq("persisted", true)
    .order("created_at", { ascending: false })
    // Snapshot payloads can be several megabytes on a full slate. Fetch only
    // the requested number of already-filtered rows; over-fetching five rows
    // for the common "latest" lookup can exceed the database statement
    // timeout before the page has a chance to decode the first snapshot.
    .limit(Math.max(1, Math.min(limit, 20)));
  if (error) throw error;
  const snapshots: MlbPropsBoardSnapshot[] = [];
  for (const row of data ?? []) {
    const decoded = decodeMlbPropsBoardSnapshot(row.metadata_json);
    if (decoded) snapshots.push(decoded);
    if (snapshots.length >= limit) break;
  }
  return snapshots;
}

type LockedDisplaySnapshotRef = {
  external_game_id: string | null;
  board_snapshot_id: string | null;
  locked_at: string | null;
};

type LockedDisplaySnapshotPointer = {
  snapshotId: string;
  lockedAt: string;
};

async function applyMlbPropsDisplayLocks(latest: MlbPropsBoardSnapshot): Promise<MlbPropsBoardSnapshot> {
  const lockedRefs = await loadLockedDisplaySnapshotRefs(latest.slateDate);
  if (!lockedRefs.size) return latest;

  const snapshotPointers = new Map<string, LockedDisplaySnapshotPointer>();
  for (const ref of lockedRefs.values()) snapshotPointers.set(ref.snapshotId, ref);
  const loadedSnapshots = await Promise.all(
    [...snapshotPointers.values()].map(async ({ snapshotId }) => ({
      snapshotId,
      snapshot: await loadMlbPropsBoardSnapshotById(latest.slateDate, snapshotId),
    })),
  );
  const lockedSnapshots = new Map<string, MlbPropsBoardSnapshot>();
  for (const { snapshotId, snapshot } of loadedSnapshots) {
    if (snapshot) lockedSnapshots.set(snapshotId, snapshot);
  }
  if (!lockedSnapshots.size) return latest;

  const lockedRowsByGame = new Map<string, PlayerPropPreviewRow[]>();
  const lockedResearch: NonNullable<PlayerPropsDashboardData["research"]> = {};
  const lockedUpdatedByGame = new Map<string, string>();
  for (const [gameId, ref] of lockedRefs) {
    const locked = lockedSnapshots.get(ref.snapshotId);
    if (!locked) continue;
    const rows = locked.data.props
      .filter((row) => row.providerIds?.gameId === gameId)
      .map((row) => ({ ...row, lockStatus: { status: "locked" as const, lockedAt: ref.lockedAt } }));
    if (!rows.length) continue;
    lockedRowsByGame.set(gameId, rows);
    lockedUpdatedByGame.set(gameId, ref.lockedAt);
    for (const row of rows) {
      if (row.researchKey && locked.data.research?.[row.researchKey]) {
        lockedResearch[row.researchKey] = locked.data.research[row.researchKey];
      }
    }
  }
  if (!lockedRowsByGame.size) return latest;

  const emittedLockedGames = new Set<string>();
  const props: PlayerPropPreviewRow[] = [];
  for (const row of latest.data.props) {
    const gameId = row.providerIds?.gameId;
    if (gameId && lockedRowsByGame.has(gameId)) {
      if (!emittedLockedGames.has(gameId)) {
        props.push(...(lockedRowsByGame.get(gameId) ?? []));
        emittedLockedGames.add(gameId);
      }
      continue;
    }
    props.push(row);
  }
  for (const [gameId, rows] of lockedRowsByGame) {
    if (!emittedLockedGames.has(gameId)) props.push(...rows);
  }

  const allDisplayGames = new Set(props.map((row) => row.providerIds?.gameId).filter(Boolean) as string[]);
  const allGamesLocked = allDisplayGames.size > 0 && [...allDisplayGames].every((gameId) => lockedRowsByGame.has(gameId));
  const lockedLastUpdated = [...lockedUpdatedByGame.values()].sort().at(-1) ?? latest.data.lastUpdated;
  const data: PlayerPropsDashboardData = {
    ...latest.data,
    lastUpdated: allGamesLocked ? lockedLastUpdated : latest.data.lastUpdated,
    props,
    research: {
      ...(latest.data.research ?? {}),
      ...lockedResearch,
    },
    summary: summarizeDisplayProps(latest.data, props),
  };

  return { ...latest, data };
}

async function loadLockedDisplaySnapshotRefs(slateDate: string): Promise<Map<string, LockedDisplaySnapshotPointer>> {
  const { data, error } = await getSupabase()
    .from("mlb_prop_tracking_entries")
    .select("external_game_id,board_snapshot_id,locked_at")
    .eq("slate_date", slateDate)
    .not("locked_at", "is", null)
    .order("locked_at", { ascending: true })
    .limit(5000);
  if (error) throw error;
  const refs = new Map<string, LockedDisplaySnapshotPointer>();
  for (const row of (data ?? []) as LockedDisplaySnapshotRef[]) {
    if (row.external_game_id && row.board_snapshot_id && row.locked_at && !refs.has(row.external_game_id)) {
      refs.set(row.external_game_id, {
        snapshotId: row.board_snapshot_id,
        lockedAt: row.locked_at,
      });
    }
  }
  return refs;
}

async function loadMlbPropsBoardSnapshotById(slateDate: string, snapshotId: string): Promise<MlbPropsBoardSnapshot | null> {
  const { data, error } = await getSupabase()
    .from("prop_scoring_runs")
    .select("metadata_json")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate)
    .eq("status", "completed")
    .eq("provider_mode", "real")
    .eq("odds_provider", "balldontlie")
    .eq("context_provider", "nws+baseball_savant+balldontlie")
    .eq("persisted", true)
    .eq("metadata_json->>snapshot_id", snapshotId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return decodeMlbPropsBoardSnapshot(data?.metadata_json) ?? null;
}

function summarizeDisplayProps(data: PlayerPropsDashboardData, props: PlayerPropPreviewRow[]): PlayerPropsDashboardData["summary"] {
  const grades = (grade: PlayerPropPreviewRow["playGrade"]) => props.filter((row) => row.playGrade === grade).length;
  return {
    ...data.summary,
    gamesWithProps: new Set(props.map((row) => row.providerIds?.gameId).filter(Boolean)).size,
    scoredProps: props.filter((row) => row.finalProbability !== null).length,
    recommendations: grades("BEST_ANGLE"),
    leans: grades("LEAN"),
    watchlist: grades("WATCHLIST"),
    noPlay: grades("NO_PLAY"),
    pendingData: grades("PENDING_DATA"),
    researchOnly: grades("RESEARCH"),
    booksCovered: new Set(props.map((row) => row.book)).size,
    marketsAvailable: new Set(props.map((row) => row.market)).size,
    averageDataConfidence: props.length ? round(props.reduce((sum, row) => sum + row.confidence, 0) / props.length, 3) : 0,
  };
}

const loadCachedSnapshot = unstable_cache(
  async (slateDate: string) => loadLatestMlbPropsBoardSnapshot(slateDate),
  ["mlb-props-member-board-latest-v1"],
  { revalidate: 60, tags: ["mlb-props-member-board"] },
);

export async function loadCachedLatestMlbPropsBoardSnapshot(slateDate: string): Promise<MlbPropsBoardSnapshot | null> {
  return loadCachedSnapshot(slateDate);
}

const loadCachedDisplaySnapshot = unstable_cache(
  async (slateDate: string) => loadLatestMlbPropsDisplaySnapshot(slateDate),
  ["mlb-props-member-board-display-v1"],
  { revalidate: 60, tags: ["mlb-props-member-board"] },
);

export async function loadCachedLatestMlbPropsDisplaySnapshot(slateDate: string): Promise<MlbPropsBoardSnapshot | null> {
  return loadCachedDisplaySnapshot(slateDate);
}

export function measureMlbPropsBoardSnapshot(snapshot: MlbPropsBoardSnapshot): MlbPropsBoardSnapshotSize {
  const json = JSON.stringify(snapshot);
  return {
    jsonBytes: Buffer.byteLength(json),
    gzipBytes: gzipSync(Buffer.from(json)).byteLength,
  };
}

export function assertSnapshotSizeWithinLimits(size: MlbPropsBoardSnapshotSize): void {
  const maxJsonBytes = envPositiveInteger("ODDSPHERE_PROPS_MAX_SNAPSHOT_JSON_BYTES", DEFAULT_MLB_PROPS_MAX_SNAPSHOT_JSON_BYTES);
  const maxGzipBytes = envPositiveInteger("ODDSPHERE_PROPS_MAX_SNAPSHOT_GZIP_BYTES", DEFAULT_MLB_PROPS_MAX_SNAPSHOT_GZIP_BYTES);
  if (size.jsonBytes > maxJsonBytes || size.gzipBytes > maxGzipBytes) {
    throw new Error(`MLB props snapshot payload limit exceeded: json=${size.jsonBytes}/${maxJsonBytes}, gzip=${size.gzipBytes}/${maxGzipBytes}.`);
  }
}

export async function publishMlbPropsBoardSnapshot(snapshot: MlbPropsBoardSnapshot): Promise<string> {
  if (!snapshot.validation.publishable) throw new Error("Refusing to publish an invalid MLB props board snapshot.");
  const metadata = encodeMlbPropsBoardSnapshot(snapshot);
  const { data, error } = await getSupabase()
    .from("prop_scoring_runs")
    .insert({
      sport: "mlb",
      slate_date: snapshot.slateDate,
      provider_mode: "real",
      odds_provider: "balldontlie",
      stats_provider: "mlb_stats_api+balldontlie",
      context_provider: "nws+baseball_savant+balldontlie",
      mlb_provider: "real",
      started_at: snapshot.asOfTimestamp,
      completed_at: new Date().toISOString(),
      status: "completed",
      dry_run: false,
      persisted: true,
      publish_enabled: process.env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true",
      display_enabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
      games_seen: snapshot.data.summary.gamesWithProps,
      markets_seen: snapshot.data.summary.marketsAvailable,
      odds_snapshots_seen: snapshot.validation.sourceRows,
      feature_snapshots_written: snapshot.data.props.length,
      predictions_written: snapshot.data.props.filter((row) => row.finalProbability !== null).length,
      edges_written: snapshot.data.props.filter((row) => row.modelEdge !== null).length,
      recommendations_written: snapshot.validation.actionableRows,
      metadata_json: metadata,
    })
    .select("id")
    .single();
  if (error) throw error;
  revalidateMlbPropsBoardCache();
  await pruneOldMlbPropsBoardSnapshots(snapshot.slateDate, snapshot.snapshotId).catch(() => undefined);
  return String(data.id);
}

function revalidateMlbPropsBoardCache(): void {
  try {
    revalidateTag("mlb-props-member-board", { expire: 0 });
  } catch {
    // Cache invalidation is best-effort outside Next route handlers.
  }
}

async function pruneOldMlbPropsBoardSnapshots(slateDate: string, currentSnapshotId: string): Promise<void> {
  const retention = envPositiveInteger("ODDSPHERE_PROPS_SNAPSHOT_RETENTION_PER_SLATE", DEFAULT_MLB_PROPS_SNAPSHOT_RETENTION_PER_SLATE);
  const supabase = getSupabase();
  const [{ data: rows, error: rowsError }, { data: lockedRefs, error: refsError }] = await Promise.all([
    supabase
      .from("prop_scoring_runs")
      .select("id,metadata_json,created_at")
      .eq("sport", "mlb")
      .eq("slate_date", slateDate)
      .eq("status", "completed")
      .eq("metadata_json->>kind", MLB_PROPS_BOARD_SNAPSHOT_KIND)
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("mlb_prop_tracking_entries")
      .select("board_snapshot_id")
      .eq("slate_date", slateDate)
      .not("board_snapshot_id", "is", null)
      .limit(5000),
  ]);
  if (rowsError) throw rowsError;
  if (refsError) throw refsError;

  const keepSnapshotIds = new Set<string>([
    currentSnapshotId,
    ...((lockedRefs ?? []) as Array<{ board_snapshot_id: string | null }>).map((row) => row.board_snapshot_id).filter((value): value is string => Boolean(value)),
  ]);
  for (const row of (rows ?? []).slice(0, retention)) {
    const snapshotId = snapshotIdFromMetadata((row as { metadata_json?: unknown }).metadata_json);
    if (snapshotId) keepSnapshotIds.add(snapshotId);
  }
  const deleteIds = (rows ?? [])
    .filter((row) => {
      const snapshotId = snapshotIdFromMetadata((row as { metadata_json?: unknown }).metadata_json);
      return snapshotId !== null && !keepSnapshotIds.has(snapshotId);
    })
    .map((row) => (row as { id: string | number }).id);
  if (!deleteIds.length) return;
  const { error } = await supabase.from("prop_scoring_runs").delete().in("id", deleteIds);
  if (error) throw error;
}

function snapshotIdFromMetadata(metadata: unknown): string | null {
  return isRecord(metadata) && typeof metadata.snapshot_id === "string" ? metadata.snapshot_id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envPositiveInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
