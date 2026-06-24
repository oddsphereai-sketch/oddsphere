/**
 * Dual-source public splits — Phase 1 observation SYNC runner (operator).
 *
 * Ticket: o-dual-splits-observation-layer. Writes ONLY public_splits_observations
 * (additive). No sharp_signals/grade/model/UI/cron change. Graceful if the
 * table isn't applied yet (schema-migration-v25.sql).
 *
 * USAGE:
 *   # dry-run (default) — shows what WOULD be written
 *   npx tsx --env-file=.env.local scripts/operator/dual-splits-observation-sync.ts --sport mlb --date 2026-06-24
 *   # apply (two-key gate)
 *   AUTOMODEL_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \
 *     scripts/operator/dual-splits-observation-sync.ts --sport mlb --date 2026-06-24 --write
 */

import { supabase } from "../../lib/db/supabase";
import { readStringFlag, validateWriteGate, todayUTC } from "./_cliCommon";
import { syncPublicSplitsObservations } from "../../lib/services/syncPublicSplitsObservations";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sport = (readStringFlag(argv, "--sport") ?? "mlb").toLowerCase();
  const date = readStringFlag(argv, "--date") ?? todayUTC();
  const { writeMode } = validateWriteGate(argv);
  console.log(`[dual-splits-observation-sync] sport=${sport} date=${date} mode=${writeMode ? "APPLY" : "DRY-RUN"}`);

  const r = await syncPublicSplitsObservations({ supabase, sport, slateDate: date, apply: writeMode, todayUtc: todayUTC(), logger: (m) => console.log("  " + m) });
  console.log(`\nsharpapiRows=${r.sharpapiRows} playbookRows=${r.playbookRows} upserted=${r.upserted} tableMissing=${r.skippedTableMissing}`);
  if (r.errors.length) { console.log("errors:"); for (const e of r.errors) console.log("  ✗ " + e); }
  if (r.skippedTableMissing) console.log("\n→ apply lib/db/schema-migration-v25.sql first, then re-run with --write.");
  process.exit(r.errors.length ? 1 : 0);
}

main().catch((e) => { console.error(`FATAL: ${(e as Error).message}`); process.exit(2); });
