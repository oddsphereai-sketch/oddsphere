import type {GamePacket,Quote} from "./evidenceContract";

export const quoteBook=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,"");
export const quoteContract=(q:Pick<Quote,"side"|"offerContract">)=>q.offerContract==="milestone"||q.side==="yes"?"milestone":"two_way";
export const executionContractKey=(q:Quote)=>JSON.stringify([q.playerId,q.market,q.provider,quoteBook(q.book),q.line,quoteContract(q)]);
/** A retained change is evidence, not a second executable offer. Keep simultaneous lines. */
export function latestExecutionQuotes(rows:readonly Quote[],now:string,maxAgeMs=15*60000):Quote[]{
  const at=Date.parse(now),latest=new Map<string,Quote>(),ambiguous=new Set<string>();
  for(const q of rows){
    const received=Date.parse(q.receivedAt),observed=Date.parse(q.observedAt);
    if(q.opening!==false||q.live||q.receivedAtProvenance!=="provider_response"||!Number.isFinite(received)||!Number.isFinite(observed)||observed>received||received>at)continue;
    const key=JSON.stringify([q.playerId,q.market,q.provider,quoteBook(q.book),q.line,quoteContract(q),q.side]),old=latest.get(key);
    const rank=old?received-Date.parse(old.receivedAt)||observed-Date.parse(old.observedAt):1;
    if(rank>0){latest.set(key,q);ambiguous.delete(key);}
    else if(rank===0&&old&&old.american!==q.american)ambiguous.add(key);
  }
  return [...latest].flatMap(([key,q])=>!ambiguous.has(key)&&at-Date.parse(q.receivedAt)<=maxAgeMs&&Number.isInteger(q.american)&&Math.abs(q.american)>=100?[q]:[]);
}
/** An explicitly empty collector set must never resurrect archived prices. */
export function executionQuotes(packet:GamePacket,now:string,maxAgeMs=15*60000){
  return latestExecutionQuotes(packet.executionQuotes??packet.quotes,now,maxAgeMs);
}
