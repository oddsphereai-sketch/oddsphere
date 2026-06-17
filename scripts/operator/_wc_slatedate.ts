import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data}=await sb.from("games").select("external_id,game_date,slate_date").eq("sport","soccer").in("external_id",[5,6,7]);
  for(const r of data??[]) console.log(`ext=${r.external_id} game_date=${new Date(r.game_date).toISOString()} slate_date=${r.slate_date}`);
})().catch(e=>console.error("ERR",e?.message||e));
