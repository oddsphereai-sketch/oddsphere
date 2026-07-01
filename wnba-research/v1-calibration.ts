/* WNBA v1 — ML calibration (raw / shrink grid / Platt) + current Elo ratings export. */
import fs from "fs";
const KEY=process.env.KEY!; const B="https://api.balldontlie.io/wnba/v1";
type G={id:number;date:string;season:number;post:boolean;h:number;a:number;hs:number;as:number};
async function get(u:string){const r=await fetch(u,{headers:{Authorization:KEY}});return r.ok?await r.json():{__err:r.status};}
async function pull():Promise<G[]>{ const C="wnba-research/games-all.json"; if(fs.existsSync(C))return JSON.parse(fs.readFileSync(C,"utf8"));
  const out:G[]=[]; for(const yr of [2018,2019,2020,2021,2022,2023,2024,2025,2026]){let cursor:any=null,p=0;
    while(p<8){const j=await get(`${B}/games?seasons[]=${yr}&per_page=100`+(cursor?`&cursor=${cursor}`:""));if(j.__err)break;
      for(const g of (j.data||[])){if(g.home_score==null||g.away_score==null)continue;out.push({id:g.id,date:g.date.slice(0,10),season:g.season,post:g.postseason,h:g.home_team.id,a:g.visitor_team.id,hs:g.home_score,as:g.away_score});}
      p++;cursor=j.meta&&j.meta.next_cursor;if(!cursor)break;}}
  out.sort((x,y)=>x.date<y.date?-1:1);fs.writeFileSync(C,JSON.stringify(out));return out; }
const dexp=(d:number)=>1/(1+Math.pow(10,d/400)); const logit=(p:number)=>Math.log(p/(1-p)); const sig=(x:number)=>1/(1+Math.exp(-x));
const cl=(p:number)=>Math.min(0.995,Math.max(0.005,p));
(async()=>{
  const games=await pull(); const HFA=65,K=20;
  const elo=new Map<number,number>(),ls=new Map<number,number>(),seen=new Map<number,number>();
  const E=(t:number)=>elo.get(t)??1500;
  type P={season:number;p:number;won:number;ng:number}; const preds:P[]=[];
  const teamLastSeason=new Map<number,number>();
  for(const g of games){ if(g.season>2026)continue; if(g.hs===0&&g.as===0)continue;
    for(const t of [g.h,g.a]){if(ls.get(t)!==undefined&&ls.get(t)!==g.season)elo.set(t,1500+0.75*(E(t)-1500));ls.set(t,g.season);}
    const eh=E(g.h),ea=E(g.a),pH=dexp(-(eh+HFA-ea));
    if(g.season>=2022&&(seen.get(g.h)||0)>=10&&(seen.get(g.a)||0)>=10) preds.push({season:g.season,p:pH,won:g.hs>g.as?1:0,ng:Math.min(seen.get(g.h)!,seen.get(g.a)!)});
    const m=g.hs-g.as,hw=m>0,mult=Math.log(Math.abs(m)+1)*(2.2/((hw?eh+HFA-ea:ea-eh-HFA)*0.001+2.2));
    // FIXED K=20 — dynamic/fast K was tested (Kmax 24-60) and REJECTED: it overreacts to noisy
    // early games (Brier worse on both overall-2026 and expansion teams). Cold start is solved by
    // the market-informed PRIOR + widened uncertainty (slate adapter), not by a faster learning rate.
    elo.set(g.h,eh+20*mult*((hw?1:0)-pH));elo.set(g.a,ea-20*mult*((hw?1:0)-pH));
    seen.set(g.h,(seen.get(g.h)||0)+1);seen.set(g.a,(seen.get(g.a)||0)+1);
  }
  fs.writeFileSync("wnba-research/current-elo.json",JSON.stringify({HFA,ratings:[...elo.entries()],gamesPlayed:[...seen.entries()]}));
  const metrics=(f:(p:number)=>number,set:P[])=>{let acc=0,br=0,ll=0;for(const x of set){const q=cl(f(x.p));if((q>=0.5)===(x.won===1))acc++;br+=(q-x.won)**2;ll+=-(x.won*Math.log(q)+(1-x.won)*Math.log(1-q));}return{acc:acc/set.length,br:br/set.length,ll:ll/set.length};};
  const all=preds; const train=preds.filter(p=>p.season<=2024),test=preds.filter(p=>p.season>=2025);
  console.log(`eval ${all.length} (train ${train.length} 2022-24, test ${test.length} 2025)\n`);
  console.log("=== ML calibration (whole eval 2022-25) ===");
  const raw=(p:number)=>p; const shrink=(k:number)=>(p:number)=>0.5+(p-0.5)*k;
  for(const [n,f] of [["raw Elo",raw],["shrink .90",shrink(.9)],["shrink .85",shrink(.85)],["shrink .80",shrink(.8)]] as [string,(p:number)=>number][]){
    const m=metrics(f,all);console.log(`  ${n.padEnd(12)} acc ${(m.acc*100).toFixed(1)}%  Brier ${m.br.toFixed(4)}  LogLoss ${m.ll.toFixed(4)}`);}
  // Platt: fit a,b on train minimizing logloss (grid)
  let bestA=1,bestB=0,bestLL=1e9;
  for(let a=0.5;a<=1.05;a+=0.05)for(let b=-0.4;b<=0.4;b+=0.05){let ll=0;for(const x of train){const q=cl(sig(a*logit(cl(x.p))+b));ll+=-(x.won*Math.log(q)+(1-x.won)*Math.log(1-q));}ll/=train.length;if(ll<bestLL){bestLL=ll;bestA=a;bestB=b;}}
  const platt=(p:number)=>sig(bestA*logit(cl(p))+bestB);
  console.log(`\n  Platt fit on 2022-24: a=${bestA.toFixed(2)} b=${bestB.toFixed(2)}`);
  console.log("  --- OUT-OF-SAMPLE on 2025 ---");
  for(const [n,f] of [["raw Elo",raw],["shrink .85",shrink(.85)],["Platt",platt]] as [string,(p:number)=>number][]){
    const m=metrics(f,test);console.log(`    ${n.padEnd(12)} acc ${(m.acc*100).toFixed(1)}%  Brier ${m.br.toFixed(4)}  LogLoss ${m.ll.toFixed(4)}`);}
  console.log("\n=== calibration buckets (Platt, whole eval) ===");
  for(const [lo,hi] of [[.5,.6],[.6,.7],[.7,.8],[.8,1.01]]){const b=all.filter(p=>{const q=platt(p.p);return q>=lo&&q<hi;});if(!b.length)continue;const pred=b.reduce((s,p)=>s+platt(p.p),0)/b.length,act=b.filter(p=>p.won===1).length/b.length;console.log(`  ${lo}-${hi}: n=${String(b.length).padStart(4)} pred ${(pred*100).toFixed(1)}% actual ${(act*100).toFixed(1)}%`);}
  console.log("\n=== favorite overconfidence (raw vs Platt, top bucket 0.7+) ===");
  {const b=all.filter(p=>p.p>=0.7);console.log(`  raw:   pred ${(b.reduce((s,p)=>s+p.p,0)/b.length*100).toFixed(1)}% actual ${(b.filter(p=>p.won).length/b.length*100).toFixed(1)}%`);
   console.log(`  Platt: pred ${(b.reduce((s,p)=>s+platt(p.p),0)/b.length*100).toFixed(1)}% actual ${(b.filter(p=>p.won).length/b.length*100).toFixed(1)}%`);}
  console.log("\n=== underdog/upset detection (model dog wins) ===");
  {const dogs=all.filter(p=>p.p<0.5);const dogWins=dogs.filter(p=>p.won===1).length;console.log(`  model-underdog games: ${dogs.length}, actually won: ${dogWins} (${(dogWins/dogs.length*100).toFixed(1)}%)`);}
})();
