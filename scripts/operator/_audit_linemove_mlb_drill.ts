import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const SLATE = "2026-06-12";

  // HOU@KC and SD@BAL game ids
  const { data: games } = await sb.from("games").select("id, home_team_id, away_team_id").eq("sport","mlb").eq("slate_date",SLATE);
  const { data: teams } = await sb.from("teams").select("id, abbreviation");
  const tm = new Map((teams??[]).map((t:any)=>[t.id,t.abbreviation]));
  const find = (a:string,h:string)=> (games??[]).find((g:any)=>tm.get(g.away_team_id)===a&&tm.get(g.home_team_id)===h);

  for (const [a,h,mk,side] of [["HOU","KC","moneyline","home"],["SD","BAL","total","over"],["COL","ATH","first_inning_total","under"]] as any) {
    const g:any = find(a,h);
    console.log(`\n=== ${a}@${h} ${mk} pickedSide=${side} (game ${g.id}) ===`);
    const { data: cur } = await sb.from("lines").select("sportsbook, side, odds_american, line_value").eq("game_id",g.id).eq("market_type",mk).is("player_id",null);
    console.log("CURRENT lines:");
    for (const r of (cur??[]) as any[]) console.log(`  book=${r.sportsbook} side=${r.side} odds=${r.odds_american} line=${r.line_value}`);
    const { data: hist } = await sb.from("line_history").select("sportsbook, side, odds_american, recorded_at").eq("game_id",g.id).eq("market_type",mk).is("player_id",null).order("recorded_at",{ascending:true});
    console.log("HISTORY openers (oldest per book@pickedSide):");
    const seen = new Set<string>();
    for (const r of (hist??[]) as any[]) {
      if (r.side !== side) continue;
      if (seen.has(r.sportsbook)) continue; seen.add(r.sportsbook);
      console.log(`  book=${r.sportsbook} side=${r.side} odds=${r.odds_american} at=${r.recorded_at}`);
    }
  }

  // COL@ATH game_predictions FI
  const col:any = find("COL","ATH");
  const { data: gp } = await sb.from("game_predictions").select("predicted_nrfi, nrfi_confidence, sport_specific").eq("game_id", col.id).limit(1);
  const sp = gp?.[0]?.sport_specific as any;
  console.log(`\nCOL@ATH predicted_nrfi=${JSON.stringify(gp?.[0]?.predicted_nrfi)} nrfi_conf=${gp?.[0]?.nrfi_confidence} held=${sp?.held} hold_picks=${JSON.stringify(sp?.hold_picks)} hold_reason=${sp?.hold_reason}`);
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
