/**
 * Phase 7L Phase 1 — NHL games + teams seeding service.
 *
 * Pulls schedule from the NHL public API and upserts `teams` rows
 * (sport='nhl') + `games` rows (sport='nhl') for the requested
 * slate. Mirrors the shape of seedNbaGamesService — same logger /
 * confirmBeforeWrite contract.
 *
 * ET sports-day for slate_date via computeSlateDate("nhl"). Late
 * tips (8 PM ET → 00:00–02:00 UTC the next day) file under the
 * correct ET slate.
 *
 * Scope:
 *   • Writes: teams (sport='nhl'), games (sport='nhl').
 *   • Reads:  NHL public API /v1/schedule/{date}, our teams table.
 *   • Idempotent via upsert(onConflict: "sport,external_id").
 *   • NEVER writes any MLB or NBA row.
 */

import { supabase } from "../../db/supabase";
import {
  fetchNhlScheduleForDate,
  type CanonicalNhlEvent,
  type NhlEventTeam,
} from "../../providers/nhl/_nhlApiClient";
import { computeSlateDate } from "../../dates/slateDate";

export type SeedNhlGamesOptions = {
  /** false = perform DB writes; true = dry-run (read-only). */
  dryRun: boolean;
  /** ET sports-day in YYYY-MM-DD. Default = today (ET). */
  slateDate?: string;
  /** Sink for human-readable progress lines. Default no-op. */
  logger?: (msg: string) => void;
  /** Optional pre-write confirmation (operator interactive prompt). */
  confirmBeforeWrite?: (events: CanonicalNhlEvent[]) => Promise<boolean>;
};

export type SeedNhlGamesResult = {
  mode: "dry-run" | "write" | "cancelled" | "no-events";
  slateDate: string;
  eventsFound: number;
  teamsAttempted: number;
  teamsUpserted: number;
  gamesAttempted: number;
  gamesUpserted: number;
  gamesSkippedMissingTeam: number;
  errors: string[];
};

type TeamRow = { id: number; external_id: number; sport: string; abbreviation: string };

function teamRowPayload(team: NhlEventTeam) {
  return {
    external_id: team.nhl_team_id,
    sport: "nhl",
    slug: team.abbreviation.toLowerCase(),
    abbreviation: team.abbreviation,
    display_name: team.abbreviation,           // backfill from NHL API name endpoint later
    short_display_name: team.abbreviation,
    name: team.abbreviation,
    location: "",
    league: null,
    division: null,
    logo_url: null,
    primary_color: null,
    provider_ids: { nhl: { id: String(team.nhl_team_id), abbrev: team.abbreviation } },
  };
}

async function upsertTeam(
  team: NhlEventTeam,
  dryRun: boolean,
  log: (m: string) => void,
  errors: string[],
): Promise<TeamRow | null> {
  const payload = teamRowPayload(team);
  if (dryRun) {
    log(`  [dry-run] upsert team: ext=${payload.external_id} abbr=${payload.abbreviation}`);
    const { data } = await supabase
      .from("teams")
      .select("id, external_id, sport, abbreviation")
      .eq("sport", "nhl")
      .eq("external_id", payload.external_id)
      .maybeSingle();
    return (data as TeamRow | null) ?? null;
  }
  const { data, error } = await supabase
    .from("teams")
    .upsert(payload, { onConflict: "sport,external_id" })
    .select("id, external_id, sport, abbreviation")
    .single();
  if (error) {
    const msg = `  ✗ upsert team failed: ${error.message}`;
    log(msg); errors.push(msg);
    return null;
  }
  return data as TeamRow;
}

function gameRowPayload(
  event: CanonicalNhlEvent,
  homeTeamId: number | null,
  awayTeamId: number | null,
): Record<string, unknown> {
  // Season convention: NHL API reports e.g. 20252026; for our games.season
  // we store the END year (2026) to match how NBA stores end-year postseason.
  const apiSeason = event.season;
  const endYear = Number.parseInt(String(apiSeason).slice(4, 8), 10);
  const seasonType =
    event.game_type === 3 ? "postseason"
    : event.game_type === 2 ? "regular"
    : "preseason";
  // Series context is NOT persisted on the games row (no sport_specific
  // column on `games`). It's re-fetched from NHL API by the feature
  // snapshot at prediction time — small, fast, always current.
  return {
    external_id: Number.parseInt(event.nhl_game_id, 10),
    sport: "nhl",
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    home_pitcher_id: null,
    away_pitcher_id: null,
    ballpark_id: null,
    game_date: event.start_time,
    slate_date: computeSlateDate("nhl", event.start_time),
    season: endYear,
    season_type: seasonType,
    postseason: event.game_type === 3,
    status: event.game_state,
    home_score: event.home.score,
    away_score: event.away.score,
    home_hits: null, away_hits: null,
    home_errors: null, away_errors: null,
    total_runs: null,
    inning_scores: null,
    first_inning_runs: null,
    venue: event.venue_name,
    attendance: null,
  };
}

async function upsertGame(
  event: CanonicalNhlEvent,
  homeTeamId: number | null,
  awayTeamId: number | null,
  dryRun: boolean,
  log: (m: string) => void,
  errors: string[],
): Promise<"upserted" | "skipped" | "failed" | "dry-run"> {
  const payload = gameRowPayload(event, homeTeamId, awayTeamId);
  const tag = `${event.away.abbreviation}@${event.home.abbreviation} (ext=${payload.external_id})`;
  if (dryRun) {
    log(`  [dry-run] upsert game: ${tag} state=${event.game_state} score=${event.away.score}-${event.home.score}`);
    return "dry-run";
  }
  if (homeTeamId === null || awayTeamId === null) {
    log(`  ⏭ skip game ${tag}: team rows not present`);
    return "skipped";
  }
  const { error } = await supabase
    .from("games")
    .upsert(payload, { onConflict: "sport,external_id" });
  if (error) {
    const msg = `  ✗ upsert game ${tag} failed: ${error.message}`;
    log(msg); errors.push(msg);
    return "failed";
  }
  log(`  ✓ upserted game ${tag}`);
  return "upserted";
}

/**
 * Seed NHL teams + games for the requested ET sports-day.
 */
export async function seedNhlGames(
  opts: SeedNhlGamesOptions,
): Promise<SeedNhlGamesResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];
  const slateDate = opts.slateDate ?? computeSlateDate("nhl", new Date());

  const events = await fetchNhlScheduleForDate(slateDate);
  log(`NHL schedule ${slateDate}: ${events.length} event(s)`);
  if (events.length === 0) {
    log("(no NHL events scheduled today; nothing to do)");
    return {
      mode: "no-events", slateDate, eventsFound: 0,
      teamsAttempted: 0, teamsUpserted: 0,
      gamesAttempted: 0, gamesUpserted: 0, gamesSkippedMissingTeam: 0,
      errors,
    };
  }

  if (!opts.dryRun && opts.confirmBeforeWrite !== undefined) {
    const ok = await opts.confirmBeforeWrite(events);
    if (!ok) {
      log("Cancelled. No writes performed.");
      return {
        mode: "cancelled", slateDate, eventsFound: events.length,
        teamsAttempted: 0, teamsUpserted: 0,
        gamesAttempted: 0, gamesUpserted: 0, gamesSkippedMissingTeam: 0,
        errors,
      };
    }
  }

  const teamsByApiId = new Map<number, NhlEventTeam>();
  for (const e of events) {
    teamsByApiId.set(e.home.nhl_team_id, e.home);
    teamsByApiId.set(e.away.nhl_team_id, e.away);
  }
  log(`\nUpserting ${teamsByApiId.size} distinct NHL team(s)…`);
  const teamRowByExternalId = new Map<number, TeamRow>();
  let teamsUpserted = 0;
  for (const t of teamsByApiId.values()) {
    const row = await upsertTeam(t, opts.dryRun, log, errors);
    if (row !== null) {
      teamRowByExternalId.set(row.external_id, row);
      teamsUpserted += 1;
    }
  }

  log(`\nUpserting ${events.length} NHL game(s)…`);
  let gamesUpserted = 0;
  let gamesSkippedMissingTeam = 0;
  for (const e of events) {
    const homeRow = teamRowByExternalId.get(e.home.nhl_team_id) ?? null;
    const awayRow = teamRowByExternalId.get(e.away.nhl_team_id) ?? null;
    const outcome = await upsertGame(e, homeRow?.id ?? null, awayRow?.id ?? null, opts.dryRun, log, errors);
    if (outcome === "upserted") gamesUpserted += 1;
    else if (outcome === "skipped") gamesSkippedMissingTeam += 1;
  }

  return {
    mode: opts.dryRun ? "dry-run" : "write",
    slateDate,
    eventsFound: events.length,
    teamsAttempted: teamsByApiId.size,
    teamsUpserted,
    gamesAttempted: events.length,
    gamesUpserted,
    gamesSkippedMissingTeam,
    errors,
  };
}
