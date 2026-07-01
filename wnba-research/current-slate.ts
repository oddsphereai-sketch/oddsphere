/* WNBA v1 — INDEPENDENT MODEL FIRST, market-assisted (not market-anchored).
   Game list from BDL schedule (authoritative home/away, dedup via team-id). Dynamic blend.
   Every usable game gets ML/spread/total final sides. Per-market own-distribution confidence. */
import fs from "fs";
const KEY=process.env.KEY!; const B="https://api.balldontlie.io/wnba/v1";
const {HFA,ratings}=JSON.parse(fs.readFileSync("wnba-research/current-elo.json","utf8"));
const elo=new Map<number,number>(ratings); const E=(t:number)=>elo.get(t)??1500;
const dexp=(d:number)=>1/(1+Math.pow(10,d/400)); const sig=(x:number)=>1/(1+Math.exp(-x)); const logit=(p:number)=>Math.log(p/(1-p)); const cl=(p:number)=>Math.min(0.99,Math.max(0.01,p));
const platt=(p:number)=>sig(0.85*logit(cl(p))-0.20);
const amP=(o:number)=>o>0?100/(o+100):Math.abs(o)/(Math.abs(o)+100);
const med=(a:number[])=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
const norm=(s:string)=>String(s).replace(/[^a-z]/gi,"").toLowerCase();
function erf(x:number){const t=1/(1+0.3275911*Math.abs(x));const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);return x>=0?y:-y;}
const Phi=(z:number)=>0.5*(1+erf(z/Math.SQRT2)); const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const SIG_M=12.8,SIG_T=15.0;
const BLOCKED=new Set(["fliff","kalshi","polymarket"]);
const SHARP=new Set(["circa","betonline","draftkings","betmgm","caesars","bet365 us","betrivers","pinnacle"]);
(async()=>{
  const teams=(await (await fetch(`${B}/teams`,{headers:{Authorization:KEY}})).json()).data;
  const nameById=new Map<number,string>(); const mascot:[string,number][]=[];
  for(const t of teams){ nameById.set(t.id,t.full_name); mascot.push([norm(t.name),t.id]); }
  const resolve=(s:string):number|null=>{ const n=norm(s); for(const [m,id] of mascot) if(m.length>=3&&n.includes(m)) return id; return null; };
  const games=JSON.parse(fs.readFileSync("wnba-research/games-all.json","utf8")).filter((g:any)=>g.hs>0&&g.as>0).sort((a:any,b:any)=>a.date<b.date?-1:1);
  const pf=new Map<number,number[]>(),pa=new Map<number,number[]>(),gp=new Map<number,number>();
  for(const g of games){for(const [t,f,a] of [[g.h,g.hs,g.as],[g.a,g.as,g.hs]] as any){(pf.get(t)||pf.set(t,[]).get(t)!).push(f);(pa.get(t)||pa.set(t,[]).get(t)!).push(a);gp.set(t,(gp.get(t)||0)+1);}}
  const r10=(m:Map<number,number[]>,t:number)=>{const x=m.get(t)||[];return x.length?x.slice(-10).reduce((s,v)=>s+v,0)/Math.min(10,x.length):82;};
  const lines=fs.readFileSync("wnba-research/odds-snapshots.jsonl","utf8").trim().split("\n");
  const snap=JSON.parse(lines[lines.length-1]); const cutoff=snap.capturedAt.slice(0,10);
  const rows=snap.rows.filter((r:any)=>!BLOCKED.has((r.book||"").toLowerCase())&&r.stale!==true);
  const evDate=(s:string)=>{const m=String(s).match(/20\d\d-\d\d-\d\d/);return m?m[0]:null;};
  const byGame=new Map<string,any[]>(); const snapDates=new Set<string>();
  for(const r of rows){ const h=resolve(r.home),a=resolve(r.away); if(!h||!a||h===a)continue; const d=evDate(r.event)||evDate(r.start); if(!d)continue; snapDates.add(d); const k=[h,a].sort().join("|")+"|"+d; (byGame.get(k)||byGame.set(k,[]).get(k)!).push({...r,_h:h,_a:a}); }
  const allg:any[]=JSON.parse(fs.readFileSync("wnba-research/games-all.json","utf8"));
  // match BDL game to a snapshot game on the same date (±1 day for UTC/ET drift)
  const shift=(d:string,n:number)=>new Date(+new Date(d+"T12:00:00Z")+n*86400000).toISOString().slice(0,10);
  const seen=new Set<string>();
  const slate=allg.filter(g=>g.hs===0&&g.as===0&&g.date>=cutoff&&[shift(g.date,-1),g.date,shift(g.date,1)].some(d=>snapDates.has(d))).sort((a,b)=>a.date<b.date?-1:1).filter(g=>{const k=[g.h,g.a].sort().join("|")+g.date;if(seen.has(k))return false;seen.add(k);return true;});
  const out:string[]=[],shadow:any[]=[];
  for(const g of slate){
    const pairKey=[g.h,g.a].sort().join("|");
    const r=[shift(g.date,-1),g.date,shift(g.date,1)].flatMap(d=>byGame.get(pairKey+"|"+d)||[]); if(!r.length)continue;
    const hN=nameById.get(g.h)!,aN=nameById.get(g.a)!,gpH=gp.get(g.h)||0,gpA=gp.get(g.a)||0;
    // ----- MARKET CONSENSUS (computed before model so it can inform the cold-start prior) -----
    const mlH:any[]=[],mlA:any[]=[],sp:number[]=[],spS:number[]=[],to:number[]=[],toS:number[]=[];
    for(const x of r){const bk=(x.book||"").toLowerCase(),sh=SHARP.has(bk),snapHomeIsBdlHome=x._h===g.h;
      if(x.mkt==="moneyline"){const isHome=(x.selType==="home")===snapHomeIsBdlHome;(isHome?mlH:mlA).push({bk,odds:x.odds});}
      if(x.mkt==="point_spread"&&x.line!=null&&Math.abs(x.line)<40){const isHome=(x.selType==="home")===snapHomeIsBdlHome;if(isHome){sp.push(Number(x.line));if(sh)spS.push(Number(x.line));}}
      if(x.mkt==="total_points"&&x.selType==="over"&&x.line!=null&&x.line>120&&x.line<220){to.push(Number(x.line));if(sh)toS.push(Number(x.line));}}
    const bP:number[]=[],sP:number[]=[];for(const h of mlH){const a=mlA.find(z=>z.bk===h.bk);if(a){const p=amP(h.odds)/(amP(h.odds)+amP(a.odds));bP.push(p);if(SHARP.has(h.bk))sP.push(p);}}
    const mktP=med(bP),sharpP=med(sP),books=bP.length;
    const mktSpread=med(sp),sharpSpread=med(spS),spDisp=sp.length?Math.max(...sp)-Math.min(...sp):0,spBooks=sp.length;
    const mktTotal=med(to),sharpTotal=med(toS),toDisp=to.length?Math.max(...to)-Math.min(...to):0,toBooks=to.length;
    // ----- INDEPENDENT MODEL w/ COLD-START prior (market = info for the prior, NOT the answer) -----
    const ehN=E(g.h),eaN=E(g.a); const naiveP=platt(dexp(-(ehN+HFA-eaN)));
    const COLD=15; const lm=mktP!=null?400*Math.log10(mktP/(1-mktP)):null;
    const coldAdj=(games:number,isHome:boolean,own:number,opp:number)=>{ if(games>=COLD||lm==null)return{rating:own,w:0,mi:null as number|null};
      const w=clamp(Math.exp(-games/8),0.1,0.7); const mi=isHome?(opp-HFA+lm):(opp+HFA-lm); return{rating:w*mi+(1-w)*own,w,mi}; };
    const csH=coldAdj(gpH,true,ehN,eaN), csA=coldAdj(gpA,false,eaN,ehN);
    const eh=csH.rating, ea=csA.rating;
    const modelP=platt(dexp(-(eh+HFA-ea)));
    const projMargin=((eh+HFA-ea)/25)*0.85;
    const projTotal=((r10(pf,g.h)+r10(pa,g.a))/2)+((r10(pf,g.a)+r10(pa,g.h))/2);
    const minG=Math.min(gpH,gpA), unc=0.5*Math.exp(-minG/8), sigM=SIG_M*(1+unc), sigT=SIG_T*(1+unc);
    const coldStart=csH.w>0||csA.w>0;
    const sharpPresent=sP.length>0;
    const marketRel=mktP!=null?clamp((Math.min(books,8)/8)*(spDisp<=1?1:spDisp<=3?0.85:0.6)*(sharpPresent?1:0.85),0.3,1):0;
    const modelStab=clamp(minG/25,0.4,1);
    let wMkt=mktP!=null?clamp(0.55*marketRel/modelStab,0.35,0.75):0;
    const edge=mktP!=null?modelP-mktP:0;
    if(Math.abs(edge)>=0.06&&modelStab>=0.8) wMkt=Math.max(0.35,wMkt-0.15);
    let finalP=mktP!=null?wMkt*mktP+(1-wMkt)*modelP:modelP;
    const conflict=mktP!=null&&((modelP>=0.5)!==(mktP>=0.5));
    if(conflict&&marketRel>=0.8&&Math.abs(edge)<0.04) finalP=0.5+(finalP-0.5)*0.5;
    const mlSide=finalP>=0.5?hN:aN,mlConf=Math.round(Math.max(finalP,1-finalP)*100);
    const pCoverHome=mktSpread!=null?1-Phi((-mktSpread-projMargin)/sigM):null,spEdge=mktSpread!=null?projMargin-(-mktSpread):null;
    const spSide=mktSpread!=null?(pCoverHome!>=0.5?`${hN} ${mktSpread>0?"+":""}${mktSpread}`:`${aN} ${mktSpread>0?"":"+"}${-mktSpread}`):"-",spConf=pCoverHome!=null?Math.round(Math.max(pCoverHome,1-pCoverHome)*100):null;
    const pOver=mktTotal!=null?1-Phi((mktTotal-projTotal)/sigT):null,toEdge=mktTotal!=null?projTotal-mktTotal:null;
    const toSide=mktTotal!=null?(pOver!>=0.5?`Over ${mktTotal}`:`Under ${mktTotal}`):"-",toConf=pOver!=null?Math.round(Math.max(pOver,1-pOver)*100):null;
    const mlGrade=mktP==null?"Watchlist":conflict&&marketRel>=0.8&&Math.abs(edge)<0.04?"Caution":(!conflict&&Math.abs(edge)>=0.04&&books>=6&&sharpPresent)?"Best Angle":Math.abs(edge)>=0.02&&books>=4?"Lean":"Watchlist";
    const gq=(e:number,b:number,d:number,sa:boolean)=>b<2?"Watchlist":e>=4&&d<=2&&b>=4&&sa?"Best Angle":e>=2.5&&d<=3&&b>=3?"Lean":"Watchlist";
    const spGrade=mktSpread!=null?gq(Math.abs(spEdge!),spBooks,spDisp,sharpSpread!=null&&Math.sign(sharpSpread-(-projMargin))===Math.sign(spEdge!)):"-";
    const toGrade=mktTotal!=null?gq(Math.abs(toEdge!),toBooks,toDisp,sharpTotal!=null&&Math.sign(sharpTotal-projTotal)===-Math.sign(toEdge!)):"-";
    out.push(`━━ ${aN} @ ${hN}  (${g.date}) ━━`);
    out.push(`  ML     model ${(modelP*100).toFixed(0)}% · market ${mktP!=null?(mktP*100).toFixed(0)+"%["+books+"bk]":"-"} · sharp ${sharpP!=null?(sharpP*100).toFixed(0)+"%":"-"} · edge ${(edge*100>=0?"+":"")+(edge*100).toFixed(1)}pp · wMkt ${wMkt.toFixed(2)}  ⇒ ${mlSide} ${mlConf}% [${mlGrade}]`);
    out.push(`  SPREAD model ${projMargin>=0?"+":""}${projMargin.toFixed(1)} · market ${mktSpread!=null?(mktSpread>0?"+":"")+mktSpread+"["+spBooks+"bk d"+spDisp+"]":"-"} · sharp ${sharpSpread??"-"} · edge ${spEdge!=null?(spEdge>=0?"+":"")+spEdge.toFixed(1):"-"}  ⇒ ${spSide} ${spConf??"-"}% [${spGrade}]`);
    out.push(`  TOTAL  model ${projTotal.toFixed(0)} · market ${mktTotal!=null?mktTotal+"["+toBooks+"bk d"+toDisp+"]":"-"} · sharp ${sharpTotal??"-"} · edge ${toEdge!=null?(toEdge>=0?"+":"")+toEdge.toFixed(1):"-"}  ⇒ ${toSide} ${toConf??"-"}% [${toGrade}]`);
    if(coldStart){const t=csH.w>0?hN:aN,games=csH.w>0?gpH:gpA,cs=csH.w>0?csH:csA,own=csH.w>0?ehN:eaN;
      out.push(`  ↳ COLD-START ${t} (${games}g): naive Elo P ${(naiveP*100).toFixed(0)}% → cold-adj ${(modelP*100).toFixed(0)}% | elo ${own.toFixed(0)} ⊕ market-prior ${cs.mi!.toFixed(0)} @ w=${cs.w.toFixed(2)} = ${cs.rating.toFixed(0)} | unc ${(unc*100).toFixed(0)}% widens σ`);}
    shadow.push({date:g.date,home:hN,away:aN,modelP,naiveP,coldStart,mktP,wMkt,finalP,mlSide,mlConf,mlGrade,projMargin,mktSpread,spSide,spConf,spGrade,projTotal,mktTotal,toSide,toConf,toGrade,
      cold_start_audit:coldStart?{home:{games:gpH,elo:ehN,market_prior:csH.mi,w:csH.w,final_rating:csH.rating},away:{games:gpA,elo:eaN,market_prior:csA.mi,w:csA.w,final_rating:csA.rating},rating_uncertainty:unc,dynamic_k_note:"K=20+40·exp(-games/8)"}:null});
  }
  console.log(out.join("\n")||"no matched games");
  fs.writeFileSync("wnba-research/shadow-"+cutoff+".json",JSON.stringify(shadow,null,1));
  console.log(`\nslate games: ${shadow.length} (deduped, BDL-authoritative)`);
})();
