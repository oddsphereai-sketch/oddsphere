import type { SupabaseClient } from "@supabase/supabase-js";
import type { NflPlayerPropsProductionSnapshot } from "./nflPlayerPropsProductionContract";

export const NFL_PLAYER_PROPS_SNAPSHOT_KEY_PREFIX = "nfl::player-props" as const;
const TABLE_MISSING_RE = /relation .*lab_response_snapshots.* does not exist|schema cache/i;

export function nflPlayerPropsSnapshotKey(season: number, week: number): string {
  return `${NFL_PLAYER_PROPS_SNAPSHOT_KEY_PREFIX}::${season}::${week}`;
}

export async function readNflPlayerPropsSnapshot(args: {
  client: SupabaseClient;
  season: number;
  week: number;
}): Promise<NflPlayerPropsProductionSnapshot | null> {
  const { data, error } = await args.client
    .from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", nflPlayerPropsSnapshotKey(args.season, args.week))
    .maybeSingle();
  if (error) {
    if (TABLE_MISSING_RE.test(error.message)) return null;
    throw new Error(`NFL player props snapshot read failed: ${error.message}`);
  }
  return data?.payload as NflPlayerPropsProductionSnapshot | null;
}

export async function writeNflPlayerPropsSnapshot(args: {
  client: SupabaseClient;
  snapshot: NflPlayerPropsProductionSnapshot;
  source: string;
}): Promise<void> {
  const generatedAt = args.snapshot.generatedAt;
  const starts = args.snapshot.board.decisions.map((row) => Date.parse(row.lockAt) + 60 * 60_000);
  const staleUntilMs = starts.length ? Math.max(...starts) + 36 * 60 * 60_000 : Date.parse(generatedAt) + 48 * 60 * 60_000;
  const { error } = await args.client.from("lab_response_snapshots").upsert({
    snapshot_key: nflPlayerPropsSnapshotKey(args.snapshot.season, args.snapshot.week),
    kind: "daily_edge",
    sport: "nfl",
    slate_date: null,
    payload: args.snapshot,
    payload_version: args.snapshot.release,
    source: args.source,
    generated_at: generatedAt,
    expires_at: new Date(Date.parse(generatedAt) + 90 * 60_000).toISOString(),
    stale_until: new Date(staleUntilMs).toISOString(),
    updated_at: generatedAt,
  }, { onConflict: "snapshot_key" });
  if (error) throw new Error(`NFL player props snapshot write failed: ${error.message}`);
}
