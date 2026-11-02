import type { CbbGame, CbbOdds, CbbQuote } from "./types";
import { normalizeCbbOdds } from "./marketEvidence";
import { isBlockedSportsbook } from "../config/blockedSportsbooks";
import { bookPriorityRank } from "../config/bookPriority";

export const CBB_CURRENT_QUOTES_RELEASE="cbb_current_quotes_2026_11_02_r1_bdl_exact_id_gap_fill" as const;

/** BDL joins its own exact game IDs. Never construct a two-sided pair across
 * feeds or replace an existing qualified same-book/market primary quote. */
export function mergeCbbCurrentProviderQuotes(primary:CbbQuote[],rows:CbbOdds[],game:CbbGame,at:string):CbbQuote[] {
  const keys=new Set(primary.map(q=>`${q.sportsbook}:${q.market}`));
  const primaryMarkets=new Set(primary.map(q=>q.market));
  const extra=normalizeCbbOdds(rows,{gameId:game.id,startsAt:game.date,asOf:at,fetchedAt:at,phase:"current"}).quotes
    .filter(q=>!primaryMarkets.has(q.market)&&!isBlockedSportsbook(q.sportsbook)&&Number.isFinite(bookPriorityRank(q.sportsbook))&&
      Date.parse(at)-Date.parse(q.providerObservedAt)<=3600_000);
  const groups=new Map<string,CbbQuote[]>();
  for(const q of extra){const key=`${q.sportsbook}:${q.market}`;if(!keys.has(key))groups.set(key,[...(groups.get(key)??[]),q]);}
  return [...primary,...[...groups.values()].flatMap(group=>{
    const latest=Math.max(...group.map(q=>Date.parse(q.providerObservedAt)));
    const current=group.filter(q=>Date.parse(q.providerObservedAt)===latest);
    if(new Set(current.map(q=>JSON.stringify([q.line,q.firstPrice,q.secondPrice]))).size!==1)return [];
    return [{...current[0],provider:"balldontlie" as const}];
  })];
}
