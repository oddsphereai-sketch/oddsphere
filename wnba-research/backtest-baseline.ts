/* Track A — pure WNBA model-accuracy backtest (BDL game scores only; no odds). */
import fs from "fs";
const KEY = process.env.KEY!;
const B = "https://api.balldontlie.io/wnba/v1";
const CACHE = "wnba-research/games.json";

type G = { id:number; date:string; season:number; post:boolean; h:number; a:number; hs:number; as:number };
async function get(u:string){ const r=await fetch(u,{headers:{Authorization:KEY}}); return r.ok?await r.json():{__err:r.status}; }
async function pull():Promise<G[]>{
  if(fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE,"utf8"));
  const out:G[]=[];
  for(const yr of [2018,2019,2020,2021,2022,2023,2024,2025]){
    let cursor:any=null,pages=0;
    while(pages<8){ const j=await get(`${B}/games?seasons[]=${yr}&per_page=100`+(cursor?`&cursor=${cursor}`:""));
      if(j.__err)break; for(const g of (j.data||[])){ if(g.home_score==null||g.away_score==null)continue;
        out.push({id:g.id,date:g.date.slice(0,10),season:g.season,post:g.postseason,h:g.home_team.id,a:g.visitor_team.id,hs:g.home_score,as:g.away_score}); }
      pages++; cursor=j.meta&&j.meta.next_cursor; if(!cursor)break; }
  }
  out.sort((x,y)=>x.date<y.date?-1:x.date>y.date?1:x.id-y.id);
  fs.writeFileSync(CACHE,JSON.stringify(out)); return out;
}
const dexp=(d:number)=>1/(1+Math.pow(10,d/400));
function movMult(margin:number,eloDiffW:number){ return Math.log(Math.abs(margin)+1)*(2.2/((eloDiffW)*0.001+2.2)); }

(async()=>{
  const games=await pull();
  console.log(`games: ${games.length} (${games[0].date}..${games[games.length-1].date})`);
  const homeWin=games.filter(g=>g.hs>g.as).length; console.log(`home win%: ${(homeWin/games.length*100).toFixed(1)}%`);

  const HFA=65, K=20, PPE=25; // home-field Elo, K, elo-per-point
  const elo=new Map<number,number>(), seen=new Map<number,number>(), lastDate=new Map<number,string>(), lastSeason=new Map<number,number>();
  const pf=new Map<number,number[]>(), pa=new Map<number,number[]>(); // rolling pts for/against
  const E=(t:number)=>elo.get(t)??1500;
  const roll=(m:Map<number,number[]>,t:number,n=10)=>{const x=m.get(t)||[];return x.length?x.slice(-n).reduce((s,v)=>s+v,0)/Math.min(x.length,n):82;};
  const daysBetween=(a:string,b:string)=>Math.round((+new Date(b)-+new Date(a))/86400000);

  type Pred={g:G; pHome:number; predMargin:number; predTotal:number; restAdv:number; b2bHome:boolean; b2bAway:boolean; ngH:number; ngA:number};
  const preds:Pred[]=[];
  for(const g of games){
    // season carryover regression
    for(const t of [g.h,g.a]){ if(lastSeason.get(t)!==undefined && lastSeason.get(t)!==g.season){ elo.set(t,1500+0.75*(E(t)-1500)); } lastSeason.set(t,g.season); }
    const eh=E(g.h), ea=E(g.a);
    const pHome=dexp(-(eh+HFA-ea));
    const predMargin=(eh+HFA-ea)/PPE;
    const predHomeScore=(roll(pf,g.h)+roll(pa,g.a))/2, predAwayScore=(roll(pf,g.a)+roll(pa,g.h))/2;
    const restH=lastDate.has(g.h)?daysBetween(lastDate.get(g.h)!,g.date):7, restA=lastDate.has(g.a)?daysBetween(lastDate.get(g.a)!,g.date):7;
    preds.push({g,pHome,predMargin,predTotal:predHomeScore+predAwayScore,restAdv:restH-restA,b2bHome:restH<=1,b2bAway:restA<=1,ngH:seen.get(g.h)||0,ngA:seen.get(g.a)||0});
    // update
    const margin=g.hs-g.as, homeWon=margin>0;
    const eloDiffW=homeWon?(eh+HFA-ea):(ea-(eh+HFA));
    const mult=movMult(margin,eloDiffW);
    const exp=pHome, act=homeWon?1:0;
    elo.set(g.h,eh+K*mult*(act-exp)); elo.set(g.a,ea-K*mult*(act-exp));
    seen.set(g.h,(seen.get(g.h)||0)+1); seen.set(g.a,(seen.get(g.a)||0)+1);
    (pf.get(g.h)||pf.set(g.h,[]).get(g.h)!).push(g.hs); (pa.get(g.h)||pa.set(g.h,[]).get(g.h)!).push(g.as);
    (pf.get(g.a)||pf.set(g.a,[]).get(g.a)!).push(g.as); (pa.get(g.a)||pa.set(g.a,[]).get(g.a)!).push(g.hs);
    lastDate.set(g.h,g.date); lastDate.set(g.a,g.date);
  }
  // eval set: seasons >=2021, both teams >=10 prior games this run
  const ev=preds.filter(p=>p.g.season>=2021 && p.ngH>=10 && p.ngA>=10);
  console.log(`\neval games (2021-2025, >=10 prior): ${ev.length}`);
  const acc=(f:(p:Pred)=>number)=>{let c=0;for(const p of ev){const pick=f(p)>=0.5;const homeWon=p.g.hs>p.g.as;if(pick===homeWon)c++;}return c/ev.length;};
  const brier=(f:(p:Pred)=>number)=>ev.reduce((s,p)=>{const o=p.g.hs>p.g.as?1:0;return s+Math.pow(f(p)-o,2);},0)/ev.length;
  const logloss=(f:(p:Pred)=>number)=>ev.reduce((s,p)=>{const o=p.g.hs>p.g.as?1:0;const q=Math.min(0.999,Math.max(0.001,f(p)));return s-(o*Math.log(q)+(1-o)*Math.log(1-q));},0)/ev.length;
  const mae=(f:(p:Pred)=>number,g:(p:Pred)=>number)=>ev.reduce((s,p)=>s+Math.abs(f(p)-g(p)),0)/ev.length;

  console.log("\n=== ML accuracy / calibration (Elo) ===");
  console.log(`  home-always acc:   ${(acc(()=>1)*100).toFixed(1)}%`);
  const formPick=(p:Pred)=>{const nh=(roll(pf,p.g.h)-roll(pa,p.g.h)), na=(roll(pf,p.g.a)-roll(pa,p.g.a));return nh+2.6>na?0.6:0.4;}; // +HFA proxy
  console.log(`  recent-form acc:   ${(acc(formPick)*100).toFixed(1)}%`);
  console.log(`  ELO acc:           ${(acc(p=>p.pHome)*100).toFixed(1)}%   Brier ${brier(p=>p.pHome).toFixed(4)}  LogLoss ${logloss(p=>p.pHome).toFixed(4)}`);
  console.log(`  (Brier baseline .25 = coinflip; home-always Brier ${brier(()=>homeWin/games.length).toFixed(4)})`);

  console.log("\n=== Elo calibration by predicted-home-win-prob bucket ===");
  for(const [lo,hi] of [[0,.3],[.3,.4],[.4,.5],[.5,.6],[.6,.7],[.7,1.01]]){
    const b=ev.filter(p=>p.pHome>=lo&&p.pHome<hi); if(!b.length)continue;
    const actual=b.filter(p=>p.g.hs>p.g.as).length/b.length, mean=b.reduce((s,p)=>s+p.pHome,0)/b.length;
    console.log(`  ${lo.toFixed(1)}-${hi.toFixed(1)}: n=${String(b.length).padStart(4)} predicted ${(mean*100).toFixed(1)}%  actual ${(actual*100).toFixed(1)}%`);
  }
  console.log("\n=== margin / total / score MAE ===");
  console.log(`  margin MAE (Elo):  ${mae(p=>p.predMargin,p=>p.g.hs-p.g.as).toFixed(2)} pts  (naive HFA-only MAE ${mae(()=>2.6,p=>p.g.hs-p.g.as).toFixed(2)})`);
  console.log(`  total MAE (eff):   ${mae(p=>p.predTotal,p=>p.g.hs+p.g.as).toFixed(2)} pts  (naive league-avg MAE ${mae(()=>{const t=ev.reduce((s,p)=>s+p.g.hs+p.g.as,0)/ev.length;return t;},p=>p.g.hs+p.g.as).toFixed(2)})`);

  console.log("\n=== splits (Elo ML accuracy) ===");
  const split=(name:string,f:(p:Pred)=>boolean)=>{const b=ev.filter(f);if(b.length<20)return;let c=0;for(const p of b){if((p.pHome>=0.5)===(p.g.hs>p.g.as))c++;}console.log(`  ${name.padEnd(22)} n=${String(b.length).padStart(4)} acc ${(c/b.length*100).toFixed(1)}%`);};
  split("home B2B",p=>p.b2bHome); split("away B2B",p=>p.b2bAway); split("no B2B",p=>!p.b2bHome&&!p.b2bAway);
  split("home rest adv>=2",p=>p.restAdv>=2); split("away rest adv>=2",p=>p.restAdv<=-2);
  split("postseason",p=>p.g.post); split("regular",p=>!p.g.post);
})();
