import { supabase } from "../db/supabase";
import {
  getMlbPitcherSeasonStats,
  type PitcherSeasonStatsRecord,
} from "../providers/real_api/_mlbStatsApiClient";
import type { Sport } from "../types/domain/Sport";
import { MLB_STATS_UPSERT_BATCH_SIZE } from "./seasonBattingStatsService";
import {
  completeSeasonStatsDailyRefresh,
  hasSuccessfulSeasonStatsDailyRefresh,
  seasonStatsMappedCohortSignature,
  startSeasonStatsDailyRefresh,
} from "./seasonStatsDailyRefreshMarker";

type SlatePitcher = {
  id: number;
  team_id: number | null;
  mlb_person_id: number | null;
  provider_ids: Record<string, unknown> | null;
};

type ExistingPitchingRow = {
  player_id: number;
  pitching_era: number | null;
  pitching_ip: number | null;
  updated_at: string | null;
};

function providerMlbId(providerIds: Record<string, unknown> | null): number | null {
  const value = providerIds?.mlb_stats;
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { id?: unknown }).id;
  const parsed = typeof id === "number" ? id : typeof id === "string" ? Number(id) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function effectiveMlbId(player: SlatePitcher): number | null {
  return providerMlbId(player.provider_ids) ?? player.mlb_person_id;
}

function easternDate(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function hasFreshSlatePitchingCoverage(args: {
  players: SlatePitcher[];
  stats: ExistingPitchingRow[];
  slateDate: string;
}): boolean {
  const playerIds = new Set(args.players.map((player) => player.id));
  const usable = args.stats.filter((row) =>
    playerIds.has(row.player_id) &&
    typeof row.pitching_era === "number" &&
    typeof row.pitching_ip === "number" &&
    row.pitching_ip > 0
  );
  return usable.length > 0 &&
    usable.every((row) => row.updated_at !== null && easternDate(row.updated_at) === args.slateDate);
}

export type SeasonPitchingRosterRefreshResult = {
  status: "fresh" | "refreshed" | "provider_empty" | "no_slate" | "dry_run";
  teams_checked: number;
  players_mapped: number;
  provider_rows: number;
  rows_written: number;
  api_calls: number;
  db_batches: number;
};

function payloadFor(
  player: SlatePitcher,
  row: PitcherSeasonStatsRecord,
  season: number,
  updatedAt: string,
): Record<string, unknown> {
  return {
    player_id: player.id,
    team_id: player.team_id,
    season,
    season_type: "regular",
    postseason: false,
    pitching_gp: row.games_played,
    pitching_gs: row.games_started,
    pitching_w: row.wins,
    pitching_l: row.losses,
    pitching_era: row.era,
    pitching_whip: row.whip,
    pitching_ip: row.innings_pitched,
    pitching_h: row.hits_allowed,
    pitching_er: row.earned_runs,
    pitching_hr: row.home_runs_allowed,
    pitching_bb: row.walks,
    pitching_k: row.strikeouts,
    pitching_k_per_9: row.strikeouts_per_9,
    pitching_sv: row.saves,
    pitching_hld: row.holds,
    updated_at: updatedAt,
  };
}

/**
 * Once-per-slate-day starter and bullpen season refresh. One league-wide
 * provider request and one partial-column upsert replace the scheduled
 * per-starter fan-out while remaining inside the existing MLB pipeline lease.
 */
export async function refreshSlateSeasonPitchingStats(args: {
  sport: Sport;
  date: string;
  writeMode: boolean;
  now?: Date;
}): Promise<SeasonPitchingRosterRefreshResult> {
  const season = Number(args.date.slice(0, 4));
  const now = args.now ?? new Date();
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("home_team_id, away_team_id")
    .eq("sport", args.sport)
    .eq("slate_date", args.date);
  if (gamesError) throw new Error(`season pitching games query failed: ${gamesError.message}`);
  const teamIds = Array.from(new Set(
    (games ?? []).flatMap((game) => [game.home_team_id, game.away_team_id])
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
    .eq("is_pitcher", true);
  if (playerError) throw new Error(`season pitching players query failed: ${playerError.message}`);
  const players = (playerData ?? []) as SlatePitcher[];
  const mappedPlayers = players.flatMap((player) => {
    const mlbId = effectiveMlbId(player);
    return mlbId === null ? [] : [{ id: player.id, mlbId }];
  });
  const playersMapped = mappedPlayers.length;
  const cohortSignature = seasonStatsMappedCohortSignature(mappedPlayers);
  if (await hasSuccessfulSeasonStatsDailyRefresh({
    kind: "pitching",
    sport: args.sport,
    slateDate: args.date,
    cohortSignature,
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
    ? await supabase.from("player_season_stats")
        .select("player_id, pitching_era, pitching_ip, updated_at")
        .in("player_id", playerIds)
        .eq("season", season)
        .eq("season_type", "regular")
    : { data: [], error: null };
  if (statError) throw new Error(`season pitching freshness query failed: ${statError.message}`);

  if (hasFreshSlatePitchingCoverage({
    players,
    stats: (statData ?? []) as ExistingPitchingRow[],
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

  const providerRows = await getMlbPitcherSeasonStats(season, { quiet: true });
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
  const byMlbId = new Map(providerRows.map((row) => [row.mlb_person_id, row]));
  const payload = players.flatMap((player) => {
    const mlbId = effectiveMlbId(player);
    const row = mlbId === null ? undefined : byMlbId.get(mlbId);
    return row ? [payloadFor(player, row, season, now.toISOString())] : [];
  });
  const markerLogId = await startSeasonStatsDailyRefresh({
    kind: "pitching",
    sport: args.sport,
    slateDate: args.date,
    cohortSignature,
  });
  let dbBatches = 0;
  try {
    for (let offset = 0; offset < payload.length; offset += MLB_STATS_UPSERT_BATCH_SIZE) {
      const batch = payload.slice(offset, offset + MLB_STATS_UPSERT_BATCH_SIZE);
      const { error } = await supabase
        .from("player_season_stats")
        .upsert(batch, { onConflict: "player_id,season,season_type" });
      if (error) throw new Error(`season pitching roster upsert failed: ${error.message}`);
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
