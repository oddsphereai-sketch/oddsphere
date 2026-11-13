import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbbGame, CbbTeam } from "@/lib/cbb/types";
import { readCbbMemberGames, writeCbbMemberGame } from "./cbbMemberGameStore";
import { writeLockedCbbTracking } from "./cbbTrackingWriter";

export const CBB_PREGAME_LOCK_SWEEP_RELEASE = "cbb_pregame_lock_sweep_2026_11_13_r1_before_forecast_work" as const;
const MAX_DUE_GAMES = 300;
type Team = { external_id: number; display_name: string; abbreviation: string };
type Fixture = { external_id: number; game_date: string; home_team: Team | Team[]; away_team: Team | Team[] };
const one = (team: Team | Team[]) => Array.isArray(team) ? team[0] : team;
const providerTeam = (team: Team): CbbTeam => ({ id: Number(team.external_id), full_name: team.display_name,
  name: team.display_name, college: null, conference_id: null, abbreviation: team.abbreviation });

/** Runs FIRST inside the existing prediction_pipeline:cbb lease. Reuses the
 * already published decision; no provider, training, inference, or new timer.
 * A single bad fixture cannot prevent unrelated due games from freezing. */
export async function sweepCbbPregameLocks(args: { db: SupabaseClient; now: string; clock?: () => string }) {
  const at = Date.parse(args.now);
  if (!Number.isFinite(at)) throw Error("Invalid CBB lock-sweep clock");
  const { data, error } = await args.db.from("games")
    .select("external_id,game_date,home_team:teams!games_home_team_id_fkey(external_id,display_name,abbreviation),away_team:teams!games_away_team_id_fkey(external_id,display_name,abbreviation)")
    .eq("sport", "cbb").eq("status", "STATUS_SCHEDULED")
    .gt("game_date", args.now).lte("game_date", new Date(at + 60 * 60_000).toISOString())
    .order("game_date").limit(MAX_DUE_GAMES + 1);
  if (error) throw Error(`CBB lock-sweep fixture read failed: ${error.message}`);
  if ((data?.length ?? 0) > MAX_DUE_GAMES) throw Error("CBB lock-sweep fixture cap reached");
  const fixtures = (data ?? []) as unknown as Fixture[];
  const prior = await readCbbMemberGames(fixtures.map(row => Number(row.external_id)), args.db);
  const report = { release: CBB_PREGAME_LOCK_SWEEP_RELEASE, due: fixtures.length, locked: 0, trackingInserted: 0,
    problems: [] as string[] };
  for (const fixture of fixtures) {
    const id = Number(fixture.external_id), stored = prior.get(id);
    if (!stored) { report.problems.push(`${id}:prelock_snapshot_missing`); continue; }
    try {
      const home = one(fixture.home_team), away = one(fixture.away_team);
      const now = args.clock?.() ?? args.now;
      const start = Date.parse(fixture.game_date), cutoff = start - 60 * 60_000;
      if (!home || !away || !Number.isFinite(Date.parse(now)) || Date.parse(now) < at
        || Date.parse(now) >= start || Date.parse(now) < cutoff
        || Date.parse(stored.snapshot.startsAt) !== start)
        throw Error("fixture_identity_or_write_clock_changed");
      if (!stored.snapshot.lockedAt && (!(Date.parse(stored.snapshot.capturedAt) < cutoff)
        || !(Date.parse(stored.snapshot.board.asOf) <= Date.parse(stored.snapshot.capturedAt))))
        throw Error("no_qualifying_pre_cutoff_published_decision");
      const forecast = stored.snapshot.board.gameForecast;
      if (forecast && (forecast.homeId !== Number(home.external_id) || forecast.awayId !== Number(away.external_id)))
        throw Error("school_identity_changed");
      const game: CbbGame = { id, date: fixture.game_date, season: new Date(start).getUTCFullYear(),
        status: "pre", period: 0, home_score: 0, away_score: 0,
        home_team: providerTeam(home), visitor_team: providerTeam(away) };
      const result = await writeCbbMemberGame({ game, candidate: null, homeLogo: null, awayLogo: null, now }, args.db);
      if (result.written) report.locked++;
      report.trackingInserted += await writeLockedCbbTracking(result.record, args.db);
    } catch (error) {
      report.problems.push(`${id}:${error instanceof Error ? error.message : "lock_failed"}`);
    }
  }
  return report;
}
