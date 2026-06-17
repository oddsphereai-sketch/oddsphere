import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local","utf8");
for (const line of envFile.split("\n")){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
const P=(s:any,n:number)=>{const t=String(s??"—");return t.length>=n?t.slice(0,n):t+" ".repeat(n-t.length);};
(async()=>{
  const { createClient } = await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const now=Date.now();
  // most recent fetched_at across the whole table = when weather last ran
  const { data: latest } = await sb.from("weather_forecasts").select("fetched_at, created_at, forecast_for").order("fetched_at",{ascending:false}).limit(5);
  console.log("=== 5 most-recent weather_forecasts by fetched_at ===");
  for(const r of latest??[]) console.log(`  fetched_at=${P(r.fetched_at,28)} created_at=${P(r.created_at,28)} forecast_for=${r.forecast_for}`);
  const newest = latest?.[0]?.fetched_at;
  if(newest) console.log(`\n  newest fetched_at age = ${((now-new Date(newest).getTime())/3600e3).toFixed(2)}h ago`);

  // today's games: fetched_at per game + how many forecast rows per game
  const isoToday=new Date(now).toISOString().slice(0,10);
  const { data: games } = await sb.from("games").select("id, home_team_id, away_team_id, game_date").eq("sport","mlb").eq("slate_date",isoToday).order("game_date");
  const tids=[...new Set((games??[]).flatMap(g=>[g.home_team_id,g.away_team_id]))];
  const { data: teams } = await sb.from("teams").select("id, abbreviation").in("id",tids);
  const tm=new Map((teams??[]).map(t=>[t.id,t.abbreviation]));
  console.log("\n=== per-game forecast freshness (today) ===");
  console.log(`${P("game",10)}${P("#rows",6)}${P("fetched_at(latest)",28)}age`);
  for(const g of games??[]){
    const { data: wf, count } = await sb.from("weather_forecasts").select("fetched_at",{count:"exact"}).eq("game_id",g.id).order("fetched_at",{ascending:false});
    const f=wf?.[0]?.fetched_at;
    const age=f?((now-new Date(f).getTime())/3600e3).toFixed(1)+"h":"—";
    console.log(`${P(tm.get(g.away_team_id)+"@"+tm.get(g.home_team_id),10)}${P(count,6)}${P(f,28)}${age}`);
  }
  // distinct fetched_at values today (did >1 cron write?)
  const { data: allToday } = await sb.from("weather_forecasts").select("fetched_at, game_id").in("game_id",(games??[]).map(g=>g.id));
  const distinct=[...new Set((allToday??[]).map(r=>r.fetched_at))].sort();
  console.log(`\ndistinct fetched_at timestamps today: ${distinct.length}`);
  for(const d of distinct) console.log(`  ${d}  (${((now-new Date(d).getTime())/3600e3).toFixed(1)}h ago)`);
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
