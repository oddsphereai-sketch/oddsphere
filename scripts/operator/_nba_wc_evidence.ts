import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
process.env.PRODUCTION_DATA_MODE=process.env.PRODUCTION_DATA_MODE??"true";
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  console.log("NOW UTC:", new Date().toISOString());
  // data_refresh_log recent runs (cron health)
  const {data:logs,error:lerr}=await sb.from("data_refresh_log").select("refresh_type,refresh_status,records_updated,started_at").gte("started_at","2026-06-13T00:00:00Z").order("started_at",{ascending:false}).limit(30);
  if(lerr) console.log("data_refresh_log err:",lerr.message);
  else { console.log(`\n=== data_refresh_log since 06-13 00:00 UTC (${logs?.length}) ===`);
    for(const r of logs??[]) console.log(`${new Date(r.started_at).toISOString()} ${(r.refresh_type||"").padEnd(26)} ${(r.refresh_status||"").padEnd(8)} rec=${r.records_updated}`); }
  // WC/soccer games today + yesterday
  const {data:wc}=await sb.from("games").select("id,external_id,slate_status,status,game_date,home_team_id,away_team_id,created_at").eq("sport","soccer").gte("game_date","2026-06-12T00:00:00Z").lte("game_date","2026-06-14T07:00:00Z").order("game_date");
  const ids=new Set<number>(); for(const r of wc??[]){if(r.home_team_id)ids.add(r.home_team_id);if(r.away_team_id)ids.add(r.away_team_id);}
  const {data:teams}=await sb.from("teams").select("id,abbreviation,name").in("id",[...ids]);
  const tm=new Map((teams??[]).map(t=>[t.id,t.name||t.abbreviation]));
  console.log(`\n=== soccer/WC games 06-12..06-14: ${(wc??[]).length} ===`);
  for(const r of wc??[]) console.log(`${new Date(r.game_date).toISOString()} ${r.slate_status.padEnd(9)} ${r.status.padEnd(10)} ${tm.get(r.away_team_id)??"?"} @ ${tm.get(r.home_team_id)??"?"} ext=${r.external_id}`);
  const wgids=(wc??[]).map(r=>r.id);
  if(wgids.length){
    const {data:pr}=await sb.from("prediction_records").select("market,sport").in("game_id",wgids);
    const by:Record<string,number>={}; for(const r of pr??[]) by[r.market]=(by[r.market]??0)+1;
    console.log(`prediction_records for those WC games: ${(pr??[]).length} by market=${JSON.stringify(by)}`);
  }
})().catch(e=>console.error("ERR",e?.message||e));
