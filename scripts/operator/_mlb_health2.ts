import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
process.env.PRODUCTION_DATA_MODE=process.env.PRODUCTION_DATA_MODE??"true";
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data:g}=await sb.from("games").select("id,external_id,home_pitcher_id,away_pitcher_id,home_team_id,away_team_id").eq("sport","mlb").gte("game_date","2026-06-13T12:00:00Z").lte("game_date","2026-06-14T07:00:00Z");
  const ids=(g??[]).map(r=>r.id);
  const {data:p}=await sb.from("game_predictions").select("game_id,predicted_nrfi,nrfi_confidence,sport_specific,computed_at").in("game_id",ids);
  let weatherStale=0,weatherMissing=0,fiHeldReasons:string[]=[],starterMiss:string[]=[];
  const {data:teams}=await sb.from("teams").select("id,abbreviation").in("id",[...new Set((g??[]).flatMap(r=>[r.home_team_id,r.away_team_id]))]);
  const tm=new Map((teams??[]).map(t=>[t.id,t.abbreviation]));
  for(const r of g??[]){ if(r.home_pitcher_id==null||r.away_pitcher_id==null) starterMiss.push(`${tm.get(r.away_team_id)}@${tm.get(r.home_team_id)} (home=${r.home_pitcher_id??"NULL"} away=${r.away_pitcher_id??"NULL"})`); }
  for(const r of p??[]){
    const sp=(r.sport_specific??{}) as any;
    const af=sp.auto_factors??{}; const w=af.weather??sp.weather;
    if(sp.weather_stale===true||af.weather_stale===true) weatherStale++;
    const fi=sp.fi_v2_audit;
    if(r.predicted_nrfi===null||sp.fi_v2_audit?.fi_pick==="Held") fiHeldReasons.push(`g${r.game_id}: ${fi?.fi_play_grade_reason??fi?.fi_pick_reason??"nrfi=null"}`);
  }
  console.log(`MLB games=${ids.length} predictions=${(p??[]).length}`);
  console.log(`starters missing (${starterMiss.length}):`, JSON.stringify(starterMiss));
  console.log(`weather_stale flagged=${weatherStale}`);
  console.log(`FI held/null (${fiHeldReasons.length}):`, JSON.stringify(fiHeldReasons));
  // lock + freshness
  const newest=Math.max(...(p??[]).map(r=>new Date(r.computed_at).getTime()));
  console.log(`newest prediction computed_at: ${new Date(newest).toISOString()}`);
})().catch(e=>console.error("ERR",e?.message||e));
