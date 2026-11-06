/** Exact final-tier replay on a frozen member board; no model/provider/DB call.
 * --boards=/absolute/all-nine-board.json --out=/absolute/report.json */
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {applyNbaMoneylineBestPriceTier,type GradeOutput} from "../../lib/services/nba/nbaMarketReview";
const flag=(k:string)=>process.argv.find(x=>x.startsWith(`--${k}=`))?.slice(k.length+3);
const path=flag("boards"),out=flag("out"),date=flag("date")??"2026-11-06";if(!path||!out)throw Error("Supply --boards and --out");
const bytes=readFileSync(path,"utf8"),capture=JSON.parse(bytes),board=capture.boards.nba,before=JSON.stringify(board);
const et=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"});
const rows=[];
for(const g of board.games.filter((g:any)=>g.gameStartAt&&et.format(new Date(g.gameStartAt))===date))for(const slot of ["moneyline","first_inning","total"] as const){
 const m=g.markets[slot],old=m.verdict.key,market=slot==="first_inning"?"spread":slot;
 const incumbent:GradeOutput={grade:old==="best_angle"?"best_angle":old==="lean"?"lean":"watch",effectiveConfidence:m.recommendationConfidence??0,bestAngleEligible:old==="best_angle",rationale:[m.whyLine]};
 const next=applyNbaMoneylineBestPriceTier({market,currentPriceAmerican:m.currentPriceAmerican??m.priceAmerican},incumbent);
 rows.push({game:g.awayTeam+"@"+g.homeTeam,market,previous:old,next:next.grade!==incumbent.grade?"lean":old,price:m.currentPriceAmerican??m.priceAmerican,probability:m.modelProb,locked:g.lockedAt!=null});
}
assert.equal(JSON.stringify(board),before,"Final-tier replay must not mutate a stored board");
const count=(a:string[])=>a.reduce<Record<string,number>>((r,x)=>(r[x]=(r[x]??0)+1,r),{}),action=(x:string)=>x==="best_angle"||x==="lean";
const report={at:new Date().toISOString(),asOf:board.as_of,captureSha256:createHash("sha256").update(bytes).digest("hex"),markets:rows.length,
 before:count(rows.map(x=>x.previous)),after:count(rows.map(x=>x.next)),bestToLean:rows.filter(x=>x.previous==="best_angle"&&x.next==="lean").length,
 actionablePromotions:rows.filter(x=>!action(x.previous)&&action(x.next)).length,actionableDemotions:rows.filter(x=>action(x.previous)&&!action(x.next)).length,
 changed:rows.filter(x=>x.previous!==x.next),unchangedCapturedPayload:true,providerCalls:0,productionWrites:0,
 limits:"Frozen final price-tier policy only. A counterfactual never replaces a locked payload or establishes accuracy; source-read failure qualification is tested separately."};
writeFileSync(out,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
