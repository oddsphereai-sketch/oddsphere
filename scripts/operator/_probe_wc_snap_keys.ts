/** READ-ONLY. Dump the full snapshot_json for one CZE@KOR record. */
import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const { data } = await supabase
    .from("prediction_records")
    .select("id, market, pick, snapshot_json")
    .eq("game_id", 15721);
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    console.log(`\n── id=${r.id} ${r.market}/${r.pick} ──`);
    const snap = r.snapshot_json ?? {};
    console.log(JSON.stringify(snap, null, 2));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
