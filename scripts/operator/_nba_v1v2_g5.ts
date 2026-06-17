import { buildNbaFeatureSnapshots } from "../../lib/services/nba/featureSnapshot";
import { runNbaAutoModelV1 } from "../../lib/automodel/nba/nbaAutoModelV1";
import { runNbaAutoModelV2 } from "../../lib/automodel/nba/nbaAutoModelV2";
(async()=>{
  const snaps = await buildNbaFeatureSnapshots("2026-06-14", {});
  console.log(`snapshots: ${snaps.length}`);
  for(const s of snaps){
    const a=(s as any).away_team?.abbreviation, h=(s as any).home_team?.abbreviation;
    console.log(`\n=== ${a} @ ${h} (G${(s as any).series?.game_number??"?"}) ===`);
    const mk=(s as any).market;
    console.log(`MARKET: ${JSON.stringify({ml_home:mk?.home_ml_odds_american,ml_away:mk?.away_ml_odds_american,total:mk?.total_line,spread:mk?.home_spread_points})}`);
    let v1:any,v2:any;
    try{v1=runNbaAutoModelV1(s,"final" as any);}catch(e:any){console.log("V1 ERROR:",e?.message);}
    try{v2=runNbaAutoModelV2(s,"final" as any);}catch(e:any){console.log("V2 ERROR:",e?.message?.slice(0,200));}
    if(v1)console.log(`V1: ${a} ${v1.predicted_away_score} @ ${h} ${v1.predicted_home_score} total=${v1.predicted_total} spread=${v1.predicted_spread_home} | ML ${v1.predicted_ml_winner} conf=${v1.ml_confidence} trust_indep=${v1.audit?.trust_independent?.toFixed?.(2)}`);
    if(v2)console.log(`V2: ${a} ${v2.predicted_away_score} @ ${h} ${v2.predicted_home_score} total=${v2.predicted_total} spread=${v2.predicted_spread_home} | ML ${v2.predicted_ml_winner} conf=${v2.ml_confidence} trust_indep=${v2.audit?.trust_independent?.toFixed?.(2)}`);
  }
})().catch(e=>console.error("ERR",e?.message||e));
