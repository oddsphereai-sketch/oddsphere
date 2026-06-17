import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const BOOK_PRIORITY = ["locked_snapshot","pinnacle","draftkings","fanduel","betmgm","caesars","bet365 us","bookmaker","ballybet","onexbet","saba","fliff"];
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  for (const [gid, mk, side] of [[15774,"moneyline","home"],[15766,"total","over"]] as any) {
    const { data: cur } = await sb.from("lines").select("sportsbook, side, odds_american").eq("game_id",gid).eq("market_type",mk).is("player_id",null);
    const sideMatch=(cur??[]).filter((r:any)=>r.side===side);
    let priceRow:any=null;
    for (const b of BOOK_PRIORITY){ const hit=sideMatch.find((r:any)=>r.sportsbook===b&&r.odds_american!==null); if(hit){priceRow=hit;break;} }
    const { data: hist } = await sb.from("line_history").select("sportsbook, side, odds_american").eq("game_id",gid).eq("market_type",mk).is("player_id",null).order("recorded_at",{ascending:true});
    const cands=(hist??[]).filter((r:any)=>r.side===side);
    const found=cands.find((c:any)=>c.sportsbook===priceRow?.sportsbook);
    console.log(`game ${gid} ${mk} ${side}`);
    console.log("  priceRow:", JSON.stringify(priceRow));
    console.log("  opener@priceRow.book:", JSON.stringify(found??null));
    console.log("  current books(side):", [...new Set(sideMatch.map((r:any)=>r.sportsbook))].join(","));
    console.log("  history books(side):", [...new Set(cands.map((r:any)=>r.sportsbook))].join(","));
  }
})().then(()=>process.exit(0));
