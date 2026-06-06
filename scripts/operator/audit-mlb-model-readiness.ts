/**
 * Push 3B-4 Phase 1 — MLB model readiness audit CLI.
 * Push 3B-6 — refactored to thin wrapper. Logic lives in
 *   lib/services/modelReadinessService.ts (so the slate-cycle
 *   orchestrator can import it without dragging this file's CLI
 *   surface into the Next build worker).
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/audit-mlb-model-readiness.ts \
 *     --sport mlb --date 2026-06-06 [--verbose]
 *
 * READ-ONLY. NEVER writes. No provider calls.
 */

import { auditMlbModelReadiness } from "../../lib/services/modelReadinessService";
import type { Sport } from "../../lib/types/domain/Sport";

type Opts = { sport: Sport; date: string; verbose: boolean };

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

async function main() {
  const opts = parseArgs(process.argv);
  console.log(`\n━━━ MLB MODEL READINESS · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`     READ-ONLY · NO DB WRITES · NO PROVIDER CALLS\n`);

  const report = await auditMlbModelReadiness({ sport: opts.sport, date: opts.date });
  if (report.games_total === 0) {
    console.log("No games on slate. Done.");
    return;
  }

  console.log("matchup    | home SP                    | away SP                    | SP stats | lineups (h/a) | FI mkt | FG mkt | wx | park | V2.2 | FI V2 | blockers");
  console.log("─".repeat(180));
  for (const p of report.per_game) {
    const homeSp = `${p.home_pitcher_name ?? "(unassigned)"}`.slice(0, 22);
    const awaySp = `${p.away_pitcher_name ?? "(unassigned)"}`.slice(0, 22);
    const stats = `${p.home_starter_stats ? "✓" : "✗"}/${p.away_starter_stats ? "✓" : "✗"}`;
    const blockerStr = p.blockers.length === 0 ? "none" : p.blockers.join(",");
    console.log(
      `${p.matchup.padEnd(10)} | ${homeSp.padEnd(26)} | ${awaySp.padEnd(26)} | ${stats.padEnd(8)} | ${(p.home_lineup_count + "/" + p.away_lineup_count).padEnd(13)} | ${String(p.fi_market_rows).padStart(6)} | ${String(p.full_game_market_rows).padStart(6)} | ${p.weather_present ? "✓" : "✗"}  | ${p.park_present ? "✓" : "✗"}    | ${p.v22_ready ? "READY" : " no  "} | ${p.fi_v2_ready ? "READY" : " no  "} | ${blockerStr}`,
    );
  }

  console.log(`\n━━━ Aggregate ━━━`);
  console.log(`  Games:                        ${report.games_total}`);
  console.log(`  V2.2 ready:                   ${report.v22_ready_count}`);
  console.log(`  FI V2 ready:                  ${report.fi_v2_ready_count}`);
  console.log(`\n  Blocker counts:`);
  for (const [k, v] of Object.entries(report.blocker_counts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(36)} ${v}`);
  }
  if (report.pitchers_needing_stats.length > 0) {
    console.log(`\n  Pitchers needing season-stats backfill:`);
    for (const p of report.pitchers_needing_stats) {
      console.log(`    player_id=${p.id} mlb_id=${p.mlb_id} name=${p.name}`);
    }
  }
  if (opts.verbose) console.log(`\n  (--verbose: per-game details are shown in the table above.)`);
  console.log(`\nREAD-ONLY — no DB writes performed.`);
}

// Push 3B-6 — module guard. Without this, `main()` runs at import time
// when Next collects route page-data, calls parseArgs(process.argv)
// with no --date, and process.exit(1)s the build worker (the exact
// failure mode that produced 3B-5f deploy fix).
if (require.main === module) {
  main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
}
