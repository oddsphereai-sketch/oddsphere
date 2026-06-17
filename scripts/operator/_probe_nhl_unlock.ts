import { supabase } from "../../lib/db/supabase";
async function main() {
  const { error } = await supabase
    .from("prediction_records")
    .update({ locked_at: null })
    .eq("sport", "nhl")
    .eq("slate_date", "2026-06-09");
  if (error) { console.error(error.message); process.exit(1); }
  console.log("✓ restored locked_at=null for NHL test records");
}
main().catch(e => { console.error(e); process.exit(1); });
