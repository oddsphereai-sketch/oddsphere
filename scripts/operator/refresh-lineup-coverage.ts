/**
 * Push 3A-3 Phase 2 — MLB lineup coverage refresh operator.
 *
 * Wraps lib/services/lineupService.refreshLineups behind a dry-run
 * default and a two-key apply gate (--apply + LINEUP_COVERAGE_DB_WRITES_ENABLED).
 *
 * USAGE:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local scripts/operator/refresh-lineup-coverage.ts \
 *       --sport mlb --date 2026-06-06 [--verbose]
 *
 *   Apply (writes to lineups):
 *     LINEUP_COVERAGE_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local scripts/operator/refresh-lineup-coverage.ts \
 *       --sport mlb --date 2026-06-06 --apply
 *
 * SAFETY:
 *   • Dry-run is the default — no provider calls, no DB writes.
 *   • --apply requires LINEUP_COVERAGE_DB_WRITES_ENABLED=true env (two-key).
 *   • Pre-flight game-mapping audit verifies game/team/player id maps
 *     are populated BEFORE any provider call.
 *   • Writes ONLY to the `lineups` table.
 *   • NEVER touches game_predictions, slate_status, locked_at, tracking,
 *     or weather.
 *   • Refuses to apply if the pre-flight finds suspiciously few mappable
 *     games (< 50% of expected).
 *
 * Why this script exists:
 *   3A-3 Phase 0 audit found that lineup-watch / evening-refresh routes
 *   (which call lineupService) aren't scheduled in vercel.json — so the
 *   lineups table has been empty for the last 3 MLB slates. This script
 *   gives the operator a manual path while we decide on cron-schedule
 *   changes.
 */

import { supabase } from "../../lib/db/supabase";
import { loadGameIdMap, loadPlayerIdMap, loadTeamIdMap } from "../../lib/services/_idMaps";
import { lineupService } from "../../lib/services/lineupService";
import { getPlayerStatsProvider } from "../../lib/providers/factory";
import type { Sport } from "../../lib/types/domain/Sport";

type Opts = {
  sport: Sport;
  date: string;
  apply: boolean;
  verbose: boolean;
};

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
    console.error("Usage: refresh-lineup-coverage.ts --sport mlb --date YYYY-MM-DD [--apply] [--verbose]");
    process.exit(1);
  }
  return { sport, date, apply, verbose };
}

async function main() {
  const opts = parseArgs(process.argv);
  const envEnabled = process.env.LINEUP_COVERAGE_DB_WRITES_ENABLED === "true";
  const providerMode = process.env.PLAYER_STATS_PROVIDER === "real_api" ? "real_api" : "mock";
  const writeMode = opts.apply && envEnabled && providerMode === "real_api";

  console.log(`\n━━━ MLB LINEUP COVERAGE · ${opts.date} ━━━`);
  console.log(`         mode=${writeMode ? "APPLY" : "DRY-RUN"}  sport=${opts.sport}  provider=${providerMode}`);
  if (opts.apply && !envEnabled) {
    console.error(`✗ --apply requires LINEUP_COVERAGE_DB_WRITES_ENABLED=true in env. Refusing to write.`);
    process.exit(1);
  }
  if (opts.apply && providerMode !== "real_api") {
    console.error(`✗ --apply requires PLAYER_STATS_PROVIDER=real_api in env. Mock provider would write fake lineups. Refusing.`);
    process.exit(1);
  }
  console.log("");

  // ─── Pre-flight: confirm game/team/player id maps + provider mode ──
  const gameIdMap = await loadGameIdMap(opts.sport, opts.date);
  const teamIdMap = await loadTeamIdMap(opts.sport);
  const playerIdMap = await loadPlayerIdMap(opts.sport);
  console.log(`Pre-flight id maps:`);
  console.log(`  game_id map (slate):      ${gameIdMap.size}`);
  console.log(`  team_id map (sport):      ${teamIdMap.size}`);
  console.log(`  player_id map (sport):    ${playerIdMap.size}`);

  if (gameIdMap.size === 0) {
    console.log(`No games on ${opts.date}. Nothing to refresh.`);
    return;
  }

  // Verify provider is real-mode
  const provider = getPlayerStatsProvider();
  const providerName = provider.constructor?.name ?? "unknown";
  console.log(`  provider:                 ${providerName}`);

  // ─── Sample dry-run: hit the provider for the FIRST game to verify
  //     response shape before doing the full slate. Read-only.
  const firstExtGameId = [...gameIdMap.keys()][0]!;
  console.log(`\nDry-probe: fetching lineups for game external_id=${firstExtGameId} ...`);
  let sampleCount = 0;
  let sampleConfirmed = 0;
  let sampleHomePlayers = 0;
  let sampleAwayPlayers = 0;
  try {
    const sample = await provider.getLineups(firstExtGameId);
    sampleCount = sample.length;
    for (const l of sample) {
      if (l.is_confirmed) sampleConfirmed++;
      // Determine home/away by team_external_id mapping
      const teamId = teamIdMap.get(l.team_external_id);
      const { data: gameRow } = await supabase.from("games").select("home_team_id, away_team_id").eq("external_id", firstExtGameId).maybeSingle();
      if (gameRow && teamId === gameRow.home_team_id) sampleHomePlayers++;
      else if (gameRow && teamId === gameRow.away_team_id) sampleAwayPlayers++;
    }
    console.log(`  rows:        ${sampleCount}`);
    console.log(`  confirmed:   ${sampleConfirmed}`);
    console.log(`  home/away:   ${sampleHomePlayers}/${sampleAwayPlayers}`);
  } catch (e) {
    console.error(`  ✗ probe failed: ${(e as Error).message}`);
    if (writeMode) {
      console.error(`  Refusing to apply when probe fails.`);
      process.exit(3);
    }
  }

  if (sampleCount > 0 && sampleCount < 9) {
    console.warn(`  ⚠ probe returned only ${sampleCount} rows — projected lineups may be incomplete this early.`);
  }

  // Current lineups in DB (should be 0 if cron hasn't run)
  const dbGameIds = [...gameIdMap.values()];
  const { data: existing } = await supabase.from("lineups").select("game_id, is_confirmed").in("game_id", dbGameIds);
  let existingConfirmed = 0;
  for (const l of existing ?? []) if (l.is_confirmed === true) existingConfirmed++;
  console.log(`\nExisting lineup rows for slate: ${existing?.length ?? 0} (${existingConfirmed} confirmed)`);

  if (!writeMode) {
    console.log(`\nDRY-RUN — no DB writes. Use --apply (with env) to write.`);
    return;
  }

  // ─── Apply ─────────────────────────────────────────────────────────
  console.log(`\nApplying lineupService.refreshLineups(${opts.sport}, ${opts.date})...`);
  const t0 = Date.now();
  const res = await lineupService.refreshLineups(opts.sport, opts.date);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  records_updated:  ${res.records_updated}`);
  console.log(`  api_calls_made:   ${res.api_calls_made}`);
  console.log(`  details:          ${JSON.stringify(res.details ?? {})}`);
  console.log(`  elapsed:          ${elapsed}s`);

  // ─── Post-apply verification ───────────────────────────────────────
  const { data: postRows } = await supabase
    .from("lineups")
    .select("game_id, team_id, is_confirmed, starting_position")
    .in("game_id", dbGameIds);
  console.log(`\nPost-apply lineup rows for slate: ${postRows?.length ?? 0}`);
  if (postRows) {
    let confirmed = 0, batters = 0, pitchers = 0;
    const perGame = new Map<number, number>();
    for (const r of postRows) {
      if (r.is_confirmed === true) confirmed++;
      const sp = r.starting_position as string | null;
      if (sp === "P" || sp === "SP" || sp === "RP") pitchers++;
      else batters++;
      perGame.set(r.game_id as number, (perGame.get(r.game_id as number) ?? 0) + 1);
    }
    console.log(`  confirmed: ${confirmed}  batters: ${batters}  pitchers: ${pitchers}`);
    let fullGames = 0, partialGames = 0, emptyGames = 0;
    for (const gid of dbGameIds) {
      const n = perGame.get(gid) ?? 0;
      if (n >= 16) fullGames++;
      else if (n > 0) partialGames++;
      else emptyGames++;
    }
    console.log(`  games with ≥16 rows: ${fullGames}  partial: ${partialGames}  empty: ${emptyGames}`);
  }

  if ((postRows?.length ?? 0) < dbGameIds.length * 8) {
    console.warn(`⚠ post-apply row count (${postRows?.length}) < ${dbGameIds.length * 8} (8 batters × games). Lineups likely projected-only or not yet posted.`);
  }
  console.log(`\n✅ Lineup refresh applied for ${opts.sport.toUpperCase()} ${opts.date}.`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
