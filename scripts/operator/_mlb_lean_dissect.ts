/** READ-ONLY — dissect MLB Leans: what pre-lock signal separates winners from losers? */
import { supabase } from "../../lib/db/supabase";
import { isBlockedSportsbook } from "../../lib/config/blockedSportsbooks";
const START="2026-06-07", SIX14="2026-06-14";
const impl=(o:number)=>o>0?100/(o+100):-o/(-o+100);
const profit=(o:number,w:boolean)=>w?(o>0?o/100:100/-o):-1;
async function pageAll(t:string,c:string,g:number[]){const out:any[]=[];for(let i=0;i<g.length;i+=40){const ch=g.slice(i,i+40);let f=0;for(;;){const{data,error}=await supabase.from(t).select(c).in("game_id",ch).range(f,f+999);if(error){console.error(t,error.message);break;}const r=(data??[])as any[];out.push(...r);if(r.length<1000)break;f+=1000;}}return out;}
async function main(){
  const {data:pr}=await supabase.from("prediction_records")
    .select("slate_date, game_id, market, pick, odds_american, play_grade, best_angle, locked_at, launch_day, no_bet, model_probability, market_probability, snapshot_json, prediction_grades(result)")
    .eq("sport","mlb").in("market",["moneyline","total"]).gte("slate_date",START);
  const leans=(pr??[]).filter((r:any)=>r.launch_day!==true&&r.no_bet!==true&&r.play_grade==="lean"&&r.best_angle!==true) as any[];
  const gids=[...new Set(leans.map(r=>r.game_id))] as number[];
  const lh=(await pageAll("line_history","game_id, market_type, side, sportsbook, odds_american, is_opener, recorded_at",gids)).filter(r=>!isBlockedSportsbook(r.sportsbook)&&r.odds_american!=null&&r.side!=null);
  const idx=new Map<string,any[]>(); for(const r of lh){const k=`${r.game_id}::${r.market_type}::${r.side}`;(idx.get(k)??idx.set(k,[]).get(k)!).push(r);}
  for(const[,a]of idx)a.sort((x,y)=>new Date(x.recorded_at).getTime()-new Date(y.recorded_at).getTime());

  const rows=leans.map(r=>{
    const g=Array.isArray(r.prediction_grades)?r.prediction_grades[0]:r.prediction_grades;
    const res=String(g?.result??"").toLowerCase();
    const arr=idx.get(`${r.game_id}::${r.market}::${r.pick}`)??[];
    let preMove=null,clv=null;
    if(arr.length){const open=arr.find(x=>x.is_opener)??arr[0];const close=arr[arr.length-1];
      let lockImpl=r.odds_american!=null?impl(r.odds_american):impl(open.odds_american);
      if(r.locked_at){const lt=new Date(r.locked_at).getTime();const bf=arr.filter(x=>new Date(x.recorded_at).getTime()<=lt);if(bf.length)lockImpl=impl(bf[bf.length-1].odds_american);}
      preMove=impl((r.locked_at?(arr.filter(x=>new Date(x.recorded_at).getTime()<=new Date(r.locked_at).getTime()).slice(-1)[0]??open):open).odds_american)-impl(open.odds_american); // open->lock toward us
      clv=impl(close.odds_american)-lockImpl;
    }
    const mp=r.model_probability, mkt=r.market_probability;
    const edge = (mp!=null&&mkt!=null)? (mp-mkt)*100 : null; // pp
    const fav = r.odds_american!=null && r.odds_american<0;
    // EV at posted using model prob
    const ev = (mp!=null&&r.odds_american!=null)? (mp*(r.odds_american>0?r.odds_american/100:100/-r.odds_american) - (1-mp)) : null;
    return {market:r.market,res,odds:r.odds_american,date:String(r.slate_date),edge,fav,ev,preMove,clv};
  }).filter(r=>r.res==="win"||r.res==="loss");

  const stat=(label:string,a:any[])=>{if(!a.length){console.log(`  ${label.padEnd(34)} n=0`);return;}
    const w=a.filter(r=>r.res==="win").length;let net=0,n=0;for(const r of a){if(r.odds!=null){n++;net+=profit(r.odds,r.res==="win");}}
    console.log(`  ${label.padEnd(34)} ${w}-${a.length-w} (${(100*w/a.length).toFixed(0)}%)  ${n?(net>=0?"+":"")+net.toFixed(1)+"u/"+(100*net/n).toFixed(0)+"%":""}`);};

  console.log(`\n=== MLB LEAN DISSECTION (n=${rows.length} decided) ===`);
  stat("ALL leans", rows);
  stat("ALL leans exX614", rows.filter(r=>r.date!==SIX14));
  console.log(`\n-- by market --`); stat("ML leans",rows.filter(r=>r.market==="moneyline")); stat("Total leans",rows.filter(r=>r.market==="total"));
  console.log(`\n-- favorite vs dog (ML) --`);
  stat("ML fav leans",rows.filter(r=>r.market==="moneyline"&&r.fav)); stat("ML dog leans",rows.filter(r=>r.market==="moneyline"&&!r.fav));
  console.log(`\n-- by EV sign (model prob @ posted) --`);
  stat("EV>0 leans",rows.filter(r=>r.ev!=null&&r.ev>0)); stat("EV<=0 leans",rows.filter(r=>r.ev!=null&&r.ev<=0));
  console.log(`\n-- by pre-lock movement (open->lock toward our side) --`);
  stat("pre-move TOWARD us (>+0.5pp)",rows.filter(r=>r.preMove!=null&&r.preMove>0.005));
  stat("pre-move flat (|.|<=0.5pp)",rows.filter(r=>r.preMove!=null&&Math.abs(r.preMove)<=0.005));
  stat("pre-move AGAINST us (<-0.5pp)",rows.filter(r=>r.preMove!=null&&r.preMove<-0.005));
  console.log(`\n-- by edge band (model-market pp) --`);
  stat("edge>=5pp",rows.filter(r=>r.edge!=null&&r.edge>=5)); stat("edge 3-5pp",rows.filter(r=>r.edge!=null&&r.edge>=3&&r.edge<5)); stat("edge<3pp",rows.filter(r=>r.edge!=null&&r.edge<3));
  console.log(`\n-- combo: EV>0 AND pre-move not against --`);
  stat("EV>0 & preMove>=-0.5pp",rows.filter(r=>r.ev!=null&&r.ev>0&&r.preMove!=null&&r.preMove>=-0.005));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
