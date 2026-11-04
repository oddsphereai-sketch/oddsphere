import {nflMarketQualificationMatches,nflPairedReferenceBooksAt,nflMarketSourceAt,nflSportsbookFamily} from './nflMarketQualification';
import {selectNflNamedMoneylineEpisodeAfterKnowledge} from './nflMoneylineEpisodeTransport';
import {nflPublishedSourcePressure} from './nflOwlsSplits';
import {NFL_V1_BEST_ANGLE_MINIMUM_MODELED_WIN_PROBABILITY,NFL_V1_GRADE_MAXIMUM_AMERICAN_PRICE} from './nflV1ProductionDecision';
import {NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_AMERICAN_PRICE,NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_EXPECTED_VALUE} from './nflV1ActionableGradeCandidate';
import type {NflRegularEvaluatedBetDecision} from './nflRegularDecisionEvidence';
import type {NflMarketInnovationReceipt} from './nflMarketInnovationRuntime';
import type {NflMarketGradePromotionContext} from './nflMarketGradeConfirmation';

export type NflUnchangedMoneylineProof = {
 book:string; sourceEventId:string; firstPrice:number; secondPrice:number;
 baselineObservedAt:string; baselineAvailableAt:string; pressureObservedAt:string; pressureAvailableAt:string;
 responseObservedAt:string; responseAvailableAt:string; sourceFairProbability:number; sourceTargetExpectedValue:number;
};

/** A held professional quote can confirm an unchanged law only after actual
 * opposite own-book pressure. Static favorites, public aggregates and missing
 * response clocks have no authority. This is grade evidence, never score input. */
export function assessNflUnchangedMoneylineConfirmation(args:{decision:NflRegularEvaluatedBetDecision;
 innovation:NflMarketInnovationReceipt;context:NflMarketGradePromotionContext;direction:-1|1;
 convictionRiskSources:string[]}){
 const {decision:d,innovation:r,context:c,direction}=args;
 if(d.market!=='moneyline'||d.grade!=='Lean'||args.convictionRiskSources.length||!c.sourceHistory?.length)return null;
 const qualification=c.marketQualification.moneyline;
 const matches=(forecast:typeof c.finalForecast)=>nflMarketQualificationMatches({receipt:qualification,market:'moneyline',
  providerGameId:d.providerGameId,evaluatedAt:d.evaluatedAt,gameStartsAt:d.gameStartsAt,forecast});
 // The same fingerprint must bind BOTH complete laws: no altered probabilities,
 // marginal distributions, tie mass or score can be smuggled in as confirmation.
 if(!matches(c.finalForecast)||!matches(c.independentForecast)||r.readStatus==='unidentified'||
  r.marketQualificationStatus?.moneyline?.status==='unavailable'||
  ['opposed_named_economic_episodes','joint_score_constraints_unidentifiable'].includes(r.reasons.moneyline))return null;
 const probability=direction===1?c.finalForecast.homeWinProbability:c.finalForecast.awayWinProbability;
 const price=d.evaluatedQuote.price,profit=price>0?price/100:100/-price;
 const ev=probability*profit-(1-probability),at=Date.parse(d.evaluatedAt);
 if(d.evaluatedQuote.line!==null||probability<NFL_V1_BEST_ANGLE_MINIMUM_MODELED_WIN_PROBABILITY||
  price<NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_AMERICAN_PRICE||price>NFL_V1_GRADE_MAXIMUM_AMERICAN_PRICE||
  ev<NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_EXPECTED_VALUE||Math.abs(probability-d.modelProbability)>1e-8||
  Math.abs(ev-d.expectedValue)>1e-8||d.pushProbability!==undefined&&d.pushProbability!==null&&Math.abs(d.pushProbability)>1e-12)return null;
 const targetFamily=nflSportsbookFamily(d.evaluatedQuote.sportsbook);
 const paired=(books:typeof c.books)=>nflPairedReferenceBooksAt({books,market:'moneyline',providerGameId:d.providerGameId,
  evaluatedAt:d.evaluatedAt,gameStartsAt:d.gameStartsAt});
 const execution=nflPairedReferenceBooksAt({books:c.books,market:'moneyline',providerGameId:d.providerGameId,
  evaluatedAt:d.evaluatedAt,gameStartsAt:d.gameStartsAt,executionOnly:true}).find(q=>
  nflSportsbookFamily(q.sportsbook)===targetFamily&&nflMarketSourceAt(q,'moneyline')===d.evaluatedQuote.observedAt&&
  (direction===1?q.moneyline!.homePrice:q.moneyline!.awayPrice)===price);
 // This route requires the actual offer receipt, never an aggregate fetch fallback.
 const requested=Date.parse(execution?.requestedAt??''),available=Date.parse(execution?.availableAt??'');
 if(!execution||![requested,available].every(Number.isFinite)||requested>available||available>at||
  Date.parse(d.evaluatedQuote.observedAt)>available)return null;
 const refs=paired([...c.books,...(c.referenceBooks??[])]).filter(q=>{
  const received=Date.parse(q.availableAt??'');
  return nflSportsbookFamily(q.sportsbook)!==targetFamily&&Number.isFinite(received)&&
   received>=Date.parse(nflMarketSourceAt(q,'moneyline'))&&received<=at;
 });
 const implied=(p:number)=>p>0?100/(100+p):-p/(100-p);
 const fair=(q:typeof execution)=>{const a=implied(q.moneyline!.homePrice),b=implied(q.moneyline!.awayPrice);return direction===1?a/(a+b):b/(a+b);};
 if(refs.length<2||Math.abs(refs.reduce((s,q)=>s+fair(q),0)/refs.length-d.marketFairProbability)>1e-8||
  probability<=d.marketFairProbability)return null;
 const professional=refs.filter(q=>['circa','pinnacle'].includes(nflSportsbookFamily(q.sportsbook)));
 const sourceValue=professional.map(q=>({q,ev:fair(q)*profit-(1-fair(q))}));
 if(!sourceValue.length||sourceValue.some(s=>s.ev<0||s.q.provider!=='owls'||!s.q.providerEventId))return null;
 // Every present professional source must have an identified, current clean
 // path. Unknown or genuinely opposing evidence cannot be outvoted.
 if(professional.some(q=>!r.paths?.some(p=>p.market==='moneyline'&&p.book===nflSportsbookFamily(q.sportsbook)&&
  p.reason==='same_book_paired_economic_path'&&p.currentAt===nflMarketSourceAt(q,'moneyline')&&
  !p.hasUnresolvedAdverseLeg&&(p.latestEconomicDirection===null||p.latestEconomicDirection===direction)&&
  p.sourcePosture!=='unidentified'&&p.sourcePosture!=='resists_net'&&p.sourcePosture!=='fully_bought_back')))return null;
 const pair=(q:typeof execution)=>JSON.stringify([q.moneyline?.homePrice,q.moneyline?.awayPrice]);
 if(professional.some(q=>!c.sourceHistory!.some(h=>h.providerGameId===d.providerGameId&&h.provider==='owls'&&
  h.providerEventId===q.providerEventId&&nflSportsbookFamily(h.sportsbook)===nflSportsbookFamily(q.sportsbook)&&
  nflMarketSourceAt(h,'moneyline')===nflMarketSourceAt(q,'moneyline')&&pair(h)===pair(q)&&
  Date.parse(h.availableAt??'')>=Date.parse(nflMarketSourceAt(h,'moneyline'))&&Date.parse(h.availableAt??'')<=requested)))return null;
 const supporting:string[]=[];
 const proofs:NflUnchangedMoneylineProof[]=[];
 let responseAt:string|undefined;
 for(const {q,ev:sourceEV}of sourceValue){
  if(sourceEV<NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_EXPECTED_VALUE)continue;
  const book=nflSportsbookFamily(q.sportsbook);
  const flows=(r.reactionContext?.moneyline?.flows??[]).filter(f=>f.authority==='source_contract_reaction_context_only'&&
   f.providerGameId===d.providerGameId&&f.book&&nflSportsbookFamily(f.book)===book&&f.sourceEventId&&f.sourceLine===null);
  const latest=Math.max(...flows.map(f=>Date.parse(f.observedAt)).filter(Number.isFinite));
  const rows=flows.filter(f=>Date.parse(f.observedAt)===latest);
  if(!rows.length||new Set(rows.map(f=>JSON.stringify([f.sourceEventId,f.direction,f.moneyPct,f.ticketPct,f.reactionBaselineObservedAt,f.availableAt]))).size!==1)continue;
  const flow=rows[0]!,pressure=nflPublishedSourcePressure([flow.moneyPct??null,flow.moneyPct==null?null:100-flow.moneyPct,
   flow.ticketPct??null,flow.ticketPct==null?null:100-flow.ticketPct]);
  const flowAvailable=Date.parse(flow.availableAt??'');
  if(pressure?.direction!==-direction||flow.direction!==-direction||at-latest>120*60_000||latest>at||
   !Number.isFinite(flowAvailable)||flowAvailable<latest||flowAvailable>at)continue;
  if(q.providerEventId!==flow.sourceEventId)continue;
  const history=c.sourceHistory.filter(h=>h.providerGameId===d.providerGameId&&h.moneyline!==null&&h.provider==='owls'&&
   h.providerEventId===flow.sourceEventId&&nflSportsbookFamily(h.sportsbook)===book);
  const baselineAt=Date.parse(flow.reactionBaselineObservedAt??'');
  const baseline=history.find(h=>Date.parse(nflMarketSourceAt(h,'moneyline'))===baselineAt&&
   Date.parse(h.availableAt??'')<=latest&&Date.parse(h.availableAt??'')>=baselineAt&&baselineAt<=latest&&latest-baselineAt<=120*60_000);
  const current=history.find(h=>nflMarketSourceAt(h,'moneyline')===nflMarketSourceAt(q,'moneyline')&&
   pair(h)===pair(q)&&Date.parse(h.availableAt??'')<=requested&&
   Date.parse(h.availableAt??'')>=Date.parse(nflMarketSourceAt(h,'moneyline')));
  if(!baseline||!current||Date.parse(nflMarketSourceAt(current,'moneyline'))<=flowAvailable||
   requested<Date.parse(current.availableAt!))continue;
  const after=history.filter(h=>Date.parse(nflMarketSourceAt(h,'moneyline'))>=baselineAt);
  const episode=selectNflNamedMoneylineEpisodeAfterKnowledge({history:after,sportsbook:book,providerGameId:d.providerGameId,
   statisticalKnowledgeAt:null,informationOverlap:'not_attested',evaluatedAt:d.evaluatedAt,gameStartsAt:d.gameStartsAt});
  // Actual paired prices, including counter-juice, must hold throughout the
  // response window. No buyback/endpoints-only cancellation is confirmation.
  if(!episode||episode.openingAt!==new Date(baselineAt).toISOString()||episode.currentAt!==nflMarketSourceAt(q,'moneyline')||
   after.some(h=>pair(h)!==pair(baseline)))continue;
  proofs.push({book,sourceEventId:flow.sourceEventId!,firstPrice:q.moneyline!.homePrice,secondPrice:q.moneyline!.awayPrice,
   baselineObservedAt:nflMarketSourceAt(baseline,'moneyline'),baselineAvailableAt:baseline.availableAt!,
   pressureObservedAt:flow.observedAt,pressureAvailableAt:flow.availableAt!,responseObservedAt:nflMarketSourceAt(current,'moneyline'),
   responseAvailableAt:current.availableAt!,sourceFairProbability:fair(q),sourceTargetExpectedValue:sourceEV});
  supporting.push(book);responseAt=nflMarketSourceAt(current,'moneyline');
 }
 return supporting.length?{unchangedMoneylineProof:proofs,supportingSources:supporting.sort(),priorProbability:probability,finalProbability:probability,
  executionQualified:true,sourceQualified:true,executionAvailableAt:execution.availableAt,executionRequestedAt:execution.requestedAt,
  sourceObservedAt:responseAt,leanEligible:true,bestAngleEligible:true,reason:'qualified_unchanged_moneyline_opposite_pressure_hold'}:null;
}
