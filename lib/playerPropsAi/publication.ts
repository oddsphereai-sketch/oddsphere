import type {GamePacket,Quote} from "./evidenceContract";
import type {AcceptedGameReview} from "./reviewer";
import type {PropsAiMemberEvidence} from "./publicationContract";
import {criticalContextHashes} from "./criticalContext";
import {PROPS_AI_RELEASE,PROPS_AI_GRADE_RELEASE} from "./releases";
import {PROPS_AI_SITE_RELEASE} from "./siteConfig";
import {priceAiLaw,type PropsAiGrade} from "./pricing";
import {lawForecast} from "./law";
import {instant} from "./evidence";

export type SiteAiDecision={playerId:string;market:string;line:number;side:Quote["side"];book:string;provider:string;american:number;projection:number;probability:number;over:number;under:number;push:number;expectedValue:number;fairAmerican:number|null;grade:PropsAiGrade;quote:Quote;evidence:PropsAiMemberEvidence};
/** Only complete current-release reviews qualify. Final takes precedence over a later-served early review. */
export function selectSiteReview(packet:GamePacket,reviews:AcceptedGameReview[],now:string){
  const at=instant(now),contexts=criticalContextHashes(packet);
  return reviews.filter(r=>r.release===PROPS_AI_RELEASE&&(r.sourceGameId??r.gameId)===packet.gameId&&instant(r.start)===instant(packet.start)&&instant(r.lock)===instant(packet.lock)&&r.issuedAt&&instant(r.issuedAt)<=at&&instant(r.issuedAt)<instant(packet.lock)&&r.players.length===packet.players.length&&packet.players.every(p=>r.players.some(x=>x.playerId===p.id)&&JSON.stringify(r.marketScopes?.[p.id])===JSON.stringify(p.markets)&&r.criticalContextHashes?.[p.id]===contexts[p.id]))
    .sort((a,b)=>Number(b.stage==="final")-Number(a.stage==="final")||instant(b.issuedAt!)-instant(a.issuedAt!))[0]??null;
}
export function siteAiDecisions(packet:GamePacket,review:AcceptedGameReview,now:string,maxQuoteAgeMs=15*60000):SiteAiDecision[]{
  if(selectSiteReview(packet,[review],now)!==review)return [];
  const result:SiteAiDecision[]=[];
  for(const player of packet.players){
    const reviewed=review.players.find(r=>r.playerId===player.id)!;
    if(!reviewed.law)continue;
    for(const [index,market] of player.markets.entries()){
      // Every exact main/alternate event is priced from the SAME stored outcome law.
      const quotes=packet.quotes.filter(q=>q.playerId===player.id&&q.market===market&&!q.opening&&q.receivedAtProvenance==="provider_response"&&!q.live);
      for(const [book,provider,line,contract] of [...new Map(quotes.map(q=>[`${q.provider}|${q.book}|${q.line}|${q.offerContract??"two_way"}`,[q.book,q.provider,q.line,q.offerContract??"two_way"] as const])).values()]){
        const selected=quotes.filter(q=>q.book===book&&q.provider===provider&&q.line===line&&(q.offerContract??"two_way")===contract);
        const priced=priceAiLaw({law:reviewed.law,market,quotes:selected.map(q=>({id:q.id,book:q.book,provider:q.provider,line:q.line,side:q.side,american:q.american,availableAt:q.receivedAt,confirmedAt:q.receivedAt,current:true,actionRule:"qualifying_participation"})),now,maxAgeMs:maxQuoteAgeMs,confidence:reviewed.confidence[index],exception:reviewed.exceptions[index],milestone:contract==="milestone"||market==="anytime_td"||selected.some(q=>q.side==="yes")});
        if(!priced)continue;
        const quote=selected.find(q=>q.id===priced.quote.id)!;
        const law=lawForecast(reviewed.law,market,line,contract==="milestone"||quote.side==="yes"||market==="anytime_td");
        result.push({playerId:player.id,market,line,side:priced.side as Quote["side"],book,provider,american:quote.american,projection:law.mean,probability:priced.probability,over:law.over,under:law.under,push:law.push,expectedValue:priced.expectedValue,fairAmerican:priced.fairAmerican,grade:priced.grade,quote,
          evidence:{release:review.release,lawRelease:reviewed.law.release,gradeRelease:PROPS_AI_GRADE_RELEASE,publicationRelease:PROPS_AI_SITE_RELEASE,reviewId:`${review.gameId}|${review.stage}|${review.issuedAt}`,lawHash:reviewed.law.hash,inputHash:review.inputHash??review.inputEvidence.digest,reviewedAt:review.issuedAt!,stage:review.stage,model:review.partProvenance.find(p=>p.playerIds.includes(player.id))?.model??review.model,confidence:reviewed.confidence[index] as 0|1|2,confidenceMeaning:"AI-estimated evidence strength; not empirical calibration",quoteConfirmedAt:quote.receivedAt,selectedSide:priced.side as Quote["side"],assessment:reviewed.assessment,coverage:Object.fromEntries(Object.entries(reviewed.coverage).map(([area,value])=>[area,{...value,facts:value.facts.map(f=>({id:f.id,hash:f.hash,label:f.label,availableAt:f.availableAt,sourceIds:f.sourceIds}))}])),exception:reviewed.exceptions[index]}});
      }
    }
  }
  return result;
}
