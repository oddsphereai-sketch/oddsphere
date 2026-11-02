import { cbbExactMarketCenter } from "./marketReaderResearch";
import { cbbImpliedProbability,reviewCbbQuote } from "./marketEvidence";
import { normalCdf } from "./model";
import { gradeCbbProvisional } from "./provisionalGradePolicy";
import { CBB_CURRENT_SCORE_RELEASE } from "./currentScoreRuntime";
import type { CbbForecast,CbbMarket,CbbQuote } from "./types";

export const CBB_MARKET_BEHAVIOR_MODEL_RELEASE="cbb_candidate_2026_11_02_r4_observed_market_behavior" as const;
export const CBB_MARKET_BEHAVIOR_GRADE_RELEASE="cbb_2026_11_02_r3_bound_market_behavior" as const;
export const CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE="cbb_market_behavior_2026_11_02_r1_same_book_economics" as const;
const priority=["circa","pinnacle","bookmaker"];
export const cbbBookFamily=(book:string)=>["pinnacle","ps3838"].includes(book.toLowerCase())?"pinnacle":book.toLowerCase();
type AttestedQuote=CbbQuote&{orientationVerified?:boolean};
export type CbbMarketAnchors={release:typeof CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE;gameId:number;startsAt:string;
  independentRelease:string;independentInputKey:string;capturedAt:string;quotes:Array<CbbQuote&{anchorCapturedAt?:string}>;quarantinedKeys?:string[]};
export type CbbBehaviorFlow={provider:"owls";gameId:number;sourceBook:string;market:CbbMarket;line:number|null;
  firstMoney:number;secondMoney:number;firstTickets:number;secondTickets:number;
  observedAt:string;fetchedAt:string;orientationVerified:boolean;sourceEventId:string;sourceIdentity:"independent_named_fixture_join"};
export type CbbBehaviorEpisode={book:string;market:CbbMarket;anchor:CbbQuote;current:CbbQuote;
  delta:number;direction:-1|0|1;flowDirection:-1|0|1|null;flow:CbbBehaviorFlow|null};
type AxisRead={status:"applied"|"neutral"|"unavailable"|"conflicting";delta:number;
  sourceBook:string|null;sourceMarket:CbbMarket|null;reason:string};
export type CbbMarketBehaviorReceipt={release:typeof CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE;
  modelRelease:typeof CBB_MARKET_BEHAVIOR_MODEL_RELEASE;independentRelease:string;independentInputKey:string;
  informationOverlap:"not_attested";referencePolicy:"union_target_excluded_same_book_receipts";
  marginPolicy:"spread_owner_moneyline_fallback_conflict_rejection";sourcePriority:string[];
  evaluatedAt:string;evaluatedTargets:CbbQuote[];inputRevisionSinceAnchor:"same"|"changed";sourceProblems:string[];
  excludedFamilies:string[];anchors:CbbMarketAnchors;episodes:CbbBehaviorEpisode[];
  margin:AxisRead;total:AxisRead;independentScore:{home:number;away:number;margin:number;total:number;homeWinProbability:number};
  winnerArbitration:{status:"applied"|"not_needed"|"unavailable"|"conflicting";reason:string;sourceBook:string|null;
    independentDirection:-1|0|1;marketDirection:-1|0|1;moneyline:CbbQuote|null;spread:CbbQuote|null;impliedMargin:number|null};
  finalScore:{home:number;away:number;margin:number;total:number;homeWinProbability:number}};
const direction=(n:number):-1|0|1=>Math.abs(n)<=1e-7?0:n>0?1:-1;
const fair=(q:CbbQuote)=>cbbImpliedProbability(q.firstPrice)/(cbbImpliedProbability(q.firstPrice)+cbbImpliedProbability(q.secondPrice));
const tuple=(q:CbbQuote)=>JSON.stringify([q.line,q.firstPrice,q.secondPrice]);
function validQuote(q:AttestedQuote,base:CbbForecast,at:number,excluded:Set<string>):boolean{
  const observed=Date.parse(q.providerObservedAt),received=Date.parse(q.fetchedAt);
  if(q.gameId!==base.gameId||q.phase!=="current"||q.orientationVerified!==true||
    !priority.includes(cbbBookFamily(q.sportsbook))||excluded.has(cbbBookFamily(q.sportsbook))||
    !Number.isFinite(observed)||!Number.isFinite(received)||observed>received||received>at||at-observed>3600_000||
    q.market!=="moneyline"&&(q.line===null||!Number.isFinite(q.line)||!Number.isInteger(q.line*2)))return false;
  try{const hold=cbbImpliedProbability(q.firstPrice)+cbbImpliedProbability(q.secondPrice);return hold>=.98&&hold<=1.3;}catch{return false;}
}
function latestQuotes(quotes:CbbQuote[],base:CbbForecast,at:number,excluded:Set<string>):CbbQuote[]{
  const groups=new Map<string,CbbQuote[]>();
  for(const q of quotes)if(validQuote(q,base,at,excluded)){const key=`${cbbBookFamily(q.sportsbook)}:${q.market}`;groups.set(key,[...(groups.get(key)??[]),q]);}
  return [...groups.values()].flatMap(rows=>{
    const last=Math.max(...rows.map(q=>Date.parse(q.providerObservedAt))),latest=rows.filter(q=>Date.parse(q.providerObservedAt)===last);
    return new Set(latest.map(tuple)).size===1?[structuredClone(latest[0])]:[];
  });
}
function mlMargin(base:CbbForecast,anchor:CbbQuote,current:CbbQuote):number{
  const logit=(p:number)=>Math.log(p/(1-p));
  const shifted=1/(1+Math.exp(-(logit(base.homeWinProbability)+logit(fair(current))-logit(fair(anchor)))));
  return cbbExactMarketCenter(base,current,shifted)-base.margin;
}
function boundFlow(flows:CbbBehaviorFlow[],episode:Pick<CbbBehaviorEpisode,"anchor"|"current"|"market"|"book">,
  base:CbbForecast,targets:CbbQuote[],at:number):CbbBehaviorFlow|null{
  const {anchor,current,book,market}=episode;
  const eligible=flows.filter(flow=>{
    const observed=Date.parse(flow.observedAt),received=Date.parse(flow.fetchedAt),values=[flow.firstMoney,flow.secondMoney,flow.firstTickets,flow.secondTickets];
    return flow.provider==="owls"&&flow.orientationVerified&&flow.sourceIdentity==="independent_named_fixture_join"&&flow.sourceEventId.trim().length>0&&flow.gameId===base.gameId&&flow.market===market&&
      cbbBookFamily(flow.sourceBook)===book&&flow.line===anchor.line&&flow.line===current.line&&
      targets.some(q=>q.market===market&&q.line===flow.line)&&values.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&
      Math.abs(flow.firstMoney+flow.secondMoney-1)<=.03&&Math.abs(flow.firstTickets+flow.secondTickets-1)<=.03&&
      Number.isFinite(observed)&&Number.isFinite(received)&&observed<=received&&received<=at&&at-observed<=3*3600_000&&
      Date.parse(anchor.providerObservedAt)<=observed&&observed<Date.parse(current.providerObservedAt)&&received<=Date.parse(current.fetchedAt)&&
      observed-Date.parse(anchor.providerObservedAt)<=2*3600_000;
  }).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt));
  if(!eligible.length)return null;
  const latest=eligible.filter(flow=>Date.parse(flow.observedAt)===Date.parse(eligible[0].observedAt));
  return new Set(latest.map(flow=>JSON.stringify([flow.line,flow.firstMoney,flow.firstTickets,flow.secondMoney,flow.secondTickets]))).size===1?structuredClone(latest[0]):null;
}
const emptyAxis=(reason:string):AxisRead=>({status:"unavailable",delta:0,sourceBook:null,sourceMarket:null,reason});
function chooseAxis(episodes:CbbBehaviorEpisode[],axis:"margin"|"total"):AxisRead{
  type AxisCandidate={conflict:true;book:string}|{conflict:false;book:string;owner:CbbBehaviorEpisode};
  const candidates=priority.flatMap<AxisCandidate>(book=>{
    const rows=episodes.filter(e=>e.book===book&&(axis==="total"?e.market==="total":e.market!=="total"));
    const moving=rows.filter(e=>e.direction!==0);
    if(new Set(moving.map(e=>e.direction)).size>1)return [{conflict:true as const,book}];
    const owner=axis==="margin"?moving.find(e=>e.market==="spread")??moving.find(e=>e.market==="moneyline"):moving[0];
    return owner?[{conflict:false as const,book,owner}]:[];
  });
  if(candidates.some(x=>x.conflict)||new Set(candidates.flatMap(x=>x.conflict?[]:[x.owner.direction])).size>1)
    return {...emptyAxis("opposed_same_book_or_cross_book_economics"),status:"conflicting"};
  const selected=candidates.find(x=>!x.conflict);
  if(selected&&!selected.conflict)return {status:"applied",delta:selected.owner.delta,sourceBook:selected.book,sourceMarket:selected.owner.market,reason:"observed_same_book_relative_economics"};
  return episodes.some(e=>axis==="total"?e.market==="total":e.market!=="total")
    ?{...emptyAxis("no_net_economic_change"),status:"neutral"}:emptyAxis("no_qualified_paired_episode");
}
function adjudicateWinner(base:CbbForecast,current:CbbQuote[]):CbbMarketBehaviorReceipt["winnerArbitration"]{
  const independentDirection=direction(base.margin),none={sourceBook:null,moneyline:null,spread:null,impliedMargin:null,independentDirection,marketDirection:0 as const};
  if(base.inputStatus!=="complete")return {...none,status:"unavailable",reason:"independent_inputs_incomplete"};
  const named=priority.flatMap(book=>{
    const moneyline=current.find(q=>cbbBookFamily(q.sportsbook)===book&&q.market==="moneyline"),spread=current.find(q=>cbbBookFamily(q.sportsbook)===book&&q.market==="spread");
    if(!moneyline||!spread||Math.abs(Date.parse(moneyline.providerObservedAt)-Date.parse(spread.providerObservedAt))>60_000)return [];
    const mlDirection=direction(fair(moneyline)-.5),impliedMargin=cbbExactMarketCenter(base,spread,fair(spread)),spreadDirection=direction(impliedMargin);
    return [{book,moneyline,spread,mlDirection,spreadDirection,impliedMargin}];
  });
  if(!named.length)return {...none,status:"unavailable",reason:"no_same_book_winner_and_spread_pair"};
  if(named.some(x=>x.mlDirection!==0&&x.spreadDirection!==0&&x.mlDirection!==x.spreadDirection))return {...none,status:"conflicting",reason:"same_book_cross_market_winner_conflict"};
  const corroborated=named.filter(x=>x.mlDirection!==0&&x.mlDirection===x.spreadDirection);
  if(!corroborated.length)return {...none,status:"unavailable",reason:"no_corroborated_market_winner"};
  const selected=corroborated[0],marketDirection=selected.mlDirection;
  const allDirections=current.filter(q=>q.market!=="total").map(q=>q.market==="moneyline"?direction(fair(q)-.5):direction(cbbExactMarketCenter(base,q,fair(q))));
  if(allDirections.some(n=>n!==0&&n!==marketDirection))return {...none,status:"conflicting",reason:"cross_book_winner_conflict"};
  const common={independentDirection,marketDirection,sourceBook:selected.book,moneyline:selected.moneyline,spread:selected.spread,impliedMargin:selected.impliedMargin};
  return {...common,status:marketDirection===independentDirection?"not_needed":"applied",reason:marketDirection===independentDirection?"independent_and_market_winner_agree":"same_book_ml_spread_opposition_arbitration"};
}
const score=(f:CbbForecast)=>({home:f.homeScore,away:f.awayScore,margin:f.margin,total:f.total,homeWinProbability:f.homeWinProbability});
/** Private candidate: promotion requires held-out qualification or a scoped
 * owner exception. No provider, storage, fitting, writer or live activation. */
export function readCbbMarketBehavior(args:{independent:CbbForecast;independentInputKey:string;startsAt:string;
  targets:CbbQuote[];currentQuotes:CbbQuote[];anchors:CbbMarketAnchors|null;flows?:CbbBehaviorFlow[]}){
  const base=args.independent,at=Date.parse(base.asOf),start=Date.parse(args.startsAt);
  if(base.release!==CBB_CURRENT_SCORE_RELEASE||!args.independentInputKey||![at,start].every(Number.isFinite)||at>=start-3600_000)
    throw new Error("CBB market behavior requires current independent release and an open prelock fixture");
  if(args.targets.some(q=>q.gameId!==base.gameId))throw new Error("CBB market target identity mismatch");
  const independentZero=normalCdf((.5-base.margin)/base.uncertainty.marginSd)-normalCdf((-.5-base.margin)/base.uncertainty.marginSd);
  const independentWinner=(1-normalCdf((.5-base.margin)/base.uncertainty.marginSd))/(1-independentZero);
  if(base.inputStatus==="complete"&&(![base.homeScore,base.awayScore,base.margin,base.total,base.homeWinProbability,independentWinner].every(Number.isFinite)||
    base.homeScore<=0||base.awayScore<=0||Math.abs(base.homeScore-base.awayScore-base.margin)>1e-8||Math.abs(base.homeScore+base.awayScore-base.total)>1e-8||
    Math.abs(base.homeWinProbability-independentWinner)>1e-8))throw new Error("CBB independent forecast coherence mismatch");
  const excludedFamilies=[...new Set(args.targets.map(q=>cbbBookFamily(q.sportsbook)))].sort(),excluded=new Set(excludedFamilies);
  const current=latestQuotes(args.currentQuotes,base,at,excluded);
  const previous=args.anchors;
  const reusable=previous?.release===CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE&&previous.gameId===base.gameId&&
    previous.startsAt===args.startsAt&&previous.independentRelease===base.release&&
    Number.isFinite(Date.parse(previous.capturedAt))&&Date.parse(previous.capturedAt)<=at;
  const originals=reusable?previous.quotes.filter(q=>validQuote(q,base,Date.parse(q.anchorCapturedAt??previous.capturedAt),excluded)):[];
  const known=new Set(originals.map(q=>`${cbbBookFamily(q.sportsbook)}:${q.market}`));
  const quarantined=new Set(reusable?previous.quarantinedKeys??[]:[]),sourceProblems:string[]=[];
  const anchors:CbbMarketAnchors={release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:base.gameId,startsAt:args.startsAt,
    independentRelease:base.release,independentInputKey:reusable?previous.independentInputKey:args.independentInputKey,capturedAt:reusable?previous.capturedAt:base.asOf,
    quotes:[...structuredClone(originals),...current.filter(q=>!known.has(`${cbbBookFamily(q.sportsbook)}:${q.market}`))
      .map(q=>({...q,anchorCapturedAt:base.asOf}))],quarantinedKeys:[...quarantined]};
  const episodes:CbbBehaviorEpisode[]=[];
  if(base.inputStatus==="complete")for(const anchor of anchors.quotes){
    const book=cbbBookFamily(anchor.sportsbook),currentQuote=current.find(q=>cbbBookFamily(q.sportsbook)===book&&q.market===anchor.market);
    const key=`${book}:${anchor.market}`;
    if(currentQuote&&currentQuote.providerObservedAt===anchor.providerObservedAt&&tuple(currentQuote)!==tuple(anchor)){
      quarantined.add(key);sourceProblems.push(`${key}:ambiguous_original_source_timestamp`);
    }
    if(quarantined.has(key)||!currentQuote||Date.parse(currentQuote.providerObservedAt)<=Date.parse(anchor.providerObservedAt)||Date.parse(currentQuote.fetchedAt)<Date.parse(anchor.fetchedAt))continue;
    const delta=tuple(anchor)===tuple(currentQuote)?0:anchor.market==="moneyline"?mlMargin(base,anchor,currentQuote):
      cbbExactMarketCenter(base,currentQuote,fair(currentQuote))-cbbExactMarketCenter(base,anchor,fair(anchor));
    const flow=boundFlow(args.flows??[],{book,market:anchor.market,anchor,current:currentQuote},base,args.targets,at);
    const flowDirection:-1|0|1|null=flow?flow.firstMoney>.5&&flow.firstMoney>flow.firstTickets?1:flow.firstMoney<.5&&flow.firstMoney<flow.firstTickets?-1:0:null;
    episodes.push({book,market:anchor.market,anchor,current:currentQuote,delta,direction:direction(delta),flowDirection,flow});
  }
  anchors.quarantinedKeys=[...quarantined].sort();
  // A contradictory original receipt disqualifies the source from ALL
  // forecast authority, including the current-level winner arbitration.
  let winnerArbitration=adjudicateWinner(base,current.filter(q=>!quarantined.has(`${cbbBookFamily(q.sportsbook)}:${q.market}`)));
  let margin=chooseAxis(episodes,"margin"),total=chooseAxis(episodes,"total");
  if(winnerArbitration.status==="applied")margin={status:"applied",delta:winnerArbitration.impliedMargin!-base.margin,sourceBook:winnerArbitration.sourceBook,sourceMarket:"spread",reason:winnerArbitration.reason};
  let nextMargin=base.margin+margin.delta,nextTotal=base.total+total.delta;
  if(!Number.isFinite(nextMargin)||!Number.isFinite(nextTotal)||nextTotal<=Math.abs(nextMargin)){
    margin=emptyAxis("incoherent_score_consequence");total=emptyAxis("incoherent_score_consequence");nextMargin=base.margin;nextTotal=base.total;
    if(winnerArbitration.status==="applied")winnerArbitration={...winnerArbitration,status:"unavailable",reason:"incoherent_score_consequence"};
  }
  const zero=normalCdf((.5-nextMargin)/base.uncertainty.marginSd)-normalCdf((-.5-nextMargin)/base.uncertainty.marginSd);
  const forecast:CbbForecast=margin.delta===0&&total.delta===0?{...base,release:CBB_MARKET_BEHAVIOR_MODEL_RELEASE}:{...base,release:CBB_MARKET_BEHAVIOR_MODEL_RELEASE,margin:nextMargin,total:nextTotal,
    homeScore:(nextTotal+nextMargin)/2,awayScore:(nextTotal-nextMargin)/2,
    homeWinProbability:(1-normalCdf((.5-nextMargin)/base.uncertainty.marginSd))/(1-zero)};
  const receipt:CbbMarketBehaviorReceipt={release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,modelRelease:CBB_MARKET_BEHAVIOR_MODEL_RELEASE,
    independentRelease:base.release,independentInputKey:args.independentInputKey,informationOverlap:"not_attested",
    referencePolicy:"union_target_excluded_same_book_receipts",marginPolicy:"spread_owner_moneyline_fallback_conflict_rejection",
    sourcePriority:[...priority],evaluatedAt:base.asOf,evaluatedTargets:structuredClone(args.targets),
    inputRevisionSinceAnchor:anchors.independentInputKey===args.independentInputKey?"same":"changed",sourceProblems,
    excludedFamilies,anchors,episodes,margin,total,winnerArbitration,independentScore:score(base),finalScore:score(forecast)};
  return {forecast,receipt};
}
export function gradeCbbMarketBehavior(input:Parameters<typeof gradeCbbProvisional>[0],receipt:CbbMarketBehaviorReceipt){
  if(input.forecast.release!==receipt.modelRelease||input.forecast.gameId!==receipt.anchors.gameId||
    input.asOf!==receipt.evaluatedAt||input.forecast.asOf!==receipt.evaluatedAt||
    !receipt.excludedFamilies.includes(cbbBookFamily(input.target.sportsbook))||
    !receipt.evaluatedTargets.some(q=>JSON.stringify([q.gameId,q.market,q.sportsbook,q.line,q.firstPrice,q.secondPrice,q.providerObservedAt,q.fetchedAt,q.phase])===
      JSON.stringify([input.target.gameId,input.target.market,input.target.sportsbook,input.target.line,input.target.firstPrice,input.target.secondPrice,input.target.providerObservedAt,input.target.fetchedAt,input.target.phase]))||
    JSON.stringify(score(input.forecast))!==JSON.stringify(receipt.finalScore))throw new Error("CBB grade/market score receipt mismatch");
  const quarantined=new Set(receipt.anchors.quarantinedKeys??[]);
  const base=gradeCbbProvisional({...input,references:input.references.filter(q=>!quarantined.has(`${cbbBookFamily(q.sportsbook)}:${q.market}`))}),selected=reviewCbbQuote(input.forecast,input.target).selection;
  const sign=selected==="first"?1:-1;
  const pressure=receipt.episodes.filter(e=>e.market===input.target.market&&e.flow&&e.direction!==0&&e.flowDirection===e.direction&&e.current.line===input.target.line)
    .map(e=>e.direction*sign);
  const posture=pressure.length===0?"unavailable":pressure.every(n=>n>0)?"supports":pressure.every(n=>n<0)?"opposes":"mixed";
  const axis=input.target.market==="total"?receipt.total:receipt.margin;
  const resolvedConfirmation=axis.status==="applied"&&axis.reason==="observed_same_book_relative_economics"&&axis.sourceMarket===input.target.market&&receipt.episodes.some(e=>e.book===axis.sourceBook&&e.market===axis.sourceMarket&&e.flow&&e.flowDirection===e.direction&&e.direction===direction(axis.delta));
  let grade=base.grade,reason=base.reason;
  if((posture==="opposes"||posture==="mixed")&&(grade==="Best Angle"||grade==="Lean")){
    grade="Watchlist";reason="bound_price_and_handle_resistance";
  }else if(posture==="supports"&&resolvedConfirmation&&grade==="Watchlist"&&base.referenceState==="neutral"&&base.expectedValue!==null&&base.expectedValue>=.03&&
    base.price!==null&&base.price>=(input.target.market==="moneyline"?-250:-500)){
    grade="Lean";reason="bound_price_and_handle_confirmation";
  }else if(reason==="material_edge_with_professional_corroboration"||reason==="positive_edge_with_professional_corroboration"){
    reason="final_forecast_value_with_professional_price_direction";
  }
  return {...base,release:CBB_MARKET_BEHAVIOR_GRADE_RELEASE,grade,reason,marketPressure:posture};
}
