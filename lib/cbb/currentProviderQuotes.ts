import type {CbbGame,CbbOdds,CbbQuote} from "./types";
import {normalizeCbbOdds} from "./marketEvidence";
import {isBlockedSportsbook} from "../config/blockedSportsbooks";
import {bookPriorityRank} from "../config/bookPriority";
import {mergeCbbCurrentSourceQuotes} from "./currentSourceQuotes";

export const CBB_CURRENT_QUOTES_RELEASE="cbb_current_quotes_2026_11_05_r2_named_book_gap_fill" as const;

/** BDL joins its own exact game IDs. Each full native book pair enters the
 * common frontier resolver; a different transport or market cannot hide it. */
export function cbbCurrentProviderQuotes(rows:CbbOdds[],game:CbbGame,at:string,requestedAt?:string):CbbQuote[]{
  return normalizeCbbOdds(rows,{gameId:game.id,startsAt:game.date,asOf:at,fetchedAt:at,phase:"current"}).quotes
    .filter(q=>!isBlockedSportsbook(q.sportsbook)&&Number.isFinite(bookPriorityRank(q.sportsbook))&&
      Date.parse(at)-Date.parse(q.providerObservedAt)<=3600_000)
    .map(q=>({...q,provider:"balldontlie" as const,providerEventId:String(q.gameId),...(requestedAt?{requestedAt}:{})}));
}
export function resolveCbbCurrentProviderQuotes(primary:CbbQuote[],rows:CbbOdds[],game:CbbGame,at:string){
  return mergeCbbCurrentSourceQuotes([...primary,...cbbCurrentProviderQuotes(rows,game,at)],game.id,at);
}
export function mergeCbbCurrentProviderQuotes(primary:CbbQuote[],rows:CbbOdds[],game:CbbGame,at:string):CbbQuote[]{
  return resolveCbbCurrentProviderQuotes(primary,rows,game,at).quotes;
}
