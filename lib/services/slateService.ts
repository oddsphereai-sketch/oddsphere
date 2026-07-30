/**
 * slateService — pull tonight's games via the stats provider and upsert into
 * the games table. Powers the morning-slate cron's first step.
 *
 * Idempotent via UPSERT on (sport, external_id). Re-running on the same
 * slate date overwrites games with the latest data (probable-pitcher
 * changes, status updates, etc.).
 *
 * If FK resolution fails for a row (team/pitcher missing from DB), the row
 * is logged and SKIPPED — the rest of the slate still upserts. Returns a
 * count of records_updated representing rows that actually wrote.
 */

import { supabase } from "../db/supabase";
import { getSlateProvider } from "../providers/factory";
import type { ISlateProvider } from "../providers/interfaces/ISlateProvider";
import type { Sport } from "../types/domain/Sport";
import type { CronHandlerResult } from "../cron/runCron";
import { computeSlateDate } from "../dates/slateDate";
import {
  loadBallparkIdByTeamId,
  loadPlayerIdMap,
} from "./_idMaps";
import {
  parseMlbStatsSchedule,
  type ParsedScheduleGame,
} from "./starterResolver";
import { mlbStatsTeamIdFromAbbr } from "../providers/real_api/_teamNameNormalizer";
import {
  isFinalStatus,
  isLiveStatus,
  isUpcomingStatus,
  isVoidStatus,
} from "./gameLifecycle";

/**
 * A lower-authority slate refresh may lag the official lifecycle feed. Never
 * let that refresh move a game backward from live/final/void to scheduled, or
 * replace an official void state with a played state. A genuinely rescheduled
 * MLB game is expected to arrive as its new provider event rather than reuse
 * the void event row.
 */
export function preserveAuthoritativeGameStatus(
  existingStatus: string | null | undefined,
  incomingStatus: string | null | undefined,
): string | null | undefined {
  if (existingStatus === null || existingStatus === undefined) return incomingStatus;
  if (isVoidStatus(existingStatus)) return existingStatus;
  if (isFinalStatus(existingStatus) && !isFinalStatus(incomingStatus)) return existingStatus;
  if (isLiveStatus(existingStatus) && isUpcomingStatus(incomingStatus)) return existingStatus;
  return incomingStatus;
}

/**
 * Match a lower-authority provider game to the official MLB schedule by the
 * exact home/away team pair. Doubleheaders are disambiguated by the provider
 * start time; a missing/ambiguous match fails closed and preserves the
 * provider timestamp.
 */
export function resolveOfficialMlbScheduleGame(input: {
  providerGameDate: string;
  homeMlbTeamId: number | null;
  awayMlbTeamId: number | null;
  officialScheduleGames: ParsedScheduleGame[];
}): ParsedScheduleGame | null {
  if (input.homeMlbTeamId === null || input.awayMlbTeamId === null) return null;

  const candidates = input.officialScheduleGames.filter((game) =>
    game.homeTeamId === input.homeMlbTeamId &&
    game.awayTeamId === input.awayMlbTeamId &&
    Number.isFinite(Date.parse(game.gameDate))
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

  const providerTime = Date.parse(input.providerGameDate);
  if (!Number.isFinite(providerTime)) return null;

  return [...candidates].sort((a, b) => {
    const timeDelta =
      Math.abs(Date.parse(a.gameDate) - providerTime) -
      Math.abs(Date.parse(b.gameDate) - providerTime);
    return timeDelta !== 0 ? timeDelta : a.gamePk - b.gamePk;
  })[0] ?? null;
}

export function resolveCanonicalGameDate(input: {
  providerGameDate: string;
  officialGameDate: string | null;
  existingGameDate: string | null;
  preserveExistingWithoutOfficialMatch: boolean;
}): string {
  if (
    input.officialGameDate !== null &&
    Number.isFinite(Date.parse(input.officialGameDate))
  ) {
    return input.officialGameDate;
  }
  if (
    input.preserveExistingWithoutOfficialMatch &&
    input.existingGameDate !== null &&
    Number.isFinite(Date.parse(input.existingGameDate))
  ) {
    return input.existingGameDate;
  }
  return input.providerGameDate;
}

export const slateService = {
  /**
   * Refresh today's game slate for `sport` on `date` (YYYY-MM-DD).
   * Upserts the games table. Returns counts for refreshLogger.
   *
   * Fix 7.2: `providerOverride` lets the admin upload route pass a fresh
   * ManualSlateProvider scoped to a specific staging row, avoiding any
   * process.env mutation (concurrent-request safe). When omitted, falls
   * through to `getSlateProvider()` which reads SLATE_PROVIDER env (cron
   * path).
   *
   * `opts.dryRun` (default false) is a Phase 4.1.9.C-1b operator-script
   * affordance: when true, the provider fetch + payload build still run
   * normally, but the UPSERT against `games` is skipped. Behavior for
   * existing callers (crons, admin upload route, tests) is unchanged.
   */
  async refreshGames(
    sport: Sport,
    date: string,
    providerOverride?: ISlateProvider,
    opts?: { dryRun?: boolean; officialMlbScheduleRaw?: unknown }
  ): Promise<CronHandlerResult> {
    const dryRun = opts?.dryRun === true;
    const stats = providerOverride ?? getSlateProvider();
    let apiCalls = 0;

    // One bounded team read supplies both the BDL foreign-key mapping and the
    // stable MLB Stats team identity used for official schedule matching.
    // This replaces (rather than adds to) the prior team-map query.
    const { data: teamRows, error: teamRowsError } = await supabase
      .from("teams")
      .select("id, external_id, abbreviation")
      .eq("sport", sport);
    if (teamRowsError) {
      throw new Error(`slateService.refreshGames team read failed: ${teamRowsError.message}`);
    }
    const typedTeamRows = (teamRows ?? []) as Array<{
      id: number;
      external_id: number;
      abbreviation: string | null;
    }>;
    const teamIdByExternal = new Map(
      typedTeamRows.map((team) => [team.external_id, team.id]),
    );
    const mlbStatsTeamIdByInternal = new Map<number, number>();
    if (sport === "mlb") {
      for (const team of typedTeamRows) {
        const mlbStatsTeamId = mlbStatsTeamIdFromAbbr(team.abbreviation);
        if (mlbStatsTeamId !== null) {
          mlbStatsTeamIdByInternal.set(team.id, mlbStatsTeamId);
        }
      }
    }
    const playerIdByExternal = await loadPlayerIdMap(sport);
    const ballparkIdByTeamId = await loadBallparkIdByTeamId();
    const officialScheduleGames =
      sport === "mlb" ? parseMlbStatsSchedule(opts?.officialMlbScheduleRaw) : [];

    const gameRecords = await stats.getGames(date, sport);
    apiCalls++;

    if (gameRecords.length === 0) {
      return { records_updated: 0, api_calls_made: apiCalls };
    }

    // Preserve lifecycle states written by the official score/linescore feed.
    // This is one bounded slate-level read, not a per-game query.
    const externalIds = [...new Set(gameRecords.map((game) => game.external_id))];
    const { data: existingGames, error: existingGamesError } = await supabase
      .from("games")
      .select("external_id, status, game_date")
      .eq("sport", sport)
      .in("external_id", externalIds);
    if (existingGamesError) {
      throw new Error(`slateService.refreshGames status read failed: ${existingGamesError.message}`);
    }
    const typedExistingGames = (existingGames ?? []) as Array<{
      external_id: number;
      status: string | null;
      game_date: string | null;
    }>;
    const existingStatusByExternalId = new Map<number, string | null>(
      typedExistingGames.map((game) => [
        game.external_id,
        game.status,
      ]),
    );
    const existingGameDateByExternalId = new Map<number, string | null>(
      typedExistingGames.map((game) => [game.external_id, game.game_date]),
    );

    const payload: Array<Record<string, unknown>> = [];
    const skipped: number[] = [];
    let officialGameTimesMatched = 0;
    let officialGameTimesChanged = 0;

    for (const g of gameRecords) {
      const homeTeamId =
        g.home_team_external_id !== null
          ? teamIdByExternal.get(g.home_team_external_id) ?? null
          : null;
      const awayTeamId =
        g.away_team_external_id !== null
          ? teamIdByExternal.get(g.away_team_external_id) ?? null
          : null;
      if (homeTeamId === null || awayTeamId === null) {
        // Missing team FK — skip this game; team refresh should run first.
        skipped.push(g.external_id);
        continue;
      }
      const ballparkId = ballparkIdByTeamId.get(homeTeamId) ?? null;
      const officialGame =
        sport === "mlb"
          ? resolveOfficialMlbScheduleGame({
              providerGameDate: g.game_date,
              homeMlbTeamId: mlbStatsTeamIdByInternal.get(homeTeamId) ?? null,
              awayMlbTeamId: mlbStatsTeamIdByInternal.get(awayTeamId) ?? null,
              officialScheduleGames,
            })
          : null;
      const canonicalGameDate = resolveCanonicalGameDate({
        providerGameDate: g.game_date,
        officialGameDate: officialGame?.gameDate ?? null,
        existingGameDate: existingGameDateByExternalId.get(g.external_id) ?? null,
        // Default-provider MLB refreshes are lower authority than MLB Stats.
        // If the official payload is absent or cannot be matched, they may
        // insert a new game but cannot overwrite a previously verified time.
        preserveExistingWithoutOfficialMatch:
          sport === "mlb" && providerOverride === undefined,
      });
      if (officialGame !== null) {
        officialGameTimesMatched++;
        if (Date.parse(canonicalGameDate) !== Date.parse(g.game_date)) {
          officialGameTimesChanged++;
        }
      }
      const suppressDuplicateHome = g.provider_ids?.oddsphere_suppress_duplicate_home_pitcher === 1;
      const suppressDuplicateAway = g.provider_ids?.oddsphere_suppress_duplicate_away_pitcher === 1;
      const row: Record<string, unknown> = {
        sport: g.sport,
        external_id: g.external_id,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        ballpark_id: ballparkId,
        game_date: canonicalGameDate,
        // slate_date is the local-evening date in the sport's anchor timezone
        // (5E.1). Compute from the game's UTC start time + its sport.
        slate_date: computeSlateDate(g.sport as Sport, canonicalGameDate),
        season: g.season,
        season_type: g.season_type,
        postseason: g.postseason,
        status: preserveAuthoritativeGameStatus(
          existingStatusByExternalId.get(g.external_id),
          g.status,
        ),
        venue: g.venue,
        home_score: g.home_score,
        away_score: g.away_score,
        inning_scores: g.inning_scores,
      };
      // A missing provider value means "not supplied yet", not "erase a
      // previously verified starter." Omit that column from the upsert so
      // an existing assignment survives. The doubleheader sanitizer marks
      // the one case that is an intentional clear: a copied game-one starter.
      if (g.home_pitcher_external_id !== null) {
        row.home_pitcher_id = playerIdByExternal.get(g.home_pitcher_external_id) ?? null;
      } else if (suppressDuplicateHome) {
        row.home_pitcher_id = null;
      }
      if (g.away_pitcher_external_id !== null) {
        row.away_pitcher_id = playerIdByExternal.get(g.away_pitcher_external_id) ?? null;
      } else if (suppressDuplicateAway) {
        row.away_pitcher_id = null;
      }
      // Fix 7.2: propagate provider_ids when the provider attached one
      // (manual provider always does — see ManualSlateProvider.getGames).
      // Mock provider omits it; the DB default '{}' applies in that case.
      if (
        (g.provider_ids !== undefined && g.provider_ids !== null) ||
        officialGame !== null
      ) {
        row.provider_ids = {
          ...(g.provider_ids ?? {}),
          ...(officialGame === null ? {} : { mlb_stats: officialGame.gamePk }),
        };
      }
      payload.push(row);
    }

    if (payload.length > 0 && !dryRun) {
      const { error } = await supabase
        .from("games")
        .upsert(payload, { onConflict: "sport,external_id" });
      if (error) {
        throw new Error(`slateService.refreshGames upsert failed: ${error.message}`);
      }
    }

    return {
      records_updated: payload.length,
      api_calls_made: apiCalls,
      details: {
        ...(skipped.length > 0 ? { skipped_external_ids: skipped } : {}),
        official_game_times_matched: officialGameTimesMatched,
        official_game_times_changed: officialGameTimesChanged,
      },
    };
  },
};
