import type { MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { CbbGame, CbbMarket, CbbQuote } from "@/lib/cbb/types";
import { chooseCbbSupportedTargetBook } from "@/lib/cbb/provisionalBoard";
import { mergeCbbCurrentSourceQuotes } from "@/lib/cbb/currentSourceQuotes";
import { isBlockedSportsbook } from "@/lib/config/blockedSportsbooks";
import { bookPriorityRank } from "@/lib/config/bookPriority";
import { cbbImpliedProbability } from "@/lib/cbb/marketEvidence";

export const CBB_OBSERVED_MARKET_QUOTE_RELEASE="cbb_observed_market_quote_2026_11_13_r1_no_wager_required" as const;
/** Copy a real paired offer for display. Never selects a model side or line. */
export function cbbObservedMarketQuote(game:CbbGame,market:CbbMarket,quotes:CbbQuote[],now:string):MarketEdgeDto["observedMarketQuote"]{
  const at=Date.parse(now),start=Date.parse(game.date);
  if(!Number.isFinite(at)||!Number.isFinite(start)||at>=start)return undefined;
  const valid=quotes.filter(q=>q.gameId===game.id&&q.market===market&&q.phase==="current"&&!isBlockedSportsbook(q.sportsbook)&&Number.isFinite(bookPriorityRank(q.sportsbook))&&
    Number.isFinite(Date.parse(q.providerObservedAt))&&Number.isFinite(Date.parse(q.fetchedAt))&&
    Date.parse(q.providerObservedAt)<=Date.parse(q.fetchedAt)&&Date.parse(q.fetchedAt)<=at&&at-Date.parse(q.providerObservedAt)<=3600_000&&
    [q.firstPrice,q.secondPrice].every(p=>Number.isFinite(p)&&Math.abs(p)>=100)&&
    cbbImpliedProbability(q.firstPrice)+cbbImpliedProbability(q.secondPrice)>=.98&&
    cbbImpliedProbability(q.firstPrice)+cbbImpliedProbability(q.secondPrice)<=1.3&&
    (market==="moneyline"?q.line===null:q.line!==null&&Number.isInteger(q.line*2)&&(market!=="total"||q.line>0)));
  const resolved=mergeCbbCurrentSourceQuotes(valid,game.id,now).quotes;
  const book=chooseCbbSupportedTargetBook(resolved),quote=resolved.find(q=>q.sportsbook===book);
  if(!quote)return undefined;
  return {sportsbook:quote.sportsbook,observedAt:quote.providerObservedAt,quotes:[
    {label:market==="total"?"Over":game.home_team.abbreviation.trim(),american:quote.firstPrice,line:quote.line},
    {label:market==="total"?"Under":game.visitor_team.abbreviation.trim(),american:quote.secondPrice,
      line:market==="spread"&&quote.line!==null?-quote.line:quote.line},
  ]};
}
