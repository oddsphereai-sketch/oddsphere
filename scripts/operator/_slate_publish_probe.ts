import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  for(const day of ["2026-06-13","2026-06-12","2026-06-11","2026-06-10","2026-06-09"]){
    const start=`${day}T00:00:00Z`, end=`${day}T23:59:59Z`;
    const {data}=await sb.from("games").select("id, sport, slate_status, status").gte("game_date",start).lte("game_date",end);
    const rows=data??[];
    const by:Record<string,Record<string,number>>={};
    for(const r of rows){ (by[r.sport] ??= {}); by[r.sport][r.slate_status]=(by[r.sport][r.slate_status]??0)+1; }
    const summary=Object.entries(by).map(([s,m])=>`${s}:{${Object.entries(m).map(([k,v])=>`${k}=${v}`).join(",")}}`).join("  ");
    console.log(`${day}  games=${rows.length}  ${summary||"(no games)"}`);
  }
  // how many of today's games have predictions?
  for(const day of ["2026-06-13","2026-06-12"]){
    const start=`${day}T00:00:00Z`, end=`${day}T23:59:59Z`;
    const {data:g}=await sb.from("games").select("id").gte("game_date",start).lte("game_date",end);
    const ids=(g??[]).map(r=>r.id);
    if(ids.length===0){ console.log(`${day} predictions: (no games)`); continue; }
    const {data:p}=await sb.from("game_predictions").select("game_id, locked_at, computed_at").in("game_id",ids);
    console.log(`${day} games=${ids.length} predictions=${(p??[]).length} locked=${(p??[]).filter(r=>r.locked_at).length}`);
  }
})();
