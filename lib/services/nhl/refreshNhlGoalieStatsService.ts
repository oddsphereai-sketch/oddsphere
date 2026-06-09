/**
 * Phase 7L Phase 1 — NHL goalie stats refresh service.
 *
 * Pulls MoneyPuck goalies CSV (regular + optional playoffs) and upserts
 * into `nhl_goalie_stats`. Idempotent via the (player_external_id,
 * season, season_type, situation) unique constraint.
 *
 * Scope:
 *   • Reads:  MoneyPuck public CSV (no auth).
 *   • Writes: nhl_goalie_stats.
 *   • NEVER writes any other table.
 *
 * Note: this service does NOT filter by team — it loads ALL goalies
 * from the CSV (typically 60-90 goalies per season). The model
 * service later picks the relevant goalie row by player_name (set
 * via manual override) or by team for default fallback.
 */

import { supabase } from "../../db/supabase";
import { fetchMoneyPuckGoalies } from "../../providers/nhl/_moneyPuckClient";

export type RefreshNhlGoalieStatsOptions = {
  season: number;
  includePlayoffs?: boolean;
  dryRun: boolean;
  logger?: (msg: string) => void;
};

export type RefreshNhlGoalieStatsResult = {
  mode: "dry-run" | "write";
  regularRowsParsed: number;
  playoffsRowsParsed: number;
  playoffsFetchStatus: "ok" | "failed" | "skipped";
  written: number;
  errors: string[];
};

function buildPayload(
  row: import("../../providers/nhl/_moneyPuckClient").MoneyPuckGoalieRow,
) {
  return {
    player_external_id: row.player_external_id,
    player_name: row.player_name,
    team_abbr: row.team_abbr,
    season: row.season,
    season_type: row.season_type,
    situation: row.situation,
    games_played: row.games_played,
    ice_time: row.ice_time,
    x_goals: row.x_goals,
    goals: row.goals,
    shots_against: row.shots_against,
    saves: row.saves,
    source: "moneypuck",
    source_url: row.source_url,
    fetched_at: row.fetched_at,
  };
}

export async function refreshNhlGoalieStats(
  opts: RefreshNhlGoalieStatsOptions,
): Promise<RefreshNhlGoalieStatsResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];
  const includePlayoffs = opts.includePlayoffs ?? false;

  log(`Fetching MoneyPuck goalies — season=${opts.season} regular…`);
  const regular = await fetchMoneyPuckGoalies(opts.season, "regular");
  log(`  ✓ ${regular.length} regular-season goalie row(s) parsed`);

  let playoffsRows: import("../../providers/nhl/_moneyPuckClient").MoneyPuckGoalieRow[] = [];
  let playoffsFetchStatus: "ok" | "failed" | "skipped" = "skipped";
  if (includePlayoffs) {
    log(`\nFetching MoneyPuck goalies — season=${opts.season} playoffs…`);
    try {
      playoffsRows = await fetchMoneyPuckGoalies(opts.season, "playoffs");
      log(`  ✓ ${playoffsRows.length} playoff goalie row(s) parsed`);
      playoffsFetchStatus = "ok";
    } catch (e) {
      log(`  ✗ playoffs goalies CSV fetch failed: ${(e as Error).message}`);
      playoffsFetchStatus = "failed";
    }
  }

  const allRows = [...regular, ...playoffsRows];
  const payloads = allRows.map(buildPayload);
  log(`\nReady to upsert ${payloads.length} row(s).`);

  if (opts.dryRun) {
    log(`  [dry-run] would upsert ${payloads.length} nhl_goalie_stats row(s)`);
    for (const p of payloads.slice(0, 6)) {
      log(`    id=${p.player_external_id} ${p.player_name} (${p.team_abbr}) ${p.season_type}/${p.situation}  xG=${p.x_goals} goals=${p.goals} sv=${p.saves}`);
    }
    if (payloads.length > 6) log(`    … and ${payloads.length - 6} more`);
    return {
      mode: "dry-run",
      regularRowsParsed: regular.length,
      playoffsRowsParsed: playoffsRows.length,
      playoffsFetchStatus,
      written: 0,
      errors,
    };
  }

  let written = 0;
  // Batch in chunks of 100 for upsert efficiency. Supabase tolerates
  // arrays in upsert calls; we still surface per-batch errors.
  const BATCH = 100;
  for (let i = 0; i < payloads.length; i += BATCH) {
    const slice = payloads.slice(i, i + BATCH);
    const { error } = await supabase
      .from("nhl_goalie_stats")
      .upsert(slice, { onConflict: "player_external_id,season,season_type,situation" });
    if (error) {
      const msg = `  ✗ upsert batch ${i}..${i + slice.length - 1}: ${error.message}`;
      log(msg);
      errors.push(msg);
    } else {
      written += slice.length;
    }
  }

  return {
    mode: "write",
    regularRowsParsed: regular.length,
    playoffsRowsParsed: playoffsRows.length,
    playoffsFetchStatus,
    written,
    errors,
  };
}
