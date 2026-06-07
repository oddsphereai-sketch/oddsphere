/**
 * URGENT one-shot. Backfills today's locked FI prediction_records
 * where snapshot_json.nrfi_decision_kind === "toss_up" so the
 * member-facing Toss-Up pill is preserved on the tracking row.
 *
 * Strict scope:
 *   • Only today's slate_date
 *   • Only market='first_inning'
 *   • Only rows where prediction_type IS NULL (not yet marked)
 *   • Only rows where snapshot_json.nrfi_decision_kind = 'toss_up'
 *   • Sets pick='Toss-Up', prediction_type='toss_up', no_bet=true,
 *     side=null, no_bet_reason='non-actionable: locked pill was Toss-Up'
 *   • Does NOT touch confidence / line_value / odds_american /
 *     model_probability / market_probability / edge / best_angle /
 *     play_grade / snapshot_json / locked_at / launch_day / any
 *     prediction_grades row
 *   • Dry-run by default; pass --apply to commit
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SLATE_DATE = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10);

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log(`\n=== Backfill toss-up FI rows for ${SLATE_DATE} (apply=${APPLY}) ===\n`);

  const { data: rows, error } = await sb
    .from("prediction_records")
    .select("id, game_id, market, pick, side, prediction_type, no_bet, snapshot_json")
    .eq("sport", "mlb")
    .eq("slate_date", SLATE_DATE)
    .eq("market", "first_inning")
    .is("prediction_type", null);
  if (error) throw error;
  const all = (rows ?? []) as any[];
  console.log(`Total FI rows with prediction_type=NULL: ${all.length}`);

  const tossUps = all.filter((r) => {
    const sp = (r.snapshot_json ?? {}) as any;
    return sp.nrfi_decision_kind === "toss_up";
  });
  console.log(`Of those, snapshot_json.nrfi_decision_kind='toss_up': ${tossUps.length}`);

  if (tossUps.length === 0) {
    console.log("Nothing to do. Exiting cleanly.");
    return;
  }

  let updates = 0;
  for (const r of tossUps) {
    console.log(`  rec_id=${r.id} game=${r.game_id}: pick "${r.pick}" → "Toss-Up"; no_bet=false → true`);
    if (!APPLY) continue;
    const { error: upErr } = await sb
      .from("prediction_records")
      .update({
        pick: "Toss-Up",
        side: null,
        prediction_type: "toss_up",
        no_bet: true,
        no_bet_reason: "non-actionable: locked pill was Toss-Up",
      })
      .eq("id", r.id)
      .eq("market", "first_inning")          // defense-in-depth
      .is("prediction_type", null)           // defense-in-depth (don't re-touch)
      .eq("no_bet", false);                  // defense-in-depth
    if (upErr) {
      console.error(`    ✗ ${upErr.message}`);
    } else {
      updates++;
    }
  }

  console.log(`\nDone — applied=${updates} of ${tossUps.length} candidates`);
  if (!APPLY) console.log(`(dry-run; pass --apply to commit)`);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
