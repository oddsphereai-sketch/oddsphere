/**
 * Phase 6B.23 — manually trigger MLB Stats linescore ingest (now writes
 * status + scores when game is Final). Safe: same code path the cron runs.
 */
import { createClient } from "@supabase/supabase-js";
import { ingestMlbLinescores } from "../../lib/services/mlbLinescoreIngestService";

async function main() {
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  console.log(`\nRunning ingestMlbLinescores for ${date} (apply=true)...`);
  const res = await ingestMlbLinescores({ date, apply: true, supabase: sb as any });
  console.log(`\nResult: fetched=${res.mlbGamesFetched} updated=${res.updatedCount} skipped=${res.skippedCount} errors=${res.errorCount}`);
  for (const p of res.perGame) {
    if (p.action !== "noop" && p.action !== "skipped") {
      console.log(`  ${p.matchup} g=${p.game_id} mlb_status=${p.mlb_status} norm=${p.normalized_status} fi=${p.fi_total} → ${p.action}${p.reason ? ` (${p.reason})` : ""}`);
    }
  }
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
