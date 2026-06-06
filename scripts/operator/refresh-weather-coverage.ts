/**
 * Push 3A-3 Phase 1 — MLB weather coverage refresh operator.
 *
 * Wraps lib/services/weatherService.refreshForecasts behind a dry-run
 * default and a two-key apply gate (--apply + WEATHER_COVERAGE_DB_WRITES_ENABLED).
 *
 * USAGE:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local scripts/operator/refresh-weather-coverage.ts \
 *       --sport mlb --date 2026-06-06 [--verbose]
 *
 *   Apply (writes to weather_forecasts):
 *     WEATHER_COVERAGE_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local scripts/operator/refresh-weather-coverage.ts \
 *       --sport mlb --date 2026-06-06 --apply
 *
 * SAFETY:
 *   • Dry-run is the default — no API calls, no DB writes.
 *   • --apply requires WEATHER_COVERAGE_DB_WRITES_ENABLED=true env (two-key).
 *   • Pre-flight game-mapping audit ensures every game has a ballpark and
 *     that ballparks have lat/lng (or are dome) BEFORE any external call.
 *   • Writes ONLY to the `weather_forecasts` table.
 *   • NEVER touches game_predictions, slate_status, locked_at, lineups,
 *     or tracking.
 *   • If the pre-flight maps suspiciously few games (< 50% of expected),
 *     refuses to apply and reports.
 *
 * Why this script exists:
 *   3A-3 Phase 0 audit found that the morning-slate / evening-refresh /
 *   afternoon-refresh routes (which call weatherService) are not
 *   scheduled in vercel.json — so weather hasn't refreshed since
 *   2026-06-03 for MLB. This script gives the operator a manual path
 *   while we decide on cron-schedule changes.
 */

import { supabase } from "../../lib/db/supabase";
import { loadBallparkMetadata } from "../../lib/services/_idMaps";
import { weatherService } from "../../lib/services/weatherService";
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
    console.error("Usage: refresh-weather-coverage.ts --sport mlb --date YYYY-MM-DD [--apply] [--verbose]");
    process.exit(1);
  }
  return { sport, date, apply, verbose };
}

async function main() {
  const opts = parseArgs(process.argv);
  const envEnabled = process.env.WEATHER_COVERAGE_DB_WRITES_ENABLED === "true";
  const providerMode = process.env.WEATHER_PROVIDER === "real_api" ? "real_api" : "mock";
  const writeMode = opts.apply && envEnabled && providerMode === "real_api";

  console.log(`\n━━━ MLB WEATHER COVERAGE · ${opts.date} ━━━`);
  console.log(`         mode=${writeMode ? "APPLY" : "DRY-RUN"}  sport=${opts.sport}  provider=${providerMode}`);
  if (opts.apply && !envEnabled) {
    console.error(`✗ --apply requires WEATHER_COVERAGE_DB_WRITES_ENABLED=true in env. Refusing to write.`);
    process.exit(1);
  }
  if (opts.apply && providerMode !== "real_api") {
    console.error(`✗ --apply requires WEATHER_PROVIDER=real_api in env. Mock provider would write fake forecasts. Refusing.`);
    process.exit(1);
  }
  console.log("");

  // ─── Pre-flight: map every expected game → ballpark ────────────────
  const { data: gamesRaw, error: gErr } = await supabase
    .from("games")
    .select("id, external_id, slate_date, game_date, home_team_id, away_team_id, ballpark_id")
    .eq("slate_date", opts.date)
    .eq("sport", opts.sport);
  if (gErr) { console.error("games query failed:", gErr.message); process.exit(2); }
  const games = gamesRaw ?? [];
  console.log(`Expected games on ${opts.date}: ${games.length}`);
  if (games.length === 0) {
    console.log("No games. Nothing to refresh.");
    return;
  }

  const ballparks = await loadBallparkMetadata();
  let outdoorWithCoords = 0, dome = 0, missingBallpark = 0, missingCoords = 0;
  const issues: Array<{ ext: number; reason: string }> = [];
  for (const g of games) {
    const bp = ballparks.get(g.home_team_id as number);
    if (!bp) {
      missingBallpark++;
      issues.push({ ext: g.external_id as number, reason: "no ballpark for home_team_id" });
      continue;
    }
    if (bp.is_dome) {
      dome++;
      continue;
    }
    if (typeof bp.latitude !== "number" || typeof bp.longitude !== "number") {
      missingCoords++;
      issues.push({ ext: g.external_id as number, reason: "ballpark missing lat/lng (will be skipped)" });
      continue;
    }
    outdoorWithCoords++;
  }
  console.log(`Pre-flight mapping:`);
  console.log(`  outdoor games with lat/lng (will fetch):  ${outdoorWithCoords}`);
  console.log(`  dome games (stub written, no fetch):      ${dome}`);
  console.log(`  games with no ballpark:                   ${missingBallpark}`);
  console.log(`  games with ballpark but no coords:        ${missingCoords}`);
  if (issues.length > 0) {
    console.log(`  issues:`);
    for (const it of issues) console.log(`    ext=${it.ext}: ${it.reason}`);
  }

  // ─── Safety: refuse to apply if mapping coverage is suspiciously low
  const fetchable = outdoorWithCoords + dome;
  const coverageRatio = fetchable / games.length;
  if (writeMode && coverageRatio < 0.5) {
    console.error(`✗ Mapping coverage ${(coverageRatio * 100).toFixed(0)}% < 50% threshold. Refusing to apply.`);
    process.exit(3);
  }

  // ─── Current weather coverage in DB ─────────────────────────────────
  const gameIds = games.map((g) => g.id as number);
  const { data: existing } = await supabase
    .from("weather_forecasts")
    .select("game_id, fetched_at, conditions")
    .in("game_id", gameIds);
  console.log(`Existing weather rows for slate:           ${existing?.length ?? 0}`);

  if (!writeMode) {
    console.log(`\nDRY-RUN — no DB writes. Use --apply (with env) to write.`);
    return;
  }

  // ─── Apply: delegate to weatherService ──────────────────────────────
  console.log(`\nApplying weatherService.refreshForecasts(${opts.sport}, ${opts.date})...`);
  const t0 = Date.now();
  const res = await weatherService.refreshForecasts(opts.sport, opts.date);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  records_updated:  ${res.records_updated}`);
  console.log(`  api_calls_made:   ${res.api_calls_made}`);
  console.log(`  details:          ${JSON.stringify(res.details ?? {})}`);
  console.log(`  elapsed:          ${elapsed}s`);

  // ─── Post-apply verification ────────────────────────────────────────
  const { data: postRows } = await supabase
    .from("weather_forecasts")
    .select("game_id, conditions, temperature_f, wind_speed_mph, is_notable")
    .in("game_id", gameIds);
  console.log(`\nPost-apply weather rows for slate: ${postRows?.length ?? 0}`);
  if (postRows) {
    let withTemp = 0, withWind = 0, domeRows = 0, notable = 0;
    for (const r of postRows) {
      if (r.temperature_f !== null) withTemp++;
      if (r.wind_speed_mph !== null) withWind++;
      if (r.conditions === "Dome") domeRows++;
      if (r.is_notable === true) notable++;
    }
    console.log(`  temp non-null: ${withTemp}  wind non-null: ${withWind}  dome stubs: ${domeRows}  notable: ${notable}`);
  }

  if ((postRows?.length ?? 0) < games.length * 0.5) {
    console.warn(`⚠ post-apply row count (${postRows?.length}) is < 50% of expected (${games.length}). Investigate.`);
    process.exit(4);
  }
  console.log(`\n✅ Weather refresh applied for ${opts.sport.toUpperCase()} ${opts.date}.`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
