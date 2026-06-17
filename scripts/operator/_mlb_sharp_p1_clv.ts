/** READ-ONLY — P1/P2: sharp-pick + CLV audit on FULL line_history.
 * For every MLB ML/Total Best Angle / Lean / Watchlist: result, beat-close (CLV),
 * moved toward/away after lock, early/late to move. */
import { supabase } from "../../lib/db/supabase";
import { isBlockedSportsbook } from "../../lib/config/blockedSportsbooks";
const START = "2026-06-07", SIX14 = "2026-06-14";
const impl = (o:number)=> o>0 ? 100/(o+100) : -o/(-o+100);
const profit=(o:number,w:boolean)=> w ? (o>0?o/100:100/-o) : -1;

async function pageAll(table:string, cols:string, gids:number[]): Promise<any[]> {
  const out:any[]=[];
  for (let i=0;i<gids.length;i+=40){ const chunk=gids.slice(i,i+40); let from=0;
    for(;;){ const {data,error}=await supabase.from(table).select(cols).in("game_id",chunk).range(from,from+999);
      if(error){console.error(table,error.message);break;} const rows=(data??[]) as any[]; out.push(...rows);
      if(rows.length<1000)break; from+=1000; } }
  return out;
}

async function main(){
  // picks
  const { data: pr } = await supabase.from("prediction_records")
    .select("slate_date, game_id, market, pick, side, odds_american, play_grade, best_angle, locked_at, launch_day, no_bet, model_probability, market_probability, prediction_grades(result)")
    .eq("sport","mlb").in("market",["moneyline","total"]).gte("slate_date",START);
  const recs=(pr??[]).filter((r:any)=>r.launch_day!==true && r.no_bet!==true) as any[];
  const gids=[...new Set(recs.map(r=>r.game_id).filter(Boolean))] as number[];

  // full line_history for ML + total
  const lh = await pageAll("line_history","game_id, market_type, side, sportsbook, odds_american, is_opener, recorded_at", gids);
  const lhClean = lh.filter(r=>!isBlockedSportsbook(r.sportsbook) && r.odds_american!=null && r.side!=null);
  // index by game::market::side
  const idx=new Map<string,any[]>();
  for (const r of lhClean){ const k=`${r.game_id}::${r.market_type}::${r.side}`; (idx.get(k)??idx.set(k,[]).get(k)!).push(r); }
  for (const [,arr] of idx) arr.sort((a,b)=>new Date(a.recorded_at).getTime()-new Date(b.recorded_at).getTime());

  type Row={grade:string; market:string; date:string; res:string; odds:number|null;
    openImpl:number|null; lockImpl:number|null; closeImpl:number|null; clvClose:number|null; postMoveTowards:number|null};
  const rows:Row[]=[];
  for (const r of recs){
    const g=Array.isArray(r.prediction_grades)?r.prediction_grades[0]:r.prediction_grades;
    const res=String(g?.result??"").toLowerCase();
    const grade = r.best_angle===true ? "best_angle" : (r.play_grade ?? "none");
    const k=`${r.game_id}::${r.market}::${r.pick}`;
    const arr=idx.get(k)??[];
    let openImpl=null,lockImpl=null,closeImpl=null,clvClose=null,postMoveTowards=null;
    if (arr.length){
      const open = arr.find(x=>x.is_opener) ?? arr[0];
      const close = arr[arr.length-1];
      openImpl=impl(open.odds_american); closeImpl=impl(close.odds_american);
      // lock point: closest recorded_at <= locked_at (fallback posted odds)
      if (r.locked_at){ const lt=new Date(r.locked_at).getTime();
        const before=arr.filter(x=>new Date(x.recorded_at).getTime()<=lt);
        const at = before.length? before[before.length-1] : arr[0];
        lockImpl=impl(at.odds_american);
        // movement AFTER lock toward our side = closeImpl - lockImpl
        postMoveTowards = closeImpl - lockImpl;
      } else if (r.odds_american!=null){ lockImpl=impl(r.odds_american); postMoveTowards = closeImpl - lockImpl; }
      // CLV vs close from posted/lock price
      const basis = lockImpl ?? (r.odds_american!=null?impl(r.odds_american):openImpl);
      if (basis!=null && closeImpl!=null) clvClose = closeImpl - basis;
    }
    rows.push({grade,market:r.market,date:String(r.slate_date),res,odds:r.odds_american,openImpl,lockImpl,closeImpl,clvClose,postMoveTowards});
  }

  function report(label:string, arr:Row[]){
    const dec=arr.filter(r=>r.res==="win"||r.res==="loss");
    if(!dec.length){console.log(`  ${label.padEnd(26)} (no decided)`);return;}
    const w=dec.filter(r=>r.res==="win").length, l=dec.length-w;
    let net=0,n=0; for(const r of dec){if(r.odds!=null){n++;net+=profit(r.odds,r.res==="win");}}
    const withClv=dec.filter(r=>r.clvClose!=null);
    const avgClv=withClv.length? withClv.reduce((s,r)=>s+(r.clvClose!),0)/withClv.length : null;
    const beatClose=withClv.filter(r=>(r.clvClose!)>0.005).length;
    const postT=dec.filter(r=>r.postMoveTowards!=null);
    const movedToward=postT.filter(r=>(r.postMoveTowards!)>0.005).length;
    console.log(`  ${label.padEnd(26)} ${w}-${l} (${(100*w/dec.length).toFixed(0)}%)  ${n?(net>=0?"+":"")+net.toFixed(1)+"u/"+(100*net/n).toFixed(0)+"%":""}  | avgCLVvsClose=${avgClv!=null?(avgClv*100>=0?"+":"")+(avgClv*100).toFixed(2)+"pp":"—"} beatClose=${beatClose}/${withClv.length} | postLock movedToward=${movedToward}/${postT.length}`);
  }

  console.log(`\n=== P1/P2 SHARP-PICK + CLV AUDIT (full line_history, ${recs.length} picks) ===`);
  console.log(`Format: W-L (win%)  units/ROI  | avg CLV vs close (pos=beat close)  beatClose count | post-lock line moved toward our side\n`);
  for (const mk of ["moneyline","total"]){
    console.log(`--- ${mk.toUpperCase()} ---`);
    for (const gr of ["best_angle","lean","market_aligned","watchlist","provisional"]) report(`${gr}`, rows.filter(r=>r.market===mk&&r.grade===gr));
    report("ALL "+mk, rows.filter(r=>r.market===mk));
    // excl 6/14
    report("ALL "+mk+" exX614", rows.filter(r=>r.market===mk&&r.date!==SIX14));
  }
  // headline: do Best Angles + Leans beat close more than watchlist?
  const ba=rows.filter(r=>r.grade==="best_angle"&&r.clvClose!=null);
  const lean=rows.filter(r=>r.grade==="lean"&&r.clvClose!=null);
  const wl=rows.filter(r=>(r.grade==="watchlist"||r.grade==="market_aligned"||r.grade==="provisional")&&r.clvClose!=null);
  const avg=(a:Row[])=>a.length?(a.reduce((s,r)=>s+(r.clvClose!),0)/a.length*100).toFixed(2)+"pp":"—";
  console.log(`\n=== CLV-vs-close by tier (sharpness signal) ===`);
  console.log(`  Best Angle avgCLV=${avg(ba)} (n=${ba.length})   Lean avgCLV=${avg(lean)} (n=${lean.length})   Watchlist/aligned avgCLV=${avg(wl)} (n=${wl.length})`);
  console.log(`  (sharp picks should beat close MORE than watchlist; if BA<=WL, our grade ladder is not capturing sharpness)`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
