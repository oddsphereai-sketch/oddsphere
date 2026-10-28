/** Pure member-display quote selection. No model, recommendation or lock writes. */
import {bookPriorityRank} from "@/lib/config/bookPriority";
import {isBlockedSportsbook} from "@/lib/config/blockedSportsbooks";
import type {PredictionMarketBookTrail} from "@/app/lab/lib/predictionMarketDisplay";
export type ComparisonQuote={sportsbook:string;market:string;side:string;line:number|null;american:number|null;at:string};
export function selectPredictionMarketBook(quotes:ComparisonQuote[],market:string,side:string,line:number|null,now=Date.now()):PredictionMarketBookTrail|null {
  const groups=new Map<string,ComparisonQuote[]>();
  for(const row of quotes){
    const book=row.sportsbook.trim().toLowerCase(),at=Date.parse(row.at);
    if(row.market!==market||row.side!==side||!Number.isFinite(at)||at>now||now-at>86_400_000||
      row.american===null||!Number.isFinite(row.american)||Math.abs(row.american)<100||
      isBlockedSportsbook(book)||!Number.isFinite(bookPriorityRank(book))||["locked_snapshot","recommendation_snapshot","splits_consensus"].includes(book)||
      (market==="moneyline"||market==="btts"?row.line!==null:row.line===null||!Number.isFinite(row.line)))continue;
    const rows=groups.get(book)??[];rows.push({...row,sportsbook:book});groups.set(book,rows);
  }
  const candidates=[...groups].map(([sportsbook,rows])=>{
    rows.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    const latest=rows[0],sameTime=rows.filter(r=>r.at===latest.at),exact=sameTime.find(r=>r.line===line);
    // If the main line moved, keep its actual latest threshold explicitly.
    const chosen=exact??[...sameTime].sort((a,b)=>Math.abs((a.line??0)-(line??0))-Math.abs((b.line??0)-(line??0)))[0];
    const points=new Map<number,[number,number,number]>();
    for(const row of [...rows].reverse())if(row.line===chosen.line){const p=row.american!>0?100/(100+row.american!):-row.american!/(100-row.american!);points.set(Date.parse(row.at),[Date.parse(row.at),p,row.american!]);}
    const ordered=[...points.values()].sort((a,b)=>a[0]-b[0]);
    return {sportsbook,line:chosen.line,points:ordered.length>100?[ordered[0],...ordered.slice(-99)]:ordered,locked:false,latest:Date.parse(latest.at)};
  });
  const rank=(book:string)=>book==="circa"?0:book==="pinnacle"?1:2+bookPriorityRank(book);
  candidates.sort((a,b)=>Number(now-a.latest>600_000)-Number(now-b.latest>600_000)||rank(a.sportsbook)-rank(b.sportsbook)||b.latest-a.latest);
  const chosen=candidates[0];if(!chosen)return null;
  const {latest:_,...trail}=chosen;void _;return trail;
}
