import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  // BIH@CAN and PAR@USA game ids
  const { data: games } = await sb.from("games").select("id, home_team_id, away_team_id, game_date, status").eq("sport","soccer").in("slate_date",["2026-06-12"]).order("game_date");
  console.log("games:", JSON.stringify(games));
  const { data: pr } = await sb.from("prediction_records").select("*").eq("game_id", games![0].id).limit(1);
  console.log("\nprediction_records COLUMNS:", Object.keys(pr?.[0] ?? {}).join(", "));
  const { data: lh } = await sb.from("line_history").select("*").eq("game_id", games![0].id).limit(1);
  console.log("\nline_history COLUMNS:", Object.keys(lh?.[0] ?? {}).join(", "));
  const { data: ln } = await sb.from("lines").select("*").eq("game_id", games![0].id).limit(1);
  console.log("\nlines COLUMNS:", Object.keys(ln?.[0] ?? {}).join(", "));
})().then(()=>process.exit(0));
