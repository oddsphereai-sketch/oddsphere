import { supabase } from "../../lib/db/supabase";
async function main() {
  const { data } = await supabase
    .from("teams")
    .select("*")
    .in("id", [831, 832, 835, 836]);
  for (const t of (data ?? []) as any[]) {
    console.log(JSON.stringify(t, null, 2));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
