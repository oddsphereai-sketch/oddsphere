import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  // recent MLB game_predictions with v2.2 audit
  const {data}=await sb.from("game_predictions").select("game_id, slate_date, sport_specific").eq("sport","mlb").gte("slate_date","2026-06-10").order("slate_date",{ascending:false}).limit(60);
  const CEIL_ML=10, CEIL_OU=9;
  let baTotal=0, mlBaCeil=0, ouBaCeil=0, ouBaFallback=0;
  const samples:string[]=[];
  for(const r of data??[]){
    const v=(r.sport_specific as any)?.v2_2_audit; if(!v) continue;
    // ML best angle
    if(v.ml_best_angle_eligible){ baTotal++;
      const edge=Math.abs(v.ml_edge_pct??0);
      if(edge>CEIL_ML){ mlBaCeil++; if(samples.length<10) samples.push(`g${r.game_id} ML edge=${v.ml_edge_pct?.toFixed(1)}pp → was BestAngle, NOW capped (ceiling 10)`); }
    }
    if(v.ou_best_angle_eligible){ baTotal++;
      const edge=Math.abs(v.ou_edge_pct??0);
      const fallback = v.over_odds_american==null || v.under_odds_american==null;
      if(fallback){ ouBaFallback++; if(samples.length<10) samples.push(`g${r.game_id} OU edge=${v.ou_edge_pct?.toFixed?.(1)}pp → was BestAngle, NOW blocked (OU odds missing/fallback)`); }
      else if(edge>CEIL_OU){ ouBaCeil++; if(samples.length<10) samples.push(`g${r.game_id} OU edge=${v.ou_edge_pct?.toFixed(1)}pp → was BestAngle, NOW capped (ceiling 9)`); }
    }
  }
  console.log(`MLB rows scanned: ${(data??[]).length}`);
  console.log(`Best-Angle-eligible (old): ${baTotal}`);
  console.log(`  → ML capped by 10pp ceiling: ${mlBaCeil}`);
  console.log(`  → OU capped by 9pp ceiling: ${ouBaCeil}`);
  console.log(`  → OU blocked by fallback (no real OU odds): ${ouBaFallback}`);
  console.log(`  → total now demoted from Best Angle: ${mlBaCeil+ouBaCeil+ouBaFallback} / ${baTotal}`);
  console.log("\nsamples:"); for(const s of samples) console.log("  "+s);
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
