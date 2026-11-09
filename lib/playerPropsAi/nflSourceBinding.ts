import {executionQuotes} from "./executionQuotes";
import {sameNflPropActorName} from "./nflPlayerIdentity";
/** Verified current source identity and one forecast authority per unlocked scope. */
import type {NflPlayerPropsRuntimeDecision as Row} from "../services/football/nflPlayerPropsRuntime";
import type {GamePacket,Quote} from "./evidenceContract";
import type {SiteAiDecision} from "./publication";
import {propsTeam} from "./teamIdentity";
import {instant} from "./evidence";
import {PROPS_AI_NFL_DECISION_RELEASE} from "./releases";

const book=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"");
const contract=(side:string,offer?:string)=>side==="yes"||offer==="milestone"?"milestone":"two_way";
export function nflAiSourceBinding(packet:GamePacket,choices:SiteAiDecision[],now:string){
  const at=instant(now),current=executionQuotes(packet,now);
  const playerId=(row:Row):string|null=>{
    if(row.gameId!==packet.gameId||instant(row.scheduledStart)!==instant(packet.start)
      ||instant(row.lockAt)!==instant(packet.lock)||!row.team||!row.opponent)return null;
    const candidates=packet.players.filter(p=>propsTeam(p.team)===propsTeam(row.team)
      &&propsTeam(p.opponent)===propsTeam(row.opponent)
      &&(row.providerPlayerId!==null?p.id===`nfl-bdl-player:${row.providerPlayerId}`:sameNflPropActorName(p.name,row.playerName,p.id.replace(/^nfl-bdl-player:/,""))));
    return candidates.length===1?candidates[0].id:null;
  };
  const scope=(id:string,market:string,side:string,offer?:string)=>JSON.stringify([id,market,contract(side,offer)]);
  const activeScopes=new Set(choices.map(c=>scope(c.playerId,c.market,c.quote.side,c.quote.offerContract)));
  function binding(row:Row):{id:string;choice:SiteAiDecision;quote:Quote}|null{
    const id=playerId(row);if(!id)return null;
    const c=choices.find(c=>c.playerId===id&&c.market===row.market&&c.line===row.line
      &&book(c.book)===book(row.sportsbook)&&c.provider===row.provider
      &&contract(c.quote.side,c.quote.offerContract)===contract(row.side));
    if(!c)return null;
    const quote=current.filter(q=>q.playerId===id&&q.market===row.market&&q.line===row.line
      &&q.side===row.side&&book(q.book)===book(row.sportsbook)&&q.provider===row.provider
      &&contract(q.side,q.offerContract)===contract(row.side)&&!q.opening&&!q.live
      &&q.receivedAtProvenance==="provider_response"&&instant(q.observedAt)<=instant(q.receivedAt)&&instant(q.receivedAt)<=at
      &&at-instant(q.receivedAt)<=15*60000)
      .sort((a,b)=>instant(b.receivedAt)-instant(a.receivedAt)||instant(b.observedAt)-instant(a.observedAt))[0];
    return quote?{id,choice:c,quote}:null;
  }
  function coherent(rows:Row[]){
    let supersededNative=0,duplicateReviewed=0,ambiguousIdentity=0;
    const seen=new Set<string>();
    const decisions=rows.filter(row=>{
      // Existing locks and unrelated scopes remain exact and in their stored order.
      if(row.state==="locked"||row.gameId!==packet.gameId||at>=instant(row.lockAt))return true;
      const id=playerId(row);if(!id){ambiguousIdentity++;return true;}
      if(!activeScopes.has(scope(id,row.market,row.side)))return true;
      if(!row.aiReview||row.decisionRelease!==PROPS_AI_NFL_DECISION_RELEASE){supersededNative++;return false;}
      const key=JSON.stringify([id,row.market,row.line,row.side,book(row.sportsbook),row.provider]);
      if(seen.has(key)){duplicateReviewed++;return false;}seen.add(key);return true;
    });
    return {decisions,report:{release:PROPS_AI_NFL_DECISION_RELEASE,supersededNative,duplicateReviewed,ambiguousIdentity}};
  }
  return {binding,coherent,playerId};
}
