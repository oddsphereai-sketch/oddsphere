import { supabase } from "@/lib/db/supabase";
import type { PlayerPropsDashboardData } from "@/app/mlb/props/components/PlayerPropsDashboard";
import {
  applyMlbPropsDisplayLocks,
  type MlbPropsBoardSnapshot,
} from "./boardSnapshotStore";
import {
  buildMlbPropsInitialMemberBoardData,
  selectMlbPropsResearchForRows,
} from "./memberPayload";

const BOARD_TTL_MS = 40 * 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;

type BoardPayload = {
  schemaVersion: 1;
  snapshotId: string;
  asOfTimestamp: string;
  data: PlayerPropsDashboardData;
  shardKeys?: string[];
};

type PlayerPayload = {
  schemaVersion: 1;
  snapshotId: string;
  asOfTimestamp: string;
  playerId: string;
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

export async function publishMlbPropsMemberReadSnapshots(snapshot: MlbPropsBoardSnapshot): Promise<void> {
  // The tracking ledger points at the exact canonical pregame board snapshot
  // for every locked game. Reconcile from that source before building any
  // member payload. Never infer a lock by applying an old timestamp to rows
  // from the latest (potentially in-game) refresh.
  const displaySnapshot = await applyMlbPropsDisplayLocks(snapshot);
  const lockedGames = await loadLockedGameTimes(displaySnapshot.slateDate);
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
    data: boundedBoard,
  };
  const fullBoardPayload: BoardPayload = {
    schemaVersion: 1,
    snapshotId: displaySnapshot.snapshotId,
    asOfTimestamp: displaySnapshot.asOfTimestamp,
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
  }, {
    ...common,
    snapshot_key: fullBoardKey(displaySnapshot.slateDate),
    kind: "mlb_props_board",
    payload: fullBoardPayload,
  }];
  for (const [gameId, props] of fullPropsByGame) {
    boardRows.push({
      ...common,
      snapshot_key: `${fullBoardKey(displaySnapshot.slateDate)}::${gameId}`,
      kind: "mlb_props_board",
      payload: {
        schemaVersion: 1,
        snapshotId: displaySnapshot.snapshotId,
        asOfTimestamp: displaySnapshot.asOfTimestamp,
        data: { ...displaySnapshot.data, research: undefined, props },
      } satisfies BoardPayload,
    });
  }
  const playerSnapshotRows: Record<string, unknown>[] = [];
  for (const [playerId, props] of playerRows) {
    const payload: PlayerPayload = {
      schemaVersion: 1,
      snapshotId: displaySnapshot.snapshotId,
      asOfTimestamp: displaySnapshot.asOfTimestamp,
      playerId,
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

async function loadLockedGameTimes(date: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("mlb_prop_tracking_entries")
    .select("external_game_id,locked_at")
    .eq("slate_date", date)
    .not("locked_at", "is", null)
    .order("locked_at", { ascending: true })
    .limit(5000);
  if (error) throw error;
  const result = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.external_game_id && row.locked_at && !result.has(row.external_game_id)) {
      result.set(row.external_game_id, row.locked_at);
    }
  }
  return result;
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
  if (!full || !manifest.shardKeys?.length) return manifest;
  const shards = await Promise.all(manifest.shardKeys.map(async (snapshotKey) => {
    const { data: shard, error: shardError } = await supabase
      .from("lab_response_snapshots")
      .select("payload")
      .eq("snapshot_key", snapshotKey)
      .gt("stale_until", new Date().toISOString())
      .maybeSingle();
    if (shardError) throw shardError;
    return validBoardPayload(shard?.payload) ? shard.payload : null;
  }));
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
  return validPlayerPayload(data?.payload) ? data.payload : null;
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
    && isRecord(value.research);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
