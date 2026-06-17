import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
process.env.PRODUCTION_DATA_MODE=process.env.PRODUCTION_DATA_MODE??"true";
(async()=>{
  const { buildNbaDailyEdgePipeline } = await import("../../lib/services/nba/buildNbaDailyEdgeAdapted");
  for(const d of ["2026-06-13","2026-06-14"]){
    const { nbaDto } = await buildNbaDailyEdgePipeline(d);
    console.log(`\n##### adapter date=${d}: ${nbaDto.games.length} game(s) #####`);
    for(const g of nbaDto.games){
      const a:any=g.grounding_audit; const ml=g.intelligence.ml, tot=g.intelligence.total;
      console.log(`${g.away_abbr}@${g.home_abbr}  proj ${g.away_abbr} ${g.projection.away_score} @ ${g.home_abbr} ${g.projection.home_score} total=${g.projection.total}`);
      console.log(`  ML: pick=${ml.pick_label} prob=${(ml.model_prob_on_pick!*100).toFixed(1)}% mkt_novig=${ml.market_no_vig_prob_pick!=null?(ml.market_no_vig_prob_pick*100).toFixed(1)+"%":"—"} edge=${ml.edge_prob_pp}pp conf=${ml.effective_confidence} grade=${ml.grade}`);
      console.log(`  TOT: pick=${tot.pick_label} prob=${(tot.model_prob_on_pick!*100).toFixed(1)}% conf=${tot.effective_confidence} grade=${tot.grade} line=${tot.consensus_line}`);
      if(a){console.log(`  AUDIT: strength=${a.consensus_strength} spread_conf=${a.spread_confirmation} rawV2_total=${a.raw_v2_total} grounded_total=${a.grounded_projection?.total} moved_from_market=${a.grounded_projection?.moved_from_market} moved_from_raw=${a.grounded_projection?.moved_from_raw_total}`);
        console.log(`  AUDIT books: accepted_ml=${JSON.stringify(a.accepted_books?.ml)} rejected=${JSON.stringify(a.rejected_books)}`);
        console.log(`  AUDIT rationale: ${a.final_pick_rationale}`);}
    }
  }
})().catch(e=>console.error("ERR",e?.message||e, e?.stack?.split("\n").slice(1,4).join(" | ")));
