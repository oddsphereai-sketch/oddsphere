import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{const {createClient}=await import("@supabase/supabase-js");const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const {data}=await sb.from("games").select("status, home_score, away_score, game_date").eq("sport","soccer").order("game_date");
const counts:Record<string,number>={};for(const g of data??[])counts[g.status]=(counts[g.status]??0)+1;
console.log("soccer status counts:",JSON.stringify(counts));
console.log("rows:",JSON.stringify((data??[]).map(g=>({s:g.status,h:g.home_score,a:g.away_score,d:g.game_date?.slice(0,10)}))));
})().then(()=>process.exit(0));
