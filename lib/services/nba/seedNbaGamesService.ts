/**
 * Phase 7K Service 1 — NBA games + teams seeding service.
 *
 * Extracted from scripts/operator/nba/seed-nba-finals.ts so the same
 * core flow can be driven by:
 *   • The operator CLI wrapper (interactive --apply prompt, two-key gate).
 *   • The future /api/cron/nba-daily-refresh route (non-interactive,
 *     gated by CRON_SECRET + a route-level env flag).
 *
 * Behavior preserved byte-for-byte from the pre-7K operator:
 *   • Pulls today's NBA scoreboard from ESPN (public, no auth).
 *   • Optionally pulls prior days' scoreboards for series-context backfill.
 *   • Upserts `teams` rows (sport='nba') and `games` rows (sport='nba')
 *     with the SAME payload shape — slate_date via computeSlateDate("nba")
 *     for the ET sports-day fix.
 *   • Idempotent: re-running produces identical state.
 *   • NEVER touches MLB rows. NEVER writes prediction_records / tracking /
 *     lines / nba_team_ratings.
 *
 * Service contract (vs. CLI wrapper):
 *   • NO process.argv, process.exit, or readline.
 *   • NO env-flag check (the operator's NBA_DB_WRITES_ENABLED two-key gate
 *     stays in the wrapper; the cron route will have its own gate).
 *   • Logging is delivered via an optional `logger` callback so callers
 *     can route output to console (operator) or data_refresh_log (cron).
 *   • An optional `confirmBeforeWrite` hook lets the operator inject its
 *     interactive y/N prompt. Cron callers omit it and writes proceed
 *     once `dryRun: false`.
 */

import { supabase } from "../../db/supabase";
import {
  fetchNbaScoreboard,
  type CanonicalNbaEvent,
  type NbaEventTeam,
} from "../../providers/real_api/_espnNbaScoreboardClient";
import { computeSlateDate } from "../../dates/slateDate";

export type SeedNbaGamesOptions = {
  /** false = perform DB upserts; true = dry-run (read-only). */
  dryRun: boolean;
  /** ESPN-format YYYYMMDD override; default = ESPN's "today". */
  dateOverride?: string;
  /**
   * Number of prior calendar days to also fetch for series-context
   * backfill (Finals G1/G2 scores). Default 0. Iterates backwards from
   * `dateOverride` (or today) with a small sleep between requests.
   */
  includePriorDays?: number;
  /**
   * Sink for human-readable progress lines. Operator wrapper passes
   * `console.log`; cron passes a structured logger (or omits). When
   * omitted, the service runs silent.
   */
  logger?: (msg: string) => void;
  /**
   * Optional pre-write hook called once with the deduplicated event
   * list, ONLY when `dryRun: false`. If it resolves false, no writes
   * happen and the service returns mode="cancelled".
   *   • Operator wrapper: passes its interactive readline prompt.
   *   • Cron: omits → writes proceed.
   */
  confirmBeforeWrite?: (events: CanonicalNbaEvent[]) => Promise<boolean>;
};

export type SeedNbaGamesResult = {
  /** Resolved execution mode. "no-events" short-circuits before any write. */
  mode: "dry-run" | "write" | "cancelled" | "no-events";
  /** Events returned by the primary (today / dateOverride) scoreboard call. */
  primaryEventsFound: number;
  /** Sum of events across the includePriorDays scoreboard calls. */
  priorEventsFound: number;
  /** Unique events after deduping by espn_event_id. */
  uniqueEvents: number;
  /** Distinct teams the service tried to upsert (both home + away). */
  teamsAttempted: number;
  /** Distinct teams the service successfully upserted (or matched in dry-run). */
  teamsUpserted: number;
  /** Games the service tried to upsert. */
  gamesAttempted: number;
  /** Games the service successfully upserted (write mode only). */
  gamesUpserted: number;
  /** Games skipped because a team_id couldn't be resolved (write mode). */
  gamesSkippedMissingTeam: number;
  /** Per-row error messages from Supabase failures. */
  errors: string[];
};

type TeamRow = {
  id: number;
  external_id: number;
  sport: string;
  abbreviation: string;
};

function espnStatusToOurs(espnStatus: string): string {
  // ESPN: STATUS_SCHEDULED / STATUS_IN_PROGRESS / STATUS_FINAL / STATUS_POSTPONED
  // Our games.status column already uses this exact format (set by BDL
  // for MLB), so passthrough is correct.
  return espnStatus;
}

function teamRowPayloadFromEspn(team: NbaEventTeam) {
  return {
    external_id: Number.parseInt(team.espn_team_id, 10),
    sport: "nba",
    slug: team.abbreviation.toLowerCase(),
    abbreviation: team.abbreviation,
    display_name: team.display_name,
    short_display_name: team.short_name ?? team.display_name,
    name: team.short_name ?? team.display_name,
    location: team.location ?? "",
    league: null,
    division: null,
    logo_url: null,
    primary_color: null,
    provider_ids: { espn: { id: team.espn_team_id } },
  };
}

function gameRowPayloadFromEspn(
  event: CanonicalNbaEvent,
  homeTeamId: number | null,
  awayTeamId: number | null,
): Record<string, unknown> {
  const season = Number.parseInt(event.start_time.slice(0, 4), 10);
  const postseason = event.postseason_note !== null;
  return {
    external_id: Number.parseInt(event.espn_event_id, 10),
    sport: "nba",
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    home_pitcher_id: null,
    away_pitcher_id: null,
    ballpark_id: null,
    game_date: event.start_time,
    // ET sports-day, matching buildNbaDailyEdgePipeline / prediction_records /
    // tracking-refresh. Late tips would file under the wrong UTC slate.
    slate_date: computeSlateDate("nba", event.start_time),
    season,
    season_type: postseason ? "postseason" : "regular",
    postseason,
    status: espnStatusToOurs(event.status),
    home_score: event.home.score,
    away_score: event.away.score,
    home_hits: null,
    away_hits: null,
    home_errors: null,
    away_errors: null,
    total_runs: null,
    inning_scores: null,
    first_inning_runs: null,
    venue: event.venue_name,
    attendance: null,
  };
}

async function upsertNbaTeam(
  team: NbaEventTeam,
  dryRun: boolean,
  log: (msg: string) => void,
  errors: string[],
): Promise<TeamRow | null> {
  const payload = teamRowPayloadFromEspn(team);
  if (dryRun) {
    log(
      `  [dry-run] upsert team: ext=${payload.external_id} abbr=${payload.abbreviation} name="${payload.display_name}"`,
    );
    const { data: existing } = await supabase
      .from("teams")
      .select("id, external_id, sport, abbreviation")
      .eq("sport", "nba")
      .eq("external_id", payload.external_id)
      .maybeSingle();
    return (existing as TeamRow | null) ?? null;
  }
  const { data, error } = await supabase
    .from("teams")
    .upsert(payload, { onConflict: "sport,external_id" })
    .select("id, external_id, sport, abbreviation")
    .single();
  if (error) {
    const msg = `  ✗ upsert team failed: ${error.message}`;
    log(msg);
    errors.push(msg);
    return null;
  }
  return data as TeamRow;
}

async function upsertNbaGame(
  event: CanonicalNbaEvent,
  homeTeamId: number | null,
  awayTeamId: number | null,
  dryRun: boolean,
  log: (msg: string) => void,
  errors: string[],
): Promise<"upserted" | "skipped" | "failed" | "dry-run"> {
  const payload = gameRowPayloadFromEspn(event, homeTeamId, awayTeamId);
  const tag = `${event.away.abbreviation}@${event.home.abbreviation} (ext=${payload.external_id})`;
  if (dryRun) {
    log(
      `  [dry-run] upsert game: ${tag} status=${payload.status} score=${event.away.score}-${event.home.score}`,
    );
    return "dry-run";
  }
  if (homeTeamId === null || awayTeamId === null) {
    log(`  ⏭ skip game ${tag}: team rows not present (home_team_id or away_team_id null)`);
    return "skipped";
  }
  const { error } = await supabase
    .from("games")
    .upsert(payload, { onConflict: "sport,external_id" });
  if (error) {
    const msg = `  ✗ upsert game ${tag} failed: ${error.message}`;
    log(msg);
    errors.push(msg);
    return "failed";
  }
  log(`  ✓ upserted game ${tag}`);
  return "upserted";
}

/**
 * Seed NBA teams + games for the requested slate (and optional prior
 * days) from ESPN's public scoreboard. See module docstring for the
 * service contract.
 */
export async function seedNbaGames(
  opts: SeedNbaGamesOptions,
): Promise<SeedNbaGamesResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];
  const includePriorDays = opts.includePriorDays ?? 0;

  // 1. Primary scoreboard.
  const primaryEvents = await fetchNbaScoreboard(
    opts.dateOverride ? { dateYYYYMMDD: opts.dateOverride } : undefined,
  );
  log(`Today scoreboard: ${primaryEvents.length} event(s)`);
  if (primaryEvents.length === 0) {
    log("(no NBA events visible from ESPN today; nothing to do)");
    return {
      mode: "no-events",
      primaryEventsFound: 0,
      priorEventsFound: 0,
      uniqueEvents: 0,
      teamsAttempted: 0,
      teamsUpserted: 0,
      gamesAttempted: 0,
      gamesUpserted: 0,
      gamesSkippedMissingTeam: 0,
      errors,
    };
  }

  // 2. Prior days for series context (G1/G2 backfill).
  const priorEvents: CanonicalNbaEvent[] = [];
  if (includePriorDays > 0) {
    const base =
      opts.dateOverride ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const baseDate = new Date(
      `${base.slice(0, 4)}-${base.slice(4, 6)}-${base.slice(6, 8)}T12:00:00Z`,
    );
    for (let i = 1; i <= includePriorDays; i++) {
      const d = new Date(baseDate.getTime() - i * 24 * 60 * 60 * 1000);
      const dStr = d.toISOString().slice(0, 10).replace(/-/g, "");
      const e = await fetchNbaScoreboard({ dateYYYYMMDD: dStr });
      log(`Prior date ${dStr}: ${e.length} event(s)`);
      priorEvents.push(...e);
      await new Promise<void>((r) => setTimeout(r, 400)); // gentle pace on ESPN
    }
  }

  // 3. Dedupe by espn_event_id (primary + prior may overlap).
  const allEvents = [...primaryEvents, ...priorEvents];
  const eventsById = new Map<string, CanonicalNbaEvent>();
  for (const e of allEvents) eventsById.set(e.espn_event_id, e);
  const events = [...eventsById.values()];
  log(`Total unique events to consider: ${events.length}`);

  // 4. Optional pre-write confirmation (operator interactive prompt).
  if (!opts.dryRun && opts.confirmBeforeWrite !== undefined) {
    const ok = await opts.confirmBeforeWrite(events);
    if (!ok) {
      log("Cancelled. No writes performed.");
      return {
        mode: "cancelled",
        primaryEventsFound: primaryEvents.length,
        priorEventsFound: priorEvents.length,
        uniqueEvents: events.length,
        teamsAttempted: 0,
        teamsUpserted: 0,
        gamesAttempted: 0,
        gamesUpserted: 0,
        gamesSkippedMissingTeam: 0,
        errors,
      };
    }
  }

  // 5. Upsert distinct teams.
  const teamsByEspnId = new Map<string, NbaEventTeam>();
  for (const e of events) {
    teamsByEspnId.set(e.home.espn_team_id, e.home);
    teamsByEspnId.set(e.away.espn_team_id, e.away);
  }
  log(`\nUpserting ${teamsByEspnId.size} distinct NBA team(s)…`);
  const teamRowByExternalId = new Map<number, TeamRow>();
  let teamsUpserted = 0;
  for (const t of teamsByEspnId.values()) {
    const row = await upsertNbaTeam(t, opts.dryRun, log, errors);
    if (row !== null) {
      teamRowByExternalId.set(row.external_id, row);
      teamsUpserted += 1;
    }
  }

  // 6. Upsert games — resolve team_ids from the teams we just upserted.
  log(`\nUpserting ${events.length} NBA game(s)…`);
  let gamesUpserted = 0;
  let gamesSkippedMissingTeam = 0;
  for (const e of events) {
    const homeExt = Number.parseInt(e.home.espn_team_id, 10);
    const awayExt = Number.parseInt(e.away.espn_team_id, 10);
    const homeRow = teamRowByExternalId.get(homeExt) ?? null;
    const awayRow = teamRowByExternalId.get(awayExt) ?? null;
    const outcome = await upsertNbaGame(
      e,
      homeRow?.id ?? null,
      awayRow?.id ?? null,
      opts.dryRun,
      log,
      errors,
    );
    if (outcome === "upserted") gamesUpserted += 1;
    else if (outcome === "skipped") gamesSkippedMissingTeam += 1;
  }

  return {
    mode: opts.dryRun ? "dry-run" : "write",
    primaryEventsFound: primaryEvents.length,
    priorEventsFound: priorEvents.length,
    uniqueEvents: events.length,
    teamsAttempted: teamsByEspnId.size,
    teamsUpserted,
    gamesAttempted: events.length,
    gamesUpserted,
    gamesSkippedMissingTeam,
    errors,
  };
}
