import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
const imp=(a:number)=>a>0?100/(a+100):(-a)/(-a+100);
(async()=>{
  const {createClient}=await import("@supabase/supabase-js");
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  for(const gid of [15754,15755]){
    console.log(`\n=== game ${gid} — current 'lines' table, market_type=btts ===`);
    const {data:ln}=await sb.from("lines").select("sportsbook, side, odds_american").eq("game_id",gid).eq("market_type","btts").order("sportsbook");
    const yes=(ln??[]).filter(r=>r.side==="yes").map(r=>r.odds_american).filter(x=>x!=null) as number[];
    const no=(ln??[]).filter(r=>r.side==="no").map(r=>r.odds_american).filter(x=>x!=null) as number[];
    console.log(`  ${(ln??[]).length} btts rows. YES odds: ${JSON.stringify(yes)}  NO odds: ${JSON.stringify(no)}`);
    if(yes.length&&no.length){
      const medianYes=yes.sort((a,b)=>a-b)[Math.floor(yes.length/2)];
      const medianNo=no.sort((a,b)=>a-b)[Math.floor(no.length/2)];
      const iy=imp(medianYes), ino=imp(medianNo);
      console.log(`  median YES ${medianYes} (impl ${iy.toFixed(3)}) · median NO ${medianNo} (impl ${ino.toFixed(3)}) · devig YES = ${(iy/(iy+ino)).toFixed(3)}`);
    }
    // What the snapshot stored as market btts
    const {data:pr}=await sb.from("prediction_records").select("market_probability, snapshot_json").eq("game_id",gid).eq("market","btts").limit(1);
    const mkt=(pr?.[0]?.snapshot_json as any)?.market??{};
    console.log(`  SNAPSHOT market btts: devig_yes=${mkt.devigged_probabilities?.["btts|yes"]} implied_yes=${mkt.implied_probabilities?.["btts|yes"]} book_counts.btts=${mkt.book_counts?.btts}`);
  }
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR",e);process.exit(1);});
