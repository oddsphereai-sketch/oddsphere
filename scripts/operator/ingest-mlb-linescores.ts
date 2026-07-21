/**
 * Push 4b operator — MLB first-inning linescore ingest.
 *
 * USAGE:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/ingest-mlb-linescores.ts --date 2026-06-06 --verbose
 *
 *   Apply:
 *     MLB_LINESCORE_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/ingest-mlb-linescores.ts --date 2026-06-06 --apply
 *
 * Hits MLB Stats API for the slate, matches to our games rows, writes
 * `first_inning_runs` + `inning_scores` for completed games and official
 * postponed/canceled lifecycle statuses. Never touches predictions,
 * slate_status, or locked_at.
 *
 * Wrong-game guard: linescore only written when both team abbrevs
 * match our games row.
 */

import { supabase } from "../../lib/db/supabase";
import { ingestMlbLinescores } from "../../lib/services/mlbLinescoreIngestService";

type Args = { sport: "mlb"; date: string; apply: boolean; verbose: boolean };

function parseArgs(argv: readonly string[]): Args {
  let date: string | null = null;
  let apply = false;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--sport" && argv[i + 1]) { i++; continue; } // accepted but only mlb is supported
    if (a === "--apply") { apply = true; continue; }
    if (a === "--verbose" || a === "-v") { verbose = true; continue; }
  }
  if (date === null) {
    console.error("Usage: ingest-mlb-linescores.ts --date YYYY-MM-DD [--sport mlb] [--apply] [--verbose]");
    process.exit(1);
  }
  return { sport: "mlb", date, apply, verbose };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const envEnabled = process.env.MLB_LINESCORE_DB_WRITES_ENABLED === "true";
  const willApply = opts.apply && envEnabled;

  console.log(`\n━━━ ingest-mlb-linescores · MLB ${opts.date} ━━━`);
  console.log(`  --apply flag:                          ${opts.apply ? "YES" : "no"}`);
  console.log(`  MLB_LINESCORE_DB_WRITES_ENABLED:       ${envEnabled ? "true" : "missing"}`);
  console.log(`  mode:                                  ${willApply ? "APPLY (will UPDATE first-inning results / terminal status)" : "DRY-RUN (no DB writes)"}`);
  if (opts.apply && !envEnabled) {
    console.warn(`  ⚠ --apply was set but MLB_LINESCORE_DB_WRITES_ENABLED is missing — forcing dry-run.`);
  }
  console.log("");

  const result = await ingestMlbLinescores({
    date: opts.date,
    apply: willApply,
    supabase,
  });

  console.log(`MLB Stats API games fetched: ${result.mlbGamesFetched}`);
  console.log("");

  console.log("Per-game:");
  console.log("  matchup    ext        gamePk    status        FI a/h/total       action       reason");
  console.log("  " + "─".repeat(115));
  for (const g of result.perGame) {
    const fi = g.fi_total !== null ? `${g.fi_away}/${g.fi_home}/${g.fi_total}` : "—";
    console.log(
      `  ${pad(g.matchup, 10)} ${pad(String(g.external_id ?? "—"), 10)} ${pad(String(g.mlb_game_pk), 9)} ${pad(g.normalized_status, 13)} ${pad(fi, 18)} ${pad(g.action, 12)} ${g.reason ?? ""}`,
    );
    if (opts.verbose) {
      console.log(`    raw_status=${g.mlb_status}  fi_status=${g.fi_status}  game_id=${g.game_id ?? "—"}`);
    }
  }

  console.log("");
  console.log(`Updated:   ${result.updatedCount}`);
  console.log(`Pending:   ${result.pendingCount}`);
  console.log(`Skipped:   ${result.skippedCount}`);
  console.log(`Errors:    ${result.errorCount}`);
  if (result.errors.length > 0) {
    for (const e of result.errors) console.log(`  ${e.reason}`);
  }

  console.log("");
  console.log(willApply ? "  ✓ APPLY complete." : "  DRY-RUN — no DB writes performed.");
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
