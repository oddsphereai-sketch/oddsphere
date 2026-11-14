import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { mlbPropsAiCutoffPolicy, MlbPropsPublicationUncertainError } from "./aiPublicationPolicy";
export { MLB_PROPS_LOCKED_SOURCE_READER_RELEASE } from "./aiPublicationPolicy";
import { createClient } from "@supabase/supabase-js";
import type { PlayerPropPreviewRow, PlayerPropsDashboardData } from "@/app/mlb/props/components/PlayerPropsDashboard";
import type { RealPitcherSeasonStat } from "./realScoring";
import type { MlbPropsShadowPitcherPrediction } from "./shadowPitcherModel";
import type { PropOddsSnapshot } from "./providers";
import {
  mergeMlbPropsMarketEvidenceCaptures,
  withoutUnretainedMlbPropsEvidenceReference,
  type MlbPropsMarketEvidenceCapture,
  type MlbPropsMarketEvidenceRow,
} from "./marketEvidenceCapture";
import {
  assertMlbPropsReleaseDoesNotRegress,
  compareMlbPropsReleaseIds,
  parseMlbPropsReleaseOrder,
} from "./releaseOrdering";

export const MLB_PROPS_BOARD_SNAPSHOT_KIND = "member_board_snapshot_v1";
export const DEFAULT_MLB_PROPS_MAX_SNAPSHOT_JSON_BYTES = 40_000_000;
export const DEFAULT_MLB_PROPS_MAX_SNAPSHOT_GZIP_BYTES = 2_000_000;
// Keep a short rolling history for movement/debugging. Any snapshot referenced
// by a locked internal tracking entry is preserved independently, so lowering
// this bound reduces database pressure without sacrificing lock evidence.
// Must span comfortably beyond the T-60 cutoff so the first post-cutoff
// refresh can still bind the last pre-cutoff board before pruning.
const DEFAULT_MLB_PROPS_SNAPSHOT_RETENTION_PER_SLATE = 24;
const MLB_PROPS_MEMORY_CACHE_TTL_MS = 60_000;

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
  marketEvidence?: MlbPropsMarketEvidenceCapture;
  modelContext?: {
    modelReleaseId?: string;
    /** Future snapshot opt-in; old locked snapshots retain absence. */
    trackingEventRelease?: string;
    aiHandoffRelease?: string;
    probablePitcherSeasonStats: Array<[string, RealPitcherSeasonStat]>;
    openingPropOdds?: PropOddsSnapshot[];
    marketModelVersions?: Record<string, string>;
    shadowPitcherPredictions?: Array<{
      gameId: string;
      playerId: string;
      market: string;
      line: number;
      sportsbook: string;
      prediction: MlbPropsShadowPitcherPrediction;
    }>;
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

export type MlbPropsPublishedReleaseHead = {
  runId: string;
  snapshotId: string;
  releaseId: string;
  asOfTimestamp: string;
};

const publishedReleaseHeadCache = new Map<string, {
  freshUntilMs: number;
  value: Promise<MlbPropsPublishedReleaseHead | null>;
}>();

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
  const indexed = await loadIndexedMlbPropsBoardSnapshot(slateDate);
  if (indexed) return indexed;
  return (await loadRecentMlbPropsBoardSnapshots(slateDate, 1))[0] ?? null;
}

async function loadIndexedMlbPropsBoardSnapshot(slateDate: string): Promise<MlbPropsBoardSnapshot | null> {
  const supabase = getSupabase();
  const { data: indexRows, error: indexError } = await supabase
    .from("admin_audit_log")
    .select("target_id,after_state,created_at")
    .eq("action_type", "mlb_props.board_snapshot_published")
    .eq("target_table", "prop_scoring_runs")
    .contains("after_state", { slate_date: slateDate })
    .order("created_at", { ascending: false })
    .limit(100);
  if (indexError || !Array.isArray(indexRows) || indexRows.length > 100) throw new Error("MLB props current index inventory unavailable.");
  const matching = indexRows.filter(
    (row) => isRecord(row.after_state) && row.after_state.slate_date === slateDate,
  );
  const indexed = matching.filter(
    (row) => isRecord(row.after_state) && parseMlbPropsReleaseOrder(indexedReleaseId(row.after_state)),
  );
  indexed.sort((left, right) => {
    const leftState = isRecord(left.after_state) ? left.after_state : {};
    const rightState = isRecord(right.after_state) ? right.after_state : {};
    const releaseComparison = compareMlbPropsReleaseIds(
      indexedReleaseId(rightState),
      indexedReleaseId(leftState),
    ) ?? 0;
    if (releaseComparison !== 0) return releaseComparison;
    return Date.parse(String(right.created_at ?? "")) - Date.parse(String(left.created_at ?? ""));
  });
  const index = indexed[0] ?? matching[0];
  if (!index?.target_id) return null;
  const { data, error } = await supabase
    .from("prop_scoring_runs")
    .select("metadata_json")
    .eq("id", index.target_id)
    .single();
  if (error) throw new Error("MLB props current source read unavailable.");
  return decodeMlbPropsBoardSnapshot(data?.metadata_json) ?? null;
}

export async function loadHighestIndexedMlbPropsReleaseHead(
  slateDate: string,
): Promise<MlbPropsPublishedReleaseHead | null> {
  const now = Date.now();
  const cached = publishedReleaseHeadCache.get(slateDate);
  if (cached && cached.freshUntilMs > now) return cached.value;
  const value = loadHighestIndexedMlbPropsReleaseHeadUncached(slateDate).catch((error) => {
    const current = publishedReleaseHeadCache.get(slateDate);
    if (current?.value === value) publishedReleaseHeadCache.delete(slateDate);
    throw error;
  });
  publishedReleaseHeadCache.set(slateDate, {
    freshUntilMs: now + MLB_PROPS_MEMORY_CACHE_TTL_MS,
    value,
  });
  return value;
}

async function loadHighestIndexedMlbPropsReleaseHeadUncached(
  slateDate: string,
): Promise<MlbPropsPublishedReleaseHead | null> {
  const { data, error } = await getSupabase()
    .from("admin_audit_log")
    .select("target_id,after_state,created_at")
    .eq("action_type", "mlb_props.board_snapshot_published")
    .eq("target_table", "prop_scoring_runs")
    .contains("after_state", { slate_date: slateDate })
    .order("created_at", { ascending: false })
    .limit(100);
  if (error || !Array.isArray(data) || data.length > 100) throw new Error("MLB props release-head inventory unavailable.");
  const candidates = data.flatMap((row) => {
    if (!isRecord(row.after_state)) return [];
    const releaseId = indexedReleaseId(row.after_state);
    const snapshotId = typeof row.after_state.snapshot_id === "string" ? row.after_state.snapshot_id : null;
    const asOfTimestamp = typeof row.after_state.as_of_timestamp === "string"
      ? row.after_state.as_of_timestamp
      : null;
    if (!parseMlbPropsReleaseOrder(releaseId) || !snapshotId || !asOfTimestamp) return [];
    return [{
      runId: String(row.target_id),
      snapshotId,
      releaseId: releaseId as string,
      asOfTimestamp,
      createdAt: String(row.created_at ?? ""),
    }];
  });
  candidates.sort((left, right) => {
    const releaseComparison = compareMlbPropsReleaseIds(right.releaseId, left.releaseId) ?? 0;
    if (releaseComparison !== 0) return releaseComparison;
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
  const selected = candidates[0];
  return selected ? {
    runId: selected.runId,
    snapshotId: selected.snapshotId,
    releaseId: selected.releaseId,
    asOfTimestamp: selected.asOfTimestamp,
  } : null;
}

export async function loadLatestMlbPropsDisplaySnapshot(slateDate: string): Promise<MlbPropsBoardSnapshot | null> {
  const latest = await loadLatestMlbPropsBoardSnapshot(slateDate);
  if (!latest) return null;
  // Unknown lock authority is unavailable, never permission to show mutable rows.
  return applyMlbPropsDisplayLocks(latest);
}

type CutoffSourceRow = { id?: unknown; created_at?: unknown; metadata_json: unknown };
type PublicationIndexRow = { target_id?: unknown; created_at?: unknown; after_state?: unknown };
const needsIndexedCutoff = (snapshot: MlbPropsBoardSnapshot) =>
  mlbPropsAiCutoffPolicy(snapshot.modelContext?.aiHandoffRelease) === "indexed";
function sourceRunId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0 && value.length <= 256) return value;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}
/** Future R2 alone requires the actual index that makes its source readable by
 * immutable ID. Neither a raw append nor a later index attests pre-lock publication. */
function indexedSourceMatches(row: CutoffSourceRow, snapshot: MlbPropsBoardSnapshot,
  index: PublicationIndexRow, cutoffMs = Infinity): boolean {
  const state = index.after_state, envelope = row.metadata_json;
  if (!isRecord(state) || !isRecord(envelope)) return false;
  const created = Date.parse(String(row.created_at ?? "")), indexed = Date.parse(String(index.created_at ?? ""));
  return sourceRunId(row.id) !== null && index.target_id === sourceRunId(row.id)
    && Number.isFinite(created) && Number.isFinite(indexed) && created <= indexed && indexed <= cutoffMs
    && envelope.snapshot_id === snapshot.snapshotId && envelope.slate_date === snapshot.slateDate
    && envelope.as_of_timestamp === snapshot.asOfTimestamp
    && state.snapshot_id === snapshot.snapshotId && state.slate_date === snapshot.slateDate
    && state.as_of_timestamp === snapshot.asOfTimestamp
    && state.model_release_id === (snapshot.modelContext?.modelReleaseId ?? null)
    && state.payload_checksum === envelope.checksum;
}

export async function loadMlbPropsBoardSnapshotAtOrBefore(
  slateDate: string,
  cutoffTimestamp: string,
): Promise<MlbPropsBoardSnapshot | null> {
  const cutoffMs = Date.parse(cutoffTimestamp);
  if (!Number.isFinite(cutoffMs)) return null;
  const { data, error } = await getSupabase()
    .from("prop_scoring_runs")
    .select("id,created_at,metadata_json")
    .eq("sport", "mlb")
    .eq("slate_date", slateDate)
    .eq("status", "completed")
    .eq("provider_mode", "real")
    .eq("odds_provider", "balldontlie")
    .eq("context_provider", "nws+baseball_savant+balldontlie")
    .eq("persisted", true)
    .lte("created_at", cutoffTimestamp)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error || !Array.isArray(data) || data.length > 12) throw new Error("MLB props cutoff source inventory unavailable.");
  const candidates = data as CutoffSourceRow[];
  let indexes: PublicationIndexRow[] | null = null;
  // Decode one full board at a time, retaining the legacy early-return/memory
  // behavior even when the bounded query returns twelve large envelopes.
  for (const row of candidates) {
    const snapshot = decodeMlbPropsBoardSnapshot(row.metadata_json);
    if (!snapshot || !(Date.parse(snapshot.asOfTimestamp) <= cutoffMs)) continue;
    if (mlbPropsAiCutoffPolicy(snapshot.modelContext?.aiHandoffRelease) === "unsupported") continue;
    if (needsIndexedCutoff(snapshot)) {
      if (sourceRunId(row.id) === null) throw new Error("MLB R2 cutoff source identity unavailable.");
      if (indexes === null) {
        if (candidates.length > 12) throw new Error("MLB R2 cutoff source limit exceeded.");
        const ids = candidates.map((candidate) => sourceRunId(candidate.id)).filter((id): id is string => id !== null);
        // One extra bounded lookup for at most the existing twelve candidates.
        // Overflow/read failure is unknown authority, never an empty-index claim.
        const { data: indexRows, error: indexError } = await getSupabase().from("admin_audit_log")
          .select("target_id,after_state,created_at")
          .eq("action_type", "mlb_props.board_snapshot_published")
          .eq("target_table", "prop_scoring_runs")
          .contains("after_state", { slate_date: slateDate })
          .in("target_id", ids)
          .lte("created_at", cutoffTimestamp)
          .order("created_at", { ascending: false })
          .limit(13);
        if (indexError || !Array.isArray(indexRows)) throw new Error("MLB R2 cutoff publication index unavailable.");
        if (indexRows.length > 12) throw new Error("MLB R2 cutoff publication index limit exceeded.");
        indexes = indexRows as PublicationIndexRow[];
      }
      if (!indexes.some((index) => indexedSourceMatches(row, snapshot, index, cutoffMs))) continue;
    }
    return snapshot;
  }
  return null;
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
  if (error || !Array.isArray(data) || data.length > Math.max(1, Math.min(limit, 20))) throw new Error("MLB props recent source inventory unavailable.");
  const snapshots: MlbPropsBoardSnapshot[] = [];
  for (const row of data) {
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

export const MLB_PROPS_GAME_LOCK_AUDIT_ACTION = "mlb_props.game_locked_t60";

export type MlbPropsGameLockPointer = {
  slate_date: string;
  external_game_id: string;
  game_start_timestamp: string;
  lock_cutoff_timestamp: string;
  board_snapshot_id: string;
  snapshot_as_of_timestamp: string;
  locked_at: string;
  model_release_id: string;
};

export type MlbPropsGameLockScheduleEntry = {
  externalGameId: string;
  gameStartTimestamp: string;
};

const LOCK_REF_PAGE_SIZE = 1_000;
const MAX_LOCK_REF_PAGES = 20;

export async function applyMlbPropsDisplayLocks(latest: MlbPropsBoardSnapshot): Promise<MlbPropsBoardSnapshot> {
  try {
    return await applyStoredMlbPropsDisplayLocks(latest);
  } catch {
    // Raw storage errors and opaque legacy values are private. Callers keep the
    // existing unavailable path, never a mutable replacement or raw error body.
    throw new Error("MLB props locked source authority unavailable.");
  }
}

async function applyStoredMlbPropsDisplayLocks(latest: MlbPropsBoardSnapshot): Promise<MlbPropsBoardSnapshot> {
  const safeLatest = suppressOfficialPitcherTeamConflicts(latest);
  const lockedRefs = await loadLockedDisplaySnapshotRefs(latest.slateDate);
  if (!lockedRefs.size) return safeLatest;

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
  const unrecoverableLockedGames = new Set(
    [...lockedRefs.entries()]
      .filter(([, ref]) => !lockedSnapshots.has(ref.snapshotId))
      .map(([gameId]) => gameId),
  );
  if (unrecoverableLockedGames.size) throw new Error("MLB props locked source unavailable.");

  const lockedRowsByGame = new Map<string, PlayerPropPreviewRow[]>();
  const lockedResearch: NonNullable<PlayerPropsDashboardData["research"]> = {};
  const lockedResearchPresence = new Map<string, boolean>();
  const lockedUpdatedByGame = new Map<string, string>();
  for (const [gameId, ref] of lockedRefs) {
    const locked = lockedSnapshots.get(ref.snapshotId);
    if (!locked) continue;
    const rows = locked.data.props
      // The original stored source wins before current team/evidence semantics.
      .filter((row) => row.providerIds?.gameId === gameId)
      .map((row) => row.lockStatus?.status === "locked" ? row : ({
        ...row, lockStatus: { ...row.lockStatus, status: "locked" as const, lockedAt: ref.lockedAt },
      }));
    if (!rows.length) throw new Error("MLB props locked source game rows unavailable.");
    lockedRowsByGame.set(gameId, rows);
    lockedUpdatedByGame.set(gameId, ref.lockedAt);
    for (const row of rows) {
      if (row.researchKey === null || row.researchKey === undefined) continue;
      // Lookup follows JavaScript dictionary property semantics even for an
      // opaque legacy key; the original row and key are never rewritten.
      const researchKey = String(row.researchKey);
      const present = Boolean(locked.data.research && Object.hasOwn(locked.data.research, researchKey));
      if (lockedResearchPresence.has(researchKey) && lockedResearchPresence.get(researchKey) !== present) {
        throw new Error("MLB props conflicting locked research authority unavailable.");
      }
      // An original missing module is still original authority. It cannot be
      // filled from current research or from another locked source's module.
      lockedResearchPresence.set(researchKey, present);
      if (present) {
        const original = locked.data.research![researchKey];
        if (Object.hasOwn(lockedResearch, researchKey) && lockedResearch[researchKey] !== original &&
          JSON.stringify(lockedResearch[researchKey]) !== JSON.stringify(original)) {
          throw new Error("MLB props conflicting locked research authority unavailable.");
        }
        Object.defineProperty(lockedResearch, researchKey, { value: original, enumerable: true, configurable: true, writable: true });
      }
    }
  }
  if (!lockedRowsByGame.size) throw new Error("MLB props locked source rows unavailable.");

  const emittedLockedGames = new Set<string>();
  const props: PlayerPropPreviewRow[] = [];
  for (const row of safeLatest.data.props) {
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
  const lockedLastUpdated = [...lockedUpdatedByGame.values()].sort().at(-1) ?? safeLatest.data.lastUpdated;
  // A current capture cannot replace a missing historical evidence identity.
  // Preserve each locked row/reference and its original tuple without applying
  // current reference-removal or source-team rules to that public record.
  const referencedEvidenceIds = (rows: readonly PlayerPropPreviewRow[]) =>
    (rows as readonly MlbPropsMarketEvidenceRow[]).flatMap(row => row.marketEvidenceId ? [row.marketEvidenceId] : []);
  const lockedEvidenceIds = new Set([...lockedRowsByGame.values()].flatMap(referencedEvidenceIds));
  const currentCapture = safeLatest.marketEvidence ? {
    ...safeLatest.marketEvidence,
    i: safeLatest.marketEvidence.i.filter(identity => !lockedEvidenceIds.has(identity[0])),
  } : undefined;
  const lockedCaptures = [...lockedRefs.entries()].flatMap(([gameId, ref]) => {
    const source = lockedSnapshots.get(ref.snapshotId)!;
    if (!source.marketEvidence) return [];
    const ids = new Set(referencedEvidenceIds(lockedRowsByGame.get(gameId) ?? []));
    return [{ ...source.marketEvidence, i: source.marketEvidence.i.filter(identity => ids.has(identity[0])) }];
  });
  const originalTuples = new Map<string, string>();
  for (const capture of lockedCaptures) for (const identity of capture.i) {
    const original = JSON.stringify(identity), prior = originalTuples.get(identity[0]);
    if (prior !== undefined && prior !== original) throw new Error("MLB props conflicting locked evidence authority unavailable.");
    originalTuples.set(identity[0], original);
  }
  const mergedEvidence = mergeMlbPropsMarketEvidenceCaptures({
    captures: [currentCapture, ...lockedCaptures],
    rows: props as MlbPropsMarketEvidenceRow[],
    // Only the transient union is materialized here; original per-source
    // evidence and every locked row remain unchanged.
    allowTransientLockedOverflow: true,
  });
  const capturedProps = mergedEvidence.capture
    ? (props as MlbPropsMarketEvidenceRow[]).map((row) => row.lockStatus?.status === "locked"
      ? row : withoutUnretainedMlbPropsEvidenceReference(row, mergedEvidence.retainedIds))
    : props;
  const data: PlayerPropsDashboardData = {
    ...safeLatest.data,
    lastUpdated: allGamesLocked ? lockedLastUpdated : safeLatest.data.lastUpdated,
    props: capturedProps,
    research: {
      ...Object.fromEntries(Object.entries(safeLatest.data.research ?? {})
        .filter(([key]) => !lockedResearchPresence.has(key))),
      ...lockedResearch,
    },
    summary: summarizeDisplayProps(safeLatest.data, props),
  };

  // Do not leave the mutable latest capture attached when the original locked
  // identity has no retained historical evidence tuple.
  const { marketEvidence: ignoredCurrentEvidence, ...displayBase } = safeLatest;
  void ignoredCurrentEvidence;
  return {
    ...displayBase,
    data,
    ...(mergedEvidence.capture ? { marketEvidence: mergedEvidence.capture } : {}),
  };
}

function suppressOfficialPitcherTeamConflicts(snapshot: MlbPropsBoardSnapshot): MlbPropsBoardSnapshot {
  const props = snapshot.data.props.filter((row) => row.lockStatus?.status === "locked" || officialPitcherTeamIsCoherent(snapshot.data, row));
  if (props.length === snapshot.data.props.length) return snapshot;
  return {
    ...snapshot,
    data: {
      ...snapshot.data,
      props,
      summary: summarizeDisplayProps(snapshot.data, props),
    },
  };
}

function officialPitcherTeamIsCoherent(data: PlayerPropsDashboardData, row: PlayerPropPreviewRow): boolean {
  if (row.marketFamily !== "pitcher") return true;
  const matchup = data.slate?.matchups.find((candidate) =>
    candidate.gameStartTime === row.gameStartTime
    && ((candidate.awayTeam === row.team && candidate.homeTeam === row.opponent)
      || (candidate.homeTeam === row.team && candidate.awayTeam === row.opponent)),
  );
  if (!matchup) return true;
  const player = normalizeDisplayPlayerName(row.player);
  const awayStarter = normalizeDisplayPlayerName(matchup.awayProbablePitcher ?? "");
  const homeStarter = normalizeDisplayPlayerName(matchup.homeProbablePitcher ?? "");
  if (player === awayStarter) return row.team === matchup.awayTeam;
  if (player === homeStarter) return row.team === matchup.homeTeam;
  return true;
}

function normalizeDisplayPlayerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function loadLockedDisplaySnapshotRefs(slateDate: string): Promise<Map<string, LockedDisplaySnapshotPointer>> {
  const data = await loadLockedDisplaySnapshotRows(slateDate);
  const refs = new Map<string, LockedDisplaySnapshotPointer>();
  for (const row of data) {
    if (typeof row.external_game_id !== "string" || !row.external_game_id ||
      typeof row.board_snapshot_id !== "string" || !row.board_snapshot_id ||
      typeof row.locked_at !== "string" || !Number.isFinite(Date.parse(row.locked_at))) {
      throw new Error("MLB props locked source reference unavailable.");
    }
    if (!refs.has(row.external_game_id)) {
      refs.set(row.external_game_id, {
        snapshotId: row.board_snapshot_id,
        lockedAt: row.locked_at,
      });
    }
  }
  return refs;
}

export async function loadMlbPropsLockedGameTimes(slateDate: string): Promise<Map<string, string>> {
  try {
    const refs = await loadLockedDisplaySnapshotRefs(slateDate);
    return new Map([...refs.entries()].map(([gameId, ref]) => [gameId, ref.lockedAt]));
  } catch {
    throw new Error("MLB props lock inventory unavailable.");
  }
}

async function loadLockedDisplaySnapshotRows(slateDate: string, purpose: "display" | "retention" = "display"): Promise<LockedDisplaySnapshotRef[]> {
  const rows: LockedDisplaySnapshotRef[] = [];
  rows.push(...(purpose === "retention"
    ? await loadMlbPropsGameLockRows(slateDate, false) : await loadMlbPropsGameLocks(slateDate)));

  // Retain tracking-entry references for slates produced before the
  // authoritative game-lock policy. New game-lock rows are loaded first and
  // therefore win the first-ref map.
  const supabase = getSupabase();
  for (let page = 0; page < MAX_LOCK_REF_PAGES; page++) {
    const from = page * LOCK_REF_PAGE_SIZE;
    const { data, error } = await supabase
      .from("mlb_prop_tracking_entries")
      .select("external_game_id,board_snapshot_id,locked_at")
      .eq("slate_date", slateDate)
      .not(purpose === "retention" ? "board_snapshot_id" : "locked_at", "is", null)
      .order("locked_at", { ascending: true })
      .range(from, from + LOCK_REF_PAGE_SIZE - 1);
    if (error || !Array.isArray(data) || data.length > LOCK_REF_PAGE_SIZE) throw new Error("MLB props legacy-lock inventory unavailable.");
    const pageRows = data as LockedDisplaySnapshotRef[];
    rows.push(...pageRows);
    if (pageRows.length < LOCK_REF_PAGE_SIZE) return rows;
  }
  throw new Error(`MLB props lock reference limit exceeded for ${slateDate}.`);
}

export async function loadMlbPropsGameLocks(slateDate: string): Promise<MlbPropsGameLockPointer[]> {
  return loadMlbPropsGameLockRows(slateDate, true);
}

async function loadMlbPropsGameLockRows(slateDate: string, firstPerGame: boolean): Promise<MlbPropsGameLockPointer[]> {
  const { data, error } = await getSupabase()
    .from("admin_audit_log")
    .select("after_state,created_at")
    .eq("action_type", MLB_PROPS_GAME_LOCK_AUDIT_ACTION)
    .eq("target_table", "prop_scoring_runs")
    .contains("after_state", { slate_date: slateDate })
    .order("created_at", { ascending: true })
    .limit(101);
  if (error || !Array.isArray(data) || data.length > 100) throw new Error("MLB props game-lock inventory unavailable.");
  const locks: MlbPropsGameLockPointer[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    const lock = decodeMlbPropsGameLock(row.after_state);
    if (!lock || lock.slate_date !== slateDate) throw new Error("MLB props game-lock reference unavailable.");
    if (firstPerGame && seen.has(lock.external_game_id)) continue;
    seen.add(lock.external_game_id);
    locks.push(lock);
  }
  return locks;
}

export async function loadLatestMlbPropsGameLockSchedule(
  slateDate: string,
): Promise<MlbPropsGameLockScheduleEntry[]> {
  const { data, error } = await getSupabase()
    .from("admin_audit_log")
    .select("after_state")
    .eq("action_type", "mlb_props.board_snapshot_published")
    .eq("target_table", "prop_scoring_runs")
    .contains("after_state", { slate_date: slateDate })
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !Array.isArray(data) || data.length > 10) throw new Error("MLB props game-lock schedule inventory unavailable.");
  for (const row of data) {
    if (!isRecord(row.after_state) || row.after_state.slate_date !== slateDate) continue;
    const value = row.after_state.game_lock_schedule;
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) =>
      isRecord(entry)
      && typeof entry.externalGameId === "string"
      && typeof entry.gameStartTimestamp === "string"
        ? [{ externalGameId: entry.externalGameId, gameStartTimestamp: entry.gameStartTimestamp }]
        : []);
  }
  return [];
}

export function deriveMlbPropsGameLockSchedule(
  snapshot: MlbPropsBoardSnapshot,
): MlbPropsGameLockScheduleEntry[] {
  const games = new Map<string, string>();
  for (const row of snapshot.data.props) {
    const gameId = row.providerIds?.gameId;
    if (gameId && Number.isFinite(Date.parse(row.gameStartTime))) games.set(gameId, row.gameStartTime);
  }
  return [...games.entries()].map(([externalGameId, gameStartTimestamp]) => ({
    externalGameId,
    gameStartTimestamp,
  }));
}

function decodeMlbPropsGameLock(value: unknown): MlbPropsGameLockPointer | null {
  if (!isRecord(value)) return null;
  const required = [
    "external_game_id",
    "slate_date",
    "game_start_timestamp",
    "lock_cutoff_timestamp",
    "board_snapshot_id",
    "snapshot_as_of_timestamp",
    "locked_at",
    "model_release_id",
  ] as const;
  if (required.some((key) => typeof value[key] !== "string" || value[key].length === 0)) return null;
  return value as unknown as MlbPropsGameLockPointer;
}

export async function loadMlbPropsBoardSnapshotById(slateDate: string, snapshotId: string): Promise<MlbPropsBoardSnapshot | null> {
  try {
    return await loadExactMlbPropsBoardSnapshotById(slateDate, snapshotId);
  } catch {
    throw new Error("MLB props locked source read unavailable.");
  }
}

async function loadExactMlbPropsBoardSnapshotById(slateDate: string, snapshotId: string): Promise<MlbPropsBoardSnapshot | null> {
  const supabase = getSupabase();
  // Resolve through the lightweight audit index. Filtering metadata_json —
  // even through ->> — makes Postgres scan multi-megabyte JSON documents and
  // can hit the statement timeout on a full slate.
  const { data: refs, error: refsError } = await supabase
    .from("admin_audit_log")
    .select("target_id,after_state,created_at")
    .eq("action_type", "mlb_props.board_snapshot_published")
    .eq("target_table", "prop_scoring_runs")
    // Bound the exact lightweight identity, not unrelated later publications.
    // Two rows expose ambiguous authority instead of choosing one arbitrarily.
    .contains("after_state", { slate_date: slateDate, snapshot_id: snapshotId })
    .order("created_at", { ascending: false })
    .limit(2);
  if (refsError || !Array.isArray(refs) || refs.length > 1) throw new Error("MLB props locked source index unavailable.");
  const ref = refs[0];
  if (!ref) return null;
  if (!isRecord(ref.after_state) || ref.after_state.slate_date !== slateDate || ref.after_state.snapshot_id !== snapshotId) {
    throw new Error("MLB props locked source index identity unavailable.");
  }
  const runId = sourceRunId(ref.target_id);
  if (runId === null) throw new Error("MLB props locked source index identity unavailable.");
  const { data, error } = await supabase.from("prop_scoring_runs").select("id,created_at,metadata_json").eq("id", runId).maybeSingle();
  if (error) throw new Error("MLB props locked source read unavailable.");
  if (!data) return null;
  const snapshot = decodeMlbPropsBoardSnapshot(data.metadata_json);
  const envelope = data.metadata_json;
  if (!snapshot || !isRecord(envelope) || snapshot.snapshotId !== snapshotId || snapshot.slateDate !== slateDate ||
    envelope.snapshot_id !== snapshotId || envelope.slate_date !== slateDate || envelope.as_of_timestamp !== snapshot.asOfTimestamp) return null;
  if (needsIndexedCutoff(snapshot) && !indexedSourceMatches(data, snapshot, ref)) return null;
  return snapshot;
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

type MlbPropsMemoryCacheEntry = {
  freshUntilMs: number;
  value: Promise<MlbPropsBoardSnapshot | null>;
};

// Full MLB prop snapshots are intentionally comprehensive and can decode to
// tens of megabytes. Next's persistent incremental cache rejects values above
// its 2 MB item limit, which turns every request into another Supabase read and
// produces a cache-error loop under traffic. Keep one in-flight/result promise
// per warm function instance instead. This coalesces concurrent requests and
// bounds staleness without attempting to persist the oversized object.
const boardSnapshotMemoryCache = new Map<string, MlbPropsMemoryCacheEntry>();

function loadMlbPropsSnapshotWithMemoryCache(
  cache: Map<string, MlbPropsMemoryCacheEntry>,
  slateDate: string,
  loader: (date: string) => Promise<MlbPropsBoardSnapshot | null>,
): Promise<MlbPropsBoardSnapshot | null> {
  const now = Date.now();
  const cached = cache.get(slateDate);
  if (cached && cached.freshUntilMs > now) return cached.value;

  const value: Promise<MlbPropsBoardSnapshot | null> = loader(slateDate).catch((error) => {
    const current = cache.get(slateDate);
    if (current?.value === value) cache.delete(slateDate);
    throw error;
  });
  cache.set(slateDate, { freshUntilMs: now + MLB_PROPS_MEMORY_CACHE_TTL_MS, value });
  return value;
}

export async function loadCachedLatestMlbPropsBoardSnapshot(slateDate: string): Promise<MlbPropsBoardSnapshot | null> {
  return loadMlbPropsSnapshotWithMemoryCache(boardSnapshotMemoryCache, slateDate, loadLatestMlbPropsBoardSnapshot);
}

export async function loadCachedLatestMlbPropsDisplaySnapshot(slateDate: string): Promise<MlbPropsBoardSnapshot | null> {
  // Coalesce the large raw board, but reread immutable lock authority on every
  // display request. A pre-lock cache entry must not bypass a newly stored lock.
  const latest = await loadCachedLatestMlbPropsBoardSnapshot(slateDate);
  return latest ? applyMlbPropsDisplayLocks(latest) : null;
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
  const indexedHead = await loadHighestIndexedMlbPropsReleaseHead(snapshot.slateDate);
  const current = indexedHead ? null : await loadLatestMlbPropsBoardSnapshot(snapshot.slateDate);
  assertMlbPropsReleaseDoesNotRegress({
    candidateReleaseId: snapshot.modelContext?.modelReleaseId,
    currentReleaseId: indexedHead?.releaseId ?? current?.modelContext?.modelReleaseId,
    candidateTimestamp: snapshot.asOfTimestamp,
    currentTimestamp: indexedHead?.asOfTimestamp ?? current?.asOfTimestamp,
  });
  const metadata = encodeMlbPropsBoardSnapshot(snapshot);
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
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
    // Lightweight scalar index for retention and lock-reference resolution.
    // Keeping this outside metadata_json prevents maintenance queries from
    // scanning/decompressing every multi-megabyte board payload.
    const { error: indexError } = await supabase.from("admin_audit_log").insert({
      action_type: "mlb_props.board_snapshot_published",
      target_table: "prop_scoring_runs",
      target_id: String(data.id),
      before_state: null,
      after_state: {
        snapshot_id: snapshot.snapshotId,
        slate_date: snapshot.slateDate,
        model_release_id: snapshot.modelContext?.modelReleaseId ?? null,
        as_of_timestamp: snapshot.asOfTimestamp,
        ...(needsIndexedCutoff(snapshot) ? { payload_checksum: metadata.checksum } : {}),
        game_lock_schedule: deriveMlbPropsGameLockSchedule(snapshot),
      },
      source_type: "real_api",
    });
    if (indexError) {
      if (needsIndexedCutoff(snapshot)) throw new MlbPropsPublicationUncertainError();
      console.warn(`MLB props snapshot index write failed: ${indexError.message}`);
    }
    revalidateMlbPropsBoardCache();
    await pruneOldMlbPropsBoardSnapshots(snapshot.slateDate, snapshot.snapshotId).catch(() => undefined);
    return String(data.id);
  } catch (error) {
    // Both returned Supabase errors and rejected responses can follow a commit.
    // Future R2 requires its real index; do not log raw transport messages or
    // allow the ordinary final publication to enter a stale LKG fallback.
    if (needsIndexedCutoff(snapshot)) throw new MlbPropsPublicationUncertainError();
    throw error;
  }
}

export function revalidateMlbPropsBoardCache(): void {
  boardSnapshotMemoryCache.clear();
  publishedReleaseHeadCache.clear();
}

/** Complete lightweight publication inventory for retention. An incomplete
 * or unknown page never authorizes deletion of a potentially locked source. */
async function loadMlbPropsRetentionSourceIndex(slateDate: string) {
  const supabase = getSupabase();
  const rows: Array<{ target_id: unknown; after_state: unknown }> = [];
  const maximum = 5_000;
  for (let from = 0; from <= maximum; from += LOCK_REF_PAGE_SIZE) {
    const terminal = from === maximum;
    const { data, error } = await supabase.from("admin_audit_log")
      .select("target_id,after_state")
      .eq("action_type", "mlb_props.board_snapshot_published")
      .eq("target_table", "prop_scoring_runs")
      .contains("after_state", { slate_date: slateDate })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, terminal ? from : from + LOCK_REF_PAGE_SIZE - 1);
    if (error || !Array.isArray(data) || data.length > (terminal ? 1 : LOCK_REF_PAGE_SIZE)) {
      throw new Error("MLB props retention source index unavailable.");
    }
    if (terminal) {
      if (data.length) throw new Error("MLB props retention source index limit exceeded.");
      return rows;
    }
    rows.push(...data);
    if (data.length < LOCK_REF_PAGE_SIZE) return rows;
  }
  throw new Error("MLB props retention source index unavailable.");
}

async function pruneOldMlbPropsBoardSnapshots(slateDate: string, currentSnapshotId: string): Promise<void> {
  const retention = envPositiveInteger("ODDSPHERE_PROPS_SNAPSHOT_RETENTION_PER_SLATE", DEFAULT_MLB_PROPS_SNAPSHOT_RETENTION_PER_SLATE);
  const supabase = getSupabase();
  const [{ data: rows, error: rowsError }, lockedRefs, snapshotIndex] = await Promise.all([
    supabase
      .from("prop_scoring_runs")
      .select("id,created_at")
      .eq("sport", "mlb")
      .eq("slate_date", slateDate)
      .eq("status", "completed")
      .eq("persisted", true)
      .eq("dry_run", false)
      .eq("provider_mode", "real")
      .order("created_at", { ascending: false })
      .limit(250),
    // Retention owns every original reference, including older references for
    // the same game and references not yet marked locked. The display reader
    // separately keeps its first-ref precedence without changing stored rows.
    loadLockedDisplaySnapshotRows(slateDate, "retention"),
    loadMlbPropsRetentionSourceIndex(slateDate),
  ]);
  if (rowsError || !Array.isArray(rows) || rows.length > 250 || rows.some(row => !isRecord(row) || sourceRunId(row.id) === null)) throw new Error("MLB props retention source inventory unavailable.");
  const referencedSnapshotIds = new Set<string>([currentSnapshotId]);
  for (const ref of lockedRefs) {
    if (typeof ref.board_snapshot_id !== "string" || !ref.board_snapshot_id) {
      throw new Error("MLB props retention lock reference unavailable.");
    }
    referencedSnapshotIds.add(ref.board_snapshot_id);
  }
  const indexedSnapshotByRunId = new Map<string, string | null>();
  for (const entry of snapshotIndex) {
    if (!isRecord(entry) || !isRecord(entry.after_state) || entry.after_state.slate_date !== slateDate
      || typeof entry.after_state.snapshot_id !== "string" || !entry.after_state.snapshot_id) {
      throw new Error("MLB props retention source index identity unavailable.");
    }
    const runId = sourceRunId(entry.target_id);
    if (runId === null) throw new Error("MLB props retention source index identity unavailable.");
    const snapshotId = entry.after_state.snapshot_id;
    // Conflicting original indices are unknown authority, not last-write-wins
    // permission to delete a source referenced by a different immutable ID.
    if (indexedSnapshotByRunId.has(runId) && indexedSnapshotByRunId.get(runId) !== snapshotId) {
      indexedSnapshotByRunId.set(runId, null);
    } else if (!indexedSnapshotByRunId.has(runId)) indexedSnapshotByRunId.set(runId, snapshotId);
  }
  const newestRunIds = new Set(rows.slice(0, retention).map((row) => String(row.id)));
  const deleteIds = rows.filter((row) => {
    const runId = String(row.id), snapshotId = indexedSnapshotByRunId.get(runId);
    // Unindexed, malformed or ambiguous source identities stay preserved.
    return typeof snapshotId === "string" && !newestRunIds.has(runId) && !referencedSnapshotIds.has(snapshotId);
  }).map((row) => (row as { id: string | number }).id);
  if (!deleteIds.length) return;
  const { error } = await supabase.from("prop_scoring_runs").delete().in("id", deleteIds);
  if (error) throw new Error("MLB props retention delete unavailable.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function indexedReleaseId(value: Record<string, unknown>): string | null {
  return typeof value.model_release_id === "string" ? value.model_release_id : null;
}

function envPositiveInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
