/**
 * WC-4 Phase B — Soccer (FIFA World Cup) games + teams seed service.
 *
 * Mirrors the NHL/NBA pattern: pulls today's WC slate from the BDL
 * FIFA matches endpoint and upserts `teams` (sport='soccer') + `games`
 * (sport='soccer') rows for the requested ET sports-day. Idempotent
 * via upsert(onConflict: "sport,external_id") on both tables.
 *
 * Slate-date semantics:
 *   • The FIFA WC schedule is in UTC.
 *   • Our `slate_date` convention is ET (consistent with MLB/NBA/NHL).
 *   • Matches kicking off 00:00–05:59 UTC the next calendar day file
 *     under the ET sports-day that contains the late evening.
 *
 * Scope:
 *   • Writes: teams (sport='soccer'), games (sport='soccer').
 *   • Reads:  BDL FIFA `/matches` endpoint, our teams table.
 *   • NEVER writes any MLB / NBA / NHL row.
 *   • No prediction_records writes here — those live in the WC-3
 *     writer (Phase C).
 *   • No logos, no team colors persisted yet — Phase E UI handles
 *     missing assets gracefully.
 *
 * Tracked-market scope is enforced downstream by the WC-3 writer; the
 * seed only puts fixtures in the games table.
 */

import { supabase } from "../../db/supabase";
import {
  BallDontLieFifaProvider,
  type NormalizedBdlMatch,
} from "../../providers/real_api/BallDontLieFifaProvider";
import { BdlFifaClient } from "../../providers/real_api/_bdlFifaClient";

export type SeedSoccerGamesOptions = {
  /** false = perform DB writes; true = dry-run (read-only). */
  dryRun: boolean;
  /** ET sports-day in YYYY-MM-DD. Default = today (UTC). */
  slateDate?: string;
  /** Inject a pre-built provider (tests). Default = new client from BALLDONTLIE_API_KEY. */
  provider?: BallDontLieFifaProvider;
  /** Sink for human-readable progress lines. Default no-op. */
  logger?: (msg: string) => void;
};

export type SeedSoccerGamesResult = {
  mode: "dry-run" | "write" | "no-events";
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

/**
 * BDL FIFA returns UTC datetimes. We file each fixture under the ET
 * sports-day that contains its kickoff (America/New_York). This honors
 * the header-doc convention: matches kicking off 00:00–05:59 UTC the
 * NEXT calendar day belong to the previous evening's ET sports-day
 * (a 02:00 UTC kickoff = 10 PM ET the prior evening). Intl handles DST
 * correctly.
 *
 * Prior implementation compared the UTC date prefix, which silently
 * dropped late-night ET fixtures (e.g., the 2026 FIFA WC matchday-1
 * 10 PM ET game CZE@KOR was filed under the next UTC day and missed
 * from today's slate). That bug is fixed here.
 */
function matchOnSlateDate(m: NormalizedBdlMatch, slateDate: string): boolean {
  const etYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(m.datetime));
  return etYmd === slateDate;
}

function teamRowPayload(team: {
  provider_team_id: number;
  name: string;
  abbreviation: string;
  country_code: string;
}) {
  return {
    external_id: team.provider_team_id,
    sport: "soccer",
    slug: team.abbreviation.toLowerCase(),
    abbreviation: team.abbreviation,
    display_name: team.name,
    short_display_name: team.abbreviation,
    name: team.name,
    location: team.country_code,
    league: "fifa_world_cup",
    division: null,
    logo_url: null,
    primary_color: null,
    provider_ids: {
      bdl_fifa: {
        id: String(team.provider_team_id),
        abbr: team.abbreviation,
        country_code: team.country_code,
      },
    },
  };
}

async function upsertTeam(
  team: {
    provider_team_id: number;
    name: string;
    abbreviation: string;
    country_code: string;
  },
  dryRun: boolean,
  log: (m: string) => void,
  errors: string[],
): Promise<TeamRow | null> {
  const payload = teamRowPayload(team);
  if (dryRun) {
    log(`  [dry-run] upsert team: ext=${payload.external_id} abbr=${payload.abbreviation} (${team.name})`);
    const { data } = await supabase
      .from("teams")
      .select("id, external_id, sport, abbreviation")
      .eq("sport", "soccer")
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
    log(msg);
    errors.push(msg);
    return null;
  }
  return data as TeamRow;
}

function deriveSeasonType(stageName: string | null): string {
  if (stageName === null) return "regular";
  const normalized = stageName.toLowerCase();
  if (normalized.includes("group")) return "regular";
  // Round of 32 / 16 / quarter / semi / final / 3rd place.
  return "postseason";
}

function gameRowPayload(
  m: NormalizedBdlMatch,
  slateDate: string,
  homeTeamId: number | null,
  awayTeamId: number | null,
): Record<string, unknown> {
  const seasonYear = m.raw_row.season?.year ?? new Date(m.datetime).getUTCFullYear();
  const seasonType = deriveSeasonType(m.stage_name);
  const isPostseason = seasonType === "postseason";
  return {
    external_id: m.provider_match_id,
    sport: "soccer",
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    home_pitcher_id: null,
    away_pitcher_id: null,
    ballpark_id: null,
    game_date: m.datetime,
    slate_date: slateDate,
    season: seasonYear,
    season_type: seasonType,
    postseason: isPostseason,
    status: m.status,
    home_score: m.ft_home_score,
    away_score: m.ft_away_score,
    home_hits: null,
    away_hits: null,
    home_errors: null,
    away_errors: null,
    total_runs: null,
    inning_scores: null,
    first_inning_runs: null,
    venue: m.stadium_name,
    attendance: null,
  };
}

async function upsertGame(
  m: NormalizedBdlMatch,
  slateDate: string,
  homeTeamId: number | null,
  awayTeamId: number | null,
  dryRun: boolean,
  log: (msg: string) => void,
  errors: string[],
): Promise<"upserted" | "skipped" | "failed" | "dry-run"> {
  const payload = gameRowPayload(m, slateDate, homeTeamId, awayTeamId);
  const tag = `${m.away_team_abbr}@${m.home_team_abbr} (bdl=${m.provider_match_id})`;
  if (dryRun) {
    log(`  [dry-run] upsert game: ${tag} status=${m.status} kickoff=${m.datetime} stage="${m.stage_name ?? ""}"`);
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
    log(msg);
    errors.push(msg);
    return "failed";
  }
  log(`  ✓ upserted game ${tag}`);
  return "upserted";
}

/**
 * Seed soccer (FIFA WC) teams + games for the requested slate date.
 *
 * BDL's `/matches` endpoint returns the whole WC tournament (104
 * fixtures). We filter to the requested date in this function and
 * upsert only matching fixtures.
 */
export async function seedSoccerGames(
  opts: SeedSoccerGamesOptions,
): Promise<SeedSoccerGamesResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];
  const slateDate = opts.slateDate ?? new Date().toISOString().split("T")[0];

  const provider = opts.provider ?? (() => {
    const bdlKey = process.env.BALLDONTLIE_API_KEY;
    if (bdlKey === undefined || bdlKey === "") {
      throw new Error("BALLDONTLIE_API_KEY missing from env");
    }
    return new BallDontLieFifaProvider(new BdlFifaClient(bdlKey));
  })();

  log(`Fetching BDL FIFA tournament fixtures…`);
  const allMatches = await provider.listMatches({ per_page: 25 });
  log(`  total fixtures returned: ${allMatches.length}`);

  const matches = allMatches.filter((m) => matchOnSlateDate(m, slateDate));
  log(`  fixtures on ${slateDate}: ${matches.length}`);
  if (matches.length === 0) {
    log("(no WC fixtures on this slate date; nothing to do)");
    return {
      mode: "no-events",
      slateDate,
      eventsFound: 0,
      teamsAttempted: 0,
      teamsUpserted: 0,
      gamesAttempted: 0,
      gamesUpserted: 0,
      gamesSkippedMissingTeam: 0,
      errors,
    };
  }

  // Collect distinct teams across these fixtures.
  const teamsByApiId = new Map<
    number,
    { provider_team_id: number; name: string; abbreviation: string; country_code: string }
  >();
  for (const m of matches) {
    teamsByApiId.set(m.home_team_id, {
      provider_team_id: m.home_team_id,
      name: m.home_team_name,
      abbreviation: m.home_team_abbr,
      country_code: m.home_team_country_code,
    });
    teamsByApiId.set(m.away_team_id, {
      provider_team_id: m.away_team_id,
      name: m.away_team_name,
      abbreviation: m.away_team_abbr,
      country_code: m.away_team_country_code,
    });
  }
  log(`\nUpserting ${teamsByApiId.size} distinct WC team(s)…`);
  const teamRowByExternalId = new Map<number, TeamRow>();
  let teamsUpserted = 0;
  for (const t of teamsByApiId.values()) {
    const row = await upsertTeam(t, opts.dryRun, log, errors);
    if (row !== null) {
      teamRowByExternalId.set(row.external_id, row);
      teamsUpserted += 1;
    }
  }

  log(`\nUpserting ${matches.length} WC game(s)…`);
  let gamesUpserted = 0;
  let gamesSkippedMissingTeam = 0;
  for (const m of matches) {
    const homeRow = teamRowByExternalId.get(m.home_team_id) ?? null;
    const awayRow = teamRowByExternalId.get(m.away_team_id) ?? null;
    const outcome = await upsertGame(
      m,
      slateDate,
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
    slateDate,
    eventsFound: matches.length,
    teamsAttempted: teamsByApiId.size,
    teamsUpserted,
    gamesAttempted: matches.length,
    gamesUpserted,
    gamesSkippedMissingTeam,
    errors,
  };
}
