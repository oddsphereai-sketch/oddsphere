import type { supabase as SupabaseClient } from "../../db/supabase";
import { CbbBallDontLieClient } from "../../cbb/ballDontLie";
import { assertCbbFixtureRefreshSafe, cbbFixtureIdentityWouldChange, cbbLockedTerminalScore, cbbCanonicalGamePayload, cbbCanonicalStatus,
  cbbCanonicalTeamPayload, type CbbExistingFixture } from "../../cbb/canonicalFixture";
import type { CbbGame, CbbTeam } from "../../cbb/types";
import { cbbRollingSlateDates } from "../../cbb/rollingSlate";
import { fetchCbbTeamIdentities } from "./fetchCbbTeamIdentities";
import { addDaysToSlate, computeSlateDate } from "../../dates/slateDate";

export const CBB_FIXTURE_SEED_RELEASE = "cbb_fixture_seed_2026_11_04_r7_locked_terminal_score_continuity" as const;

/** The same seven Eastern slate dates the member board will display. */
export function cbbFixtureSeedDates(today: string): string[] {
  return cbbRollingSlateDates(today);
}

/** The prior ET slate is included only for canonical result catch-up; the
 * member board still displays the seven forward ET dates. */
export function cbbFixtureRefreshDates(today: string): string[] {
  return [addDaysToSlate(today, -1), ...cbbFixtureSeedDates(today)];
}

type SeedOptions = {
  slateDate: string;
  season: number;
  apiKey: string;
  dryRun: boolean;
  /** Reuse the sole writer's existing bounded provider receipt. */
  capturedGames?: CbbGame[];
  db?: typeof SupabaseClient;
  client?: CbbBallDontLieClient;
  identityFetcher?: typeof fetchCbbTeamIdentities;
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
  const games = selectCbbSlateGames(options.capturedGames ?? await client.gamesForDates(dates, options.season),
    options.slateDate, options.season);
  const teams = new Map<number, CbbTeam>();
  for (const game of games) {
    for (const team of [game.home_team, game.visitor_team]) {
      const previous = teams.get(team.id);
      if (previous && previous.full_name !== team.full_name) throw new Error("Conflicting CBB team identity in slate");
      teams.set(team.id, team);
    }
  }
  const identities = options.identityFetcher && games.length ?
    await options.identityFetcher({ games, slateDate: options.slateDate }) : null;
  const verifiedLogos = [...teams.values()].filter(team => identities?.get(team.id)?.logoUrl).length;
  const preservedLockedConflicts:number[]=[];
  const terminalScoresMappedToLockedIdentity:number[]=[];
  const result = { preservedLockedConflicts, terminalScoresMappedToLockedIdentity, release: CBB_FIXTURE_SEED_RELEASE, slateDate: options.slateDate,
    season: options.season, providerCalls: client.calls, games: games.length,
    teams: teams.size, verifiedLogos, identitySource: identities ? "espn_catalog_and_exact_event" : "not_requested", written: false };
  if (options.dryRun || !games.length) return result;
  const supabase = options.db ?? (await import("../../db/supabase")).supabase;

  const teamDbIds = new Map<number, number>();
  for (const batch of chunks([...teams.values()].map(team =>
    cbbCanonicalTeamPayload(team, identities?.get(team.id))), 100)) {
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
      .select("id,external_id,season,status,game_date,home_team_id,away_team_id,home_score,away_score")
      .eq("sport", "cbb").in("external_id", batch);
    if (error) throw new Error(`CBB existing fixture lookup failed: ${error.message}`);
    for (const row of data ?? []) existingById.set(Number(row.external_id), row as CbbExistingFixture);
  }
  const lockedDbIds = new Set<number>();
  const lockedMemberIdentities = new Map<number,{home:string;away:string;start:string}>();
  const dbIds = [...existingById.values()].map(row => row.id);
  for (const batch of chunks(dbIds, 100)) {
    const { data, error } = await supabase.from("prediction_records")
      .select("game_id").eq("sport", "cbb").in("game_id", batch).not("locked_at", "is", null);
    if (error) throw new Error(`CBB locked fixture lookup failed: ${error.message}`);
    for (const row of data ?? []) lockedDbIds.add(Number(row.game_id));
  }
  // CBB's member lock lives in its single-writer snapshot, not in the
  // legacy prediction_records table. The fixture seeder must honor it too.
  for (const batch of chunks(externalIds, 100)) {
    const keys = batch.map(id => `cbb::member-game::${id}`);
    const { data, error } = await supabase.from("lab_response_snapshots")
      .select("snapshot_key,payload").in("snapshot_key", keys);
    if (error) throw new Error(`CBB member lock lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      const externalId = Number(String(row.snapshot_key).split("::").at(-1));
      const payload = row.payload as { snapshot?: { gameId?: number; lockedAt?: string | null; startsAt?:string };
        memberGame?:{homeTeamDisplayName?:string;awayTeamDisplayName?:string;gameStartAt?:string;lockedAt?:string|null} } | null;
      if (!Number.isSafeInteger(externalId) || payload?.snapshot?.gameId !== externalId) {
        throw new Error("CBB member lock receipt has inconsistent identity");
      }
      if (payload.snapshot.lockedAt) {
        const prior = existingById.get(externalId);
        if (!prior) throw new Error(`CBB locked member game ${externalId} has no canonical fixture`);
        lockedDbIds.add(prior.id);
        const member=payload.memberGame;
        if(member?.homeTeamDisplayName&&member.awayTeamDisplayName&&member.gameStartAt
          &&Date.parse(member.lockedAt??"")===Date.parse(payload.snapshot.lockedAt)
          &&Date.parse(member.gameStartAt)===Date.parse(payload.snapshot.startsAt??"")) {
          lockedMemberIdentities.set(prior.id,{home:member.homeTeamDisplayName,away:member.awayTeamDisplayName,start:member.gameStartAt});
        }
      }
    }
  }
  const terminalUpdates: Array<{ previous:CbbExistingFixture; values:NonNullable<ReturnType<typeof cbbLockedTerminalScore>> }> = [];
  const payloads = games.map(game => {
    const homeDbId = teamDbIds.get(game.home_team.id), awayDbId = teamDbIds.get(game.visitor_team.id);
    if (!homeDbId || !awayDbId) throw new Error("CBB seed lost an exact team ID");
    const payload = cbbCanonicalGamePayload(game, homeDbId, awayDbId);
    const previous = existingById.get(game.id);
    if(previous&&lockedDbIds.has(previous.id)&&cbbFixtureIdentityWouldChange(previous,payload)){
      const member=lockedMemberIdentities.get(previous.id);
      const originalHome=[...teams.values()].find(team=>teamDbIds.get(team.id)===previous.home_team_id);
      const originalAway=[...teams.values()].find(team=>teamDbIds.get(team.id)===previous.away_team_id);
      const memberIdentityVerified=member&&Date.parse(member.start)===Date.parse(previous.game_date)
        &&member.home===originalHome?.full_name&&member.away===originalAway?.full_name;
      const terminal = memberIdentityVerified?cbbLockedTerminalScore(previous,payload):null;
      if(terminal){
        terminalScoresMappedToLockedIdentity.push(game.id);
        if(previous.status!=="STATUS_FINAL")terminalUpdates.push({previous,values:terminal});
        return null;
      }
      // Keep the exact public fixture and lock. Report the source conflict,
      // but do not let one changed provider row stop every other game.
      preservedLockedConflicts.push(game.id);
      return null;
    }
    assertCbbFixtureRefreshSafe(previous, payload, previous ? lockedDbIds.has(previous.id) : false);
    return payload;
  });
  for(const update of terminalUpdates){
    const {data,error}=await supabase.from("games").update(update.values)
      .eq("id",update.previous.id).eq("sport","cbb").eq("external_id",update.previous.external_id!)
      .eq("game_date",update.previous.game_date).eq("home_team_id",update.previous.home_team_id!)
      .eq("away_team_id",update.previous.away_team_id!).eq("status",update.previous.status)
      .select("id").maybeSingle();
    if(error||!data)throw new Error(`CBB terminal result continuity failed: ${error?.message??"fixture changed during refresh"}`);
  }
  for (const batch of chunks(payloads.filter((row):row is NonNullable<typeof row>=>row!==null), 100)) {
    const { error } = await supabase.from("games").upsert(batch, { onConflict: "sport,external_id" });
    if (error) throw new Error(`CBB game seed failed: ${error.message}`);
  }
  return { ...result, written: true };
}
