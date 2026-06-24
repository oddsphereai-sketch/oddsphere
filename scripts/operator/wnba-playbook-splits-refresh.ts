/**
 * WNBA Playbook public-splits refresh (operator runner).
 *
 * Ticket: o-wnba-playbook-splits (Step A). Fills sharp_signals public_* from
 * Playbook for PREGAME WNBA games so the existing UI shows bet%/money%/freshness.
 *
 * USAGE:
 *   # dry-run (default)
 *   npx tsx --env-file=.env.local scripts/operator/wnba-playbook-splits-refresh.ts [--date YYYY-MM-DD]
 *   # apply (two-key gate)
 *   AUTOMODEL_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \
 *     scripts/operator/wnba-playbook-splits-refresh.ts --date 2026-06-24 --write
 *
 * SAFETY: WNBA-only. Writes ONLY sharp_signals public_betting_pct/public_money_pct/
 * computed_at for scheduled (pregame) games. No grades/predictions/+EV/steam/RLM/
 * CLV/lines/movement. Key from PLAYBOOK_API_KEY only; never printed.
 */

import { supabase } from "../../lib/db/supabase";
import { readStringFlag, readBoolFlag, validateWriteGate } from "./_cliCommon";
import { currentSlateDate } from "../../lib/dates/slateDate";
import { refreshWnbaPlaybookSplits } from "../../lib/services/wnba/refreshWnbaPlaybookSplits";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const date = readStringFlag(argv, "--date") ?? currentSlateDate("wnba");
  const json = readBoolFlag(argv, "--json");
  const { writeMode } = validateWriteGate(argv); // --write + AUTOMODEL_DB_WRITES_ENABLED

  console.log(`[wnba-playbook-splits-refresh] date=${date} mode=${writeMode ? "APPLY" : "DRY-RUN"}`);
  if (!process.env.PLAYBOOK_API_KEY) { console.error("✗ PLAYBOOK_API_KEY not set."); process.exit(1); }

  const r = await refreshWnbaPlaybookSplits({ supabase, slateDate: date, apply: writeMode, logger: (m) => console.log("  " + m) });

  if (json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`\npregameGames=${r.pregameGames} playbookRowsForSlate=${r.playbookRowsForSlate} recordsMapped=${r.recordsMapped}`);
    console.log(`updated=${r.rowsUpdated} inserted=${r.rowsInserted} skippedUnmatched=${r.skippedUnmatched}`);
    for (const g of r.perGame) console.log(`  ${g.matchup}: ${g.markets.join(", ")}`);
    if (r.errors.length) { console.log("errors:"); for (const e of r.errors) console.log("  ✗ " + e); }
  }
  process.exit(r.errors.length ? 1 : 0);
}

main().catch((e) => { console.error(`FATAL: ${(e as Error).message}`); process.exit(2); });
