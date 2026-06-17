import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  console.log("=== by mlb_person_id (resolver path) ===");
  for (const mlb of [641743, 527048]) {
    const { data } = await supabase
      .from("players")
      .select("*")
      .eq("mlb_person_id", mlb);
    const list = (data ?? []) as Array<Record<string, unknown>>;
    console.log(`mlb_person_id=${mlb}: ${list.length} rows`);
    list.forEach((p) => console.log("  " + JSON.stringify({ id: p.id, mlb_person_id: p.mlb_person_id, full_name: p.full_name, first_name: p.first_name, last_name: p.last_name, team_id: p.team_id, primary_position: p.primary_position })));
  }

  console.log("\n=== sample row (any pitcher) to see column shape ===");
  const { data: sample } = await supabase
    .from("players")
    .select("*")
    .eq("primary_position", "P")
    .limit(1);
  console.log(JSON.stringify(sample, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
