/* WNBA margin/spread research. Tests whether the model understands margin dynamics.
   NO ATS/units claims (no historical lines). Margin ablation + distribution + synthetic coherence. */
import fs from "fs";
type G={id:number;date:string;season:number;post:boolean;h:number;a:number;hs:number;as:number};
const games:G[]=JSON.parse(fs.readFileSync("wnba-research/games.json","utf8"));
const feat=new Map<number,any>();
for(const l of fs.readFileSync("wnba-research/espn-features.jsonl","utf8").split("\n")) if(l.trim()){try{const r=JSON.parse(l);feat.set(r.gameId,r);}catch{}}
const G2=games.filter(g=>g.season>=2022&&feat.has(g.id)).sort((x,y)=>x.date<y.date?-1:1);
console.log(`joined games with features: ${G2.length}`);

const poss=(t:any)=>(t.fga||0)-(t.oreb||0)+(t.tov||0)+0.44*(t.fta||0);
const efg=(t:any)=>t.fga?(t.fgm+0.5*t.tpm)/t.fga:null;
const off=new Map<number,number[]>(),def=new Map<number,number[]>(),pace=new Map<number,number[]>(),efgF=new Map<number,number[]>(),mar=new Map<number,number[]>(),elo=new Map<number,number>(),lastSeason=new Map<number,number>(),seen=new Map<number,number>(),lastDate=new Map<number,string>();
const E=(t:number)=>elo.get(t)??1500;
const roll=(m:Map<number,number[]>,t:number,d:number,n=10)=>{const x=m.get(t)||[];return x.length?x.slice(-n).reduce((s,v)=>s+v,0)/Math.min(x.length,n):d;};
const std=(m:Map<number,number[]>,t:number,d:number,n=10)=>{const x=(m.get(t)||[]).slice(-n);if(x.length<3)return d;const mu=x.reduce((s,v)=>s+v,0)/x.length;return Math.sqrt(x.reduce((s,v)=>s+(v-mu)**2,0)/x.length);};
const push=(m:Map<number,number[]>,t:number,v:number)=>{const x=m.get(t)||[];x.push(v);m.set(t,x);};
const HFA=65,K=20,PPE=25,HFApts=1.3; let LGoff=100,LGn=0;
const dexp=(d:number)=>1/(1+Math.pow(10,d/400));

type P={g:G;mElo:number;mEff:number;mRest:number;mForm:number;ngH:number;ngA:number;restAdv:number;favStr:number;vol:number};
const preds:P[]=[];
for(const g of G2){
  const f=feat.get(g.id); const ht=f.teams.find((t:any)=>t.homeAway==="home")||f.teams[0]; const at=f.teams.find((t:any)=>t.homeAway==="away")||f.teams[1];
  for(const t of [g.h,g.a]){ if(lastSeason.get(t)!==undefined&&lastSeason.get(t)!==g.season)elo.set(t,1500+0.75*(E(t)-1500)); lastSeason.set(t,g.season); }
  const eh=E(g.h),ea=E(g.a);
  const mElo=(eh+HFA-ea)/PPE;
  const expPoss=(roll(pace,g.h,82)+roll(pace,g.a,82))/2;
  const hOff=roll(off,g.h,LGoff),aDef=roll(def,g.a,LGoff),aOff=roll(off,g.a,LGoff),hDef=roll(def,g.h,LGoff);
  const mEff=((hOff+aDef-LGoff)-(aOff+hDef-LGoff))/100*expPoss+HFApts;
  const restH=lastDate.has(g.h)?Math.round((+new Date(g.date)-+new Date(lastDate.get(g.h)!))/86400000):7;
  const restA=lastDate.has(g.a)?Math.round((+new Date(g.date)-+new Date(lastDate.get(g.a)!))/86400000):7;
  const restAdv=Math.max(-3,Math.min(3,restH-restA));
  const formH=roll(mar,g.h,0),formA=roll(mar,g.a,0);
  const mBase=(mElo+mEff)/2;
  const vol=(std(mar,g.h,12)+std(mar,g.a,12))/2;
  preds.push({g,mElo,mEff,mRest:mBase+0.4*restAdv,mForm:mBase+0.15*(formH-formA),ngH:seen.get(g.h)||0,ngA:seen.get(g.a)||0,restAdv,favStr:Math.abs(mElo),vol});
  // update
  const hp=poss(ht),ap=poss(at);
  if(hp>20&&ap>20){ const hoff=g.hs/hp*100,aoff=g.as/ap*100; if(isFinite(hoff)&&isFinite(aoff)){
    push(off,g.h,hoff);push(def,g.h,aoff);push(pace,g.h,hp);push(off,g.a,aoff);push(def,g.a,hoff);push(pace,g.a,ap);
    LGoff=(LGoff*LGn+hoff+aoff)/(LGn+2);LGn+=2; }}
  push(mar,g.h,g.hs-g.as);push(mar,g.a,g.as-g.hs);
  const margin=g.hs-g.as,homeWon=margin>0,pElo=dexp(-(eh+HFA-ea)),mult=Math.log(Math.abs(margin)+1)*(2.2/((homeWon?eh+HFA-ea:ea-eh-HFA)*0.001+2.2));
  elo.set(g.h,eh+K*mult*((homeWon?1:0)-pElo));elo.set(g.a,ea-K*mult*((homeWon?1:0)-pElo));
  seen.set(g.h,(seen.get(g.h)||0)+1);seen.set(g.a,(seen.get(g.a)||0)+1);lastDate.set(g.h,g.date);lastDate.set(g.a,g.date);
}
const ev=preds.filter(p=>p.ngH>=10&&p.ngA>=10&&isFinite(p.mEff));
const act=(p:P)=>p.g.hs-p.g.as;
const MAE=(f:(p:P)=>number,s=ev)=>s.reduce((a,p)=>a+Math.abs(f(p)-act(p)),0)/s.length;
const RMSE=(f:(p:P)=>number,s=ev)=>Math.sqrt(s.reduce((a,p)=>a+(f(p)-act(p))**2,0)/s.length);
const MED=(f:(p:P)=>number,s=ev)=>{const e=s.map(p=>Math.abs(f(p)-act(p))).sort((a,b)=>a-b);return e[Math.floor(e.length/2)];};
console.log(`eval games: ${ev.length}\n`);
console.log("=== 1. MARGIN LAYER ABLATION (lower=better) ===");
const models:[string,(p:P)=>number][]=[["Elo only",p=>p.mElo],["Efficiency only",p=>p.mEff],["Elo+Eff blend",p=>(p.mElo+p.mEff)/2],["blend+rest",p=>p.mRest],["blend+form",p=>p.mForm]];
for(const [n,f] of models) console.log(`  ${n.padEnd(16)} MAE ${MAE(f).toFixed(2)}  RMSE ${RMSE(f).toFixed(2)}  Median ${MED(f).toFixed(2)}`);
const best=(p:P)=>(p.mElo+p.mEff)/2;
console.log("\n=== 2. MARGIN ERROR BY BUCKET (Elo+Eff blend) ===");
const bucket=(name:string,grp:(p:P)=>string)=>{const m=new Map<string,P[]>();for(const p of ev){(m.get(grp(p))||m.set(grp(p),[]).get(grp(p))!).push(p);}console.log(`  -- ${name} --`);for(const [k,s] of [...m].sort())if(s.length>=20)console.log(`     ${k.padEnd(14)} n=${String(s.length).padStart(4)} MAE ${MAE(best,s).toFixed(2)}`);};
bucket("favorite strength",p=>p.favStr<3?"toss(<3)":p.favStr<7?"mod(3-7)":"strong(7+)");
bucket("home/away fav",p=>best(p)>0?"home fav":"away fav");
bucket("rest",p=>p.restAdv>=2?"rested+":p.restAdv<=-2?"tired-":"even");
bucket("volatility",p=>p.vol<11?"low":p.vol<14?"mid":"high");
bucket("season",p=>String(p.g.season));
console.log("\n=== 3. MARGIN DISTRIBUTION (residual sigma) ===");
const resid=ev.map(p=>act(p)-best(p)); const sigma=Math.sqrt(resid.reduce((s,r)=>s+r*r,0)/resid.length);
console.log(`  residual sigma: ${sigma.toFixed(2)} pts (margin std around projection)`);
const ncdf=(z:number)=>0.5*(1+erf(z/Math.SQRT2)); function erf(x:number){const t=1/(1+0.3275911*Math.abs(x));const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return x>=0?y:-y;}
// average game: P(close<=5), P(blowout>=11) using sigma
{const m=Math.abs(best(ev[0]));console.log(`  for a pick'em (proj 0): P(close<=5)=${((ncdf(5/sigma)-ncdf(-5/sigma))*100).toFixed(0)}%  P(margin>=11 either side)=${((1-ncdf(11/sigma))*2*100).toFixed(0)}%`);}
// volatility split reliability
const lowVol=ev.filter(p=>p.vol<11.5),hiVol=ev.filter(p=>p.vol>=13.5);
console.log(`  low-vol games (n=${lowVol.length}): margin MAE ${MAE(best,lowVol).toFixed(2)}`);
console.log(`  high-vol games (n=${hiVol.length}): margin MAE ${MAE(best,hiVol).toFixed(2)}  <- reliability gap`);
console.log("\n=== 4. SYNTHETIC-LINE COHERENCE (Elo-implied line; NOT units) ===");
{let c=0,n=0;for(const p of ev){const line=p.mElo;const side=best(p)>line?1:-1;const a=act(p);if(a===line)continue;if((side>0)===(a>line))c++;n++;}console.log(`  model (Elo+Eff) vs Elo-implied line: agrees-with-outcome ${(c/n*100).toFixed(1)}% (n=${n}) — pure coherence check`);}
console.log("\n=== margin-bucket calibration (proj vs actual mean) ===");
for(const [lo,hi] of [[-99,-7],[-7,-3],[-3,3],[3,7],[7,99]]){const s=ev.filter(p=>best(p)>=lo&&best(p)<hi);if(s.length<20)continue;const pm=s.reduce((a,p)=>a+best(p),0)/s.length,am=s.reduce((a,p)=>a+act(p),0)/s.length;console.log(`  proj ${lo}..${hi}: n=${String(s.length).padStart(4)} mean-proj ${pm.toFixed(1)} actual-mean ${am.toFixed(1)}`);}
