import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // 1. Recent games per sport (any date), to see how far back NBA/NHL/soccer go
  for (const sport of ["nba", "nhl", "soccer", "mlb"]) {
    const { data } = await sb.from("games")
      .select("slate_date, slate_status").eq("sport", sport)
      .order("slate_date", { ascending: false }).limit(6);
    const rows = (data ?? []) as any[];
    console.log(`${sport}: most-recent slate_dates -> ${rows.map(r => `${r.slate_date}/${r.slate_status}`).join(", ") || "(none)"}`);
  }
  console.log("");

  // 2. prediction_records: what columns/linkage? sample one soccer + check fields
  const { data: prSample } = await sb.from("prediction_records")
    .select("*").eq("sport", "soccer").order("created_at", { ascending: false }).limit(2);
  console.log("=== soccer prediction_records sample (cols) ===");
  for (const p of (prSample ?? []) as any[]) {
    console.log("   keys:", Object.keys(p).join(", "));
    console.log(`   id=${p.id} game_id=${p.game_id} sport=${p.sport} slate_date=${p.slate_date} slate_status=${p.slate_status} market=${p.market} mv=${p.model_version}`);
    break;
  }
  console.log("");

  // 3. Count soccer prediction_records by slate_date
  const { data: prAll } = await sb.from("prediction_records")
    .select("slate_date, slate_status, market").eq("sport", "soccer")
    .order("slate_date", { ascending: false }).limit(60);
  const grp: Record<string, number> = {};
  for (const p of (prAll ?? []) as any[]) {
    const k = `${p.slate_date}|${p.slate_status ?? "null"}`;
    grp[k] = (grp[k] ?? 0) + 1;
  }
  console.log("=== soccer prediction_records by slate_date|status (recent 60) ===");
  for (const k of Object.keys(grp).sort().reverse()) console.log(`   ${k} -> ${grp[k]}`);
  console.log("");

  // 4. MLB prediction_records recent count
  const { data: mlbPr } = await sb.from("prediction_records")
    .select("slate_date").eq("sport", "mlb").order("slate_date", { ascending: false }).limit(5);
  console.log("mlb prediction_records most-recent slate_dates:", ((mlbPr ?? []) as any[]).map(r => r.slate_date).join(", ") || "(none)");

  // 5. data_refresh_log columns + any rows at all
  const { data: anyLog } = await sb.from("data_refresh_log").select("*").limit(2);
  console.log("\ndata_refresh_log sample:", JSON.stringify(anyLog));
}
main().catch((e) => { console.error(e); process.exit(1); });
