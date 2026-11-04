import {decideCbbJointMargin,type CbbJointMarginDecision} from "./jointMarginDecision";
import { cbbExactMarketCenter } from "./marketReaderResearch";
import { cbbImpliedProbability } from "./marketEvidence";
import { normalCdf } from "./model";
import {cbbSameNativePressureState,readCbbMarketBehaviorPath,expandCbbMarketBehaviorPathStream,cbbPublishedSourcePressure,CBB_MARKET_BEHAVIOR_PATH_RELEASE,type CbbMarketBehaviorPathTape,type CbbMarketPathStreamRead,type CbbSourcePathQuarantine} from "./marketBehaviorPath";
import {cbbEvidenceAvailableAt,cbbEvidenceProvablyBefore,cbbEvidenceReceiptBounds} from "./marketReceiptTime";
import { gradeCbbProvisional } from "./provisionalGradePolicy";
import {gradeCbbReceivedMarket} from "./marketBehaviorGrade";
import { CBB_CURRENT_SCORE_RELEASE,CBB_PREVIOUS_CURRENT_SCORE_RELEASE } from "./currentScoreRuntime";
import type { CbbForecast,CbbMarket,CbbQuote,CbbCanonicalReceipt } from "./types";
import {cbbSelectDecisionSplitFrontiers,type CbbDecisionSplitContext} from "./decisionSplitContext";
import {interpretCbbRelativeMarketMove,type CbbRelativeMarketInterpretation} from "./marketEpisodeInterpretation";
import {selectCbbSourceEpisode,type CbbSourceAuthority} from "./sourceEpisodeAuthority";
import {readCbbSourcePressure,type CbbPressureDecision} from "./sourcePressureDecision";

export const CBB_PREVIOUS_MARKET_BEHAVIOR_MODEL_RELEASE="cbb_candidate_2026_11_02_r5_received_market_response" as const;
export const CBB_PRIOR_MARKET_BEHAVIOR_MODEL_RELEASE="cbb_candidate_2026_11_03_r6_new_orleans_prior_input" as const;
export const CBB_EPISODE_MARKET_BEHAVIOR_MODEL_RELEASE="cbb_candidate_2026_11_03_r10_observed_episode_authority" as const;
export const CBB_EPISODE_MARKET_BEHAVIOR_GRADE_RELEASE="cbb_2026_11_03_r12_contextual_episode_decisions" as const;
export const CBB_EPISODE_MARKET_BEHAVIOR_RECEIPT_RELEASE="cbb_market_behavior_2026_11_03_r6_observed_episode_decisions" as const;
export const CBB_RETAIL_MARKET_BEHAVIOR_MODEL_RELEASE="cbb_candidate_2026_11_03_r11_retail_response_receipts" as const;
export const CBB_RETAIL_MARKET_BEHAVIOR_GRADE_RELEASE="cbb_2026_11_03_r13_retail_response_receipts" as const;
export const CBB_RETAIL_MARKET_BEHAVIOR_RECEIPT_RELEASE="cbb_market_behavior_2026_11_03_r7_retail_response_receipts" as const;
export const CBB_ALIGNED_MARKET_BEHAVIOR_MODEL_RELEASE="cbb_candidate_2026_11_03_r12_aligned_native_reactions" as const;
export const CBB_ALIGNED_MARKET_BEHAVIOR_GRADE_RELEASE="cbb_2026_11_03_r14_aligned_native_reactions" as const;
export const CBB_ALIGNED_MARKET_BEHAVIOR_RECEIPT_RELEASE="cbb_market_behavior_2026_11_03_r8_aligned_native_reactions" as const;
export const CBB_JOINT_MARKET_BEHAVIOR_MODEL_RELEASE="cbb_candidate_2026_11_03_r13_joint_native_market_decision" as const;
export const CBB_JOINT_MARKET_BEHAVIOR_GRADE_RELEASE="cbb_2026_11_03_r15_joint_native_market_decision" as const;
export const CBB_JOINT_MARKET_BEHAVIOR_RECEIPT_RELEASE="cbb_market_behavior_2026_11_03_r9_joint_native_market_decision" as const;
export const CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_MODEL_RELEASE="cbb_candidate_2026_11_04_r14_current_board_source_aliases" as const;
export const CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_GRADE_RELEASE="cbb_2026_11_04_r16_current_board_source_aliases" as const;
export const CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_RECEIPT_RELEASE="cbb_market_behavior_2026_11_04_r10_current_board_source_aliases" as const;
export const CBB_CONTINUITY_MARKET_BEHAVIOR_MODEL_RELEASE="cbb_candidate_2026_11_04_r15_response_frontier_law_support" as const;
export const CBB_CONTINUITY_MARKET_BEHAVIOR_GRADE_RELEASE="cbb_2026_11_04_r17_response_frontier_law_support" as const;
export const CBB_CONTINUITY_MARKET_BEHAVIOR_RECEIPT_RELEASE="cbb_market_behavior_2026_11_04_r11_response_frontier_law_support" as const;
export const CBB_CONTEXTUAL_HANDOFF_MARKET_BEHAVIOR_MODEL_RELEASE="cbb_candidate_2026_11_04_r16_contextual_authority_handoff" as const;
export const CBB_NATIVE_COUNTERPRESSURE_MODEL_RELEASE="cbb_candidate_2026_11_04_r17_native_counterpressure_handoff" as const;
export const CBB_MARKET_BEHAVIOR_MODEL_RELEASE="cbb_candidate_2026_11_04_r18_current_source_forecast_restoration" as const;
export const CBB_INFORMATIONAL_WATCHLIST_GRADE_RELEASE="cbb_2026_11_04_r19_informational_watchlist" as const;
export const CBB_MONEYLINE_VALUE_GRADE_RELEASE="cbb_2026_11_04_r20_moneyline_value_eligibility" as const;
export const CBB_NATIVE_COUNTERPRESSURE_GRADE_RELEASE="cbb_2026_11_04_r21_native_counterpressure_handoff" as const;
export const CBB_MARKET_BEHAVIOR_GRADE_RELEASE="cbb_2026_11_04_r22_current_source_forecast_restoration" as const;
export const CBB_INTERMEDIATE_MARKET_BEHAVIOR_GRADE_RELEASE="cbb_2026_11_03_r8_new_orleans_prior_input" as const;
export const CBB_PRIOR_MARKET_BEHAVIOR_GRADE_RELEASE="cbb_2026_11_03_r7_verified_action_or_professional_value_best" as const;
export const CBB_PREVIOUS_MARKET_BEHAVIOR_GRADE_RELEASE="cbb_2026_11_03_r6_exact_decision_gate_reasons" as const;
export const CBB_OLDER_MARKET_BEHAVIOR_GRADE_RELEASE="cbb_2026_11_02_r5_resolved_price_not_double_penalized" as const;
export const CBB_CONTEXTUAL_HANDOFF_MARKET_BEHAVIOR_RECEIPT_RELEASE="cbb_market_behavior_2026_11_04_r12_contextual_authority_handoff" as const;
export const CBB_NATIVE_COUNTERPRESSURE_RECEIPT_RELEASE="cbb_market_behavior_2026_11_04_r13_native_counterpressure_handoff" as const;
export const CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE="cbb_market_behavior_2026_11_04_r14_current_source_forecast_restoration" as const;
const priority=["circa","pinnacle","bookmaker"];
export const cbbBookFamily=(book:string)=>["pinnacle","ps3838"].includes(book.toLowerCase())?"pinnacle":book.toLowerCase();
type AttestedQuote=CbbQuote&{orientationVerified?:boolean};
export type CbbMarketAnchors={release:typeof CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE|typeof CBB_NATIVE_COUNTERPRESSURE_RECEIPT_RELEASE|typeof CBB_CONTEXTUAL_HANDOFF_MARKET_BEHAVIOR_RECEIPT_RELEASE|typeof CBB_CONTINUITY_MARKET_BEHAVIOR_RECEIPT_RELEASE|typeof CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_RECEIPT_RELEASE|typeof CBB_JOINT_MARKET_BEHAVIOR_RECEIPT_RELEASE|typeof CBB_ALIGNED_MARKET_BEHAVIOR_RECEIPT_RELEASE|typeof CBB_RETAIL_MARKET_BEHAVIOR_RECEIPT_RELEASE|typeof CBB_EPISODE_MARKET_BEHAVIOR_RECEIPT_RELEASE|"cbb_market_behavior_2026_11_03_r4_new_orleans_prior_input"|"cbb_market_behavior_2026_11_03_r3_direction_and_magnitude"|"cbb_market_behavior_2026_11_02_r2_received_source_path"|"cbb_market_behavior_2026_11_02_r1_same_book_economics";gameId:number;startsAt:string;
  independentRelease:string;independentInputKey:string;capturedAt:string;quotes:Array<CbbQuote&{anchorCapturedAt?:string}>;quarantinedKeys?:string[]};
export type CbbBehaviorFlow={provider:"owls";gameId:number;sourceBook:string;market:CbbMarket;line:number|null;
  firstMoney:number;secondMoney:number;firstTickets:number;secondTickets:number;
  observedAt:string;fetchedAt:string;canonicalReceipt?:CbbCanonicalReceipt;orientationVerified:boolean;sourceEventId:string;sourceIdentity:"independent_named_fixture_join"};
export type CbbBehaviorEpisode={book:string;market:CbbMarket;anchor:CbbQuote;current:CbbQuote;
  delta:number;direction:-1|0|1;flowDirection:-1|0|1|null;flow:CbbBehaviorFlow|null};
export type CbbPathPosture={book:string;market:CbbMarket;status:CbbMarketPathStreamRead["status"];reason:string;
  pattern:CbbMarketPathStreamRead["pattern"];coverage:CbbMarketPathStreamRead["coverage"];
  sourceCurrentResolution:CbbMarketPathStreamRead["currentResolution"];sourceUnresolvedDirection:-1|0|1;
  onsetAt:string|null;latestLegAt:string|null;frontierAt:string|null;frontierAvailableBy:string|null;recentDirection:-1|0|1;
  flowResponse:"aligned"|"opposed"|"held"|null;flowReversed:boolean;
  boundFlowDirection:-1|0|1|null;flowReactionDirection:-1|0|1|null;latestFlowMatched:boolean;
  flowCurrentResolution:"held"|"ongoing"|"contested"|"resumed"|"cancelled"|"reversed"|null;
  flowPressureBasis:"gap"|"concentration"|"rounded_uncertain"|"neutral"|null;
  flowMoneyPct:number|null;flowTicketPct:number|null;flowGap:number|null;
  pressureDirection:-1|0|1|null;pressureLine:number|null;pressureObservedAt:string|null;
  flowConcentrationDirection:-1|0|1;flowLine:number|null;flowObservedAt:string|null};
export type AxisRead={status:"applied"|"confirming"|"neutral"|"unavailable"|"conflicting"|"unresolved";delta:number;
  authority?:CbbSourceAuthority;
  crossMarketDisagreement?:boolean;
  sourceDirection:-1|0|1|null;directionalEvidence:"unavailable"|"flat"|"single_source"|"aligned"|"opposed"|"converging";
  sourceBook:string|null;sourceMarket:CbbMarket|null;reason:string};
export type CbbMarketBehaviorReceipt={release:typeof CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE;
  modelRelease:typeof CBB_MARKET_BEHAVIOR_MODEL_RELEASE;independentRelease:string;independentInputKey:string;
  forecastIdentity:ReturnType<typeof forecastIdentity>;frozenUncertainty:CbbForecast["uncertainty"];
  originalIndependentUncertainty?:CbbForecast["uncertainty"];jointMarginDecision?:CbbJointMarginDecision;
  informationOverlap:"not_attested";referencePolicy:"union_target_excluded_same_book_receipts";
  marginPolicy:"contextual_authority_before_current_level"|"joint_current_source_law_with_native_confirmation"|"spread_owner_moneyline_fallback_conflict_rejection";sourcePriority:string[];
  evaluatedAt:string;evaluatedTargets:CbbQuote[];currentProfessionalQuotes:CbbQuote[];inputRevisionSinceAnchor:"same"|"changed";sourceProblems:string[];
  splitContext:CbbDecisionSplitContext[];
  pressureDecisions:CbbPressureDecision[];
  withheldCurrentSources:Array<{book:string;market:CbbMarket;reason:string;sourceAt?:string}>;
  excludedFamilies:string[];anchors:CbbMarketAnchors;episodes:CbbBehaviorEpisode[];
  pathTape:CbbMarketBehaviorPathTape;pathPosture:CbbPathPosture[];
  historyCompleteness:{price:boolean;split:boolean};historyMode:"direct_stream"|"canonical_history";
  numericPathAssumption:"independent_relative_original_to_current_response";
  margin:AxisRead;total:AxisRead;independentScore:{home:number;away:number;margin:number;total:number;homeWinProbability:number};
  winnerArbitration:{status:"context_only"|"not_needed"|"unavailable"|"conflicting"|"applied"|"confirmed";reason:string;sourceBook:string|null;
    independentDirection:-1|0|1;marketDirection:-1|0|1;moneyline:CbbQuote|null;spread:CbbQuote|null;impliedMargin:number|null};
  finalScore:{home:number;away:number;margin:number;total:number;homeWinProbability:number}};
const direction=(n:number):-1|0|1=>Math.abs(n)<=1e-7?0:n>0?1:-1;
const fair=(q:CbbQuote)=>cbbImpliedProbability(q.firstPrice)/(cbbImpliedProbability(q.firstPrice)+cbbImpliedProbability(q.secondPrice));
const tuple=(q:CbbQuote)=>JSON.stringify([q.line,q.firstPrice,q.secondPrice]);
const validUncertainty=(f:CbbForecast)=>[f.uncertainty.marginSd,f.uncertainty.totalSd,f.uncertainty.marginTotalCorrelation].every(Number.isFinite)&&
  f.uncertainty.marginSd>0&&f.uncertainty.totalSd>0&&Math.abs(f.uncertainty.marginTotalCorrelation)<1;
function validQuote(q:AttestedQuote,base:CbbForecast,at:number,excluded:Set<string>,fresh=true):boolean{
  const observed=Date.parse(q.providerObservedAt),received=cbbEvidenceAvailableAt(q);
  if(q.gameId!==base.gameId||q.phase!=="current"||q.orientationVerified!==true||
    !priority.includes(cbbBookFamily(q.sportsbook))||excluded.has(cbbBookFamily(q.sportsbook))||
    !Number.isFinite(observed)||!Number.isFinite(received)||observed>received||received>at||fresh&&at-observed>3600_000||
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
const emptyAxis=(reason:string):AxisRead=>({status:"unavailable",delta:0,sourceBook:null,sourceMarket:null,reason,sourceDirection:null,directionalEvidence:"unavailable"});
/** Relative episodes remain a fallback when a current source law is absent.
 * Actual ML repricing is eligible alongside a flat Spread, never double-added. */
function chooseAxis(episodes:CbbBehaviorEpisode[],axis:"margin"|"total",base:CbbForecast,path:ReturnType<typeof readCbbMarketBehaviorPath>,pressure:readonly CbbPressureDecision[]):AxisRead{
  const effect=(selected:CbbBehaviorEpisode):Pick<CbbRelativeMarketInterpretation,"kind"|"scoreDelta">=>{
    if(selected.market!=="moneyline"){
      const center=(q:CbbQuote)=>cbbExactMarketCenter(base,q,fair(q));
      return interpretCbbRelativeMarketMove(axis==="total"?base.total:base.margin,center(selected.anchor),center(selected.current));
    }
    const read=interpretCbbRelativeMarketMove(base.homeWinProbability,fair(selected.anchor),fair(selected.current));
    return {kind:read.kind,scoreDelta:read.kind==="confirms_independent"?0:
      read.kind==="crosses_independent"?cbbExactMarketCenter(base,selected.current,fair(selected.current))-base.margin:selected.delta};
  };
  const candidates:CbbBehaviorEpisode[]=[];
  let crossMarketDisagreement=false;
  for(const book of [...new Set(episodes.map(e=>e.book))].sort()){
    const own=episodes.filter(e=>e.book===book&&(axis==="total"?e.market==="total":e.market!=="total"));
    const moving=own.filter(e=>e.direction!==0),spread=own.find(e=>e.market==="spread"),ml=own.find(e=>e.market==="moneyline");
    // Prefer a moving direct Spread for the fallback mean. A genuine ML
    // update remains eligible when Spread is flat; the current joint law
    // below reconciles both observed constraints rather than vetoing either.
    if(new Set(moving.map(e=>e.direction)).size>1||spread&&ml&&spread.direction!==ml.direction)crossMarketDisagreement=true;
    const owner=axis==="margin"?(spread?.direction!==0?spread:ml?.direction!==0?ml:spread??ml):moving[0];
    if(owner&&owner.direction!==0)candidates.push(owner);
  }
  const observed=candidates.flatMap(candidate=>{
    const stream=path.streams.find(stream=>stream.book===candidate.book&&stream.market===candidate.market);
    const moving=stream?.intervals.filter(interval=>interval.direction!==0)??[];
    let first=moving.at(-1);
    // The initial excursion does not own a later reversal forever. The
    // current contiguous economic leg supplies its own detection window.
    for(let i=moving.length-2;first&&i>=0&&moving[i].direction===first.direction;i--)first=moving[i];
    if(!stream)return [];
    first??={before:candidate.anchor,after:candidate.current,delta:candidate.delta,direction:candidate.direction};
    return [{id:`${candidate.book}:${candidate.market}`,effect:effect(candidate).scoreDelta,observedDirection:candidate.direction,
      beforeSourceAt:Date.parse(first.before.providerObservedAt),afterSourceAt:Date.parse(first.after.providerObservedAt),
      beforeEarliest:cbbEvidenceReceiptBounds(first.before).earliest,beforeAvailableBy:cbbEvidenceAvailableAt(first.before),afterAvailableBy:cbbEvidenceAvailableAt(first.after),
      currentSourceAt:Date.parse(candidate.current.providerObservedAt),currentAvailableBy:cbbEvidenceAvailableAt(candidate.current),
      repricedSourceAt:moving.length?Date.parse(moving.at(-1)!.after.providerObservedAt):null,
      currentDirection:stream.recentDirection,resolved:["ongoing","resumed","reversed"].includes(stream.currentResolution)&&stream.recentDirection===candidate.direction,
      qualifiedContrarianHold:pressure.some(p=>p.book===candidate.book&&p.market===candidate.market&&
        p.sourceClass==="professional_adjacent_named_book"&&p.resolution==="held"&&p.moneyDirection===-candidate.direction&&
        p.current&&tuple(p.current)===tuple(candidate.current)&&Date.parse(p.current.providerObservedAt)===Date.parse(candidate.current.providerObservedAt)),
      qualifiedNetResistance:pressure.some(p=>p.book===candidate.book&&p.market===candidate.market&&
        p.sourceClass==="professional_adjacent_named_book"&&p.resolution==="held"&&p.moneyDirection===candidate.direction&&
        p.current&&tuple(p.current)===tuple(candidate.current)&&Date.parse(p.current.providerObservedAt)===Date.parse(candidate.current.providerObservedAt)),
      qualifiedReaction:stream.boundFlows.some(flow=>["ongoing","resumed","reversed"].includes(flow.currentResolution)&&
        flow.currentUnresolvedDirection===candidate.direction&&flow.flowDirection===candidate.direction)}];
  });
  const authority=observed.length===candidates.length&&observed.length?selectCbbSourceEpisode(observed):undefined;
  if(candidates.length&&(!authority||authority.status==="unresolved")){
    const opposed=new Set(candidates.map(candidate=>candidate.direction)).size>1;
    return {...emptyAxis(authority?.reason??"economic_onset_unavailable"),status:opposed?"conflicting":"unresolved",
      sourceDirection:opposed?null:candidates[0].direction,directionalEvidence:opposed?"opposed":"aligned",authority,crossMarketDisagreement};
  }
  if(authority?.status==="retained"){
    const source=candidates.find(candidate=>`${candidate.book}:${candidate.market}`===authority.selectedId);
    return {status:"neutral",delta:0,sourceBook:source?.book??null,sourceMarket:source?.market??null,reason:"current_native_pressure_resists_old_net_move",
      sourceDirection:candidates[0].direction,directionalEvidence:"aligned",authority,crossMarketDisagreement};
  }
  const selected=candidates.find(candidate=>`${candidate.book}:${candidate.market}`===authority?.selectedId);
  if(selected){
    const result=effect(selected);
    const converging=result.kind==="confirms_independent"&&new Set(candidates.map(candidate=>candidate.direction)).size>1;
    return {status:result.kind==="confirms_independent"?"confirming":"applied",delta:result.scoreDelta,
      sourceBook:selected.book,sourceMarket:selected.market,
      reason:result.kind==="confirms_independent"?"observed_move_confirms_independent_without_score_shift":
        result.kind==="crosses_independent"?"observed_move_crosses_independent":"observed_move_corrects_independent",
      sourceDirection:converging?null:selected.direction,directionalEvidence:converging?"converging":candidates.length>1?"aligned":"single_source",authority,crossMarketDisagreement};
  }
  return episodes.some(e=>axis==="total"?e.market==="total":e.market!=="total")
    ?{...emptyAxis(crossMarketDisagreement?"direct_spread_unchanged_moneyline_context":"no_net_economic_change"),status:"neutral",sourceDirection:0,directionalEvidence:"flat",crossMarketDisagreement}:emptyAxis("no_qualified_paired_episode");
}
/** Static prices describe the unresolved starting-level disagreement. There is
 * no established CBB absolute winner law and therefore no numeric arbitration. */
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
  const all=current.filter(q=>q.market!=="total").map(q=>q.market==="moneyline"?direction(fair(q)-.5):direction(cbbExactMarketCenter(base,q,fair(q))));
  if(new Set(all.filter(n=>n!==0)).size>1||named.some(x=>x.mlDirection!==x.spreadDirection))
    return {...none,status:"conflicting",reason:"professional_current_winner_disagreement"};
  const selected=named.find(x=>x.mlDirection!==0&&x.mlDirection===x.spreadDirection);
  if(!selected)return {...none,status:"unavailable",reason:"no_corroborated_market_winner"};
  return {independentDirection,marketDirection:selected.mlDirection,sourceBook:selected.book,moneyline:selected.moneyline,spread:selected.spread,
    impliedMargin:selected.impliedMargin,status:selected.mlDirection===independentDirection?"not_needed":"context_only",
    reason:selected.mlDirection===independentDirection?"independent_and_market_winner_agree":"unresolved_static_starting_level_disagreement"};
}
function compactPosture(stream:CbbMarketPathStreamRead,at:number):CbbPathPosture{
  const moving=stream.intervals.filter(i=>i.direction!==0),fresh=moving.filter(i=>at-Date.parse(i.after.providerObservedAt)<=3600_000);
  const latest=fresh.at(-1);let leg=latest;
  if(latest)for(let i=fresh.length-2;i>=0&&fresh[i].direction===latest.direction;i--)leg=fresh[i];
  const lastBinding=stream.boundFlows.filter(b=>at-Date.parse(b.flow.observedAt)<=3*3600_000).at(-1);
  const reactionDirection=lastBinding?.currentUnresolvedDirection??null;
  return {book:stream.book,market:stream.market,status:stream.status,reason:stream.reason,pattern:stream.pattern,coverage:stream.coverage,
    sourceCurrentResolution:stream.currentResolution,sourceUnresolvedDirection:stream.currentUnresolvedDirection,
    onsetAt:moving[0]?.before.providerObservedAt??null,latestLegAt:leg?.before.providerObservedAt??null,
    frontierAt:latest?.after.providerObservedAt??null,frontierAvailableBy:latest?new Date(cbbEvidenceAvailableAt(latest.after)).toISOString():null,recentDirection:latest?.direction??0,
    flowResponse:lastBinding?.response??null,flowReversed:lastBinding?.subsequentlyReversed??false,
    boundFlowDirection:lastBinding?.flowDirection??null,flowReactionDirection:reactionDirection,latestFlowMatched:false,
    flowCurrentResolution:lastBinding?.currentResolution??null,
    flowPressureBasis:null,flowMoneyPct:null,flowTicketPct:null,flowGap:null,
    pressureDirection:lastBinding?.response==="aligned"&&["ongoing","resumed"].includes(lastBinding.currentResolution)?stream.pressureDirection:null,pressureLine:lastBinding?.flow.line??null,pressureObservedAt:lastBinding?.flow.observedAt??null,
    flowConcentrationDirection:0,flowLine:null,flowObservedAt:null};
}
const forecastIdentity=(f:CbbForecast)=>({release:f.release,gameId:f.gameId,asOf:f.asOf,homeId:f.homeId,awayId:f.awayId,
  inputStatus:f.inputStatus,possessions:f.possessions,issues:structuredClone(f.issues)});
const score=(f:CbbForecast)=>({home:f.homeScore,away:f.awayScore,margin:f.margin,total:f.total,homeWinProbability:f.homeWinProbability});
/** JSONB preserves values but reorders object keys. Arrays remain ordered;
 * receipt binding must reject changed evidence, not serialization order. */
const semanticKey=(value:unknown):string=>JSON.stringify(value,(_key,item)=>
  item&&typeof item==="object"&&!Array.isArray(item)
    ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
/** Private candidate: promotion requires held-out qualification or a scoped
 * owner exception. No provider, storage, fitting, writer or live activation. */
export function readCbbMarketBehavior(args:{independent:CbbForecast;independentInputKey:string;startsAt:string;
  targets:CbbQuote[];currentQuotes:CbbQuote[];anchors:CbbMarketAnchors|null;flows?:CbbBehaviorFlow[];
  splitContext?:CbbDecisionSplitContext[];contextQuotes?:CbbQuote[];
  currentSourceProblems?:Array<{book:string;market:CbbMarket;reason:string;sourceAt?:string}>;
  historyQuotes?:CbbQuote[];historyFlows?:CbbBehaviorFlow[];previousPath?:CbbMarketBehaviorPathTape|null;quarantinedSources?:CbbSourcePathQuarantine[];
  historyCompleteness?:{price:boolean;split:boolean}}){
  const base=args.independent,at=Date.parse(base.asOf),start=Date.parse(args.startsAt);
  if(![CBB_CURRENT_SCORE_RELEASE,CBB_PREVIOUS_CURRENT_SCORE_RELEASE].includes(base.release as typeof CBB_CURRENT_SCORE_RELEASE)||!args.independentInputKey||![at,start].every(Number.isFinite)||at>=start-3600_000)
    throw new Error("CBB market behavior requires current independent release and an open prelock fixture");
  if(args.targets.some(q=>q.gameId!==base.gameId))throw new Error("CBB market target identity mismatch");
  if(args.splitContext?.some(row=>row.gameId!==base.gameId||!Number.isFinite(Date.parse(row.availableBy))||Date.parse(row.availableBy)>at))
    throw new Error("CBB split context identity/cutoff mismatch");
  const independentZero=normalCdf((.5-base.margin)/base.uncertainty.marginSd)-normalCdf((-.5-base.margin)/base.uncertainty.marginSd);
  const independentWinner=(1-normalCdf((.5-base.margin)/base.uncertainty.marginSd))/(1-independentZero);
  if(base.inputStatus==="complete"&&(!validUncertainty(base)||![base.homeScore,base.awayScore,base.margin,base.total,base.homeWinProbability,independentWinner].every(Number.isFinite)||
    base.homeScore<=0||base.awayScore<=0||Math.abs(base.homeScore-base.awayScore-base.margin)>1e-8||Math.abs(base.homeScore+base.awayScore-base.total)>1e-8||
    Math.abs(base.homeWinProbability-independentWinner)>1e-8))throw new Error("CBB independent forecast coherence mismatch");
  const excludedFamilies=[...new Set(args.targets.map(q=>cbbBookFamily(q.sportsbook)))].sort(),excluded=new Set(excludedFamilies);
  const previousPath=args.previousPath;
  if(previousPath&&(![CBB_MARKET_BEHAVIOR_PATH_RELEASE,"cbb_market_behavior_path_2026_11_03_r4_identical_preflow_state","cbb_market_behavior_path_2026_11_02_r3_compact_native_frontier","cbb_market_behavior_path_2026_11_02_r2_availability_bounds"].includes(previousPath.release)||
    previousPath.gameId!==base.gameId||previousPath.startsAt!==args.startsAt||
    !Number.isFinite(Date.parse(previousPath.capturedAt))||Date.parse(previousPath.capturedAt)>at))
    throw new Error("CBB path prior identity/cutoff mismatch");
  // A failed native reread cannot erase a newer, already received physical
  // source frontier. These remain reference states, never executable targets.
  const retainedQuotes=previousPath?.streams.flatMap(stream=>stream.quarantined?[]:
    expandCbbMarketBehaviorPathStream(previousPath,stream).quotes.filter(q=>
      cbbBookFamily(q.sportsbook)===cbbBookFamily(stream.book)&&q.market===stream.market))??[];
  const current=latestQuotes([...retainedQuotes,...(args.historyQuotes??[]),...args.currentQuotes],base,at,excluded);
  const previous=args.anchors;
  const reusable=previous&&[CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,CBB_NATIVE_COUNTERPRESSURE_RECEIPT_RELEASE,CBB_CONTEXTUAL_HANDOFF_MARKET_BEHAVIOR_RECEIPT_RELEASE,CBB_CONTINUITY_MARKET_BEHAVIOR_RECEIPT_RELEASE,CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_RECEIPT_RELEASE,CBB_JOINT_MARKET_BEHAVIOR_RECEIPT_RELEASE,CBB_ALIGNED_MARKET_BEHAVIOR_RECEIPT_RELEASE,CBB_RETAIL_MARKET_BEHAVIOR_RECEIPT_RELEASE,CBB_EPISODE_MARKET_BEHAVIOR_RECEIPT_RELEASE,"cbb_market_behavior_2026_11_03_r4_new_orleans_prior_input","cbb_market_behavior_2026_11_03_r3_direction_and_magnitude","cbb_market_behavior_2026_11_02_r2_received_source_path","cbb_market_behavior_2026_11_02_r1_same_book_economics"].includes(previous.release)&&previous.gameId===base.gameId&&
    previous.startsAt===args.startsAt&&[base.release,CBB_PREVIOUS_CURRENT_SCORE_RELEASE].includes(previous.independentRelease)&&
    Number.isFinite(Date.parse(previous.capturedAt))&&Date.parse(previous.capturedAt)<=at;
  const originals=reusable?previous.quotes.filter(q=>validQuote(q,base,Date.parse(q.anchorCapturedAt??previous.capturedAt),new Set(),false)):[];
  // A newly observed source starts at its earliest genuine available native
  // pair. Existing anchors survive model revisions AND target-family changes.
  {
    const candidates=[...(args.historyQuotes??[]),...current].filter(q=>validQuote(q,base,at,excluded,false))
      .sort((a,b)=>cbbEvidenceAvailableAt(a)-cbbEvidenceAvailableAt(b)||Date.parse(a.providerObservedAt)-Date.parse(b.providerObservedAt));
    for(const q of candidates)if(!originals.some(old=>cbbBookFamily(old.sportsbook)===cbbBookFamily(q.sportsbook)&&old.market===q.market))
      originals.push({...structuredClone(q),anchorCapturedAt:new Date(cbbEvidenceAvailableAt(q)).toISOString()});
  }
  const known=new Set(originals.map(q=>`${cbbBookFamily(q.sportsbook)}:${q.market}`));
  const quarantined=new Set(reusable?previous.quarantinedKeys??[]:[]),sourceProblems:string[]=[];
  const withheldCurrent=new Set<string>();
  for(const problem of args.currentSourceProblems??[]){
    const key=`${cbbBookFamily(problem.book)}:${problem.market}`;
    withheldCurrent.add(key);sourceProblems.push(`${key}:current_response_rejected:${problem.reason}`);
  }
  const anchors:CbbMarketAnchors={release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:base.gameId,startsAt:args.startsAt,
    independentRelease:reusable?previous.independentRelease:base.release,independentInputKey:reusable?previous.independentInputKey:args.independentInputKey,capturedAt:reusable?previous.capturedAt:base.asOf,
    quotes:[...structuredClone(originals),...current.filter(q=>!known.has(`${cbbBookFamily(q.sportsbook)}:${q.market}`))
      .map(q=>({...q,anchorCapturedAt:base.asOf}))],quarantinedKeys:[...quarantined]};
  const incomingSplitContext=cbbSelectDecisionSplitFrontiers(args.splitContext??[],base.asOf);
  const splitConflicts=incomingSplitContext.filter(row=>row.sourceConflict&&row.observedAt!==null)
    .map(row=>({book:row.physicalFamily,market:row.market,sourceAt:row.observedAt!,reason:"current_native_split_state_conflict"}));
  const path=readCbbMarketBehaviorPath({independent:base,startsAt:args.startsAt,currentQuotes:args.currentQuotes,
    seedQuotes:[...anchors.quotes,...(args.historyQuotes??[])],previous:args.previousPath,
    flows:[...(args.historyFlows??[]),...(args.flows??[])],excludedFamilies,quarantinedSources:[...(args.quarantinedSources??[]),...splitConflicts]});
  for(const key of path.quarantinedKeys)quarantined.add(key);
  const pathPosture=path.streams.map(stream=>compactPosture(stream,at));
  for(const posture of pathPosture){
    const stream=path.tape.streams.find(s=>s.book===posture.book&&s.market===posture.market);
    const flows=stream?expandCbbMarketBehaviorPathStream(path.tape,stream).flows:[];
    const latest=flows.filter(f=>at-Date.parse(f.observedAt)<=3*3600_000&&cbbEvidenceAvailableAt(f)<=at).at(-1);
    if(latest){
      const published=cbbPublishedSourcePressure([latest.firstMoney,latest.secondMoney,latest.firstTickets,latest.secondTickets]);
      posture.flowConcentrationDirection=published?.direction??0;
      posture.flowPressureBasis=!published?null:published.rounded&&published.direction===0&&Math.abs(published.gap)>1e-9?"rounded_uncertain":
        Math.abs(published.gap)>1e-9?"gap":published.direction===0?"neutral":"concentration";
      posture.flowMoneyPct=published?.moneyPct??null;posture.flowTicketPct=published?.ticketPct??null;posture.flowGap=published?.gap??null;
      posture.latestFlowMatched=path.streams.find(s=>s.book===posture.book&&s.market===posture.market)?.boundFlows.some(b=>
        b.flow.observedAt===latest.observedAt&&b.flow.line===latest.line)??false;
      posture.flowLine=latest.line;posture.flowObservedAt=latest.observedAt;
      const priorBinding=path.streams.find(s=>s.book===posture.book&&s.market===posture.market)?.boundFlows
        .filter(b=>at-Date.parse(b.flow.observedAt)<=3*3600_000).at(-1);
      const unchangedSinceBinding=priorBinding&&flows.filter(f=>Date.parse(f.observedAt)>=Date.parse(priorBinding.flow.observedAt))
        .every(f=>cbbSameNativePressureState(f,priorBinding.flow));
      // The latest read remains explicitly unmatched. An identical repeat
      // cannot erase an already observed response; its original source clock
      // and current buyback/resolution remain in the compact posture.
      if(!posture.latestFlowMatched&&!unchangedSinceBinding){posture.boundFlowDirection=null;posture.flowReactionDirection=null;posture.pressureDirection=null;posture.flowResponse=null;posture.flowCurrentResolution=null;}
    }
  }
  const episodes:CbbBehaviorEpisode[]=[];
  if(base.inputStatus==="complete")for(const anchor of anchors.quotes){
    const book=cbbBookFamily(anchor.sportsbook),currentQuote=current.find(q=>cbbBookFamily(q.sportsbook)===book&&q.market===anchor.market);
    const key=`${book}:${anchor.market}`;
    if(currentQuote&&Date.parse(currentQuote.providerObservedAt)===Date.parse(anchor.providerObservedAt)&&tuple(currentQuote)!==tuple(anchor)){
      quarantined.add(key);sourceProblems.push(`${key}:ambiguous_original_source_timestamp`);
    }
    if(quarantined.has(key)||withheldCurrent.has(key)||path.streams.some(s=>s.book===book&&s.market===anchor.market&&s.status==="conflicting")||!currentQuote||Date.parse(currentQuote.providerObservedAt)<=Date.parse(anchor.providerObservedAt)||!cbbEvidenceProvablyBefore(anchor,currentQuote))continue;
    let delta:number;
    try{delta=tuple(anchor)===tuple(currentQuote)?0:anchor.market==="moneyline"?mlMargin(base,anchor,currentQuote):
      cbbExactMarketCenter(base,currentQuote,fair(currentQuote))-cbbExactMarketCenter(base,anchor,fair(anchor));}
    catch{sourceProblems.push(`${key}:unavailable_exact_response`);continue;}
    if(!Number.isFinite(delta)){sourceProblems.push(`${key}:non_finite_exact_response`);continue;}
    const binding=path.streams.find(s=>s.book===book&&s.market===anchor.market)?.boundFlows.at(-1);
    const flow=binding?.flow??null,flowDirection=binding?.flowDirection??null;
    episodes.push({book,market:anchor.market,anchor,current:currentQuote,delta,direction:direction(delta),flowDirection,flow});
  }
  anchors.quarantinedKeys=[...quarantined].sort();
  // A contradictory original receipt disqualifies the source from ALL
  // forecast authority, including the current-level winner arbitration.
  let winnerArbitration=adjudicateWinner(base,current.filter(q=>!quarantined.has(`${cbbBookFamily(q.sportsbook)}:${q.market}`)&&!withheldCurrent.has(`${cbbBookFamily(q.sportsbook)}:${q.market}`)));
  // The retained native path is already qualified input, including on a
  // temporarily incomplete canonical read. Project its real flow receipts
  // into the same one-per-market pressure frontier; never synthesize a read.
  const pathContexts:CbbDecisionSplitContext[]=path.tape.streams.flatMap(stream=>
    expandCbbMarketBehaviorPathStream(path.tape,stream).flows.map(flow=>({gameId:flow.gameId,market:flow.market,
      sourceBook:flow.sourceBook,physicalFamily:cbbBookFamily(flow.sourceBook),sourceClass:"professional_adjacent_named_book" as const,
      provider:"owls" as const,sourceEventId:flow.sourceEventId,line:flow.line,firstMoney:flow.firstMoney,secondMoney:flow.secondMoney,
      firstTickets:flow.firstTickets,secondTickets:flow.secondTickets,observedAt:flow.observedAt,
      availableBy:new Date(cbbEvidenceAvailableAt(flow)).toISOString(),receiptEarliest:flow.fetchedAt,
      clockBasis:flow.canonicalReceipt?"db_inserted_upper_bound" as const:"verified_provider_observation" as const,
      observationIds:flow.canonicalReceipt?.observationIds??[]})));
  const splitContext=cbbSelectDecisionSplitFrontiers([...incomingSplitContext,...pathContexts],base.asOf);
  const pressureDecisions=readCbbSourcePressure({forecast:base,rows:splitContext,
    quotes:[...anchors.quotes,...retainedQuotes,...(args.historyQuotes??[]),...(args.contextQuotes??[]),...args.currentQuotes],
    quarantinedKeys:[...quarantined,...withheldCurrent,...(args.quarantinedSources??[]).map(q=>`${q.book}:${q.market}`)]});
  let margin=chooseAxis(episodes,"margin",base,path,pressureDecisions),total=chooseAxis(episodes,"total",base,path,pressureDecisions);
  const eligibleCurrent=current.filter(q=>!quarantined.has(`${cbbBookFamily(q.sportsbook)}:${q.market}`)&&!withheldCurrent.has(`${cbbBookFamily(q.sportsbook)}:${q.market}`));
  const joint=decideCbbJointMargin({base,current:eligibleCurrent,episodes,path,pressure:pressureDecisions,relative:margin});
  margin=joint.margin;
  let marginSd=joint.marginSd;
  if(["applied","confirmed"].includes(joint.decision.status)){
    const quotes=joint.decision.sourceQuotes;
    winnerArbitration={sourceBook:joint.decision.sourceBook,moneyline:quotes.find(q=>q.market==="moneyline")??null,
      spread:quotes.find(q=>q.market==="spread")??null,impliedMargin:joint.decision.impliedMargin,
      independentDirection:direction(base.margin),marketDirection:direction(joint.decision.impliedMargin??0),
      status:joint.decision.status as "applied"|"confirmed",reason:joint.decision.reason};
  }
  let nextMargin=base.margin+margin.delta,nextTotal=base.total+total.delta;
  if(!Number.isFinite(nextMargin)||!Number.isFinite(nextTotal)||nextTotal<=Math.abs(nextMargin)){
    margin=emptyAxis("incoherent_score_consequence");total=emptyAxis("incoherent_score_consequence");nextMargin=base.margin;nextTotal=base.total;marginSd=base.uncertainty.marginSd;
    joint.decision.status="unresolved";joint.decision.reason="incoherent_final_score_law";
    winnerArbitration={...winnerArbitration,status:"conflicting",reason:"incoherent_final_score_law"};
  }
  const zero=normalCdf((.5-nextMargin)/marginSd)-normalCdf((-.5-nextMargin)/marginSd);
  const forecast:CbbForecast=margin.delta===0&&total.delta===0&&marginSd===base.uncertainty.marginSd?{...base,release:CBB_MARKET_BEHAVIOR_MODEL_RELEASE}:{...base,release:CBB_MARKET_BEHAVIOR_MODEL_RELEASE,margin:nextMargin,total:nextTotal,
    homeScore:(nextTotal+nextMargin)/2,awayScore:(nextTotal-nextMargin)/2,
    homeWinProbability:(1-normalCdf((.5-nextMargin)/marginSd))/(1-zero),uncertainty:{...base.uncertainty,marginSd}};
  const receipt:CbbMarketBehaviorReceipt={release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,modelRelease:CBB_MARKET_BEHAVIOR_MODEL_RELEASE,
    independentRelease:base.release,independentInputKey:args.independentInputKey,forecastIdentity:forecastIdentity(forecast),
    frozenUncertainty:structuredClone(forecast.uncertainty),originalIndependentUncertainty:structuredClone(base.uncertainty),jointMarginDecision:joint.decision,informationOverlap:"not_attested",
    referencePolicy:"union_target_excluded_same_book_receipts",marginPolicy:"contextual_authority_before_current_level",
    sourcePriority:[],evaluatedAt:base.asOf,evaluatedTargets:structuredClone(args.targets),
    currentProfessionalQuotes:structuredClone(current.filter(q=>!quarantined.has(`${cbbBookFamily(q.sportsbook)}:${q.market}`)&&!withheldCurrent.has(`${cbbBookFamily(q.sportsbook)}:${q.market}`))),
    inputRevisionSinceAnchor:anchors.independentInputKey===args.independentInputKey?"same":"changed",sourceProblems,
    excludedFamilies,anchors,episodes,pathTape:path.tape,pathPosture,splitContext:structuredClone(splitContext),
    withheldCurrentSources:structuredClone(args.currentSourceProblems??[]),
    pressureDecisions,
    historyCompleteness:args.historyCompleteness?{...args.historyCompleteness}:{price:true,split:true},
    historyMode:args.historyCompleteness?"canonical_history":"direct_stream",
    numericPathAssumption:"independent_relative_original_to_current_response",margin,total,winnerArbitration,independentScore:score(base),finalScore:score(forecast)};
  return {forecast,receipt};
}
export function assertCbbMarketBehaviorGradeReceipt(input:Parameters<typeof gradeCbbProvisional>[0],receipt:CbbMarketBehaviorReceipt){
  if(input.forecast.inputStatus==="complete"&&(!validUncertainty(input.forecast)||
    ![input.forecast.homeScore,input.forecast.awayScore,input.forecast.margin,input.forecast.total,input.forecast.homeWinProbability].every(Number.isFinite)))
    throw new Error("CBB invalid forecast probability law");
  if(semanticKey(forecastIdentity(input.forecast))!==semanticKey(receipt.forecastIdentity)||
    semanticKey(input.forecast.uncertainty)!==semanticKey(receipt.frozenUncertainty)||
    input.forecast.release!==receipt.modelRelease||input.forecast.gameId!==receipt.anchors.gameId||
    input.asOf!==receipt.evaluatedAt||input.forecast.asOf!==receipt.evaluatedAt||
    !receipt.excludedFamilies.includes(cbbBookFamily(input.target.sportsbook))||
    !receipt.evaluatedTargets.some(q=>semanticKey([q.gameId,q.market,q.sportsbook,q.line,q.firstPrice,q.secondPrice,q.providerObservedAt,q.fetchedAt,q.phase,(q as CbbQuote&{requestedAt?:string}).requestedAt??null,q.provider??null,(q as AttestedQuote).orientationVerified??null,q.canonicalReceipt??null])===
      semanticKey([input.target.gameId,input.target.market,input.target.sportsbook,input.target.line,input.target.firstPrice,input.target.secondPrice,input.target.providerObservedAt,input.target.fetchedAt,input.target.phase,(input.target as CbbQuote&{requestedAt?:string}).requestedAt??null,input.target.provider??null,(input.target as AttestedQuote).orientationVerified??null,input.target.canonicalReceipt??null]))||
    semanticKey(score(input.forecast))!==semanticKey(receipt.finalScore))throw new Error("CBB grade/market score receipt mismatch");
}
export function gradeCbbMarketBehavior(input:Parameters<typeof gradeCbbProvisional>[0],receipt:CbbMarketBehaviorReceipt){
  return gradeCbbReceivedMarket(input,receipt);
}
