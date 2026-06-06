/**
 * Push 4 operator — fetch final scores from BDL and update games.
 *
 * USAGE:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/ingest-final-scores.ts --sport mlb --date 2026-06-06
 *
 *   Apply:
 *     SCORE_INGEST_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/ingest-final-scores.ts --sport mlb --date 2026-06-06 --apply
 *
 * NEVER modifies game_predictions / slate_status / locked_at. Only
 * updates `games.status`, `games.home_score`, `games.away_score`.
 *
 * First-inning scores are NOT populated by this script (BDL's V1
 * endpoint doesn't expose inning splits). Use `manual-grade-slate.ts`
 * to enter FI scores for the grader.
 */

import { supabase } from "../../lib/db/supabase";
import { ingestFinalScores } from "../../lib/services/scoreIngestService";
import type { Sport } from "../../lib/types/domain/Sport";

type Args = { sport: Sport; date: string; apply: boolean };

function parseArgs(argv: readonly string[]): Args {
  let sport: Sport = "mlb";
  let date: string | null = null;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--date" && argv[i + 1]) { date = argv[++i]!; continue; }
    if (a === "--apply") { apply = true; continue; }
  }
  if (date === null) {
    console.error("Usage: ingest-final-scores.ts --sport mlb --date YYYY-MM-DD [--apply]");
    process.exit(1);
  }
  return { sport, date, apply };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const envEnabled = process.env.SCORE_INGEST_DB_WRITES_ENABLED === "true";
  const willApply = opts.apply && envEnabled;

  console.log(`\n━━━ ingest-final-scores · ${opts.sport.toUpperCase()} ${opts.date} ━━━`);
  console.log(`  --apply flag:                          ${opts.apply ? "YES" : "no"}`);
  console.log(`  SCORE_INGEST_DB_WRITES_ENABLED:        ${envEnabled ? "true" : "missing"}`);
  console.log(`  mode:                                  ${willApply ? "APPLY (will UPDATE games)" : "DRY-RUN (no DB writes)"}`);
  console.log("");

  const result = await ingestFinalScores({
    sport: opts.sport,
    slateDate: opts.date,
    apply: willApply,
    supabase,
  });

  console.log(`Games scanned:           ${result.gamesScanned}`);
  console.log(`  final:                 ${result.finalCount}`);
  console.log(`  in progress:           ${result.inProgressCount}`);
  console.log(`  scheduled:             ${result.scheduledCount}`);
  console.log(`  void (postp/cancel):   ${result.voidCount}`);
  console.log(`  updated:               ${result.updatedCount}`);
  if (result.errors.length > 0) {
    console.log(`  errors:                ${result.errors.length}`);
    for (const e of result.errors) {
      console.log(`    ext=${e.external_id ?? "?"}: ${e.reason}`);
    }
  }

  console.log("\nPer-game:");
  console.log("  ext       matchup    before                 →  after                  action");
  console.log("  " + "─".repeat(95));
  for (const g of result.perGame) {
    const before = `${g.before_status ?? "—"}${g.home_score !== null && g.away_score !== null ? ` ${g.home_score}-${g.away_score}` : ""}`;
    const after = `${g.after_status ?? "—"}${g.home_score !== null && g.away_score !== null ? ` ${g.home_score}-${g.away_score}` : ""}`;
    console.log(
      `  ${String(g.external_id).padEnd(8)}  ${g.matchup.padEnd(10)} ${before.padEnd(22)} →  ${after.padEnd(22)} ${g.action}${g.reason ? ` (${g.reason})` : ""}`,
    );
  }

  console.log(willApply ? "\n✓ APPLIED" : "\nDRY-RUN — no DB writes performed.");
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
