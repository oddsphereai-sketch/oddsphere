import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  for (const pid of [13959, 13962]) {
    const { data } = await supabase
      .from("players")
      .select("id, external_id, mlb_person_id, full_name, first_name, last_name, team_id, throws, primary_position")
      .eq("id", pid)
      .maybeSingle();
    console.log(`pid=${pid}: ${JSON.stringify(data)}`);
  }

  console.log("\nLast-name lookups (Perez, Kay):");
  for (const last of ["Perez", "Kay"]) {
    const { data } = await supabase
      .from("players")
      .select("id, mlb_person_id, full_name, team_id")
      .eq("last_name", last)
      .eq("primary_position", "P")
      .limit(8);
    const list = (data ?? []) as Array<{ id: number; mlb_person_id: number | null; full_name: string; team_id: number | null }>;
    console.log(`  ${last} pitchers: ${list.length}`);
    list.forEach((p) => console.log(`    id=${p.id} mlb=${p.mlb_person_id} name="${p.full_name}" team_id=${p.team_id}`));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
