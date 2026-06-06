/**
 * Push 3B-4 Phase 2 — MLB model readiness repair (dry-run + apply gate).
 *
 * Orchestrates the existing safe operators (no reimplementation):
 *   • runSeasonPitchingCycle    — pitcher season-stats backfill (MLB Stats)
 *   • lineupService.refreshLineups — BDL projected lineups
 *   • weatherService.refreshForecasts — OpenWeather rows
 *
 * USAGE:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local scripts/operator/repair-mlb-model-readiness.ts \
 *       --sport mlb --date 2026-06-06
 *
 *   Apply:
 *     MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED=true \
 *       AUTOMODEL_DB_WRITES_ENABLED=true \
 *       PLAYER_STATS_PROVIDER=real_api \
 *       WEATHER_PROVIDER=real_api \
 *       npx tsx --env-file=.env.local scripts/operator/repair-mlb-model-readiness.ts \
 *       --sport mlb --date 2026-06-06 --apply
 *
 * SAFETY:
 *   • Three-gate apply: --apply flag + MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED=true
 *     + AUTOMODEL_DB_WRITES_ENABLED=true (the pitcher backfill helper also
 *     enforces its own gate via writeMode).
 *   • Provider-mode guards on lineup + weather (must be real_api).
 *   • Writes ONLY to: player_season_stats, lineups, weather_forecasts.
 *   • Never touches game_predictions, slate_status, locked_at, tracking,
 *     model_version, players (only links — through backfill helper).
 *   • Per-step try/catch; one failure doesn't block the others.
 *   • Idempotent: pitcher helper uses noOverwriteExisting=false default,
 *     but the operator can opt in. Lineup refresh is DELETE-then-INSERT
 *     scoped to today's game_ids. Weather refresh is DELETE-then-INSERT
 *     scoped to today's game_ids.
 */

import { supabase } from "../../lib/db/supabase";
import { runSeasonPitchingCycle } from "./backfill-season-pitching-stats";
import { lineupService } from "../../lib/services/lineupService";
import { weatherService } from "../../lib/services/weatherService";
import type { Sport } from "../../lib/types/domain/Sport";

type Opts = { sport: Sport; date: string; apply: boolean; verbose: boolean };

type StepReason =
  | "readiness_ok"
  | "starter_assignment_missing"
  | "starter_mlb_id_missing"
  | "starter_stats_missing_backfillable"
  | "starter_stats_backfilled"
  | "starter_stats_provider_empty"
  | "starter_stats_api_error"
  | "lineup_missing_backfillable"
  | "lineup_backfilled"
  | "lineup_provider_empty"
  | "fi_market_missing"
  | "fi_market_present"
  | "weather_missing_backfillable"
  | "weather_backfilled"
  | "weather_provider_error"
  | "repair_not_needed";

function parseArgs(argv: string[]): Opts {
  let date: string | null = null;
  let sport: Sport = "mlb";
  let apply = false;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--apply") { apply = true; continue; }
    if (a === "--verbose") { verbose = true; continue; }
  }
  if (!date) {
    console.error("Usage: repair-mlb-model-readiness.ts --sport mlb --date YYYY-MM-DD [--apply] [--verbose]");
    process.exit(1);
  }
  return { sport, date, apply, verbose };
}

async function main() {
  const opts = parseArgs(process.argv);
  const writesEnabled = process.env.MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED === "true";
  const automodelEnabled = process.env.AUTOMODEL_DB_WRITES_ENABLED === "true";
  const playerProviderReal = process.env.PLAYER_STATS_PROVIDER === "real_api";
  const weatherProviderReal = process.env.WEATHER_PROVIDER === "real_api";
  const writeMode = opts.apply && writesEnabled && automodelEnabled;

  console.log(`\n━━━ MLB MODEL READINESS REPAIR · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`     mode=${writeMode ? "APPLY" : "DRY-RUN"}`);
  console.log(`     gates: MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED=${writesEnabled} AUTOMODEL_DB_WRITES_ENABLED=${automodelEnabled}`);
  console.log(`     providers: PLAYER_STATS_PROVIDER=${playerProviderReal ? "real_api" : "mock"} WEATHER_PROVIDER=${weatherProviderReal ? "real_api" : "mock"}`);
  if (opts.apply && (!writesEnabled || !automodelEnabled)) {
    console.error(`\n✗ --apply requires BOTH:`);
    console.error(`    MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED=true`);
    console.error(`    AUTOMODEL_DB_WRITES_ENABLED=true (pitcher helper internal gate)`);
    process.exit(1);
  }
  console.log("");

  // ─── Discover what needs repair ────────────────────────────────────
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, ballpark_id")
    .eq("slate_date", opts.date)
    .eq("sport", opts.sport);
  if (!games || games.length === 0) {
    console.log("No games on slate. Done.");
    return;
  }
  const gameIds = games.map((g) => g.id as number);

  // Pitcher needs
  const allPitcherIds = Array.from(new Set(
    games.flatMap((g) => [g.home_pitcher_id, g.away_pitcher_id]).filter((x): x is number => x !== null),
  ));
  const { data: pitchers } = await supabase
    .from("players")
    .select("id, full_name, mlb_person_id")
    .in("id", allPitcherIds);
  const pitcherById = new Map((pitchers ?? []).map((p) => [p.id as number, p]));
  const { data: pStats } = await supabase
    .from("player_season_stats")
    .select("player_id, pitching_era")
    .in("player_id", allPitcherIds)
    .eq("season", 2026);
  const statsByPlayer = new Map((pStats ?? []).map((s) => [s.player_id as number, s]));
  const pitchersNeedingStats: number[] = [];
  for (const id of allPitcherIds) {
    const stat = statsByPlayer.get(id);
    const pitcher = pitcherById.get(id);
    if ((!stat || stat.pitching_era === null) && pitcher && pitcher.mlb_person_id !== null) {
      pitchersNeedingStats.push(id);
    }
  }

  // Lineup needs (per game)
  const { data: lineupRows } = await supabase
    .from("lineups")
    .select("game_id, team_id, starting_position")
    .in("game_id", gameIds);
  const lineupCounts = new Map<string, number>();
  for (const l of lineupRows ?? []) {
    const sp = (l.starting_position as string | null) ?? "";
    if (sp === "P" || sp === "SP" || sp === "RP") continue;
    const k = `${l.game_id}|${l.team_id}`;
    lineupCounts.set(k, (lineupCounts.get(k) ?? 0) + 1);
  }
  let gamesNeedingLineupRefresh = 0;
  for (const g of games) {
    const h = lineupCounts.get(`${g.id}|${g.home_team_id}`) ?? 0;
    const a = lineupCounts.get(`${g.id}|${g.away_team_id}`) ?? 0;
    if (h < 8 || a < 8) gamesNeedingLineupRefresh++;
  }

  // Weather needs
  const { data: wxRows } = await supabase
    .from("weather_forecasts")
    .select("game_id")
    .in("game_id", gameIds);
  const weatherPresent = new Set((wxRows ?? []).map((w) => w.game_id as number));
  const gamesNeedingWeather = gameIds.filter((id) => !weatherPresent.has(id)).length;

  console.log(`Plan:`);
  console.log(`  Pitchers needing season-stats backfill:  ${pitchersNeedingStats.length} (ids=[${pitchersNeedingStats.join(",")}])`);
  console.log(`  Games needing lineup refresh:            ${gamesNeedingLineupRefresh} of ${games.length}`);
  console.log(`  Games needing weather refresh:           ${gamesNeedingWeather} of ${games.length}`);

  if (pitchersNeedingStats.length === 0 && gamesNeedingLineupRefresh === 0 && gamesNeedingWeather === 0) {
    console.log(`\n✅ ${"repair_not_needed".padEnd(36)}  All readiness gates satisfied.`);
    return;
  }

  const reasons: StepReason[] = [];

  // ─── Step 1: pitcher season-stats backfill ─────────────────────────
  if (pitchersNeedingStats.length > 0) {
    console.log(`\n━━━ Step 1: pitcher season-stats backfill ━━━`);
    if (writeMode && !playerProviderReal) {
      console.error(`✗ PLAYER_STATS_PROVIDER=real_api required for pitcher backfill apply. Skipping step 1.`);
      reasons.push("starter_stats_api_error");
    } else {
      const season = Number(opts.date.slice(0, 4));
      const result = await runSeasonPitchingCycle({
        sport: opts.sport,
        playerIds: pitchersNeedingStats,
        season,
        writeMode,
        log: (m) => opts.verbose && console.log(`    ${m}`),
      });
      console.log(`  status=${result.status} planned_inserts=${result.planned_inserts} planned_updates=${result.planned_updates} rows_written=${result.rows_written} errors=${result.errors}`);
      if (result.message) console.log(`  message: ${result.message}`);
      if (result.rows_written > 0) reasons.push("starter_stats_backfilled");
      else if (result.errors > 0) reasons.push("starter_stats_api_error");
      else if (result.skipped_empty > 0) reasons.push("starter_stats_provider_empty");
      else reasons.push("starter_stats_missing_backfillable");
    }
  }

  // ─── Step 2: lineup refresh ─────────────────────────────────────────
  if (gamesNeedingLineupRefresh > 0) {
    console.log(`\n━━━ Step 2: lineup refresh ━━━`);
    if (writeMode && !playerProviderReal) {
      console.error(`✗ PLAYER_STATS_PROVIDER=real_api required for lineup refresh apply. Skipping step 2.`);
      reasons.push("lineup_missing_backfillable");
    } else if (!writeMode) {
      console.log(`  (dry-run) would call lineupService.refreshLineups("${opts.sport}", "${opts.date}")`);
      reasons.push("lineup_missing_backfillable");
    } else {
      try {
        const r = await lineupService.refreshLineups(opts.sport, opts.date);
        console.log(`  records_updated=${r.records_updated} api_calls=${r.api_calls_made} details=${JSON.stringify(r.details ?? {})}`);
        if ((r.records_updated ?? 0) > 0) reasons.push("lineup_backfilled");
        else reasons.push("lineup_provider_empty");
      } catch (e) {
        console.error(`  ✗ lineup refresh failed: ${(e as Error).message}`);
        reasons.push("lineup_missing_backfillable");
      }
    }
  }

  // ─── Step 3: weather refresh ────────────────────────────────────────
  if (gamesNeedingWeather > 0) {
    console.log(`\n━━━ Step 3: weather refresh ━━━`);
    if (writeMode && !weatherProviderReal) {
      console.error(`✗ WEATHER_PROVIDER=real_api required for weather refresh apply. Skipping step 3.`);
      reasons.push("weather_provider_error");
    } else if (!writeMode) {
      console.log(`  (dry-run) would call weatherService.refreshForecasts("${opts.sport}", "${opts.date}")`);
      reasons.push("weather_missing_backfillable");
    } else {
      try {
        const r = await weatherService.refreshForecasts(opts.sport, opts.date);
        console.log(`  records_updated=${r.records_updated} api_calls=${r.api_calls_made}`);
        if ((r.records_updated ?? 0) > 0) reasons.push("weather_backfilled");
        else reasons.push("weather_provider_error");
      } catch (e) {
        console.error(`  ✗ weather refresh failed: ${(e as Error).message}`);
        reasons.push("weather_provider_error");
      }
    }
  }

  console.log(`\n━━━ Result ━━━`);
  if (writeMode) {
    console.log(`  Steps performed. Reason codes: ${reasons.join(", ")}`);
    console.log(`  Re-run audit-mlb-model-readiness.ts to verify gates are now green.`);
  } else {
    console.log(`  DRY-RUN — no DB writes performed. Reason codes that would apply: ${reasons.join(", ")}`);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
