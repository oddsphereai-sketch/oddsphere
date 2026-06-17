import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const P=(s:any,n:number)=>{const t=String(s??"—");return t.length>=n?t.slice(0,n):t+" ".repeat(n-t.length);};
(async()=>{
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{persistSession:false} });
  const nowIso = new Date().toISOString();
  console.log(`now=${nowIso}\n`);

  // today's MLB games
  const isoToday = nowIso.slice(0,10);
  const isoYest = new Date(Date.now()-864e5).toISOString().slice(0,10);
  const { data: games } = await sb.from("games")
    .select("id, home_team_id, away_team_id, game_date, slate_date, status")
    .eq("sport","mlb").in("slate_date",[isoYest,isoToday]).order("game_date");
  const tids=[...new Set((games??[]).flatMap(g=>[g.home_team_id,g.away_team_id]))];
  const { data: teams } = await sb.from("teams").select("id, abbreviation").in("id", tids);
  const tm=new Map((teams??[]).map(t=>[t.id,t.abbreviation]));
  const lbl=(g:any)=>`${tm.get(g.away_team_id)}@${tm.get(g.home_team_id)}`;

  // discover weather_forecasts columns
  const { data: wfOne } = await sb.from("weather_forecasts").select("*").limit(1);
  console.log("weather_forecasts cols:", Object.keys(wfOne?.[0]??{}).join(", "));
  const { data: bpOne } = await sb.from("ballparks").select("*").limit(1);
  console.log("ballparks cols:", Object.keys(bpOne?.[0]??{}).join(", "), "\n");

  console.log("=== WEATHER FORECAST FRESHNESS (today's MLB games) ===");
  console.log(`${P("game",10)}${P("temp",6)}${P("wind",10)}${P("notable",10)}${P("created_at",26)}updated_at`);
  for (const g of (games??[]).filter(g=>g.slate_date===isoToday)) {
    const { data: wf } = await sb.from("weather_forecasts").select("*").eq("game_id", g.id).order("created_at",{ascending:false}).limit(1);
    const w:any = wf?.[0];
    const ageH = w?.updated_at ? ((Date.now()-new Date(w.updated_at).getTime())/3600e3).toFixed(1)+"h" : (w?.created_at?((Date.now()-new Date(w.created_at).getTime())/3600e3).toFixed(1)+"h":"NONE");
    console.log(`${P(lbl(g),10)}${P(w?.temperature_f??w?.temp_f??w?.temperature,6)}${P((w?.wind_speed_mph??w?.wind_mph??w?.wind_speed)+" "+(w?.wind_direction??""),10)}${P(w?.notable_reason??(w?.is_notable?"notable":"no"),10)}${P(w?.created_at,26)}${w?.updated_at??"—"}  (age ${ageH})`);
  }

  console.log("\n=== AUTO_FACTORS park/weather (today's MLB slate) ===");
  console.log(`${P("game",10)}${P("park_factor",12)}${P("weather_adj",12)}is_dome?`);
  const parkVals:number[]=[]; const wxVals:number[]=[];
  for (const g of (games??[]).filter(g=>g.slate_date===isoToday)) {
    const { data: gp } = await sb.from("game_predictions").select("sport_specific").eq("game_id", g.id).limit(1);
    const af:any=(gp?.[0]?.sport_specific as any)?.auto_factors;
    const pf=af?.park_factor_runs, wx=af?.weather_total_adjust;
    if(typeof pf==="number") parkVals.push(pf);
    if(typeof wx==="number") wxVals.push(wx);
    console.log(`${P(lbl(g),10)}${P(pf,12)}${P(wx,12)}${af?.is_dome??"?"}`);
  }
  const uniq=(a:number[])=>[...new Set(a)];
  console.log(`\npark_factor_runs: ${parkVals.length} present, distinct=${JSON.stringify(uniq(parkVals))}`);
  console.log(`weather_total_adjust: ${wxVals.length} present, distinct=${JSON.stringify(uniq(wxVals))}`);

  console.log("\n=== ballparks park_factor_runs distribution ===");
  const { data: bps } = await sb.from("ballparks").select("name, park_factor_runs, is_dome").order("park_factor_runs",{ascending:false,nullsFirst:false});
  const nonNull=(bps??[]).filter(b=>b.park_factor_runs!=null);
  console.log(`ballparks total=${bps?.length}, with park_factor_runs=${nonNull.length}, null=${(bps?.length??0)-nonNull.length}`);
  console.log("  top5:", nonNull.slice(0,5).map(b=>`${b.name}=${b.park_factor_runs}`).join(", "));
  console.log("  bot5:", nonNull.slice(-5).map(b=>`${b.name}=${b.park_factor_runs}`).join(", "));
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
