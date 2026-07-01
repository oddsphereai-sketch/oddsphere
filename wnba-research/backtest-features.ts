/* Track A Step 2 — feature ablation. Joins BDL games + ESPN box features, builds
   rolling pace/efficiency/Four-Factors, walk-forward, tests layers for ML/totals/margin. */
import fs from "fs";
type G={id:number;date:string;season:number;post:boolean;h:number;a:number;hs:number;as:number};
const games:G[]=JSON.parse(fs.readFileSync("wnba-research/games.json","utf8"));
const feat=new Map<number,any>();
if(fs.existsSync("wnba-research/espn-features.jsonl"))
  for(const l of fs.readFileSync("wnba-research/espn-features.jsonl","utf8").split("\n")) if(l.trim()){try{const r=JSON.parse(l);feat.set(r.gameId,r);}catch{}}
console.log(`games ${games.length}, espn features ${feat.size}`);
const G2=games.filter(g=>g.season>=2022 && feat.has(g.id)).sort((x,y)=>x.date<y.date?-1:1);
console.log(`joined 2022+ with features: ${G2.length}`);
if(G2.length<200){ console.log("Not enough ESPN features collected yet — re-run after collect-espn finishes."); process.exit(0); }

const poss=(t:any)=> (t.fga||0) - (t.oreb||0) + (t.tov||0) + 0.44*(t.fta||0);
const efg=(t:any)=> t.fga? (t.fgm + 0.5*t.tpm)/t.fga : null;
// per-team rolling stores
const off=new Map<number,number[]>(),def=new Map<number,number[]>(),pace=new Map<number,number[]>(),efgF=new Map<number,number[]>(),tovF=new Map<number,number[]>(),orbF=new Map<number,number[]>(),elo=new Map<number,number>(),lastSeason=new Map<number,number>(),seen=new Map<number,number>(),lastDate=new Map<number,string>();
const E=(t:number)=>elo.get(t)??1500;
const roll=(m:Map<number,number[]>,t:number,d:number,n=10)=>{const x=m.get(t)||[];return x.length?x.slice(-n).reduce((s,v)=>s+v,0)/Math.min(x.length,n):d;};
const push=(m:Map<number,number[]>,t:number,v:number)=>{const x=m.get(t)||[];x.push(v);m.set(t,x);};
const dexp=(d:number)=>1/(1+Math.pow(10,d/400));
const HFA=65,K=20,PPE=25;
let LGoff=100, LGtot=164, LGn=0;

type P={g:G;pElo:number;mElo:number;projTotal:number;projMargin:number;ngH:number;ngA:number;restAdv:number};
const preds:P[]=[];
for(const g of G2){
  const f=feat.get(g.id); const ht=f.teams.find((t:any)=>t.homeAway==="home")||f.teams[0]; const at=f.teams.find((t:any)=>t.homeAway==="away")||f.teams[1];
  for(const t of [g.h,g.a]){ if(lastSeason.get(t)!==undefined&&lastSeason.get(t)!==g.season)elo.set(t,1500+0.75*(E(t)-1500)); lastSeason.set(t,g.season); }
  const eh=E(g.h),ea=E(g.a);
  const pElo=dexp(-(eh+HFA-ea)), mElo=(eh+HFA-ea)/PPE;
  // efficiency totals/margin model (rolling, opponent-adjusted)
  const expPoss=(roll(pace,g.h,82)+roll(pace,g.a,82))/2;
  const hOff=roll(off,g.h,LGoff),aDef=roll(def,g.a,LGoff),aOff=roll(off,g.a,LGoff),hDef=roll(def,g.h,LGoff);
  const homePts=(hOff+aDef-LGoff)/100*expPoss, awayPts=(aOff+hDef-LGoff)/100*expPoss;
  const restH=lastDate.has(g.h)?Math.round((+new Date(g.date)-+new Date(lastDate.get(g.h)!))/86400000):7;
  const restA=lastDate.has(g.a)?Math.round((+new Date(g.date)-+new Date(lastDate.get(g.a)!))/86400000):7;
  preds.push({g,pElo,mElo,projTotal:homePts+awayPts,projMargin:homePts-awayPts+1.3,ngH:seen.get(g.h)||0,ngA:seen.get(g.a)||0,restAdv:restH-restA});
  // ---- update (guard bad box parses so they don't poison rolling/league means) ----
  const hp=poss(ht),ap=poss(at);
  if(hp>20&&ap>20&&isFinite(hp)&&isFinite(ap)){
    const hoff=g.hs/hp*100,aoff=g.as/ap*100;
    if(isFinite(hoff)&&isFinite(aoff)){
      push(off,g.h,hoff);push(def,g.h,aoff);push(pace,g.h,hp);push(off,g.a,aoff);push(def,g.a,hoff);push(pace,g.a,ap);
      const eh2=efg(ht),ea2=efg(at); if(eh2!=null)push(efgF,g.h,eh2); if(ea2!=null)push(efgF,g.a,ea2);
      LGoff=(LGoff*LGn+hoff+aoff)/(LGn+2);LGtot=(LGtot*LGn+(g.hs+g.as))/(LGn+1);LGn+=2;
    }
  }
  const margin=g.hs-g.as,homeWon=margin>0,mult=Math.log(Math.abs(margin)+1)*(2.2/((homeWon?eh+HFA-ea:ea-eh-HFA)*0.001+2.2));
  elo.set(g.h,eh+K*mult*((homeWon?1:0)-pElo));elo.set(g.a,ea-K*mult*((homeWon?1:0)-pElo));
  seen.set(g.h,(seen.get(g.h)||0)+1);seen.set(g.a,(seen.get(g.a)||0)+1);lastDate.set(g.h,g.date);lastDate.set(g.a,g.date);
}
const ev=preds.filter(p=>p.ngH>=10&&p.ngA>=10&&isFinite(p.projTotal)&&isFinite(p.projMargin));
console.log(`eval games: ${ev.length}\n`);
const shrink=(p:number,k=0.75)=>0.5+(p-0.5)*k;
const acc=(f:(p:P)=>number)=>ev.filter(p=>(f(p)>=0.5)===(p.g.hs>p.g.as)).length/ev.length;
const brier=(f:(p:P)=>number)=>ev.reduce((s,p)=>s+Math.pow(f(p)-(p.g.hs>p.g.as?1:0),2),0)/ev.length;
const mae=(f:(p:P)=>number,a:(p:P)=>number)=>ev.reduce((s,p)=>s+Math.abs(f(p)-a(p)),0)/ev.length;
// blended ML: combine Elo prob with efficiency margin -> prob
const effProb=(p:P)=>dexp(-p.projMargin*PPE/ (1)); // margin->prob via PPE inverse (approx)
const blend=(p:P)=>0.5*p.pElo+0.5*Math.min(0.99,Math.max(0.01,1/(1+Math.exp(-p.projMargin/6))));
console.log("=== A. ML ===");
console.log(`  Elo            acc ${(acc(p=>p.pElo)*100).toFixed(1)}%  Brier ${brier(p=>p.pElo).toFixed(4)}`);
console.log(`  Elo+shrink.75  acc ${(acc(p=>shrink(p.pElo))*100).toFixed(1)}%  Brier ${brier(p=>shrink(p.pElo)).toFixed(4)}`);
console.log(`  Elo+efficiency acc ${(acc(blend)*100).toFixed(1)}%  Brier ${brier(blend).toFixed(4)}`);
console.log("\n  Elo calibration 0.7+ bucket:");
{const b=ev.filter(p=>p.pElo>=0.7);console.log(`    raw: pred ${(b.reduce((s,p)=>s+p.pElo,0)/b.length*100).toFixed(1)}% actual ${(b.filter(p=>p.g.hs>p.g.as).length/b.length*100).toFixed(1)}%`);
 console.log(`    shrunk: pred ${(b.reduce((s,p)=>s+shrink(p.pElo),0)/b.length*100).toFixed(1)}% actual same`);}
console.log("\n=== B. TOTALS (pace x efficiency model) ===");
const naiveTot=ev.reduce((s,p)=>s+p.g.hs+p.g.as,0)/ev.length;
console.log(`  projected total MAE: ${mae(p=>p.projTotal,p=>p.g.hs+p.g.as).toFixed(2)}  (naive league-avg ${mae(()=>naiveTot,p=>p.g.hs+p.g.as).toFixed(2)})`);
console.log(`  team-score MAE:      ${(mae(p=>p.projTotal/2,p=>p.g.hs)).toFixed(2)} (rough)`);
// over/under side vs synthetic line = each game's own actual is graded vs a NEUTRAL line = rolling expected; use median projected as line proxy
{let c=0,n=0;for(const p of ev){const line=naiveTot;const actual=p.g.hs+p.g.as;if(actual===line)continue;const pickOver=p.projTotal>line;if(pickOver===(actual>line))c++;n++;}console.log(`  O/U side vs league-avg line: ${(c/n*100).toFixed(1)}% (n=${n})`);}
console.log("\n=== C. MARGIN/SPREAD ===");
console.log(`  Elo margin MAE:        ${mae(p=>p.mElo,p=>p.g.hs-p.g.as).toFixed(2)}`);
console.log(`  efficiency margin MAE: ${mae(p=>p.projMargin,p=>p.g.hs-p.g.as).toFixed(2)}`);
console.log(`  blend(elo+eff) margin: ${mae(p=>(p.mElo+p.projMargin)/2,p=>p.g.hs-p.g.as).toFixed(2)}`);
