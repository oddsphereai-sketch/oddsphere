/** Frozen published-input qualification only. Never writes a prediction or alters a lock. */
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {qualifyMoneylinePrice,MONEYLINE_PRICE_POLICY_RELEASE,type MoneylinePriceGrade} from "../../lib/services/dailyEdge/moneylinePricePolicy";
const flag=(k:string)=>process.argv.find(x=>x.startsWith(`--${k}=`))?.slice(k.length+3);
const path=flag("boards"),out=flag("out");if(!path||!out)throw Error("Supply --boards and --out");
const bytes=readFileSync(path,"utf8"),capture=JSON.parse(bytes),original=JSON.stringify(capture);
const labels:Record<string,MoneylinePriceGrade>={best_angle:"Best Angle",lean:"Lean",watchlist:"Watchlist",caution:"Watchlist",no_play:"No Play"};
const keys:Record<string,string>={"Best Angle":"best_angle",Lean:"lean",Watchlist:"watchlist","No Play":"no_play",Held:"no_play"};
const action=(x:string)=>["best_angle","lean"].includes(x);
const count=(rows:{grade:string}[])=>rows.reduce<Record<string,number>>((a,r)=>(a[r.grade]=(a[r.grade]??0)+1,a),{});
const reports=Object.entries(capture.boards).map(([sport,untyped])=>{
 const board=untyped as any,rows:any[]=[],changed:any[]=[],heldLegacy:any[]=[];
 for(const g of board.games??[])for(const slot of ["moneyline","first_inning","total"]){
  const m=g.markets[slot],old=m.verdict.key,price=m.currentPriceAmerican??m.priceAmerican??null;
  const market=slot==="first_inning"?"spread":slot,qualified=qualifyMoneylinePrice(market,price,m.held?"Held":labels[old]??"Held");
  const proposed=qualified===(labels[old]??"Held")?old:keys[qualified],next=g.lockedAt||!["nba","cbb","cfb"].includes(sport)?old:proposed;
  rows.push({grade:old,next,today:g.gameStartAt&&new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(new Date(g.gameStartAt))==="2026-11-06"});
  const proof={gameId:g.external_id,matchup:`${g.awayTeam}@${g.homeTeam}`,market,price,probability:m.modelProb,previous:old,next};
  if(old!==next)changed.push(proof);
  if(g.lockedAt&&proposed!==old)heldLegacy.push({...proof,lockedAt:g.lockedAt,unappliedCurrentPolicy:proposed});
 }
 return {sport,asOf:board.as_of,markets:rows.length,before:count(rows),after:count(rows.map(r=>({grade:r.next}))),
  today:{markets:rows.filter(r=>r.today).length,before:count(rows.filter(r=>r.today)),after:count(rows.filter(r=>r.today).map(r=>({grade:r.next})))},
  actionablePromotions:rows.filter(r=>!action(r.grade)&&action(r.next)).length,actionableDemotions:rows.filter(r=>action(r.grade)&&!action(r.next)).length,changed,legacyLocksPreserved:heldLegacy};
});
assert.equal(JSON.stringify(capture),original);
const report={release:MONEYLINE_PRICE_POLICY_RELEASE,captureSha256:createHash("sha256").update(bytes).digest("hex"),sports:reports,
 scope:"Native qualification integrated for NBA, CBB and CFB. Other six captured boards audited only; no unversioned reader override. Current policy never applies to historical locked payloads.",
 forecastPriceSelectionChanges:0,providerCalls:0,productionWrites:0,limits:"Same stored-input counterfactual, not new forecasts or historical accuracy. Actual live scope depends on unlocked state at publication."};
writeFileSync(out,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(reports.map(({changed,legacyLocksPreserved,...r})=>({...r,changed:changed.length,legacyLocksPreserved:legacyLocksPreserved.length})),null,2));
