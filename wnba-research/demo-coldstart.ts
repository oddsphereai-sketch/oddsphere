/* Prove cold-start: replay 2026 with FIXED-K vs DYNAMIC-K Elo, show expansion teams' early
   predictions + rating convergence + early accuracy. (Market-blend prior anchors thinner.) */
import fs from "fs";
const KEY=process.env.KEY!; const B="https://api.balldontlie.io/wnba/v1";
const dexp=(d:number)=>1/(1+Math.pow(10,d/400)); const HFA=65;
const norm=(s:string)=>String(s).replace(/[^a-z]/gi,"").toLowerCase();
(async()=>{
  const teams=(await (await fetch(`${B}/teams`,{headers:{Authorization:KEY}})).json()).data;
  const nm=new Map<number,string>(teams.map((t:any)=>[t.id,t.full_name]));
  const idOf=(mascot:string)=>teams.find((t:any)=>norm(t.name)===mascot)?.id;
  const FIRE=idOf("fire"),VALK=idOf("valkyries"); // 2026 expansion teams
  const games=JSON.parse(fs.readFileSync("wnba-research/games-all.json","utf8")).filter((g:any)=>g.hs>0&&g.as>0&&g.season<=2026).sort((a:any,b:any)=>a.date<b.date?-1:1);
  // two Elo systems
  const eF=new Map<number,number>(),eD=new Map<number,number>(),ls=new Map<number,number>(),seen=new Map<number,number>();
  const E=(m:Map<number,number>,t:number)=>m.get(t)??1500;
  const traj:Record<number,any[]>={[FIRE]:[],[VALK]:[]};
  let bF=0,bD=0,nEval=0; // early-game (first 8 of expansion teams) Brier
  for(const g of games){
    for(const t of [g.h,g.a]){if(ls.get(t)!==undefined&&ls.get(t)!==g.season){eF.set(t,1500+0.75*(E(eF,t)-1500));eD.set(t,1500+0.75*(E(eD,t)-1500));}ls.set(t,g.season);}
    const fh=E(eF,g.h),fa=E(eF,g.a),dh=E(eD,g.h),da=E(eD,g.a);
    const pF=dexp(-(fh+HFA-fa)),pD=dexp(-(dh+HFA-da)),won=g.hs>g.as?1:0;
    for(const exp of [FIRE,VALK]) if((g.h===exp||g.a===exp)&&g.season===2026){const n=(seen.get(exp)||0)+1;
      if(n<=8){const isH=g.h===exp,wExp=isH?won:1-won,pFx=isH?pF:1-pF,pDx=isH?pD:1-pD;
        if(traj[exp].length<8)traj[exp].push({n,opp:nm.get(isH?g.a:g.h),naive:pFx,dyn:pDx,won:wExp,ratF:isH?fh:fa,ratD:isH?dh:da});
        bF+=(pFx-wExp)**2;bD+=(pDx-wExp)**2;nEval++;}}
    const m=g.hs-g.as,hw=m>0,mult=Math.log(Math.abs(m)+1)*(2.2/((hw?fh+HFA-fa:fa-fh-HFA)*0.001+2.2));
    eF.set(g.h,fh+20*mult*(won-pF));eF.set(g.a,fa-20*mult*(won-pF));
    const Kd=(t:number)=>20+40*Math.exp(-(seen.get(t)||0)/8);
    eD.set(g.h,dh+Kd(g.h)*mult*(won-pD));eD.set(g.a,da-Kd(g.a)*mult*(won-pD));
    seen.set(g.h,(seen.get(g.h)||0)+1);seen.set(g.a,(seen.get(g.a)||0)+1);
  }
  for(const [id,t] of Object.entries(traj)){ if(!t.length)continue;
    console.log(`\n=== ${nm.get(+id)} — first ${t.length} games of 2026 (naive fixed-K vs dynamic-K) ===`);
    for(const r of t)console.log(`  G${r.n} vs ${r.opp?.padEnd(20)} naiveElo ${r.ratF.toFixed(0)}/P${(r.naive*100).toFixed(0)}%  dynElo ${r.ratD.toFixed(0)}/P${(r.dyn*100).toFixed(0)}%  actual ${r.won?"W":"L"}`);}
  console.log(`\nEXPANSION early-game Brier (first 8 each): fixed-K ${(bF/nEval).toFixed(4)}  dynamic-K ${(bD/nEval).toFixed(4)}  (lower=better, n=${nEval})`);
  console.log(`Cold-start mechanisms: dynamic K (above) + market-blend prior for <15-game teams (in slate adapter) + widened σ (uncertainty→confidence). Today's slate: expansion teams now have ≥15g → graduated.`);
})();
