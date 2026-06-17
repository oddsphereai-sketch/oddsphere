import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  // 1. What columns does players table actually have?
  const { data: any1 } = await sb.from("players").select("*").limit(1);
  console.log("players sample row keys:", any1?.[0] ? Object.keys(any1[0]) : "no rows at all!");
  // 2. Count total players
  const { count } = await sb.from("players").select("id", { count: "exact", head: true });
  console.log("total players count:", count);
  // 3. Search for any BAL identifier — by team abbreviation
  const { data: teams } = await sb.from("teams").select("id, abbreviation, name").or("abbreviation.eq.BAL,name.ilike.%Baltimore%,name.ilike.%Orioles%");
  console.log("BAL teams in DB:", teams);
  // 4. SEA away pitcher
  const { data: seaPitcher } = await sb.from("players").select("*").eq("id", 14303).maybeSingle();
  console.log("player id=14303 (claimed SEA away):", seaPitcher);
  // 5. NYY away pitcher (working reference)
  const { data: g14950 } = await sb.from("games").select("away_pitcher_id, home_pitcher_id").eq("id", 14950).maybeSingle();
  console.log("game 14950 (NYY@CLE) pitcher ids:", g14950);
  if ((g14950 as any)?.away_pitcher_id) {
    const { data: nyyP } = await sb.from("players").select("id, full_name, primary_position, team_id, mlb_id").eq("id", (g14950 as any).away_pitcher_id).maybeSingle();
    console.log("  NYY away pitcher row:", nyyP);
  }
  // 6. Sample pitchers in players
  const { data: anyP } = await sb.from("players").select("id, full_name, primary_position, team_id, mlb_id").limit(5);
  console.log("first 5 players:", anyP);
}
main();
