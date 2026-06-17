import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  for(const gid of [15754]){
    console.log(`=== game ${gid} btts lines by sportsbook ===`);
    const {data:ln}=await sb.from("lines").select("sportsbook, side, odds_american, fetched_at").eq("game_id",gid).eq("market_type","btts").order("sportsbook");
    for(const r of ln??[]) console.log(`  ${String(r.sportsbook).padEnd(16)} ${String(r.side).padEnd(4)} ${String(r.odds_american).padStart(5)}  fetched=${r.fetched_at?.slice(11,16)}`);
    // distinct sportsbooks
    const books=[...new Set((ln??[]).map(r=>r.sportsbook))];
    console.log(`  distinct books: ${JSON.stringify(books)}`);
    // also match_result book coverage for comparison
    const {data:mr}=await sb.from("lines").select("sportsbook").eq("game_id",gid).eq("market_type","match_result");
    console.log(`  match_result distinct books: ${[...new Set((mr??[]).map(r=>r.sportsbook))].length}`);
  }
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
