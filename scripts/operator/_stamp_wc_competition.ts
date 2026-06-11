/**
 * One-off: stamp `competition: 'fifa_world_cup'` into snapshot_json
 * on existing soccer prediction_records that were written before the
 * discriminator was wired. Idempotent — already-stamped rows are
 * skipped.
 *
 * Run before the WC-4 preview deploy so the filter at the adapter
 * works correctly even after future UCL rows land with their own
 * competition value.
 */
import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const today = new Date().toISOString().split("T")[0];

  const { data: rows } = await supabase
    .from("prediction_records")
    .select("id, market, snapshot_json")
    .eq("sport", "soccer")
    .eq("slate_date", today);
  const list = (rows ?? []) as Array<{ id: number; market: string; snapshot_json: Record<string, unknown> | null }>;
  console.log(`Found ${list.length} soccer prediction_records on ${today}`);

  let updated = 0;
  let alreadyStamped = 0;
  for (const r of list) {
    const sj = r.snapshot_json ?? {};
    const existing = (sj as { competition?: string }).competition;
    if (existing === "fifa_world_cup") {
      alreadyStamped += 1;
      continue;
    }
    const next = { ...sj, competition: "fifa_world_cup" };
    console.log(`  pr.id=${r.id} market=${r.market}  competition: ${existing ?? "(missing)"} → fifa_world_cup`);
    if (!apply) continue;
    const { error } = await supabase
      .from("prediction_records")
      .update({ snapshot_json: next })
      .eq("id", r.id);
    if (error !== null) console.log(`    ✗ ${error.message}`);
    else updated += 1;
  }
  console.log(`\nSummary: total=${list.length}  already_stamped=${alreadyStamped}  updated=${updated}  mode=${apply ? "APPLY" : "DRY-RUN"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
