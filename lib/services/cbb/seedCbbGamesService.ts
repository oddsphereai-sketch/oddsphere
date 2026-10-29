import { CbbBallDontLieClient } from "../../cbb/ballDontLie";
import { assertCbbFixtureRefreshSafe, cbbCanonicalGamePayload, cbbCanonicalStatus,
  cbbCanonicalTeamPayload, type CbbExistingFixture } from "../../cbb/canonicalFixture";
import type { CbbGame, CbbTeam } from "../../cbb/types";
import { addDaysToSlate, computeSlateDate } from "../../dates/slateDate";

export const CBB_FIXTURE_SEED_RELEASE = "cbb_fixture_seed_2026_10_29_r1_exact_id_et_slate" as const;

type SeedOptions = {
  slateDate: string;
  season: number;
  apiKey: string;
  dryRun: boolean;
  client?: CbbBallDontLieClient;
};

/** Provider date matching can straddle UTC midnight; the ET date is final. */
export function selectCbbSlateGames(rows: CbbGame[], slateDate: string, season: number): CbbGame[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slateDate) || !Number.isInteger(season)) {
    throw new Error("Invalid CBB slate date or season");
  }
  if (rows.some(row => row.season !== season)) throw new Error("CBB provider returned a foreign season");
  const games = rows.filter(row => computeSlateDate("cbb", row.date) === slateDate);
  if (new Set(games.map(game => game.id)).size !== games.length) throw new Error("Duplicate CBB fixture ID");
  for (const game of games) {
    cbbCanonicalStatus(game);
    cbbCanonicalTeamPayload(game.home_team);
    cbbCanonicalTeamPayload(game.visitor_team);
    if (game.home_team.id === game.visitor_team.id) throw new Error("CBB fixture has duplicate participants");
  }
  return games.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

function chunks<T>(rows: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
}

/**
 * Seed only exact CBB team IDs and ET-slate fixtures. No prediction, grade,
 * price, lock, or tracking field is written here. An empty provider response
 * is returned as empty rather than deleting an existing slate.
 */
export async function seedCbbGames(options: SeedOptions) {
  const dates = [addDaysToSlate(options.slateDate, -1), options.slateDate,
    addDaysToSlate(options.slateDate, 1)];
  const client = options.client ?? new CbbBallDontLieClient(options.apiKey, { maxRequests: 25 });
  const games = selectCbbSlateGames(await client.gamesForDates(dates, options.season),
    options.slateDate, options.season);
  const teams = new Map<number, CbbTeam>();
  for (const game of games) {
    for (const team of [game.home_team, game.visitor_team]) {
      const previous = teams.get(team.id);
      if (previous && previous.full_name !== team.full_name) throw new Error("Conflicting CBB team identity in slate");
      teams.set(team.id, team);
    }
  }
  const result = { release: CBB_FIXTURE_SEED_RELEASE, slateDate: options.slateDate,
    season: options.season, providerCalls: client.calls, games: games.length,
    teams: teams.size, written: false };
  if (options.dryRun || !games.length) return result;
  const { supabase } = await import("../../db/supabase");

  const teamDbIds = new Map<number, number>();
  for (const batch of chunks([...teams.values()].map(cbbCanonicalTeamPayload), 100)) {
    const ids = batch.map(team => team.external_id);
    const before = await supabase.from("teams")
      .select("id,external_id,display_name").eq("sport", "cbb").in("external_id", ids);
    if (before.error) throw new Error(`CBB team lookup failed: ${before.error.message}`);
    const existing = new Map((before.data ?? []).map(row => [Number(row.external_id), row]));
    for (const team of batch) {
      const prior = existing.get(team.external_id);
      if (prior && prior.display_name !== team.display_name) {
        throw new Error(`CBB team ${team.external_id} has a conflicting stored identity`);
      }
    }
    const missing = batch.filter(team => !existing.has(team.external_id));
    if (missing.length) {
      const inserted = await supabase.from("teams")
        .upsert(missing, { onConflict: "sport,external_id", ignoreDuplicates: true });
      if (inserted.error) throw new Error(`CBB team insert failed: ${inserted.error.message}`);
    }
    const after = await supabase.from("teams")
      .select("id,external_id,display_name").eq("sport", "cbb").in("external_id", ids);
    if (after.error || !after.data || after.data.length !== batch.length) {
      throw new Error(`CBB team ID resolution failed: ${after.error?.message ?? "incomplete team set"}`);
    }
    for (const row of after.data) {
      const expected = batch.find(team => team.external_id === Number(row.external_id));
      if (!expected || row.display_name !== expected.display_name) {
        throw new Error(`CBB team ${row.external_id} changed identity during seed`);
      }
      teamDbIds.set(Number(row.external_id), Number(row.id));
    }
  }

  const externalIds = games.map(game => game.id);
  const existingById = new Map<number, CbbExistingFixture>();
  for (const batch of chunks(externalIds, 100)) {
    const { data, error } = await supabase.from("games")
      .select("id,external_id,status,game_date,home_team_id,away_team_id")
      .eq("sport", "cbb").in("external_id", batch);
    if (error) throw new Error(`CBB existing fixture lookup failed: ${error.message}`);
    for (const row of data ?? []) existingById.set(Number(row.external_id), row as CbbExistingFixture);
  }
  const lockedDbIds = new Set<number>();
  const dbIds = [...existingById.values()].map(row => row.id);
  for (const batch of chunks(dbIds, 100)) {
    const { data, error } = await supabase.from("prediction_records")
      .select("game_id").eq("sport", "cbb").in("game_id", batch).not("locked_at", "is", null);
    if (error) throw new Error(`CBB locked fixture lookup failed: ${error.message}`);
    for (const row of data ?? []) lockedDbIds.add(Number(row.game_id));
  }
  const payloads = games.map(game => {
    const homeDbId = teamDbIds.get(game.home_team.id), awayDbId = teamDbIds.get(game.visitor_team.id);
    if (!homeDbId || !awayDbId) throw new Error("CBB seed lost an exact team ID");
    const payload = cbbCanonicalGamePayload(game, homeDbId, awayDbId);
    const previous = existingById.get(game.id);
    assertCbbFixtureRefreshSafe(previous, payload, previous ? lockedDbIds.has(previous.id) : false);
    return payload;
  });
  for (const batch of chunks(payloads, 100)) {
    const { error } = await supabase.from("games").upsert(batch, { onConflict: "sport,external_id" });
    if (error) throw new Error(`CBB game seed failed: ${error.message}`);
  }
  return { ...result, written: true };
}
