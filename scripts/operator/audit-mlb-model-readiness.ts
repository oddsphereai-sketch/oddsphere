/**
 * Push 3B-4 Phase 1 — MLB model readiness audit (read-only).
 *
 * For the requested MLB slate, classifies whether every expected game
 * has enough data for full-game V2.2 + FI V2. Surfaces specific
 * blockers with reason codes so the operator (or repair-mlb-model-
 * readiness.ts) can fix them BEFORE model generation.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/audit-mlb-model-readiness.ts \
 *     --sport mlb --date 2026-06-06 [--verbose]
 *
 * READ-ONLY. NEVER writes. No provider calls. Purely a DB-state
 * inspector that compares snapshot-build inputs against required
 * upstream fields.
 */

import { supabase } from "../../lib/db/supabase";
import type { Sport } from "../../lib/types/domain/Sport";

type Opts = { sport: Sport; date: string; verbose: boolean };

type Blocker =
  | "starter_assignment_missing"
  | "starter_mlb_id_missing"
  | "starter_stats_missing_backfillable"
  | "starter_stats_provider_empty"
  | "lineup_missing_backfillable"
  | "fi_market_missing"
  | "weather_missing_backfillable"
  | "park_factor_missing";

type PerGame = {
  matchup: string;
  game_id: number;
  external_id: number;
  home_pitcher_id: number | null;
  away_pitcher_id: number | null;
  home_pitcher_name: string | null;
  away_pitcher_name: string | null;
  home_pitcher_mlb_id: number | null;
  away_pitcher_mlb_id: number | null;
  home_starter_stats: boolean;
  away_starter_stats: boolean;
  home_lineup_count: number;
  away_lineup_count: number;
  fi_market_rows: number;
  full_game_market_rows: number;
  weather_present: boolean;
  park_present: boolean;
  v22_ready: boolean;
  fi_v2_ready: boolean;
  blockers: Blocker[];
  repair: string[];
};

function parseArgs(argv: string[]): Opts {
  let date: string | null = null;
  let sport: Sport = "mlb";
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--verbose") { verbose = true; continue; }
    if (a === "--apply") { console.error("✗ --apply not supported (read-only)."); process.exit(2); }
  }
  if (!date) {
    console.error("Usage: audit-mlb-model-readiness.ts --sport mlb --date YYYY-MM-DD [--verbose]");
    process.exit(1);
  }
  return { sport, date, verbose };
}

function bucketStatus(label: string, ok: boolean, missing: boolean): string {
  if (ok) return `✓ ${label}`;
  if (missing) return `✗ ${label}`;
  return `· ${label}`;
}

async function main() {
  const opts = parseArgs(process.argv);
  console.log(`\n━━━ MLB MODEL READINESS · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`     READ-ONLY · NO DB WRITES · NO PROVIDER CALLS\n`);

  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, ballpark_id")
    .eq("slate_date", opts.date)
    .eq("sport", opts.sport)
    .order("game_date");
  if (!games || games.length === 0) {
    console.log("No games on slate. Done.");
    return;
  }
  const gameIds = games.map((g) => g.id as number);
  const { data: teams } = await supabase.from("teams").select("id, abbreviation");
  const abbr = new Map((teams ?? []).map((t) => [t.id as number, t.abbreviation as string]));

  // Pitchers
  const allPitcherIds = Array.from(new Set(
    games.flatMap((g) => [g.home_pitcher_id, g.away_pitcher_id]).filter((x): x is number => x !== null),
  ));
  const { data: pitchers } = await supabase
    .from("players")
    .select("id, full_name, team_id, mlb_person_id, provider_ids")
    .in("id", allPitcherIds);
  const pitcherById = new Map((pitchers ?? []).map((p) => [p.id as number, p]));

  // Season stats — both ERA and presence
  const { data: pStats } = await supabase
    .from("player_season_stats")
    .select("player_id, pitching_era, first_inning_era, first_inning_starts")
    .in("player_id", allPitcherIds)
    .eq("season", 2026);
  const statsByPlayer = new Map((pStats ?? []).map((s) => [s.player_id as number, s]));

  // Lineups
  const { data: lineupRows } = await supabase
    .from("lineups")
    .select("game_id, team_id, starting_position")
    .in("game_id", gameIds);
  const lineupCounts = new Map<string, number>(); // key: `${game_id}|${team_id}`
  for (const l of lineupRows ?? []) {
    const sp = (l.starting_position as string | null) ?? "";
    if (sp === "P" || sp === "SP" || sp === "RP") continue; // batter rows only
    const k = `${l.game_id}|${l.team_id}`;
    lineupCounts.set(k, (lineupCounts.get(k) ?? 0) + 1);
  }

  // Lines
  const { data: lineRows } = await supabase
    .from("lines")
    .select("game_id, market_type")
    .in("game_id", gameIds);
  const fiCounts = new Map<number, number>();
  const fullGameCounts = new Map<number, number>();
  for (const l of lineRows ?? []) {
    const k = l.game_id as number;
    if (l.market_type === "first_inning_total") fiCounts.set(k, (fiCounts.get(k) ?? 0) + 1);
    if (l.market_type === "moneyline" || l.market_type === "total" || l.market_type === "spread") {
      fullGameCounts.set(k, (fullGameCounts.get(k) ?? 0) + 1);
    }
  }

  // Weather
  const { data: wxRows } = await supabase
    .from("weather_forecasts")
    .select("game_id")
    .in("game_id", gameIds);
  const weatherPresent = new Set((wxRows ?? []).map((w) => w.game_id as number));

  // Park factors
  const parkIds = Array.from(new Set(games.map((g) => g.ballpark_id).filter((x): x is number => x !== null)));
  const { data: parks } = await supabase.from("ballparks").select("id, park_factor_runs").in("id", parkIds);
  const parkPresent = new Map((parks ?? []).map((p) => [p.id as number, (p.park_factor_runs as number | null) !== null]));

  // Build per-game records
  const perGame: PerGame[] = [];
  for (const g of games) {
    const matchup = `${abbr.get(g.away_team_id as number) ?? "?"}@${abbr.get(g.home_team_id as number) ?? "?"}`;
    const homePitcher = g.home_pitcher_id !== null ? pitcherById.get(g.home_pitcher_id as number) : undefined;
    const awayPitcher = g.away_pitcher_id !== null ? pitcherById.get(g.away_pitcher_id as number) : undefined;
    const homeStats = g.home_pitcher_id !== null ? statsByPlayer.get(g.home_pitcher_id as number) : undefined;
    const awayStats = g.away_pitcher_id !== null ? statsByPlayer.get(g.away_pitcher_id as number) : undefined;
    const homeStatsOk = homeStats !== undefined && homeStats.pitching_era !== null;
    const awayStatsOk = awayStats !== undefined && awayStats.pitching_era !== null;
    const homeLineupCount = lineupCounts.get(`${g.id}|${g.home_team_id}`) ?? 0;
    const awayLineupCount = lineupCounts.get(`${g.id}|${g.away_team_id}`) ?? 0;
    const fiMktRows = fiCounts.get(g.id as number) ?? 0;
    const fgMktRows = fullGameCounts.get(g.id as number) ?? 0;
    const weather = weatherPresent.has(g.id as number);
    const park = g.ballpark_id !== null ? (parkPresent.get(g.ballpark_id as number) === true) : false;

    const blockers: Blocker[] = [];
    const repair: string[] = [];

    if (g.home_pitcher_id === null) blockers.push("starter_assignment_missing");
    if (g.away_pitcher_id === null) blockers.push("starter_assignment_missing");
    if (homePitcher && (homePitcher.mlb_person_id === null && (!(homePitcher.provider_ids as Record<string, unknown> | null) || (homePitcher.provider_ids as { mlb_stats?: { id?: number } }).mlb_stats?.id === undefined))) {
      blockers.push("starter_mlb_id_missing");
    }
    if (awayPitcher && (awayPitcher.mlb_person_id === null && (!(awayPitcher.provider_ids as Record<string, unknown> | null) || (awayPitcher.provider_ids as { mlb_stats?: { id?: number } }).mlb_stats?.id === undefined))) {
      blockers.push("starter_mlb_id_missing");
    }
    if (g.home_pitcher_id !== null && !homeStatsOk && homePitcher?.mlb_person_id !== null) {
      blockers.push("starter_stats_missing_backfillable");
      repair.push(`backfill-season-pitching-stats playerIds=[${g.home_pitcher_id}]`);
    }
    if (g.away_pitcher_id !== null && !awayStatsOk && awayPitcher?.mlb_person_id !== null) {
      blockers.push("starter_stats_missing_backfillable");
      repair.push(`backfill-season-pitching-stats playerIds=[${g.away_pitcher_id}]`);
    }
    if (homeLineupCount < 8) {
      blockers.push("lineup_missing_backfillable");
      repair.push(`refresh-lineup-coverage --date ${opts.date}`);
    }
    if (awayLineupCount < 8) {
      blockers.push("lineup_missing_backfillable");
      // already added above; dedupe later
    }
    if (fiMktRows === 0) {
      blockers.push("fi_market_missing");
    }
    if (!weather) {
      blockers.push("weather_missing_backfillable");
      repair.push(`refresh-weather-coverage --date ${opts.date}`);
    }
    if (!park) blockers.push("park_factor_missing");

    // Readiness flags
    const v22Ready =
      g.home_pitcher_id !== null && g.away_pitcher_id !== null &&
      homeStatsOk && awayStatsOk && fgMktRows >= 4 && park;
    const fiV2Ready =
      g.home_pitcher_id !== null && g.away_pitcher_id !== null &&
      homeStatsOk && awayStatsOk && fiMktRows >= 2 && park;

    perGame.push({
      matchup, game_id: g.id as number, external_id: g.external_id as number,
      home_pitcher_id: g.home_pitcher_id as number | null,
      away_pitcher_id: g.away_pitcher_id as number | null,
      home_pitcher_name: homePitcher?.full_name as string | null ?? null,
      away_pitcher_name: awayPitcher?.full_name as string | null ?? null,
      home_pitcher_mlb_id: homePitcher?.mlb_person_id as number | null ?? null,
      away_pitcher_mlb_id: awayPitcher?.mlb_person_id as number | null ?? null,
      home_starter_stats: homeStatsOk,
      away_starter_stats: awayStatsOk,
      home_lineup_count: homeLineupCount,
      away_lineup_count: awayLineupCount,
      fi_market_rows: fiMktRows,
      full_game_market_rows: fgMktRows,
      weather_present: weather,
      park_present: park,
      v22_ready: v22Ready,
      fi_v2_ready: fiV2Ready,
      blockers: Array.from(new Set(blockers)),
      repair: Array.from(new Set(repair)),
    });
  }

  // Per-game table
  console.log("matchup    | home SP                    | away SP                    | SP stats | lineups (h/a) | FI mkt | FG mkt | wx | park | V2.2 | FI V2 | blockers");
  console.log("─".repeat(180));
  for (const p of perGame) {
    const homeSp = `${p.home_pitcher_name ?? "(unassigned)"}`.slice(0, 22);
    const awaySp = `${p.away_pitcher_name ?? "(unassigned)"}`.slice(0, 22);
    const stats = `${p.home_starter_stats ? "✓" : "✗"}/${p.away_starter_stats ? "✓" : "✗"}`;
    const blockerStr = p.blockers.length === 0 ? "none" : p.blockers.join(",");
    console.log(
      `${p.matchup.padEnd(10)} | ${homeSp.padEnd(26)} | ${awaySp.padEnd(26)} | ${stats.padEnd(8)} | ${(p.home_lineup_count + "/" + p.away_lineup_count).padEnd(13)} | ${String(p.fi_market_rows).padStart(6)} | ${String(p.full_game_market_rows).padStart(6)} | ${p.weather_present ? "✓" : "✗"}  | ${p.park_present ? "✓" : "✗"}    | ${p.v22_ready ? "READY" : " no  "} | ${p.fi_v2_ready ? "READY" : " no  "} | ${blockerStr}`,
    );
    if (opts.verbose && p.repair.length > 0) {
      for (const r of p.repair) console.log(`           | repair: ${r}`);
    }
  }

  // Aggregate
  console.log(`\n━━━ Aggregate ━━━`);
  console.log(`  Games:                        ${perGame.length}`);
  console.log(`  V2.2 ready:                   ${perGame.filter((p) => p.v22_ready).length}`);
  console.log(`  FI V2 ready:                  ${perGame.filter((p) => p.fi_v2_ready).length}`);
  const blockerCounts: Record<string, number> = {};
  for (const p of perGame) for (const b of p.blockers) blockerCounts[b] = (blockerCounts[b] ?? 0) + 1;
  console.log(`\n  Blocker counts:`);
  for (const [k, v] of Object.entries(blockerCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(36)} ${v}`);
  }

  // Specific repair recommendations
  const allRepairCmds = Array.from(new Set(perGame.flatMap((p) => p.repair)));
  if (allRepairCmds.length > 0) {
    console.log(`\n  Recommended repairs (run via repair-mlb-model-readiness.ts):`);
    for (const r of allRepairCmds) console.log(`    ${r}`);
  }

  // Backfillable pitcher IDs explicitly
  const pitchersNeedingStats: Array<{ id: number; name: string | null; mlb_id: number | null }> = [];
  for (const p of perGame) {
    if (!p.home_starter_stats && p.home_pitcher_id !== null) pitchersNeedingStats.push({ id: p.home_pitcher_id, name: p.home_pitcher_name, mlb_id: p.home_pitcher_mlb_id });
    if (!p.away_starter_stats && p.away_pitcher_id !== null) pitchersNeedingStats.push({ id: p.away_pitcher_id, name: p.away_pitcher_name, mlb_id: p.away_pitcher_mlb_id });
  }
  const uniqStats = Array.from(new Map(pitchersNeedingStats.map((x) => [x.id, x])).values());
  if (uniqStats.length > 0) {
    console.log(`\n  Pitchers needing season-stats backfill:`);
    for (const p of uniqStats) {
      console.log(`    player_id=${p.id} mlb_id=${p.mlb_id} name=${p.name}`);
    }
  }

  console.log(`\nREAD-ONLY — no DB writes performed.`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
