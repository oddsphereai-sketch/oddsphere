import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  // Today's ET slate window: 06-13 12:00 UTC (8am ET) through 06-14 07:00 UTC (3am ET) — covers late west-coast games.
  const {data}=await sb.from("games").select("external_id,slate_status,status,game_date,created_at").eq("sport","mlb").gte("game_date","2026-06-13T12:00:00Z").lte("game_date","2026-06-14T07:00:00Z").order("game_date");
  console.log(`MLB games in today's ET slate window: ${(data??[]).length}`);
  let draft=0,pub=0;
  for(const r of data??[]){ if(r.slate_status==="draft")draft++; else pub++;
    console.log(`${new Date(r.game_date).toISOString()} ${r.slate_status.padEnd(9)} ${r.status.padEnd(16)} created=${new Date(r.created_at).toISOString()}`);}
  console.log(`\ndraft=${draft} published=${pub}`);
})();
