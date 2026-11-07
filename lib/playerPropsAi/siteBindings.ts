/** Writer adapters. Existing locked rows win before any new semantic is inspected. */
import type {NbaPlayerPropsMemberSnapshot,NbaPlayerPropsMemberDecision} from "../services/nba/nbaPlayerPropsProductContract";
import {buildNbaPlayerPropsMemberSnapshot} from "../services/nba/nbaPlayerPropsProductContract";
import type {NflPlayerPropsRuntimeBoard,NflPlayerPropsRuntimeDecision} from "../services/football/nflPlayerPropsRuntime";
import type {PlayerPropPreviewRow} from "../../app/mlb/props/components/PlayerPropsDashboard";
import {isSignalOptionalMemberFeature} from "../mlb/props/researchEnrichment";
import {assessPropPrice} from "../mlb/props/pricePolicy";
import type {SiteAiDecision} from "./publication";
import {PROPS_AI_ESTIMATE_RELEASE} from "./releases";
import type {GamePacket} from "./evidenceContract";
import {digest,instant} from "./evidence";

const book=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,"");
const choice=(all:SiteAiDecision[],id:string,market:string,line:number,sportsbook:string,provider?:string)=>all.find(c=>c.playerId===id&&c.market===market&&c.line===line&&book(c.book)===book(sportsbook)&&(!provider||c.provider===provider));
function nbaMovement(packet:GamePacket,c:SiteAiDecision):NbaPlayerPropsMemberDecision["movement"]{
  const quotes=packet.quotes.filter(q=>q.playerId===c.playerId&&q.market===c.market&&book(q.book)===book(c.book)&&q.provider===c.provider&&q.side===c.side).sort((a,b)=>instant(a.observedAt)-instant(b.observedAt));
  const opening=quotes.find(q=>q.opening);if(!opening)return null;
  const prior=quotes.filter(q=>!q.opening&&instant(q.observedAt)<instant(c.quote.observedAt)).at(-1);
  return {sportsbook:c.book,openingLine:opening.line,openingPrice:opening.american,priorLine:prior?.line??null,priorPrice:prior?.american??null,currentLine:c.line,currentPrice:c.american};
}
export function applyNbaSiteAi(snapshot:NbaPlayerPropsMemberSnapshot,packet:GamePacket,choices:SiteAiDecision[],now:string):NbaPlayerPropsMemberSnapshot{
  let changed=false;
  const decisions=snapshot.decisions.map((row):NbaPlayerPropsMemberDecision=>{
    if(row.lockedAt!==null||row.gameId!==packet.gameId||instant(now)>=instant(packet.lock))return row;
    const c=choice(choices,row.playerId,row.market,row.line,row.sportsbook);if(!c||c.side==="yes")return row;
    changed=true;
    return {...row,decisionKey:[c.evidence.release,row.gameId,row.playerId,row.market,c.line].join("|"),projection:c.projection,probability:c.probability,side:c.side,grade:c.grade,sportsbook:c.book,americanPrice:c.american,expectedValue:c.expectedValue,
      modelRelease:c.evidence.release,calibrationRelease:PROPS_AI_ESTIMATE_RELEASE,decisionRelease:c.evidence.publicationRelease,targetExcludedProbability:null,targetExcludedBooks:0,targetExcludedReferenceBooks:0,marketEvidenceMode:"ai_joint_law" as const,gradePolicySource:"ai_source_review" as const,evaluatedAt:now,aiReview:c.evidence,
      priceLadder:packet.quotes.filter(q=>q.playerId===c.playerId&&q.market===c.market&&q.side===c.side&&!q.opening&&q.receivedAtProvenance==="provider_response").map(q=>({sportsbook:q.book,side:q.side as "over"|"under",line:q.line,americanPrice:q.american,observedAt:q.observedAt})),movement:nbaMovement(packet,c)};
  });
  for(const player of packet.players)for(const market of player.markets){
    if(decisions.some(r=>r.gameId===packet.gameId&&r.playerId===player.id&&r.market===market))continue;
    const c=choices.filter(c=>c.playerId===player.id&&c.market===market&&c.side!=="yes").sort((a,b)=>b.expectedValue-a.expectedValue)[0];
    const game=snapshot.games.find(g=>g.gameId===packet.gameId);if(!c||!game||instant(now)>=instant(packet.lock))continue;
    decisions.push({decisionKey:[c.evidence.release,game.gameId,player.id,market,c.line].join("|"),gameId:game.gameId,scheduledStart:game.scheduledStart,homeTeam:game.homeTeam,awayTeam:game.awayTeam,
      playerId:player.id,playerName:player.name,team:player.team,opponent:player.opponent,market:market as NbaPlayerPropsMemberDecision["market"],line:c.line,projection:c.projection,independentProjection:null,independentProbability:null,
      modelRelease:c.evidence.release,calibrationRelease:PROPS_AI_ESTIMATE_RELEASE,decisionRelease:c.evidence.publicationRelease,aiReview:c.evidence,side:c.side as "over"|"under",probability:c.probability,grade:c.grade,sportsbook:c.book,americanPrice:c.american,expectedValue:c.expectedValue,
      targetExcludedProbability:null,targetExcludedBooks:0,targetExcludedReferenceBooks:0,marketEvidenceMode:"ai_joint_law",gradePolicySource:"ai_source_review",role:[],production:[],matchup:[],priceLadder:[],movement:nbaMovement(packet,c),evaluatedAt:now,lockedAt:null});changed=true;
  }
  return changed?buildNbaPlayerPropsMemberSnapshot({...snapshot,generatedAt:now,decisions,inputRows:snapshot.diagnostics.inputRows}):snapshot;
}
export function applyNflSiteAi(board:NflPlayerPropsRuntimeBoard,packet:GamePacket,choices:SiteAiDecision[],now:string):NflPlayerPropsRuntimeBoard{
  let changed=false;
  const decisions=board.decisions.map((row):NflPlayerPropsRuntimeDecision=>{
    if(row.state==="locked"||row.gameId!==packet.gameId||instant(now)>=instant(row.lockAt))return row;
    const id=`nfl-bdl-player:${row.providerPlayerId}`,c=choice(choices,id,row.market,row.line,row.sportsbook,row.provider);if(!c)return row;
    const probability=row.side==="under"?c.under:c.over,loss=row.side==="under"?c.over:c.under;
    const ev=probability*(row.americanPrice>0?row.americanPrice/100:100/-row.americanPrice)-loss;
    changed=true;
    const next={...row,projection:c.projection,projectionRange:null,rawModelProbability:probability,finalProbability:probability,expectedValue:ev,probabilityEdge:probability-row.marketProbability,grade:c.grade==="No Play"?"No Play" as const:row.side===c.side?c.grade:"Watchlist" as const,
      modelRelease:c.evidence.release,calibrationRelease:PROPS_AI_ESTIMATE_RELEASE,decisionRelease:c.evidence.publicationRelease,aiReview:c.evidence};
    // These predecessor explanations describe a different forecast. Raw market evidence remains intact.
    delete next.projectionEvidence;delete next.decisionSupport;delete next.passingMarketEvidence;
    return next;
  });
  // Additional offered heads (including passing TDs and interceptions) use the same accepted law.
  // No independent head is fabricated: inherited context is role-only, market summaries are cleared.
  for(const c of choices){
    const player=packet.players.find(p=>p.id===c.playerId)!;
    const providerPlayerId=c.playerId.replace(/^nfl-bdl-player:/,"");
    const template=board.decisions.find(r=>r.gameId===packet.gameId&&r.providerPlayerId===providerPlayerId&&r.state!=="locked");
    if(instant(now)>=instant(packet.lock))continue;
    const context: NflPlayerPropsRuntimeDecision["forecastContext"]=template?{...template.forecastContext,recentProduction:null,opponentAllowance:null,modelInputTrends:[]}:{featureAsOf:packet.cutoff,position:null,expectedQuarterback:null,availability:{listed:false,status:null,detail:"No independent player availability estimate supplied",reportedAt:null,reportUpdatedAt:null,source:"unavailable"},teamImpliedPoints:null,teamImpliedTouchdowns:null,recentProduction:null,roleOpportunity:[],opponentAllowance:null};
    for(const q of packet.quotes.filter(q=>q.playerId===c.playerId&&q.market===c.market&&q.line===c.line&&book(q.book)===book(c.book)&&q.provider===c.provider&&!q.opening&&q.receivedAtProvenance==="provider_response")){
      if(decisions.some(r=>r.gameId===packet.gameId&&r.providerPlayerId===providerPlayerId&&r.market===q.market&&r.line===q.line&&r.side===q.side&&book(r.sportsbook)===book(q.book)&&r.provider===q.provider))continue;
      const probability=q.side==="under"?c.under:c.over,loss=q.side==="under"?c.over:c.under;
      const marketProbability=q.american>0?100/(100+q.american):-q.american/(100-q.american);
      const next:NflPlayerPropsRuntimeDecision={...template,gameId:packet.gameId,providerPlayerId,scheduledStart:packet.start,lockAt:packet.lock,state:"unlocked",roleFingerprint:template?.roleFingerprint??digest({player:c.playerId,context:packet.cutoff}),participationProbability:template?.participationProbability??null,provisional:false,market:q.market as NflPlayerPropsRuntimeDecision["market"],line:q.line,side:q.side,sportsbook:q.book,provider:q.provider,americanPrice:q.american,observedAt:q.observedAt,
        playerName:player.name,team:player.team,opponent:player.opponent,projection:c.projection,projectionRange:null,rawModelProbability:probability,finalProbability:probability,marketProbability,probabilityEdge:probability-marketProbability,
        expectedValue:probability*(q.american>0?q.american/100:100/-q.american)-loss,grade:!template||c.grade==="No Play"?"No Play":q.side===c.side?c.grade:"Watchlist",marketMovement:"neutral",healthHolds:[],
        bookEvidence:[{sportsbook:q.book,provider:q.provider,americanPrice:q.american,observedAt:q.observedAt,openingObservedAt:null,openingLine:null,openingAmericanPrice:null}],
        forecastContext:context,modelRelease:c.evidence.release,calibrationRelease:PROPS_AI_ESTIMATE_RELEASE,decisionRelease:c.evidence.publicationRelease,aiReview:c.evidence};
      delete next.projectionEvidence;delete next.decisionSupport;delete next.passingMarketEvidence;delete next.qualifiedReferenceEvidence;delete next.marketEvidenceId;
      decisions.push(next);changed=true;
    }
  }
  if(!changed)return board;
  const counts={"Best Angle":0,Lean:0,Watchlist:0,"No Play":0,Held:0,actionable:0};
  for(const r of decisions){counts[r.grade]++;if(r.grade==="Best Angle"||r.grade==="Lean")counts.actionable++;}
  return {...board,decisions,counts};
}
export function applyMlbSiteAi(rows:PlayerPropPreviewRow[],packet:GamePacket,choices:SiteAiDecision[],now:string):PlayerPropPreviewRow[]{
  let changed=false;
  const next=rows.map(row=>{
    if(row.lockStatus?.status==="locked"||row.providerIds?.gameId!==packet.gameId||instant(now)>=instant(packet.lock))return row;
    const id=row.providerIds.mlbStatsPlayerId??`bdl:${row.providerIds.bdlPlayerId}`;
    const c=choices.find(c=>c.playerId===id&&c.market===row.market&&c.line===row.line&&book(c.book)===book(row.book)&&(c.quote.offerContract??"two_way")===(row.offerContract??"two_way"));
    if(!c)return row;
    const q=packet.quotes.filter(q=>q.playerId===id&&q.market===c.market&&q.line===c.line&&book(q.book)===book(c.book)&&q.provider===c.provider&&(q.offerContract??"two_way")===(row.offerContract??"two_way")&&(q.side==="yes"?"over":q.side)===row.side&&!q.opening&&q.receivedAtProvenance==="provider_response"&&instant(q.receivedAt)<=instant(now)&&instant(now)-instant(q.receivedAt)<=15*60000).sort((a,b)=>instant(b.receivedAt)-instant(a.receivedAt))[0];
    if(!q)return row;
    const favored=c.side==="yes"?"over":c.side;
    const probability=row.side==="over"?c.over:c.under,loss=row.side==="over"?c.under:c.over;
    const implied=(american:number)=>american>0?100/(100+american):-american/(100-american);
    const opposing=packet.quotes.filter(o=>o.playerId===id&&o.market===c.market&&o.line===c.line&&book(o.book)===book(c.book)&&o.provider===c.provider&&(o.offerContract??"two_way")===(row.offerContract??"two_way")&&o.side!==q.side&&!o.opening&&o.receivedAtProvenance==="provider_response"&&instant(o.receivedAt)<=instant(now)&&instant(now)-instant(o.receivedAt)<=15*60000).sort((a,b)=>instant(b.receivedAt)-instant(a.receivedAt))[0];
    const marketProbability=opposing?implied(q.american)/(implied(q.american)+implied(opposing.american)):null;
    let grade:PlayerPropPreviewRow["playGrade"]=c.grade==="No Play"?"NO_PLAY":row.side!==favored?"WATCHLIST":({"Best Angle":"BEST_ANGLE",Lean:"LEAN",Watchlist:"WATCHLIST"} as const)[c.grade];
    if(row.missingFeatures.some(f=>!isSignalOptionalMemberFeature(f)))grade="PENDING_DATA";
    if((grade==="BEST_ANGLE"||grade==="LEAN")&&(row.oddsSanity.length||!assessPropPrice(q.american).signalEligible))grade="WATCHLIST";
    changed=true;
    return {...row,id:digest({preceding:row.id,release:c.evidence.release,market:row.market,line:c.line,book:c.book,side:row.side}),projection:c.projection,projectionSource:"model" as const,
      modelProbability:probability,finalProbability:probability,overProbability:c.over,underProbability:c.under,expectedValue:probability*(q.american>0?q.american/100:100/-q.american)-loss,
      fairOdds:probability>0&&loss>0?probability>=loss?-100*probability/loss:100*loss/probability:null,marketProbability,shrinkageWeight:0,modelEdge:marketProbability===null?null:probability-marketProbability,
      odds:q.american,book:q.book,playGrade:grade,units:grade==="BEST_ANGLE"||grade==="LEAN"?row.units:0,
      confidence:probability,confidenceBucket:c.evidence.confidence===2?"high" as const:c.evidence.confidence===1?"medium" as const:"low" as const,
      source:"AI source review; conditional estimated outcome law",lastUpdated:q.observedAt,aiReview:c.evidence};
  });
  return changed?next:rows;
}
