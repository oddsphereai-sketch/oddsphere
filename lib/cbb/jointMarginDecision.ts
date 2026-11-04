import {invertCbbJointMarginLaw} from "./jointMarketLaw";
import {cbbExactMarketCenter} from "./marketReaderResearch";
import {cbbThresholdProbabilities} from "./model";
import {cbbImpliedProbability} from "./marketEvidence";
import {interpretCbbRelativeMarketMove} from "./marketEpisodeInterpretation";
import {selectCbbSourceEpisode,type CbbSourceAuthority,type CbbSourceEpisode} from "./sourceEpisodeAuthority";
import {cbbEvidenceAvailableAt,cbbEvidenceReceiptBounds} from "./marketReceiptTime";
import type {CbbForecast,CbbQuote} from "./types";
import type {CbbBehaviorEpisode,CbbMarketBehaviorReceipt} from "./marketBehaviorCandidate";
import type {CbbPressureDecision} from "./sourcePressureDecision";
import type {readCbbMarketBehaviorPath} from "./marketBehaviorPath";
import {cbbCurrentNativeReaction,cbbQualifiedCounterpressure} from "./nativeCounterpressure";

type Axis=CbbMarketBehaviorReceipt["margin"];
type Path=ReturnType<typeof readCbbMarketBehaviorPath>;
const family=(book:string)=>["pinnacle","ps3838"].includes(book.toLowerCase())?"pinnacle":book.toLowerCase();
const tuple=(q:CbbQuote)=>JSON.stringify([q.line,q.firstPrice,q.secondPrice]);
const sign=(n:number):-1|0|1=>Math.abs(n)<1e-7?0:n>0?1:-1;
const fair=(q:CbbQuote)=>cbbImpliedProbability(q.firstPrice)/(cbbImpliedProbability(q.firstPrice)+cbbImpliedProbability(q.secondPrice));
export type CbbJointMarginDecision={
 status:"applied"|"confirmed"|"retained"|"unresolved"|"unavailable";reason:string;sourceBook:string|null;
 sourceQuotes:CbbQuote[];authority:CbbSourceAuthority|null;
 impliedMargin:number|null;impliedMarginSd:number|null;
 numericAssumption:"same_book_current_joint_prices_or_single_contract_with_independent_shape"|"qualified_current_resistance_retains_forecast"|"qualified_native_counterpressure_retains_forecast";
 /** Present only on new decisions; never reconstruct this on stored locks. */
 relativeInterpretation?:{read:Axis;disposition:"source_level_selected"|"independent_law_confirmed"|"current_resistance_retained"|"native_counterpressure_retained"|"current_source_unresolved"|"no_current_profile"};
 candidates:Array<{book:string;status:string;reason:string;margin:number|null;marginSd:number|null}>;
};
/** Current state is evidence in its own right. Native current resistance may
 * retain the forecast, and supported path confirmation may confirm its law.
 * The remaining current-level policy is explicit; profile inversion alone is
 * not evidence that all upstream interpretations were applied correctly. */
export function decideCbbJointMargin(args:{base:CbbForecast;current:CbbQuote[];episodes:CbbBehaviorEpisode[];
 path:Path;pressure:CbbPressureDecision[];relative:Axis}){
 const {base,current,episodes,path,pressure}=args;
 const candidates:CbbJointMarginDecision["candidates"]=[];
 const profiles:Array<{book:string;quotes:CbbQuote[];margin:number;marginSd:number}>=[];
 for(const book of [...new Set(current.filter(q=>q.market!=="total").map(q=>family(q.sportsbook)))].sort()){
  const own=current.filter(q=>family(q.sportsbook)===book&&q.market!=="total"),ml=own.find(q=>q.market==="moneyline"),spread=own.find(q=>q.market==="spread");
  if(ml&&spread){
   const a=cbbEvidenceReceiptBounds(ml),b=cbbEvidenceReceiptBounds(spread);
   const sharedRun=ml.canonicalReceipt&&spread.canonicalReceipt&&ml.canonicalReceipt.ingestionRunId===spread.canonicalReceipt.ingestionRunId;
   const sameNativeInstant=Date.parse(ml.providerObservedAt)===Date.parse(spread.providerObservedAt);
   const sharedResponse=Date.parse(ml.fetchedAt)===Date.parse(spread.fetchedAt);
   const overlappingRequests=ml.requestedAt&&spread.requestedAt&&Math.max(Date.parse(ml.requestedAt),Date.parse(spread.requestedAt))<=Math.min(a.available,b.available);
   if(!sharedRun&&!sameNativeInstant&&!sharedResponse&&!overlappingRequests){
    candidates.push({book,status:"unavailable",reason:"native_joint_state_frame_not_attested",margin:null,marginSd:null});continue;
   }
   const fit=invertCbbJointMarginLaw(base,ml,spread);
   candidates.push({book,status:fit.status,reason:fit.reason,margin:fit.margin,marginSd:fit.marginSd});
   if(fit.margin!==null&&fit.marginSd!==null&&["identified","underidentified"].includes(fit.status))profiles.push({book,quotes:[ml,spread],margin:fit.margin,marginSd:fit.marginSd});
  }else if(own.length===1){
   try{const margin=cbbExactMarketCenter(base,own[0],fair(own[0]));
    candidates.push({book,status:"underidentified",reason:"one_native_contract_independent_residual_shape",margin,marginSd:base.uncertainty.marginSd});
    profiles.push({book,quotes:own,margin,marginSd:base.uncertainty.marginSd});
   }catch{candidates.push({book,status:"unavailable",reason:"single_contract_inversion_failed",margin:null,marginSd:null});}
  }
 }
 const decision:CbbJointMarginDecision={status:"unavailable",reason:"no_current_professional_margin_contract",sourceBook:null,
  sourceQuotes:[],authority:null,impliedMargin:null,impliedMarginSd:null,
  numericAssumption:"same_book_current_joint_prices_or_single_contract_with_independent_shape",candidates,
  relativeInterpretation:{read:structuredClone(args.relative),disposition:"no_current_profile"}};
 const unchanged=()=>{decision.relativeInterpretation!.disposition=decision.status==="unresolved"?"current_source_unresolved":"no_current_profile";
  return {decision,margin:decision.status==="unresolved"?{...args.relative,status:"unresolved" as const,delta:0,
  sourceBook:null,sourceMarket:null,reason:decision.reason,authority:undefined}:args.relative,marginSd:base.uncertainty.marginSd};
 };
 if(!profiles.length){if(candidates.length){decision.status="unresolved";decision.reason="current_source_constraints_inconsistent";}return unchanged();}
 // Inconsistent present source constraints are meaningful opposition, not a
 // permission to silently discard the source and promote another source.
 if(candidates.some(c=>!profiles.some(p=>p.book===c.book))){decision.status="unresolved";decision.reason="inconsistent_current_source_constraints";return unchanged();}
 let chosen=profiles.length===1?profiles[0]:undefined;
 let authority:CbbSourceAuthority|null=null;
 const equivalent=profiles.every(p=>Math.abs(p.margin-profiles[0].margin)<1e-7&&Math.abs(p.marginSd-profiles[0].marginSd)<1e-7);
 if(profiles.length>1&&equivalent){chosen=profiles[0];authority={status:"equivalent",reason:"equivalent_source_effects",selectedId:chosen.book,
  authorIds:profiles.flatMap(p=>p.quotes.map(q=>`${p.book}:${q.market}`)),followerIds:[],opposingIds:[]};}
 if(!chosen){
  // Build one physical-book episode from its genuine latest repricing. A flat
  // spread cannot hide a moneyline update. Unchanged refreshes supply no onset.
  const evidence:CbbSourceEpisode[]=profiles.flatMap(p=>{
   const streams=path.streams.filter(s=>s.book===p.book&&s.market!=="total"&&p.quotes.some(q=>q.market===s.market));
   const intervals=streams.flatMap(s=>s.intervals.filter(i=>i.direction!==0).map(i=>({s,i})))
    .sort((a,b)=>Date.parse(b.i.after.providerObservedAt)-Date.parse(a.i.after.providerObservedAt));
   const latest=intervals[0];if(!latest)return [];
   const s=latest.s,i=latest.i,currentQuote=p.quotes.find(q=>q.market===s.market)! ,direction=s.recentDirection||i.direction,ownPressure=pressure.filter(r=>r.book===p.book&&r.market===s.market&&r.sourceClass==="professional_adjacent_named_book");
   return [{id:p.book,effect:p.margin-base.margin,observedDirection:direction,
    beforeSourceAt:Date.parse(i.before.providerObservedAt),afterSourceAt:Date.parse(i.after.providerObservedAt),
    beforeEarliest:cbbEvidenceReceiptBounds(i.before).earliest,beforeAvailableBy:cbbEvidenceAvailableAt(i.before),afterAvailableBy:cbbEvidenceAvailableAt(i.after),
    currentSourceAt:Date.parse(currentQuote.providerObservedAt),currentAvailableBy:cbbEvidenceAvailableAt(currentQuote),
    currentDirection:s.recentDirection,resolved:["ongoing","resumed","reversed"].includes(s.currentResolution),
    repricedSourceAt:Date.parse(i.after.providerObservedAt),
    qualifiedReaction:ownPressure.some(r=>r.reaction!=="unbound"&&["ongoing","resumed","reversed"].includes(r.resolution)&&r.latestDirection===r.reactionDirection&&r.reactionDirection!==0),
    qualifiedContrarianHold:ownPressure.some(r=>r.resolution==="held"&&r.moneyDirection===-direction)}];
  });
  // Actual fresh opposite-winner evidence may not be resolved merely by the
  // latest update in another book. The existing authority proves supersession.
  if(evidence.length===profiles.length){
   const oppositeCurrentWinners=new Set(profiles.map(p=>sign(p.margin)).filter(Boolean)).size>1;
   const selectionEvidence=oppositeCurrentWinners?evidence.map(e=>({...e,observedDirection:sign(profiles.find(p=>p.book===e.id)!.margin),
    currentDirection:sign(profiles.find(p=>p.book===e.id)!.margin)})):evidence;
   authority=selectCbbSourceEpisode(selectionEvidence);
   if(oppositeCurrentWinners&&authority.reason!=="later_episode_supersedes_old_observations"){
    decision.status="unresolved";decision.reason="current_professional_winner_opposition";decision.authority=authority;return unchanged();
   }
   if(authority.status==="selected"||authority.status==="equivalent"&&equivalent)chosen=profiles.find(p=>p.book===authority!.selectedId);}
  // A source need not have a moving peer before its real own-source
  // response becomes interpretable. Missing peer onset is not a veto.
  const currentWinnersAgree=new Set(profiles.map(p=>sign(p.margin)).filter(Boolean)).size===1;
  if(!chosen&&currentWinnersAgree){
   const nativeResponses=profiles.map(p=>({profile:p,rows:pressure.filter(r=>r.book===p.book&&r.sourceClass==="professional_adjacent_named_book"&&
    r.current&&p.quotes.some(q=>q.market===r.market&&tuple(q)===tuple(r.current!)&&Date.parse(q.providerObservedAt)===Date.parse(r.current!.providerObservedAt)))}));
   const reacting=nativeResponses.filter(p=>p.rows.some(r=>r.reaction!=="unbound"&&["ongoing","resumed","reversed"].includes(r.resolution)&&r.latestDirection===r.reactionDirection&&r.reactionDirection!==0));
   const held=nativeResponses.filter(p=>p.rows.some(r=>r.resolution==="held"&&r.moneyDirection===-sign(p.profile.margin)));
   const distinguished=reacting.length===1?reacting[0]:held.length===1?held[0]:null;
   if(distinguished){chosen=distinguished.profile;authority={status:"selected",reason:reacting.length===1?"qualified_source_response":"qualified_contrarian_hold",
    selectedId:chosen.book,authorIds:[chosen.book],followerIds:[],opposingIds:[]};}
   if(!chosen&&evidence.length&&evidence.length<profiles.length){
    const repriced=evidence.filter(e=>e.resolved&&e.repricedSourceAt!=null),latest=Math.max(...repriced.map(e=>e.repricedSourceAt!));
    const newest=repriced.filter(e=>e.repricedSourceAt===latest);
    if(newest.length===1){chosen=profiles.find(p=>p.book===newest[0].id);authority={status:"selected",reason:"latest_observed_repricing",
     selectedId:newest[0].id,authorIds:[newest[0].id],followerIds:[],opposingIds:[]};}
   }
  }
  if(!chosen&&new Set(profiles.map(p=>sign(p.margin)).filter(Boolean)).size===1){
   // A static multi-book consensus can contradict the model before our first
   // capture. Do not require missing movement/leadership to make it usable.
   // This explicit reference policy selects a whole physical-source law,
   // never an average, fitted reliability weight or claim of first movement.
   const order=["circa","pinnacle","bookmaker"];
   chosen=[...profiles].sort((a,b)=>b.quotes.length-a.quotes.length||order.indexOf(a.book)-order.indexOf(b.book))[0];
   authority={status:"selected",reason:"current_native_source_preference",selectedId:chosen.book,
    authorIds:[chosen.book],followerIds:[],opposingIds:[]};
  }
  if(!chosen){decision.status="unresolved";decision.reason="current_physical_sources_not_resolved";decision.authority=authority;return unchanged();}
 }
 // A retained decision is a positive interpretation of current own-book
 // resistance, not missing history. Current profiles remain evidence, but
 // cannot silently replace that decision with an older net price stance.
 // Run this only after current-frame consistency and winner-opposition checks.
 const retained=args.relative.authority;
 const heldAuthorities=retained?.opposingIds??[];
 const currentResistance=args.relative.status==="neutral"&&args.relative.delta===0&&
  retained?.status==="retained"&&retained.reason==="qualified_current_resistance"&&heldAuthorities.length>0&&
  heldAuthorities.every(id=>pressure.some(row=>row.sourceClass==="professional_adjacent_named_book"&&
    `${row.book}:${row.market}`===id&&row.market!=="total"&&row.reaction==="held"&&row.resolution==="held"&&
    row.moneyDirection!==null&&row.moneyDirection!==0&&row.current&&
    episodes.some(e=>`${e.book}:${e.market}`===id&&e.direction===row.moneyDirection)&&
    profiles.some(profile=>profile.book===row.book&&profile.quotes.some(q=>q.market===row.market&&
      tuple(q)===tuple(row.current!)&&Date.parse(q.providerObservedAt)===Date.parse(row.current!.providerObservedAt)))));
 if(currentResistance){
  decision.status="retained";decision.reason="qualified_current_resistance_precedes_current_level";
  decision.authority=structuredClone(retained);decision.numericAssumption="qualified_current_resistance_retains_forecast";
  decision.relativeInterpretation!.disposition="current_resistance_retained";
  return {decision,margin:structuredClone(args.relative),marginSd:base.uncertainty.marginSd};
 }
 // An active own-book move AGAINST its money can confirm the independent
 // side even while the book's absolute price still favors the other team.
 // Interpret the reaction, rather than adopting that earlier price stance.
 // This retains an existing forecast; it does not infer points/probability
 // from money shares or certify that its probability equals a source price.
 const priorDirection=sign(base.margin);
 const relative=args.relative,relativeAuthors=relative.authority?.authorIds??[];
 const counterpressure=priorDirection!==0&&relative.status==="confirming"&&relative.delta===0&&
   relative.sourceDirection===priorDirection&&
   !episodes.some(e=>e.market!=="total"&&e.direction===-priorDirection&&
     relativeAuthors.some(id=>id.startsWith(`${e.book}:`)))&&
   ["selected","equivalent"].includes(relative.authority?.status??"")&&
   pressure.find(row=>row.market!=="total"&&relativeAuthors.some(id=>id.startsWith(`${row.book}:`))&&
     profiles.some(profile=>profile.book===row.book)&&
     episodes.some(e=>e.book===row.book&&e.market===row.market&&e.direction===priorDirection)&&
     cbbQualifiedCounterpressure(row,current,base.asOf,priorDirection));
 const opposingReaction=priorDirection!==0&&pressure.some(row=>row.market!=="total"&&
   cbbCurrentNativeReaction(row,current,base.asOf,-priorDirection as 1|-1));
 if(counterpressure&&!opposingReaction){
  const source=profiles.find(profile=>profile.book===counterpressure.book)!;
  decision.status="retained";decision.reason="qualified_native_counterpressure_precedes_current_level";
  decision.authority=structuredClone(relative.authority!);decision.sourceBook=source.book;
  decision.sourceQuotes=structuredClone(source.quotes);decision.impliedMargin=source.margin;decision.impliedMarginSd=source.marginSd;
  decision.numericAssumption="qualified_native_counterpressure_retains_forecast";
  decision.relativeInterpretation!.disposition="native_counterpressure_retained";
  return {decision,margin:structuredClone(relative),marginSd:base.uncertainty.marginSd};
 }
 const ownEpisodes=episodes.filter(e=>e.book===chosen.book&&e.market!=="total"&&e.direction!==0);
 const confirmations=ownEpisodes.map(e=>e.market==="moneyline"?
  interpretCbbRelativeMarketMove(base.homeWinProbability,fair(e.anchor),fair(e.current)):
  interpretCbbRelativeMarketMove(base.margin,cbbExactMarketCenter(base,e.anchor,fair(e.anchor)),cbbExactMarketCenter(base,e.current,fair(e.current))));
 const ownStreams=path.streams.filter(s=>s.book===chosen.book&&s.market!=="total");
 const unresolvedPath=ownStreams.some(s=>s.status==="conflicting"||s.currentResolution==="contested");
 const sourceDirection=sign(chosen.margin),independentDirection=sign(base.margin);
 // A directional move alone cannot certify a stronger independent law.
 // Every available native contract must support at least that law's actual
 // conditional probability on its preferred outcome (including ML and Spread
 // together). This is an economic ordering, not a confidence/point threshold.
 // A single contract still retains explicit independent residual shape only.
 const strengthSupported=chosen.quotes.every(q=>{
  const p=cbbThresholdProbabilities(base,q.market,q.line),independent=p.first/(p.first+p.second),source=fair(q);
  return independent>=.5 ? source+1e-8>=independent : source-1e-8<=independent;
 });
 const confirms=strengthSupported&&!unresolvedPath&&confirmations.length>0&&confirmations.every(c=>c.kind==="confirms_independent")&&
  sourceDirection===independentDirection&&chosen.quotes.filter(q=>q.market==="spread").every(q=>
    (()=>{const original=cbbThresholdProbabilities(base,"spread",q.line);
      const implied=cbbThresholdProbabilities({...base,margin:chosen!.margin,uncertainty:{...base.uncertainty,marginSd:chosen!.marginSd}},"spread",q.line);
      const sourceSide=sign(implied.first-implied.second),independentSide=sign(original.first-original.second);
      return sourceSide===0||sourceSide===independentSide;})());
 decision.sourceBook=chosen.book;decision.sourceQuotes=structuredClone(chosen.quotes);decision.authority=authority;
 decision.impliedMargin=chosen.margin;decision.impliedMarginSd=chosen.marginSd;
 const authors=chosen.quotes.map(q=>`${chosen!.book}:${q.market}`);
 const finalAuthority: CbbSourceAuthority=authority?{...authority,authorIds:authority.status==="equivalent"?authority.authorIds:authors,
  selectedId:authors[0]}:{status:"selected",reason:"single_physical_source",selectedId:authors[0],authorIds:authors,followerIds:[],opposingIds:[]};
 decision.status=confirms?"confirmed":"applied";
 decision.relativeInterpretation!.disposition=confirms?"independent_law_confirmed":"source_level_selected";
 decision.reason=confirms?"native_path_and_current_contract_confirm_independent":authority?.reason==="current_native_source_preference"?"current_source_consensus_reference_policy":"selected_current_native_source_law";
 const nativeDirection=ownEpisodes.length&&new Set(ownEpisodes.map(e=>e.direction)).size===1?ownEpisodes[0].direction:null;
 const nativeOwner=ownEpisodes.find(e=>e.market==="spread")??ownEpisodes[0];
 const margin:Axis={status:confirms?"confirming":"applied",delta:confirms?0:chosen.margin-base.margin,
  reason:confirms?"joint_current_state_confirms_independent":"joint_current_state_corrects_independent",sourceBook:chosen.book,
  sourceMarket:nativeOwner?.market??(chosen.quotes.some(q=>q.market==="spread")?"spread":"moneyline"),sourceDirection:nativeDirection,
  directionalEvidence:profiles.length>1?"aligned":"single_source",authority:finalAuthority,crossMarketDisagreement:false};
 return {decision,margin,marginSd:confirms?base.uncertainty.marginSd:chosen.marginSd};
}
