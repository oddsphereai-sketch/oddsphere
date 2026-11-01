import type { supabase } from "../../db/supabase";

export const NHL_DAILY_STATS_RECEIPT_RELEASE = "nhl_daily_stats_completion_2026_11_01_r1";
export const nhlDailyStatsReceiptKey = (season: number) => `nhl::daily-stats-completion::${season}`;

export function nhlDailyStatsRecoveryDue(now: Date, slateDate: string, completedDate: string | null): boolean {
  // Before the daily run, retain the previous complete pack. After its window,
  // every existing intraday invocation can recover a missed/failed scrape.
  return now.getTime() >= Date.parse(`${slateDate}T11:47:00Z`) && completedDate !== slateDate;
}

export async function readNhlDailyStatsCompletion(client: typeof supabase, season: number, now: Date): Promise<string | null> {
  const { data, error } = await client.from("lab_response_snapshots").select("payload")
    .eq("snapshot_key", nhlDailyStatsReceiptKey(season)).maybeSingle();
  if (error) throw new Error(`NHL stats completion read failed: ${error.message}`);
  const receipt = data?.payload;
  if (receipt?.release !== NHL_DAILY_STATS_RECEIPT_RELEASE || receipt.season !== season ||
    typeof receipt.slateDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(receipt.slateDate) ||
    !Number.isFinite(Date.parse(receipt.completedAt)) || Date.parse(receipt.completedAt) > now.getTime()) return null;
  return receipt.slateDate;
}

export async function recordNhlDailyStatsCompletion(client: typeof supabase, args: {
  season: number; slateDate: string; now: Date; teamRows: number; goalieRows: number;
}): Promise<void> {
  if (args.teamRows <= 0 || args.goalieRows <= 0) throw new Error("NHL stats completion requires both complete input packs");
  const at = args.now.toISOString();
  const { error } = await client.from("lab_response_snapshots").upsert({
    snapshot_key: nhlDailyStatsReceiptKey(args.season), kind: "daily_edge", sport: "nhl", slate_date: args.slateDate,
    payload_version: NHL_DAILY_STATS_RECEIPT_RELEASE, source: "nhl_daily_refresh",
    payload: { release: NHL_DAILY_STATS_RECEIPT_RELEASE, season: args.season, slateDate: args.slateDate, completedAt: at },
    generated_at: at, updated_at: at,
    expires_at: new Date(args.now.getTime() + 48 * 3_600_000).toISOString(),
    stale_until: new Date(args.now.getTime() + 8 * 86_400_000).toISOString(),
  }, { onConflict: "snapshot_key" });
  if (error) throw new Error(`NHL stats completion write failed: ${error.message}`);
}
