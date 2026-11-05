import type {CbbQuote} from "@/lib/cbb/types";
export const CBB_CURRENT_SOURCE_MERGE_RELEASE="cbb_current_source_merge_2026_11_05_r1_native_book_frontiers" as const;
/** Providers are transports, not independent votes. The newest actual native
 * book state wins. Contradictory same-clock states are quarantined, not averaged. */
export function mergeCbbCurrentSourceQuotes(quotes:CbbQuote[],gameId:number,asOf:string){
 const groups=new Map<string,CbbQuote[]>(),at=Date.parse(asOf);
 if(!Number.isFinite(at))throw Error("CBB current-source decision clock invalid");
 for(const quote of quotes){
  if(quote.gameId!==gameId)throw Error("CBB current-source game identity changed");
  if(Date.parse(quote.fetchedAt)>at||Date.parse(quote.providerObservedAt)>Date.parse(quote.fetchedAt)||
   !Number.isFinite(Date.parse(quote.fetchedAt))||!Number.isFinite(Date.parse(quote.providerObservedAt))||at-Date.parse(quote.providerObservedAt)>3600_000)continue;
  const key=`${quote.sportsbook}:${quote.market}`;groups.set(key,[...(groups.get(key)??[]),quote]);
 }
 const current:CbbQuote[]=[],quarantined:Array<{book:string;market:CbbQuote["market"];reason:string;sourceAt:string}>=[];
 let duplicates=0;
 for(const rows of groups.values()){
  const frontier=Math.max(...rows.map(q=>Date.parse(q.providerObservedAt))),latest=rows.filter(q=>Date.parse(q.providerObservedAt)===frontier);
  const states=new Set(latest.map(q=>JSON.stringify([q.line,q.firstPrice,q.secondPrice])));
  if(states.size!==1){quarantined.push({book:rows[0].sportsbook,market:rows[0].market,reason:"conflicting_same_native_book_time_across_providers",sourceAt:new Date(frontier).toISOString()});continue;}
  // Keep one original receipt whole, including its actual request/availability
  // clocks. Never manufacture a clock by combining fields from two providers.
  latest.sort((a,b)=>Date.parse(a.fetchedAt)-Date.parse(b.fetchedAt));current.push(latest[0]);duplicates+=latest.length-1;
 }
 return {release:CBB_CURRENT_SOURCE_MERGE_RELEASE,quotes:current,quarantined,duplicates};
}
