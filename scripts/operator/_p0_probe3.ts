import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  const today = new Date().toISOString().slice(0,10);
  // sanity-check: are there ANY predictions today for any sport?
  const { count: predCount } = await sb.from("prediction_records").select("*", { count: "exact", head: true }).gte("created_at", today);
  console.log(`prediction_records created today (any sport): ${predCount}`);
  const { count: anyPred } = await sb.from("prediction_records").select("*", { count: "exact", head: true });
  console.log(`prediction_records total (all time):           ${anyPred}`);
  // most recent prediction_record:
  const { data: recent } = await sb.from("prediction_records").select("id, game_id, market, pick, locked_at, updated_at, snapshot_json").order("updated_at", { ascending: false }).limit(5);
  console.log("\nmost recent 5 prediction_records (any sport):");
  for (const r of (recent ?? []) as any[]) {
    const sport = r.snapshot_json?.competition ?? r.snapshot_json?.model_version ?? "?";
    console.log(`  pr${r.id} g${r.game_id} ${r.market} pick=${r.pick} updated=${r.updated_at} mv/comp=${sport}`);
  }
  // most recent SOCCER prediction_record specifically:
  console.log("\nany prediction_record where snapshot_json.competition='fifa_world_cup':");
  const { data: fwc } = await sb.from("prediction_records").select("id, game_id, market, pick, locked_at, updated_at, snapshot_json").order("updated_at", { ascending: false }).limit(10);
  let found = 0;
  for (const r of (fwc ?? []) as any[]) {
    if (r.snapshot_json?.competition === "fifa_world_cup") {
      console.log(`  pr${r.id} g${r.game_id} ${r.market} pick=${r.pick} updated=${r.updated_at}`);
      found++;
    }
  }
  if (found === 0) console.log("  (none in top 10 most recent)");

  // What does the soccer slate look like in the games table — maybe there's a different game_id mapping?
  console.log("\nALL games where home or away team abbreviation is BIH, CAN, PAR, USA, or sport=soccer:");
  const { data: teamsByAbbr } = await sb.from("teams").select("id, abbreviation").in("abbreviation", ["BIH","CAN","PAR","USA"]);
  for (const t of (teamsByAbbr ?? []) as any[]) console.log(`  team ${t.abbreviation} id=${t.id}`);
}
main().catch(e => { console.error(e); process.exit(1); });
