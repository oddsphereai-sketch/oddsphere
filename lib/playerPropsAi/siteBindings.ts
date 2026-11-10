/** Writer adapters. Existing locked rows win before any new semantic is inspected. */
import type {NbaPlayerPropsMemberSnapshot,NbaPlayerPropsMemberDecision} from "../services/nba/nbaPlayerPropsProductContract";
import {buildNbaPlayerPropsMemberSnapshot} from "../services/nba/nbaPlayerPropsProductContract";
import type {NflPlayerPropsRuntimeBoard,NflPlayerPropsRuntimeDecision} from "../services/football/nflPlayerPropsRuntime";
import type {PlayerPropPreviewRow} from "../../app/mlb/props/components/PlayerPropsDashboard";
import {isSignalOptionalMemberFeature} from "../mlb/props/researchEnrichment";
import {assessPropPrice} from "../mlb/props/pricePolicy";
import type {SiteAiDecision} from "./publication";
import {executionQuotes,quoteContract} from "./executionQuotes";
import {gradeAiEvent} from "./pricing";
import {MLB_PROPS_STANDARD_STAKE_UNITS} from "../mlb/props/actionabilityPolicy";
import {nflAiSourceBinding} from "./nflSourceBinding";
import {PROPS_AI_ESTIMATE_RELEASE,PROPS_AI_NFL_DECISION_RELEASE} from "./releases";
import type {GamePacket} from "./evidenceContract";
import {digest,instant} from "./evidence";
import {PROPS_AI_EXECUTION_EVIDENCE_RELEASE,type PropsAiMemberEvidence} from "./publicationContract";

const book=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,"");
const choice=(all:SiteAiDecision[],id:string,market:string,line:number,sportsbook:string,provider?:string)=>all.find(c=>c.side!=="yes"&&quoteContract(c.quote)==="two_way"&&c.playerId===id&&c.market===market&&c.line===line&&book(c.book)===book(sportsbook)&&(!provider||c.provider===provider));
/** Row repricing can use a later execution quote than the original decision.
 * Retain exactly that row and current contract group without changing pricing. */
function memberExecutionEvidence(packet:GamePacket,c:SiteAiDecision,q:GamePacket['quotes'][number],now:string):PropsAiMemberEvidence{
 const group=executionQuotes(packet,now).filter(o=>o.playerId===q.playerId&&o.market===q.market&&o.line===q.line&&book(o.book)===book(q.book)&&o.provider===q.provider&&quoteContract(o)===quoteContract(q));
 return {...c.evidence,quoteConfirmedAt:q.receivedAt,executionEvidence:{release:PROPS_AI_EXECUTION_EVIDENCE_RELEASE,operation:'member_row',pricedAt:now,selectedQuote:structuredClone(q),pricingQuotes:structuredClone(group)}};
}
function currentGrade(packet:GamePacket,c:SiteAiDecision,q:GamePacket["quotes"][number],now:string){
  if(c.evidence.exception)return "No Play" as const;
  if(q.side!==c.side)return "Watchlist" as const;
  const opposite=executionQuotes(packet,now).find(o=>o.playerId===q.playerId&&o.market===q.market&&o.line===q.line&&book(o.book)===book(q.book)&&o.provider===q.provider&&quoteContract(o)===quoteContract(q)&&o.side!==q.side&&o.side!=="yes"&&Math.abs(instant(o.receivedAt)-instant(q.receivedAt))<=5*60000);
  return gradeAiEvent({win:q.side==="under"?c.under:c.over,loss:q.side==="under"?c.over:c.under,american:q.american,opposingAmerican:opposite?.american??null,confidence:c.evidence.confidence,exception:c.evidence.exception}).grade;
}
function nbaMovement(packet:GamePacket,c:SiteAiDecision):NbaPlayerPropsMemberDecision["movement"]{
  const quotes=packet.quotes.filter(q=>q.playerId===c.playerId&&q.market===c.market&&book(q.book)===book(c.book)&&q.provider===c.provider&&q.side===c.side).sort((a,b)=>instant(a.observedAt)-instant(b.observedAt));
  const opening=quotes.find(q=>q.opening);if(!opening)return null;
  const prior=quotes.filter(q=>!q.opening&&instant(q.observedAt)<instant(c.quote.observedAt)).at(-1);
  return {sportsbook:c.book,openingLine:opening.line,openingPrice:opening.american,priorLine:prior?.line??null,priorPrice:prior?.american??null,currentLine:c.line,currentPrice:c.american};
}
function nbaAiPrices(packet:GamePacket,c:SiteAiDecision,now:string):NbaPlayerPropsMemberDecision["priceLadder"]{
  const latest=new Map<string,GamePacket["quotes"][number]>();
  for(const q of executionQuotes(packet,now)){
    if(q.playerId!==c.playerId||q.market!==c.market||q.opening||q.live||q.side==="yes"||q.receivedAtProvenance!=="provider_response"||instant(q.receivedAt)>instant(now)||instant(now)-instant(q.receivedAt)>15*60000)continue;
    const key=`${book(q.book)}|${q.line}|${q.side}`,prior=latest.get(key);
    if(!prior||instant(q.receivedAt)>instant(prior.receivedAt))latest.set(key,q);
  }
  // Match the native member-price contract: the evaluated provider owns its
  // exact book/line/side slot even when a second feed reports that same book.
  const exact=executionQuotes(packet,now).find(q=>q.id===c.quote.id);
  if(exact&&exact.side!=="yes"&&quoteContract(exact)==="two_way")latest.set(`${book(exact.book)}|${exact.line}|${exact.side}`,exact);
  return [...latest.values()].map(q=>({sportsbook:q.book,side:q.side as "over"|"under",line:q.line,americanPrice:q.american,observedAt:q.observedAt}));
}
export function applyNbaSiteAi(snapshot:NbaPlayerPropsMemberSnapshot,packet:GamePacket,choices:SiteAiDecision[],now:string):NbaPlayerPropsMemberSnapshot{
  let changed=false;
  // A qualified current event can replace the native model's preselection when
  // that exact old book/line is unavailable to the accepted AI law. Never let
  // an unqualified native event suppress another genuinely priceable AI scope.
  const current=executionQuotes(packet,now);
  const available=choices.filter(c=>c.side!=="yes"&&quoteContract(c.quote)==="two_way"&&current.some(q=>q.id===c.quote.id&&digest(q)===digest(c.quote)));
  const preferred=(id:string,market:string)=>available.filter(c=>c.playerId===id&&c.market===market).sort((a,b)=>b.expectedValue-a.expectedValue||book(a.book).localeCompare(book(b.book))||a.provider.localeCompare(b.provider)||a.line-b.line||a.side.localeCompare(b.side)||a.quote.id.localeCompare(b.quote.id))[0];
  const decisions=snapshot.decisions.map((row):NbaPlayerPropsMemberDecision=>{
    if(row.lockedAt!==null||row.gameId!==packet.gameId||instant(now)>=instant(packet.lock))return row;
    const c=choice(available,row.playerId,row.market,row.line,row.sportsbook)??preferred(row.playerId,row.market);if(!c||c.side==="yes")return row;
    changed=true;
    return {...row,decisionKey:[c.evidence.release,row.gameId,row.playerId,row.market,c.line].join("|"),line:c.line,projection:c.projection,probability:c.probability,side:c.side,grade:c.grade,sportsbook:c.book,americanPrice:c.american,expectedValue:c.expectedValue,
      ...(c.line!==row.line?{independentProbability:null,independentSide:undefined}:{}),
      modelRelease:c.evidence.release,calibrationRelease:PROPS_AI_ESTIMATE_RELEASE,decisionRelease:c.evidence.selectionRelease??c.evidence.publicationRelease,targetExcludedProbability:null,targetExcludedBooks:0,targetExcludedReferenceBooks:0,marketEvidenceMode:"ai_joint_law" as const,gradePolicySource:"ai_source_review" as const,evaluatedAt:now,aiReview:structuredClone(c.evidence),
      priceLadder:nbaAiPrices(packet,c,now),movement:nbaMovement(packet,c)};
  });
  for(const player of packet.players)for(const market of player.markets){
    if(decisions.some(r=>r.gameId===packet.gameId&&r.playerId===player.id&&r.market===market))continue;
    const c=preferred(player.id,market);
    const game=snapshot.games.find(g=>g.gameId===packet.gameId);if(!c||!game||instant(now)>=instant(packet.lock))continue;
    decisions.push({decisionKey:[c.evidence.release,game.gameId,player.id,market,c.line].join("|"),gameId:game.gameId,scheduledStart:game.scheduledStart,homeTeam:game.homeTeam,awayTeam:game.awayTeam,
      playerId:player.id,playerName:player.name,team:player.team,opponent:player.opponent,market:market as NbaPlayerPropsMemberDecision["market"],line:c.line,projection:c.projection,independentProjection:null,independentProbability:null,
      modelRelease:c.evidence.release,calibrationRelease:PROPS_AI_ESTIMATE_RELEASE,decisionRelease:c.evidence.selectionRelease??c.evidence.publicationRelease,aiReview:structuredClone(c.evidence),side:c.side as "over"|"under",probability:c.probability,grade:c.grade,sportsbook:c.book,americanPrice:c.american,expectedValue:c.expectedValue,
      targetExcludedProbability:null,targetExcludedBooks:0,targetExcludedReferenceBooks:0,marketEvidenceMode:"ai_joint_law",gradePolicySource:"ai_source_review",role:[],production:[],matchup:[],priceLadder:nbaAiPrices(packet,c,now),movement:nbaMovement(packet,c),evaluatedAt:now,lockedAt:null});changed=true;
  }
  return changed?buildNbaPlayerPropsMemberSnapshot({...snapshot,generatedAt:now,decisions,inputRows:snapshot.diagnostics.inputRows}):snapshot;
}
/** Reconstruct only this invocation's actual native baseline before applying a
 * newly observed review/context. Stored locks retain their exact payloads. */
export function restoreNbaNativeGame(snapshot:NbaPlayerPropsMemberSnapshot,baseline:NbaPlayerPropsMemberSnapshot,packet:GamePacket,now:string):NbaPlayerPropsMemberSnapshot{
  const gameId=packet.sourceGameId??packet.gameId,scope=(r:NbaPlayerPropsMemberDecision)=>JSON.stringify([r.gameId,r.playerId,r.market]);
  const protectedScopes=new Set(snapshot.decisions.filter(r=>r.lockedAt!==null).map(scope));
  const decisions=[...snapshot.decisions.filter(r=>r.gameId!==gameId||r.lockedAt!==null),...baseline.decisions.filter(r=>r.gameId===gameId&&r.lockedAt===null&&!protectedScopes.has(scope(r)))];
  return buildNbaPlayerPropsMemberSnapshot({...snapshot,generatedAt:now,decisions,inputRows:snapshot.diagnostics.inputRows});
}
/** Reapply a game only from its actual fresh native construction. A local
 * accepted review can prepare its overlay before a later database read, while
 * a changed/declined final observation can restore the same native baseline. */
export function restoreNflNativeGame(board:NflPlayerPropsRuntimeBoard,baseline:NflPlayerPropsRuntimeBoard,packet:GamePacket,now:string):NflPlayerPropsRuntimeBoard{
 const gameId=packet.sourceGameId??packet.gameId;
 const rows=[...board.decisions.filter(r=>r.gameId!==gameId||r.state==="locked"),...baseline.decisions.filter(r=>r.gameId===gameId&&r.state!=="locked")];
 const coherent=nflAiSourceBinding(packet,[],now).coherent(rows),counts={"Best Angle":0,Lean:0,Watchlist:0,"No Play":0,Held:0,actionable:0};
 for(const r of coherent.decisions){counts[r.grade]++;if(r.grade==="Best Angle"||r.grade==="Lean")counts.actionable++;}
 return{...board,decisions:coherent.decisions,counts,aiSourceCoherence:coherent.report};
}
export function applyNflSiteAi(board:NflPlayerPropsRuntimeBoard,packet:GamePacket,choices:SiteAiDecision[],now:string):NflPlayerPropsRuntimeBoard{
  let changed=false;const source=nflAiSourceBinding(packet,choices,now);
  const decisions=board.decisions.map((row):NflPlayerPropsRuntimeDecision=>{
    if(row.state==="locked"||row.gameId!==packet.gameId||instant(now)>=instant(row.lockAt))return row;
    const bound=source.binding(row);if(!bound)return row;const {choice:c,quote:q}=bound;
    const probability=row.side==="under"?c.under:c.over,loss=row.side==="under"?c.over:c.under;
    const ev=probability*(q.american>0?q.american/100:100/-q.american)-loss;
    const marketProbability=q.american>0?100/(100+q.american):-q.american/(100-q.american);
    changed=true;
    const next={...row,providerPlayerId:bound.id.replace(/^nfl-bdl-player:/,""),americanPrice:q.american,observedAt:q.observedAt,projection:c.projection,projectionRange:null,rawModelProbability:probability,finalProbability:probability,expectedValue:ev,marketProbability,probabilityEdge:probability-marketProbability,bookEvidence:row.bookEvidence.map(b=>book(b.sportsbook)===book(q.book)&&b.provider===q.provider?{...b,americanPrice:q.american,observedAt:q.observedAt}:b),grade:currentGrade(packet,c,q,now),
      modelRelease:c.evidence.release,calibrationRelease:PROPS_AI_ESTIMATE_RELEASE,decisionRelease:PROPS_AI_NFL_DECISION_RELEASE,aiReview:memberExecutionEvidence(packet,c,q,now)};
    // These predecessor explanations describe a different forecast. Raw market evidence remains intact.
    delete next.projectionEvidence;delete next.decisionSupport;delete next.passingMarketEvidence;delete next.qualifiedReferenceEvidence;delete next.marketEvidenceId;
    return next;
  });
  // Additional offered heads (including passing TDs and interceptions) use the same accepted law.
  // No independent head is fabricated: inherited context is role-only, market summaries are cleared.
  for(const c of choices){
    const player=packet.players.find(p=>p.id===c.playerId)!;
    const providerPlayerId=c.playerId.replace(/^nfl-bdl-player:/,"");
    const template=board.decisions.find(r=>r.gameId===packet.gameId&&source.playerId(r)===c.playerId&&r.state!=="locked");
    if(instant(now)>=instant(packet.lock))continue;
    const context: NflPlayerPropsRuntimeDecision["forecastContext"]=template?{...template.forecastContext,recentProduction:null,opponentAllowance:null,modelInputTrends:[]}:{featureAsOf:packet.cutoff,position:null,expectedQuarterback:null,availability:{listed:false,status:null,detail:"No independent player availability estimate supplied",reportedAt:null,reportUpdatedAt:null,source:"unavailable"},teamImpliedPoints:null,teamImpliedTouchdowns:null,recentProduction:null,roleOpportunity:[],opponentAllowance:null};
    for(const q of executionQuotes(packet,now).filter(q=>q.playerId===c.playerId&&q.market===c.market&&q.line===c.line&&book(q.book)===book(c.book)&&q.provider===c.provider&&(q.side==="yes"||q.offerContract==="milestone")===(c.quote.side==="yes"||c.quote.offerContract==="milestone")&&quoteContract(q)===quoteContract(c.quote)&&!q.opening&&!q.live&&q.receivedAtProvenance==="provider_response"&&instant(q.observedAt)<=instant(q.receivedAt)&&instant(q.receivedAt)<=instant(now)&&instant(now)-instant(q.receivedAt)<=15*60000)){
      if(decisions.some(r=>r.gameId===packet.gameId&&(r.providerPlayerId===providerPlayerId||source.binding(r)?.id===c.playerId)&&r.market===q.market&&r.line===q.line&&r.side===q.side&&book(r.sportsbook)===book(q.book)&&r.provider===q.provider))continue;
      const probability=q.side==="under"?c.under:c.over,loss=q.side==="under"?c.over:c.under;
      const marketProbability=q.american>0?100/(100+q.american):-q.american/(100-q.american);
      const next:NflPlayerPropsRuntimeDecision={...template,gameId:packet.gameId,providerPlayerId,scheduledStart:packet.start,lockAt:packet.lock,state:"unlocked",roleFingerprint:template?.roleFingerprint??digest({player:c.playerId,context:packet.cutoff}),participationProbability:template?.participationProbability??null,provisional:false,market:q.market as NflPlayerPropsRuntimeDecision["market"],line:q.line,side:q.side,sportsbook:q.book,provider:q.provider,americanPrice:q.american,observedAt:q.observedAt,
        playerName:player.name,team:player.team,opponent:player.opponent,projection:c.projection,projectionRange:null,rawModelProbability:probability,finalProbability:probability,marketProbability,probabilityEdge:probability-marketProbability,
        expectedValue:probability*(q.american>0?q.american/100:100/-q.american)-loss,grade:!template?"No Play":currentGrade(packet,c,q,now),marketMovement:"neutral",healthHolds:[],
        bookEvidence:[{sportsbook:q.book,provider:q.provider,americanPrice:q.american,observedAt:q.observedAt,openingObservedAt:null,openingLine:null,openingAmericanPrice:null}],
        forecastContext:context,modelRelease:c.evidence.release,calibrationRelease:PROPS_AI_ESTIMATE_RELEASE,decisionRelease:PROPS_AI_NFL_DECISION_RELEASE,aiReview:memberExecutionEvidence(packet,c,q,now)};
      delete next.projectionEvidence;delete next.decisionSupport;delete next.passingMarketEvidence;delete next.qualifiedReferenceEvidence;delete next.marketEvidenceId;
      decisions.push(next);changed=true;
    }
  }
  if(!changed)return board;
  const coherent=source.coherent(decisions);
  const counts={"Best Angle":0,Lean:0,Watchlist:0,"No Play":0,Held:0,actionable:0};
  for(const r of coherent.decisions){counts[r.grade]++;if(r.grade==="Best Angle"||r.grade==="Lean")counts.actionable++;}
  return {...board,decisions:coherent.decisions,counts,aiSourceCoherence:coherent.report};
}
export function applyMlbSiteAi(rows:PlayerPropPreviewRow[],packet:GamePacket,choices:SiteAiDecision[],now:string):PlayerPropPreviewRow[]{
  let changed=false;
  const next=rows.map(row=>{
    if(row.lockStatus?.status==="locked"||row.providerIds?.gameId!==packet.gameId||instant(now)>=instant(packet.lock))return row;
    const id=row.providerIds.mlbStatsPlayerId??`bdl:${row.providerIds.bdlPlayerId}`;
    const c=choices.find(c=>c.playerId===id&&c.market===row.market&&c.line===row.line&&book(c.book)===book(row.book)&&quoteContract(c.quote)===(row.offerContract??"two_way"));
    if(!c)return row;
    const q=executionQuotes(packet,now).filter(q=>q.playerId===id&&q.market===c.market&&q.line===c.line&&book(q.book)===book(c.book)&&q.provider===c.provider&&quoteContract(q)===(row.offerContract??"two_way")&&(q.side==="yes"?"over":q.side)===row.side&&!q.opening&&q.receivedAtProvenance==="provider_response"&&instant(q.observedAt)<=instant(q.receivedAt)&&instant(q.receivedAt)<=instant(now)&&instant(now)-instant(q.receivedAt)<=15*60000).sort((a,b)=>instant(b.receivedAt)-instant(a.receivedAt))[0];
    if(!q)return row;
    const favored=c.side==="yes"?"over":c.side;
    const probability=row.side==="over"?c.over:c.under,loss=row.side==="over"?c.under:c.over;
    const implied=(american:number)=>american>0?100/(100+american):-american/(100-american);
    const opposing=executionQuotes(packet,now).filter(o=>o.playerId===id&&o.market===c.market&&o.line===c.line&&book(o.book)===book(c.book)&&o.provider===c.provider&&quoteContract(o)===(row.offerContract??"two_way")&&o.side!==q.side&&!o.opening&&o.receivedAtProvenance==="provider_response"&&instant(o.receivedAt)<=instant(now)&&instant(now)-instant(o.receivedAt)<=15*60000).sort((a,b)=>instant(b.receivedAt)-instant(a.receivedAt))[0];
    const marketProbability=opposing?implied(q.american)/(implied(q.american)+implied(opposing.american)):null;
    const exactGrade=currentGrade(packet,c,q,now);
    let grade:PlayerPropPreviewRow["playGrade"]=exactGrade==="No Play"?"NO_PLAY":row.side!==favored?"WATCHLIST":({"Best Angle":"BEST_ANGLE",Lean:"LEAN",Watchlist:"WATCHLIST"} as const)[exactGrade as "Best Angle"|"Lean"|"Watchlist"];
    if(row.missingFeatures.some(f=>!isSignalOptionalMemberFeature(f)))grade="PENDING_DATA";
    if((grade==="BEST_ANGLE"||grade==="LEAN")&&(row.oddsSanity.length||!assessPropPrice(q.american).signalEligible))grade="WATCHLIST";
    changed=true;
    return {...row,id:digest({preceding:row.id,release:c.evidence.release,market:row.market,line:c.line,book:c.book,side:row.side}),projection:c.projection,projectionSource:"model" as const,
      modelProbability:probability,finalProbability:probability,overProbability:c.over,underProbability:c.under,expectedValue:probability*(q.american>0?q.american/100:100/-q.american)-loss,
      fairOdds:probability>0&&loss>0?probability>=loss?-100*probability/loss:100*loss/probability:null,marketProbability,shrinkageWeight:0,modelEdge:marketProbability===null?null:probability-marketProbability,
      odds:q.american,book:q.book,playGrade:grade,units:grade==="BEST_ANGLE"||grade==="LEAN"?MLB_PROPS_STANDARD_STAKE_UNITS:0,
      confidence:probability,confidenceBucket:c.evidence.confidence===2?"high" as const:c.evidence.confidence===1?"medium" as const:"low" as const,
      source:"AI source review; conditional estimated outcome law",lastUpdated:q.observedAt,aiReview:memberExecutionEvidence(packet,c,q,now)};
  });
  return changed?next:rows;
}
