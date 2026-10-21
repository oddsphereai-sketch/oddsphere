import type { SupabaseClient } from "@supabase/supabase-js";
import type { NbaPlayerPropsForwardDecision } from "./nbaPlayerPropsFrozenRuntime";
import {
  buildNbaPlayerPropsPrivateTrackingRow,
  decodeNbaPlayerPropsPrivateTrackingHistory,
  encodeNbaPlayerPropsPrivateTrackingHistory,
  mergeNbaPlayerPropsPrivateTrackingRows,
  NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,
  type NbaPlayerPropsPrivateTrackingHistory,
  type NbaPlayerPropsPrivateTrackingRow,
} from "./nbaPlayerPropsPrivateTracking";
import type { NbaPlayerPropsMemberSnapshot } from "./nbaPlayerPropsProductContract";

export const NBA_PLAYER_PROPS_PRIVATE_TRACKING_STORE_RELEASE =
  "nba_player_props_private_tracking_store_2026_10_21_r1_immutable" as const;
const RETENTION_DAYS = 550;

export function nbaPlayerPropsPrivateTrackingKey(season: number, slateDate: string): string {
  return `nba::player-props-private-tracking::${season}::${slateDate}`;
}

export async function readNbaPlayerPropsPrivateTracking(args: {
  client: SupabaseClient;
  season: number;
  slateDate: string;
}): Promise<NbaPlayerPropsPrivateTrackingHistory | null> {
  const { data, error } = await args.client.from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", nbaPlayerPropsPrivateTrackingKey(args.season, args.slateDate))
    .maybeSingle();
  if (error) throw new Error(`NBA props private tracking read failed: ${error.message}`);
  if (data?.payload === null || data?.payload === undefined) return null;
  const history = decodeNbaPlayerPropsPrivateTrackingHistory(data.payload);
  if (!history || history.season !== args.season || history.slateDate !== args.slateDate) {
    throw new Error("NBA props private tracking payload is corrupt or unsupported.");
  }
  return history;
}

export function buildNbaPlayerPropsLockedTrackingRows(args: {
  snapshot: NbaPlayerPropsMemberSnapshot;
  forward: readonly NbaPlayerPropsForwardDecision[];
}): NbaPlayerPropsPrivateTrackingRow[] {
  const forwardByScope = new Map(args.forward.map((row) => [
    `${row.gameId}|${row.playerId}|${row.market}|${row.line}`,
    row,
  ]));
  return args.snapshot.decisions.flatMap((row) => {
    if (!row.lockedAt) return [];
    const gameId = Number(row.gameId.replace(/^.*:/, ""));
    const playerId = Number(row.playerId.replace(/^.*:/, ""));
    const source = forwardByScope.get(`${gameId}|${playerId}|${row.market}|${row.line}`);
    if (!source) return [];
    return [buildNbaPlayerPropsPrivateTrackingRow({
      gameId: row.gameId,
      playerId: row.playerId,
      playerName: row.playerName,
      team: row.team,
      opponent: row.opponent,
      scheduledStart: row.scheduledStart,
      market: row.market,
      line: row.line,
      side: row.side,
      sportsbook: row.sportsbook,
      americanPrice: row.americanPrice,
      canonicalMainLine: true,
      independentProjection: row.independentProjection,
      finalProjection: row.projection,
      independentProbability: source.independentProbability,
      marketProbability: row.targetExcludedProbability,
      finalProbability: row.probability,
      grade: row.grade,
      marketMovement: row.movement ? `${row.movement.openingLine}->${row.movement.currentLine}` : null,
      observedAt: row.evaluatedAt,
      lockedAt: row.lockedAt,
      modelRelease: source.release,
      calibrationRelease: source.release,
      decisionRelease: source.release,
    })];
  });
}

export async function captureNbaPlayerPropsPrivateTracking(args: {
  client: SupabaseClient;
  season: number;
  slateDate: string;
  evaluatedAt: string;
  snapshot: NbaPlayerPropsMemberSnapshot;
  forward: readonly NbaPlayerPropsForwardDecision[];
}): Promise<{ written: boolean; added: number; preserved: number; conflicts: number; total: number }> {
  const previous = await readNbaPlayerPropsPrivateTracking(args);
  const current = buildNbaPlayerPropsLockedTrackingRows({ snapshot: args.snapshot, forward: args.forward });
  const merged = mergeNbaPlayerPropsPrivateTrackingRows({ previous: previous?.rows ?? [], current });
  if (merged.added === 0) {
    return { written: false, added: 0, preserved: merged.preserved, conflicts: merged.conflicts, total: merged.rows.length };
  }
  const history: NbaPlayerPropsPrivateTrackingHistory = {
    kind: "nba_player_props_private_tracking_history_v1",
    schema: "nba_player_props_private_tracking_history_v1",
    captureRelease: NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,
    season: args.season,
    slateDate: args.slateDate,
    createdAt: previous?.createdAt ?? args.evaluatedAt,
    updatedAt: args.evaluatedAt,
    rows: merged.rows,
  };
  const payload = encodeNbaPlayerPropsPrivateTrackingHistory(history);
  const retention = new Date(Date.parse(args.evaluatedAt) + RETENTION_DAYS * 86_400_000).toISOString();
  const { error } = await args.client.from("lab_response_snapshots").upsert({
    snapshot_key: nbaPlayerPropsPrivateTrackingKey(args.season, args.slateDate),
    kind: "tracking",
    sport: "nba",
    slate_date: args.slateDate,
    payload,
    payload_version: NBA_PLAYER_PROPS_PRIVATE_TRACKING_STORE_RELEASE,
    source: NBA_PLAYER_PROPS_PRIVATE_TRACKING_STORE_RELEASE,
    generated_at: args.evaluatedAt,
    expires_at: retention,
    stale_until: retention,
    updated_at: args.evaluatedAt,
  }, { onConflict: "snapshot_key" });
  if (error) throw new Error(`NBA props private tracking write failed: ${error.message}`);
  return { written: true, added: merged.added, preserved: merged.preserved, conflicts: merged.conflicts, total: merged.rows.length };
}
