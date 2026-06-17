import { buildNbaFeatureSnapshots } from "../../lib/services/nba/featureSnapshot";
(async()=>{
  const snaps = await buildNbaFeatureSnapshots("2026-06-14", {});
  const s:any = snaps[0]; if(!s){console.log("no snap");return;}
  console.log("market keys:", JSON.stringify(Object.keys(s.market||{})));
  console.log("market:", JSON.stringify(s.market, null, 1));
  console.log("data_quality:", JSON.stringify(s.data_quality));
  console.log("home_injuries:", JSON.stringify((s.home_injuries||[]).slice(0,3)), "n=",(s.home_injuries||[]).length);
  console.log("away_injuries:", JSON.stringify((s.away_injuries||[]).slice(0,3)), "n=",(s.away_injuries||[]).length);
})().catch(e=>console.error("ERR",e?.message||e));
