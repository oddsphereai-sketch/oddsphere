import { supabase } from "../db/supabase";
import type { Sport } from "../types/domain/Sport";
import { refreshLogger } from "./refreshLogger";
import { createHash } from "node:crypto";

export type MlbSeasonStatsRefreshKind = "batting" | "pitching";

export function seasonStatsDailyRefreshSource(
  kind: MlbSeasonStatsRefreshKind,
  slateDate: string,
  cohortSignature?: string,
): string {
  const base = `mlb_season_${kind}_bulk:${slateDate}`;
  return cohortSignature ? `${base}:${cohortSignature}` : base;
}

export function seasonStatsMappedCohortSignature(
  players: Array<{ id: number; mlbId: number }>,
): string {
  const canonical = players
    .map((player) => `${player.id}:${player.mlbId}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export async function hasSuccessfulSeasonStatsDailyRefresh(args: {
  kind: MlbSeasonStatsRefreshKind;
  sport: Sport;
  slateDate: string;
  cohortSignature: string;
}): Promise<boolean> {
  const { count, error } = await supabase
    .from("data_refresh_log")
    .select("id", { count: "exact", head: true })
    .eq(
      "data_source",
      seasonStatsDailyRefreshSource(args.kind, args.slateDate, args.cohortSignature),
    )
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
  cohortSignature: string;
}): Promise<number> {
  return refreshLogger.start(
    seasonStatsDailyRefreshSource(args.kind, args.slateDate, args.cohortSignature),
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
