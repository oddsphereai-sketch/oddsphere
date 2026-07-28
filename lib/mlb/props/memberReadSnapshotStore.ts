import { supabase } from "@/lib/db/supabase";
import type { PlayerPropsDashboardData } from "@/app/mlb/props/components/PlayerPropsDashboard";
import {
  applyMlbPropsDisplayLocks,
  loadHighestIndexedMlbPropsReleaseHead,
  loadMlbPropsLockedGameTimes,
  type MlbPropsBoardSnapshot,
} from "./boardSnapshotStore";
import {
  buildMlbPropsInitialMemberBoardData,
  selectMlbPropsResearchForRows,
} from "./memberPayload";
import { MLB_PROPS_MODEL_RELEASE_ID } from "./marketModelVersions";
import {
  assertMlbPropsReleaseDoesNotRegress,
  compareMlbPropsReleaseIds,
} from "./releaseOrdering";

const BOARD_TTL_MS = 40 * 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;

type BoardPayload = {
  schemaVersion: 1;
  snapshotId: string;
  asOfTimestamp: string;
  modelReleaseId?: string;
  data: PlayerPropsDashboardData;
  shardKeys?: string[];
};

type PlayerPayload = {
  schemaVersion: 1;
  snapshotId: string;
  asOfTimestamp: string;
  modelReleaseId?: string;
  playerId: string;
  props?: PlayerPropsDashboardData["props"];
  research: NonNullable<PlayerPropsDashboardData["research"]>;
};

function boardKey(date: string): string {
  return `mlb-props-board::${date}`;
}

function fullBoardKey(date: string): string {
  return `mlb-props-board-full::${date}`;
}

function playerKey(date: string, playerId: string): string {
  return `mlb-props-player::${date}::${playerId}`;
}

export async function publishMlbPropsMemberReadSnapshots(
  snapshot: MlbPropsBoardSnapshot,
  options?: { forceFull?: boolean; compactOnly?: boolean },
): Promise<void> {
  assertMlbPropsReleaseDoesNotRegress({
    candidateReleaseId: snapshot.modelContext?.modelReleaseId,
    currentReleaseId: MLB_PROPS_MODEL_RELEASE_ID,
  });
  const current = await loadHighestIndexedMlbPropsReleaseHead(snapshot.slateDate);
  assertMlbPropsReleaseDoesNotRegress({
    candidateReleaseId: snapshot.modelContext?.modelReleaseId,
    currentReleaseId: current?.releaseId,
    candidateTimestamp: snapshot.asOfTimestamp,
    currentTimestamp: current?.asOfTimestamp,
  });
  // The tracking ledger points at the exact canonical pregame board snapshot
  // for every locked game. Reconcile from that source before building any
  // member payload. Never infer a lock by applying an old timestamp to rows
  // from the latest (potentially in-game) refresh.
  const displaySnapshot = await applyMlbPropsDisplayLocks(snapshot);
  const lockedGames = await loadMlbPropsLockedGameTimes(displaySnapshot.slateDate);
  assertLockedGamesUseAuthoritativeRows(displaySnapshot.data.props, lockedGames);
  const now = Date.now();
  const common = {
    sport: "mlb",
    slate_date: displaySnapshot.slateDate,
    payload_version: "v1",
    source: "mlb_props_refresh",
    generated_at: new Date(now).toISOString(),
    expires_at: new Date(now + BOARD_TTL_MS).toISOString(),
    stale_until: new Date(now + STALE_TTL_MS).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  const boundedBoard = buildMlbPropsInitialMemberBoardData(displaySnapshot.data);
  const boardPayload: BoardPayload = {
    schemaVersion: 1,
    snapshotId: displaySnapshot.snapshotId,
    asOfTimestamp: displaySnapshot.asOfTimestamp,
    modelReleaseId: displaySnapshot.modelContext?.modelReleaseId,
    data: boundedBoard,
  };
  const fullBoardPayload: BoardPayload = {
    schemaVersion: 1,
    snapshotId: displaySnapshot.snapshotId,
    asOfTimestamp: displaySnapshot.asOfTimestamp,
    modelReleaseId: displaySnapshot.modelContext?.modelReleaseId,
    data: { ...displaySnapshot.data, research: undefined, props: [] },
  };
  const fullProps = displaySnapshot.data.props;
  const fullPropsByGame = new Map<string, typeof fullProps>();
  for (const prop of fullProps) {
    const gameId = prop.providerIds?.gameId ?? "unmapped";
    fullPropsByGame.set(gameId, [...(fullPropsByGame.get(gameId) ?? []), prop]);
  }
  const fullShardKeys = [...fullPropsByGame.keys()].map((gameId) => `${fullBoardKey(displaySnapshot.slateDate)}::${gameId}`);
  fullBoardPayload.shardKeys = fullShardKeys;
  const playerRows = new Map<string, typeof displaySnapshot.data.props>();
  for (const row of displaySnapshot.data.props) {
    const playerId = row.providerIds?.mlbStatsPlayerId
      ?? row.providerIds?.bdlPlayerId?.toString()
      ?? row.id;
    playerRows.set(playerId, [...(playerRows.get(playerId) ?? []), row]);
  }
  const boardRows: Record<string, unknown>[] = [{
    ...common,
    snapshot_key: boardKey(displaySnapshot.slateDate),
    kind: "mlb_props_board",
    payload: boardPayload,
  }];
  // Fast odds refreshes update one compact indexed member row only. Rewriting
  // every game and player shard on each price tick creates a connection/write
  // storm on the smallest Supabase tier. Full refreshes rebuild drill-downs.
  const publishFull = options?.compactOnly !== true
    && (snapshot.refreshMode === "full" || options?.forceFull === true);
  if (publishFull) {
    boardRows.push({
      ...common,
      snapshot_key: fullBoardKey(displaySnapshot.slateDate),
      kind: "mlb_props_board",
      payload: fullBoardPayload,
    });
  }
  for (const [gameId, props] of publishFull ? fullPropsByGame : []) {
    boardRows.push({
      ...common,
      snapshot_key: `${fullBoardKey(displaySnapshot.slateDate)}::${gameId}`,
      kind: "mlb_props_board",
      payload: {
        schemaVersion: 1,
        snapshotId: displaySnapshot.snapshotId,
        asOfTimestamp: displaySnapshot.asOfTimestamp,
        modelReleaseId: displaySnapshot.modelContext?.modelReleaseId,
        data: { ...displaySnapshot.data, research: undefined, props },
      } satisfies BoardPayload,
    });
  }
  const playerSnapshotRows: Record<string, unknown>[] = [];
  for (const [playerId, props] of publishFull ? playerRows : []) {
    const payload: PlayerPayload = {
      schemaVersion: 1,
      snapshotId: displaySnapshot.snapshotId,
      asOfTimestamp: displaySnapshot.asOfTimestamp,
      modelReleaseId: displaySnapshot.modelContext?.modelReleaseId,
      playerId,
      props,
      research: selectMlbPropsResearchForRows(displaySnapshot.data, props),
    };
    playerSnapshotRows.push({
      ...common,
      snapshot_key: playerKey(snapshot.slateDate, playerId),
      kind: "mlb_props_player",
      payload,
    });
  }
  // Board payloads are the largest rows, so write each in its own statement.
  // Combining the compact and full board in one upsert exceeds Supabase
  // nano's statement-time budget.
  for (const row of boardRows) {
    const { error } = await supabase
      .from("lab_response_snapshots")
      .upsert(row, { onConflict: "snapshot_key" });
    if (error) throw error;
  }
  // Keep each research statement small enough for Supabase nano.
  for (let index = 0; index < playerSnapshotRows.length; index += 10) {
    const { error } = await supabase
      .from("lab_response_snapshots")
      .upsert(playerSnapshotRows.slice(index, index + 10), { onConflict: "snapshot_key" });
    if (error) throw error;
  }
}

function assertLockedGamesUseAuthoritativeRows(
  rows: PlayerPropsDashboardData["props"],
  lockedGames: Map<string, string>,
): void {
  if (!lockedGames.size) return;
  const rowsByGame = new Map<string, PlayerPropsDashboardData["props"]>();
  for (const row of rows) {
    const gameId = row.providerIds?.gameId;
    if (gameId) rowsByGame.set(gameId, [...(rowsByGame.get(gameId) ?? []), row]);
  }
  for (const gameId of lockedGames.keys()) {
    const gameRows = rowsByGame.get(gameId) ?? [];
    if (gameRows.some((row) => row.lockStatus?.status !== "locked")) {
      throw new Error(`Refusing to publish mutable member rows for locked MLB game ${gameId}.`);
    }
  }
}

export async function loadMlbPropsMemberBoardSnapshot(date: string, full = false): Promise<BoardPayload | null> {
  const { data, error } = await supabase
    .from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", full ? fullBoardKey(date) : boardKey(date))
    .gt("stale_until", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!validBoardPayload(data?.payload)) return null;
  const manifest = data.payload;
  if (!await memberPayloadIsCurrent(date, manifest.modelReleaseId, manifest.asOfTimestamp)) return null;
  if (!full || !manifest.shardKeys?.length) return manifest;
  const shards: Array<BoardPayload | null> = [];
  // Full-board reads are operator/fallback paths now. Fetch bounded batches
  // instead of opening one concurrent database request per MLB game.
  for (let index = 0; index < manifest.shardKeys.length; index += 4) {
    const keys = manifest.shardKeys.slice(index, index + 4);
    const { data: rows, error: shardError } = await supabase
      .from("lab_response_snapshots")
      .select("snapshot_key,payload")
      .in("snapshot_key", keys)
      .gt("stale_until", new Date().toISOString());
    if (shardError) throw shardError;
    const byKey = new Map((rows ?? []).map((row) => [row.snapshot_key, row.payload]));
    for (const key of keys) {
      const payload = byKey.get(key);
      shards.push(validBoardPayload(payload) ? payload : null);
    }
  }
  if (shards.some((shard) => shard === null || shard.snapshotId !== manifest.snapshotId)) return null;
  return {
    ...manifest,
    data: {
      ...manifest.data,
      props: shards.flatMap((shard) => shard?.data.props ?? []),
    },
  };
}

export async function loadMlbPropsPlayerReadSnapshot(date: string, playerId: string): Promise<PlayerPayload | null> {
  const { data, error } = await supabase
    .from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", playerKey(date, playerId))
    .gt("stale_until", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!validPlayerPayload(data?.payload)) return null;
  return await memberPayloadIsCurrent(date, data.payload.modelReleaseId, data.payload.asOfTimestamp)
    ? data.payload
    : null;
}

async function memberPayloadIsCurrent(
  date: string,
  modelReleaseId: string | undefined,
  asOfTimestamp: string,
): Promise<boolean> {
  const canonical = await loadHighestIndexedMlbPropsReleaseHead(date).catch(() => null);
  if (!canonical) return true;
  const releaseComparison = compareMlbPropsReleaseIds(modelReleaseId, canonical.releaseId);
  if (releaseComparison === null || releaseComparison < 0) return false;
  return releaseComparison > 0 || Date.parse(asOfTimestamp) >= Date.parse(canonical.asOfTimestamp);
}

function validBoardPayload(value: unknown): value is BoardPayload {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.snapshotId !== "string") return false;
  return typeof value.asOfTimestamp === "string" && isRecord(value.data) && Array.isArray(value.data.props);
}

function validPlayerPayload(value: unknown): value is PlayerPayload {
  return isRecord(value)
    && value.schemaVersion === 1
    && typeof value.snapshotId === "string"
    && typeof value.asOfTimestamp === "string"
    && typeof value.playerId === "string"
    && (value.props === undefined || Array.isArray(value.props))
    && isRecord(value.research);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
