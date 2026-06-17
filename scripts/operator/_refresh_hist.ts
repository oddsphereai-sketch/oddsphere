import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data}=await sb.from("data_refresh_log").select("data_source,sport,refresh_status,records_updated,refresh_started_at,error_message").or("data_source.ilike.%nba%,data_source.ilike.%soccer%,data_source.ilike.%seed%").gte("refresh_started_at","2026-06-08T00:00:00Z").order("refresh_started_at",{ascending:false}).limit(40);
  console.log(`nba/soccer/seed refresh rows since 06-08: ${(data??[]).length}`);
  for(const r of data??[]) console.log(`${new Date(r.refresh_started_at).toISOString().slice(0,16)} ${(r.sport||"-").padEnd(7)} ${(r.data_source||"").padEnd(26)} ${(r.refresh_status||"").padEnd(8)} rec=${r.records_updated}${r.error_message?" ERR:"+r.error_message.slice(0,50):""}`);
})().catch(e=>console.error("ERR",e?.message||e));
