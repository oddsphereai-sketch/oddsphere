/**
 * One-off: clear stale locked_at on today's soccer prediction_records
 * so the writer can upsert the corrected (null) value.
 */
import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const date = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("prediction_records")
    .update({ locked_at: null })
    .eq("sport", "soccer")
    .eq("model_version", "soccer_dixon_coles_v1")
    .eq("slate_date", date)
    .select("id");
  if (error !== null) throw new Error(error.message);
  console.log(`Cleared locked_at on ${(data ?? []).length} soccer row(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
