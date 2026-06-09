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
  normalizeBbrAbbr,
  type BbrTeamRatings,
} from "../../providers/real_api/_basketballReferenceClient";

export type RefreshNbaTeamRatingsOptions = {
  /** 4-digit season year (e.g. 2026 for the 2025-26 season). */
  season: number;
  /** When true, also fetch BBR's playoffs table. Default false. */
  includePlayoffs?: boolean;
  /** false = perform DB upserts; true = dry-run (read-only). */
  dryRun: boolean;
  /** Sink for human-readable progress lines. Default no-op. */
  logger?: (msg: string) => void;
};

export type RefreshNbaTeamRatingsResult = {
  mode: "dry-run" | "write" | "no-teams";
  teamsInDb: number;
  seasonFetchStatus: "ok" | "failed";
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

type NbaTeamRow = {
  id: number;
  abbreviation: string;
};

type UpsertPayload = {
  team_id: number;
  season: number;
  season_type: "regular" | "playoffs";
  off_rating: number | null;
  def_rating: number | null;
  net_rating: number | null;
  pace: number | null;
  off_efg_pct: number | null;
  off_tov_pct: number | null;
  off_orb_pct: number | null;
  off_ft_rate: number | null;
  def_efg_pct: number | null;
  def_tov_pct: number | null;
  def_drb_pct: number | null;
  def_ft_rate_allowed: number | null;
  source: string;
  source_url: string;
  fetched_at: string;
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

function matchToTeamRow(
  bbr: BbrTeamRatings,
  teamRows: NbaTeamRow[],
): NbaTeamRow | null {
  const normalizedBbrAbbr = normalizeBbrAbbr(bbr.abbreviation);
  return (
    teamRows.find(
      (t) => t.abbreviation.toUpperCase() === normalizedBbrAbbr.toUpperCase(),
    ) ?? null
  );
}

function buildPayload(
  row: BbrTeamRatings,
  team: NbaTeamRow,
  season: number,
  seasonType: "regular" | "playoffs",
): UpsertPayload {
  return {
    team_id: team.id,
    season,
    season_type: seasonType,
    off_rating: row.off_rating,
    def_rating: row.def_rating,
    net_rating: row.net_rating,
    pace: row.pace,
    off_efg_pct: row.off_efg_pct,
    off_tov_pct: row.off_tov_pct,
    off_orb_pct: row.off_orb_pct,
    off_ft_rate: row.off_ft_rate,
    def_efg_pct: row.def_efg_pct,
    def_tov_pct: row.def_tov_pct,
    def_drb_pct: row.def_drb_pct,
    def_ft_rate_allowed: row.def_ft_rate_allowed,
    source: "basketball-reference",
    source_url: row.source_url,
    fetched_at: row.fetched_at,
  };
}

async function upsertRatings(
  rows: UpsertPayload[],
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
  const payloads: UpsertPayload[] = [];
  for (const r of seasonResult.rows) {
    const t = matchToTeamRow(r, teams);
    if (t === null) {
      log(
        `  ⏭ skip BBR row ${r.abbreviation} (${r.team_name}) — no matching teams.abbreviation in DB`,
      );
      continue;
    }
    payloads.push(buildPayload(r, t, opts.season, "regular"));
  }
  if (playoffResult && playoffResult.status === "ok") {
    for (const r of playoffResult.rows) {
      const t = matchToTeamRow(r, teams);
      if (t === null) continue;
      payloads.push(buildPayload(r, t, opts.season, "playoffs"));
    }
  }
  log(
    `\nReady to upsert ${payloads.length} row(s) (filtered to DB-resident teams).`,
  );

  // 5. Upsert (dry-run or write).
  const written = await upsertRatings(payloads, opts.dryRun, log, errors);

  return {
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
