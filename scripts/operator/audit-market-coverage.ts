/**
 * Push 2 operator — slate-driven market coverage audit.
 *
 * USAGE:
 *   Dry-run (default — no DB writes):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/audit-market-coverage.ts --sport mlb --date 2026-06-06
 *
 *   Apply recovered lines:
 *     SHARP_LINES_RECOVERY_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/audit-market-coverage.ts --sport mlb --date 2026-06-06 --apply
 *
 * Reports per-game and aggregate coverage with reason codes. In apply
 * mode, dedupe-inserts recovered lines into the `lines` table.
 *
 * NEVER writes to `game_predictions`, `slate_status`, or `locked_at`.
 *
 * Two-key gate (matches the existing automodel-apply convention):
 *   `--apply` + `SHARP_LINES_RECOVERY_DB_WRITES_ENABLED=true`. Either
 *   missing → dry-run with a clear banner.
 */

import { auditMarketCoverage } from "../../lib/services/marketCoverageAudit";
import { supabase } from "../../lib/db/supabase";
import type { Sport } from "../../lib/types/domain/Sport";

type Args = {
  sport: Sport;
  date: string;
  apply: boolean;
  verbose: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  let sport: Sport = "mlb";
  let date: string | null = null;
  let apply = false;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--apply") { apply = true; continue; }
    if (a === "--verbose" || a === "-v") { verbose = true; continue; }
  }
  if (date === null) {
    console.error("Usage: audit-market-coverage.ts --sport mlb --date YYYY-MM-DD [--apply] [--verbose]");
    process.exit(1);
  }
  return { sport, date, apply, verbose };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function yn(b: boolean): string {
  return b ? "Y" : "n";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const envEnabled = process.env.SHARP_LINES_RECOVERY_DB_WRITES_ENABLED === "true";
  const willApply = opts.apply && envEnabled;

  console.log(`\n━━━ audit-market-coverage · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`  --apply flag:                              ${opts.apply ? "YES" : "no"}`);
  console.log(`  SHARP_LINES_RECOVERY_DB_WRITES_ENABLED:    ${envEnabled ? "true" : "missing"}`);
  console.log(`  mode:                                      ${willApply ? "APPLY (will INSERT recovered lines)" : "DRY-RUN (no DB writes)"}`);
  if (opts.apply && !envEnabled) {
    console.warn(`  ⚠ --apply was set but SHARP_LINES_RECOVERY_DB_WRITES_ENABLED is missing — forcing dry-run.`);
  }
  console.log("");

  const audit = await auditMarketCoverage({
    sport: opts.sport,
    date: opts.date,
    apply: willApply,
    supabase,
  });

  // ── Per-game table ─────────────────────────────────────────────
  console.log("Per-game coverage:");
  console.log("  ext       matchup     ML  Tot Sp  FI  recov?  candidate                                 ml.reason");
  console.log("  " + "─".repeat(125));
  for (const g of audit.games) {
    const ml = g.markets.moneyline;
    const tot = g.markets.total;
    const sp = g.markets.spread;
    const fi = g.markets.first_inning_total;
    const cand = ml.candidateUsed ?? tot.candidateUsed ?? sp.candidateUsed ?? fi.candidateUsed ?? "—";
    console.log(
      `  ${pad(String(g.externalId), 8)}  ${pad(g.matchup, 10)} ${pad(yn(ml.dbState.rowCount > 0), 3)} ${pad(yn(tot.dbState.rowCount > 0), 3)} ${pad(yn(sp.dbState.rowCount > 0), 3)} ${pad(yn(fi.dbState.rowCount > 0), 3)} ${pad(g.recovered ? "Y" : "n", 7)} ${pad(cand, 42)} ${ml.reason}`,
    );
    if (opts.verbose) {
      for (const [mk, m] of Object.entries(g.markets)) {
        console.log(
          `    ${pad(mk, 19)} rows=${m.dbState.rowCount} twoSided=${m.dbState.twoSided} books=[${m.dbState.books.join(",")}] q=${m.dbState.bookQuality} reason=${m.reason}`,
        );
      }
    }
  }

  // ── Aggregate ──────────────────────────────────────────────────
  console.log("\nAggregate:");
  const a = audit.aggregate;
  console.log(`  expected games:                            ${a.expectedGames}`);
  console.log(`  ML DB coverage:                            ${a.mlDbCoverage}/${a.expectedGames}`);
  console.log(`  ML AFTER recovery coverage:                ${a.mlAfterRecoveryCoverage}/${a.expectedGames}`);
  console.log(`  Total DB coverage:                         ${a.totalDbCoverage}/${a.expectedGames}`);
  console.log(`  Total AFTER recovery coverage:             ${a.totalAfterRecoveryCoverage}/${a.expectedGames}`);
  console.log(`  Spread DB coverage:                        ${a.spreadDbCoverage}/${a.expectedGames}`);
  console.log(`  FI DB coverage:                            ${a.fiDbCoverage}/${a.expectedGames}`);
  console.log(`  provider_has_data_db_missing:              ${a.providerHasDataDbMissing}`);
  console.log(`  provider_true_missing:                     ${a.providerTrueMissing}`);
  console.log(`  recovered count:                           ${a.recoveredCount}`);
  console.log(`  wrong_game_guard_rejected:                 ${a.rejectedWrongGameCount}`);
  console.log(`  parser_drop:                               ${a.parserDropCount}`);
  console.log(`  provider_error:                            ${a.providerErrorCount}`);
  console.log(`  rate_limited:                              ${a.rateLimitCount}`);
  console.log(`  rows inserted:                             ${a.rowsInserted}`);
  console.log(`  rows skipped as duplicate:                 ${a.rowsSkippedDuplicate}`);

  console.log("");
  console.log(willApply ? "  ✓ APPLY complete." : "  DRY RUN — no DB writes performed.");
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
