import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const SLATE = "2026-06-12";
  const { data: games } = await sb.from("games").select("id").eq("sport","mlb").eq("slate_date",SLATE);
  const gameIds = (games??[]).map((g:any)=>g.id);

  // exact match query in route (3749-3755): no explicit limit
  const { data: hist } = await sb.from("line_history")
    .select("game_id, market_type, sportsbook, side, line_value, odds_american, recorded_at")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline","total","first_inning_total"])
    .is("player_id", null)
    .order("recorded_at", { ascending: true });
  console.log("Slate line_history query returned rows:", (hist??[]).length);

  // total count via head
  const { count } = await sb.from("line_history")
    .select("*", { count: "exact", head: true })
    .in("game_id", gameIds)
    .in("market_type", ["moneyline","total","first_inning_total"])
    .is("player_id", null);
  console.log("Actual total matching rows in DB:", count);

  // does the returned set contain betmgm moneyline for HOU@KC (15774)?
  const betmgm = (hist??[]).filter((r:any)=>r.game_id===15774 && r.market_type==="moneyline" && r.sportsbook==="betmgm");
  console.log("betmgm ML rows for HOU@KC in RETURNED set:", betmgm.length);

  // same current lines query (no limit)
  const { data: lines } = await sb.from("lines")
    .select("game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at")
    .in("game_id", gameIds)
    .in("market_type", ["moneyline","total","first_inning_total"])
    .is("player_id", null);
  console.log("Slate lines query returned rows:", (lines??[]).length);
  const { count: lc } = await sb.from("lines").select("*",{count:"exact",head:true})
    .in("game_id", gameIds).in("market_type",["moneyline","total","first_inning_total"]).is("player_id", null);
  console.log("Actual total lines rows in DB:", lc);
})().then(()=>process.exit(0));
