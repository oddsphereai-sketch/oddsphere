/* Track B — forward WNBA odds snapshot. Captures current ML/spread/total across
   all books for upcoming games, appends a timestamped line to odds-snapshots.jsonl.
   Run on a schedule (morning / midday / ~lock) to build open/current/lock + movement + CLV. */
import fs from "fs";
const SK=process.env.SHARPAPI_KEY||process.env.SK!; const BASE="https://api.sharpapi.io/api/v1";
const GM=["moneyline","point_spread","total_points"];
const BLOCKED=new Set(["fliff","kalshi","polymarket"]);
const TIER1=new Set(["circa","betonline"]);
const TIER2=new Set(["draftkings","betmgm","caesars","bet365 us","betrivers","fanatics","hardrock"]);
async function get(u:string){const r=await fetch(u,{headers:{Authorization:`Bearer ${SK}`}});return r.ok?await r.json():{__err:r.status};}
async function pull(mk:string){ let cursor:any=null,pages=0,out:any[]=[];
  while(pages<8){ const j=await get(`${BASE}/odds?league=wnba&market_type=${mk}&limit=100`+(cursor?`&cursor=${encodeURIComponent(cursor)}`:""));
    if(j.__err)break; out.push(...(j.data||[])); pages++; const pg=j.pagination||{}; if(!pg.has_more||!pg.next_cursor)break; cursor=pg.next_cursor; }
  return out;
}
const slim=(r:any)=>({book:r.sportsbook,event:r.event_id,home:r.home_team,away:r.away_team,mkt:r.market_type,sel:r.selection,selType:r.selection_type,odds:r.odds_american,line:r.line,start:r.event_start_time,main:r.is_main_line,stale:r.is_stale_pregame_price});
const med=(a:number[])=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null;};
(async()=>{
  const all:any[]=[]; for(const mk of GM) all.push(...(await pull(mk)).map(slim));
  const trusted=all.filter(r=>!BLOCKED.has((r.book||"").toLowerCase()) && r.main!==false);
  const captured=new Date().toISOString();
  fs.mkdirSync("wnba-research",{recursive:true});
  fs.appendFileSync("wnba-research/odds-snapshots.jsonl", JSON.stringify({capturedAt:captured,rawRows:all.length,trustedRows:trusted.length,rows:trusted})+"\n");
  // summary per event/market: trusted book count + consensus + dispersion
  const ev=new Map<string,any>();
  for(const r of trusted){ const e=ev.get(r.event)||{home:r.home,away:r.away,start:r.start,ml:new Set(),spread:[] as number[],total:[] as number[],spreadBooks:new Set(),totalBooks:new Set()}; 
    if(r.mkt==="moneyline")e.ml.add(r.book);
    if(r.mkt==="point_spread"&&r.line!=null){e.spread.push(Number(r.line));e.spreadBooks.add(r.book);}
    if(r.mkt==="total_points"&&r.line!=null){e.total.push(Number(r.line));e.totalBooks.add(r.book);}
    ev.set(r.event,e); }
  console.log(`captured ${captured} → ${all.length} raw rows, ${trusted.length} trusted (fliff/kalshi blocked)`);
  console.log(`upcoming WNBA games: ${ev.size}\n`);
  for(const [id,e] of [...ev].slice(0,8)){
    const sp=e.spread.filter((x:number)=>Math.abs(x)<40), to=e.total.filter((x:number)=>x>120&&x<220);
    console.log(`  ${(e.away+" @ "+e.home).padEnd(30)} ML books:${e.ml.size}  spread:${e.spreadBooks.size}bk consensus ${med(sp)??"-"} disp ${sp.length?(Math.max(...sp)-Math.min(...sp)).toFixed(1):"-"}  total:${e.totalBooks.size}bk consensus ${med(to)??"-"} disp ${to.length?(Math.max(...to)-Math.min(...to)).toFixed(1):"-"}`);
  }
  console.log(`\nappended to wnba-research/odds-snapshots.jsonl (run 2-3x/day to build open/current/lock + movement + CLV)`);
})();
