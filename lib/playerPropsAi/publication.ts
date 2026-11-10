import {assertSourceEventQualifications,qualifiedForecastMarkets,unresolvedForecastMarkets,sourceEventUsable,PROPS_AI_SOURCE_EVENT_RELEASE} from "./sourceEvents";
import type {GamePacket,Quote} from "./evidenceContract";
import type {AcceptedGameReview} from "./reviewer";
import type {PropsAiMemberEvidence} from "./publicationContract";
import {PROPS_AI_EXECUTION_EVIDENCE_RELEASE} from "./publicationContract";
import {reviewedReaderContextCurrent} from './readerClaimFreshness';
import {PROPS_AI_ACCEPTED_RELEASES,PROPS_AI_GRADE_RELEASE,PROPS_AI_SELECTION_RELEASE,propsReviewHasSemanticChecks} from "./releases";
import {PROPS_AI_SITE_RELEASE} from "./siteConfig";
import {priceAiLaw,type PropsAiGrade} from "./pricing";
import {lawForecast} from "./law";
import {instant} from "./evidence";
import {executionQuotes,latestExecutionQuotes,quoteContract,executionContractKey} from "./executionQuotes";
import {unqualifiedEventTail} from "./forecastSanity";
import {playerParticipationEligibility,qualifiedParticipationException} from "./participationEligibility";

export type SiteAiDecision={playerId:string;market:string;line:number;side:Quote["side"];book:string;provider:string;american:number;projection:number;probability:number;over:number;under:number;push:number;expectedValue:number;fairAmerican:number|null;grade:PropsAiGrade;quote:Quote;evidence:PropsAiMemberEvidence};
function sameReviewGame(packet:GamePacket,review:AcceptedGameReview,now:string){
  assertSourceEventQualifications(packet);
  const at=instant(now);
  return PROPS_AI_ACCEPTED_RELEASES.includes(review.release)&&(review.sourceGameId??review.gameId)===packet.gameId
    &&instant(review.start)===instant(packet.start)&&instant(review.lock)===instant(packet.lock)
    &&Boolean(review.issuedAt)&&instant(review.issuedAt!)<=at&&instant(review.issuedAt!)<instant(packet.lock)&&at<instant(packet.lock);
}
/** Completeness is required at purchase. Publication checks each reviewed actor and scope independently. */
export function siteReviewCoverage(packet:GamePacket,review:AcceptedGameReview|null,now:string){
  const sameGame=Boolean(review&&sameReviewGame(packet,review,now));
  return packet.players.map(player=>{
    const matches=sameGame?review!.players.filter(p=>p.playerId===player.id):[];
    const reviewed=matches.length===1?matches[0]:null,storedScopes=sameGame?review!.marketScopes?.[player.id]:null;
    const scopes=Array.isArray(storedScopes)?storedScopes:[];
    const contextCurrent=Boolean(reviewed&&reviewedReaderContextCurrent(packet,review!,player.id));
    const validIndexes=reviewed&&Array.isArray(storedScopes)&&Array.isArray(reviewed.confidence)&&Array.isArray(reviewed.exceptions)&&new Set(scopes).size===scopes.length
      &&reviewed.confidence.length===scopes.length&&reviewed.exceptions.length===scopes.length;
    const markets=contextCurrent&&validIndexes?player.markets.filter(m=>scopes.includes(m)):[];
    return {playerId:player.id,reviewed:Boolean(reviewed),contextCurrent,markets,
      unreviewedMarkets:player.markets.filter(m=>!scopes.includes(m))};
  });
}
/** A new actor/market cannot erase another actor's valid read. Final still takes precedence. */
export function selectSiteReview(packet:GamePacket,reviews:AcceptedGameReview[],now:string){
  return reviews.filter(r=>sameReviewGame(packet,r,now)&&siteReviewCoverage(packet,r,now).some(p=>p.markets.length>0))
    .sort((a,b)=>Number(b.stage==="final")-Number(a.stage==="final")||instant(b.issuedAt!)-instant(a.issuedAt!))[0]??null;
}
/** Internal qualification accounting; an admitted player is not necessarily a priced event. */
export function siteReviewQualification(packet:GamePacket,review:AcceptedGameReview|null,now:string,maxQuoteAgeMs=15*60000,priced?:SiteAiDecision[]){
  if(packet.sourceOfferSetStatus==='empty')return{unresolvedSourceScopes:0,unresolvedExecutionContracts:0,qualifiedLawPlayers:0,sourceDeclinedScopes:0,participationBlockedScopes:0,unqualifiedTailScopes:0,currentExecutionContracts:0,pricedExecutionContracts:0,unpricedExecutionContracts:0};
  const coverage=siteReviewCoverage(packet,review,now),tails=new Set<string>();let sourceDeclinedScopes=0,qualifiedLawPlayers=0,participationBlockedScopes=0;
  for(const current of coverage){
    const player=review?.players.find(p=>p.playerId===current.playerId);if(!player)continue;
    const declined=player.sourceDeclinedMarkets??(player.law?[]:current.markets);
    const sourcePlayer=packet.players.find(p=>p.id===current.playerId)!;
    if(playerParticipationEligibility(packet,sourcePlayer).blocked)participationBlockedScopes+=current.markets.length;
    sourceDeclinedScopes+=current.markets.filter(m=>declined.includes(m)).length;
    if(!player.law)continue;
    if(current.markets.some(m=>!declined.includes(m)))qualifiedLawPlayers++;
    if(!review||!propsReviewHasSemanticChecks(review.release))continue;
    for(const q of executionQuotes(packet,now,maxQuoteAgeMs)){
      if(q.playerId!==current.playerId||!current.markets.includes(q.market)||declined.includes(q.market)||q.opening||q.live||q.receivedAtProvenance!=="provider_response"||instant(q.receivedAt)>instant(now)||instant(now)-instant(q.receivedAt)>maxQuoteAgeMs)continue;
      const f=lawForecast(player.law,q.market,q.line,q.offerContract==="milestone"||q.side==="yes");
      if(unqualifiedEventTail(f,q.side==="yes"))tails.add(`${q.playerId}|${q.market}|${q.line}|${quoteContract(q)}`);
    }
  }
  const executable=new Set(executionQuotes(packet,now,maxQuoteAgeMs).map(executionContractKey));
  const prices=priced??(review?siteAiDecisions(packet,review,now,maxQuoteAgeMs):[]);
  const pricedContracts=new Set(prices.map(c=>executionContractKey(c.quote)));
  return {unresolvedSourceScopes:packet.players.reduce((n,p)=>n+unresolvedForecastMarkets(p).length,0),unresolvedExecutionContracts:new Set(latestExecutionQuotes(packet.executionQuotes??packet.quotes,now,maxQuoteAgeMs).filter(q=>!sourceEventUsable(q)).map(executionContractKey)).size,qualifiedLawPlayers,sourceDeclinedScopes,participationBlockedScopes,unqualifiedTailScopes:tails.size,currentExecutionContracts:executable.size,pricedExecutionContracts:pricedContracts.size,unpricedExecutionContracts:[...executable].filter(key=>!pricedContracts.has(key)).length};
}
export function siteAiDecisions(packet:GamePacket,review:AcceptedGameReview,now:string,maxQuoteAgeMs=15*60000):SiteAiDecision[]{
  const coverage=siteReviewCoverage(packet,review,now),currentQuotes=executionQuotes(packet,now,maxQuoteAgeMs);
  const result:SiteAiDecision[]=[];
  for(const player of packet.players){
    const eligible=coverage.find(p=>p.playerId===player.id)!;
    const reviewed=review.players.find(r=>r.playerId===player.id);
    if(!reviewed?.law||!eligible.markets.length)continue;
    const sourceEligibility=playerParticipationEligibility(packet,player);
    for(const market of eligible.markets){
      // Confidence and exceptions belong to the immutable reviewed scope order,
      // never the current offering order or a newly added market.
      const index=review.marketScopes[player.id].indexOf(market);
      const exception=qualifiedParticipationException(sourceEligibility,reviewed.exceptions[index]);
      if(!qualifiedForecastMarkets(player).includes(market)||propsReviewHasSemanticChecks(review.release)&&reviewed.sourceDeclinedMarkets?.includes(market))continue;
      // Every exact main/alternate event is priced from the SAME stored outcome law.
      const quotes=currentQuotes.filter(q=>q.playerId===player.id&&q.market===market&&!q.opening&&q.receivedAtProvenance==="provider_response"&&!q.live);
      for(const [book,provider,line,contract] of [...new Map(quotes.map(q=>[`${q.provider}|${q.book}|${q.line}|${quoteContract(q)}`,[q.book,q.provider,q.line,quoteContract(q)] as const])).values()]){
        const selected=quotes.filter(q=>q.book===book&&q.provider===provider&&q.line===line&&(quoteContract(q))===contract);
        const priced=priceAiLaw({law:reviewed.law,market,quotes:selected.map(q=>({id:q.id,book:q.book,provider:q.provider,line:q.line,side:q.side,american:q.american,availableAt:q.receivedAt,confirmedAt:q.receivedAt,current:true,actionRule:"qualifying_participation"})),now,maxAgeMs:maxQuoteAgeMs,confidence:reviewed.confidence[index],exception,milestone:contract==="milestone"||market==="anytime_td"||selected.some(q=>q.side==="yes")});
        if(!priced)continue;
        // A later quote can introduce an event outside the original supported
        // tails. Keep it unqualified; never display a fabricated certainty or
        // regenerate/reinterpret an accepted review or a legacy locked record.
        if(propsReviewHasSemanticChecks(review.release)&&(priced.probability<=0||priced.probability>=1))continue;
        const quote=selected.find(q=>q.id===priced.quote.id)!;
        const law=lawForecast(reviewed.law,market,line,contract==="milestone"||quote.side==="yes"||market==="anytime_td");
        if(propsReviewHasSemanticChecks(review.release)&&unqualifiedEventTail(law,quote.side==="yes"))continue;
        result.push({playerId:player.id,market,line,side:priced.side as Quote["side"],book,provider,american:quote.american,projection:law.mean,probability:priced.probability,over:law.over,under:law.under,push:law.push,expectedValue:priced.expectedValue,fairAmerican:priced.fairAmerican,grade:priced.grade,quote:structuredClone(quote),
          evidence:{sourceEligibility:structuredClone(sourceEligibility),executionEvidence:{release:PROPS_AI_EXECUTION_EVIDENCE_RELEASE,pricedAt:now,operation:"decision",selectedQuote:structuredClone(quote),pricingQuotes:structuredClone(selected)},...(quote.sourceEvent?.status==="verified"?{sourceEventRelease:PROPS_AI_SOURCE_EVENT_RELEASE,sourceEventStatistic:quote.sourceEvent.statistic!}:{}),release:review.release,selectionRelease:PROPS_AI_SELECTION_RELEASE,lawRelease:reviewed.law.release,gradeRelease:PROPS_AI_GRADE_RELEASE,publicationRelease:PROPS_AI_SITE_RELEASE,reviewId:`${review.gameId}|${review.stage}|${review.issuedAt}`,lawHash:reviewed.law.hash,inputHash:review.inputHash??review.inputEvidence.digest,reviewedAt:review.issuedAt!,stage:review.stage,model:review.partProvenance.find(p=>p.playerIds.includes(player.id))?.model??review.model,confidence:reviewed.confidence[index] as 0|1|2,confidenceMeaning:"AI-estimated evidence strength; not empirical calibration",quoteConfirmedAt:quote.receivedAt,selectedSide:priced.side as Quote["side"],assessment:reviewed.assessment,coverage:Object.fromEntries(Object.entries(reviewed.coverage).map(([area,value])=>[area,{...value,facts:value.facts.map(f=>({id:f.id,hash:f.hash,label:f.label,availableAt:f.availableAt,sourceIds:[...f.sourceIds]}))}])),exception}});
      }
    }
  }
  return result;
}
