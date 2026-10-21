/**
 * Phase 7K Service 2 — NBA team ratings refresh service.
 *
 * Extracted from scripts/operator/nba/refresh-nba-team-ratings.ts so
 * the same flow can be driven by the upcoming /api/cron/nba-daily-refresh
 * route. The operator stays as a thin CLI wrapper.
 *
 * What this does (preserved byte-for-byte from the pre-7K operator):
 *   • Loads `teams` rows (sport='nba') to resolve BBR abbreviation →
 *     teams.id.
 *   • Scrapes Basketball Reference's per-possession + Four-Factor
 *     team table (allowed paths under robots.txt; honors Crawl-delay).
 *   • Optionally also pulls the playoffs table.
 *   • Builds upsert payloads filtered to teams resident in our DB.
 *   • Upserts into `nba_team_ratings` keyed on (team_id, season,
 *     season_type). Idempotent.
 *   • NEVER writes any other table.
 *
 * Service contract (vs. CLI wrapper):
 *   • NO process.exit / process.argv / process.env access.
 *   • Caller passes `season` already validated.
 *   • Caller-supplied logger; service runs silent when omitted.
 *   • Returns a typed Result with per-step counts so the cron route
 *     can log structured outcomes to data_refresh_log.
 *   • mode="no-teams" is the result-shape equivalent of the operator's
 *     hard exit when `teams` is empty — the caller decides how to
 *     react (operator: console.error + exit 1; cron: mark failed).
 */

import { supabase } from "../../db/supabase";
import {
  fetchBbrSeasonTeamRatings,
  fetchBbrPlayoffTeamRatings,
} from "../../providers/real_api/_basketballReferenceClient";
import {
  buildNbaTeamRatingPayload,
  matchBbrRatingToNbaTeam,
  NBA_TEAM_RATINGS_REFRESH_RELEASE,
  type NbaTeamRatingPayload,
  type NbaTeamRow,
} from "./nbaTeamRatingIdentity";

export {
  buildNbaTeamRatingPayload,
  NBA_TEAM_RATINGS_REFRESH_RELEASE,
  type NbaTeamRatingPayload,
  type NbaTeamRow,
} from "./nbaTeamRatingIdentity";

export type RefreshNbaTeamRatingsOptions = {
  /** 4-digit season year (e.g. 2026 for the 2025-26 season). */
  season: number;
  /** When true, also fetch BBR's playoffs table. Default false. */
  includePlayoffs?: boolean;
  /** false = perform DB upserts; true = dry-run (read-only). */
  dryRun: boolean;
  /**
   * Skip provider calls when every current NBA team already has a regular-
   * season row for this season. Used only for the immutable prior-season
   * recovery pass; the current season must continue refreshing normally.
   */
  skipFetchWhenRegularSeasonComplete?: boolean;
  /** Sink for human-readable progress lines. Default no-op. */
  logger?: (msg: string) => void;
};

export type RefreshNbaTeamRatingsResult = {
  release: typeof NBA_TEAM_RATINGS_REFRESH_RELEASE;
  mode: "dry-run" | "write" | "no-teams" | "already-complete";
  teamsInDb: number;
  seasonFetchStatus: "ok" | "failed" | "skipped";
  seasonRowsParsed: number;
  /** "skipped" when includePlayoffs=false. */
  playoffFetchStatus: "ok" | "failed" | "skipped";
  playoffRowsParsed: number;
  /** Distinct rows assembled for upsert AFTER team-row filtering. */
  payloadsBuilt: number;
  /** Rows successfully written in apply mode. 0 in dry-run. */
  written: number;
  /** Per-row error messages from Supabase failures. */
  errors: string[];
};

async function loadNbaTeams(): Promise<NbaTeamRow[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .eq("sport", "nba");
  if (error !== null) {
    throw new Error(`load NBA teams failed: ${error.message}`);
  }
  return ((data as unknown) ?? []) as NbaTeamRow[];
}

async function upsertRatings(
  rows: NbaTeamRatingPayload[],
  dryRun: boolean,
  log: (msg: string) => void,
  errors: string[],
): Promise<number> {
  if (dryRun) {
    log(`  [dry-run] would upsert ${rows.length} nba_team_ratings row(s):`);
    for (const r of rows) {
      log(
        `    team_id=${r.team_id} ${r.season_type}-${r.season}  ` +
          `ORtg=${r.off_rating}  DRtg=${r.def_rating}  ` +
          `Net=${r.net_rating}  Pace=${r.pace}  ` +
          `eFG=${r.off_efg_pct}/${r.def_efg_pct}  TOV=${r.off_tov_pct}/${r.def_tov_pct}  ` +
          `ORB=${r.off_orb_pct}  DRB=${r.def_drb_pct}  FTr=${r.off_ft_rate}/${r.def_ft_rate_allowed}`,
      );
    }
    return 0;
  }
  let written = 0;
  for (const r of rows) {
    const { error } = await supabase
      .from("nba_team_ratings")
      .upsert(r, { onConflict: "team_id,season,season_type" });
    if (error) {
      const msg = `  ✗ upsert team_id=${r.team_id} failed: ${error.message}`;
      log(msg);
      errors.push(msg);
    } else {
      written++;
    }
  }
  return written;
}

/**
 * Refresh NBA team ratings from Basketball Reference. See module
 * docstring for the service contract.
 */
export async function refreshNbaTeamRatings(
  opts: RefreshNbaTeamRatingsOptions,
): Promise<RefreshNbaTeamRatingsResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];
  const includePlayoffs = opts.includePlayoffs ?? false;

  // 1. Resolve our NBA teams from the DB.
  const teams = await loadNbaTeams();
  log(`Loaded ${teams.length} NBA teams from DB.`);
  if (teams.length === 0) {
    return {
      release: NBA_TEAM_RATINGS_REFRESH_RELEASE,
      mode: "no-teams",
      teamsInDb: 0,
      seasonFetchStatus: "failed",
      seasonRowsParsed: 0,
      playoffFetchStatus: "skipped",
      playoffRowsParsed: 0,
      payloadsBuilt: 0,
      written: 0,
      errors,
    };
  }

  if (opts.skipFetchWhenRegularSeasonComplete) {
    const { data: existing, error } = await supabase
      .from("nba_team_ratings")
      .select("team_id")
      .eq("season", opts.season)
      .eq("season_type", "regular")
      .in("team_id", teams.map((team) => team.id));
    if (error) throw new Error(`load existing NBA ratings failed: ${error.message}`);
    const coveredTeamIds = new Set((existing ?? []).map((row) => Number(row.team_id)));
    if (teams.every((team) => coveredTeamIds.has(team.id))) {
      return {
        release: NBA_TEAM_RATINGS_REFRESH_RELEASE,
        mode: "already-complete",
        teamsInDb: teams.length,
        seasonFetchStatus: "skipped",
        seasonRowsParsed: 0,
        playoffFetchStatus: "skipped",
        playoffRowsParsed: 0,
        payloadsBuilt: 0,
        written: 0,
        errors,
      };
    }
  }

  // 2. Season-wide ratings fetch.
  log("\nFetching BBR season-wide ratings…");
  const seasonResult = await fetchBbrSeasonTeamRatings(opts.season);
  let seasonFetchStatus: "ok" | "failed";
  if (seasonResult.status !== "ok") {
    log(
      `  ✗ BBR season fetch failed: status=${seasonResult.status} http=${seasonResult.http_status ?? "?"} notes=${seasonResult.notes ?? ""}`,
    );
    seasonFetchStatus = "failed";
  } else {
    log(`  ✓ ${seasonResult.rows.length} BBR rows parsed`);
    seasonFetchStatus = "ok";
  }

  // 3. Optional playoff ratings fetch.
  let playoffResult: typeof seasonResult | null = null;
  let playoffFetchStatus: "ok" | "failed" | "skipped" = "skipped";
  if (includePlayoffs) {
    log("\nFetching BBR playoff ratings…");
    playoffResult = await fetchBbrPlayoffTeamRatings(opts.season);
    if (playoffResult.status !== "ok") {
      log(
        `  ✗ BBR playoff fetch failed: status=${playoffResult.status} http=${playoffResult.http_status ?? "?"} notes=${playoffResult.notes ?? ""}`,
      );
      playoffFetchStatus = "failed";
    } else {
      log(`  ✓ ${playoffResult.rows.length} BBR playoff rows parsed`);
      playoffFetchStatus = "ok";
    }
  }

  // 4. Build upsert payloads filtered to teams we have in DB.
  const payloads: NbaTeamRatingPayload[] = [];
  for (const r of seasonResult.rows) {
    const t = matchBbrRatingToNbaTeam(r, teams);
    if (t === null) {
      log(
        `  ⏭ skip BBR row ${r.abbreviation} (${r.team_name}) — no matching teams.abbreviation in DB`,
      );
      continue;
    }
    payloads.push(buildNbaTeamRatingPayload(r, t, opts.season, "regular"));
  }
  if (playoffResult && playoffResult.status === "ok") {
    for (const r of playoffResult.rows) {
      const t = matchBbrRatingToNbaTeam(r, teams);
      if (t === null) continue;
      payloads.push(buildNbaTeamRatingPayload(r, t, opts.season, "playoffs"));
    }
  }
  log(
    `\nReady to upsert ${payloads.length} row(s) (filtered to DB-resident teams).`,
  );

  // 5. Upsert (dry-run or write).
  const written = await upsertRatings(payloads, opts.dryRun, log, errors);

  return {
    release: NBA_TEAM_RATINGS_REFRESH_RELEASE,
    mode: opts.dryRun ? "dry-run" : "write",
    teamsInDb: teams.length,
    seasonFetchStatus,
    seasonRowsParsed: seasonResult.rows.length,
    playoffFetchStatus,
    playoffRowsParsed: playoffResult?.rows.length ?? 0,
    payloadsBuilt: payloads.length,
    written,
    errors,
  };
}
