import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  // ATL@NYM = g15770 (from prior audit). Check both tables.
  const {data:gp}=await sb.from("game_predictions").select("game_id, locked_at, sport_specific").eq("game_id",15770);
  console.log("game_predictions g15770:", (gp??[]).length, "rows");
  for(const r of gp??[]){const af=(r.sport_specific as any)?.auto_factors??{};
    console.log(`  locked_at=${r.locked_at ?? "NULL"} bullpen h/a=${af.home_bullpen_factor}/${af.away_bullpen_factor} src=${af.bullpen_factor_source ?? "OLD"}`);}
  const {data:pr}=await sb.from("prediction_records").select("market, pick, locked_at").eq("game_id",15770);
  console.log("prediction_records g15770:", (pr??[]).map(r=>`${r.market}:${r.pick}:lock=${r.locked_at?"Y":"N"}`).join(", "));
  // how many MLB game_predictions today are locked vs not (recompute eligibility)
  const today="2026-06-12";
  const {data:gids}=await sb.from("games").select("id").eq("sport","mlb").eq("slate_date",today);
  const ids=(gids??[]).map(x=>x.id);
  const {data:all}=await sb.from("game_predictions").select("locked_at, sport_specific").in("game_id",ids);
  let locked=0,unlocked=0,shrunk=0,old=0;
  for(const r of all??[]){const af=(r.sport_specific as any)?.auto_factors??{};
    if(r.locked_at!==null)locked++;else unlocked++;
    if(af.bullpen_factor_source)shrunk++;else old++;}
  console.log(`\nMLB today game_predictions: ${(all??[]).length} total | locked=${locked} unlocked=${unlocked} | shrunk(post-deploy)=${shrunk} old(pre-deploy)=${old}`);
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
