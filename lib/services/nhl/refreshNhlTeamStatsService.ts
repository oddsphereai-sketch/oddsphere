/**
 * Phase 7L Phase 1 — NHL team stats refresh service.
 *
 * Pulls MoneyPuck team season-summary CSV (regular + optional playoffs)
 * for the requested season, matches each row to our `teams` row by
 * canonical abbreviation via the NHL normalizer, and upserts into
 * `nhl_team_stats`. Idempotent via the (team_id, season, season_type,
 * situation) unique constraint.
 *
 * Scope:
 *   • Reads:  MoneyPuck public CSV, our teams table (sport='nhl').
 *   • Writes: nhl_team_stats.
 *   • NEVER writes any other table.
 */

import { supabase } from "../../db/supabase";
import {
  fetchMoneyPuckTeams,
  type MoneyPuckSeasonType,
} from "../../providers/nhl/_moneyPuckClient";
import { normalizeNhlTeamName } from "../../providers/nhl/_teamNameNormalizer";

export type RefreshNhlTeamStatsOptions = {
  /** MoneyPuck start-year (e.g. 2025 for 2025-26 season). */
  season: number;
  /** When true, also fetch + upsert the playoffs CSV. Default false. */
  includePlayoffs?: boolean;
  /** false = perform DB writes; true = dry-run. */
  dryRun: boolean;
  /** Sink for human-readable progress lines. Default no-op. */
  logger?: (msg: string) => void;
};

export type RefreshNhlTeamStatsResult = {
  mode: "dry-run" | "write" | "no-teams";
  teamsInDb: number;
  regularRowsParsed: number;
  playoffsRowsParsed: number;
  /** "skipped" when includePlayoffs=false. */
  playoffsFetchStatus: "ok" | "failed" | "skipped";
  payloadsBuilt: number;
  written: number;
  errors: string[];
};

type NhlTeamRow = { id: number; abbreviation: string };

async function loadNhlTeams(): Promise<NhlTeamRow[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .eq("sport", "nhl");
  if (error !== null) throw new Error(`load NHL teams failed: ${error.message}`);
  return ((data as unknown) ?? []) as NhlTeamRow[];
}

function buildPayload(
  row: import("../../providers/nhl/_moneyPuckClient").MoneyPuckTeamRow,
  team: NhlTeamRow,
) {
  return {
    team_id: team.id,
    season: row.season,
    season_type: row.season_type,
    situation: row.situation,
    games_played: row.games_played,
    ice_time: row.ice_time,
    xgoals_pct: row.xgoals_pct,
    corsi_pct: row.corsi_pct,
    fenwick_pct: row.fenwick_pct,
    x_goals_for: row.x_goals_for,
    x_goals_against: row.x_goals_against,
    goals_for: row.goals_for,
    goals_against: row.goals_against,
    shots_on_goal_for: row.shots_on_goal_for,
    shots_on_goal_against: row.shots_on_goal_against,
    source: "moneypuck",
    source_url: row.source_url,
    fetched_at: row.fetched_at,
  };
}

export async function refreshNhlTeamStats(
  opts: RefreshNhlTeamStatsOptions,
): Promise<RefreshNhlTeamStatsResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];
  const includePlayoffs = opts.includePlayoffs ?? false;

  const teams = await loadNhlTeams();
  log(`Loaded ${teams.length} NHL teams from DB.`);
  if (teams.length === 0) {
    return {
      mode: "no-teams",
      teamsInDb: 0,
      regularRowsParsed: 0,
      playoffsRowsParsed: 0,
      playoffsFetchStatus: "skipped",
      payloadsBuilt: 0,
      written: 0,
      errors,
    };
  }
  const teamByAbbr = new Map<string, NhlTeamRow>(
    teams.map((t) => [t.abbreviation.toUpperCase(), t]),
  );

  // Fetch regular-season CSV (required).
  log(`\nFetching MoneyPuck teams — season=${opts.season} regular…`);
  const regular = await fetchMoneyPuckTeams(opts.season, "regular");
  log(`  ✓ ${regular.length} regular-season row(s) parsed`);

  // Optional playoffs CSV.
  let playoffsRows: import("../../providers/nhl/_moneyPuckClient").MoneyPuckTeamRow[] = [];
  let playoffsFetchStatus: "ok" | "failed" | "skipped" = "skipped";
  if (includePlayoffs) {
    log(`\nFetching MoneyPuck teams — season=${opts.season} playoffs…`);
    try {
      playoffsRows = await fetchMoneyPuckTeams(opts.season, "playoffs");
      log(`  ✓ ${playoffsRows.length} playoff row(s) parsed`);
      playoffsFetchStatus = "ok";
    } catch (e) {
      log(`  ✗ playoffs CSV fetch failed: ${(e as Error).message}`);
      playoffsFetchStatus = "failed";
    }
  }

  const buildAndPush = (
    src: import("../../providers/nhl/_moneyPuckClient").MoneyPuckTeamRow[],
    label: string,
  ): typeof payloads => {
    const out: typeof payloads = [];
    for (const r of src) {
      const canonical = normalizeNhlTeamName(r.team_abbr);
      if (canonical === null) {
        log(`  ⏭ skip ${label} row team="${r.team_abbr}" — no normalizer match`);
        continue;
      }
      const t = teamByAbbr.get(canonical);
      if (!t) {
        log(`  ⏭ skip ${label} row team=${canonical} — not in DB teams table`);
        continue;
      }
      out.push(buildPayload(r, t));
    }
    return out;
  };

  type Payload = ReturnType<typeof buildPayload>;
  const payloads: Payload[] = [];
  payloads.push(...buildAndPush(regular, "regular"));
  payloads.push(...buildAndPush(playoffsRows, "playoffs"));
  log(`\nReady to upsert ${payloads.length} row(s) (filtered to DB-resident teams).`);

  if (opts.dryRun) {
    log(`  [dry-run] would upsert ${payloads.length} nhl_team_stats row(s)`);
    for (const p of payloads.slice(0, 8)) {
      log(`    team_id=${p.team_id} ${p.season_type}/${p.situation}  xG%=${p.xgoals_pct}  Corsi%=${p.corsi_pct}  xGF=${p.x_goals_for}  xGA=${p.x_goals_against}`);
    }
    if (payloads.length > 8) log(`    … and ${payloads.length - 8} more`);
    return {
      mode: "dry-run",
      teamsInDb: teams.length,
      regularRowsParsed: regular.length,
      playoffsRowsParsed: playoffsRows.length,
      playoffsFetchStatus,
      payloadsBuilt: payloads.length,
      written: 0,
      errors,
    };
  }

  let written = 0;
  for (const p of payloads) {
    const { error } = await supabase
      .from("nhl_team_stats")
      .upsert(p, { onConflict: "team_id,season,season_type,situation" });
    if (error) {
      const msg = `  ✗ upsert team_id=${p.team_id} ${p.season_type}/${p.situation}: ${error.message}`;
      log(msg);
      errors.push(msg);
    } else {
      written += 1;
    }
  }

  return {
    mode: "write",
    teamsInDb: teams.length,
    regularRowsParsed: regular.length,
    playoffsRowsParsed: playoffsRows.length,
    playoffsFetchStatus,
    payloadsBuilt: payloads.length,
    written,
    errors,
  };
}
