/**
 * Phase 7B.1 — NBA Finals seeding operator.
 *
 * Real, automated, idempotent. Pulls today's NBA scoreboard from ESPN
 * (public, no auth) and upserts:
 *   • `teams` rows (sport='nba') for the home + away team of every
 *     visible event in the scoreboard payload. Uses ESPN's team id as
 *     `external_id` since BDL free tier teams endpoint also works but
 *     ESPN is what gives us schedule + series context together.
 *   • `games` rows (sport='nba') for the scoreboard event(s). Includes
 *     start_time, status, scores, season=2026, season_type='postseason',
 *     postseason=true (when the event has a postseason note).
 *   • Optionally also seeds prior Finals games via `--include-prior-games <N>`
 *     so the series-context deriver has the prior-game scores it needs.
 *     We re-fetch ESPN's scoreboard for each prior date in turn (with
 *     small sleeps to be a good citizen). This is the only way to get
 *     Finals G1/G2 scores from a free public source without BDL Pro.
 *
 * Two-key write gate:
 *   • CLI flag: --apply
 *   • Env var:  NBA_DB_WRITES_ENABLED=true
 * Default: DRY-RUN. Operator-only; not wired into any cron.
 *
 * Scope:
 *   • Reads:  ESPN public scoreboard / teams endpoint, our `teams`,
 *             `games` tables (existence checks).
 *   • Writes: `teams` (sport='nba'), `games` (sport='nba').
 *             NEVER writes any MLB row. NEVER writes prediction_records /
 *             tracking / lines / nba_team_ratings.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { supabase } from "../../../lib/db/supabase";
import {
  fetchNbaScoreboard,
  type CanonicalNbaEvent,
  type NbaEventTeam,
} from "../../../lib/providers/real_api/_espnNbaScoreboardClient";
import { computeSlateDate } from "../../../lib/dates/slateDate";
import { readBoolFlag, readStringFlag } from "../_cliCommon";

const NBA_DB_WRITES_ENV = "NBA_DB_WRITES_ENABLED";

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
  // We populate the minimum required columns. `slug` and
  // `short_display_name` derive from ESPN fields; `name` is the
  // mascot-only short_name; `location` is the city.
  return {
    external_id: Number.parseInt(team.espn_team_id, 10),
    sport: "nba",
    slug: team.abbreviation.toLowerCase(),
    abbreviation: team.abbreviation,
    display_name: team.display_name,
    short_display_name: team.short_name ?? team.display_name,
    name: team.short_name ?? team.display_name,
    location: team.location ?? "",
    league: null,    // ESPN doesn't expose conference cleanly via scoreboard
    division: null,
    logo_url: null,
    primary_color: null,
    provider_ids: { espn: { id: team.espn_team_id } },
  };
}

async function upsertNbaTeam(team: NbaEventTeam, write: boolean): Promise<TeamRow | null> {
  const payload = teamRowPayloadFromEspn(team);
  if (!write) {
    console.log(
      `  [dry-run] upsert team: ext=${payload.external_id} abbr=${payload.abbreviation} name="${payload.display_name}"`,
    );
    // Try to return existing row if any so downstream upsertGame can
    // dry-run game inserts properly.
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
    console.log(`  ✗ upsert team failed: ${error.message}`);
    return null;
  }
  return data as TeamRow;
}

function gameRowPayloadFromEspn(
  event: CanonicalNbaEvent,
  homeTeamId: number | null,
  awayTeamId: number | null,
): Record<string, unknown> {
  // Season: ESPN doesn't always expose this, but for the Finals it's
  // the year of the championship (2026 series = 2026 season for our
  // postseason aggregation). We default to the year part of the start
  // date.
  const season = Number.parseInt(event.start_time.slice(0, 4), 10);
  const postseason = event.postseason_note !== null;
  return {
    external_id: Number.parseInt(event.espn_event_id, 10),
    sport: "nba",
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    home_pitcher_id: null,  // MLB-specific; null for NBA
    away_pitcher_id: null,
    ballpark_id: null,
    game_date: event.start_time,
    // Phase 7H — use ET sports-day for slate_date, matching the rest of
    // the NBA pipeline (buildNbaDailyEdgePipeline, prediction_records,
    // tracking-refresh cron). A late tip like 8:30 PM ET is 00:30 UTC
    // the NEXT day; UTC-date slicing would file it under the wrong
    // slate and the cron would never grade the matching prediction
    // records. computeSlateDate is the single source of truth used by
    // MLB ingest too — sport-aware via the SPORT_TIMEZONE map.
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

async function upsertNbaGame(
  event: CanonicalNbaEvent,
  homeTeamId: number | null,
  awayTeamId: number | null,
  write: boolean,
): Promise<void> {
  const payload = gameRowPayloadFromEspn(event, homeTeamId, awayTeamId);
  const tag = `${event.away.abbreviation}@${event.home.abbreviation} (ext=${payload.external_id})`;
  if (!write) {
    console.log(
      `  [dry-run] upsert game: ${tag} status=${payload.status} score=${event.away.score}-${event.home.score}`,
    );
    return;
  }
  if (homeTeamId === null || awayTeamId === null) {
    console.log(`  ⏭ skip game ${tag}: team rows not present (home_team_id or away_team_id null)`);
    return;
  }
  const { error } = await supabase
    .from("games")
    .upsert(payload, { onConflict: "sport,external_id" });
  if (error) {
    console.log(`  ✗ upsert game ${tag} failed: ${error.message}`);
    return;
  }
  console.log(`  ✓ upserted game ${tag}`);
}

async function confirmApply(events: CanonicalNbaEvent[]): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const lines = events
      .map(
        (e) =>
          `    • ${e.away.abbreviation}@${e.home.abbreviation}  ` +
          `start=${e.start_time}  status=${e.status_label}  ` +
          `${e.postseason_note ?? ""}`,
      )
      .join("\n");
    const ans = await rl.question(
      `\nAbout to upsert NBA teams + games into DB (sport='nba'):\n${lines}\n\n` +
        `  Two-key gate: --apply + ${NBA_DB_WRITES_ENV}=true.\n` +
        `  Idempotent: re-running produces identical state.\n` +
        `  NEVER writes MLB rows; NEVER writes ratings/lines/predictions.\n` +
        `\n  Continue? [y/N]: `,
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = readBoolFlag(argv, "--apply");
  const dateOverride = readStringFlag(argv, "--date");      // YYYYMMDD for ESPN
  const includePriorDays = Number.parseInt(
    readStringFlag(argv, "--include-prior-days") ?? "0",
    10,
  );
  const skipPrompt = readBoolFlag(argv, "--yes");

  let write = false;
  if (apply) {
    if (process.env[NBA_DB_WRITES_ENV] !== "true") {
      console.error(
        `✗ --apply requires ${NBA_DB_WRITES_ENV}=true in the env (two-key gate).`,
      );
      process.exit(1);
    }
    write = true;
  }

  console.log(
    `[nba-seed-finals] mode=${write ? "WRITE" : "DRY-RUN"}  date_override=${dateOverride ?? "today"}  prior_days=${includePriorDays}`,
  );
  console.log("─".repeat(70));

  // Pull primary scoreboard.
  const primaryEvents = await fetchNbaScoreboard(
    dateOverride ? { dateYYYYMMDD: dateOverride } : undefined,
  );
  console.log(`Today scoreboard: ${primaryEvents.length} event(s)`);
  if (primaryEvents.length === 0) {
    console.log("(no NBA events visible from ESPN today; nothing to do)");
    return;
  }

  // Optional: pull prior days' scoreboards for series context (G1/G2).
  // We iterate backwards day-by-day, stopping after includePriorDays.
  const priorEvents: CanonicalNbaEvent[] = [];
  if (includePriorDays > 0) {
    const base = dateOverride ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const baseDate = new Date(`${base.slice(0, 4)}-${base.slice(4, 6)}-${base.slice(6, 8)}T12:00:00Z`);
    for (let i = 1; i <= includePriorDays; i++) {
      const d = new Date(baseDate.getTime() - i * 24 * 60 * 60 * 1000);
      const dStr = d.toISOString().slice(0, 10).replace(/-/g, "");
      const e = await fetchNbaScoreboard({ dateYYYYMMDD: dStr });
      console.log(`Prior date ${dStr}: ${e.length} event(s)`);
      priorEvents.push(...e);
      await new Promise<void>((r) => setTimeout(r, 400)); // gentle pace on ESPN
    }
  }

  const allEvents = [...primaryEvents, ...priorEvents];
  // Deduplicate by espn_event_id (just in case prior/primary overlap).
  const eventsById = new Map<string, CanonicalNbaEvent>();
  for (const e of allEvents) eventsById.set(e.espn_event_id, e);
  const events = [...eventsById.values()];
  console.log(`Total unique events to consider: ${events.length}`);

  if (write && !skipPrompt) {
    const ok = await confirmApply(events);
    if (!ok) {
      console.log("Cancelled. No writes performed.");
      return;
    }
  }

  // Upsert distinct teams first.
  const teamsByEspnId = new Map<string, NbaEventTeam>();
  for (const e of events) {
    teamsByEspnId.set(e.home.espn_team_id, e.home);
    teamsByEspnId.set(e.away.espn_team_id, e.away);
  }
  console.log(`\nUpserting ${teamsByEspnId.size} distinct NBA team(s)…`);
  const teamRowByExternalId = new Map<number, TeamRow>();
  for (const t of teamsByEspnId.values()) {
    const row = await upsertNbaTeam(t, write);
    if (row !== null) {
      teamRowByExternalId.set(row.external_id, row);
    }
  }

  // Upsert games — resolve team_ids from the teams we just upserted.
  console.log(`\nUpserting ${events.length} NBA game(s)…`);
  for (const e of events) {
    const homeExt = Number.parseInt(e.home.espn_team_id, 10);
    const awayExt = Number.parseInt(e.away.espn_team_id, 10);
    const homeRow = teamRowByExternalId.get(homeExt) ?? null;
    const awayRow = teamRowByExternalId.get(awayExt) ?? null;
    await upsertNbaGame(e, homeRow?.id ?? null, awayRow?.id ?? null, write);
  }

  console.log("\n─".repeat(70));
  console.log(write ? "WRITE complete." : "DRY-RUN complete (no DB writes).");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
