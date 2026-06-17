import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const now=new Date().toISOString();
  console.log(`now=${now}`);
  // ATL@NYM game
  const {data:g}=await sb.from("games").select("id, game_date, status").eq("sport","mlb").eq("slate_date","2026-06-12");
  // find ATL@NYM by team
  const {data:gp}=await sb.from("game_predictions").select("game_id, locked_at, sport_specific").eq("sport","mlb").in("game_id",(g??[]).map(x=>x.id));
  console.log("\n=== MLB today: lock status + bullpen factor (stored auto_factors) ===");
  for(const r of gp??[]){
    const ss=(r.sport_specific??{}) as any; const af=ss.auto_factors??{};
    const gm=(g??[]).find(x=>x.id===r.game_id);
    const hasRaw = af.home_bullpen_factor_raw!==undefined;
    console.log(`  g${r.game_id} locked_at=${r.locked_at?.slice(5,16) ?? "NULL(unlocked)"} status=${gm?.status} bullpen h/a=${af.home_bullpen_factor}/${af.away_bullpen_factor} raw=${af.home_bullpen_factor_raw ?? "—"}/${af.away_bullpen_factor_raw ?? "—"} source=${af.bullpen_factor_source ?? "OLD(pre-deploy)"}`);
  }
  console.log("\nNOTE: bullpen_factor_source present => recomputed post-deploy (shrunk). Absent => pre-deploy stored factor.");
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
