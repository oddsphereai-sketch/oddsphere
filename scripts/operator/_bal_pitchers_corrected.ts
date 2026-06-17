import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  // Correct query: is_pitcher=true (not primary_position)
  const { data: balPitchers } = await sb.from("players")
    .select("id, full_name, position_abbr, mlb_person_id, active")
    .eq("team_id", 754).eq("is_pitcher", true);
  console.log(`BAL pitchers in DB: ${(balPitchers ?? []).length}`);
  for (const p of (balPitchers ?? []) as any[]) console.log(`  id=${p.id} ${p.full_name} pos=${p.position_abbr} mlb_id=${p.mlb_person_id} active=${p.active}`);

  // Recent BAL pitchers used as home_pitcher_id in prior slates
  const { data: recentBalGames } = await sb.from("games")
    .select("id, slate_date, home_pitcher_id, home_team_id")
    .eq("sport", "mlb").eq("home_team_id", 754).not("home_pitcher_id", "is", null)
    .order("slate_date", { ascending: false }).limit(5);
  console.log(`\nRecent BAL home games with home_pitcher_id set:`);
  for (const g of (recentBalGames ?? []) as any[]) {
    const { data: p } = await sb.from("players").select("full_name").eq("id", g.home_pitcher_id).maybeSingle();
    console.log(`  game=${g.id} slate=${g.slate_date} starter=${(p as any)?.full_name ?? "?"}`);
  }

  // Slate ingest history for today
  const { data: slateRuns } = await sb.from("data_refresh_log")
    .select("data_source, refresh_status, refresh_started_at, records_updated, error_message, details")
    .eq("data_source", "starter_refresh").order("refresh_started_at", { ascending: false }).limit(3);
  console.log(`\nLast 3 starter_refresh runs (if data_source exists):`);
  for (const r of (slateRuns ?? []) as any[]) console.log(`  ${r.refresh_started_at?.slice(0,19)} ${r.refresh_status} rec=${r.records_updated}`);
}
main();
