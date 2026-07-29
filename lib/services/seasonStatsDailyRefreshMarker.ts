import { supabase } from "../db/supabase";
import type { Sport } from "../types/domain/Sport";
import { refreshLogger } from "./refreshLogger";

export type MlbSeasonStatsRefreshKind = "batting" | "pitching";

export function seasonStatsDailyRefreshSource(
  kind: MlbSeasonStatsRefreshKind,
  slateDate: string,
): string {
  return `mlb_season_${kind}_bulk:${slateDate}`;
}

export async function hasSuccessfulSeasonStatsDailyRefresh(args: {
  kind: MlbSeasonStatsRefreshKind;
  sport: Sport;
  slateDate: string;
}): Promise<boolean> {
  const { count, error } = await supabase
    .from("data_refresh_log")
    .select("id", { count: "exact", head: true })
    .eq("data_source", seasonStatsDailyRefreshSource(args.kind, args.slateDate))
    .eq("sport", args.sport)
    .eq("refresh_status", "success");
  if (error) {
    throw new Error(`season stats daily marker query failed: ${error.message}`);
  }
  return (count ?? 0) > 0;
}

export async function startSeasonStatsDailyRefresh(args: {
  kind: MlbSeasonStatsRefreshKind;
  sport: Sport;
  slateDate: string;
}): Promise<number> {
  return refreshLogger.start(
    seasonStatsDailyRefreshSource(args.kind, args.slateDate),
    args.sport,
  );
}

export async function completeSeasonStatsDailyRefresh(args: {
  logId: number;
  success: boolean;
  rowsWritten?: number;
  error?: string;
}): Promise<void> {
  await refreshLogger.complete(args.logId, {
    success: args.success,
    records_updated: args.rowsWritten ?? 0,
    api_calls_made: 1,
    error_message: args.error ?? null,
  });
}
