import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data:games}=await sb.from("games").select("id, home_team_id, away_team_id, game_date").eq("sport","soccer").in("slate_date",["2026-06-12"]).order("game_date");
  const tids=[...new Set((games??[]).flatMap(g=>[g.home_team_id,g.away_team_id]))];
  const {data:teams}=await sb.from("teams").select("id, abbreviation").in("id",tids);
  const tm=new Map((teams??[]).map(t=>[t.id,t.abbreviation]));
  for(const g of games??[]){
    const lbl=`${tm.get(g.away_team_id)}@${tm.get(g.home_team_id)}`;
    const {data:pr}=await sb.from("prediction_records").select("market, pick, model_probability, market_probability, edge, snapshot_json").eq("game_id",g.id);
    const btts=(pr??[]).find(r=>r.market==="btts");
    const snap=(btts?.snapshot_json??{}) as any;
    const model=snap.model??{}; const mkt=snap.market??{};
    const lamH=model.lambda_home, lamA=model.lambda_away, expT=model.expected_total;
    const raw=model.raw_probabilities?.btts;
    console.log(`\n=== ${lbl} (g${g.id}) ===`);
    console.log(`  λ_home=${lamH?.toFixed?.(3)} λ_away=${lamA?.toFixed?.(3)} expected_total=${expT?.toFixed?.(3)}`);
    console.log(`  BTTS model raw: ${JSON.stringify(raw)}`);
    console.log(`  BTTS record: model_p=${btts?.model_probability} market_p=${btts?.market_probability} edge=${btts?.edge}`);
    // market devig btts
    const devig=mkt.devigged_probabilities??{};
    console.log(`  market devig btts: yes=${devig["btts|yes"]} no=${devig["btts|no"]}  implied=${JSON.stringify(mkt.implied_probabilities?.["btts|yes"]??"")}`);
    // Match Result + Total model probs for context (is the model differentiating?)
    console.log(`  MR model: ${JSON.stringify(snap.model?.raw_probabilities?.match_result)}`);
    console.log(`  Total@line model: ${JSON.stringify(snap.model?.raw_probabilities?.total_at_canonical)}`);
    // BTTS line movement: opener vs current per side
    const {data:lh}=await sb.from("line_history").select("side, odds_american, recorded_at").eq("game_id",g.id).eq("market_type","btts").order("recorded_at");
    const yes=(lh??[]).filter(r=>r.side==="yes"); const no=(lh??[]).filter(r=>r.side==="no");
    if(yes.length) console.log(`  BTTS YES line: open ${yes[0].odds_american} (${yes[0].recorded_at?.slice(11,16)}) → cur ${yes[yes.length-1].odds_american} (${yes[yes.length-1].recorded_at?.slice(11,16)})  [${yes.length} obs]`);
    if(no.length) console.log(`  BTTS NO  line: open ${no[0].odds_american} → cur ${no[no.length-1].odds_american}  [${no.length} obs]`);
  }
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
