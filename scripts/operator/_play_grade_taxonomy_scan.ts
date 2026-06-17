/**
 * Read-only: count distinct play_grade values present in
 * prediction_records across the entire history. Tells us the de-facto
 * production taxonomy independent of any code enum.
 */
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  // distinct play_grade × market with counts
  const { data } = await sb
    .from("prediction_records")
    .select("market, play_grade, no_bet")
    .order("market");
  if (!data) { console.log("no rows"); return; }
  const buckets = new Map<string, number>();
  for (const r of data as any[]) {
    const key = `${r.market}::play_grade=${r.play_grade ?? "(null)"}::no_bet=${r.no_bet ?? false}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  console.log("All-time play_grade × market × no_bet distribution:\n");
  const rows = Array.from(buckets.entries()).sort();
  for (const [k, v] of rows) console.log(`  ${String(v).padStart(5)}  ${k}`);
}
main();
