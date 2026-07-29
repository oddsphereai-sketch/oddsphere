import { supabase } from "../db/supabase";
import {
  getMlbHitterSeasonStats,
  type MlbHitterSeasonStatsRecord,
} from "../providers/real_api/_mlbStatsApiClient";
import type { Sport } from "../types/domain/Sport";
import {
  completeSeasonStatsDailyRefresh,
  hasSuccessfulSeasonStatsDailyRefresh,
  startSeasonStatsDailyRefresh,
} from "./seasonStatsDailyRefreshMarker";

const MIN_FRESH_QUALIFIED_BATTERS_PER_TEAM = 3;
export const MLB_STATS_UPSERT_BATCH_SIZE = 250;

type SlateBatter = {
  id: number;
  team_id: number | null;
  mlb_person_id: number | null;
  provider_ids: Record<string, unknown> | null;
};

type ExistingBattingRow = {
  player_id: number;
  batting_ops: number | null;
  batting_pa: number | null;
  updated_at: string | null;
};

function providerMlbId(providerIds: Record<string, unknown> | null): number | null {
  const value = providerIds?.mlb_stats;
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { id?: unknown }).id;
  const parsed = typeof id === "number" ? id : typeof id === "string" ? Number(id) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function effectiveMlbId(player: SlateBatter): number | null {
  return providerMlbId(player.provider_ids) ?? player.mlb_person_id;
}

function easternDate(value: string | number | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function hasFreshTeamBattingCoverage(args: {
  teamIds: number[];
  players: SlateBatter[];
  stats: ExistingBattingRow[];
  slateDate?: string;
  nowMs?: number;
}): boolean {
  const nowMs = args.nowMs ?? Date.now();
  const slateDate = args.slateDate ?? easternDate(nowMs);
  if (slateDate === null) return false;
  const playerById = new Map(args.players.map((player) => [player.id, player]));
  const counts = new Map<number, number>();
  let usableRows = 0;
  let freshUsableRows = 0;
  for (const row of args.stats) {
    const player = playerById.get(row.player_id);
    if (player?.team_id === null || player?.team_id === undefined) continue;
    const usable =
      typeof row.batting_ops === "number" &&
      typeof row.batting_pa === "number" &&
      (row.batting_pa ?? 0) > 0;
    if (!usable) continue;
    usableRows++;
    const updatedDate = row.updated_at ? easternDate(row.updated_at) : null;
    if (updatedDate !== slateDate) continue;
    freshUsableRows++;
    if ((row.batting_pa ?? 0) >= 100) {
      counts.set(player.team_id, (counts.get(player.team_id) ?? 0) + 1);
    }
  }
  return usableRows > 0 &&
    freshUsableRows === usableRows &&
    args.teamIds.every(
    (teamId) => (counts.get(teamId) ?? 0) >= MIN_FRESH_QUALIFIED_BATTERS_PER_TEAM,
  );
}

export type SeasonBattingRefreshResult = {
  status: "fresh" | "refreshed" | "provider_empty" | "no_slate" | "dry_run";
  teams_checked: number;
  players_mapped: number;
  provider_rows: number;
  rows_written: number;
  api_calls: number;
  db_batches: number;
};

/**
 * Refresh current-season batting aggregates for the active batters on today's
 * MLB teams. The provider read is one league-wide request, then a single
 * partial-column upsert. It runs inside the existing slate-cycle lease.
 */
export async function refreshSlateSeasonBattingStats(args: {
  sport: Sport;
  date: string;
  writeMode: boolean;
  now?: Date;
}): Promise<SeasonBattingRefreshResult> {
  const season = Number(args.date.slice(0, 4));
  const now = args.now ?? new Date();
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("home_team_id, away_team_id")
    .eq("sport", args.sport)
    .eq("slate_date", args.date);
  if (gamesError) throw new Error(`season batting games query failed: ${gamesError.message}`);

  const teamIds = Array.from(new Set(
    (games ?? [])
      .flatMap((game) => [game.home_team_id, game.away_team_id])
      .filter((id): id is number => typeof id === "number"),
  ));
  if (teamIds.length === 0) {
    return { status: "no_slate", teams_checked: 0, players_mapped: 0, provider_rows: 0, rows_written: 0, api_calls: 0, db_batches: 0 };
  }

  const { data: playerData, error: playerError } = await supabase
    .from("players")
    .select("id, team_id, mlb_person_id, provider_ids")
    .in("team_id", teamIds)
    .eq("active", true)
    .eq("is_pitcher", false);
  if (playerError) throw new Error(`season batting players query failed: ${playerError.message}`);
  const players = (playerData ?? []) as SlateBatter[];
  const playersMapped = players.filter((player) => effectiveMlbId(player) !== null).length;
  if (await hasSuccessfulSeasonStatsDailyRefresh({
    kind: "batting",
    sport: args.sport,
    slateDate: args.date,
  })) {
    return {
      status: "fresh",
      teams_checked: teamIds.length,
      players_mapped: playersMapped,
      provider_rows: 0,
      rows_written: 0,
      api_calls: 0,
      db_batches: 0,
    };
  }
  const playerIds = players.map((player) => player.id);
  const { data: statData, error: statError } = playerIds.length
    ? await supabase
        .from("player_season_stats")
        .select("player_id, batting_ops, batting_pa, updated_at")
        .in("player_id", playerIds)
        .eq("season", season)
        .eq("season_type", "regular")
    : { data: [], error: null };
  if (statError) throw new Error(`season batting freshness query failed: ${statError.message}`);

  if (hasFreshTeamBattingCoverage({
    teamIds,
    players,
    stats: (statData ?? []) as ExistingBattingRow[],
    slateDate: args.date,
    nowMs: now.getTime(),
  })) {
    return {
      status: "fresh",
      teams_checked: teamIds.length,
      players_mapped: playersMapped,
      provider_rows: 0,
      rows_written: 0,
      api_calls: 0,
      db_batches: 0,
    };
  }

  if (!args.writeMode) {
    return {
      status: "dry_run",
      teams_checked: teamIds.length,
      players_mapped: playersMapped,
      provider_rows: 0,
      rows_written: 0,
      api_calls: 0,
      db_batches: 0,
    };
  }

  const providerRows = await getMlbHitterSeasonStats(season, { quiet: true });
  if (!providerRows?.length) {
    return {
      status: "provider_empty",
      teams_checked: teamIds.length,
      players_mapped: playersMapped,
      provider_rows: 0,
      rows_written: 0,
      api_calls: 1,
      db_batches: 0,
    };
  }

  const byMlbId = new Map<number, MlbHitterSeasonStatsRecord>(
    providerRows.map((row) => [row.mlb_person_id, row]),
  );
  const payload: Array<Record<string, unknown>> = [];
  for (const player of players) {
    const mlbId = effectiveMlbId(player);
    const row = mlbId === null ? undefined : byMlbId.get(mlbId);
    if (!row) continue;
    payload.push({
      player_id: player.id,
      team_id: player.team_id,
      season,
      season_type: "regular",
      postseason: false,
      batting_gp: row.games_played,
      batting_ab: row.at_bats,
      batting_r: row.runs,
      batting_h: row.hits,
      batting_avg: row.batting_average,
      batting_2b: row.doubles,
      batting_3b: row.triples,
      batting_hr: row.home_runs,
      batting_rbi: row.rbis,
      batting_tb: row.total_bases,
      batting_bb: row.walks,
      batting_so: row.strikeouts,
      batting_sb: row.stolen_bases,
      batting_obp: row.on_base_percentage,
      batting_slg: row.slugging_percentage,
      batting_ops: row.ops,
      batting_pa: row.plate_appearances,
      batting_hbp: row.hit_by_pitch,
      batting_sf: row.sacrifice_flies,
      updated_at: now.toISOString(),
    });
  }
  const markerLogId = await startSeasonStatsDailyRefresh({
    kind: "batting",
    sport: args.sport,
    slateDate: args.date,
  });
  let dbBatches = 0;
  try {
    for (let offset = 0; offset < payload.length; offset += MLB_STATS_UPSERT_BATCH_SIZE) {
      const batch = payload.slice(offset, offset + MLB_STATS_UPSERT_BATCH_SIZE);
      const { error } = await supabase
        .from("player_season_stats")
        .upsert(batch, { onConflict: "player_id,season,season_type" });
      if (error) throw new Error(`season batting upsert failed: ${error.message}`);
      dbBatches++;
    }
    await completeSeasonStatsDailyRefresh({
      logId: markerLogId,
      success: true,
      rowsWritten: payload.length,
    });
  } catch (error) {
    await completeSeasonStatsDailyRefresh({
      logId: markerLogId,
      success: false,
      rowsWritten: 0,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
  return {
    status: "refreshed",
    teams_checked: teamIds.length,
    players_mapped: playersMapped,
    provider_rows: providerRows.length,
    rows_written: payload.length,
    api_calls: 1,
    db_batches: dbBatches,
  };
}
